import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';
import { StatCard } from '@/components/stat-card';
import { SkillCard } from './skill-card';
import type { ConsoleEntry, SkillOutput, DomainSkillEntry, RunStatus } from './types';
import { STATUS_CONFIG, formatDuration } from './types';

async function downloadAllSkills(entries: DomainSkillEntry[]): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  for (const entry of entries) {
    zip.file(`${entry.domain}.md`, entry.skill.markdown);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'browserclaw-skills.zip';
  a.click();
  URL.revokeObjectURL(url);
}

interface RunSummaryProps {
  status: RunStatus;
  answer: string | null;
  error: string | null;
  duration: number;
  entries: ConsoleEntry[];
  skill: SkillOutput | null;
  skillStats: { llm_calls?: number; skills_used?: boolean; skill_outcome?: string } | null;
  domainSkills?: DomainSkillEntry[];
}

export function RunSummary({
  status,
  answer,
  error,
  duration,
  entries,
  skill,
  skillStats,
  domainSkills,
}: RunSummaryProps) {
  const stepEntries = entries.filter((e) => e.type === 'step');
  const uniquePages = [...new Set(stepEntries.map((s) => s.page_title).filter(Boolean))];

  return (
    <div className="flex min-h-screen flex-col">
      <nav className="flex items-center justify-between border-b border-border/50 px-4 py-4 sm:px-6">
        <Link href="/" className="font-[family-name:var(--font-heading)] text-lg tracking-tight">
          browserclaw
        </Link>
        <ThemeToggle />
      </nav>

      <div className="flex flex-1 justify-center overflow-y-auto px-4 py-10 sm:py-16">
        <div className="w-full max-w-2xl space-y-8 animate-page-in">
          {/* Status */}
          <div className="text-center">
            <span
              className={`inline-flex items-center gap-2.5 rounded-full px-5 py-2 text-sm font-semibold tracking-wide ${STATUS_CONFIG[status].badge}`}
            >
              <span className={`h-2 w-2 rounded-full ${STATUS_CONFIG[status].dot}`} />
              {STATUS_CONFIG[status].label}
            </span>
          </div>

          {/* Answer */}
          {answer != null && answer !== '' && (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 sm:p-6">
              <span className="inline-block rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                Answer
              </span>
              <p className="mt-3 text-lg leading-relaxed">{answer}</p>
            </div>
          )}

          {/* Error banner */}
          {error != null && error !== '' && (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-3.5 text-center text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Stats */}
          <div
            className={`grid gap-3 sm:gap-5 ${skillStats?.llm_calls != null && skillStats.llm_calls > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}
          >
            <StatCard value={formatDuration(duration)} label="Duration" />
            <StatCard value={String(stepEntries.length)} label="Total steps" />
            <StatCard value={String(uniquePages.length)} label="Pages visited" />
            {skillStats?.llm_calls != null && skillStats.llm_calls > 0 && (
              <StatCard value={String(skillStats.llm_calls)} label="LLM calls" />
            )}
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
                    key={entry.id}
                    className={`flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-card/40 ${
                      i === stepEntries.length - 1 ? 'bg-card/20' : ''
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

          {/* Domain Skills */}
          {domainSkills != null && domainSkills.length > 0 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {domainSkills.length === 1 ? 'Skill' : `Skills (${String(domainSkills.length)})`}
                </h3>
                <button
                  onClick={() => {
                    void downloadAllSkills(domainSkills);
                  }}
                  className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary backdrop-blur-sm transition-colors hover:bg-primary/20"
                >
                  Download .zip
                </button>
              </div>
              {domainSkills.map((entry) => (
                <SkillCard key={entry.domain} skill={entry.skill} domain={entry.domain} source={entry.source} />
              ))}
            </div>
          )}

          {/* Fallback: single skill if no domain skills */}
          {(domainSkills == null || domainSkills.length === 0) && skill != null && <SkillCard skill={skill} />}

          {/* Home */}
          <div className="pb-6 text-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-background px-8 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
