'use client';

/**
 * ComparePanel — one side of the comparison page.
 *
 * Owns its own SSE subscription and HUD. Agnostic to which backend it talks
 * to: pass `apiBase` = "/api/v1/runs" or "/api/v1/bu-runs". Both backends
 * emit the same event envelope; whichever events a backend actually sends
 * are the ones that render. Pills are purely event-driven — a backend that
 * doesn't emit skill events simply doesn't show those pills.
 *
 * Emits a single callback — `onTerminal('completed' | 'failed')` — so the
 * parent can cancel the other side under the first-terminal-wins rule.
 */

import { useEffect, useRef, useState } from 'react';

export type TerminalStatus = 'completed' | 'failed';

interface Pill {
  id: number;
  label: string;
  expires: number;
}

interface ComparePanelProps {
  sessionId: string | null;
  apiBase: string;
  vncBase: string;
  label: string;
  onTerminal: (status: TerminalStatus, detail?: string) => void;
}

const PILL_LIFETIME_MS = 4000;
const HANG_DETECT_MS = 60_000;

function parse(e: MessageEvent): Record<string, unknown> | undefined {
  try {
    return JSON.parse(String(e.data)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

const SKILL_ACTION_PILL: Record<string, string | undefined> = {
  click_cloudflare: 'cloudflare solved',
  press_and_hold: 'anti-bot solved',
};

export function ComparePanel({ sessionId, apiBase, vncBase, label, onTerminal }: ComparePanelProps) {
  const [step, setStep] = useState(0);
  const [tokens, setTokens] = useState({ input: 0, output: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<'pending' | 'running' | TerminalStatus>('pending');
  const [error, setError] = useState<string | null>(null);
  const [pills, setPills] = useState<Pill[]>([]);
  const pillIdRef = useRef(0);
  const onTerminalRef = useRef(onTerminal);
  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  // noVNC expects the websockify path relative to its own root. Matches
  // the format used by the main run page.
  const websockifyPath = `${vncBase.replace(/^\//, '')}/websockify`;
  const vncUrl = `${vncBase}/vnc.html?autoconnect=true&resize=scale&view_only=true&path=${websockifyPath}`;

  // Prune expired pills on a dedicated interval so the main effect stays lean.
  useEffect(() => {
    if (pills.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setPills((prev) => prev.filter((p) => p.expires > now));
    }, 500);
    return () => {
      clearInterval(timer);
    };
  }, [pills.length]);

  // Single lifecycle owner: SSE stream + hang watchdog + elapsed ticker.
  // Keeping them together means one `terminated` flag gates all three, and
  // the cleanup function tears down every timer + the EventSource atomically.
  useEffect(() => {
    if (sessionId === null) return;

    const start = Date.now();
    let lastEventAt = start;
    let terminated = false;
    const es = new EventSource(`${apiBase}/${sessionId}/stream`);

    const terminate = (finalStatus: TerminalStatus, detail?: string) => {
      if (terminated) return;
      terminated = true;
      setStatus(finalStatus);
      if (detail !== undefined) setError(detail);
      es.close();
      onTerminalRef.current(finalStatus, detail);
    };

    const touch = () => {
      if (terminated) return;
      lastEventAt = Date.now();
    };

    const addPill = (labelText: string) => {
      if (terminated) return;
      pillIdRef.current += 1;
      const id = pillIdRef.current;
      setPills((prev) => [...prev, { id, label: labelText, expires: Date.now() + PILL_LIFETIME_MS }]);
    };

    es.addEventListener('connected', () => {
      touch();
      setStatus('running');
    });

    es.addEventListener('step', (e) => {
      touch();
      const data = parse(e);
      if (!data) return;
      const n = Number(data.step);
      if (!Number.isNaN(n)) setStep(n);
      const pill = SKILL_ACTION_PILL[String(data.action)];
      if (pill !== undefined) addPill(pill);
    });

    es.addEventListener('tokens', (e) => {
      touch();
      const data = parse(e);
      if (!data) return;
      setTokens({ input: Number(data.input) || 0, output: Number(data.output) || 0 });
    });

    es.addEventListener('skills_loaded', (e) => {
      touch();
      const data = parse(e);
      if (!data) return;
      addPill(`skill loaded: ${String(data.title)}`);
    });

    es.addEventListener('skill_saved', () => {
      touch();
      addPill('skill saved');
    });

    es.addEventListener('skill_improved', () => {
      touch();
      addPill('skill improved');
    });

    es.addEventListener('completed', (e) => {
      touch();
      const data = parse(e);
      const answer = data !== undefined && typeof data.answer === 'string' ? data.answer : null;
      if (answer !== null) setError(answer);
      terminate('completed');
    });

    es.addEventListener('failed', (e) => {
      touch();
      const data = parse(e);
      terminate('failed', data !== undefined && typeof data.error === 'string' ? data.error : 'failed');
    });

    // Browser-level disconnects — EventSource auto-reconnects unless we close.
    // Let the watchdog handle genuine hangs; ignore transient errors here.

    const elapsedTimer = setInterval(() => {
      if (terminated) return;
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);

    const watchdog = setInterval(() => {
      if (terminated) return;
      if (Date.now() - lastEventAt > HANG_DETECT_MS) {
        terminate('failed', 'No progress for 60s');
      }
    }, 2000);

    return () => {
      terminated = true;
      clearInterval(elapsedTimer);
      clearInterval(watchdog);
      es.close();
    };
  }, [sessionId, apiBase]);

  const done = status === 'completed' || status === 'failed';

  return (
    <div className="relative flex h-full w-full flex-col bg-black">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/50 bg-background/90 px-3 py-2 backdrop-blur">
        <span className="font-[family-name:var(--font-heading)] text-sm tracking-tight text-foreground">{label}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            status === 'completed'
              ? 'bg-green-500/15 text-green-500'
              : status === 'failed'
                ? 'bg-red-500/15 text-red-400'
                : 'bg-primary/15 text-primary'
          }`}
        >
          {status === 'pending' ? 'starting' : status}
        </span>
      </div>

      {/* VNC surface */}
      <div className="relative flex-1 overflow-hidden">
        {sessionId !== null && (
          <iframe
            src={vncUrl}
            title={`${label} browser stream`}
            className={`h-full w-full border-0 transition-opacity ${done ? 'opacity-60' : ''}`}
          />
        )}

        {/* HUD — top right */}
        <div className="pointer-events-none absolute right-2 top-2 flex flex-col items-end gap-1 font-[family-name:var(--font-jetbrains-mono)] text-[11px] tabular-nums">
          <div className="rounded-md bg-black/70 px-2 py-1 text-white/90 shadow-lg backdrop-blur-sm">
            step {step} &middot; {elapsed}s
          </div>
          <div className="rounded-md bg-black/70 px-2 py-1 text-white/90 shadow-lg backdrop-blur-sm">
            &uarr; {tokens.input.toLocaleString()} &darr; {tokens.output.toLocaleString()}
          </div>
        </div>

        {/* Skill pills — top left */}
        <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-1">
          {pills.map((p) => (
            <span
              key={p.id}
              className="rounded-full bg-primary/80 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground shadow-lg animate-in fade-in slide-in-from-left-2"
            >
              {p.label}
            </span>
          ))}
        </div>

        {/* Terminal banner */}
        {done && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-xs text-white/90 backdrop-blur-sm">
            {status === 'completed' ? (
              <span className="text-green-400">
                &#10003; completed in {elapsed}s &middot; {step} steps
              </span>
            ) : (
              <span className="text-red-400">
                &#10007; {error ?? 'failed'} &middot; {step} steps
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
