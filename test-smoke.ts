import { BrowserClaw } from './src/Services/Browser/node_modules/browserclaw/dist/index.js';

const browser = await BrowserClaw.launch({
  headless: false,
  chromeArgs: ['--start-maximized', '--window-size=1440,900'],
});
const page = await browser.open('http://localhost:3000/');

console.log('Page loaded:', await page.title());
await page.waitFor({ timeMs: 2000 });

// Type a prompt
console.log('Typing prompt...');
const { refs } = await page.snapshot({ interactive: true });
const textbox = Object.entries(refs).find(([, v]) => (v as Record<string, unknown>)?.role === 'textbox')?.[0];
if (textbox) {
  await page.type(textbox, 'Extract the top 10 posts from Hacker News right now');
  await page.waitFor({ timeMs: 1000 });
}

// Click Run
console.log('Clicking Run...');
const snap2 = await page.snapshot({ interactive: true });
const runBtn = Object.entries(snap2.refs).find(
  ([, v]) => (v as Record<string, unknown>)?.name === 'Run',
)?.[0];
if (runBtn) {
  await page.click(runBtn);
  console.log('Clicked Run');
} else {
  console.log(
    'Run button not found in refs:',
    Object.entries(snap2.refs)
      .map(([k, v]) => `${k}: ${(v as Record<string, unknown>)?.name}`)
      .join(', '),
  );
}

await page.waitFor({ timeMs: 8000 });
console.log('Current URL:', await page.url());
console.log('Page title:', await page.title());

const finalSnap = await page.snapshot({ compact: true });
console.log('\n--- Final page snapshot ---');
console.log(finalSnap.snapshot.substring(0, 2000));

await browser.stop();
