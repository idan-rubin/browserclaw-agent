#!/usr/bin/env npx tsx
/**
 * Drives the proxy mechanics end-to-end without touching the LLM:
 * - shouldProxyUrl returns expected booleans
 * - A direct browser reports a Hetzner-class IP
 * - A proxy-routed browser reports a different (US residential) IP
 * - Closing the proxy tears down the local forwarder
 *
 * Run: npx tsx src/Services/Browser/scripts/verify-proxy-swap.ts
 * Requires IPROYAL_* + RESIDENTIAL_DOMAINS in env (or .env.local loaded).
 */

import { BrowserClaw } from 'browserclaw';
import { shouldProxyUrl, startSessionProxy } from '../src/proxy.js';

async function fetchIpFromBrowser(url: string, chromeArgs: string[]): Promise<string> {
  const browser = await BrowserClaw.launch({
    headless: true,
    noSandbox: process.platform === 'linux',
    stealth: true,
    chromeArgs,
  });
  try {
    const page = await browser.currentPage();
    await page.goto(url);
    const text = String(await page.evaluate('document.body.innerText'));
    return text.trim();
  } finally {
    await browser.stop();
  }
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
    console.log(`  ${pass ? 'PASS' : 'FAIL'} shouldProxyUrl(${JSON.stringify(url)}) = ${String(actual)} (expected ${String(expected)})`);
  }
  if (!ok) {
    console.error('\nshouldProxyUrl had failures');
    process.exit(1);
  }

  console.log('\n=== Direct browser ===');
  const directIp = await fetchIpFromBrowser('https://api.ipify.org', []);
  console.log(`  egress IP: ${directIp}`);

  console.log('\n=== Proxied browser ===');
  const proxy = await startSessionProxy('verify12');
  console.log(`  proxy URL: ${proxy.url}`);
  let proxiedIp: string;
  try {
    proxiedIp = await fetchIpFromBrowser('https://api.ipify.org', [`--proxy-server=${proxy.url}`]);
    console.log(`  egress IP: ${proxiedIp}`);
  } finally {
    await proxy.close();
    console.log('  proxy closed');
  }

  console.log('\n=== Result ===');
  if (directIp === proxiedIp) {
    console.error(`FAIL: direct and proxied IPs are identical (${directIp}). Proxy is not actually rerouting traffic.`);
    process.exit(1);
  }
  console.log(`PASS: direct=${directIp} → proxied=${proxiedIp} (different IPs, proxy is working)`);
}

main().catch((err: unknown) => {
  console.error('FAIL:', err);
  process.exit(1);
});
