import type { CrawlPage } from 'browserclaw';
import { openCdpConnection } from './cdp-utils.js';
import { logger } from '../logger.js';

const PRESS_HOLD_PATTERN = /press.*hold|hold.*to.*confirm/i;
const CLOUDFLARE_PATTERN = /performing security verification|cloudflare|verify you are human|just a moment/i;
const ANTI_BOT_PATTERN = /press.*hold|verify.*human|not a bot|captcha/i;
function humanHoldMs(): number {
  return 4000 + Math.floor(Math.random() * 6000); // 4-10 seconds
}
const MAX_WAIT_MS = 15_000;
const POLL_INTERVAL_MS = 1_000;

async function findButtonCoordinates(page: CrawlPage): Promise<{ x: number; y: number } | null> {
  const result = await page.evaluate(`
    (function() {
      var PATTERN = /press.*hold|verify.*human|hold.*to.*confirm|not a bot/i;
      var BUTTON_Y_OFFSET = 60;

      function toCandidate(el, source, offsetX, offsetY) {
        var rect = el.getBoundingClientRect();
        return {
          text: (el.innerText || '').trim().substring(0, 80),
          width: rect.width,
          height: rect.height,
          x: Math.round(rect.left + rect.width / 2 + offsetX),
          y: Math.round(rect.bottom + BUTTON_Y_OFFSET + offsetY),
          tag: el.tagName,
          source: source
        };
      }

      function matchingElements(root, source, offsetX, offsetY) {
        var results = [];
        var all = root.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          if (PATTERN.test((el.innerText || '').trim())) {
            results.push(toCandidate(el, source, offsetX, offsetY));
          }
          if (el.shadowRoot) {
            var shadowAll = el.shadowRoot.querySelectorAll('*');
            for (var s = 0; s < shadowAll.length; s++) {
              if (PATTERN.test((shadowAll[s].innerText || '').trim())) {
                results.push(toCandidate(shadowAll[s], 'shadow', offsetX, offsetY));
              }
            }
          }
        }
        return results;
      }

      function searchIframes() {
        var results = [];
        var iframes = document.querySelectorAll('iframe');
        for (var i = 0; i < iframes.length; i++) {
          try {
            var doc = iframes[i].contentDocument;
            if (doc && doc.body) {
              var rect = iframes[i].getBoundingClientRect();
              results = results.concat(matchingElements(doc, 'iframe', rect.left, rect.top));
            }
          } catch(e) {}
        }
        return results;
      }

      function pickBest(candidates) {
        var best = null;
        for (var i = 0; i < candidates.length; i++) {
          var c = candidates[i];
          if (c.width > 100 && c.height > 20 && c.height < 80) {
            if (!best || c.height < best.height) best = c;
          }
        }
        return best;
      }

      var candidates = matchingElements(document, 'dom', 0, 0).concat(searchIframes());
      var best = pickBest(candidates);
      return JSON.stringify({ found: !!best, best: best, candidates: candidates });
    })()
  `);

  if (!result) return null;

  const parsed = JSON.parse(result as string);
  logger.info({ found: parsed.found, candidateCount: parsed.candidates?.length, candidates: parsed.candidates?.map((c: { text: string; width: number; height: number; tag: string }) => ({ text: c.text, w: c.width, h: c.height, tag: c.tag })) }, 'press-and-hold: button search');

  if (!parsed.found || !parsed.best) return null;
  return { x: parsed.best.x, y: parsed.best.y };
}

export async function getPageText(page: CrawlPage): Promise<string> {
  return await page.evaluate(`
    (function() {
      var text = document.body.innerText || '';
      var iframes = document.querySelectorAll('iframe');
      for (var i = 0; i < iframes.length; i++) {
        try {
          if (iframes[i].contentDocument && iframes[i].contentDocument.body) {
            text += ' ' + iframes[i].contentDocument.body.innerText;
          }
        } catch(e) {}
      }
      return text;
    })()
  `) as string;
}

export type AntiBotType = 'press_and_hold' | 'cloudflare_checkbox' | null;

export function detectAntiBot(domText: string, snapshot: string): AntiBotType {
  if (PRESS_HOLD_PATTERN.test(domText) && !/press.*hold/i.test(snapshot)) {
    logger.info({ domTextPreview: domText.substring(0, 150) }, 'Anti-bot detected: press-and-hold');
    return 'press_and_hold';
  }
  if (CLOUDFLARE_PATTERN.test(domText) && !/press.*hold/i.test(domText)) {
    logger.info({ domTextPreview: domText.substring(0, 150) }, 'Anti-bot detected: cloudflare checkbox');
    return 'cloudflare_checkbox';
  }
  if (ANTI_BOT_PATTERN.test(domText) && !/press.*hold/i.test(snapshot)) {
    logger.info({ domTextPreview: domText.substring(0, 150) }, 'Anti-bot detected: generic');
    return 'cloudflare_checkbox';
  }
  return null;
}

export function enrichSnapshot(snapshot: string, domText: string, type: AntiBotType): string {
  if (type === 'press_and_hold') {
    return snapshot + `\n\n[ANTI-BOT OVERLAY DETECTED] The page has a press-and-hold verification overlay. The page text says: "${domText.substring(0, 200)}". Use press_and_hold to solve it.`;
  }
  if (type === 'cloudflare_checkbox') {
    return snapshot + `\n\n[SECURITY VERIFICATION] The page has a Cloudflare or similar security check with a "Verify you are human" checkbox. Use click_cloudflare to solve it. If it fails after 2 attempts, use ask_user. Do NOT use press_and_hold.`;
  }
  return snapshot;
}

export async function pressAndHold(page: CrawlPage): Promise<boolean> {
  try {
    logger.info('press-and-hold: starting');

    const coords = await findButtonCoordinates(page);
    if (!coords) {
      logger.info('press-and-hold: no suitable button found');
      return false;
    }
    const { x, y } = coords;
    logger.info({ x, y }, 'press-and-hold: found button, opening CDP');

    const urlBefore = await page.url();
    const cdp = await openCdpConnection(page);
    logger.info('press-and-hold: CDP connected');
    try {

      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
      await new Promise(r => setTimeout(r, 100 + Math.floor(Math.random() * 200)));
      const jitterX = x + Math.floor(Math.random() * 20) - 10;
      const jitterY = y + Math.floor(Math.random() * 10) - 5;
      const holdMs = humanHoldMs();
      logger.info({ x: jitterX, y: jitterY, holdMs }, 'press-and-hold: mousePressed');
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: jitterX, y: jitterY, button: 'left', clickCount: 1 });
      await new Promise(r => setTimeout(r, holdMs));
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: jitterX, y: jitterY, button: 'left', clickCount: 1 });
      logger.info('press-and-hold: released after 10s');
    } finally {
      cdp.close();
    }
    await page.waitFor({ timeMs: 2000 });

    const stillBlocked = await page.evaluate(`!!(document.body && document.body.innerText && document.body.innerText.match(/press.*hold|verify.*human|not a bot|access.*denied/i))`);
    if (stillBlocked) {
      logger.info('press-and-hold: still blocked, refreshing page');
      await page.goto(urlBefore);
      await page.waitFor({ timeMs: 3000 });
      const blockedAfterRefresh = await page.evaluate(`!!(document.body && document.body.innerText && document.body.innerText.match(/press.*hold|verify.*human|not a bot|access.*denied/i))`);
      logger.info({ blockedAfterRefresh }, 'press-and-hold: result after refresh');
      return !blockedAfterRefresh;
    }
    logger.info('press-and-hold: resolved');
    return true;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, 'press-and-hold: failed');
    return false;
  }
}
