import { describe, it, expect, vi } from 'vitest';
import type { BrowserClaw, CrawlPage } from 'browserclaw';
import { extractItems, extractItemsFromUrls } from '../skills/extract-items.js';

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

describe('extractItemsFromUrls', () => {
  it('opens each URL, extracts items, aggregates with sourceUrl, closes tabs', async () => {
    const opened: string[] = [];
    const closed: string[] = [];
    const browser = {
      open: vi.fn().mockImplementation((url: string) => {
        opened.push(url);
        return Promise.resolve({
          id: `t-${String(opened.length)}`,
          waitFor: vi.fn().mockResolvedValue(undefined),
          evaluate: vi.fn().mockResolvedValue({
            source: 'next-data',
            records: [{ price: '$3,000', beds: '1' }],
          }),
        });
      }),
      close: vi.fn().mockImplementation((id: string) => {
        closed.push(id);
        return Promise.resolve();
      }),
    } as unknown as BrowserClaw;

    const result = await extractItemsFromUrls(browser, ['https://x/1', 'https://x/2'], { concurrency: 2 });

    expect(result.count).toBe(2);
    expect(opened).toEqual(['https://x/1', 'https://x/2']);
    expect(closed).toHaveLength(2);
    expect(result.records[0]).toEqual(expect.objectContaining({ sourceUrl: 'https://x/1', price: '$3,000' }));
    expect(result.failedUrls).toEqual([]);
  });

  it('records failed URLs but does not abort the batch', async () => {
    const browser = {
      open: vi.fn().mockImplementation((url: string) => {
        if (url.endsWith('/bad')) return Promise.reject(new Error('navigation failed'));
        return Promise.resolve({
          id: 't',
          waitFor: vi.fn().mockResolvedValue(undefined),
          evaluate: vi.fn().mockResolvedValue({ source: 'dom', records: [{ x: 1 }] }),
        });
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BrowserClaw;

    const result = await extractItemsFromUrls(browser, ['https://x/good', 'https://x/bad']);

    expect(result.failedUrls).toEqual(['https://x/bad']);
    expect(result.count).toBe(1);
    expect(result.records[0]).toEqual(expect.objectContaining({ sourceUrl: 'https://x/good', x: 1 }));
  });

  it('dedupes and caps urls at 10', async () => {
    const browser = {
      open: vi.fn().mockResolvedValue({
        id: 't',
        waitFor: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue({ source: 'none', records: [] }),
      }),
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as BrowserClaw;

    const urls: string[] = [...(Array.from({ length: 15 }).fill('https://x/dup') as string[]), 'https://x/unique'];
    await extractItemsFromUrls(browser, urls);

    const openFn = browser.open as unknown as { mock: { calls: unknown[][] } };
    expect(openFn.mock.calls).toHaveLength(2);
  });
});
