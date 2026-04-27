import type { CrawlPage } from 'browserclaw';

export interface FillIframeFieldResult {
  filled: boolean;
  where?: string;
}

export async function fillIframeFieldByTokens(
  page: CrawlPage,
  tokens: string[],
  value: string,
): Promise<FillIframeFieldResult> {
  const normalized = tokens.map((t) => t.toLowerCase()).filter(Boolean);
  if (normalized.length === 0) return { filled: false };

  const script = `(function() {
    var keyTokens = ${JSON.stringify(normalized)};
    var value = ${JSON.stringify(value)};
    var inputs = Array.from(document.querySelectorAll('input, select'));
    for (var i = 0; i < inputs.length; i++) {
      var el = inputs[i];
      var attrSource = [
        el.name, el.id,
        el.getAttribute('autocomplete'),
        el.getAttribute('data-field'),
        el.getAttribute('aria-label'),
        el.getAttribute('placeholder'),
      ].filter(Boolean).join(' ').toLowerCase();
      var attrTokens = attrSource.split(/[^a-z0-9]+/).filter(Boolean);
      var matchAll = keyTokens.every(function(k) { return attrTokens.indexOf(k) !== -1; });
      if (!matchAll) continue;
      var proto = el instanceof window.HTMLSelectElement
        ? window.HTMLSelectElement.prototype
        : window.HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, 'value');
      if (setter && setter.set) { setter.set.call(el, value); }
      else { el.value = value; }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.name || el.id || '?';
    }
    return null;
  })()`;

  const results = await page.evaluateInAllFrames(script);
  for (const { result } of results) {
    if (typeof result === 'string') return { filled: true, where: result };
  }
  return { filled: false };
}
