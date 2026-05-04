import type { IncomingMessage, ServerResponse } from 'node:http';
import { logger } from './logger.js';
import {
  createSession,
  getSession,
  getSessionResult,
  closeSession,
  addSSEClient,
  sessionCount,
  enqueueUserMessage,
} from './session-manager.js';
import { loadTrajectory } from './trajectory-store.js';
import { INTERJECTION_MAX_CHARS } from './config.js';
import { BYOK_PROVIDERS, extractProviderMessage } from './llm.js';
import { HttpError } from './types.js';
import type { LlmConfig } from './types.js';
import type { CreateSessionRequest, CreateSessionResponse } from './api-types.js';
import { stampSSEPayload } from './sse-stamp.js';
import {
  IDEMPOTENCY_TTL_MS,
  buildRequestFingerprint,
  completeIdempotency,
  expirePendingIdempotency,
  failIdempotency,
  getIdempotencyCacheKey,
  lookupIdempotency,
  normalizeIdempotencyKey,
  reserveIdempotency,
  type IdempotencyCacheEntry,
} from './idempotency.js';

const MAX_BODY_BYTES = 100 * 1024; // 100KB

async function parseBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    totalSize += (chunk as Buffer).length;
    if (totalSize > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body too large');
    }
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON in request body');
  }
}

const ALLOWED_URL_SCHEMES = ['http:', 'https:'];

function validateUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, 'Invalid URL');
  }
  if (!ALLOWED_URL_SCHEMES.includes(parsed.protocol)) {
    throw new HttpError(400, 'URL must use http or https');
  }
  return parsed.href;
}

function json(res: ServerResponse, status: number, data: unknown, headers?: Record<string, string>): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

interface IdempotentReplay {
  status: number;
  body: CreateSessionResponse;
}

const idempotencyCache = new Map<string, IdempotencyCacheEntry<IdempotentReplay>>();

const idempotencyCleanup = setInterval(() => {
  const now = Date.now();
  expirePendingIdempotency(idempotencyCache, now);
  for (const [key, entry] of idempotencyCache) {
    if (entry.kind === 'completed' && now - entry.createdAt > IDEMPOTENCY_TTL_MS) {
      idempotencyCache.delete(key);
    }
  }
}, IDEMPOTENCY_TTL_MS);
idempotencyCleanup.unref();

function sendError(res: ServerResponse, status: number, message: string): void {
  json(res, status, { error_code: 'BROWSER_ERROR', message });
}

interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  clientIp: string;
}

type Handler = (ctx: RouteContext) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

