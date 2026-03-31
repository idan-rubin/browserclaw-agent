# browserclaw.agent

<p align="center">
  <a href="https://browserclaw.org"><img src="https://img.shields.io/badge/Live-browserclaw.org-orange" alt="Live" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

An AI agent for [browserclaw](https://github.com/idan-rubin/browserclaw) — the browser automation library built for LLMs.

[browserclaw](https://github.com/idan-rubin/browserclaw) is the engine: accessibility snapshots, numbered element refs, real browser control. You bring your own agent — any LLM, any framework, any logic. Or use **browserclaw.agent** (this project) to jumpstart with a ready-made agent that handles anti-bot challenges, learns reusable skills, and gets better with every run.

## browserclaw (the library)

Install it and use it directly. No agent, no framework, no opinions.

```bash
npm install browserclaw
```

Requires Chrome, Brave, Edge, or Chromium installed on your machine.

### Basic usage

```typescript
import { BrowserClaw } from 'browserclaw';

const browser = await BrowserClaw.launch({ headless: false });
const page = await browser.open('https://example.com');

// Get an accessibility snapshot — the core feature
const { snapshot, refs } = await page.snapshot();
// snapshot: AI-readable text tree of the page
// refs: { "e1": { role: "link", name: "More info" }, ... }

await page.click('e1');           // Click by ref
await page.type('e3', 'hello');   // Type by ref
await browser.stop();
```

That's it. `snapshot()` gives you a text representation of the page with numbered refs. Pass the snapshot to any LLM, get back a ref, call the action. No vision model, no screenshots, no CSS selectors.

### Bring your own agent

Use browserclaw with any LLM provider. Here's a minimal agent loop:

```typescript
import { BrowserClaw } from 'browserclaw';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const browser = await BrowserClaw.launch({ headless: false });
const page = await browser.open('https://news.ycombinator.com');

const prompt = 'Find the top 3 posts about AI and summarize them';
const history = [];

for (let step = 0; step < 20; step++) {
  const { snapshot } = await page.snapshot();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: 'You are a browser automation agent. Given a page snapshot, return JSON with { action, ref?, text?, url?, reasoning }. Actions: click, type, navigate, scroll, done.',
    messages: [
      ...history,
      { role: 'user', content: `Task: ${prompt}\n\nPage snapshot:\n${snapshot}` }
    ],
  });

  const action = JSON.parse(response.content[0].text);
  history.push(
    { role: 'user', content: `Page snapshot:\n${snapshot}` },
    { role: 'assistant', content: JSON.stringify(action) }
  );

  if (action.action === 'done') {
    console.log('Result:', action.reasoning);
    break;
  }

  switch (action.action) {
    case 'click':    await page.click(action.ref); break;
    case 'type':     await page.type(action.ref, action.text); break;
    case 'navigate': await page.goto(action.url); break;
    case 'scroll':   await page.evaluate('window.scrollBy(0, 600)'); break;
  }
}

await browser.stop();
```

Swap Anthropic for OpenAI, Groq, Gemini, or a local model — browserclaw doesn't care. It just gives you snapshots and executes actions.

### Full API

```typescript
// Launch or connect
const browser = await BrowserClaw.launch({ headless: false, chromeArgs: ['--start-maximized'] });
const browser = await BrowserClaw.connect('http://localhost:9222');

// Pages & tabs
const page = await browser.open('https://example.com');
const tabs = await browser.tabs();
await browser.focus(tabId);
await browser.stop();

// Snapshots
const { snapshot, refs, stats } = await page.snapshot();
const { snapshot } = await page.snapshot({ interactive: true, compact: true });

// Actions
await page.click('e1');
await page.click('e1', { doubleClick: true });
await page.type('e3', 'search query');
await page.type('e3', 'search query', { submit: true });
await page.hover('e2');
await page.select('e5', 'Option A');
await page.drag('e1', 'e4');
await page.press('Enter');
await page.fill([
  { ref: 'e2', value: 'Jane Doe' },
  { ref: 'e4', value: 'jane@example.com' },
]);

// Navigation
await page.goto('https://example.com');
await page.reload();
await page.goBack();
await page.waitFor({ text: 'Welcome' });
await page.waitFor({ textGone: 'Loading...' });
await page.waitFor({ loadState: 'networkidle' });

// Screenshots & PDF
const screenshot = await page.screenshot();
const pdf = await page.pdf();

// Evaluate
const title = await page.evaluate('() => document.title');
```

## Why accessibility snapshots?

Most browser automation tools give the AI either **screenshots** (expensive vision API calls, probabilistic coordinate targeting) or **raw DOM** (noisy, token-heavy, full of invisible elements).

BrowserClaw takes a different approach: it gives the AI an **accessibility snapshot** — the same structured tree that screen readers use. The result is a clean text representation of what's actually on the page, with numbered refs that resolve to exact Playwright locators.

- **Text in, text out** — no vision model needed, works with any LLM
- **Small payloads** — accessibility trees are a fraction of the size of raw DOM or screenshots
- **Deterministic targeting** — refs map to exact elements, not coordinates or selectors
- **Semantic meaning** — the AI sees roles, names, and states, not CSS classes
- **Batch form filling** — `page.fill()` sets multiple fields in one call
- **Cross-origin iframes** — snapshots include content from embedded iframes

## browserclaw.agent (this project)

A production-ready agent implementation on top of browserclaw. It reads the page, reasons about the next step, handles real-world web complexity out of the box, and learns reusable skills from every successful run.

```
snapshot → LLM → action → repeat
```

### How the agent works

The agent loop runs up to 100 steps. Each step: get a snapshot, call the LLM, execute the action. The agent maintains a persistent memory scratchpad across steps, tracks goals, and evaluates whether each action succeeded before deciding the next move.

When it encounters obstacles — cookie banners, anti-bot overlays, Cloudflare challenges — built-in skills take over automatically. No prompting needed.

### Built-in skills

These aren't toy wrappers. They use Chrome DevTools Protocol (CDP) directly, traverse shadow DOM and cross-origin iframes, and simulate human-like behavior to handle the challenges that break every other browser agent.

**Anti-bot bypass (`press-and-hold`)** — Detects "Hold to verify you're human" overlays by scanning both DOM and shadow DOM with pattern matching. Uses CDP to click precise coordinates with randomized jitter and hold times (4–10s) that mimic real users. Falls back to page refresh if the challenge clears but content doesn't load.

**Cloudflare Turnstile (`cloudflare-checkbox`)** — Solves Cloudflare "Verify you are human" checkboxes via CDP. Locates the Turnstile iframe target, introspects the DOM for checkbox position, and uses CDP-level clicking to bypass detection. Polls with retries (15s timeout) until the challenge clears.

**Popup & banner dismissal (`dismiss-popup`)** — Multi-strategy detection for cookie consent banners, modals, and overlays. Matches by aria-labels, class patterns, data-testid, and semantic roles. Finds dismiss buttons across modals and iframes, checks computed visibility before clicking.

**Loop detection (`loop-detection`)** — Detects when the agent is stuck repeating the same action. Escalating nudges (gentle → warning → urgent) based on repetition thresholds over a sliding window. Also detects stagnant pages (same URL, 5+ steps, limited action variety) and suggests alternative navigation.

**Tab manager (`tab-manager`)** — Tracks tabs via CDP, detects new tabs opened during automation (e.g. "open in new tab" links), and switches focus automatically.

### Skill catalog

Every successful run generates a skill file — structured steps and tips for that domain, stored in MinIO (S3-compatible). On the next run against the same domain, the agent loads the skill as a playbook instead of exploring from scratch. If the new run completes in fewer steps, the skill is replaced. One domain, one skill, always improving.

| | First run | After 5 runs |
|--|-----------|-------------|
| Steps | ~15 | ~6 |
| LLM calls | ~20 | ~8 |
| Duration | ~45s | ~18s |
| Success rate | ~70% | ~95% |

The first user to automate a domain pays the exploration cost. Every subsequent run benefits from the learned playbook — and refines it further.

### Running locally (dev mode)

Runs the agent service directly. Chrome opens on your desktop — no containers, no VNC.

**Requires:** Node.js 22+, Chrome installed

```bash
cd src/Services/Browser
cp .env.example .env.local
# Edit .env.local — set LLM_PROVIDER and at least one API key
npm install
npm run dev
```

Then start a run:

```bash
curl -X POST http://localhost:5040/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Find apartments in NYC under $3000"}'
```

Stream progress:

```bash
curl http://localhost:5040/api/v1/sessions/{id}/stream
```

### Running with Docker (full stack)

Runs everything: frontend, browser service (headless Chrome + VNC), MinIO (skill storage), and Traefik. This is the same setup that powers [browserclaw.org](https://browserclaw.org).

```bash
git clone https://github.com/idan-rubin/browserclaw.agent.git
cd browserclaw.agent
cp src/Services/Browser/.env.example src/Services/Browser/.env.local
# Edit .env.local — set LLM_PROVIDER and at least one API key
docker compose up
```

Open [localhost](http://localhost).

### LLM providers

The agent supports multiple providers. Add at least one API key to `.env.local` and set `LLM_PROVIDER`:

| Provider | Env var | `LLM_PROVIDER` | Free tier |
|----------|---------|-----------------|-----------|
| Groq | `GROQ_API_KEY` | `groq` | Yes |
| Google Gemini | `GEMINI_API_KEY` | `gemini` | Yes |
| OpenAI | `OPENAI_API_KEY` | `openai` | No |
| OpenAI (ChatGPT subscription) | `OPENAI_OAUTH_TOKEN` | `openai-oauth` | No (subscription) |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic` | No |

Set `LLM_MODEL` to override the default model for your provider.

### What else is in the box

- **BYOK (Bring Your Own Key)** — Users can pass their own API key per session. The agent scopes LLM calls to that key via `AsyncLocalStorage`, so you can run a multi-tenant service where each user pays for their own inference.
- **Content moderation** — LLM-powered filter rejects harmful prompts before execution. Blocks illegal, violent, and adult content. Bypassable in dev mode.
- **SSRF protection** — Private network access blocked by default. Opt-in via `SSRF_ALLOW_PRIVATE=true` for local development.
- **User interaction (`ask_user`)** — The agent can pause mid-run and ask the user for information it can't get from the page (MFA codes, credentials, preferences). The session goes into `waiting_for_user` state and resumes when the user responds.
- **Real-time SSE streaming** — Every step, skill load, and status change is emitted as a server-sent event. Connect multiple clients to the same session stream.
- **LLM call tracking** — Per-session call count so you know exactly what each run costs.

## Read more

- [The Intelligence Gap](https://mrrubin.substack.com/p/the-knowledge-gap-why-ai-browser) — why AI browser agents keep failing, and what we're doing about it

## Built with

- [BrowserClaw](https://github.com/idan-rubin/browserclaw) — the engine
- [OpenClaw](https://github.com/openclaw/openclaw) — the community behind it
