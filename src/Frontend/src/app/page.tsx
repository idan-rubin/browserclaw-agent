'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { LlmConfigPanel, useLlmConfig } from '@/components/llm-config';
import { isLocalBrowserMode } from '@/lib/env';

const RUN_BUTTON_CLASS =
  'shrink-0 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none sm:px-6 sm:py-3 sm:text-base';

const EXAMPLES = [
  {
    label: 'Apartments in Chelsea',
    prompt:
      'Search for pet-friendly apartments in Chelsea under $4,200 with laundry and elevator. List the top 5 buildings with price, address, and available units',
  },
  {
    label: 'Cheap flights to Barcelona',
    prompt:
      'Find the cheapest round-trip flight from JFK to Barcelona for June 15-22 2026. Compare at least 3 airlines and show price, duration, and number of stops for each',
  },
  {
    label: 'Best 4K monitor under $400',
    prompt:
      'Find a 4K monitor under $400 with USB-C, at least 27 inches, and 4+ star rating. Compare the top 3 options by price, screen size, refresh rate, and number of reviews',
  },
  {
    label: "Renew my NY driver's license",
    prompt:
      "Find the documents needed to renew a driver's license in New York state. List the ID requirements, fees, and whether it can be done online or requires an in-person visit",
  },
  {
    label: 'Compare Medicare plans',
    prompt:
      'Compare Medicare Advantage plans available in zip code 10001. List the top 3 plans by monthly premium, showing plan name, insurer, monthly cost, and whether they cover dental',
  },
];

type ModalStep = 'checking' | 'launching' | null;
type ModalState = { type: 'processing'; step: ModalStep } | { type: 'blocked'; reason: string } | null;

