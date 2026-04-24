import type { CrawlPage } from 'browserclaw';
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';
import { llmVision } from '../llm.js';

export type AntiBotType = 'press_and_hold' | 'cloudflare_checkbox' | null;

const PRESS_HOLD_PATTERN = /press.*hold|hold.*to.*confirm/i;
const CLOUDFLARE_PATTERN = /performing security verification|cloudflare|verify you are human|just a moment/i;
const ANTI_BOT_PATTERN = /press.*hold|verify.*human|not a bot|captcha/i;

const BLOCKED_PATTERNS: Record<'press_and_hold' | 'cloudflare_checkbox', RegExp> = {
  press_and_hold: /press.*hold|verify.*human|not a bot|access.*denied/i,
  cloudflare_checkbox: /performing security verification|verify you are human|just a moment/i,
};

function humanHoldMs(): number {
  return 4000 + Math.floor(Math.random() * 6000); // 4-10 seconds
}

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

  if (result === null || result === undefined || result === '') return null;

  interface ButtonCandidate {
    text: string;
    width: number;
    height: number;
    x: number;
    y: number;
    tag: string;
    source: string;
  }
  interface ButtonSearchResult {
    found: boolean;
    best: ButtonCandidate | null;
    candidates: ButtonCandidate[];
  }
  const parsed = JSON.parse(result as string) as ButtonSearchResult;
  logger.info(
    {
      found: parsed.found,
      candidateCount: parsed.candidates.length,
      candidates: parsed.candidates.map((c) => ({ text: c.text, w: c.width, h: c.height, tag: c.tag })),
    },
    'press-and-hold: button search',
  );

  if (!parsed.found || parsed.best === null) return null;
  return { x: parsed.best.x, y: parsed.best.y };
}

export async function getPageText(page: CrawlPage): Promise<string> {
  return (await page.evaluate(`
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
  `)) as string;
}

export async function isStillBlocked(page: CrawlPage, type: AntiBotType): Promise<boolean> {
  if (type === null) return false;
  const pattern = BLOCKED_PATTERNS[type];
  const result = await page.evaluate(
    `!!(document.body && document.body.innerText && document.body.innerText.match(${String(pattern)}))`,
  );
  return result === true;
}

const CHALLENGE_CLEAR_MAX_MS = 10_000;
const CHALLENGE_CLEAR_POLL_MS = 500;

async function waitForChallengeCleared(page: CrawlPage, type: AntiBotType): Promise<boolean> {
  const deadline = Date.now() + CHALLENGE_CLEAR_MAX_MS;
  while (Date.now() < deadline) {
    if (!(await isStillBlocked(page, type))) return true;
    await page.waitFor({ timeMs: CHALLENGE_CLEAR_POLL_MS });
  }
  return false;
}

const SCREENSHOT_DIR = '/tmp/bca-screenshots';

type PaHVisualState = 'ready' | 'loading' | 'error' | 'unknown';

async function classifyPaHVisualState(page: CrawlPage): Promise<PaHVisualState> {
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const buf = await page.screenshot();
    const filename = `paH-state-${String(Date.now())}.png`;
    const filepath = path.join(SCREENSHOT_DIR, filename);
    fs.writeFileSync(filepath, buf);
    const answer = await llmVision(
      'You see a page showing a press-and-hold bot-verification challenge. Reply with exactly one word: "ready" (the press button is blue/fully visible/clickable), "loading" (the button is gray/empty/still initializing), "error" (the page shows an error, denial, or retry message), or "unknown".',
      'What state is the press-and-hold button in?',
      buf.toString('base64'),
    );
    const label = answer.trim().toLowerCase();
    const state: PaHVisualState = label.startsWith('ready')
      ? 'ready'
      : label.startsWith('loading')
        ? 'loading'
        : label.startsWith('error')
          ? 'error'
          : 'unknown';
    logger.info({ screenshot: filepath, state, raw: label.slice(0, 40) }, 'press-and-hold: visual state');
    return state;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, 'press-and-hold: visual state failed');
    return 'unknown';
  }
}

