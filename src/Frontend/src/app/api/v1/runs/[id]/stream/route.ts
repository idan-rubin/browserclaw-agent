import { type NextRequest } from 'next/server';
import { requireEnv, backendHeaders } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{32}$/i;

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return new Response(JSON.stringify({ error: 'Invalid session ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const backendUrl = requireEnv('BACKEND_URL');

  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl}/api/v1/sessions/${id}/stream`, {
      headers: { ...backendHeaders(), Accept: 'text/event-stream' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Service unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(JSON.stringify({ error: 'Session not found' }), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
