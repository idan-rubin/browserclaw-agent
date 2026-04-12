# browserclaw-agent — AI coding rules

Rules for Claude (and other AI coding assistants) working in this repo. Architecture + stack live in [`docs/architecture.md`](docs/architecture.md) — read that first for context.

## Scope guardrails

- **Two services only** — Next.js frontend and Node.js browser service. No new microservices without explicit approval.
- **No Temporal, no Kafka, no Redis.** Rate limiting is PostgreSQL, fan-out is direct DB writes, durability is not needed (the agent loop is a `for` loop).
- **Don't add abstraction layers** between the browser service and the Anthropic SDK. Direct Claude calls.
- **Don't fork `browserclaw`** to fix an agent-side problem. Use the public API or work around it locally.
- **Don't touch upstream libraries.** If browserclaw or any other dependency needs a change, file an upstream issue instead of editing the vendored source.

## Conventions

- API paths: `/api/v1/{resource}`
- JSON over the wire: `snake_case`
- Timestamps: UTC, `TIMESTAMPTZ` in PostgreSQL
- Internal auth: `BROWSER_INTERNAL_TOKEN` header for frontend → browser service
- Each service owns its own DB. No shared tables, no prefixes.

## Before every commit

Run the full check suite in the service you changed:

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm test`
- `npm run build`

## Commits and PRs

- Short commit messages (2–4 words), no bodies.
- Rebase onto `main` before pushing — catch conflicts locally.
- Closing a PR ≠ deleting its branch. Leave the branch on the remote.

## Local-first is first-class

Local agent mode (`npm run dev` + the developer's own browser) must never break. It's the primary dev surface.
