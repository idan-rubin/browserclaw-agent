'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLlmConfig, LlmConfigPanel, type LlmConfig } from '@/components/llm-config';
import { ComparePanel, type TerminalStatus } from '@/components/compare/compare-panel';
import { BrowserClawWordmark } from '@/components/browserclaw-wordmark';
import { logger } from '@/lib/logger';

interface Side {
  key: 'browserclaw' | 'browser-use';
  label: string;
  apiBase: string;
  vncBase: string;
}

const SIDES: Side[] = [
  { key: 'browserclaw', label: 'browserclaw', apiBase: '/api/v1/runs', vncBase: '/vnc' },
  { key: 'browser-use', label: 'browser-use', apiBase: '/api/v1/bu-runs', vncBase: '/vnc-bu' },
];

const SHARED_PROVIDERS: readonly LlmConfig['provider'][] = ['anthropic', 'openai', 'gemini'];
const DEFAULT_PROVIDER: LlmConfig['provider'] = 'anthropic';

interface SideState {
  sessionId: string | null;
  terminal: TerminalStatus | null;
  error: string | null;
}

type SidesState = Record<Side['key'], SideState>;

const emptySide: SideState = { sessionId: null, terminal: null, error: null };
const emptyBoth: SidesState = { browserclaw: { ...emptySide }, 'browser-use': { ...emptySide } };

async function startRun(apiBase: string, prompt: string, llmConfig: LlmConfig | undefined): Promise<string> {
  const body: Record<string, unknown> = {
    prompt,
    skip_moderation: true,
    skip_postprocessing: true,
  };
  if (llmConfig !== undefined) body.llm_config = llmConfig;
  const res = await fetch(apiBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(data.message ?? data.error ?? `HTTP ${String(res.status)}`);
  }
  const data = (await res.json()) as { session_id?: string };
  if (data.session_id == null) throw new Error('Missing session_id');
  return data.session_id;
}

async function cancelRun(apiBase: string, sessionId: string): Promise<void> {
  try {
    await fetch(`${apiBase}/${sessionId}`, { method: 'DELETE' });
  } catch (err) {
    logger.warn({ err, apiBase, sessionId }, 'cancelRun failed');
  }
}

export function CompareClient() {
  const [prompt, setPrompt] = useState('');
  const [launching, setLaunching] = useState(false);
  const [states, setStates] = useState(emptyBoth);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const llm = useLlmConfig();
  const winnerDeclared = useRef(false);
  const statesRef = useRef(emptyBoth);
  useEffect(() => {
    statesRef.current = states;
  }, [states]);

  const { provider: llmProvider, setProvider: llmSetProvider } = llm;
  useEffect(() => {
    if (!SHARED_PROVIDERS.includes(llmProvider)) {
      llmSetProvider(DEFAULT_PROVIDER);
    }
  }, [llmProvider, llmSetProvider]);

  const hasApiKey = llm.apiKey.trim() !== '';
  const hasActiveSession = states.browserclaw.sessionId !== null || states['browser-use'].sessionId !== null;
  const bothTerminal = states.browserclaw.terminal !== null && states['browser-use'].terminal !== null;
  const running = launching || (hasActiveSession && !bothTerminal);
  const canRun = !running && prompt.trim() !== '' && hasApiKey;

  const handleTerminal = useCallback(
    (side: Side['key']) => (status: TerminalStatus) => {
      setStates((prev) => ({ ...prev, [side]: { ...prev[side], terminal: status } }));
      if (winnerDeclared.current) return;
      winnerDeclared.current = true;
      const loser = SIDES.find((s) => s.key !== side);
      if (loser === undefined) return;
      const loserState = statesRef.current[loser.key];
      if (loserState.sessionId !== null && loserState.terminal === null) {
        void cancelRun(loser.apiBase, loserState.sessionId);
      }
    },
    [],
  );

  async function handleRun() {
    if (!canRun) return;
    setLaunching(true);
    setLaunchError(null);
    winnerDeclared.current = false;
    setStates(emptyBoth);

    const trimmed = prompt.trim();
    const llmConfig = llm.getConfig();

    const [bcRes, buRes] = await Promise.allSettled([
      startRun('/api/v1/runs', trimmed, llmConfig),
      startRun('/api/v1/bu-runs', trimmed, llmConfig),
    ]);

    const toState = (res: PromiseSettledResult<string>): SideState =>
      res.status === 'fulfilled'
        ? { sessionId: res.value, terminal: null, error: null }
        : {
            sessionId: null,
            terminal: 'failed',
            error: res.reason instanceof Error ? res.reason.message : 'failed to start',
          };

    setStates({ browserclaw: toState(bcRes), 'browser-use': toState(buRes) });
    setLaunching(false);

    if (bcRes.status === 'rejected' && buRes.status === 'rejected') {
      setLaunchError('Both services are unavailable');
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Prompt bar */}
      <div className="shrink-0 border-b border-border/50 bg-background/95 px-3 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/"
              className="flex items-center gap-2 text-sm tracking-tight text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Back to home"
            >
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
                <polyline points="15 18 9 12 15 6" />
              </svg>
              <BrowserClawWordmark />
            </Link>
            <span className="rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              internal
            </span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
                  e.preventDefault();
                  if (canRun) void handleRun();
                }
              }}
              rows={2}
              placeholder="Same prompt, both agents, same model."
              className="flex-1 resize-none rounded-xl border border-border bg-card/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
              disabled={running}
            />
            <button
              onClick={() => {
                void handleRun();
              }}
              disabled={!canRun}
              className="shrink-0 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50 disabled:pointer-events-none"
            >
              {running ? 'Running\u2026' : bothTerminal ? 'Run again' : 'Run'}
            </button>
          </div>
          <LlmConfigPanel
            provider={llm.provider}
            setProvider={llm.setProvider}
            model={llm.model}
            setModel={llm.setModel}
            apiKey={llm.apiKey}
            setApiKey={llm.setApiKey}
            allowedProviders={SHARED_PROVIDERS}
          />
          {launchError !== null && <p className="text-xs text-red-400">{launchError}</p>}
          {!hasApiKey && <p className="text-xs text-amber-500/80">Enter your API key above to run.</p>}
        </div>
      </div>

      {/* Two panels — side-by-side on desktop, stacked on mobile */}
      <div className="grid flex-1 grid-cols-1 gap-px overflow-hidden bg-border/30 md:grid-cols-2">
        {SIDES.map((side) => {
          const state = states[side.key];
          return (
            <div key={side.key} className="min-h-0 overflow-hidden">
              {state.sessionId !== null ? (
                <ComparePanel
                  sessionId={state.sessionId}
                  apiBase={side.apiBase}
                  vncBase={side.vncBase}
                  label={side.label}
                  onTerminal={handleTerminal(side.key)}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center bg-black/90 px-4 text-center">
                  <span className="font-[family-name:var(--font-heading)] text-xl text-foreground/70">
                    {side.label}
                  </span>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {state.error ?? (running ? 'Launching\u2026' : 'Waiting for prompt')}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
