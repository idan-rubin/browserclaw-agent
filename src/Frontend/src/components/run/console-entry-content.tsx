import type { ConsoleEntry } from "./types";

export function ConsoleEntryContent({ entry, variant }: { entry: ConsoleEntry; variant: "local" | "compact" }) {
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
