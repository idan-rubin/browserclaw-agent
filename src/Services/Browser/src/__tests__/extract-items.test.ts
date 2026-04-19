import { describe, it, expect, vi } from 'vitest';
import type { CrawlPage } from 'browserclaw';
import { extractItems } from '../skills/extract-items.js';

function mockPage(evaluateImpl: (expr: string) => unknown): CrawlPage {
  return {
    evaluate: vi.fn().mockImplementation((expr: string) => Promise.resolve(evaluateImpl(expr))),
  } as unknown as CrawlPage;
}

describe('extractItems', () => {
  it('returns empty when evaluator returns no records', async () => {
    const page = mockPage(() => ({ source: 'none', records: [] }));
    const result = await extractItems(page);
    expect(result.source).toBe('none');
    expect(result.count).toBe(0);
    expect(result.records).toEqual([]);
  });

  it('passes through records and counts them', async () => {
    const records = [
      { price: '$3,995', address: 'W 21st St', bedrooms: 'Studio', url: 'https://x/1' },
      { price: '$4,100', address: 'W 22nd St', bedrooms: '1', url: 'https://x/2' },
    ];
    const page = mockPage(() => ({ source: 'next-data', records }));
    const result = await extractItems(page);
    expect(result.source).toBe('next-data');
    expect(result.count).toBe(2);
    expect(result.records).toEqual(records);
    expect(result.truncated).toBe(false);
  });

  it('marks truncated when records exceed cap', async () => {
    const records = Array.from({ length: 25 }, (_, i) => ({ id: i, url: `https://x/${String(i)}` }));
    const page = mockPage(() => ({ source: 'dom', records }));
    const result = await extractItems(page);
    expect(result.truncated).toBe(true);
    expect(result.records).toHaveLength(20);
  });

  it('swallows evaluator errors and returns none', async () => {
    const page = mockPage(() => {
      throw new Error('page.evaluate failed');
    });
    const result = await extractItems(page);
    expect(result.source).toBe('none');
    expect(result.count).toBe(0);
  });

  it('returns none when evaluator returns non-object', async () => {
    const page = mockPage(() => 'weird string');
    const result = await extractItems(page);
    expect(result.source).toBe('none');
  });
});
