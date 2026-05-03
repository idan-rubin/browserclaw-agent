import { type NextRequest, NextResponse } from 'next/server';
import { requireEnv, backendHeaders } from '@/lib/env';
import type { CreateSessionRequest, CreateSessionResponse, ApiErrorBody } from '@/lib/api-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Trim and sanitize an upstream error string for client consumption.
 * Drops obvious filesystem paths, stack traces, and over-long bodies.
 */
function sanitizeUpstreamMessage(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  // Drop everything from the first newline (typical stack-trace frame) and
  // any absolute paths.
  const firstLine = input.split('\n', 1)[0].trim();
  const noPaths = firstLine.replace(/(\s|^)(\/[\w./-]+)+/g, ' [path]');
  return noPaths.slice(0, 240);
}

/**
 * Read the upstream response body once and try to extract a structured
 * error payload. Falls back to `{ error: 'upstream_error' }` if the body
 * isn't JSON.
 */
async function buildErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    const code = typeof data.error_code === 'string' ? data.error_code : typeof data.code === 'string' ? data.code : undefined;
    const message = sanitizeUpstreamMessage(data.message ?? data.error);
    return {
      error: code ?? 'upstream_error',
      ...(code !== undefined && { code }),
      ...(message !== undefined && { message }),
    };
  } catch {
    return { error: 'upstream_error' };
  }
}

export async function GET(request: NextRequest) {
  const backendUrl = requireEnv('BACKEND_URL');
  let res: Response;
  try {
    res = await fetch(`${backendUrl}/api/v1/runs${request.nextUrl.search}`, {
      headers: backendHeaders(),
      signal: request.signal,
    });
  } catch {
    // Network-level failure (DNS, refused, abort) — backend is unreachable.
    return NextResponse.json<ApiErrorBody>({ error: 'upstream_unreachable' }, { status: 503 });
  }
  if (!res.ok) {
    const body = await buildErrorBody(res);
    return NextResponse.json(body, { status: res.status });
  }
  const data = (await res.json()) as unknown;
  return NextResponse.json(data, { status: res.status });
}

export async function POST(request: NextRequest) {
  const backendUrl = requireEnv('BACKEND_URL');
  let body: CreateSessionRequest;
  try {
    body = (await request.json()) as CreateSessionRequest;
  } catch {
    return NextResponse.json<ApiErrorBody>({ error: 'bad_request', code: 'INVALID_JSON' }, { status: 400 });
  }
  const clientIp = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? '127.0.0.1';
  let res: Response;
  try {
    res = await fetch(`${backendUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: {
        ...backendHeaders(),
        'Content-Type': 'application/json',
        'X-Forwarded-For': clientIp,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });
  } catch {
    return NextResponse.json<ApiErrorBody>({ error: 'upstream_unreachable' }, { status: 503 });
  }
  if (!res.ok) {
    // Forward upstream status (4xx from validation, 401 unauth, 429 rate
    // limit, 5xx backend errors) along with a sanitized code/message so
    // the UI can show something more useful than a generic 503.
    const errBody = await buildErrorBody(res);
    return NextResponse.json(errBody, { status: res.status });
  }
  const data = (await res.json()) as CreateSessionResponse;
  return NextResponse.json(data, { status: res.status });
}
