import { type NextRequest, NextResponse } from 'next/server';
import { requireEnv, backendHeaders } from '@/lib/env';
import type { ApiErrorBody } from '@/lib/api-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Proxy to the browser-use sidecar. Only reachable when the comparison page
// is enabled; in public deployments COMPARE_ENABLED is unset and every
// bu-runs endpoint returns 404.
function compareEnabled(): boolean {
  return process.env.COMPARE_ENABLED === 'true';
}

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

export async function POST(request: NextRequest) {
  if (!compareEnabled()) {
    return NextResponse.json<ApiErrorBody>({ error: 'not_found' }, { status: 404 });
  }
  const backendUrl = requireEnv('BACKEND_BU_URL');
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json<ApiErrorBody>({ error: 'bad_request', code: 'INVALID_JSON' }, { status: 400 });
  }
  const idempotencyKey = request.headers.get('idempotency-key');
  const upstreamHeaders: Record<string, string> = {
    ...backendHeaders(),
    'Content-Type': 'application/json',
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
  const data = (await res.json()) as unknown;
  const replayed = res.headers.get('idempotency-replayed');
  const responseHeaders: Record<string, string> = {};
  if (replayed !== null) {
    responseHeaders['Idempotency-Replayed'] = replayed;
  }
  return NextResponse.json(data, { status: res.status, headers: responseHeaders });
}