export function detectAntiBot(domText: string): AntiBotType {
  // Check press-and-hold first — if DOM mentions press/hold, it's a press-and-hold challenge
  // regardless of what the snapshot says
  if (PRESS_HOLD_PATTERN.test(domText)) {
    logger.info({ domTextPreview: domText.substring(0, 600) }, 'Anti-bot detected: press-and-hold');
    return 'press_and_hold';
  }
  // Cloudflare-specific patterns (no press-and-hold in DOM text, already checked above)
  if (CLOUDFLARE_PATTERN.test(domText)) {
    logger.info({ domTextPreview: domText.substring(0, 600) }, 'Anti-bot detected: cloudflare checkbox');
    return 'cloudflare_checkbox';
  }
  // Generic anti-bot (verify human, captcha, not a bot) — treat as cloudflare-style checkbox
  if (ANTI_BOT_PATTERN.test(domText)) {
    logger.info({ domTextPreview: domText.substring(0, 600) }, 'Anti-bot detected: generic');
    return 'cloudflare_checkbox';
  }
  return null;
}

export function enrichSnapshot(snapshot: string, domText: string, type: AntiBotType): string {
  if (type === 'press_and_hold') {
    return (
      snapshot +
      `\n\n[ANTI-BOT OVERLAY DETECTED] The page has a press-and-hold verification overlay. The page text says: "${domText.substring(0, 200)}". Use press_and_hold to solve it.`
    );
  }
  if (type === 'cloudflare_checkbox') {
    return (
      snapshot +
      `\n\n[SECURITY VERIFICATION] The page has a Cloudflare or similar security check with a "Verify you are human" checkbox. Use click_cloudflare to solve it. If it fails after 2 attempts, use ask_user. Do NOT use press_and_hold.`
    );
  }
  return snapshot;
}

async function buttonIsInteractive(page: CrawlPage, x: number, y: number): Promise<boolean> {
  const result = await page.evaluate(
    `(function() {
      var el = document.elementFromPoint(${String(x)}, ${String(y)});
      if (!el) return false;
      if (el.tagName === 'HTML' || el.tagName === 'BODY') return false;
      var style = window.getComputedStyle(el);
      if (style.pointerEvents === 'none') return false;
      if (el.disabled === true) return false;
      var text = (el.innerText || '').trim().toLowerCase();
      if (/press|hold/.test(text)) return true;
      var bg = style.backgroundColor || '';
      var m = bg.match(/rgba?\\\((\\\d+),\\\s*(\\\d+),\\\s*(\\\d+)/);
      if (m) {
        var r = parseInt(m[1], 10), g = parseInt(m[2], 10), b = parseInt(m[3], 10);
        var isNeutralGray = Math.abs(r - g) < 15 && Math.abs(g - b) < 15 && r > 180 && r < 245;
        if (isNeutralGray) return false;
      }
      return true;
    })()`,
  );
  return result === true;
}

const BUTTON_READY_MAX_MS = 5_000;
const BUTTON_READY_POLL_MS = 500;

async function waitForButtonReady(page: CrawlPage, x: number, y: number): Promise<boolean> {
  const deadline = Date.now() + BUTTON_READY_MAX_MS;
  while (Date.now() < deadline) {
    if (await buttonIsInteractive(page, x, y)) return true;
    await page.waitFor({ timeMs: BUTTON_READY_POLL_MS });
  }
  return false;
}

export async function pressAndHold(page: CrawlPage, opts?: { holdMs?: number }): Promise<boolean> {
  try {
    logger.info('press-and-hold: starting');
    await page.reload();
    try {
      await page.waitFor({ loadState: 'networkidle' });
    } catch (err) {
      logger.info(
        { err: err instanceof Error ? err.message : err },
        'press-and-hold: network did not idle — proceeding anyway',
      );
    }

    const coords = await findButtonCoordinates(page);
    if (!coords) {
      logger.info('press-and-hold: no suitable button found');
      return false;
    }
    await waitForButtonReady(page, coords.x, coords.y);
    const { x, y } = coords;
    logger.info({ x, y }, 'press-and-hold: found button');

    const jitterX = x + Math.floor(Math.random() * 20) - 10;
    const jitterY = y + Math.floor(Math.random() * 10) - 5;
    const holdMs = opts?.holdMs ?? humanHoldMs();
    const delay = 100 + Math.floor(Math.random() * 200);
    logger.info({ x: jitterX, y: jitterY, holdMs, delay }, 'press-and-hold: pressing');
    await page.pressAndHold(jitterX, jitterY, { delay, holdMs });
    logger.info({ holdMs }, 'press-and-hold: released');

    const cleared = await waitForChallengeCleared(page, 'press_and_hold');
    logger.info({ cleared }, 'press-and-hold: resolved');
    if (!cleared) await classifyPaHVisualState(page);
    return cleared;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : err }, 'press-and-hold: failed');
    return false;
  }
}
