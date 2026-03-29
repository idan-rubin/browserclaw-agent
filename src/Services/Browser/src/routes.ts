import type { IncomingMessage, ServerResponse } from 'node:http';
import { logger } from './logger.js';
import {
  createSession,
  getSession,
  getSessionResult,
  closeSession,
  addSSEClient,
  sessionCount,
  resolveUserResponse,
} from './session-manager.js';
import { BYOK_PROVIDERS } from './llm.js';
import { HttpError } from './types.js';
import type { CreateSessionRequest, LlmConfig } from './types.js';

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

function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

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

      if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
        sendError(res, 400, 'prompt is required and must be a non-empty string');
        return;
      }

      if (body.headless !== undefined && typeof body.headless !== 'boolean') {
        sendError(res, 400, 'headless must be a boolean');
        return;
      }

      const url = body.url !== undefined && body.url !== '' ? validateUrl(body.url) : undefined;
      const envForcesVisible = process.env.BROWSER_HEADLESS === 'false';
      const headless = envForcesVisible ? false : body.headless;

      const hasValidToken = req.headers.authorization !== undefined;
      const skipModeration = hasValidToken && body.skip_moderation === true;

      // Validate BYOK LLM config if provided
      let llmConfig: LlmConfig | undefined;
      if (body.llm_config !== undefined) {
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
        llmConfig = { provider, model: model.trim(), api_key: api_key.trim() };
      }

      const { session } = await createSession(body.prompt, url, headless, clientIp, skipModeration, llmConfig);

      json(res, 201, {
        session_id: session.id,
        status: session.status,
        created_at: session.created_at,
      });
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

      res.write(`event: connected\ndata: ${JSON.stringify({ session_id: sessionId })}\n\n`);
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
      if (text.length > 10_000) {
        sendError(res, 400, 'text must be under 10000 characters');
        return;
      }
      resolveUserResponse(params.id, text);
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
      const isHttpError = err instanceof HttpError;
      const status = isHttpError ? err.statusCode : 500;
      const internal = err instanceof Error ? err.message : 'Internal server error';
      logger.error({ method, path, error: internal }, 'Request handler error');
      sendError(res, status, isHttpError ? internal : 'Internal server error');
    }
    return;
  }

  sendError(res, 404, 'Not found');
}
