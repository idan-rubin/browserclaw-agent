"use client";

import { useState, useEffect, useRef, use, useCallback } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { isLocalBrowserMode } from "@/lib/env";
import { StatCard } from "@/components/stat-card";

const SESSION_DURATION_MS = 5 * 60 * 1000;
const VNC_BASE = process.env.NEXT_PUBLIC_VNC_URL ?? "/vnc";
const vncUrl = `${VNC_BASE}/vnc.html?autoconnect=true&resize=scale&view_only=true${VNC_BASE === "/vnc" ? "&path=vnc/websockify" : ""}`;

interface ConsoleEntry {
  id: number;
  type: "step" | "thinking" | "ask_user" | "user_response" | "skill_event";
  step?: number;
  action?: string;
  reasoning?: string;
  message?: string;
  url?: string;
  page_title?: string;
  elapsed: number;
}

interface SkillOutput {
  title: string;
  description: string;
  steps: { number: number; description: string; action: string; details?: string }[];
  metadata: { prompt: string; url: string; total_steps: number; duration_ms: number };
  markdown: string;
}

type RunStatus = "running" | "waiting_for_user" | "completed" | "failed" | "timeout";

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const STATUS_CONFIG: Record<RunStatus, { badge: string; dot: string; label: string }> = {
  running: {
    badge: "bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20",
    dot: "bg-blue-400",
    label: "Running",
  },
  waiting_for_user: {
    badge: "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20",
    dot: "bg-amber-400 animate-pulse",
    label: "Waiting for your input",
  },
  completed: {
    badge: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20",
    dot: "bg-emerald-400",
    label: "Run completed",
  },
  timeout: {
    badge: "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20",
    dot: "bg-amber-400",
    label: "Run timed out",
  },
  failed: {
    badge: "bg-red-500/10 text-red-400 ring-1 ring-red-500/20",
    dot: "bg-red-400",
    label: "Run failed",
  },
};

