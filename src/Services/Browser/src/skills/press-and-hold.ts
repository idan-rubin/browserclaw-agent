import type { CrawlPage } from 'browserclaw';
import { getCdpBaseUrl, getTargetId, activateCdpTarget } from './cdp-utils.js';

const ANTI_BOT_PATTERN = /press.*hold|verify.*human|not a bot|captcha/i;
const HOLD_DURATION_MS = 5_000;
const MAX_WAIT_MS = 15_000;
const POLL_INTERVAL_MS = 1_000;

async function findButtonCoordinates(page: CrawlPage): Promise<{ x: number; y: number } | null> {
  const coords = await page.evaluate(`
    (function() {
      var all = document.querySelectorAll('*');
      var textEl = null;
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var t = (el.innerText || '').trim();
        if (t.match(/press.*hold|verify.*human|hold.*to.*confirm|not a bot/i)) {
          var rect = el.getBoundingClientRect();
          if (rect.width > 100 && rect.height > 20 && rect.height < 80) {
            if (!textEl || rect.height < textEl.h) {
              textEl = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.bottom + 60), h: rect.height };
            }
          }
        }
      }
      if (textEl) return JSON.stringify(textEl);
      return null;
    })()
  `);

  if (!coords) return null;
  return JSON.parse(coords as string);
}

async function openCdpConnection(page: CrawlPage) {
  const baseUrl = getCdpBaseUrl(page);
  const targetId = getTargetId(page);

  const res = await fetch(baseUrl + '/json');
  const targets = await res.json() as { id: string; webSocketDebuggerUrl: string }[];
  const target = targets.find(t => t.id === targetId);
  if (!target) throw new Error('CDP target not found');

  await activateCdpTarget(baseUrl, targetId);

  const ws = await import('ws');
  const socket = new ws.default(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.on('open', resolve);
    socket.on('error', reject);
  });

  let msgId = 0;
  const send = (method: string, params: Record<string, unknown>) => new Promise<void>((resolve) => {
    const id = ++msgId;
    const onMsg = (data: Buffer) => {
      if (JSON.parse(data.toString()).id === id) {
        socket.off('message', onMsg);
        resolve();
      }
    };
    socket.on('message', onMsg);
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => { socket.off('message', onMsg); resolve(); }, 3000);
  });

  return { send, close: () => socket.close() };
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

export function detectAntiBot(domText: string, snapshot: string): boolean {
  return ANTI_BOT_PATTERN.test(domText) && !/press.*hold/i.test(snapshot);
}

export function enrichSnapshot(snapshot: string, domText: string): string {
  return snapshot + `\n\n[ANTI-BOT OVERLAY DETECTED] The page has an anti-bot verification overlay not visible in the accessibility snapshot. The page text says: "${domText.substring(0, 200)}". Use press_and_hold to solve it.`;
}

export async function pressAndHold(page: CrawlPage): Promise<boolean> {
  try {
    const coords = await findButtonCoordinates(page);
    if (!coords) {
      console.log('press-and-hold: no button found in DOM');
      return false;
    }
    const { x, y } = coords;
    console.log(`press-and-hold: CDP mousePressed at (${x}, ${y})`);

    const cdp = await openCdpConnection(page);
    const urlBefore = await page.url();

    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await new Promise(r => setTimeout(r, 100));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });

    await new Promise(r => setTimeout(r, HOLD_DURATION_MS));

    const start = Date.now();
    while (Date.now() - start < MAX_WAIT_MS) {
      await page.waitFor({ timeMs: POLL_INTERVAL_MS });
      const currentUrl = await page.url();
      if (currentUrl !== urlBefore) break;
      const resolved = await page.evaluate(`!document.body.innerText.match(/press.*hold|verify.*human|not a bot/i)`);
      if (resolved) break;
    }

    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    cdp.close();
    await page.waitFor({ timeMs: 2000 });

    const stillBlocked = await page.evaluate(`!!document.body.innerText.match(/press.*hold|verify.*human|not a bot|access.*denied/i)`);
    return !stillBlocked;
  } catch (err) {
    console.error('press-and-hold failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
