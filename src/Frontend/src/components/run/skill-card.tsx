import type { SkillOutput } from "./types";

function downloadSkillMarkdown(skill: SkillOutput): void {
  const blob = new Blob([skill.markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${skill.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

export function SkillCard({ skill }: { skill: SkillOutput }) {
  return (
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
  );
}
