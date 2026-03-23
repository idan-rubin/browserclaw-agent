import { type NextRequest, NextResponse } from 'next/server';
import { requireEnv, backendHeaders } from '@/lib/env';

export const runtime = 'nodejs';

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const backendUrl = requireEnv('BACKEND_URL');
  try {
    const res = await fetch(`${backendUrl}/api/v1/sessions/${id}`, {
      method: 'DELETE',
      headers: backendHeaders(),
    });
    const data = (await res.json()) as unknown;
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
  }
}
