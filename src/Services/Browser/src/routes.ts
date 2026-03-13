import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createSession,
  getSession,
  getSessionResult,
  closeSession,
  addSSEClient,
  sessionCount,
  resolveUserResponse,
} from './session-manager.js';
import { HttpError } from './types.js';
import type { CreateSessionRequest } from './types.js';

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
    handler: async ({ res }) => {
      json(res, 200, {
        status: 'healthy',
        service: 'browserclaw-browser',
        sessions: sessionCount(),
      });
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/v1\/sessions$/,
    paramNames: [],
    handler: async ({ req, res, clientIp }) => {
      const body = await parseBody<CreateSessionRequest>(req);

      if (!body.prompt || body.prompt.trim().length === 0) {
        sendError(res, 400, 'prompt is required');
        return;
      }

      const url = body.url ? validateUrl(body.url) : undefined;
      const envForcesVisible = process.env.BROWSER_HEADLESS === 'false';
      const headless = envForcesVisible ? false : body.headless;

      const { session } = await createSession(
        body.prompt, url, headless, clientIp,
        body.skip_moderation,
      );

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
    handler: async ({ res, params }) => {
      const sessionId = params.id;
      getSession(sessionId); // throws 404 if session doesn't exist

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
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
    },
  },

  {
    method: 'GET',
    pattern: /^\/api\/v1\/sessions\/([^/]+)$/,
    paramNames: ['id'],
    handler: async ({ res, params }) => {
      const sessionId = params.id;
      const session = getSession(sessionId);
      const { result, skill } = getSessionResult(sessionId);

      json(res, 200, {
        ...session,
        result: result ? {
          success: result.success,
          steps_completed: result.steps.length,
          duration_ms: result.duration_ms,
          error: result.error,
          final_url: result.final_url,
        } : null,
        skill,
      });
    },
  },

  {
    method: 'POST',
    pattern: /^\/api\/v1\/sessions\/([^/]+)\/respond$/,
    paramNames: ['id'],
    handler: async ({ req, res, params }) => {
      const body = await parseBody<{ text: string }>(req);
      const text = (body.text || '').trim();
      if (text.length === 0) {
        sendError(res, 400, 'text is required');
        return;
      }
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

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  clientIp: string = '127.0.0.1',
): Promise<void> {
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
      console.error(`Error handling ${method} ${path}:`, internal);
      sendError(res, status, isHttpError ? internal : 'Internal server error');
    }
    return;
  }

  sendError(res, 404, `Unknown route: ${method} ${path}`);
}
