import type { CrawlPage } from 'browserclaw';
import { logger } from '../logger.js';

export interface ExtractItemsResult {
  source: 'next-data' | 'apollo' | 'initial-state' | 'json-ld' | 'dom' | 'none';
  count: number;
  records: Record<string, unknown>[];
  truncated: boolean;
}

const MAX_RECORDS = 20;

const EXTRACTION_FN = `
(function() {
  const MAX = 20;
  const seen = new Set();

  function isItemLike(obj) {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const keys = Object.keys(obj);
    if (keys.length < 2) return false;
    const txt = keys.join(',').toLowerCase();
    const hints = ['price', 'rent', 'amount', 'address', 'street', 'location', 'bedroom', 'bed', 'url', 'link', 'href', 'title', 'name'];
    let hits = 0;
    for (const h of hints) if (txt.includes(h)) hits++;
    return hits >= 2;
  }

  function harvestFromJson(node, out, depth) {
    if (out.length >= MAX) return;
    if (depth > 10) return;
    if (Array.isArray(node)) {
      for (const item of node) harvestFromJson(item, out, depth + 1);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    if (isItemLike(node)) {
      const key = JSON.stringify(Object.keys(node).sort());
      if (!seen.has(key) || out.length < MAX) {
        out.push(node);
        seen.add(key);
      }
    }
    for (const v of Object.values(node)) harvestFromJson(v, out, depth + 1);
  }

  function tryNextData() {
    const el = document.getElementById('__NEXT_DATA__');
    if (!el || !el.textContent) return null;
    try {
      const data = JSON.parse(el.textContent);
      const out = [];
      harvestFromJson(data, out, 0);
      return out.length > 0 ? out : null;
    } catch (e) { return null; }
  }

  function tryGlobalState(name) {
    const v = window[name];
    if (!v || typeof v !== 'object') return null;
    const out = [];
    harvestFromJson(v, out, 0);
    return out.length > 0 ? out : null;
  }

  function tryJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const out = [];
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent || '');
        harvestFromJson(data, out, 0);
        if (out.length >= MAX) break;
      } catch (e) {}
    }
    return out.length > 0 ? out : null;
  }

  function tryDom() {
    const candidates = document.querySelectorAll('article, li, [class*="card" i], [class*="listing" i], [class*="item" i], [data-testid*="card" i], [data-testid*="listing" i]');
    const out = [];
    for (const el of candidates) {
      if (out.length >= MAX) break;
      const text = (el.innerText || '').trim();
      if (text.length < 20 || text.length > 800) continue;
      const link = el.querySelector('a[href]');
      const href = link ? link.href : null;
      if (!href) continue;
      const rec = { text: text.slice(0, 400), url: href };
      const priceMatch = text.match(/\\$[\\d,]+(?:\\/(?:mo|month))?/i);
      if (priceMatch) rec.price = priceMatch[0];
      const bedMatch = text.match(/(\\d+)\\s*(?:bed|br|bedroom)/i);
      if (bedMatch) rec.bedrooms = bedMatch[1];
      const studioMatch = /\\bstudio\\b/i.test(text);
      if (studioMatch && !rec.bedrooms) rec.bedrooms = 'studio';
      out.push(rec);
    }
    return out.length > 0 ? out : null;
  }

  const results = tryNextData();
  if (results) return { source: 'next-data', records: results.slice(0, MAX) };

  const apollo = tryGlobalState('__APOLLO_STATE__');
  if (apollo) return { source: 'apollo', records: apollo.slice(0, MAX) };

  const initial = tryGlobalState('__INITIAL_STATE__');
  if (initial) return { source: 'initial-state', records: initial.slice(0, MAX) };

  const ld = tryJsonLd();
  if (ld) return { source: 'json-ld', records: ld.slice(0, MAX) };

  const dom = tryDom();
  if (dom) return { source: 'dom', records: dom.slice(0, MAX) };

  return { source: 'none', records: [] };
})()
`;

export async function extractItems(page: CrawlPage): Promise<ExtractItemsResult> {
  try {
    const raw = await page.evaluate(EXTRACTION_FN);
    if (raw === null || typeof raw !== 'object') {
      return { source: 'none', count: 0, records: [], truncated: false };
    }
    const result = raw as { source: string; records: unknown };
    const records = Array.isArray(result.records) ? (result.records as Record<string, unknown>[]) : [];
    const source = (result.source as ExtractItemsResult['source']) ?? 'none';
    logger.info({ source, count: records.length }, 'extract-items');
    return {
      source,
      count: records.length,
      records: records.slice(0, MAX_RECORDS),
      truncated: records.length > MAX_RECORDS,
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'extract-items failed');
    return { source: 'none', count: 0, records: [], truncated: false };
  }
}
