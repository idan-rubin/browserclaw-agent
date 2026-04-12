import type { CrawlPage } from 'browserclaw';

export function getCdpBaseUrl(page: CrawlPage): string {
  // No public getter upstream yet; guard loudly so a rename fails fast.
  const cdpUrl = (page as unknown as { cdpUrl?: string }).cdpUrl;
  if (typeof cdpUrl !== 'string' || cdpUrl === '') {
    throw new Error(
      'browserclaw internal `cdpUrl` field is missing — browserclaw may have changed its private API, file an upstream issue to expose cdpUrl publicly',
    );
  }
  return cdpUrl
    .replace('ws://', 'http://')
    .replace(/\/devtools\/browser\/.*/, '')
    .replace(/\/$/, '');
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
