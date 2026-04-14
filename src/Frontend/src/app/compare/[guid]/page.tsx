import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CompareClient } from './compare-client';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function ComparePage({ params }: { params: Promise<{ guid: string }> }) {
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