export default function HomePage() {
  const [prompt, setPrompt] = useState('');
  const [modal, setModal] = useState<ModalState>(null);
  const [modalElapsed, setModalElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const llm = useLlmConfig();

  useEffect(() => {
    if (modal?.type !== 'processing') {
      const resetTimer = setTimeout(() => {
        setModalElapsed(0);
      }, 0);
      return () => {
        clearTimeout(resetTimer);
      };
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setModalElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [modal?.type]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Use rAF so React's value update is flushed first
    requestAnimationFrame(() => {
      const style = getComputedStyle(el);
      const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const lineHeight = parseFloat(style.lineHeight) || 24;
      const oneRow = lineHeight + paddingY;
      const threeRows = lineHeight * 3 + paddingY;

      // Measure content height by temporarily collapsing
      el.style.transition = 'none';
      el.style.height = '0';
      const contentHeight = el.scrollHeight; // includes padding

      // Determine target: 1 row if empty, at least 3 rows if has text, or content height if more
      const hasText = el.value.length > 0;
      const target = hasText ? Math.min(Math.max(contentHeight, threeRows), 200) : oneRow;

      // Restore previous height, force reflow, then animate to target
      el.style.height = el.dataset.prevHeight ?? String(oneRow) + 'px';
      void el.offsetHeight; // force reflow before re-enabling transition
      el.style.transition = '';
      el.style.height = String(target) + 'px';
      el.dataset.prevHeight = String(target) + 'px';
    });
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('prompt');
    if (q != null && q !== '') {
      const timer = setTimeout(() => {
        setPrompt(q);
        requestAnimationFrame(autoResize);
      }, 0);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [autoResize]);

  const hasApiKey = !!llm.apiKey.trim();

  async function handleRun(skipModeration = false) {
    const trimmed = prompt.trim();
    if (!trimmed || !hasApiKey) return;

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setModal({ type: 'processing', step: isLocalBrowserMode() ? 'launching' : 'checking' });

    try {
      const llmConfig = llm.getConfig();
      const res = await fetch('/api/v1/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: trimmed,
          skip_moderation: isLocalBrowserMode() || skipModeration,
          ...(llmConfig ? { llm_config: llmConfig } : {}),
        }),
        signal: abort.signal,
      });

      const data = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        const rawMsg = data.message ?? data.error;
        const msg = typeof rawMsg === 'string' ? rawMsg : 'Something went wrong';
        if (msg.toLowerCase().includes('blocked') || msg.toLowerCase().includes('policy')) {
          setModal({ type: 'blocked', reason: msg });
        } else {
          setModal(null);
          const params = new URLSearchParams({ error: msg, prompt: trimmed });
          if (res.status === 503)
            params.set('detail', 'The browser service is temporarily unavailable. Please try again in a moment.');
          router.push(`/run/error?${params.toString()}`);
        }
        return;
      }

      setModal({ type: 'processing', step: 'launching' });
      await new Promise((r) => setTimeout(r, 600));
      router.push(`/run/${String(data.session_id)}`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setModal(null);
      const params = new URLSearchParams({
        error: 'Failed to connect',
        detail: 'Could not reach the server. Check your connection and try again.',
        prompt: prompt.trim(),
      });
      router.push(`/run/error?${params.toString()}`);
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col">
      <div className="pointer-events-none fixed inset-0 z-0 dot-grid" />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-10 sm:py-5">
        <Link href="/" className="font-[family-name:var(--font-heading)] text-lg sm:text-xl tracking-tight">
          browserclaw
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
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 sm:px-6">
        <div className="w-full max-w-3xl animate-page-in">
          <h1 className="text-center text-[2.5rem] font-bold leading-[1.1] tracking-tight sm:text-7xl lg:text-8xl">
            Let the agent <span className="italic text-primary">click&nbsp;through</span>
            <br />
            for you.
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-center text-base text-muted-foreground sm:mt-6 sm:text-xl">
            Compare apartments, find appointments, navigate bureaucracy.
            <br className="hidden sm:block" />
            Describe the task. Watch a real browser do it live.
          </p>

          <div className="mt-8 space-y-3 sm:mt-12">
            {/* Mobile: stacked layout. Desktop: side by side */}
            <div className="group rounded-2xl border border-border bg-card/60 p-2 backdrop-blur-sm transition-colors focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20">
              <div className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    autoResize();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (hasApiKey) void handleRun();
                    }
                  }}
                  placeholder="What do you want the browser to do?"
                  className="flex-1 resize-none overflow-hidden bg-transparent px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground/60 transition-[height] duration-200 ease-out focus:outline-none sm:px-4 sm:py-3 sm:text-lg"
                  style={{ maxHeight: '200px' }}
                  disabled={!!modal}
                />
                {!prompt && (
                  <button
                    onClick={() => {
                      void handleRun();
                    }}
                    disabled={!!modal || !prompt.trim() || !hasApiKey}
                    className={RUN_BUTTON_CLASS}
                  >
                    Run
                  </button>
                )}
              </div>
              {prompt && (
                <div className="flex items-center justify-end gap-3 px-2 pt-1">
                  {hasApiKey ? (
                    <span className="hidden text-sm text-muted-foreground/50 sm:inline">Shift+Enter for new line</span>
                  ) : (
                    <span className="text-xs text-amber-500/80">Enter your API key below to run</span>
                  )}
                  <button
                    onClick={() => {
                      void handleRun();
                    }}
                    disabled={!!modal || !prompt.trim() || !hasApiKey}
                    className={RUN_BUTTON_CLASS}
                  >
                    Run
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* LLM Config */}
          <div className="mt-3 px-1">
            <LlmConfigPanel
              provider={llm.provider}
              setProvider={llm.setProvider}
              model={llm.model}
              setModel={llm.setModel}
              apiKey={llm.apiKey}
              setApiKey={llm.setApiKey}
            />
          </div>

          {/* Example chips */}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example.label}
                onClick={() => {
                  setPrompt(example.prompt);
                  requestAnimationFrame(autoResize);
                  textareaRef.current?.focus();
                }}
                className="rounded-full border border-border/60 px-3 py-1.5 text-xs text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground sm:text-sm"
              >
                {example.label}
              </button>
            ))}
          </div>
        </div>
      </main>

      {/* Built With / Inspired By */}
      <section className="relative z-10 py-10 sm:py-16">
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

      {/* Bottom CTA */}
      <section className="relative z-10 flex flex-col items-center gap-6 pb-20 pt-4 sm:gap-8 sm:pb-32 sm:pt-8">
        <h2 className="text-center text-3xl font-bold tracking-tight sm:text-5xl">Stop clicking. Start describing.</h2>
        <button
          onClick={() => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            setTimeout(() => textareaRef.current?.focus(), 400);
          }}
          className="rounded-xl bg-primary px-8 py-4 text-base font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97]"
        >
          Try it now
        </button>
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

      {/* Processing Modal */}
      {modal?.type === 'processing' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Starting run</h3>
            <div className="mt-5 space-y-4">
              <ModalStepRow
                label="Checking prompt..."
                state={modal.step === 'checking' ? 'active' : 'done'}
                elapsedSeconds={modal.step === 'checking' ? modalElapsed : undefined}
              />
              <ModalStepRow
                label="Launching browser..."
                state={launchStepState(modal.step)}
                elapsedSeconds={modal.step === 'launching' ? modalElapsed : undefined}
              />
            </div>
            <button
              onClick={() => {
                abortRef.current?.abort();
                setModal(null);
                const params = new URLSearchParams({ error: 'Run cancelled', prompt: prompt.trim() });
                router.push(`/run/error?${params.toString()}`);
              }}
              className="mt-5 w-full rounded-xl border-2 border-red-600 bg-red-600/10 py-2 text-sm font-semibold text-red-500 transition-all hover:bg-red-600/20"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Blocked Modal */}
      {modal?.type === 'blocked' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0 rounded-full bg-amber-500/10 p-2 text-amber-500">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Prompt flagged</h3>
                <p className="mt-1 text-sm text-muted-foreground">{modal.reason}</p>
              </div>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              If you believe this is a false positive, you can proceed anyway.
            </p>
            <div className="mt-5 flex gap-3 justify-end">
              <button
                onClick={() => {
                  setModal(null);
                }}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void handleRun(true);
                }}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
              >
                Proceed anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function launchStepState(currentStep: ModalStep): 'pending' | 'active' | 'done' {
  if (currentStep === 'launching') return 'active';
  if (currentStep === 'checking') return 'pending';
  return 'done';
}

function stepTextColor(state: 'pending' | 'active' | 'done'): string {
  switch (state) {
    case 'pending':
      return 'text-muted-foreground/50';
    case 'active':
      return 'text-foreground';
    case 'done':
      return 'text-muted-foreground';
  }
}

function ModalStepRow({
  label,
  state,
  elapsedSeconds,
}: {
  label: string;
  state: 'pending' | 'active' | 'done';
  elapsedSeconds?: number;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      {state === 'pending' && <div className="h-5 w-5 rounded-full border-2 border-border" />}
      {state === 'active' && (
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      )}
      {state === 'done' && (
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500/20 text-green-500">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      )}
      <span className={`text-sm ${stepTextColor(state)}`}>{label}</span>
      {state === 'active' && elapsedSeconds != null && elapsedSeconds > 0 && (
        <span className="ms-auto font-[family-name:var(--font-jetbrains-mono)] text-xs tabular-nums text-muted-foreground">
          {elapsedSeconds}s
        </span>
      )}
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
