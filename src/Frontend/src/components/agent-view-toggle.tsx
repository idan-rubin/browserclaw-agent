'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'agent-view';

type View = 'human' | 'agent';

function readInitialView(): View {
  if (typeof window === 'undefined') return 'human';
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'agent' ? 'agent' : 'human';
  } catch {
    return 'human';
  }
}

export function AgentViewToggle({ children }: { children: React.ReactNode }) {
  const [view, setViewState] = useState<View>('human');
  const [skillMd, setSkillMd] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mount-time read from localStorage
    setViewState(readInitialView());
  }, []);

  useEffect(() => {
    if (view !== 'agent' || skillMd !== null || skillError !== null) return;
    let cancelled = false;
    fetch('/api/v1/skill')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
        return res.text();
      })
      .then((text) => {
        if (!cancelled) setSkillMd(text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSkillError(err instanceof Error ? err.message : 'Failed to load');
      });
    return () => {
      cancelled = true;
    };
  }, [view, skillMd, skillError]);

  const setView = useCallback((next: View) => {
    setViewState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* quota or private mode — non-fatal */
    }
    setFlash(true);
    window.setTimeout(() => {
      setFlash(false);
    }, 320);
  }, []);

  const copy = useCallback(async () => {
    if (skillMd === null) return;
    try {
      await navigator.clipboard.writeText(skillMd);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1600);
    } catch {
      /* clipboard unavailable (http / permissions) — non-fatal */
    }
  }, [skillMd]);

  return (
    <>
      {view === 'human' ? (
        children
      ) : (
        <div className="fixed inset-0 z-40 overflow-auto bg-background px-6 py-10 sm:px-10">
          <div className="mx-auto max-w-3xl">
            {skillMd !== null ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void copy();
                  }}
                  className="fixed right-4 top-4 z-50 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground shadow-lg backdrop-blur transition-colors hover:text-foreground"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <pre className="whitespace-pre-wrap font-[family-name:var(--font-jetbrains-mono)] text-[13px] leading-relaxed text-foreground/85">
                  {skillMd}
                </pre>
              </>
            ) : skillError !== null ? (
              <p className="text-xs text-red-400">Failed to load skill: {skillError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Loading…</p>
            )}
          </div>
        </div>
      )}
      {flash && (
        <div
          className="pointer-events-none fixed inset-0 z-[100] bg-foreground/10"
          style={{ animation: 'agent-toggle-flash 0.3s ease-out forwards' }}
          aria-hidden
        />
      )}
      <style>{`
        @keyframes agent-toggle-flash {
          0% { opacity: 0; }
          15% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
      <div
        role="group"
        aria-label="View toggle"
        className="fixed bottom-6 right-6 z-[60] flex items-center rounded-full border border-border/60 bg-background/80 p-0.5 text-[10px] font-semibold uppercase tracking-widest shadow-lg backdrop-blur"
      >
        <button
          type="button"
          onClick={() => {
            setView('human');
          }}
          className={`rounded-full px-3 py-1 transition-colors ${view === 'human' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
          aria-pressed={view === 'human'}
        >
          Human
        </button>
        <button
          type="button"
          onClick={() => {
            setView('agent');
          }}
          className={`rounded-full px-3 py-1 transition-colors ${view === 'agent' ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
          aria-pressed={view === 'agent'}
        >
          Agent
        </button>
      </div>
    </>
  );
}