export default function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [status, setStatus] = useState<RunStatus>("running");
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [skill, setSkill] = useState<SkillOutput | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [finalElapsed, setFinalElapsed] = useState<number | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ prompt: string; plan: string } | null>(null);
  const [skillStats, setSkillStats] = useState<{ llm_calls?: number; skills_used?: boolean; skill_outcome?: string } | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const startTime = useRef(Date.now());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [consoleHeight, setConsoleHeight] = useState(112);
  const [isDragging, setIsDragging] = useState(false);
  const consoleHeightRef = useRef(112);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const startY = e.clientY;
    const startH = consoleHeightRef.current;
    const onMove = (ev: PointerEvent) => {
      const delta = startY - ev.clientY;
      const next = Math.max(56, Math.min(window.innerHeight * 0.6, startH + delta));
      consoleHeightRef.current = next;
      setConsoleHeight(next);
    };
    const onUp = () => {
      setIsDragging(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const done = status !== "running" && status !== "waiting_for_user";

  // Elapsed timer -- stops when the run finishes and captures final value
  useEffect(() => {
    if (done) {
      // Capture the actual elapsed time when the run ends
      setFinalElapsed(Date.now() - startTime.current);
      return;
    }
    const interval = setInterval(() => {
      setElapsed(Date.now() - startTime.current);
    }, 1000);
    return () => clearInterval(interval);
  }, [done]);

  const remaining = Math.max(0, SESSION_DURATION_MS - elapsed);
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  const progress = Math.min(100, (elapsed / SESSION_DURATION_MS) * 100);
  const isLow = remaining < 60000;

  // SSE event stream
  useEffect(() => {
    const eventSource = new EventSource(`/api/v1/runs/${id}/stream`);
    let terminated = false;

    eventSource.addEventListener("plan", (e) => {
      const data = JSON.parse(e.data);
      setPlan({ prompt: data.prompt, plan: data.plan });
    });

    eventSource.addEventListener("thinking", (e) => {
      const data = JSON.parse(e.data);
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      setEntries((prev) => [...prev, {
        id: prev.length,
        type: "thinking",
        message: data.message,
        elapsed,
      }]);
    });

    eventSource.addEventListener("step", (e) => {
      const data = JSON.parse(e.data);
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      setEntries((prev) => [...prev, {
        id: prev.length,
        type: "step",
        step: data.step,
        action: data.action,
        reasoning: data.reasoning,
        url: data.url,
        page_title: data.page_title,
        elapsed,
      }]);
    });

    eventSource.addEventListener("completed", (e) => {
      terminated = true;
      const data = JSON.parse(e.data);
      if (data.answer) setAnswer(data.answer);
      setSkillStats({ llm_calls: data.llm_calls, skills_used: data.skills_used, skill_outcome: data.skill_outcome });
      setStatus("completed");
      eventSource.close();
    });

    eventSource.addEventListener("failed", (e) => {
      terminated = true;
      const data = JSON.parse(e.data);
      setStatus("failed");
      setError(data.error);
      eventSource.close();
    });

    eventSource.addEventListener("timeout", () => {
      terminated = true;
      setStatus("timeout");
      setError("Session time limit reached (5 minutes)");
      eventSource.close();
    });

    eventSource.addEventListener("skill_generated", (e) => {
      const data = JSON.parse(e.data);
      setSkill(data.skill);
    });

    eventSource.addEventListener("skills_loaded", (e) => {
      const data = JSON.parse(e.data);
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      setEntries((prev) => [...prev, {
        id: prev.length,
        type: "skill_event",
        message: `Loaded ${data.count} skill${data.count > 1 ? "s" : ""} for ${data.domain}`,
        elapsed,
      }]);
    });

    eventSource.addEventListener("skill_improved", (e) => {
      const data = JSON.parse(e.data);
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      setEntries((prev) => [...prev, {
        id: prev.length,
        type: "skill_event",
        message: `Skill improved: ${data.previous_steps} → ${data.new_steps} steps`,
        elapsed,
      }]);
    });

    eventSource.addEventListener("skill_validated", (e) => {
      const data = JSON.parse(e.data);
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      setEntries((prev) => [...prev, {
        id: prev.length,
        type: "skill_event",
        message: `Skill validated: "${data.title}" (run #${data.run_count})`,
        elapsed,
      }]);
    });

    eventSource.addEventListener("skill_saved", (e) => {
      const data = JSON.parse(e.data);
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      setEntries((prev) => [...prev, {
        id: prev.length,
        type: "skill_event",
        message: `New skill saved: "${data.title}"`,
        elapsed,
      }]);
    });

    eventSource.addEventListener("ask_user", (e) => {
      const data = JSON.parse(e.data);
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      setPendingQuestion(data.question);
      setStatus("waiting_for_user");
      setEntries((prev) => [...prev, {
        id: prev.length,
        type: "ask_user",
        message: data.question,
        elapsed,
      }]);
    });

    eventSource.addEventListener("user_response", (e) => {
      const data = JSON.parse(e.data);
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      setStatus("running");
      setEntries((prev) => [...prev, {
        id: prev.length,
        type: "user_response",
        message: data.text,
        elapsed,
      }]);
    });

    eventSource.onerror = () => {
      if (!terminated) {
        setStatus("failed");
        setError("Connection lost");
      }
      eventSource.close();
    };

    return () => eventSource.close();
  }, [id]);

  useEffect(() => {
    if (pendingQuestion) {
      chatInputRef.current?.focus();
      document.title = "Agent needs input — browserclaw";
      toast.info(pendingQuestion, { duration: Infinity, id: "ask-user" });
    } else {
      document.title = "browserclaw";
      toast.dismiss("ask-user");
    }
  }, [pendingQuestion]);

  async function handleRespond() {
    const text = chatInput.trim();
    if (!text || isSending) return;
    setIsSending(true);
    setChatInput("");
    try {
      await fetch(`/api/v1/runs/${id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      setPendingQuestion(null);
    } catch {
      // response will show via SSE
    } finally {
      setIsSending(false);
    }
  }

  // Auto-scroll the console
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const duration = finalElapsed ?? elapsed;
  const stepEntries = entries.filter((e) => e.type === "step");
  const uniquePages = [...new Set(stepEntries.map((s) => s.page_title).filter(Boolean))];

  /* --- Summary view --- */
  if (done) {
    return (
      <div className="flex min-h-screen flex-col">
        <nav className="flex items-center justify-between border-b border-border/50 px-4 py-4 sm:px-6">
          <a href="/" className="font-[family-name:var(--font-heading)] text-lg tracking-tight">
            browserclaw
          </a>
          <ThemeToggle />
        </nav>

        <div className="flex flex-1 justify-center overflow-y-auto px-4 py-10 sm:py-16">
          <div className="w-full max-w-2xl space-y-8 animate-page-in">
            {/* Status */}
            <div className="text-center">
              <span className={`inline-flex items-center gap-2.5 rounded-full px-5 py-2 text-sm font-semibold tracking-wide ${STATUS_CONFIG[status].badge}`}>
                <span className={`h-2 w-2 rounded-full ${STATUS_CONFIG[status].dot}`} />
                {STATUS_CONFIG[status].label}
              </span>
            </div>

            {/* Answer */}
            {answer && (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 sm:p-6">
                <span className="inline-block rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                  Answer
                </span>
                <p className="mt-3 text-lg leading-relaxed">{answer}</p>
              </div>
            )}

            {/* Error banner */}
            {error && (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-3.5 text-center text-sm text-red-400">
                {error}
              </div>
            )}

            {/* Stats */}
            <div className={`grid gap-3 sm:gap-5 ${skillStats?.llm_calls ? "grid-cols-4" : "grid-cols-3"}`}>
              <StatCard value={formatDuration(duration)} label="Duration" />
              <StatCard value={String(stepEntries.length)} label="Total steps" />
              <StatCard value={String(uniquePages.length)} label="Pages visited" />
              {skillStats?.llm_calls && <StatCard value={String(skillStats.llm_calls)} label="LLM calls" />}
            </div>

            {/* Steps */}
            {stepEntries.length > 0 && (
              <div className="rounded-2xl border border-border/50 bg-card/30 backdrop-blur-sm">
                <div className="border-b border-border/30 px-5 py-3">
                  <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Steps</h3>
                </div>
                <div className="max-h-72 overflow-y-auto p-2">
                  {stepEntries.map((entry, i) => (
                    <div
                      key={entry.step}
                      className={`flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-card/40 ${
                        i === stepEntries.length - 1 ? "bg-card/20" : ""
                      }`}
                    >
                      <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 font-[family-name:var(--font-jetbrains-mono)] text-[11px] font-semibold text-primary">
                        {(entry.step ?? 0) + 1}
                      </span>
                      <div className="min-w-0 text-sm leading-relaxed">
                        <span className="rounded bg-primary/8 px-1.5 py-0.5 font-[family-name:var(--font-jetbrains-mono)] text-xs text-primary">
                          {entry.action}
                        </span>
                        <span className="ml-2 text-muted-foreground">{entry.reasoning}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Skill */}
            {skill && (
              <div className="rounded-2xl border border-primary/20 bg-gradient-to-b from-primary/5 to-transparent p-5 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <span className="inline-block rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                      Skill
                    </span>
                    <p className="mt-2 text-lg font-semibold tracking-tight">{skill.title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{skill.description}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      onClick={() => navigator.clipboard.writeText(skill.markdown)}
                      className="rounded-lg border border-border/60 bg-card/60 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm transition-colors hover:border-primary/30 hover:text-foreground"
                    >
                      Copy
                    </button>
                    <button
                      onClick={() => downloadSkillMarkdown(skill)}
                      className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary backdrop-blur-sm transition-colors hover:bg-primary/20"
                    >
                      Download .md
                    </button>
                  </div>
                </div>
                <ol className="mt-4 space-y-1.5 border-t border-border/30 pt-4 text-sm text-muted-foreground">
                  {skill.steps.map((s) => (
                    <li key={s.number} className="flex gap-2">
                      <span className="font-[family-name:var(--font-jetbrains-mono)] text-xs text-primary/70">{String(s.number).padStart(2, "0")}</span>
                      <span>{s.description}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Home */}
            <div className="pb-6 text-center">
              <a
                href="/"
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-8 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
                Back to home
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* --- Running view --- */
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <nav className="flex shrink-0 items-center justify-between border-b border-border/50 bg-background/80 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3">
          <a href="/" className="font-[family-name:var(--font-heading)] text-lg tracking-tight">
            browserclaw
          </a>
          {plan && (
            <div className="hidden sm:flex items-center gap-2">
              <div className="group relative">
                <button className="rounded-md bg-muted/50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:bg-muted">
                  Prompt
                </button>
                <div className="absolute left-0 top-full z-50 mt-1 hidden w-72 rounded-lg border border-border bg-card p-3 shadow-lg group-hover:block">
                  <p className="text-sm text-foreground">{plan.prompt}</p>
                </div>
              </div>
              <div className="group relative">
                <button className="rounded-md bg-primary/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary hover:bg-primary/20">
                  Plan
                </button>
                <div className="absolute left-0 top-full z-50 mt-1 hidden w-72 rounded-lg border border-border bg-card p-3 shadow-lg group-hover:block">
                  <p className="text-sm text-foreground">{plan.plan}</p>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 sm:gap-4">
          <ThemeToggle />
          <button
            onClick={() => setShowCancelConfirm(true)}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-400 transition-all hover:bg-red-500/20 hover:border-red-500/50"
          >
            Cancel
          </button>
          {!isLocalBrowserMode() && (
            <div className="flex items-center gap-2.5">
              <div className="relative hidden h-1.5 w-28 overflow-hidden rounded-full bg-secondary/60 sm:block">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-all duration-1000 ${
                    isLow ? "bg-red-500" : "bg-primary"
                  }`}
                  style={{ width: `${100 - progress}%` }}
                />
              </div>
              <span className={`font-[family-name:var(--font-jetbrains-mono)] text-sm tabular-nums ${
                isLow ? "text-red-400" : "text-muted-foreground"
              }`}>
                {minutes}:{seconds.toString().padStart(2, "0")}
              </span>
            </div>
          )}
        </div>
      </nav>

      {isLocalBrowserMode() ? (
        /* Local mode: no VNC, full-height steps view */
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-3 border-b border-border/30 bg-card/30 px-6 py-3">
            <div className={`h-2 w-2 rounded-full ${entries.length === 0 ? "animate-pulse bg-primary" : "bg-emerald-400"}`} />
            <span className="text-sm font-medium">Chrome is running on your desktop</span>
            <span className="text-xs text-muted-foreground/50">{entries.length} events</span>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-3"
          >
            {entries.length === 0 && (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground/30">
                Waiting for first action...
              </div>
            )}
            {entries.map((entry) => (
              <div key={entry.id} className={`flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-card/40 ${entry.type === "ask_user" ? "border-l-2 border-amber-500/50 bg-amber-500/5" : ""} ${entry.type === "user_response" ? "border-l-2 border-primary/50 bg-primary/5" : ""}`}>
                <span className="mt-0.5 w-8 shrink-0 text-right font-[family-name:var(--font-jetbrains-mono)] text-xs text-muted-foreground/30">{entry.elapsed}s</span>
                <ConsoleEntryContent entry={entry} variant="local" />
              </div>
            ))}
          </div>

          <ChatInput
            inputRef={chatInputRef}
            value={chatInput}
            onChange={setChatInput}
            onSubmit={handleRespond}
            pendingQuestion={pendingQuestion}
            isSending={isSending}
            variant="local"
          />
        </div>
      ) : (
        /* Production mode: VNC stream + compact console */
        <>
          <div className="flex-1 bg-black">
            <iframe
              src={vncUrl}
              className={`h-full w-full border-0 ${isDragging ? "pointer-events-none" : ""}`}
              title="Browser stream"
            />
          </div>

          <div className="shrink-0 border-t border-border/50 bg-card dark:bg-[oklch(0.11_0.008_260)]">
            <div
              onPointerDown={onDragStart}
              className="flex h-3 cursor-row-resize items-center justify-center hover:bg-primary/10 transition-colors"
            >
              <div className="h-0.5 w-8 rounded-full bg-border" />
            </div>
            <div className="flex items-center gap-3 border-b border-border/30 px-4 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Console</span>
              <span className="font-[family-name:var(--font-jetbrains-mono)] text-[10px] text-muted-foreground/40">{entries.length} events</span>
              <div className="ml-auto flex items-center gap-1.5">
                <div className={`h-1.5 w-1.5 rounded-full ${entries.length === 0 ? "animate-pulse bg-primary" : "bg-emerald-400"}`} />
                <span className="text-[10px] text-muted-foreground/40">{entries.length === 0 ? "waiting" : "active"}</span>
              </div>
            </div>
            <div
              ref={scrollRef}
              style={{ height: consoleHeight }}
              className="overflow-y-auto px-1 py-1 font-[family-name:var(--font-jetbrains-mono)] text-xs"
            >
              {entries.length === 0 && (
                <div className="px-3 py-1.5 text-muted-foreground/30">Waiting for first action...</div>
              )}
              {entries.map((entry) => (
                <div key={entry.id} className={`group flex items-baseline gap-0 rounded px-1 py-[3px] hover:bg-foreground/[0.03] ${entry.type === "ask_user" ? "border-l-2 border-amber-500/50 bg-amber-500/5" : ""} ${entry.type === "user_response" ? "border-l-2 border-primary/50 bg-primary/5" : ""}`}>
                  <span className="w-8 shrink-0 text-right text-[10px] text-muted-foreground/25">{entry.elapsed}s</span>
                  <ConsoleEntryContent entry={entry} variant="compact" />
                </div>
              ))}
            </div>

            <ChatInput
              inputRef={chatInputRef}
              value={chatInput}
              onChange={setChatInput}
              onSubmit={handleRespond}
              pendingQuestion={pendingQuestion}
              isSending={isSending}
              variant="compact"
            />
          </div>
        </>
      )}

      {showCancelConfirm && (
        <ConfirmDialog
          title="Cancel this run?"
          description="The browser session will be stopped and any progress will be lost."
          confirmLabel="Cancel run"
          cancelLabel="Keep running"
          destructive
          onCancel={() => setShowCancelConfirm(false)}
          onConfirm={async () => {
            setShowCancelConfirm(false);
            await fetch(`/api/v1/runs/${id}`, { method: "DELETE" }).catch(() => {});
            setStatus("failed");
            setError("Run cancelled");
          }}
        />
      )}
    </div>
  );
}

