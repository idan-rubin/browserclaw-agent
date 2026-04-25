import type { BrowserClaw, CrawlPage } from 'browserclaw';
import { logger } from '../logger.js';

export interface ExtractItemsResult {
  source: 'next-data' | 'apollo' | 'initial-state' | 'json-ld' | 'dom' | 'none';
  count: number;
  records: Record<string, unknown>[];
  truncated: boolean;
}

const MAX_RECORDS = 50;

const EXTRACTION_FN = `
(function() {
  const MAX = 50;
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

  function identityFor(node) {
    if (node && typeof node === 'object') {
      if (typeof node.url === 'string' && node.url) return 'u:' + node.url;
      if (typeof node.href === 'string' && node.href) return 'u:' + node.href;
      if (typeof node.link === 'string' && node.link) return 'u:' + node.link;
      if (typeof node.id === 'string' && node.id) return 'i:' + node.id;
      if ((typeof node['@id'] === 'string') && node['@id']) return 'i:' + node['@id'];
    }
    try {
      return 'j:' + JSON.stringify(node).slice(0, 300);
    } catch (e) {
      return null;
    }
  }

  function findHomogeneousItemArray(root) {
    var best = null;
    var bestScore = 0;
    function visit(n, d) {
      if (d > 12) return;
      if (Array.isArray(n)) {
        if (n.length >= 3) {
          var items = [];
          for (var i = 0; i < n.length; i++) {
            if (isItemLike(n[i])) items.push(n[i]);
          }
          var ratio = items.length / n.length;
          if (items.length >= 3 && ratio >= 0.6 && items.length > bestScore) {
            bestScore = items.length;
            best = items;
          }
        }
        for (var j = 0; j < n.length; j++) visit(n[j], d + 1);
        return;
      }
      if (n && typeof n === 'object') {
        for (var k in n) {
          if (Object.prototype.hasOwnProperty.call(n, k)) visit(n[k], d + 1);
        }
      }
    }
    visit(root, 0);
    return best;
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
      var id = identityFor(node);
      if (id !== null && !seen.has(id)) {
        out.push(node);
        seen.add(id);
      }
    }
    for (const v of Object.values(node)) harvestFromJson(v, out, depth + 1);
  }

  function tryNextData() {
    const el = document.getElementById('__NEXT_DATA__');
    if (!el || !el.textContent) return null;
    try {
      const data = JSON.parse(el.textContent);
      const arr = findHomogeneousItemArray(data);
      if (arr && arr.length > 0) return arr.slice(0, MAX);
      const out = [];
      harvestFromJson(data, out, 0);
      return out.length > 0 ? out : null;
    } catch (e) { return null; }
  }

  function tryGlobalState(name) {
    const v = window[name];
    if (!v || typeof v !== 'object') return null;
    const arr = findHomogeneousItemArray(v);
    if (arr && arr.length > 0) return arr.slice(0, MAX);
    const out = [];
    harvestFromJson(v, out, 0);
    return out.length > 0 ? out : null;
  }

  function flattenItemListItem(node) {
    if (!node || typeof node !== 'object') return null;
    var rec = {};
    if (node.name) rec.name = String(node.name);
    if (node.url) rec.url = String(node.url);
    if (node.description) rec.description = String(node.description);
    if (node.image) rec.image = typeof node.image === 'string' ? node.image : (node.image && node.image.url) ? String(node.image.url) : undefined;
    // schema.org RealEstateListing / ApartmentComplex nest address under about or directly
    var addrSrc = node.address || (node.about && node.about.address) || null;
    if (addrSrc && typeof addrSrc === 'object') {
      var parts = [];
      if (addrSrc.streetAddress) parts.push(String(addrSrc.streetAddress));
      if (addrSrc.addressLocality) parts.push(String(addrSrc.addressLocality));
      if (addrSrc.addressRegion) parts.push(String(addrSrc.addressRegion));
      if (addrSrc.postalCode) parts.push(String(addrSrc.postalCode));
      if (parts.length > 0) rec.address = parts.join(', ');
    }
    // Price: offers can be AggregateOffer or array of Offer
    var offers = node.offers || (node.about && node.about.offers) || null;
    if (offers) {
      var offerArr = Array.isArray(offers) ? offers : [offers];
      var prices = [];
      for (var i = 0; i < offerArr.length; i++) {
        var o = offerArr[i];
        if (!o) continue;
        if (o.price) prices.push(String(o.price));
        else if (o.lowPrice) prices.push(String(o.lowPrice));
        else if (o.priceSpecification && o.priceSpecification.price) prices.push(String(o.priceSpecification.price));
      }
      if (prices.length > 0) rec.price = prices.join(' - ');
    }
    return Object.keys(rec).length >= 2 ? rec : null;
  }

  function collectItemListElements(node, out, depth) {
    if (out.length >= MAX) return;
    if (depth > 10) return;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) collectItemListElements(node[i], out, depth + 1);
      return;
    }
    if (!node || typeof node !== 'object') return;
    var type = node['@type'];
    var types = Array.isArray(type) ? type : (type ? [type] : []);
    if (types.indexOf('ItemList') !== -1 && Array.isArray(node.itemListElement)) {
      for (var j = 0; j < node.itemListElement.length && out.length < MAX; j++) {
        var el = node.itemListElement[j];
        var item = el && el.item ? el.item : el;
        var flat = flattenItemListItem(item);
        if (flat) out.push(flat);
      }
    }
    for (var k in node) {
      if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
      if (k === 'itemListElement') continue;
      collectItemListElements(node[k], out, depth + 1);
    }
  }

  function tryJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    // First pass: ItemList.itemListElement — the schema.org standard for list pages.
    const listItems = [];
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent || '');
        collectItemListElements(data, listItems, 0);
        if (listItems.length >= MAX) break;
      } catch (e) {}
    }
    if (listItems.length > 0) return listItems;
    // Second pass: homogeneous array anywhere inside any JSON-LD script.
    for (const s of scripts) {
      try {
        const data = JSON.parse(s.textContent || '');
        const arr = findHomogeneousItemArray(data);
        if (arr && arr.length > 0) return arr.slice(0, MAX);
      } catch (e) {}
    }
    // Fallback: heuristic harvest from any JSON-LD.
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
    const candidates = document.querySelectorAll('article, li, section, [role="listitem"], [role="article"], [class*="card" i], [class*="listing" i], [class*="item" i], [class*="result" i], [class*="search" i][class*="card" i], [data-testid*="card" i], [data-testid*="listing" i], [data-qa*="card" i], [data-qa*="listing" i], [data-qa*="result" i]');
    const valid = [];
    for (const el of candidates) {
      const text = (el.innerText || '').trim();
      if (text.length < 15 || text.length > 1500) continue;
      const link = el.querySelector('a[href]');
      const href = link ? link.href : null;
      if (!href) continue;
      valid.push({ el: el, text: text, href: href });
    }
    if (valid.length === 0) return null;

    var byParent = new Map();
    for (var i = 0; i < valid.length; i++) {
      var parent = valid[i].el.parentElement;
      if (!parent) continue;
      var arr = byParent.get(parent) || [];
      arr.push(valid[i]);
      byParent.set(parent, arr);
    }
    var bestGroup = null;
    var bestSize = 0;
    byParent.forEach(function (arr) {
      if (arr.length > bestSize) { bestGroup = arr; bestSize = arr.length; }
    });
    var group = bestSize >= 3 ? bestGroup : valid;

    const seenUrls = new Set();
    const out = [];
    for (var j = 0; j < group.length && out.length < MAX; j++) {
      var item = group[j];
      if (seenUrls.has(item.href)) continue;
      seenUrls.add(item.href);
      out.push({ text: item.text.slice(0, 600), url: item.href });
    }
    return out.length > 0 ? out : null;
  }

  function mergeWithDom(source, records) {
    var dom = tryDom();
    if (!dom || dom.length === 0) return { source: source, records: records.slice(0, MAX) };
    // DOM records first — they carry per-item URLs and visible text. Structured-state
    // records often hold page-level aggregate metadata (Organization, WebPage) that
    // masquerades as items under the loose isItemLike heuristic; DOM cards are the
    // reliable per-item source on list/results pages.
    var combined = dom.concat(records).slice(0, MAX);
    return { source: source, records: combined };
  }

  var nd = tryNextData();
  if (nd) return mergeWithDom('next-data', nd);

  var apollo = tryGlobalState('__APOLLO_STATE__');
  if (apollo) return mergeWithDom('apollo', apollo);

  var initial = tryGlobalState('__INITIAL_STATE__');
  if (initial) return mergeWithDom('initial-state', initial);

  var ld = tryJsonLd();
  if (ld) return mergeWithDom('json-ld', ld);

  var dom = tryDom();
  if (dom) return { source: 'dom', records: dom.slice(0, MAX) };

  return { source: 'none', records: [] };
})()
`;

