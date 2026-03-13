"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { ThemeToggle } from "@/components/theme-toggle";
import { StatCard } from "@/components/stat-card";

function ErrorContent() {
  const params = useSearchParams();
  const error = params.get("error") ?? "Something went wrong";
  const detail = params.get("detail");
  const prompt = params.get("prompt");

  return (
    <div className="w-full max-w-2xl space-y-8 animate-page-in">
      {/* Status */}
      <div className="text-center">
        <span className="inline-flex items-center gap-2.5 rounded-full bg-red-500/10 px-5 py-2 text-sm font-semibold tracking-wide text-red-400 ring-1 ring-red-500/20">
          <span className="h-2 w-2 rounded-full bg-red-400" />
          Run failed
        </span>
      </div>

      {/* Error details */}
      <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-5 sm:p-6">
        <span className="inline-block rounded-md bg-red-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-red-400">
          Error
        </span>
        <p className="mt-3 text-lg leading-relaxed">{error}</p>
        {detail && (
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail}</p>
        )}
      </div>

      {/* Original prompt */}
      {prompt && (
        <div className="rounded-2xl border border-border/50 bg-card/30 p-5 backdrop-blur-sm sm:p-6">
          <span className="inline-block rounded-md bg-muted/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Prompt
          </span>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{prompt}</p>
        </div>
      )}

      {/* Stats — zero state */}
      <div className="grid grid-cols-3 gap-3 sm:gap-5">
        <StatCard value="0s" label="Duration" />
        <StatCard value="0" label="Total steps" />
        <StatCard value="0" label="Pages visited" />
      </div>

      {/* Actions */}
      <div className="flex flex-col items-center gap-4 pb-6">
        {prompt && (
          <a
            href={`/?prompt=${encodeURIComponent(prompt)}`}
            className="rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97]"
          >
            Try again
          </a>
        )}
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
          Back to home
        </a>
      </div>
    </div>
  );
}

export default function ErrorPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <nav className="flex items-center justify-between border-b border-border/50 px-4 py-4 sm:px-6">
        <a href="/" className="font-[family-name:var(--font-heading)] text-lg tracking-tight">
          browserclaw
        </a>
        <ThemeToggle />
      </nav>

      <div className="flex flex-1 justify-center overflow-y-auto px-4 py-10 sm:py-16">
        <Suspense>
          <ErrorContent />
        </Suspense>
      </div>
    </div>
  );
}
