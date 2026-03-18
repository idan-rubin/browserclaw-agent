import { useRef, useEffect, useCallback, useState } from "react";
import { ConsoleEntryContent } from "./console-entry-content";
import { ChatInput } from "./chat-input";
import type { ConsoleEntry } from "./types";

interface RunConsoleProps {
  entries: ConsoleEntry[];
  chatInput: string;
  onChatInputChange: (value: string) => void;
  onSubmit: () => void;
  pendingQuestion: string | null;
  isSending: boolean;
  chatInputRef: React.RefObject<HTMLInputElement | null>;
  variant: "local" | "compact";
  onDraggingChange?: (isDragging: boolean) => void;
}

export function RunConsole({
  entries,
  chatInput,
  onChatInputChange,
  onSubmit,
  pendingQuestion,
  isSending,
  chatInputRef,
  variant,
  onDraggingChange,
}: RunConsoleProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [consoleHeight, setConsoleHeight] = useState(112);
  const [isDragging, setIsDragging] = useState(false);
  const consoleHeightRef = useRef(112);

  const onDragStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setIsDragging(true);
    onDraggingChange?.(true);
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
      onDraggingChange?.(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [onDraggingChange]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  if (variant === "local") {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-border/30 bg-card/30 px-6 py-3">
          <div className={`h-2 w-2 rounded-full ${entries.length === 0 ? "animate-pulse bg-primary" : "bg-emerald-400"}`} />
          <span className="text-sm font-medium">Chrome is running on your desktop</span>
          <span className="text-xs text-muted-foreground/50">{entries.length} events</span>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
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
          onChange={onChatInputChange}
          onSubmit={onSubmit}
          pendingQuestion={pendingQuestion}
          isSending={isSending}
          variant="local"
        />
      </div>
    );
  }

  // compact (VNC) variant
  return (
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
        className={`overflow-y-auto px-1 py-1 font-[family-name:var(--font-jetbrains-mono)] text-xs ${isDragging ? "select-none" : ""}`}
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
        onChange={onChatInputChange}
        onSubmit={onSubmit}
        pendingQuestion={pendingQuestion}
        isSending={isSending}
        variant="compact"
      />
    </div>
  );
}
