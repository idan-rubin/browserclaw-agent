'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { LlmConfigPanel, useLlmConfig } from '@/components/llm-config';
import { isLocalBrowserMode } from '@/lib/env';

const RUN_BUTTON_CLASS =
  'shrink-0 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none sm:px-6 sm:py-3 sm:text-base';

const EXAMPLES = [
  {
    label: 'NYC dinner tonight',
    prompt:
      'Find a table for 4 tonight at 8:30pm at a top NYC Italian restaurant — whichever has availability first among Carbone, Rezdora, or Raoul\u2019s. Report the restaurant, time, and booking link.',
  },
  {
    label: 'Window seat JFK→LAX',
    prompt:
      'Find the cheapest direct flight JFK to LAX next Tuesday with a window seat that is not in row 1 and not in an exit row. Report airline, flight number, time, price, and the exact seat.',
  },
  {
    label: 'Broadway seats Saturday',
    prompt:
      'This Saturday evening on Broadway: find the cheapest center-orchestra seat under $200 for any currently running show. Report the show, theater, row, seat, and price.',
  },
  {
    label: 'iPhone 17 Pro Max stock',
    prompt:
      'Find a Manhattan Apple Store with the iPhone 17 Pro Max 256GB in Natural Titanium available for pickup today. Report the store, nearest pickup time, and reservation link.',
  },
  {
    label: 'MTA subway status',
    prompt:
      'For every NYC subway line, report the current service status (good service / delays / alerts) with a one-line cause for any line that is not in good service.',
  },
];

type ModalStep = 'checking' | 'launching' | null;
type ModalState = { type: 'processing'; step: ModalStep } | { type: 'blocked'; reason: string } | null;

export default function TryPage() {
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
    requestAnimationFrame(() => {
      const style = getComputedStyle(el);
      const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const lineHeight = parseFloat(style.lineHeight) || 24;
      const oneRow = lineHeight + paddingY;
      const threeRows = lineHeight * 3 + paddingY;

      el.style.transition = 'none';
      el.style.height = '0';
      const contentHeight = el.scrollHeight;

      const hasText = el.value.length > 0;
      const target = hasText ? Math.min(Math.max(contentHeight, threeRows), 200) : oneRow;

      el.style.height = el.dataset.prevHeight ?? String(oneRow) + 'px';
      void el.offsetHeight;
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

  const hasApiKey = llm.apiKey.trim() !== '';

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
    <div className="relative min-h-screen flex flex-col overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 z-0 dot-grid" />

      <SiteHeader />

      {/* Prompt UI */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-4 sm:px-6">
        <div className="w-full max-w-3xl animate-page-in">
          <h1 className="text-center text-[2.5rem] font-bold leading-[1.1] tracking-tight sm:text-7xl lg:text-8xl">
            <span className="block">
              Let the agent <span className="italic text-primary">click&nbsp;through</span>
            </span>
            <span className="block">for you.</span>
          </h1>

          <p className="mx-auto mt-4 max-w-2xl text-center text-base text-muted-foreground sm:mt-6 sm:text-xl">
            <span className="inline sm:block">Compare apartments, find appointments, navigate bureaucracy.</span>{' '}
            <span className="inline sm:block">Describe the task. Watch a real browser do it live.</span>
          </p>

          <div className="mt-8 space-y-3 sm:mt-12">
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
                    const isMobile = 'ontouchstart' in window;
                    if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
                      e.preventDefault();
                      if (hasApiKey) void handleRun();
                    }
                  }}
                  placeholder="What do you want the browser to do?"
                  className="flex-1 resize-none overflow-hidden bg-transparent px-3 py-2.5 text-base text-foreground placeholder:text-muted-foreground/60 transition-[height] duration-200 ease-out focus:outline-none sm:px-4 sm:py-3 sm:text-lg"
                  style={{ maxHeight: '200px' }}
                  disabled={!!modal}
                />
                {!prompt.trim() && (
                  <button
                    onClick={() => {
                      void handleRun();
                    }}
                    disabled={!!modal || !hasApiKey}
                    className={RUN_BUTTON_CLASS}
                  >
                    Run
                  </button>
                )}
              </div>
              <div className="flex items-center justify-end gap-3 px-2 pt-1">
                {!hasApiKey && prompt.trim() && (
                  <span className="text-xs text-amber-500/80">Enter your API key below to run</span>
                )}
                <span className="hidden text-sm text-muted-foreground/40 sm:inline">Shift+Enter for new line</span>
                {prompt.trim() && (
                  <button
                    onClick={() => {
                      void handleRun();
                    }}
                    disabled={!!modal || !hasApiKey}
                    className={RUN_BUTTON_CLASS}
                  >
                    Run
                  </button>
                )}
              </div>
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

      {/* Footer */}
      <footer className="relative z-10 border-t border-border/50 px-4 py-6 sm:px-10 sm:py-8 mt-auto">
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
      </footer>

      {/* Processing Modal */}
      {modal?.type === 'processing' && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
        >
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
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
        >
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
