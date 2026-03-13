# browserclaw.agent — Project Instructions

## What This Project Is

browserclaw.agent is the AI agent that drives browserclaw. It reads accessibility snapshots, decides what to do, and learns skills to handle real-world web complexity.

```
Input:  prompt
Output: live browser stream → skill file OR error message
```

## Architecture Decisions (Do Not Deviate)

- **One-page product.** Landing page IS the product. Prompt input → live VNC stream → skill output.
- **Two services only.** Next.js (frontend + API + auth) and Node.js browser service (browserclaw + VNC + agent loop). No .NET, no microservices.
- **Traefik reverse proxy.** Routes traffic to frontend and browser service.
- **NextAuth for auth.** JWT-based. Social login (Google, GitHub).
- **SSE for real-time.** Browser service streams agent progress to frontend via SSE.
- **VNC for browser stream.** Xvfb + x11vnc + websockify + noVNC. Same stack as beelz.ai.
- **browserclaw for browser automation.** Playwright-core based. The core engine.
- **Anthropic SDK for AI.** Direct Claude API calls from the browser service. No abstraction layer.
- **Skills as output.** Every successful run generates a structured skill markdown file.
- **No Temporal.** Single activity, no signals, no durability needed. Agent loop is a for-loop.
- **No Kafka.** No event fan-out needed. Direct DB writes.
- **No Redis.** Rate limiting via PostgreSQL.

## Tech Stack

- **Frontend:** Next.js 16 (React 19 + TypeScript) + Tailwind CSS + shadcn/ui
- **Auth:** NextAuth v4 (JWT)
- **Browser Service:** Node.js + TypeScript
- **Browser Automation:** browserclaw (playwright-core)
- **AI:** Anthropic SDK (@anthropic-ai/sdk)
- **Database:** PostgreSQL 16
- **VNC:** Xvfb + x11vnc + websockify + noVNC
- **Reverse Proxy:** Traefik v3.3
- **Containerization:** Docker + Docker Compose

## Project Structure

```
browserclaw.agent/
├── src/
│   ├── Frontend/                # Next.js (React + TypeScript)
│   │   ├── src/
│   │   │   ├── app/             # App Router (pages + API routes)
│   │   │   │   ├── api/         # API routes (runs, auth, SSE proxy)
│   │   │   │   ├── run/[id]/    # Run view page
│   │   │   │   └── page.tsx     # Landing page (prompt input)
│   │   │   ├── components/
│   │   │   │   ├── ui/          # shadcn/ui base
│   │   │   │   ├── prompt/      # Prompt input component
│   │   │   │   ├── run/         # VNC stream + status + skill output
│   │   │   │   ├── layout/      # Header, footer
│   │   │   │   └── shared/      # Common components
│   │   │   └── lib/             # API client, hooks, utils
│   │   ├── package.json
│   │   └── Dockerfile
│   └── Services/
│       └── Browser/             # Node.js browser service
│           ├── src/
│           │   ├── server.ts           # HTTP server + SSE endpoints
│           │   ├── session-manager.ts  # Browser session lifecycle
│           │   ├── agent-loop.ts       # snapshot → LLM → action loop
│           │   ├── skill-generator.ts  # Generate skill from action history
│           │   ├── routes.ts           # Express routes
│           │   └── types.ts
│           ├── docker-entrypoint.sh    # Starts Xvfb, x11vnc, websockify, Node
│           ├── supervisord.conf
│           ├── package.json
│           └── Dockerfile
├── docker/
│   └── traefik/
├── infrastructure/
│   └── k8s/
├── docs/
│   └── design/
├── docker-compose.yml
├── tests/
└── README.md
```

## Key Entities

```
User → Run → Skill
```

- **User:** email, auth provider, created_at
- **Run:** prompt, status (pending/running/completed/failed), steps_completed, error_message, created_at, completed_at
- **Skill:** title, steps (markdown), metadata (duration, url, step count), run_id, sharing_slug, created_at

## Endpoints

### Frontend API Routes (Next.js)

```
POST   /api/v1/runs              — Create a new run
GET    /api/v1/runs/:id          — Get run status + skill
GET    /api/v1/runs/:id/stream   — SSE proxy to browser service
GET    /api/v1/skills            — List user's skills
GET    /api/v1/skills/:slug      — Get shared skill (public)
POST   /api/auth/[...nextauth]   — NextAuth handlers
```

### Browser Service (internal only)

```
POST   /api/v1/sessions          — Create browser session + start agent loop
GET    /api/v1/sessions/:id/stream  — SSE stream of agent progress
DELETE /api/v1/sessions/:id      — Close session
GET    /health                   — Health check
```

## Agent Loop

```typescript
for (let step = 0; step < MAX_STEPS; step++) {
  const { snapshot } = await page.snapshot();
  const action = await claude.askForAction(prompt, snapshot, history);

  emitSSE({ step, action: action.action, reasoning: action.reasoning });

  switch (action.action) {
    case 'click':    await page.click(action.ref); break;
    case 'type':     await page.type(action.ref, action.text); break;
    case 'navigate': await page.goto(action.url); break;
    case 'done':     return { success: true, history };
    case 'fail':     return { success: false, error: action.reasoning };
  }
  history.push(action);
}
```

## VNC Stack (in Browser Service container)

Same as beelz.ai:
- **Xvfb** — virtual framebuffer (:99, 1920x1080x24)
- **fluxbox** — window manager
- **x11vnc** — VNC server (port 5900)
- **websockify** — WebSocket bridge (port 6080)
- **noVNC** — web client

Frontend embeds: `/vnc/vnc.html?autoconnect=true&resize=scale&view_only=true`

## Rate Limiting

No paywall for MVP. Rate limit by user:
- 5 runs per user per 24 hours
- Max 1 concurrent run per user
- Global max concurrent sessions (based on infra capacity)

## Docker Compose

```
traefik         → reverse proxy (port 80)
frontend        → Next.js (port 3000)
browser         → Node.js + Chrome + VNC (port 5040, VNC 6080)
postgres        → database (port 5432)
```

## Traefik Routing

```
/               → frontend:3000
/api/v1/*       → frontend:3000 (Next.js API routes)
/vnc/*          → browser:6080 (websockify/noVNC)
```

## Conventions

- API routes: `/api/v1/{resource}`
- Internal auth: `BROWSER_INTERNAL_TOKEN` for frontend → browser service calls
- All timestamps: UTC, `TIMESTAMPTZ` in PostgreSQL
- JSON: snake_case
- Rate limit check: PostgreSQL query on runs table
