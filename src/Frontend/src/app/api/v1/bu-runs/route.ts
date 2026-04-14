import { type NextRequest, NextResponse } from 'next/server';
import { requireEnv, backendHeaders } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Proxy to the browser-use sidecar. Only reachable when the comparison page
// is enabled; in public deployments COMPARE_ENABLED is unset and every
// bu-runs endpoint returns 404.
function compareEnabled(): boolean {
  return process.env.COMPARE_ENABLED === 'true';
}

export async function POST(request: NextRequest) {
  if (!compareEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const backendUrl = requireEnv('BACKEND_BU_URL');
  try {
    const body = (await request.json()) as unknown;
    const res = await fetch(`${backendUrl}/api/v1/sessions`, {
      method: 'POST',
      headers: { ...backendHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: request.signal,
    });
    const data = (await res.json()) as unknown;
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
}
