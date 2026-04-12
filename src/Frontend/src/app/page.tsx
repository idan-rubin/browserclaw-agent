import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { type IconType, type Testimonial, generateTestimonials } from './testimonials-data';

const ROW_1_TESTIMONIALS = generateTestimonials(7, 42);
const ROW_2_TESTIMONIALS = generateTestimonials(7, 99);

export default function LandingPage() {
  return (
    <div className="relative min-h-screen flex flex-col overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 z-0 dot-grid" />

      <SiteHeader />

      {/* Hero */}
      <section className="relative z-10 flex flex-col items-center px-4 pt-2 pb-8 sm:pt-3 sm:pb-12 sm:px-6">
        <div className="w-full max-w-4xl animate-page-in text-center">
          <h1 className="text-[2.5rem] font-bold leading-[1.1] tracking-tight sm:text-7xl lg:text-8xl">
            <div>
              Let the agent <span className="italic text-primary">click&nbsp;through</span>
            </div>
            <div>for you.</div>
          </h1>
          <div className="mx-auto mt-4 max-w-2xl space-y-2 text-[0.938rem] leading-relaxed text-muted-foreground sm:mt-6 sm:space-y-2 sm:text-xl sm:leading-normal">
            <div>
              <div className="block sm:inline">AI-native browser automation,</div>{' '}
              <div className="block sm:inline">built for agents, by agents.</div>
            </div>
            <div>
              <div className="block sm:inline">Born from OpenClaw.</div>{' '}
              <div className="block sm:inline">Snapshots instead of vision,</div>{' '}
              <div className="block sm:inline">refs instead of selectors, no guessing.</div>
            </div>
          </div>
          <div className="mt-8 flex flex-row items-center justify-center gap-3 sm:mt-10 sm:gap-6">
            <Link
              href="/try"
              className="rounded-xl bg-primary px-6 py-3 text-base font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97] sm:px-8 sm:py-4"
            >
              Try it live
            </Link>
            <a
              href="https://github.com/idan-rubin/browserclaw"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-xl border border-border px-6 py-3 text-base font-semibold text-foreground transition-all hover:bg-card/60 sm:px-8 sm:py-4"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* What Agents Say */}
      <section className="relative z-10 pt-4 pb-16 sm:pt-6 sm:pb-24">
        <div className="mb-10 text-center sm:mb-14">
          <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">
            What Agents <span className="italic text-primary">Say</span>
          </h2>
          <p className="mt-3 text-sm text-muted-foreground sm:text-base">
            Built for agents. Loved by agents. Humans welcome too.
          </p>
        </div>

        <div className="marquee-container space-y-4">
          {/* Row 1 — scrolls left */}
          <div className="marquee-mask overflow-hidden">
            <div className="marquee-track marquee-left">
              {[...ROW_1_TESTIMONIALS, ...ROW_1_TESTIMONIALS].map((t, i) => (
                <TestimonialCard key={`r1-${String(i)}`} {...t} />
              ))}
            </div>
          </div>

          {/* Row 2 — scrolls right */}
          <div className="marquee-mask overflow-hidden">
            <div className="marquee-track marquee-right">
              {[...ROW_2_TESTIMONIALS, ...ROW_2_TESTIMONIALS].map((t, i) => (
                <TestimonialCard key={`r2-${String(i)}`} {...t} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Product Cards */}
      <section className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-6 sm:px-10 sm:pb-10">
        <div className="grid gap-4 sm:gap-6 sm:grid-cols-3">
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
      <section className="relative z-10 mx-auto w-full max-w-5xl px-4 py-12 sm:px-10 sm:py-20">
        <div className="mb-10 text-center sm:mb-14">
          <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">
            Layered, <span className="italic text-primary">not bundled</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground sm:mt-4 sm:text-base">
            browser-use welds these into one package. We keep them separate — drop the library into your own agent, pair
            this agent with any LLM, or run the whole stack as-is.
          </p>
        </div>

        <div className="mx-auto flex max-w-2xl flex-col items-stretch">
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
      </section>

      {/* vs browser-use */}
      <section className="relative z-10 mx-auto w-full max-w-4xl px-4 pb-12 sm:px-10 sm:pb-20">
        <div className="mb-8 text-center sm:mb-12">
          <h2 className="text-3xl font-bold tracking-tight sm:text-5xl">
            vs <span className="italic text-primary">browser-use</span>
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Different lineage, different design.{' '}
            <a
              href="https://openclaw.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground/90 underline decoration-border/70 underline-offset-4 transition-colors hover:decoration-foreground"
            >
              OpenClaw
            </a>{' '}
            took the{' '}
            <a
              href="https://github.com/microsoft/playwright-mcp"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground/90 underline decoration-border/70 underline-offset-4 transition-colors hover:decoration-foreground"
            >
              Playwright MCP
            </a>{' '}
            snapshot-and-ref approach, refined it locally, and shipped it as a standalone library. browser-use rolled
            its own Python bundle.
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-border/50 bg-card/40 backdrop-blur-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-card/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground sm:px-6"></th>
                <th className="px-4 py-3 text-center font-medium text-primary sm:px-6">browserclaw</th>
                <th className="px-4 py-3 text-center font-medium text-muted-foreground sm:px-6">browser-use</th>
              </tr>
            </thead>
            <tbody className="text-muted-foreground">
              <BuRow label="Browser engine as a standalone library" us="yes" them="no" />
              <BuRow label="Use the engine with a different agent" us="yes" them="partial" />
              <BuRow label="Auto-learned skill catalog per domain" us="yes" them="no" />
              <BuRow label="Built-in anti-bot solvers in OSS (Turnstile, press-hold)" us="yes" them="partial" />
              <BuRow label="TypeScript / Node native" us="yes" them="no" />
            </tbody>
          </table>
        </div>

        <p className="mx-auto mt-4 max-w-2xl text-center text-xs text-muted-foreground/60">
          Every row sourced from{' '}
          <a
            href="https://github.com/browser-use/browser-use"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-border/50 underline-offset-4 transition-colors hover:text-foreground"
          >
            browser-use&apos;s repo at HEAD
          </a>
          . Full citations in the{' '}
          <a
            href="https://github.com/idan-rubin/browserclaw-agent#vs-browser-use"
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-border/50 underline-offset-4 transition-colors hover:text-foreground"
          >
            README
          </a>
          .
        </p>
      </section>

      {/* Built With / Inspired By */}
      <section className="relative z-10 py-8 sm:py-12">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs sm:text-sm text-muted-foreground/50 sm:gap-x-8">
          <span>Built with</span>
          <a
            href="https://github.com/idan-rubin/browserclaw"
            target="_blank"
            rel="noopener noreferrer"
            className="font-[family-name:var(--font-heading)] text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            BrowserClaw
          </a>
          <span className="text-muted-foreground/30">&middot;</span>
          <span>Born from</span>
          <a
            href="https://openclaw.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="font-[family-name:var(--font-heading)] text-muted-foreground/70 transition-colors hover:text-foreground"
          >
            OpenClaw
          </a>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="relative z-10 flex flex-col items-center gap-6 pb-20 pt-4 sm:gap-8 sm:pb-32 sm:pt-8">
        <h2 className="text-center text-3xl font-bold tracking-tight sm:text-5xl">Stop clicking. Start describing.</h2>
        <Link
          href="/try"
          className="rounded-xl bg-primary px-8 py-4 text-base font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97]"
        >
          Try it now
        </Link>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/50 px-4 py-10 sm:px-10 sm:py-16">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 sm:grid-cols-4 sm:gap-10">
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
              { label: 'OpenClaw', href: 'https://openclaw.ai' },
              { label: 'npm', href: 'https://www.npmjs.com/package/browserclaw' },
            ]}
          />
          <FooterColumn
            title="Connect"
            links={[{ label: 'GitHub', href: 'https://github.com/idan-rubin/browserclaw-agent' }]}
          />
        </div>
        <div className="mx-auto mt-12 max-w-6xl text-sm text-muted-foreground/40">
          &copy; {new Date().getFullYear()} browserclaw.org
        </div>
      </footer>
    </div>
  );
}

