'use client';

import { useState, useEffect, useRef, use } from 'react';
import Link from 'next/link';
import { BrowserClawWordmark } from '@/components/browserclaw-wordmark';
import { ThemeToggle } from '@/components/theme-toggle';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { isLocalBrowserMode } from '@/lib/env';
import { RunSummary } from '@/components/run/run-summary';
import { RunConsole } from '@/components/run/run-console';
import type { ConsoleEntry, SkillOutput, DomainSkillEntry, RunStatus } from '@/components/run/types';

const VNC_BASE = process.env.NEXT_PUBLIC_VNC_URL ?? '/vnc';
const vncUrl = `${VNC_BASE}/vnc.html?autoconnect=true&resize=scale&view_only=true${VNC_BASE === '/vnc' ? '&path=vnc/websockify' : ''}`;

function parseEventData(e: MessageEvent): Record<string, unknown> | undefined {
  try {
    return JSON.parse(String(e.data)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export default function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [status, setStatus] = useState<RunStatus>('running');
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [skill, setSkill] = useState<SkillOutput | null>(null);
  const [domainSkills, setDomainSkills] = useState<DomainSkillEntry[]>([]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finalElapsed, setFinalElapsed] = useState<number | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ prompt: string; plan: string } | null>(null);
  const [skillStats, setSkillStats] = useState<{
    llm_calls?: number;
    skills_used?: boolean;
    skill_outcome?: string;
  } | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [view, setView] = useState<'human' | 'agent'>('human');
  const [skillMd, setSkillMd] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const startTime = useRef(Date.now());

  const done = status !== 'running' && status !== 'waiting_for_user';

  // Elapsed timer
  useEffect(() => {
    if (done) {
      setFinalElapsed(Date.now() - startTime.current);
      return;
    }
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime.current);
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [done]);

  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);

  // SSE event stream
  useEffect(() => {
    let terminated = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const MAX_RECONNECTS = 10;
    let reconnects = 0;

    function connect() {
      es = new EventSource(`/api/v1/runs/${id}/stream`);

      es.addEventListener('plan', (e: MessageEvent) => {
        const data = parseEventData(e);
        if (!data) return;
        setPlan({ prompt: String(data.prompt), plan: String(data.plan) });
      });

      es.addEventListener('thinking', (e: MessageEvent) => {
        const data = parseEventData(e);
        if (!data) return;
        const sec = Math.floor((Date.now() - startTime.current) / 1000);
        setEntries((prev) => [
          ...prev,
          { id: prev.length, type: 'thinking', message: String(data.message), elapsed: sec },
        ]);
      });

      es.addEventListener('step', (e: MessageEvent) => {
        const data = parseEventData(e);
        if (!data) return;
        const sec = Math.floor((Date.now() - startTime.current) / 1000);
        setEntries((prev) => [
          ...prev,
          {
            id: prev.length,
            type: 'step',
            step: Number(data.step),
            action: String(data.action),
            reasoning: String(data.reasoning),
            url: String(data.url),
            page_title: String(data.page_title),
            elapsed: sec,
          },
        ]);
      });

      es.addEventListener('completed', (e: MessageEvent) => {
        terminated = true;
        const data = parseEventData(e);
        if (!data) return;
        if (typeof data.answer === 'string' && data.answer !== '') setAnswer(data.answer);
        setSkillStats({
          llm_calls: Number(data.llm_calls),
          skills_used: Boolean(data.skills_used),
          skill_outcome: String(data.skill_outcome),
        });
        setStatus('completed');
        es?.close();
      });

      es.addEventListener('failed', (e: MessageEvent) => {
        terminated = true;
        const data = parseEventData(e);
        if (!data) return;
        setStatus('failed');
        setError(String(data.error));
        es?.close();
      });

      es.addEventListener('skill_generated', (e: MessageEvent) => {
        const data = parseEventData(e);
        if (!data) return;
        setSkill(data.skill as SkillOutput);
      });

      const addSkillEvent = (message: string) => {
        const sec = Math.floor((Date.now() - startTime.current) / 1000);
        setEntries((prev) => [...prev, { id: prev.length, type: 'skill_event', message, elapsed: sec }]);
      };

      es.addEventListener('skills_loaded', (e: MessageEvent) => {
        const data = parseEventData(e);
        if (!data) return;
        addSkillEvent(`Loaded skill "${String(data.title)}" for ${String(data.domain)}`);
      });

      es.addEventListener('skill_improved', (e: MessageEvent) => {
        const data = parseEventData(e);
        if (!data) return;
        addSkillEvent(`Skill improved: ${String(data.previous_steps)} → ${String(data.new_steps)} steps`);
      });

      es.addEventListener('skill_validated', (e: MessageEvent) => {
        const data = parseEventData(e);
        if (!data) return;
        addSkillEvent(`Skill validated: "${String(data.title)}" (run #${String(data.run_count)})`);
      });

      es.addEventListener('skill_saved', (e: MessageEvent) => {
        const data = parseEventData(e);
        if (!data) return;
        addSkillEvent(`New skill saved: "${String(data.title)}"`);
      });

      es.addEventListener('domain_skills', (e: MessageEvent) => {
        const data = parseEventData(e);
        if (!data) return;
        if (Array.isArray(data.skills)) setDomainSkills(data.skills as DomainSkillEntry[]);
      });

      es.addEventListener('ask_user', (e: MessageEvent) => {
        const data = parseEventData(e);
        if (!data) return;
        const sec = Math.floor((Date.now() - startTime.current) / 1000);
        setPendingQuestion(String(data.question));
        setStatus('waiting_for_user');
        setEntries((prev) => [
          ...prev,
          { id: prev.length, type: 'ask_user', message: String(data.question), elapsed: sec },
        ]);
      });

      es.addEventListener('user_response', (e: MessageEvent) => {
        const data = parseEventData(e);
        if (!data) return;
        const sec = Math.floor((Date.now() - startTime.current) / 1000);
        setStatus('running');
        setEntries((prev) => [
          ...prev,
          { id: prev.length, type: 'user_response', message: String(data.text), elapsed: sec },
        ]);
      });

      es.addEventListener('connected', () => {
        reconnects = 0;
      });

      es.onerror = () => {
        if (terminated) {
          es?.close();
          return;
        }
        es?.close();
        if (reconnects < MAX_RECONNECTS) {
          reconnects++;
          reconnectTimer = setTimeout(connect, 2000);
        } else {
          setStatus('failed');
          setError('Connection lost');
        }
      };
    }

    connect();

    return () => {
      terminated = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
    };
  }, [id]);

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

  useEffect(() => {
    if (pendingQuestion != null && pendingQuestion !== '') {
      chatInputRef.current?.focus();
      document.title = 'Agent needs input — browserclaw';
      toast.info(pendingQuestion, { duration: Infinity, id: 'ask-user' });
    } else {
      document.title = 'browserclaw';
      toast.dismiss('ask-user');
    }
  }, [pendingQuestion]);

  async function handleRespond() {
    const text = chatInput.trim();
    if (!text || isSending) return;
    const wasAnsweringQuestion = pendingQuestion != null && pendingQuestion !== '';
    setIsSending(true);
    setChatInput('');
    try {
      const res = await fetch(`/api/v1/runs/${id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
        const msg = data.message ?? data.error ?? 'Failed to send message';
        toast.error(msg);
        setChatInput(text);
        return;
      }
      if (wasAnsweringQuestion) setPendingQuestion(null);
    } catch {
      toast.error('Failed to send message');
      setChatInput(text);
    } finally {
      setIsSending(false);
    }
  }

  const duration = finalElapsed ?? elapsed;

  /* --- Summary view --- */
  if (done) {
    return (
      <RunSummary
        status={status}
        answer={answer}
        error={error}
        duration={duration}
        entries={entries}
        skill={skill}
        skillStats={skillStats}
        domainSkills={domainSkills}
      />
    );
  }

  /* --- Running view --- */
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <nav className="flex shrink-0 items-center justify-between border-b border-border/50 bg-background/80 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-[family-name:var(--font-heading)] text-lg tracking-tight">
            <BrowserClawWordmark />
          </Link>
          <div className="flex items-center gap-2">
            <div className="group relative">
              <button className="rounded-md bg-muted/50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:bg-muted focus:bg-muted focus:outline-none">
                Prompt
              </button>
              <div className="pointer-events-none absolute left-0 top-full z-50 hidden w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-card p-3 shadow-lg group-hover:block group-focus-within:block">
                <p className="text-sm text-foreground break-words">
                  {plan?.prompt ?? <span className="text-muted-foreground">Loading…</span>}
                </p>
              </div>
            </div>
            <div className="group relative">
              <button className="rounded-md bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary hover:bg-primary/20 focus:bg-primary/20 focus:outline-none">
                Plan
              </button>
              <div className="pointer-events-none absolute left-0 top-full z-50 hidden w-72 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-card p-3 shadow-lg group-hover:block group-focus-within:block">
                <p className="text-sm text-foreground break-words">
                  {plan?.plan ?? <span className="text-muted-foreground">Loading…</span>}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <ThemeToggle />
          <button
            onClick={() => {
              setShowCancelConfirm(true);
            }}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 transition-all hover:bg-red-500/20 hover:border-red-500/50"
          >
            Cancel
          </button>
          <span className="font-[family-name:var(--font-jetbrains-mono)] text-sm tabular-nums text-muted-foreground">
            {minutes}:{seconds.toString().padStart(2, '0')}
          </span>
        </div>
      </nav>

      {isLocalBrowserMode() ? (
        <RunConsole
          entries={entries}
          chatInput={chatInput}
          onChatInputChange={setChatInput}
          onSubmit={() => {
            void handleRespond();
          }}
          pendingQuestion={pendingQuestion}
          isSending={isSending}
          chatInputRef={chatInputRef}
          variant="local"
        />
      ) : (
        <>
          <div className="relative flex-1 bg-black">
            {view === 'human' ? (
              <iframe
                src={vncUrl}
                className={`h-full w-full border-0 ${isDragging ? 'pointer-events-none' : ''}`}
                title="Browser stream"
              />
            ) : (
              <div className="h-full w-full overflow-auto bg-black px-6 py-5">
                {skillMd !== null ? (
                  <pre className="whitespace-pre-wrap font-[family-name:var(--font-jetbrains-mono)] text-[12px] leading-relaxed text-foreground/85">
                    {skillMd}
                  </pre>
                ) : skillError !== null ? (
                  <p className="text-xs text-red-400">Failed to load skill: {skillError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                )}
              </div>
            )}
            <div
              role="group"
              aria-label="View toggle"
              className="pointer-events-auto absolute bottom-3 right-3 z-20 flex items-center rounded-full border border-border/60 bg-background/80 p-0.5 text-[10px] font-semibold uppercase tracking-widest shadow-lg backdrop-blur"
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
          </div>
          <RunConsole
            entries={entries}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onSubmit={() => {
              void handleRespond();
            }}
            pendingQuestion={pendingQuestion}
            isSending={isSending}
            chatInputRef={chatInputRef}
            variant="compact"
            onDraggingChange={setIsDragging}
          />
        </>
      )}

      {showCancelConfirm && (
        <ConfirmDialog
          title="Cancel this run?"
          description="The browser session will be stopped and any progress will be lost."
          confirmLabel="Cancel run"
          cancelLabel="Keep running"
          destructive
          onCancel={() => {
            setShowCancelConfirm(false);
          }}
          onConfirm={() => {
            setShowCancelConfirm(false);
            void fetch(`/api/v1/runs/${id}`, { method: 'DELETE' }).catch(() => {
              /* noop */
            });
            setStatus('failed');
            setError('Run cancelled');
          }}
        />
      )}
    </div>
  );
}