const routes: Route[] = [
  {
    method: 'GET',
    pattern: /^\/health$/,
    paramNames: [],
    handler: ({ res }) => {
      json(res, 200, {
        status: 'healthy',
        service: 'browserclaw-browser',
        sessions: sessionCount(),
      });
      return Promise.resolve();
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/v1\/sessions$/,
    paramNames: [],
    handler: async ({ req, res, clientIp }) => {
      const body = await parseBody<CreateSessionRequest>(req);

      const idempotencyKey = normalizeIdempotencyKey(req.headers['idempotency-key']);
      const idempotencyContext =
        idempotencyKey !== undefined
          ? {
              cacheKey: getIdempotencyCacheKey(clientIp, idempotencyKey),
              fingerprint: buildRequestFingerprint(body),
            }
          : undefined;

      if (idempotencyContext !== undefined) {
        const lookup = lookupIdempotency(
          idempotencyCache,
          idempotencyContext.cacheKey,
          idempotencyContext.fingerprint,
          Date.now(),
        );
        if (lookup.kind === 'fingerprint_mismatch') {
          json(res, 409, {
            error_code: 'IDEMPOTENCY_KEY_REUSED',
            message:
              'Idempotency-Key was previously used with a different request body. Use a fresh key or send the original body.',
          });
          return;
        }
        if (lookup.kind === 'completed_match') {
          json(res, lookup.response.status, lookup.response.body, { 'Idempotency-Replayed': 'true' });
          return;
        }
        if (lookup.kind === 'pending_match') {
          try {
            const replay = await lookup.promise;
            json(res, replay.status, replay.body, { 'Idempotency-Replayed': 'true' });
          } catch (err) {
            const replayHeaders = { 'Idempotency-Replayed': 'true' };
            if (err instanceof HttpError) {
              json(res, err.statusCode, { error_code: 'BROWSER_ERROR', message: err.message }, replayHeaders);
              return;
            }
            const providerMessage = extractProviderMessage(err);
            if (providerMessage !== null) {
              json(res, 422, { error_code: 'BROWSER_ERROR', message: providerMessage }, replayHeaders);
              return;
            }
            json(res, 500, { error_code: 'BROWSER_ERROR', message: 'Internal server error' }, replayHeaders);
          }
          return;
        }
      }

      if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
        sendError(res, 400, 'prompt is required and must be a non-empty string');
        return;
      }

      if (body.headless !== undefined && typeof body.headless !== 'boolean') {
        sendError(res, 400, 'headless must be a boolean');
        return;
      }

      const url = body.url !== undefined && body.url !== '' ? validateUrl(body.url) : undefined;
      const envHeadless = process.env.BROWSER_HEADLESS;
      const headless = envHeadless === 'false' ? false : envHeadless === 'true' ? true : body.headless;

      const hasValidToken = req.headers.authorization !== undefined;
      const skipModeration = hasValidToken && body.skip_moderation === true;
      const skipPostprocessing = hasValidToken && body.skip_postprocessing === true;

      // BYOK LLM config required — server holds no credentials
      if (body.llm_config === undefined) {
        sendError(res, 400, 'llm_config is required (BYOK only)');
        return;
      }
      const { provider, model, api_key } = body.llm_config;
      if (!(provider in BYOK_PROVIDERS)) {
        sendError(res, 400, `Invalid provider. Must be one of: ${Object.keys(BYOK_PROVIDERS).join(', ')}`);
        return;
      }
      if (typeof model !== 'string' || model.trim() === '') {
        sendError(res, 400, 'model is required');
        return;
      }
      if (typeof api_key !== 'string' || api_key.trim() === '') {
        sendError(res, 400, 'api_key is required');
        return;
      }
      const llmConfig: LlmConfig = { provider, model: model.trim(), api_key: api_key.trim() };

      const reservation =
        idempotencyContext !== undefined
          ? reserveIdempotency(
              idempotencyCache,
              idempotencyContext.cacheKey,
              idempotencyContext.fingerprint,
              Date.now(),
            )
          : undefined;

      let response: CreateSessionResponse;
      try {
        const { session } = await createSession(
          body.prompt,
          url,
          headless,
          clientIp,
          skipModeration,
          llmConfig,
          skipPostprocessing,
        );
        response = {
          session_id: session.id,
          status: session.status,
          created_at: session.created_at,
        };
      } catch (err) {
        if (idempotencyContext !== undefined && reservation !== undefined) {
          failIdempotency(
            idempotencyCache,
            idempotencyContext.cacheKey,
            reservation,
            err instanceof Error ? err : new Error(String(err)),
          );
        }
        throw err;
      }

      if (idempotencyContext !== undefined && reservation !== undefined) {
        completeIdempotency(
          idempotencyCache,
          idempotencyContext.cacheKey,
          reservation,
          { status: 201, body: response },
          Date.now(),
        );
      }
      json(res, 201, response);
    },
  },

  {
    method: 'GET',
    pattern: /^\/api\/v1\/sessions\/([^/]+)\/stream$/,
    paramNames: ['id'],
    handler: ({ res, params }) => {
      const sessionId = params.id;
      getSession(sessionId); // throws 404 if session doesn't exist

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      res.write(
        `event: connected\ndata: ${JSON.stringify(stampSSEPayload('connected', { session_id: sessionId }))}\n\n`,
      );
      addSSEClient(sessionId, res);

      const heartbeat = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 15_000);

      res.on('close', () => {
        clearInterval(heartbeat);
      });
      return Promise.resolve();
    },
  },

  {
    method: 'GET',
    pattern: /^\/api\/v1\/sessions\/([^/]+)$/,
    paramNames: ['id'],
    handler: ({ res, params }) => {
      const sessionId = params.id;
      const session = getSession(sessionId);
      const { result, skill, domain_skills } = getSessionResult(sessionId);

      json(res, 200, {
        ...session,
        result:
          result !== null
            ? {
                success: result.success,
                steps_completed: result.steps.length,
                duration_ms: result.duration_ms,
                error: result.error,
                final_url: result.final_url,
              }
            : null,
        skill,
        domain_skills,
      });
      return Promise.resolve();
    },
  },

  {
    method: 'GET',
    pattern: /^\/api\/v1\/sessions\/([^/]+)\/trajectory$/,
    paramNames: ['id'],
    handler: async ({ res, params }) => {
      const sessionId = params.id;
      const record = await loadTrajectory(sessionId);
      if (record === null) {
        sendError(res, 404, 'Trajectory not found');
        return;
      }
      json(res, 200, record);
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/v1\/sessions\/([^/]+)\/respond$/,
    paramNames: ['id'],
    handler: async ({ req, res, params }) => {
      const body = await parseBody<{ text: string }>(req);
      if (typeof body.text !== 'string' || body.text.trim().length === 0) {
        sendError(res, 400, 'text is required and must be a non-empty string');
        return;
      }
      const text = body.text.trim();
      if (text.length > INTERJECTION_MAX_CHARS) {
        sendError(res, 400, `text must be under ${String(INTERJECTION_MAX_CHARS)} characters`);
        return;
      }
      enqueueUserMessage(params.id, text);
      json(res, 200, { success: true });
    },
  },

  {
    method: 'DELETE',
    pattern: /^\/api\/v1\/sessions\/([^/]+)$/,
    paramNames: ['id'],
    handler: async ({ res, params }) => {
      const sessionId = params.id;
      await closeSession(sessionId);
      json(res, 200, { success: true });
    },
  },
];

export async function handleRequest(req: IncomingMessage, res: ServerResponse, clientIp = '127.0.0.1'): Promise<void> {
  const method = req.method ?? 'GET';
  const path = req.url?.split('?')[0] ?? '/';

  for (const route of routes) {
    if (route.method !== method) continue;
    const match = path.match(route.pattern);
    if (!match) continue;

    const params: Record<string, string> = {};
    for (let i = 0; i < route.paramNames.length; i++) {
      params[route.paramNames[i]] = match[i + 1];
    }

    try {
      await route.handler({ req, res, params, clientIp });
    } catch (err: unknown) {
      const internal = err instanceof Error ? err.message : 'Internal server error';
      logger.error({ method, path, error: internal }, 'Request handler error');
      if (err instanceof HttpError) {
        sendError(res, err.statusCode, internal);
        return;
      }
      const providerMessage = extractProviderMessage(err);
      if (providerMessage !== null) {
        sendError(res, 422, providerMessage);
        return;
      }
      sendError(res, 500, 'Internal server error');
    }
    return;
  }

  sendError(res, 404, 'Not found');
}
