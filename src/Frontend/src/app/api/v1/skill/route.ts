import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 300;

const SKILL_URL = 'https://raw.githubusercontent.com/idan-rubin/browserclaw/main/.claude/skills/browserclaw/SKILL.md';

export async function GET() {
  try {
    const res = await fetch(SKILL_URL, { next: { revalidate: 300 } });
    if (!res.ok) {
      return new NextResponse(`Upstream ${String(res.status)}`, { status: 502 });
    }
    const text = await res.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=300',
      },
    });
  } catch (err) {
    logger.warn({ err }, 'skill fetch failed');
    return NextResponse.json({ error: 'Failed to fetch skill' }, { status: 502 });
  }
}
