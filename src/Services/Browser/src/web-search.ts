import { logger } from './logger.js';

const SEARCH_URL = 'https://html.duckduckgo.com/html/';
const MAX_RESULTS = 10;
const FETCH_TIMEOUT_MS = 8000;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function stripHtml(raw: string): string {
  const TAG_RE = /<[^>]+>/g;
  let text = raw;
  let prev: string;
  do {
    prev = text;
    text = text.replace(TAG_RE, '');
  } while (text !== prev);
  return text.trim();
}

function parseResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const linkRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gs;
  const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>(.*?)<\/a>/gs;

  const links = [...html.matchAll(linkRegex)];
  const snippets = [...html.matchAll(snippetRegex)];

  for (let i = 0; i < Math.min(links.length, MAX_RESULTS); i++) {
    const link = links[i];
    const rawUrl = link[1];
    const title = stripHtml(link[2]);
    const snippet = stripHtml(snippets[i]?.[1] ?? '');

    let url = rawUrl;
    const uddg = /[?&]uddg=([^&]+)/.exec(rawUrl);
    if (uddg?.[1] !== undefined) {
      url = decodeURIComponent(uddg[1]);
    }

    if (title !== '' && url !== '') {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

function formatResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.';
  return results.map((r, i) => `${String(i + 1)}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n\n');
}

export async function webSearch(query: string): Promise<string> {
  try {
    const params = new URLSearchParams({ q: query });
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    const res = await fetch(`${SEARCH_URL}?${params.toString()}`, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; browserclaw/1.0)',
        Accept: 'text/html',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return `Search failed: HTTP ${String(res.status)}`;
    }

    const html = await res.text();
    const results = parseResults(html);
    logger.info({ query, resultCount: results.length }, 'Web search');
    return formatResults(results);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    logger.warn({ query, err: msg }, 'Web search failed');
    return `Search failed: ${msg}`;
  }
}
