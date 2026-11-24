# browserclaw-agent

<p align="center">
  <a href="https://browserclaw.org"><img src="https://img.shields.io/badge/Live-browserclaw.org-orange" alt="Live" /></a>
  <a href="https://www.npmjs.com/package/browserclaw-agent"><img src="https://img.shields.io/npm/v/browserclaw-agent.svg" alt="npm" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

The AI agent for [browserclaw](https://github.com/idan-rubin/browserclaw).

## Case studies

Two proof-of-concept products are built on browserclaw-agent:

- **[beelz.ai](https://beelz.ai)** — bill pay. The agent is built to log in to a biller's own website, fill the payment form, and pay, with no per-provider integration.
- **[tovli.ai](https://tovli.ai)** — charitable giving. The agent is built to complete the donation form on each nonprofit's own website.

[browserclaw.org](https://browserclaw.org) is the open playground, deployed from this repo.

## Layered, not bundled

Three separate layers, not one monolith:

- ⚡ **LLM** — the electricity. Your choice: Claude, GPT, Gemini, local. No lock-in.
- 😎 **The agent** — the driver. Reasoning, obstacle recovery, learned skills. _That's this project._
- 🏎️ **[BrowserClaw](https://github.com/idan-rubin/browserclaw)** — the vehicle. Snapshots, element refs, browser control. Standalone npm library.

browser-use welds these into one package. We keep them as separate, swappable layers — drop the library into your own agent, pair this agent with any LLM, or run the whole stack as-is.

## vs browser-use

**Different lineage, different design.** [browserclaw](https://github.com/idan-rubin/browserclaw) was born from the browser module in [OpenClaw](https://openclaw.ai), which put Microsoft's [Playwright MCP](https://github.com/microsoft/playwright-mcp) snapshot-and-ref pattern to work inside a real agent. We pulled that engine out into a standalone npm library you can drop into any agent. This one rides on it. browser-use rolled its own Python stack as one bundled package.

|                             |    browserclaw     |    browser-use     |
| :-------------------------- | :----------------: | :----------------: |
| Standalone browser library  | :white_check_mark: |        :x:         |
| Works with any agent        | :white_check_mark: | :heavy_minus_sign: |
| Auto-learns skills per site | :white_check_mark: |        :x:         |
| Solves anti-bot in OSS      | :white_check_mark: | :heavy_minus_sign: |
| TypeScript / Node           | :white_check_mark: |        :x:         |

:white_check_mark: = Yes&ensp; :heavy_minus_sign: = Partial&ensp; :x: = No

## vs ego lite

**Different shape, different job.** [ego lite](https://github.com/citrolabs/ego-lite) is a desktop browser you install so a coding agent on your computer (Claude Code, Codex, Cursor) can work in your signed-in tabs. browserclaw is a library you ship inside your own product, and it runs anywhere Node and a Chromium browser do.

|                                 |    browserclaw     |      ego lite      |
| :------------------------------ | :----------------: | :----------------: |
| Embeds as an npm library        | :white_check_mark: |        :x:         |
| Runs headless on servers and CI | :white_check_mark: |        :x:         |
| Works with any agent            | :white_check_mark: | :white_check_mark: |
| Uses your signed-in browser     | :heavy_minus_sign: | :white_check_mark: |
| Auto-learns skills per site     | :white_check_mark: | :heavy_minus_sign: |
| Solves anti-bot in OSS          | :white_check_mark: |        :x:         |

:white_check_mark: = Yes&ensp; :heavy_minus_sign: = Partial&ensp; :x: = No

Sourced from ego lite's [README](https://github.com/citrolabs/ego-lite#readme) and [agent guide](https://github.com/citrolabs/ego-lite/blob/main/package/ego-browser/skill-body/SKILL.md) on November 24, 2026. It is a desktop app for macOS and Windows, with Linux on its roadmap. Any agent CLI drives it through the `ego-browser` skill. It bundles site learnings for GitHub, Google, and X, and lists auto-learned skills as coming soon. Its agent guide hands CAPTCHAs to the user. browserclaw reaches a signed-in browser by attaching to a running Chrome with `connect()` or reusing a profile, which takes setup that ego lite does not need.

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
# Set BROWSER_INTERNAL_TOKEN in .env.local for service authentication
npm install
npm run dev
```

Start a run:

```bash
curl -X POST http://localhost:5040/api/v1/sessions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${BROWSER_INTERNAL_TOKEN}" \
  -d '{"prompt":"Find apartments in NYC under $3000","llm_config":{"provider":"anthropic","model":"claude-sonnet-5-5","api_key":"YOUR_ANTHROPIC_API_KEY"}}'
```

Stream progress:

```bash
curl -H "Authorization: Bearer ${BROWSER_INTERNAL_TOKEN}" http://localhost:5040/api/v1/sessions/{id}/stream
```

### Docker (full stack)

Runs the frontend, browser service (headless Chrome + VNC), MinIO (skill storage), and Traefik. Same setup as [browserclaw.org](https://browserclaw.org).

```bash
git clone https://github.com/idan-rubin/browserclaw-agent.git
cd browserclaw-agent
cp src/Services/Browser/.env.example src/Services/Browser/.env.local
# Set BROWSER_INTERNAL_TOKEN to a random secret (used for frontend → browser service auth):
echo "BROWSER_INTERNAL_TOKEN=$(openssl rand -hex 32)" >> .env
docker compose up
```

Open [localhost](http://localhost).

### LLM providers

On the Try or Compare page, select a model and enter your Anthropic, OpenAI, or Gemini API key. For a ChatGPT subscription, select **ChatGPT subscription (Codex)** and paste your OAuth access token. The optional refresh token lets the browser renew access before a run.

To obtain the tokens, run the login helper from `src/Services/Browser` after installing dependencies. It prints a sign-in URL and waits for the local callback.

```bash
npx tsx scripts/openai-login.ts
```

Direct API clients supply the provider (`anthropic`, `openai`, `openai-oauth`, or `gemini`), model, and access token or API key in each session’s `llm_config`. The refresh token stays in the browser.

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
import { BrowserClaw } from "browserclaw";

const browser = await BrowserClaw.launch({ headless: false });
const page = await browser.open("https://example.com");

const { snapshot, refs } = await page.snapshot();
// snapshot: text tree of the page
// refs: { "e1": { role: "link", name: "More info" }, ... }

await page.click("e1");
await page.type("e3", "hello");
await browser.stop();
```

`snapshot()` returns a text representation of the page with numbered refs. Pass it to any LLM, get back a ref, call the action. Here's a minimal agent loop:

```typescript
import { BrowserClaw } from "browserclaw";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const browser = await BrowserClaw.launch({ headless: false });
const page = await browser.open("https://news.ycombinator.com");
const history = [];

for (let step = 0; step < 20; step++) {
  const { snapshot } = await page.snapshot();
  const response = await client.messages.create({
    model: "claude-sonnet-5-5",
    max_tokens: 1024,
    system:
      "You control a browser. Given a page snapshot, return JSON: { action, ref?, text?, url?, reasoning }. Actions: click, type, navigate, done.",
    messages: [
      ...history,
      {
        role: "user",
        content: `Task: Find the top 3 AI posts.\n\nPage:\n${snapshot}`,
      },
    ],
  });

  const reply = response.content.find((block) => block.type === "text");
  if (!reply) throw new Error("Claude returned no action");
  const action = JSON.parse(reply.text);
  history.push(
    { role: "user", content: `Page:\n${snapshot}` },
    { role: "assistant", content: JSON.stringify(action) },
  );
  if (action.action === "done") break;

  switch (action.action) {
    case "click":
      await page.click(action.ref);
      break;
    case "type":
      await page.type(action.ref, action.text);
      break;
    case "navigate":
      await page.goto(action.url);
      break;
  }
}
await browser.stop();
```

Swap Anthropic for OpenAI, Groq, Gemini, or a local model. See the full [browserclaw API docs](https://github.com/idan-rubin/browserclaw) for `fill()`, `select()`, `drag()`, `screenshot()`, `pdf()`, `waitFor()`, and more.

## Why browserclaw?

- **Built for TypeScript** — native to the JS ecosystem. First-class Node.js support, not a Python port.
- **Accessibility tree, not DOM** — snapshots use the browser's accessibility tree — the same structure screen readers use. Semantic roles, names, and states instead of raw tags and attributes. Cleaner, smaller, and more meaningful to an LLM.
- **Layered, not bundled** — the engine, the agent, and the LLM are separate, swappable pieces. See the [comparison above](#vs-browser-use).
- **Gets smarter with use** — the skill catalog learns from every successful run. Other browser agents start from scratch each time. browserclaw-agent builds a playbook per domain and improves it on every run.
- **Handles the real world** — Cloudflare Turnstile, press-and-hold anti-bot overlays, cookie banners, tab management — handled automatically via CDP. These are the things that make browser agents fail in production.

## Read more

- [The Intelligence Gap](https://mrrubin.substack.com/p/the-knowledge-gap-why-ai-browser) — why AI browser agents keep failing, and what we're doing about it

## Built with

- [BrowserClaw](https://github.com/idan-rubin/browserclaw) — the browser automation library
- [OpenClaw](https://github.com/openclaw/openclaw) — the project browserclaw was born from
