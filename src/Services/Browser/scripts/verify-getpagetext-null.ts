#!/usr/bin/env npx tsx
/**
 * Reproduces the prod crash in session 3d936a51:
 *   page.evaluate: Cannot read properties of null (reading 'innerText')
 *
 * Forces document.body to null on a real chromium page, then calls
 * getPageText — without the fix it crashes; with the fix it returns ''.
 */

import { BrowserClaw } from 'browserclaw';
import { getPageText } from '../src/skills/press-and-hold.js';

async function main(): Promise<void> {
  const browser = await BrowserClaw.launch({
    headless: true,
    noSandbox: process.platform === 'linux',
    stealth: true,
  });
  try {
    const page = await browser.currentPage();
    await page.goto('about:blank');

    // Strip document.body — same condition a stuck-loading page can produce.
    await page.evaluate(`
      (function() {
        if (document.documentElement && document.body) {
          document.documentElement.removeChild(document.body);
        }
      })()
    `);

    const bodyState = await page.evaluate('document.body === null ? "null" : "present"');
    console.log(`document.body is now: ${String(bodyState)}`);

    console.log('Calling getPageText with document.body === null...');
    const text = await getPageText(page);
    console.log(`getPageText returned: ${JSON.stringify(text)}`);
    console.log(`PASS: getPageText did not throw, returned ${text === '' ? 'empty string' : '"' + text + '"'}`);
  } finally {
    await browser.stop();
  }
}

main().catch((err: unknown) => {
  console.error('FAIL:', err);
  process.exit(1);
});