function Card({ title, description, icon }: { title: string; description: string; icon: React.ReactNode }) {
  return (
    <div className="group rounded-2xl border border-border/50 bg-card/40 p-5 sm:p-8 backdrop-blur-sm transition-colors hover:border-primary/20 hover:bg-card/60">
      <div className="mb-5 inline-flex rounded-xl bg-primary/10 p-3 text-primary transition-colors group-hover:bg-primary/15">
        {icon}
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
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
    <div className="w-[320px] shrink-0 rounded-2xl border border-border/50 bg-card/40 p-5 backdrop-blur-sm transition-colors hover:border-primary/20 hover:bg-card/60 sm:w-[380px]">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-primary/40">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 0 1-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z" />
          </svg>
        </div>
        <span className="text-lg">{emoji}</span>
      </div>
      <p className="text-sm leading-relaxed text-foreground/90">{quote}</p>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            {AGENT_ICONS[icon]}
          </div>
          <span className="font-[family-name:var(--font-jetbrains-mono)] text-xs text-muted-foreground">{author}</span>
        </div>
        <span className="text-[10px] text-muted-foreground/40">🤖 {reactions.toLocaleString()}</span>
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
    <div className="flex items-center gap-4 rounded-2xl border border-border/50 bg-card/40 p-4 backdrop-blur-sm transition-colors hover:border-primary/20 hover:bg-card/60 sm:gap-6 sm:p-6">
      <div className="text-3xl sm:text-4xl" aria-hidden>
        {emoji}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <h3 className="font-[family-name:var(--font-heading)] text-base font-semibold tracking-tight sm:text-lg">
            {name}
          </h3>
          {link && (
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary/80 transition-colors hover:text-primary"
            >
              {link.label}
            </a>
          )}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function LayerConnector() {
  return <div className="mx-auto my-1 h-3 w-px bg-border/60" aria-hidden />;
}

type BuMark = 'yes' | 'no' | 'partial';

function BuRow({ label, us, them }: { label: string; us: BuMark; them: BuMark }) {
  return (
    <tr className="border-b border-border/30 last:border-b-0">
      <td className="px-4 py-3 text-foreground sm:px-6">{label}</td>
      <td className="px-4 py-3 text-center sm:px-6">
        <BuMarkIcon value={us} />
      </td>
      <td className="px-4 py-3 text-center sm:px-6">
        <BuMarkIcon value={them} />
      </td>
    </tr>
  );
}

function BuMarkIcon({ value }: { value: BuMark }) {
  switch (value) {
    case 'yes':
      return <span className="text-green-400">&#10003;</span>;
    case 'partial':
      return <span className="text-yellow-400">~</span>;
    case 'no':
      return <span className="text-red-400">&#10005;</span>;
  }
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h4 className="mb-4 text-sm font-semibold tracking-wide text-foreground/80">{title}</h4>
      <ul className="space-y-2.5">
        {links.map((link) => (
          <li key={link.label}>
            <a
              href={link.href}
              target={link.href.startsWith('http') ? '_blank' : undefined}
              rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
