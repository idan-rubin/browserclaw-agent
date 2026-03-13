# BrowserClaw: Self-Improving Browser Agent
## Executive Summary — Per-Domain Skill Catalog

### The Problem

Every browser automation agent on the market today starts from zero on every run. User asks "search apartments on StreetEasy" — the agent spends 15 steps figuring out the site, fighting cookie banners, missing autocomplete dropdowns, stumbling through the same UI patterns it already solved yesterday. Each step is an LLM call. Each LLM call costs money and time.

ChatGPT Operator charges $20/mo for 40 tasks. At the API level, a complex browser task costs $0.02–$0.05 per run — but that's assuming the agent doesn't waste half its steps rediscovering what it already knows. In practice, redundant exploration inflates cost by 2–3x.

The browser agent market is projected to grow from $4.5B (2024) to $76.8B by 2034. 88% of organizations now use AI regularly. The market is real and growing fast — but every player has the same weakness: **no memory**.

### The Opportunity

BrowserClaw's Per-Domain Skill Catalog turns every successful run into a playbook for the next one. The agent doesn't just complete tasks — it learns how to complete them better.

**How it works:**

1. User sends a prompt → agent completes the task → skill is generated
2. Skill is saved to a per-domain catalog (MinIO/S3) with tags and metadata
3. Next run on the same domain → agent loads existing skills as a **playbook**
4. Agent follows the playbook instead of exploring from scratch
5. If the new run completes in fewer steps → skill is **refined** (circular improvement)
6. If the existing skill holds up → it's **validated** (run count increases, confidence grows)

The skill sharpens itself with every run. 15 steps becomes 9 becomes 6. The agent converges on the optimal path for each site.

### Why This Is a Moat

The competitive landscape includes Agent-E (skill harvesting), ChatGPT Operator (browser agent), and dozens of open-source web agents. What none of them have:

- **Circular self-improvement.** Skills don't just get saved — they get refined. Every run is a training loop. The playbook after 10 runs is fundamentally better than the playbook after 1.

- **Per-domain expertise.** The catalog is organized by domain. StreetEasy skills don't pollute Google Flights skills. Each domain gets its own battle-tested library that grows independently.

- **Compounding data asset.** Every user's successful run improves the system for the next user on the same domain. This is a network effect — the more runs, the smarter the agent, the better the product, the more runs.

- **Direct cost reduction.** Fewer steps = fewer LLM calls = lower cost per task. A skill that took 15 steps on run 1 and takes 6 steps on run 5 costs 60% less to execute. This margin improvement compounds across every user and every domain.

### The Numbers

| Metric | Run 1 (no skills) | Run 5 (refined skill) | Improvement |
|--------|-------------------|----------------------|-------------|
| Steps | 15 | 6 | 60% fewer |
| LLM calls | ~20 | ~8 | 60% cheaper |
| Duration | ~45s | ~18s | 60% faster |
| Success rate | ~70% | ~95% | More reliable |

These are conservative projections. The key insight: **cost savings compound across every user on the same domain.** One user figures out StreetEasy, every subsequent user benefits.

### Architecture

- **Storage:** MinIO (local dev) → S3 (production). Same SDK, one config change.
- **Catalog structure:** `skills/{domain}/{slug}.json` + `skills/{domain}/_index.json`
- **Skill matching:** Domain-based with word-overlap scoring for prompt similarity
- **Injection:** Full playbook with action types and details, injected for first 3 steps
- **Improvement loop:** Compare step count → save if fewer → validate if equal → always learn

### What This Enables (Future)

1. **Shared skill marketplace.** Users can browse and share skills across accounts. "Here's how to book a flight on United" becomes a community asset.
2. **Skill confidence scoring.** High run_count + consistent step count = high confidence. Surface this to users: "This task has been completed successfully 47 times."
3. **Pre-built skill packs.** Ship BrowserClaw with curated skills for top 100 websites. Day-one competence, not day-one exploration.
4. **Enterprise skill libraries.** Companies build private catalogs for their internal tools. Onboard new employees with proven workflows.
5. **Pricing leverage.** Charge per task, but your cost per task decreases with scale. Margin improves as the skill library grows.

### Bottom Line

Every other browser agent sells compute. BrowserClaw sells intelligence that gets smarter. The skill catalog is the flywheel — more runs, better skills, lower costs, higher success rates, more users, more runs. This is not a feature. It's the business model.
