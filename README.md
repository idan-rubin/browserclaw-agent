# browserclaw.agent

<p align="center">
  <a href="https://browserclaw.org"><img src="https://img.shields.io/badge/Live-browserclaw.org-orange" alt="Live" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
</p>

The AI driver for [browserclaw](https://github.com/idan-rubin/browserclaw).

The hard part of browser automation isn't controlling the browser — it's knowing what to do next. [browserclaw](https://github.com/idan-rubin/browserclaw) is a powerful engine: fast snapshots, precise element refs, real browser control. But an engine without a conductor just idles. **browserclaw.agent** is the conductor — the intelligence that reads the page, orchestrates each step, adapts when things go wrong, and improves through learned skills.

Most browser agents rely on vision models and screenshots. browserclaw.agent works with accessibility snapshots instead — structured representations of the page that use 4x fewer tokens per step, while navigating the real browser just like a person would.

## How it works

```
snapshot → agent (LLM) → action → repeat
```

The agent receives an accessibility snapshot from browserclaw, reasons about the next step, and picks an action: click, type, navigate, scroll, press-and-hold, or done. When it encounters known obstacles, skills take over.

## Skills

A growing set of learned behaviors for challenges the agent encounters in the wild:

| Skill | What it does |
|-------|-------------|
| `press-and-hold` | Detects and solves anti-bot overlays (press & hold, verify human) |
| `dismiss-popup` | Closes cookie banners, modals, overlays |
| `loop-detection` | Detects and breaks out of repeated action loops |
| `tab-manager` | Manages browser tabs opened during automation |

## Run locally

Requires: Node.js 22+, Chrome installed

```bash
git clone https://github.com/idan-rubin/browserclaw.agent.git
cd browserclaw.agent
cd src/Services/Browser
cp .env.example .env.local
```

Edit `.env.local` — add at least one API key:

| Provider | Env var | Free tier |
|----------|---------|-----------|
| Groq | `GROQ_API_KEY` | Yes |
| Google Gemini | `GEMINI_API_KEY` | Yes |
| OpenAI | `OPENAI_API_KEY` | No |

Set `MODEL` to match your key (e.g. `groq-llama-3.3-70b`, `gemini-2.5-flash`, `gpt-5.4`).

```bash
npm install
npm run dev
```

## Built with

- [BrowserClaw](https://github.com/idan-rubin/browserclaw) — the engine
- [OpenClaw](https://github.com/openclaw/openclaw) — the community behind it
