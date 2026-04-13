import { type NextRequest, NextResponse } from 'next/server';
import { requireEnv } from '@/lib/env';

export const runtime = 'nodejs';

const ID_RE = /^[0-9a-f]{32}$/i;

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.COMPARE_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const { id } = await params;
  if (!ID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid session ID' }, { status: 400 });
  }

  const backendUrl = requireEnv('BACKEND_BU_URL');
  try {
    const res = await fetch(`${backendUrl}/api/v1/sessions/${id}`, { method: 'DELETE' });
    const data = (await res.json()) as unknown;
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
}
