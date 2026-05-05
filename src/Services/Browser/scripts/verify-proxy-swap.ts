#!/usr/bin/env npx tsx
/**
 * Drives the proxy mechanics end-to-end without touching the LLM.
 * - shouldProxyUrl returns expected booleans
 * - Direct browser reports a Hetzner-class IP
 * - Proxy-routed browser, launched WHILE the direct one is still running
 *   (matching the swap path's overlap), reports a different US-residential IP
 * - The concurrent launch must use isolated: true to avoid SingletonLock
 *   collisions on the shared user-data dir.
 *
 * Run: npx tsx --env-file=.env.local scripts/verify-proxy-swap.ts
 */

import { BrowserClaw } from 'browserclaw';
import { shouldProxyUrl, startSessionProxy } from '../src/proxy.js';

async function fetchIp(url: string, browser: BrowserClaw): Promise<string> {
  const page = await browser.currentPage();
  await page.goto(url);
  return String(await page.evaluate('document.body.innerText')).trim();
}

async function main(): Promise<void> {
  console.log('=== shouldProxyUrl ===');
  const cases: Array<[string, boolean]> = [
    ['https://streeteasy.com/for-rent/chelsea', true],
    ['https://www.streeteasy.com/foo', true],
    ['https://apartments.com/chelsea', true],
    ['https://example.com/x', false],
    ['https://streeteasy.com.evil.com/x', false],
    ['not a url', false],
  ];
  let ok = true;
  for (const [url, expected] of cases) {
    const actual = shouldProxyUrl(url);
    const pass = actual === expected;
    if (!pass) ok = false;
    console.log(`  ${pass ? 'PASS' : 'FAIL'} shouldProxyUrl(${JSON.stringify(url)}) = ${String(actual)}`);
  }
  if (!ok) {
    console.error('\nshouldProxyUrl had failures');
    process.exit(1);
  }

  const isLinux = process.platform === 'linux';

  console.log('\n=== Direct browser (cdpPort 9222) ===');
  const direct = await BrowserClaw.launch({ headless: true, noSandbox: isLinux, stealth: true, cdpPort: 9222 });
  const directIp = await fetchIp('https://api.ipify.org', direct);
  console.log(`  egress IP: ${directIp}`);

  console.log('\n=== Proxied browser (cdpPort 9223, isolated) launched WHILE direct is still running ===');
  const proxy = await startSessionProxy('verify12');
  console.log(`  proxy URL: ${proxy.url}`);
  let proxiedIp: string;
  let proxied: BrowserClaw | undefined;
  try {
    proxied = await BrowserClaw.launch({
      headless: true,
      noSandbox: isLinux,
      stealth: true,
      isolated: true,
      cdpPort: 9223,
      chromeArgs: [`--proxy-server=${proxy.url}`],
    });
    proxiedIp = await fetchIp('https://api.ipify.org', proxied);
    console.log(`  egress IP: ${proxiedIp}`);
  } finally {
    if (proxied !== undefined) await proxied.stop();
    await proxy.close();
    await direct.stop();
  }

  console.log('\n=== Result ===');
  if (directIp === proxiedIp) {
    console.error(`FAIL: identical IPs (${directIp}). Proxy is not rerouting.`);
    process.exit(1);
  }
  console.log(`PASS: direct=${directIp} → proxied=${proxiedIp}`);
}

main().catch((err: unknown) => {
  console.error('FAIL:', err);
  process.exit(1);
});