function downloadSkillMarkdown(skill: SkillOutput): void {
  const blob = new Blob([skill.markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${skill.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function ConsoleEntryContent({ entry, variant }: { entry: ConsoleEntry; variant: "local" | "compact" }) {
  if (variant === "local") {
    if (entry.type === "step") {
      return (
        <div className="min-w-0 text-sm">
          <span className="rounded bg-primary/8 px-1.5 py-0.5 font-[family-name:var(--font-jetbrains-mono)] text-xs text-primary">{entry.action}</span>
          <span className="ml-2 text-muted-foreground">{entry.reasoning}</span>
        </div>
      );
    }
    if (entry.type === "ask_user") {
      return (
        <div className="min-w-0 text-sm">
          <span className="rounded bg-amber-500/10 px-1.5 py-0.5 font-[family-name:var(--font-jetbrains-mono)] text-xs text-amber-400">ask_user</span>
          <span className="ml-2 text-foreground">{entry.message}</span>
        </div>
      );
    }
    if (entry.type === "user_response") {
      return (
        <div className="min-w-0 text-sm">
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-[family-name:var(--font-jetbrains-mono)] text-xs text-primary">you</span>
          <span className="ml-2 text-foreground">{entry.message}</span>
        </div>
      );
    }
    if (entry.type === "skill_event") {
      return (
        <div className="min-w-0 text-sm">
          <span className="rounded bg-violet-500/10 px-1.5 py-0.5 font-[family-name:var(--font-jetbrains-mono)] text-xs text-violet-400">skill</span>
          <span className="ml-2 text-violet-300/70">{entry.message}</span>
        </div>
      );
    }
    return <span className="text-sm text-muted-foreground/40 italic">{entry.message}</span>;
  }

  // compact variant
  if (entry.type === "step") {
    return (
      <>
        <span className="mx-2 text-primary/80">{entry.action}</span>
        <span className="truncate text-muted-foreground/60">{entry.reasoning}</span>
      </>
    );
  }
  if (entry.type === "ask_user") {
    return (
      <>
        <span className="mx-2 text-amber-400">ask_user</span>
        <span className="truncate text-foreground">{entry.message}</span>
      </>
    );
  }
  if (entry.type === "user_response") {
    return (
      <>
        <span className="mx-2 text-primary">you</span>
        <span className="truncate text-foreground">{entry.message}</span>
      </>
    );
  }
  if (entry.type === "skill_event") {
    return (
      <>
        <span className="mx-2 text-violet-400">skill</span>
        <span className="truncate text-violet-300/70">{entry.message}</span>
      </>
    );
  }
  return <span className="mx-2 truncate text-muted-foreground/40 italic">{entry.message}</span>;
}

function ChatInput({
  inputRef,
  value,
  onChange,
  onSubmit,
  pendingQuestion,
  isSending,
  variant,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  pendingQuestion: string | null;
  isSending: boolean;
  variant: "local" | "compact";
}) {
  const isLocal = variant === "local";
  return (
    <div className={`flex items-center gap-2 border-t border-border/30 ${isLocal ? "px-4 py-2" : "px-3 py-1.5"} ${pendingQuestion ? "bg-amber-500/5 border-t-amber-500/30" : ""}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSubmit(); } }}
        placeholder={pendingQuestion ? "Type your response..." : "Waiting for agent..."}
        disabled={!pendingQuestion || isSending}
        className={`flex-1 bg-transparent px-2 ${isLocal ? "py-1.5 text-sm" : "py-1 text-xs"} focus:outline-none disabled:cursor-not-allowed`}
      />
      <button
        onClick={onSubmit}
        disabled={!pendingQuestion || !value.trim() || isSending}
        className={isLocal
          ? "rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          : "rounded-md bg-primary px-2.5 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
        }
      >
        Send
      </button>
    </div>
  );
}

