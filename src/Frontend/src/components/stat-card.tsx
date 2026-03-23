export function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-2xl border border-border/50 bg-card/30 p-4 text-center backdrop-blur-sm sm:p-5">
      <div className="font-[family-name:var(--font-jetbrains-mono)] text-2xl font-bold tabular-nums sm:text-3xl">
        {value}
      </div>
      <div className="mt-1.5 text-xs tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