const RENDER_WAIT_FN = `
(async function() {
  const start = Date.now();
  const cardSelector = '[role="listitem"], [class*="card" i], [class*="listing" i], [class*="result" i], [data-testid*="card" i], [data-testid*="listing" i], [data-testid*="result" i], [data-qa*="card" i], [data-qa*="listing" i], [data-qa*="result" i]';
  const ldSelector = 'script[type="application/ld+json"]';
  while (Date.now() - start < 8000) {
    const cards = document.querySelectorAll(cardSelector).length;
    const ld = document.querySelectorAll(ldSelector).length;
    if (cards >= 3 || ld > 0) return { cards: cards, ld: ld, ms: Date.now() - start };
    await new Promise(function(r) { setTimeout(r, 250); });
  }
  return { cards: document.querySelectorAll(cardSelector).length, ld: document.querySelectorAll(ldSelector).length, ms: Date.now() - start, timedOut: true };
})()
`;

const LAZY_LOAD_TRIGGER_FN = `
(async function() {
  const start = Date.now();
  const step = Math.max(400, window.innerHeight);
  let pos = 0;
  let lastHeight = 0;
  while (Date.now() - start < 5000) {
    pos += step;
    window.scrollTo(0, pos);
    await new Promise(function(r) { setTimeout(r, 400); });
    const h = document.body.scrollHeight;
    if (pos >= h && h === lastHeight) break;
    lastHeight = h;
  }
  window.scrollTo(0, 0);
  await new Promise(function(r) { setTimeout(r, 300); });
})()
`;

