import { type NextRequest, NextResponse } from 'next/server';
import { requireEnv, backendHeaders } from '@/lib/env';
import type { CreateSessionRequest, CreateSessionResponse, ApiErrorBody } from '@/lib/api-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const backendUrl = requireEnv('BACKEND_URL');
  try {
    const res = await fetch(`${backendUrl}/api/v1/runs${request.nextUrl.search}`, {
      headers: backendHeaders(),
      signal: request.signal,
    });
    const data = (await res.json()) as unknown;
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json<ApiErrorBody>({ error: 'upstream_unreachable' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const backendUrl = requireEnv('BACKEND_URL');
  try {
    const body = (await request.json()) as CreateSessionRequest;
    const clientIp = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? '127.0.0.1';
    const res = await fetch(`${backendUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: {
        ...backendHeaders(),
        'Content-Type': 'application/json',
        'X-Forwarded-For': clientIp,
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });
    const data = (await res.json()) as CreateSessionResponse | ApiErrorBody;
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json<ApiErrorBody>({ error: 'upstream_unreachable' }, { status: 503 });
  }
}
