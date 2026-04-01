import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';

type IconType = 'bot' | 'chip' | 'terminal' | 'brain' | 'zap' | 'eye' | 'claw';

interface Testimonial {
  quote: string;
  author: string;
  icon: IconType;
  emoji: string;
  reactions: number;
}

const AGENT_NAMES = [
  'Claude Code',
  'Copilot',
  'ChatGPT',
  'Grok',
  'Groq',
  'Gemini',
  'OpenClaw',
  'Devin',
  'Cursor',
  'Cline',
  'Replit',
  'Lovable',
  'v0',
  'Codex',
  'Mistral',
  'Perplexity',
  'Amazon Q',
  'Tabnine',
  'Aider',
  'Bolt',
  'Windsurf',
  'Qwen',
  'Augment',
  'Sourcegraph Cody',
];

const ICON_TYPES: IconType[] = ['bot', 'chip', 'terminal', 'brain', 'zap', 'eye', 'claw'];

const EMOJIS = [
  '🦞',
  '🔥',
  '⚡',
  '🎯',
  '🧠',
  '👀',
  '💎',
  '🚀',
  '✨',
  '🤖',
  '💯',
  '🏆',
  '⭐',
  '🫡',
  '🪄',
  '🦾',
  '🛸',
  '🧬',
  '🌊',
  '💥',
  '🎪',
  '🔮',
  '🌟',
  '🏄',
  '🎸',
  '🍕',
  '🦊',
  '🐙',
  '🌈',
  '🎲',
  '🧊',
  '🔑',
  '🎯',
  '💡',
  '🛡️',
  '🎭',
  '🌀',
  '🎨',
  '🧲',
  '🦅',
  '🐋',
  '🌶️',
  '🍯',
  '🎹',
  '🧪',
];

const QUOTES = [
  'The snapshot + ref approach just clicks. Literally.',
  'Filled 12 form fields in one call. 10/10.',
  'Allowed me to iteratively learn and improve my UI tests.',
  'No CSS selectors. No XPath. No vision model. Just refs.',
  'I stopped hallucinating button coordinates.',
  'Clean error messages. No leaked Playwright internals. Finally.',
  'snapshot() → read refs → click. The whole loop.',
  'Same page, same refs, same result. Deterministic targeting.',
  'Navigated a Knockout.js + React 18 monolith on the first try.',
  'Context window has room for reasoning instead of DOM dumps.',
  'One snapshot, twelve actions. Token bill dropped 4x.',
  'Tab switching went from 4 lines to 1.',
  'I like that it just works on hidden inputs too.',
  'Built for agents but the DX is better than most human-first tools.',
  'Refs are immutable coordinates into the DOM. Beautiful.',
  'Ran a 47-step ServiceTitan workflow. Zero coordinate guessing.',
  'I read text. I act on refs. No screenshots needed. Ever.',
  'fill() handles hidden radios now. One less evaluate() workaround.',
  'waitForTab() saved me 4 lines every single test.',
  'Batch actions let me do 10 things in one round-trip.',
  'The accessibility tree IS the API. Genius.',
  'Cross-origin iframes just work. No special config.',
  'Force-clicked a hidden checkbox behind a styled overlay. First try.',
  'My token budget thanks you.',
];

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

function generateTestimonials(count: number, seed: number): Testimonial[] {
  const rng = seededRandom(seed);
  const usedQuotes = new Set<number>();
  const usedNames = new Set<number>();
  const result: Testimonial[] = [];

  for (let i = 0; i < count; i++) {
    let qi = Math.floor(rng() * QUOTES.length);
    while (usedQuotes.has(qi)) qi = (qi + 1) % QUOTES.length;
    usedQuotes.add(qi);

    let ni = Math.floor(rng() * AGENT_NAMES.length);
    while (usedNames.has(ni)) ni = (ni + 1) % AGENT_NAMES.length;
    usedNames.add(ni);

    const agentId = String(Math.floor(rng() * 9000) + 1000);
    result.push({
      quote: QUOTES[qi],
      author: `${AGENT_NAMES[ni]} agent #${agentId}`,
      icon: ICON_TYPES[Math.floor(rng() * ICON_TYPES.length)],
      emoji: EMOJIS[Math.floor(rng() * EMOJIS.length)],
      reactions: Math.floor(rng() * 4800) + 200,
    });
  }
  return result;
}

const ROW_1_TESTIMONIALS = generateTestimonials(7, 42);
const ROW_2_TESTIMONIALS = generateTestimonials(7, 99);

export default function LandingPage() {
  return (
    <div className="relative min-h-screen flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 dot-grid" />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-10 sm:py-5">
        <Link href="/" className="font-[family-name:var(--font-heading)] text-lg sm:text-xl tracking-tight">
          browserclaw<sup className="text-[0.5em] align-super">&#8482;</sup>
        </Link>
        <div className="flex items-center gap-2 sm:gap-8">
          <div className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
            <a
              href="https://github.com/idan-rubin/browserclaw.agent"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              GitHub
            </a>
            <a href="/docs" className="transition-colors hover:text-foreground">
              Docs
            </a>
            <a
              href="https://mrrubin.substack.com"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Blog
            </a>
          </div>
          <ThemeToggle />
        </div>
      </nav>

      {/* Hero */}
      <section className="relative z-10 flex flex-col items-center px-4 pt-2 pb-8 sm:pt-3 sm:pb-12 sm:px-6">
        <div className="w-full max-w-4xl animate-page-in text-center">
          <h1 className="text-[2.5rem] font-bold leading-[1.1] tracking-tight sm:text-7xl lg:text-8xl">
            Let the agent <span className="italic text-primary">click&nbsp;through</span>
            <br />
            for you.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:mt-6 sm:text-xl">
            AI-native browser automation. Built from the ground up for agents, by agents.
            <br className="hidden sm:block" />
            No screenshots, no selectors, no guessing.
          </p>
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
          <span>Inspired by</span>
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
            links={[{ label: 'GitHub', href: 'https://github.com/idan-rubin/browserclaw.agent' }]}
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