export async function extractItems(page: CrawlPage): Promise<ExtractItemsResult> {
  try {
    try {
      const renderInfo = await page.evaluate(RENDER_WAIT_FN);
      logger.info({ renderInfo }, 'extract-items: render wait');
    } catch (renderErr) {
      logger.warn(
        { err: renderErr instanceof Error ? renderErr.message : renderErr },
        'extract-items: render wait failed',
      );
    }
    try {
      await page.evaluate(LAZY_LOAD_TRIGGER_FN);
    } catch (scrollErr) {
      logger.warn(
        { err: scrollErr instanceof Error ? scrollErr.message : scrollErr },
        'extract-items: lazy-load trigger failed',
      );
    }
    const raw = await page.evaluate(EXTRACTION_FN);
    if (raw === null || typeof raw !== 'object') {
      return { source: 'none', count: 0, records: [], truncated: false };
    }
    const result = raw as { source: string; records: unknown };
    const records = Array.isArray(result.records) ? (result.records as Record<string, unknown>[]) : [];
    const source = result.source as ExtractItemsResult['source'];
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

export interface ExtractItemsFromUrlsResult {
  count: number;
  records: Record<string, unknown>[];
  failedUrls: string[];
}

const DEFAULT_CONCURRENCY = 5;
const MAX_URLS = 10;

export async function extractItemsFromUrls(
  browser: BrowserClaw,
  urls: string[],
  opts?: { concurrency?: number },
): Promise<ExtractItemsFromUrlsResult> {
  const deduped = Array.from(new Set(urls.filter((u) => typeof u === 'string' && u !== ''))).slice(0, MAX_URLS);
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? DEFAULT_CONCURRENCY, deduped.length));
  const records: Record<string, unknown>[] = [];
  const failedUrls: string[] = [];
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < deduped.length) {
      const url = deduped[cursor++];
      const t0 = Date.now();
      let tabId: string | undefined;
      try {
        const tab = await browser.open(url);
        tabId = tab.id;
        await tab.waitFor({ timeMs: 500 });
        const result = await extractItems(tab);
        const recordsWithUrl = result.records.map((r) => ({ sourceUrl: url, ...r }));
        records.push(...recordsWithUrl);
        logger.info(
          { url, source: result.source, count: result.records.length, ms: Date.now() - t0 },
          'extract-items-url',
        );
      } catch (err) {
        logger.warn({ url, err: err instanceof Error ? err.message : err }, 'extract-items-url failed');
        failedUrls.push(url);
      } finally {
        if (tabId !== undefined) {
          await browser.close(tabId).catch(() => undefined);
        }
      }
    }
  };

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return {
    count: records.length,
    records,
    failedUrls,
  };
}
