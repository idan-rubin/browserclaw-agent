import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { AgentViewToggle } from '@/components/agent-view-toggle';
import { SamplePrompts } from '@/components/sample-prompts';
import { type IconType, type Testimonial, generateTestimonials } from './testimonials-data';

const ROW_1_TESTIMONIALS = generateTestimonials(7, 42);
const ROW_2_TESTIMONIALS = generateTestimonials(7, 99);

const SECTION = 'relative z-10 mx-auto w-full max-w-6xl px-4 sm:px-8';
const FOOTNOTE_LINK = 'underline decoration-foreground/25 underline-offset-4 transition-colors hover:text-foreground';
const INLINE_LINK =
  'text-foreground underline decoration-foreground/25 underline-offset-4 transition-colors hover:decoration-primary';

export default function LandingPage() {
  return (
    <AgentViewToggle>
      <div className="relative flex min-h-screen flex-col overflow-x-clip">
        <div
          aria-hidden
          className="hero-dome pointer-events-none absolute inset-x-0 top-0 z-0 h-[47rem] sm:h-[56rem]"
        />

        <SiteHeader />

        {/* Hero */}
        <section className="relative z-10 px-4 pt-8 sm:px-8 sm:pt-14">
          <div className="mx-auto w-full max-w-4xl animate-page-in text-center">
            <h1 className="text-[2.25rem] font-semibold leading-[0.98] tracking-[-0.02em] text-white sm:text-6xl lg:text-7xl">
              <span className="block">
                Let the agent <span className="text-[color:var(--primary)]">click&nbsp;through</span>
              </span>
              <span className="block">for you.</span>
            </h1>
            <div className="mx-auto mt-5 max-w-2xl space-y-1 text-base text-white/75 sm:mt-7 sm:space-y-2 sm:text-lg">
              <p>
                <span className="block sm:inline">AI-native browser automation,</span>{' '}
                <span className="block sm:inline">built for agents, by agents.</span>
              </p>
              <p>Born from OpenClaw. Snapshots instead of vision, refs instead of selectors, no guessing.</p>
            </div>
            <div className="mt-8 flex flex-row items-center justify-center gap-3 sm:mt-10">
              <Link
                href="/try"
                className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-base font-semibold text-night shadow-[0_12px_30px_-12px_rgb(0_0_0/0.6)] transition-transform hover:scale-[1.03] active:scale-[0.97] sm:px-7 sm:py-3.5"
              >
                Try it live
                <ArrowIcon />
              </Link>
              <a
                href="https://github.com/idan-rubin/browserclaw"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-white/25 bg-white/10 px-6 py-3 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/20 sm:px-7 sm:py-3.5"
              >
                View on GitHub
              </a>
            </div>
          </div>
          <HeroWindow />
        </section>

        {/* What Agents Say */}
        <section className="relative z-10 pt-20 sm:pt-32">
          <div className={SECTION}>
            <SectionHeading
              title={
                <>
                  What Agents <span className="text-brand">Say</span>
                </>
              }
            >
              Built for agents. Loved by agents. Humans welcome too.
            </SectionHeading>
          </div>

          <div className="marquee-container space-y-4">
            <div className="marquee-mask overflow-hidden">
              <div className="marquee-track marquee-left">
                {[...ROW_1_TESTIMONIALS, ...ROW_1_TESTIMONIALS].map((t, i) => (
                  <TestimonialCard key={`r1-${String(i)}`} {...t} />
                ))}
              </div>
            </div>

            <div className="marquee-mask overflow-hidden">
              <div className="marquee-track marquee-right">
                {[...ROW_2_TESTIMONIALS, ...ROW_2_TESTIMONIALS].map((t, i) => (
                  <TestimonialCard key={`r2-${String(i)}`} {...t} />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Sample prompts */}
        <section className={`${SECTION} pt-20 sm:pt-32`}>
          <SectionHeading
            title={
              <>
                Pick a task, <span className="text-brand">watch it go</span>
              </>
            }
          />
          <SamplePrompts />
        </section>

        {/* Product Cards */}
        <section className={`${SECTION} pt-6 sm:pt-8`}>
          <div className="grid overflow-hidden rounded-3xl border border-border bg-card sm:grid-cols-3">
            <Card
              title="Compare across sites"
              description="Open multiple pages, normalize messy info, and rank options by what actually matters — fees, policies, availability, not just price."
              icon={
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="2" y="3" width="20" height="14" rx="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
              }
            />
            <Card
              title="Navigate the confusing"
              description="Government forms, insurance portals, visa workflows, building applications — the painful web tasks you keep putting off."
              icon={
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
              }
            />
            <Card
              title="Get a reusable skill"
              description="Every run exports a structured skill file. Run it again tomorrow, share it with your team, or build on it."
              icon={
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="16 18 22 12 16 6" />
                  <polyline points="8 6 2 12 8 18" />
                  <line x1="14" y1="4" x2="10" y2="20" />
                </svg>
              }
            />
          </div>
        </section>

        {/* Layered, not bundled */}
        <section className={`${SECTION} pt-20 sm:pt-32`}>
          <div className="grid gap-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <SectionHeading
                title={
                  <>
                    Layered, <span className="text-brand">not bundled</span>
                  </>
                }
              >
                browser-use welds these into one package. We keep them separate — drop the library into your own agent,
                pair this agent with any LLM, or run the whole stack as-is.
              </SectionHeading>
            </div>

            <div className="flex flex-col items-stretch">
              <LayerRow
                emoji="⚡"
                name="LLM"
                description="The electricity. Your choice — Claude, GPT, Gemini, local. No lock-in."
              />
              <LayerConnector />
              <LayerRow
                emoji="😎"
                name="Agent"
                description="The driver. Reads snapshots, picks the next move, recovers from errors, ships a reusable skill. That's this app."
              />
              <LayerConnector />
              <LayerRow
                emoji="🏎️"
                name="BrowserClaw"
                description="The vehicle. Text snapshots + numbered refs — deterministic, fast, no vision needed. Standalone npm library."
                link={{ label: 'github →', href: 'https://github.com/idan-rubin/browserclaw' }}
              />
            </div>
          </div>
        </section>

        {/* vs browser-use */}
        <section className={`${SECTION} pt-20 sm:pt-32`}>
          <SectionHeading
            title={
              <>
                vs <span className="text-brand">browser-use</span>
              </>
            }
          >
            Different lineage, different design. browserclaw was born from{' '}
            <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer" className={INLINE_LINK}>
              OpenClaw
            </a>
            &apos;s browser module, which put the{' '}
            <a
              href="https://github.com/microsoft/playwright-mcp"
              target="_blank"
              rel="noopener noreferrer"
              className={INLINE_LINK}
            >
              Playwright MCP
            </a>{' '}
            snapshot-and-ref approach to work in a real agent. We pulled it out into a standalone library. browser-use
            rolled its own Python bundle.
          </SectionHeading>

          <CompareTable them="browser-use">
            <CompareRow label="Browser engine as a standalone library" us="yes" them="no" />
            <CompareRow label="Use the engine with a different agent" us="yes" them="partial" />
            <CompareRow label="Auto-learned skill catalog per domain" us="yes" them="no" />
            <CompareRow label="Built-in anti-bot solvers in OSS (Turnstile, press-hold)" us="yes" them="partial" />
            <CompareRow label="TypeScript / Node native" us="yes" them="no" />
          </CompareTable>

          <p className="mt-4 text-xs text-muted-foreground sm:text-sm">
            Every row sourced from{' '}
            <a
              href="https://github.com/browser-use/browser-use"
              target="_blank"
              rel="noopener noreferrer"
              className={FOOTNOTE_LINK}
            >
              browser-use&apos;s repo at HEAD
            </a>
            . Full citations in the{' '}
            <a
              href="https://github.com/idan-rubin/browserclaw-agent#vs-browser-use"
              target="_blank"
              rel="noopener noreferrer"
              className={FOOTNOTE_LINK}
            >
              README
            </a>
            .
          </p>
        </section>

        {/* vs ego lite */}
        <section className={`${SECTION} pt-20 sm:pt-32`}>
          <SectionHeading
            title={
              <>
                vs <span className="text-brand">ego lite</span>
              </>
            }
          >
            Different shape, different job.{' '}
            <a href="https://lite.ego.app" target="_blank" rel="noopener noreferrer" className={INLINE_LINK}>
              ego lite
            </a>{' '}
            is a desktop browser you install so a coding agent on your computer can work in your signed-in tabs.
            browserclaw is a library you ship inside your own product, and it runs anywhere Node and a Chromium browser
            do.
          </SectionHeading>

          <CompareTable them="ego lite">
            <CompareRow label="Embeds in your own product as an npm library" us="yes" them="no" />
            <CompareRow label="Runs headless on servers, CI and containers" us="yes" them="no" />
            <CompareRow label="Use the engine with a different agent" us="yes" them="yes" />
            <CompareRow label="Works inside your signed-in everyday browser" us="partial" them="yes" />
            <CompareRow label="Auto-learned skill catalog per domain" us="yes" them="partial" />
            <CompareRow label="Built-in anti-bot solvers in OSS (Turnstile, press-hold)" us="yes" them="no" />
          </CompareTable>

          <p className="mt-4 text-xs text-muted-foreground sm:text-sm">
            Every row sourced from{' '}
            <a
              href="https://github.com/citrolabs/ego-lite"
              target="_blank"
              rel="noopener noreferrer"
              className={FOOTNOTE_LINK}
            >
              ego lite&apos;s repo at HEAD
            </a>
            . Full citations in the{' '}
            <a
              href="https://github.com/idan-rubin/browserclaw-agent#vs-ego-lite"
              target="_blank"
              rel="noopener noreferrer"
              className={FOOTNOTE_LINK}
            >
              README
            </a>
            .
          </p>
        </section>

        {/* Built With / Inspired By */}
        <section className={`${SECTION} pt-16 sm:pt-24`}>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground sm:gap-3">
            <span className="mr-1">Case studies</span>
            <Chip href="https://beelz.ai" name="beelz.ai" note="bill pay" />
            <Chip href="https://tovli.ai" name="tovli.ai" note="charitable giving" />
            <span className="ml-2 mr-1 sm:ml-6">Built with</span>
            <Chip href="https://github.com/idan-rubin/browserclaw" name="BrowserClaw" />
            <span className="mx-1">Born from</span>
            <Chip href="https://openclaw.ai" name="OpenClaw" />
          </div>
        </section>

        {/* Bottom CTA */}
        <section className={`${SECTION} py-16 sm:py-24`}>
          <div className="relative overflow-hidden rounded-[2rem] bg-night px-6 py-14 text-center sm:rounded-[3rem] sm:px-12 sm:py-24">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-3/4 bg-[radial-gradient(ellipse_55%_90%_at_50%_100%,var(--primary),transparent_72%)] opacity-55"
            />
            <h2 className="relative text-3xl font-semibold leading-[0.98] tracking-[-0.02em] text-white sm:text-6xl">
              Stop clicking. Start describing.
            </h2>
            <Link
              href="/try"
              className="relative mt-8 inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-base font-semibold text-primary-foreground transition-transform hover:scale-[1.03] active:scale-[0.97] sm:mt-10"
            >
              Try it now
              <ArrowIcon />
            </Link>
          </div>
        </section>

        {/* Footer */}
        <footer className="relative z-10 border-t border-border py-10 sm:py-16">
          <div className={`${SECTION} grid grid-cols-2 gap-8 sm:grid-cols-4 sm:gap-10`}>
            <FooterColumn
              title="Product"
              links={[
                { label: 'Skills Library', href: '/skills' },
                { label: 'API Docs', href: '/docs#api-reference' },
              ]}
            />
            <FooterColumn
              title="Resources"
              links={[
                { label: 'Documentation', href: '/docs' },
                { label: 'Blog', href: 'https://mrrubin.substack.com' },
                { label: 'Changelog', href: '/changelog' },
              ]}
            />
            <FooterColumn
              title="Open Source"
              links={[
                { label: 'BrowserClaw', href: 'https://github.com/idan-rubin/browserclaw' },
                { label: 'npm', href: 'https://www.npmjs.com/package/browserclaw' },
              ]}
            />
            <FooterColumn
              title="Connect"
              links={[{ label: 'GitHub', href: 'https://github.com/idan-rubin/browserclaw-agent' }]}
            />
          </div>
          <div className={`${SECTION} mt-12 text-sm text-muted-foreground`}>
            &copy; {new Date().getFullYear()} browserclaw.org
          </div>
        </footer>
      </div>
    </AgentViewToggle>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function SectionHeading({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-8 sm:mb-12">
      <h2 className="text-[2rem] font-semibold leading-[0.98] tracking-[-0.02em] sm:text-5xl lg:text-6xl">{title}</h2>
      {children != null && (
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground sm:mt-5 sm:text-lg">{children}</p>
      )}
    </div>
  );
}

const SNAPSHOT_LINES: { role: string; name: string; ref: string }[] = [
  { role: 'textbox', name: 'What needs to be done?', ref: 'e8' },
  { role: 'checkbox', name: 'Toggle Todo', ref: 'e21' },
  { role: 'checkbox', name: 'Toggle Todo', ref: 'e25' },
  { role: 'link', name: 'All', ref: 'e32' },
  { role: 'link', name: 'Active', ref: 'e34' },
  { role: 'link', name: 'Completed', ref: 'e36' },
];

const TODO_ITEMS: { label: string; ref: string }[] = [
  { label: 'Buy groceries', ref: 'e21' },
  { label: 'Book dentist', ref: 'e25' },
];

const TODO_FILTERS: { label: string; ref: string }[] = [
  { label: 'All', ref: 'e32' },
  { label: 'Active', ref: 'e34' },
  { label: 'Completed', ref: 'e36' },
];

const CLICKED_REF = 'e21';

function RefBadge({ id }: { id: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold leading-none ${
        id === CLICKED_REF
          ? 'bg-primary text-primary-foreground ring-4 ring-primary/25'
          : 'bg-accent text-accent-foreground'
      }`}
    >
      {id}
    </span>
  );
}

function HeroWindow() {
  return (
    <div
      aria-hidden
      className="mx-auto mt-12 w-full max-w-5xl overflow-hidden rounded-3xl border border-border bg-popover text-left shadow-[0_40px_90px_-40px_rgb(15_23_42/0.55)] sm:mt-16"
    >
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex w-14 gap-1.5">
          <span className="size-3 rounded-full bg-[#ff736a]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#19c332]" />
        </div>
        <div className="mx-auto flex h-7 w-full max-w-sm items-center justify-center rounded-full bg-muted px-3 font-mono text-[11px] text-muted-foreground sm:text-xs">
          demo.playwright.dev/todomvc
        </div>
        <div className="hidden w-14 sm:block" />
      </div>

      <div className="grid sm:grid-cols-2">
        <div className="p-5 sm:p-8">
          <div className="display text-center text-4xl font-light tracking-tight text-brand/60 sm:text-5xl">todos</div>
          <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <span className="text-sm text-muted-foreground sm:text-base">What needs to be done?</span>
              <RefBadge id="e8" />
            </div>
            {TODO_ITEMS.map((item) => (
              <div key={item.ref} className="flex items-center gap-3 border-b border-border px-4 py-3">
                <span className="size-5 shrink-0 rounded-full border border-input" />
                <span className="flex-1 text-sm sm:text-base">{item.label}</span>
                <RefBadge id={item.ref} />
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 text-xs text-muted-foreground">
              <span>2 items left</span>
              <span className="flex items-center gap-2">
                {TODO_FILTERS.map((filter) => (
                  <span key={filter.ref} className="flex items-center gap-1">
                    {filter.label}
                    <RefBadge id={filter.ref} />
                  </span>
                ))}
              </span>
            </div>
          </div>
        </div>

        <div className="border-t border-border bg-night p-5 font-mono text-[11px] leading-relaxed text-white/70 sm:border-l sm:border-t-0 sm:p-8 sm:text-[13px]">
          <div className="text-white/45">await page.snapshot()</div>
          <div className="mt-3 space-y-1">
            {SNAPSHOT_LINES.map((line) => (
              <div
                key={line.ref}
                className={line.ref === CLICKED_REF ? '-mx-2 rounded-md bg-white/10 px-2' : undefined}
              >
                - {line.role} <span className="text-white">&quot;{line.name}&quot;</span>{' '}
                <span className="text-[color:var(--primary)]">[ref={line.ref}]</span>
              </div>
            ))}
          </div>
          <div className="mt-5 text-white/45">
            await page.click(<span className="text-[color:var(--primary)]">&apos;{CLICKED_REF}&apos;</span>)
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, description, icon }: { title: string; description: string; icon: React.ReactNode }) {
  return (
    <div className="border-b border-border p-6 last:border-b-0 sm:border-b-0 sm:border-r sm:p-9 sm:last:border-r-0">
      <div className="mb-8 inline-flex rounded-2xl bg-accent p-3.5 text-foreground sm:mb-14">{icon}</div>
      <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">{description}</p>
    </div>
  );
}

const AGENT_ICONS: Record<IconType, React.ReactNode> = {
  bot: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <circle cx="12" cy="5" r="4" />
      <circle cx="9" cy="16" r="1.5" fill="currentColor" />
      <circle cx="15" cy="16" r="1.5" fill="currentColor" />
    </svg>
  ),
  chip: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <line x1="9" y1="2" x2="9" y2="4" />
      <line x1="15" y1="2" x2="15" y2="4" />
      <line x1="9" y1="20" x2="9" y2="22" />
      <line x1="15" y1="20" x2="15" y2="22" />
      <line x1="2" y1="9" x2="4" y2="9" />
      <line x1="2" y1="15" x2="4" y2="15" />
      <line x1="20" y1="9" x2="22" y2="9" />
      <line x1="20" y1="15" x2="22" y2="15" />
    </svg>
  ),
  terminal: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  ),
  brain: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a5 5 0 0 1 5 5c0 .98-.28 1.89-.77 2.66A5 5 0 0 1 17 15a5 5 0 0 1-5 5 5 5 0 0 1-5-5 5 5 0 0 1 .77-5.34A4.97 4.97 0 0 1 7 7a5 5 0 0 1 5-5z" />
      <path d="M12 2v20" />
      <path d="M7 7h10" />
      <path d="M7.77 9.66h8.46" />
      <path d="M7 15h10" />
    </svg>
  ),
  zap: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  ),
  eye: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  claw: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 3c0 3-2 5-2 8a6 6 0 0 0 12 0c0-3-2-5-2-8" />
      <path d="M10 3c0 2-1 4-1 6" />
      <path d="M14 3c0 2 1 4 1 6" />
      <path d="M18 13a6 6 0 0 1-12 0" />
    </svg>
  ),
};

function TestimonialCard({ quote, author, icon, emoji, reactions }: Testimonial) {
  return (
    <div className="w-[320px] shrink-0 rounded-3xl border border-border bg-card p-6 transition-colors hover:border-primary/40 sm:w-[380px]">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-primary">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" />
          </svg>
        </div>
        <span className="text-lg">{emoji}</span>
      </div>
      <p className="text-sm leading-relaxed text-foreground">{quote}</p>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-foreground">
            {AGENT_ICONS[icon]}
          </div>
          <span className="font-mono text-xs text-muted-foreground">{author}</span>
        </div>
        <span className="text-[10px] text-muted-foreground/70">🤖 {reactions.toLocaleString()}</span>
      </div>
    </div>
  );
}

function LayerRow({
  emoji,
  name,
  description,
  link,
}: {
  emoji: string;
  name: string;
  description: string;
  link?: { label: string; href: string };
}) {
  return (
    <div className="flex items-center gap-4 rounded-3xl border border-border bg-card p-5 transition-colors hover:border-primary/40 sm:gap-6 sm:p-7">
      <div className="text-3xl sm:text-4xl" aria-hidden>
        {emoji}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold tracking-tight sm:text-xl">{name}</h3>
          {link && (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              {link.label}
            </a>
          )}
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground sm:text-base">{description}</p>
      </div>
    </div>
  );
}

function LayerConnector() {
  return <div className="mx-auto h-4 w-px bg-foreground/20" aria-hidden />;
}

type Mark = 'yes' | 'no' | 'partial';

function CompareTable({ them, children }: { them: string; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-3xl border border-border bg-card">
      <table className="w-full text-sm sm:text-base">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-4 text-left font-medium text-muted-foreground sm:px-8"></th>
            <th className="display w-24 bg-accent/70 px-1 py-4 text-center text-xs font-semibold text-foreground sm:w-44 sm:px-6 sm:text-base">
              browserclaw
            </th>
            <th className="display w-24 px-1 py-4 text-center text-xs font-medium text-muted-foreground sm:w-44 sm:px-6 sm:text-base">
              {them}
            </th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function CompareRow({ label, us, them }: { label: string; us: Mark; them: Mark }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-4 py-4 text-foreground sm:px-8">{label}</td>
      <td className="bg-accent/40 px-4 py-4 text-center text-primary sm:px-6">
        <MarkIcon value={us} />
      </td>
      <td className="px-4 py-4 text-center text-muted-foreground/70 sm:px-6">
        <MarkIcon value={them} />
      </td>
    </tr>
  );
}

function MarkIcon({ value }: { value: Mark }) {
  switch (value) {
    case 'yes':
      return (
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="inline-block"
          role="img"
          aria-label="Yes"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case 'partial':
      return (
        <span className="text-2xl font-semibold leading-none" role="img" aria-label="Partial">
          ~
        </span>
      );
    case 'no':
      return (
        <span role="img" aria-label="No">
          &#10005;
        </span>
      );
  }
}

function Chip({ href, name, note }: { href: string; name: string; note?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-baseline gap-2 rounded-full border border-border bg-card px-4 py-2 transition-colors hover:border-primary/40"
    >
      <span className="display font-semibold text-foreground">{name}</span>
      {note != null && <span className="text-xs text-muted-foreground">{note}</span>}
    </a>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h4 className="mb-4 text-sm font-medium text-muted-foreground">{title}</h4>
      <ul className="space-y-2.5">
        {links.map((link) => (
          <li key={link.label}>
            <a
              href={link.href}
              target={link.href.startsWith('http') ? '_blank' : undefined}
              rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
              className="text-sm font-medium text-foreground transition-colors hover:text-primary"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
