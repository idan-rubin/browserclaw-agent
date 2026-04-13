import { notFound } from 'next/navigation';
import { CompareClient } from './compare-client';

export const dynamic = 'force-dynamic';

/**
 * Hidden head-to-head comparison page at /<guid>.
 *
 * Double-gated: requires BOTH `COMPARE_ENABLED=true` AND a matching
 * `COMPARE_GUID` on the server. Either missing → 404. In public
 * deployments neither is set, so the route does not exist. The guid is
 * a belt-and-braces second layer — guess-resistant even if a deploy
 * accidentally enables the route.
 */
export default async function GuidPage({ params }: { params: Promise<{ guid: string }> }) {
  if (process.env.COMPARE_ENABLED !== 'true') {
    notFound();
  }
  const { guid } = await params;
  const expected = process.env.COMPARE_GUID;
  if (expected == null || expected === '' || guid !== expected) {
    notFound();
  }
  return <CompareClient />;
}
