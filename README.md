# browserclaw.agent

<p align="center">
  <a href="https://browserclaw.org"><img src="https://img.shields.io/badge/Live-browserclaw.org-orange" alt="Live" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

The AI agent for [browserclaw](https://github.com/idan-rubin/browserclaw).

browserclaw separates the **browser engine** from the **intelligence**. The [library](https://github.com/idan-rubin/browserclaw) handles snapshots, element refs, and browser control. This project handles reasoning, obstacle recovery, and learned skills. Use them together for a ready-made agent, or use the library on its own with any LLM you want.

## What the agent does

The agent reads an accessibility snapshot of the page, decides what to do next, and executes the action. Up to 100 steps per run. It maintains a memory scratchpad across steps and evaluates whether each action succeeded before deciding the next move.

```
snapshot → LLM → action → repeat
```

### Built-in skills

When the agent hits common obstacles, built-in skills take over automatically — no prompting needed:

- **Anti-bot bypass** — Detects and solves "hold to verify" overlays and press-and-hold challenges via CDP
- **Cloudflare Turnstile** — Solves "Verify you are human" checkboxes by locating and clicking the Turnstile iframe via CDP
- **Popup dismissal** — Closes cookie banners, consent dialogs, and modals using multi-strategy detection
- **Loop detection** — Detects when the agent is stuck repeating the same action and nudges it toward a different approach
- **Tab manager** — Detects and switches to new tabs opened during automation

### Skill catalog

Every successful run generates a skill file — steps and tips for that domain, stored in MinIO. On the next run against the same domain, the agent loads the skill as a playbook instead of exploring from scratch. If the new run completes in fewer steps, the skill is replaced. One domain, one skill, always improving.

The first user to automate a domain pays the exploration cost. Every subsequent run benefits from the learned playbook — and refines it further.

## Quick start

### Local (dev mode)

Chrome opens on your desktop. No containers, no VNC.

**Requires:** Node.js 22+, Chrome installed

```bash
cd src/Services/Browser
cp .env.example .env.local
# Set LLM_PROVIDER and at least one API key (see LLM providers below)
npm install
npm run dev
```

Start a run:

```bash
curl -X POST http://localhost:5040/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Find apartments in NYC under $3000"}'
```

Stream progress:

```bash
curl http://localhost:5040/api/v1/sessions/{id}/stream
```

### Docker (full stack)

Runs the frontend, browser service (headless Chrome + VNC), MinIO (skill storage), and Traefik. Same setup as [browserclaw.org](https://browserclaw.org).

```bash
git clone https://github.com/idan-rubin/browserclaw.agent.git
cd browserclaw.agent
cp src/Services/Browser/.env.example src/Services/Browser/.env.local
# Set LLM_PROVIDER and at least one API key
docker compose up
```

Open [localhost](http://localhost).

### LLM providers

Add at least one API key to `.env.local` and set `LLM_PROVIDER`:

| Provider | Env var | `LLM_PROVIDER` | Free tier |
|----------|---------|-----------------|-----------|
| Groq | `GROQ_API_KEY` | `groq` | Yes |
| Google Gemini | `GEMINI_API_KEY` | `gemini` | Yes |
| OpenAI | `OPENAI_API_KEY` | `openai` | No |
| OpenAI (ChatGPT subscription) | `OPENAI_OAUTH_TOKEN` | `openai-oauth` | No (subscription) |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic` | No |

Set `LLM_MODEL` to override the default model for your provider.

### Other features

- **BYOK** — Users can pass their own LLM API key per session for multi-tenant deployments
- **User interaction** — The agent can pause mid-run to ask for information (MFA codes, credentials)
- **SSE streaming** — Real-time step-by-step progress events
- **Content moderation** — Rejects harmful prompts before execution
- **SSRF protection** — Private network access blocked by default

## Bring your own agent

Don't want this agent? Use the [browserclaw](https://github.com/idan-rubin/browserclaw) library directly with any LLM.

```bash
npm install browserclaw
```

Requires Chrome, Brave, Edge, or Chromium installed on your machine.

```typescript
import { BrowserClaw } from 'browserclaw';

const browser = await BrowserClaw.launch({ headless: false });
const page = await browser.open('https://example.com');

const { snapshot, refs } = await page.snapshot();
// snapshot: text tree of the page
// refs: { "e1": { role: "link", name: "More info" }, ... }

await page.click('e1');
await page.type('e3', 'hello');
await browser.stop();
```

`snapshot()` returns a text representation of the page with numbered refs. Pass it to any LLM, get back a ref, call the action. Here's a minimal agent loop:

```typescript
import { BrowserClaw } from 'browserclaw';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const browser = await BrowserClaw.launch({ headless: false });
const page = await browser.open('https://news.ycombinator.com');
const history = [];

for (let step = 0; step < 20; step++) {
  const { snapshot } = await page.snapshot();
  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: 'You control a browser. Given a page snapshot, return JSON: { action, ref?, text?, url?, reasoning }. Actions: click, type, navigate, done.',
    messages: [...history, { role: 'user', content: `Task: Find the top 3 AI posts.\n\nPage:\n${snapshot}` }],
  });

  const action = JSON.parse(response.content[0].text);
  history.push({ role: 'user', content: `Page:\n${snapshot}` }, { role: 'assistant', content: JSON.stringify(action) });
  if (action.action === 'done') break;

  switch (action.action) {
    case 'click':    await page.click(action.ref); break;
    case 'type':     await page.type(action.ref, action.text); break;
    case 'navigate': await page.goto(action.url); break;
  }
}
await browser.stop();
```

Swap Anthropic for OpenAI, Groq, Gemini, or a local model. See the full [browserclaw API docs](https://github.com/idan-rubin/browserclaw) for `fill()`, `select()`, `drag()`, `screenshot()`, `pdf()`, `waitFor()`, and more.

## Why browserclaw?

- **Built for TypeScript** — native to the JS ecosystem. First-class Node.js support, not a Python port.
- **Accessibility tree, not DOM** — snapshots use the browser's accessibility tree — the same structure screen readers use. Semantic roles, names, and states instead of raw tags and attributes. Cleaner, smaller, and more meaningful to an LLM.
- **Engine and intelligence, separated** — the [library](https://github.com/idan-rubin/browserclaw) is a standalone npm package with zero opinions about your AI. Use it with Claude, GPT, Gemini, Llama, or anything that reads text. This agent is one implementation — not the only way.
- **Gets smarter with use** — the skill catalog learns from every successful run. Other browser agents start from scratch each time. browserclaw.agent builds a playbook per domain and improves it on every run.
- **Handles the real world** — Cloudflare Turnstile, press-and-hold anti-bot overlays, cookie banners, tab management — handled automatically via CDP. These are the things that make browser agents fail in production.

## Read more

- [The Intelligence Gap](https://mrrubin.substack.com/p/the-knowledge-gap-why-ai-browser) — why AI browser agents keep failing, and what we're doing about it

## Built with

- [BrowserClaw](https://github.com/idan-rubin/browserclaw) — the engine
- [OpenClaw](https://github.com/openclaw/openclaw) — the community behind it
