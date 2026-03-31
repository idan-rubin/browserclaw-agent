# browserclaw.agent

<p align="center">
  <a href="https://browserclaw.org"><img src="https://img.shields.io/badge/Live-browserclaw.org-orange" alt="Live" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

An AI agent for [browserclaw](https://github.com/idan-rubin/browserclaw) — a browser automation library that gives LLMs accessibility snapshots instead of screenshots.

browserclaw is the engine. This project is a production-grade agent built on top of it. Bring your own agent, or use this one.

## Quick start

```bash
npm install browserclaw
```

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

`snapshot()` returns a text representation of the page with numbered refs. Pass it to any LLM, get back a ref, call the action.

## Bring your own agent

browserclaw doesn't care what LLM you use. Here's a minimal agent loop:

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

Swap Anthropic for OpenAI, Groq, Gemini, or a local model. The library just gives you snapshots and executes actions.

See the full [browserclaw API docs](https://github.com/idan-rubin/browserclaw) for everything the library can do — `fill()`, `select()`, `drag()`, `screenshot()`, `pdf()`, `waitFor()`, and more.

## Why not browser-use?

[browser-use](https://github.com/browser-use/browser-use) is a great project. If you're working in Python, it's worth a look. Here's how browserclaw differs:

- **Node.js / TypeScript** — browserclaw is built for the JS ecosystem. If your stack is TypeScript, browser-use isn't an option.
- **Accessibility tree, not DOM** — browserclaw snapshots use the browser's accessibility tree — the same structure screen readers use. You get semantic roles, names, and states. browser-use serializes the DOM tree, which is structural (tags, attributes, text content). Accessibility snapshots are cleaner, smaller, and more meaningful to an LLM.
- **Skill catalog** — browserclaw.agent learns from every run. A successful run generates a reusable playbook for that domain. browser-use starts from scratch each time.
- **Built-in challenge handling** — Cloudflare Turnstile, press-and-hold anti-bot overlays, cookie banners — handled automatically via CDP. These are the things that make browser agents fail in the real world.

## Using the agent

If you don't want to build your own agent, this project gives you one that handles real-world web complexity out of the box.

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

## What the agent does

The agent loop runs up to 100 steps. Each step: get a snapshot, call the LLM, execute the action. It maintains a memory scratchpad across steps and evaluates whether each action succeeded before deciding the next move.

### Built-in skills

When the agent encounters common obstacles, built-in skills take over automatically:

- **Anti-bot bypass** — Detects and solves "hold to verify" overlays and press-and-hold challenges via CDP
- **Cloudflare Turnstile** — Solves "Verify you are human" checkboxes by locating and clicking the Turnstile iframe via CDP
- **Popup dismissal** — Closes cookie banners, consent dialogs, and modals using multi-strategy detection (aria-labels, roles, class patterns)
- **Loop detection** — Detects when the agent is stuck repeating the same action and nudges it toward a different approach
- **Tab manager** — Detects and switches to new tabs opened during automation

### Skill catalog

Every successful run generates a skill file — steps and tips for that domain, stored in MinIO. On the next run against the same domain, the agent loads the skill as a playbook instead of exploring from scratch. If the new run completes in fewer steps, the skill is replaced. One domain, one skill, always improving.

### Other features

- **BYOK** — Users can pass their own LLM API key per session for multi-tenant deployments
- **User interaction** — The agent can pause mid-run and ask the user for information (MFA codes, credentials)
- **SSE streaming** — Real-time step-by-step progress events
- **Content moderation** — Rejects harmful prompts before execution
- **SSRF protection** — Private network access blocked by default

## Read more

- [The Intelligence Gap](https://mrrubin.substack.com/p/the-knowledge-gap-why-ai-browser) — why AI browser agents keep failing, and what we're doing about it

## Built with

- [BrowserClaw](https://github.com/idan-rubin/browserclaw) — the engine
- [OpenClaw](https://github.com/openclaw/openclaw) — the community behind it
