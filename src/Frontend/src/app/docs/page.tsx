import type { Metadata } from 'next';
import { PageShell } from '@/components/page-shell';

export const metadata: Metadata = {
  title: 'Documentation',
  description: 'BrowserClaw API documentation — snapshot + ref browser automation for AI agents.',
};

export default function DocsPage() {
  return (
    <PageShell activePath="/docs">
      <main className="flex-1 px-6 py-16 sm:px-10">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Documentation</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            BrowserClaw gives AI agents a text snapshot with numbered refs — the AI reads text, returns a ref, and the
            action is deterministic.
          </p>

          {/* Install */}
          <Section title="Install">
            <Code>{`npm install browserclaw`}</Code>
            <p className="mt-3 text-sm text-muted-foreground">
              Requires a Chromium-based browser installed on the system (Chrome, Brave, Edge, or Chromium). BrowserClaw
              auto-detects your installed browser — no need to install Playwright browsers separately.
            </p>
          </Section>

          {/* Quick Start */}
          <Section title="Quick Start">
            <Code>{`import { BrowserClaw } from 'browserclaw';

const browser = await BrowserClaw.launch({ headless: false });
const page = await browser.open('https://example.com');

// Snapshot — the core feature
const { snapshot, refs } = await page.snapshot();
// snapshot: AI-readable text tree
// refs: { "e1": { role: "link", name: "More info" }, ... }

await page.click('e1');         // Click by ref
await page.type('e3', 'hello'); // Type by ref
await browser.stop();`}</Code>
          </Section>

          {/* How It Works */}
          <Section title="How It Works">
            <div className="rounded-xl border border-border/50 bg-card/40 p-6">
              <pre className="overflow-x-auto text-sm leading-relaxed text-muted-foreground">{`┌─────────────┐     snapshot()     ┌─────────────────────────────────┐
│  Web Page   │ ──────────────►    │  AI-readable text tree          │
│             │                    │                                 │
│  [buttons]  │                    │  - heading "Example Domain"     │
│  [links]    │                    │  - link "More information" [e1] │
└─────────────┘                    └──────────────┬──────────────────┘
                                                  │
                                          AI reads snapshot,
                                          decides: click e1
                                                  │
┌─────────────┐     click('e1')    ┌──────────────▼──────────────────┐
│  Web Page   │ ◄──────────────    │  Ref "e1" resolves to a         │
│  (navigated)│                    │  Playwright locator — exact      │
└─────────────┘                    └─────────────────────────────────┘`}</pre>
            </div>
            <ol className="mt-4 space-y-2 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">1. Snapshot</strong> a page — get an AI-readable text tree with
                numbered refs (e1, e2, e3...)
              </li>
              <li>
                <strong className="text-foreground">2. AI reads</strong> the snapshot text and picks a ref to act on
              </li>
              <li>
                <strong className="text-foreground">3. Actions target refs</strong> — BrowserClaw resolves each ref to a
                Playwright locator and executes the action
              </li>
            </ol>
          </Section>

          {/* Why BrowserClaw */}
          <Section title="Why BrowserClaw?">
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                <strong className="text-foreground">Vision-based tools</strong> (screenshot → click coordinates) are
                slow, expensive, and probabilistic.
              </p>
              <p>
                <strong className="text-foreground">Selector-based tools</strong> (CSS/XPath) are brittle and
                meaningless to an LLM.
              </p>
              <p>
                <strong className="text-foreground">BrowserClaw</strong> gives the AI a text snapshot with numbered refs
                — the AI reads text (what it&apos;s best at) and returns a ref ID (deterministic targeting).
              </p>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Stat label="Deterministic" description="Refs resolve to exact elements via Playwright locators" />
              <Stat label="Fast" description="Text snapshots are tiny compared to screenshots" />
              <Stat label="Cheap" description="No vision API calls, just text in/text out" />
              <Stat label="Reliable" description="Built on Playwright, the most robust browser engine" />
            </div>
          </Section>

          {/* API Reference */}
          <Section title="API Reference" id="api-reference">
            <div className="space-y-6">
              <ApiBlock
                title="Launch & Connect"
                code={`// Launch a new Chrome instance
const browser = await BrowserClaw.launch({
  headless: false,
  cdpPort: 9222,
  noSandbox: false,       // set true for Docker/CI
  chromeArgs: ['--start-maximized'],
});

// Or connect to an already-running Chrome
const browser = await BrowserClaw.connect('http://localhost:9222');`}
              />
              <ApiBlock
                title="Pages & Tabs"
                code={`const page = await browser.open('https://example.com');
const current = await browser.currentPage();
const tabs = await browser.tabs();
await browser.focus(tabId);
await browser.close(tabId);
await browser.stop();`}
              />
              <ApiBlock
                title="Snapshot"
                code={`const { snapshot, refs, stats } = await page.snapshot();

// Options
const result = await page.snapshot({
  interactive: true,  // Only interactive elements
  compact: true,      // Remove structural noise
  maxDepth: 6,        // Limit tree depth
  maxChars: 80000,    // Truncate large pages
});`}
              />
              <ApiBlock
                title="Actions"
                code={`await page.click('e1');
await page.click('e1', { doubleClick: true });
await page.type('e3', 'hello world');
await page.type('e3', 'search', { submit: true });
await page.hover('e2');
await page.select('e5', 'Option A');
await page.drag('e1', 'e4');
await page.press('Enter');

// Fill multiple form fields at once
await page.fill([
  { ref: 'e2', value: 'Jane Doe' },
  { ref: 'e4', value: 'jane@example.com' },
  { ref: 'e6', type: 'checkbox', value: true },
]);`}
              />
              <ApiBlock
                title="Navigation & Waiting"
                code={`await page.goto('https://example.com');
await page.reload();
await page.goBack();
await page.waitFor({ loadState: 'networkidle' });
await page.waitFor({ text: 'Welcome' });
await page.waitFor({ textGone: 'Loading...' });
await page.waitFor({ timeMs: 1000 });`}
              />
              <ApiBlock
                title="Screenshots & PDF"
                code={`const screenshot = await page.screenshot();
const fullPage = await page.screenshot({ fullPage: true });
const element = await page.screenshot({ ref: 'e1' });
const pdf = await page.pdf();`}
              />
              <ApiBlock
                title="Evaluate"
                code={`const title = await page.evaluate('() => document.title');
const text = await page.evaluate('(el) => el.textContent', { ref: 'e1' });`}
              />
            </div>
          </Section>

          {/* Comparison */}
          <Section title="Comparison">
            <div className="overflow-x-auto rounded-xl border border-border/50">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 bg-card/40">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground"></th>
                    <th className="px-4 py-3 text-center font-medium text-primary">BrowserClaw</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">browser-use</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Stagehand</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Playwright MCP</th>
                  </tr>
                </thead>
                <tbody className="text-muted-foreground">
                  <ComparisonRow label="Ref → exact element" values={['yes', 'partial', 'no', 'yes']} />
                  <ComparisonRow label="No vision model needed" values={['yes', 'partial', 'yes', 'yes']} />
                  <ComparisonRow label="Survives redesigns" values={['yes', 'partial', 'yes', 'yes']} />
                  <ComparisonRow label="Batch form filling" values={['yes', 'no', 'no', 'no']} />
                  <ComparisonRow label="Cross-origin iframes" values={['yes', 'yes', 'no', 'no']} />
                  <ComparisonRow label="Playwright engine" values={['yes', 'no', 'yes', 'yes']} />
                  <ComparisonRow label="Embeddable library" values={['yes', 'no', 'partial', 'no']} />
                </tbody>
              </table>
            </div>
          </Section>

          {/* Full docs link */}
          <div className="mt-16 rounded-2xl border border-border/50 bg-card/40 p-8 text-center">
            <p className="text-muted-foreground">Full API documentation and examples on GitHub</p>
            <a
              href="https://github.com/idan-rubin/browserclaw"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-block rounded-xl bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </main>
    </PageShell>
  );
}

/* --- Sub-components --- */

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="mt-14">
      <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-border/50 bg-card/40 p-4 text-sm leading-relaxed text-muted-foreground">
      <code>{children}</code>
    </pre>
  );
}

function ApiBlock({ title, code }: { title: string; code: string }) {
  return (
    <div>
      <h3 className="mb-2 text-base font-semibold">{title}</h3>
      <Code>{code}</Code>
    </div>
  );
}

function Stat({ label, description }: { label: string; description: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/40 p-4">
      <p className="font-semibold text-primary">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function ComparisonRow({ label, values }: { label: string; values: ('yes' | 'no' | 'partial')[] }) {
  return (
    <tr className="border-b border-border/30">
      <td className="px-4 py-2.5 text-foreground">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="px-4 py-2.5 text-center">
          <ComparisonIcon value={v} />
        </td>
      ))}
    </tr>
  );
}

function ComparisonIcon({ value }: { value: 'yes' | 'no' | 'partial' }) {
  switch (value) {
    case 'yes':
      return <span className="text-green-400">&#10003;</span>;
    case 'partial':
      return <span className="text-yellow-400">~</span>;
    case 'no':
      return <span className="text-red-400">&#10005;</span>;
  }
}
