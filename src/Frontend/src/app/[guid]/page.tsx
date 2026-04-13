import { notFound } from 'next/navigation';
import { CompareClient } from './compare-client';

export const dynamic = 'force-dynamic';

/**
 * Hidden head-to-head comparison page at /<guid>.
 *
 * Access-gated by the COMPARE_GUID server env var. No nav link, no SEO, no
 * discovery — distribute the URL out-of-band. An empty or unset COMPARE_GUID
 * disables the route entirely (404 for every value).
 */
export default async function GuidPage({ params }: { params: Promise<{ guid: string }> }) {
  const { guid } = await params;
  const expected = process.env.COMPARE_GUID;
  if (expected == null || expected === '' || guid !== expected) {
    notFound();
  }
  return <CompareClient />;
}
