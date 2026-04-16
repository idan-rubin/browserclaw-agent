import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { webSearch } from '../web-search.js';

const SAMPLE_HTML = `
<html><body>
<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa">First <b>match</b></a>
<a class="result__snippet" href="//example.com/a">Snippet for first <b>result</b></a>
<a class="result__a" href="https://example.com/b">Second result</a>
<a class="result__snippet" href="https://example.com/b">Snippet for second</a>
</body></html>
`;

describe('webSearch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses results and unwraps DDG uddg redirects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(SAMPLE_HTML, { status: 200 })));

    const out = await webSearch('hello world');

    expect(out).toContain('1. First match');
    expect(out).toContain('https://example.com/a');
    expect(out).toContain('Snippet for first result');
    expect(out).toContain('2. Second result');
    expect(out).toContain('https://example.com/b');
  });

  it('reports HTTP errors without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));

    const out = await webSearch('q');

    expect(out).toBe('Search failed: HTTP 503');
  });

  it('returns no-results message when DDG returns an empty page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html><body></body></html>', { status: 200 })));

    const out = await webSearch('q');

    expect(out).toBe('No results found.');
  });

  it('returns failure message when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ENOTFOUND')));

    const out = await webSearch('q');

    expect(out).toBe('Search failed: ENOTFOUND');
  });

  it('clears the abort timer when fetch rejects (no pending timer leak)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

    await webSearch('q');

    expect(clearSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the abort timer on the success path', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(SAMPLE_HTML, { status: 200 })));

    await webSearch('q');

    expect(vi.getTimerCount()).toBe(0);
  });

  it('strips nested HTML tags safely (CodeQL-style nested injection)', async () => {
    const html = `
<a class="result__a" href="https://example.com">Title with <scr<script>ipt>alert(1)</scr</script>ipt></a>
<a class="result__snippet" href="https://example.com">snippet</a>
    `;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, { status: 200 })));

    const out = await webSearch('q');

    expect(out).not.toContain('<script>');
    expect(out).not.toContain('<scr');
    expect(out).toContain('https://example.com');
  });
});
