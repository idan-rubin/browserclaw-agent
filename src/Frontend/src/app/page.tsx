import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { AgentViewToggle } from '@/components/agent-view-toggle';
import { HeroDemoMock } from '@/components/hero-demo-mock';

export default function LandingPage() {
  return (
    <AgentViewToggle>
      <div className="relative min-h-screen flex flex-col overflow-x-hidden">
        <div className="pointer-events-none fixed inset-0 z-0 dot-grid" />

        <SiteHeader />

        {/* Hero */}
        <section className="relative z-10 flex-1 px-4 py-10 sm:px-10 sm:py-16">
          <div className="mx-auto grid max-w-6xl animate-page-in items-center gap-10 md:grid-cols-2 md:gap-16">
            <div>
              <p className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-[0.2em] text-primary">
                browserclaw
              </p>
              <h1 className="mt-5 font-[family-name:var(--font-heading)] text-5xl font-normal leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
                Let the agent <span className="italic text-primary">click&nbsp;through</span>
                <br />
                for you.
              </h1>
              <p className="mt-5 max-w-md text-base text-muted-foreground sm:text-lg">
                Describe the task. Watch a real browser do it live. Get a reusable skill back. Accessibility snapshots
                instead of vision — no brittle selectors, no guessing.
              </p>
              <div className="mt-7 flex flex-row items-center gap-3 sm:gap-4">
                <Link
                  href="/try"
                  className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97] sm:text-base"
                >
                  Try it live
                </Link>
                <a
                  href="https://github.com/idan-rubin/browserclaw"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-[family-name:var(--font-jetbrains-mono)] text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
                >
                  View library &rarr;
                </a>
              </div>
            </div>
            <HeroDemoMock />
          </div>
        </section>

        {/* Claims row */}
        <section className="relative z-10 border-t border-border/40 px-4 py-10 sm:px-10 sm:py-14">
          <div className="mx-auto grid max-w-6xl gap-8 sm:grid-cols-2 md:grid-cols-4 md:gap-10">
            <Claim
              title="Accessibility-first"
              body="browserclaw reads a11y snapshots, not pixels. Stable refs, no selector rot."
            />
            <Claim
              title="Skills that compound"
              body="Every successful run exports a reusable skill. The library gets smarter over time."
            />
            <Claim
              title="Open-source library"
              body="browserclaw is MIT on npm. Drop it into your own agent — no lock-in."
            />
            <Claim
              title="BYOK, any LLM"
              body="Claude, GPT, Gemini — bring your own key. We're the driver, not the model."
            />
          </div>
        </section>

        {/* Footer */}
        <footer className="relative z-10 border-t border-border/50 px-4 py-10 sm:px-10 sm:py-16">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 sm:grid-cols-4 sm:gap-10">
            <FooterColumn
              title="Product"
              links={[
                { label: 'Try it live', href: '/try' },
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
    </AgentViewToggle>
  );
}

function Claim({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <p className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-[0.2em] text-foreground/90">
        {title}
      </p>
      <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{body}</p>
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
