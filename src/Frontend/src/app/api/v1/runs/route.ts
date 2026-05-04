import { type NextRequest, NextResponse } from 'next/server';
import { requireEnv, backendHeaders } from '@/lib/env';
import type { CreateSessionRequest, CreateSessionResponse, ApiErrorBody } from '@/lib/api-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sanitizeUpstreamMessage(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const firstLine = input.split('\n', 1)[0].trim();
  const noPaths = firstLine.replace(/(\s|^)(\/[\w./-]+)+/g, ' [path]');
  return noPaths.slice(0, 240);
}

async function buildErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    const data = (await res.json()) as Record<string, unknown>;
    const code =
      typeof data.error_code === 'string' ? data.error_code : typeof data.code === 'string' ? data.code : undefined;
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
    return NextResponse.json<ApiErrorBody>({ error: 'upstream_unreachable' }, { status: 503 });
  }
  if (!res.ok) {
    const body = await buildErrorBody(res);
    return NextResponse.json(body, { status: res.status });
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return NextResponse.json<ApiErrorBody>({ error: 'upstream_error', code: 'INVALID_JSON' }, { status: 502 });
  }
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
  const idempotencyKey = request.headers.get('idempotency-key');
  const upstreamHeaders: Record<string, string> = {
    ...backendHeaders(),
    'Content-Type': 'application/json',
    'X-Forwarded-For': clientIp,
  };
  if (idempotencyKey !== null && idempotencyKey.trim() !== '') {
    upstreamHeaders['Idempotency-Key'] = idempotencyKey;
  }
  let res: Response;
  try {
    res = await fetch(`${backendUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify(body),
      signal: request.signal,
    });
  } catch {
    return NextResponse.json<ApiErrorBody>({ error: 'upstream_unreachable' }, { status: 503 });
  }
  if (!res.ok) {
    const errBody = await buildErrorBody(res);
    return NextResponse.json(errBody, { status: res.status });
  }
  let data: CreateSessionResponse;
  try {
    data = (await res.json()) as CreateSessionResponse;
  } catch {
    return NextResponse.json<ApiErrorBody>({ error: 'upstream_error', code: 'INVALID_JSON' }, { status: 502 });
  }
  const replayed = res.headers.get('idempotency-replayed');
  const responseHeaders: Record<string, string> = {};
  if (replayed !== null) {
    responseHeaders['Idempotency-Replayed'] = replayed;
  }
  return NextResponse.json(data, { status: res.status, headers: responseHeaders });
}
