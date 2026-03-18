export interface ConsoleEntry {
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

export interface SkillOutput {
  title: string;
  description: string;
  steps: { number: number; description: string; action: string; details?: string }[];
  metadata: { prompt: string; url: string; total_steps: number; duration_ms: number };
  markdown: string;
}

export type RunStatus = "running" | "waiting_for_user" | "completed" | "failed" | "timeout";

export const STATUS_CONFIG: Record<RunStatus, { badge: string; dot: string; label: string }> = {
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

export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
