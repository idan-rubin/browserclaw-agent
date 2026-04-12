import type { CrawlPage } from 'browserclaw';
import { logger } from '../logger.js';

export function getCdpBaseUrl(page: CrawlPage): string {
  const cdpUrl = (page as unknown as { cdpUrl: string }).cdpUrl;
  return cdpUrl
    .replace('ws://', 'http://')
    .replace(/\/devtools\/browser\/.*/, '')
    .replace(/\/$/, '');
}

export function getTargetId(page: CrawlPage): string {
  return page.id;
}

export async function activateCdpTarget(cdpBaseUrl: string, targetId: string): Promise<void> {
  const ws = await import('ws');
  const versionRes = await fetch(cdpBaseUrl + '/json/version');
  const versionInfo = (await versionRes.json()) as { webSocketDebuggerUrl: string };
  const browserWs = new ws.default(versionInfo.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    browserWs.on('open', resolve);
    browserWs.on('error', reject);
  });
  browserWs.send(JSON.stringify({ id: 1, method: 'Target.activateTarget', params: { targetId } }));
  await new Promise((r) => setTimeout(r, 300));
  browserWs.close();
}

export interface CdpConnection {
  send: (method: string, params: Record<string, unknown>) => Promise<void>;
  close: () => void;
}

export async function openCdpConnection(page: CrawlPage): Promise<CdpConnection> {
  const baseUrl = getCdpBaseUrl(page);
  const targetId = getTargetId(page);

  const res = await fetch(baseUrl + '/json');
  const targets = (await res.json()) as { id: string; webSocketDebuggerUrl: string }[];
  const target = targets.find((t) => t.id === targetId);
  if (!target) throw new Error('CDP target not found');

  await activateCdpTarget(baseUrl, targetId);

  const ws = await import('ws');
  const socket = new ws.default(target.webSocketDebuggerUrl);
  const CDP_CONNECT_TIMEOUT_MS = 10_000;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`WebSocket connection timed out after ${String(CDP_CONNECT_TIMEOUT_MS)}ms`));
    }, CDP_CONNECT_TIMEOUT_MS);
    socket.on('open', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  let msgId = 0;
  const send = (method: string, params: Record<string, unknown>) =>
    new Promise<void>((resolve) => {
      const id = ++msgId;
      const onMsg = (data: Buffer) => {
        let parsed: { id?: number; error?: { code?: number; message?: string } };
        try {
          parsed = JSON.parse(data.toString()) as { id?: number; error?: { code?: number; message?: string } };
        } catch {
          return;
        }
        if (parsed.id === id) {
          socket.off('message', onMsg);
          if (parsed.error) {
            logger.warn({ method, cdpError: parsed.error }, 'CDP response error');
          }
          resolve();
        }
      };
      socket.on('message', onMsg);
      socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        socket.off('message', onMsg);
        logger.warn({ method, id }, 'CDP send timed out after 3s');
        resolve();
      }, 3000);
    });

  return {
    send,
    close: () => {
      socket.close();
    },
  };
}

export async function cdpClick(
  cdp: CdpConnection,
  x: number,
  y: number,
  opts?: { delay?: number; holdMs?: number },
): Promise<void> {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
  if (opts?.delay !== undefined && opts.delay !== 0) await new Promise((r) => setTimeout(r, opts.delay));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  if (opts?.holdMs !== undefined && opts.holdMs !== 0) await new Promise((r) => setTimeout(r, opts.holdMs));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
