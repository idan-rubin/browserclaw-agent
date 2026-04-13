'use client';

/**
 * ComparePanel — single side of the /<guid> head-to-head page.
 *
 * Owns its own SSE subscription and HUD. Agnostic to which backend it talks
 * to: pass `apiBase` = "/api/v1/runs" for browserclaw or "/api/v1/bu-runs"
 * for the browser-use sidecar. Both backends emit the same event envelope.
 *
 * Emits a single callback — `onTerminal('completed' | 'failed')` — so the
 * parent can cancel the other side on first-terminal-wins.
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
  showPills: boolean;
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

export function ComparePanel({ sessionId, apiBase, vncBase, label, showPills, onTerminal }: ComparePanelProps) {
  const [step, setStep] = useState(0);
  const [tokens, setTokens] = useState({ input: 0, output: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useState<'pending' | 'running' | TerminalStatus>('pending');
  const [error, setError] = useState<string | null>(null);
  const [pills, setPills] = useState<Pill[]>([]);
  const startRef = useRef(0);
  const pillIdRef = useRef(0);
  const lastEventAtRef = useRef(0);
  const onTerminalRef = useRef(onTerminal);
  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  const vncUrl = `${vncBase}/vnc.html?autoconnect=true&resize=scale&view_only=true&path=${encodeURIComponent(vncBase.replace(/^\//, '') + '/websockify')}`;

  // Ticking elapsed timer — only runs while we have an active session
  useEffect(() => {
    if (sessionId === null || status === 'completed' || status === 'failed') return;
    const timer = setInterval(() => {
      if (startRef.current === 0) return;
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [sessionId, status]);

  // Watchdog for hang: no event for HANG_DETECT_MS → declare failed
  useEffect(() => {
    if (sessionId === null || status === 'completed' || status === 'failed') return;
    const watchdog = setInterval(() => {
      if (lastEventAtRef.current === 0) return;
      const idle = Date.now() - lastEventAtRef.current;
      if (idle > HANG_DETECT_MS) {
        setStatus('failed');
        setError('No progress for 60s');
        onTerminalRef.current('failed', 'hang');
      }
    }, 2000);
    return () => {
      clearInterval(watchdog);
    };
  }, [sessionId, status]);

  // Prune expired pills
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

  // SSE subscription
  useEffect(() => {
    if (sessionId === null) return;
    startRef.current = Date.now();
    lastEventAtRef.current = Date.now();

    const es = new EventSource(`${apiBase}/${sessionId}/stream`);
    let terminated = false;

    const touch = () => {
      lastEventAtRef.current = Date.now();
    };

    const addPill = (labelText: string) => {
      if (!showPills) return;
      pillIdRef.current += 1;
      setPills((prev) => [...prev, { id: pillIdRef.current, label: labelText, expires: Date.now() + PILL_LIFETIME_MS }]);
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

    // Transient success pills from our built-in skill handlers. The Browser
    // service doesn't emit these as named events, but the step `action` field
    // reflects them — map here.
    const skillActionPill: Record<string, string> = {
      click_cloudflare: 'cloudflare solved',
      press_and_hold: 'anti-bot solved',
    };
    es.addEventListener('step', (e) => {
      const data = parse(e);
      if (!data) return;
      const pill = skillActionPill[String(data.action)];
      if (pill) addPill(pill);
    });

    es.addEventListener('completed', (e) => {
      touch();
      terminated = true;
      const data = parse(e);
      setStatus('completed');
      const answer = data && typeof data.answer === 'string' ? data.answer : null;
      if (answer !== null) setError(answer);
      es.close();
      onTerminalRef.current('completed');
    });

    es.addEventListener('failed', (e) => {
      touch();
      terminated = true;
      const data = parse(e);
      setStatus('failed');
      setError(data && typeof data.error === 'string' ? data.error : 'failed');
      es.close();
      onTerminalRef.current('failed');
    });

    es.onerror = () => {
      if (terminated) {
        es.close();
        return;
      }
      // Let the watchdog handle actual hangs; transient disconnects recover via EventSource auto-reconnect.
    };

    return () => {
      es.close();
    };
  }, [sessionId, apiBase, showPills]);

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
              <span className="text-green-400">&#10003; completed in {elapsed}s &middot; {step} steps</span>
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
