"use client";

import { useState, useEffect, useRef, use } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { isLocalBrowserMode } from "@/lib/env";
import { RunSummary } from "@/components/run/run-summary";
import { RunConsole } from "@/components/run/run-console";
import type { ConsoleEntry, SkillOutput, RunStatus } from "@/components/run/types";

const SESSION_DURATION_MS = 5 * 60 * 1000;
const VNC_BASE = process.env.NEXT_PUBLIC_VNC_URL ?? "/vnc";
const vncUrl = `${VNC_BASE}/vnc.html?autoconnect=true&resize=scale&view_only=true${VNC_BASE === "/vnc" ? "&path=vnc/websockify" : ""}`;

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

  const done = status !== "running" && status !== "waiting_for_user";

  // Elapsed timer
  useEffect(() => {
    if (done) {
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
      setEntries((prev) => [...prev, { id: prev.length, type: "thinking", message: data.message, elapsed }]);
    });

    eventSource.addEventListener("step", (e) => {
      const data = JSON.parse(e.data);
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      setEntries((prev) => [...prev, {
        id: prev.length, type: "step", step: data.step, action: data.action,
        reasoning: data.reasoning, url: data.url, page_title: data.page_title, elapsed,
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

    const addSkillEvent = (message: string) => {
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      setEntries((prev) => [...prev, { id: prev.length, type: "skill_event", message, elapsed }]);
    };

    eventSource.addEventListener("skills_loaded", (e) => {
      const data = JSON.parse(e.data);
      addSkillEvent(`Loaded ${data.count} skill${data.count > 1 ? "s" : ""} for ${data.domain}`);
    });

    eventSource.addEventListener("skill_improved", (e) => {
      const data = JSON.parse(e.data);
      addSkillEvent(`Skill improved: ${data.previous_steps} → ${data.new_steps} steps`);
    });

    eventSource.addEventListener("skill_validated", (e) => {
      const data = JSON.parse(e.data);
      addSkillEvent(`Skill validated: "${data.title}" (run #${data.run_count})`);
    });

    eventSource.addEventListener("skill_saved", (e) => {
      const data = JSON.parse(e.data);
      addSkillEvent(`New skill saved: "${data.title}"`);
    });

    eventSource.addEventListener("ask_user", (e) => {
      const data = JSON.parse(e.data);
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      setPendingQuestion(data.question);
      setStatus("waiting_for_user");
      setEntries((prev) => [...prev, { id: prev.length, type: "ask_user", message: data.question, elapsed }]);
    });

    eventSource.addEventListener("user_response", (e) => {
      const data = JSON.parse(e.data);
      const elapsed = Math.floor((Date.now() - startTime.current) / 1000);
      setStatus("running");
      setEntries((prev) => [...prev, { id: prev.length, type: "user_response", message: data.text, elapsed }]);
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
      />
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
        <RunConsole
          entries={entries}
          chatInput={chatInput}
          onChatInputChange={setChatInput}
          onSubmit={handleRespond}
          pendingQuestion={pendingQuestion}
          isSending={isSending}
          chatInputRef={chatInputRef}
          variant="local"
        />
      ) : (
        <>
          <div className="flex-1 bg-black">
            <iframe
              src={vncUrl}
              className="h-full w-full border-0"
              title="Browser stream"
            />
          </div>
          <RunConsole
            entries={entries}
            chatInput={chatInput}
            onChatInputChange={setChatInput}
            onSubmit={handleRespond}
            pendingQuestion={pendingQuestion}
            isSending={isSending}
            chatInputRef={chatInputRef}
            variant="compact"
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
