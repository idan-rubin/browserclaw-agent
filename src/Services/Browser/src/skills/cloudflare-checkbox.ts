import type { CrawlPage } from 'browserclaw';
import { getCdpBaseUrl, openCdpConnection, cdpClick } from './cdp-utils.js';
import { isStillBlocked } from './press-and-hold.js';
import { logger } from '../logger.js';

const MAX_WAIT_MS = 15_000;
const POLL_INTERVAL_MS = 1_000;

async function findCloudflareTarget(page: CrawlPage): Promise<string | null> {
  const baseUrl = getCdpBaseUrl(page);
  const res = await fetch(baseUrl + '/json');
  const targets = (await res.json()) as { id: string; url: string; type: string }[];

  const cfTarget = targets.find((t) => {
    if (t.type !== 'iframe') return false;
    try {
      const host = new URL(t.url).hostname;
      return host === 'challenges.cloudflare.com' || host.endsWith('.cloudflare.com') || t.url.includes('turnstile');
    } catch {
      return false;
    }
  });

  if (cfTarget) {
    logger.info(
      { targetId: cfTarget.id, url: cfTarget.url.substring(0, 100) },
      'cloudflare: found turnstile target via CDP',
    );
    return cfTarget.id;
  }

  logger.info({ targetCount: targets.length }, 'cloudflare: no turnstile target in CDP');
  return null;
}

async function getCheckboxPosition(page: CrawlPage): Promise<{ x: number; y: number } | null> {
  // The Cloudflare iframe isn't visible via document.querySelectorAll('iframe')
  // but its container div IS in the DOM. Find it by looking for the Turnstile widget wrapper.
  const result = (await page.evaluate(`
    (function() {
      // Turnstile renders inside a div with specific attributes
      var candidates = document.querySelectorAll('div[id^="cf-"], div[class*="cf-turnstile"], div[data-sitekey]');
      for (var i = 0; i < candidates.length; i++) {
        var rect = candidates[i].getBoundingClientRect();
        if (rect.width > 20 && rect.height > 20) {
          return JSON.stringify({ source: 'turnstile-div', x: Math.round(rect.left + 25), y: Math.round(rect.top + rect.height / 2), w: Math.round(rect.width), h: Math.round(rect.height) });
        }
      }

      // Look for any element containing the checkbox visually — check all divs near "not a bot" text
      var pattern = /not a bot|verify you are human/i;
      var all = document.querySelectorAll('p, span, div');
      for (var j = 0; j < all.length; j++) {
        var t = (all[j].textContent || '').trim();
        if (pattern.test(t) && t.length < 200) {
          var el = all[j];
          var rect = el.getBoundingClientRect();
          if (rect.width > 50 && rect.height > 10 && rect.height < 80) {
            // The checkbox is typically right below or at the same level
            var sibling = el.nextElementSibling;
            while (sibling) {
              var sRect = sibling.getBoundingClientRect();
              if (sRect.width > 20 && sRect.height > 20 && sRect.height < 100) {
                return JSON.stringify({ source: 'sibling', tag: sibling.tagName, x: Math.round(sRect.left + 25), y: Math.round(sRect.top + sRect.height / 2), w: Math.round(sRect.width), h: Math.round(sRect.height) });
              }
              sibling = sibling.nextElementSibling;
            }
          }
        }
      }

      return null;
    })()
  `)) as string | null;

  if (result === null) return null;
  const parsed = JSON.parse(result) as { x: number; y: number };
  logger.info(parsed, 'cloudflare: found checkbox position');
  return { x: parsed.x, y: parsed.y };
}

export async function clickCloudflareCheckbox(page: CrawlPage): Promise<boolean> {
  try {
    logger.info('cloudflare: starting');

    // First verify the Cloudflare target exists via CDP
    const targetId = await findCloudflareTarget(page);
    if (targetId === null) {
      logger.info('cloudflare: no Cloudflare target found');
      return false;
    }

    // Find the checkbox position
    const coords = await getCheckboxPosition(page);
    if (!coords) {
      logger.info('cloudflare: could not determine checkbox position');
      return false;
    }

    logger.info({ x: coords.x, y: coords.y }, 'cloudflare: clicking via CDP');
    const cdp = await openCdpConnection(page);
    try {
      await cdpClick(cdp, coords.x, coords.y, { delay: 200 });
      logger.info('cloudflare: clicked');
    } finally {
      cdp.close();
    }

    const start = Date.now();
    while (Date.now() - start < MAX_WAIT_MS) {
      await page.waitFor({ timeMs: POLL_INTERVAL_MS });
      const stillBlocked = await isStillBlocked(page, 'cloudflare_checkbox');
      if (!stillBlocked) {
        logger.info('cloudflare: verification passed');
        return true;
      }
    }

    logger.info('cloudflare: still blocked after waiting');
    return false;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, 'cloudflare: failed');
    return false;
  }
}
