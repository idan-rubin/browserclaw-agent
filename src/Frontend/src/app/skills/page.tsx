"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageShell } from "@/components/page-shell";

interface Skill {
  title: string;
  description: string;
  category: string;
  steps: number;
  avgDuration: string;
}

const SKILLS: Skill[] = [
  {
    title: "Amazon Price Tracker",
    description: "Search for a product on Amazon, extract the current price, seller, and availability status.",
    category: "Shopping",
    steps: 6,
    avgDuration: "45s",
  },
  {
    title: "Google Flights Search",
    description: "Search for round-trip flights between two cities, extract the cheapest options with airlines and layover info.",
    category: "Travel",
    steps: 8,
    avgDuration: "1m 10s",
  },
  {
    title: "Hacker News Top Posts",
    description: "Extract the top 10 posts from Hacker News with title, points, author, and comment count.",
    category: "Data Extraction",
    steps: 3,
    avgDuration: "15s",
  },
  {
    title: "LinkedIn Job Search",
    description: "Search for job listings matching specific criteria, extract title, company, location, and posting date.",
    category: "Jobs",
    steps: 7,
    avgDuration: "55s",
  },
  {
    title: "Contact Form Filler",
    description: "Fill out a standard contact form with name, email, subject, and message fields.",
    category: "Forms",
    steps: 5,
    avgDuration: "20s",
  },
  {
    title: "Wikipedia Summary",
    description: "Search Wikipedia for a topic and extract the first paragraph summary with key facts.",
    category: "Research",
    steps: 4,
    avgDuration: "18s",
  },
  {
    title: "GitHub Repo Stats",
    description: "Navigate to a GitHub repository and extract stars, forks, issues, language breakdown, and latest release.",
    category: "Data Extraction",
    steps: 4,
    avgDuration: "22s",
  },
  {
    title: "Weather Forecast",
    description: "Check the 5-day weather forecast for any city, including temperature, conditions, and precipitation.",
    category: "Research",
    steps: 5,
    avgDuration: "25s",
  },
  {
    title: "Product Comparison",
    description: "Compare two products side by side on a shopping site — price, rating, specs, and availability.",
    category: "Shopping",
    steps: 10,
    avgDuration: "1m 30s",
  },
];

const CATEGORIES = ["All", ...Array.from(new Set(SKILLS.map((s) => s.category)))];

export default function SkillsPage() {
  const [filter, setFilter] = useState("All");
  const [runningSkill, setRunningSkill] = useState<string | null>(null);
  const router = useRouter();

  const filtered = filter === "All" ? SKILLS : SKILLS.filter((s) => s.category === filter);

  async function runSkill(skill: Skill) {
    if (runningSkill) return;
    setRunningSkill(skill.title);

    try {
      const res = await fetch("/api/v1/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: skill.description }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.message ?? data.error ?? "Something went wrong");
        return;
      }

      router.push(`/run/${data.session_id}`);
    } catch {
      toast.error("Failed to connect. Try again.");
    } finally {
      setRunningSkill(null);
    }
  }

  return (
    <PageShell activePath="/skills">
      <main className="flex-1 px-6 py-16 sm:px-10">
        <div className="mx-auto max-w-5xl">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Skills Library</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
            Every successful run generates a reusable skill. Browse community skills or create your own.
          </p>

          {/* Category filter */}
          <div className="mt-8 flex flex-wrap gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                  filter === cat
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:text-foreground hover:border-primary/30"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Skills grid */}
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((skill) => (
              <button
                key={skill.title}
                onClick={() => runSkill(skill)}
                disabled={runningSkill !== null}
                className="group block cursor-pointer rounded-2xl border border-border/50 bg-card/40 p-6 text-left transition-colors hover:border-primary/20 hover:bg-card/60 disabled:opacity-50"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                    {skill.category}
                  </span>
                  <span className="text-xs text-muted-foreground/50">
                    {skill.steps} steps · {skill.avgDuration}
                  </span>
                </div>
                <h3 className="mt-3 text-base font-semibold tracking-tight">{skill.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{skill.description}</p>
                <span className="mt-4 inline-block text-sm font-medium text-primary transition-colors group-hover:text-primary/80">
                  {runningSkill === skill.title ? "Starting..." : "Run this skill →"}
                </span>
              </button>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-16 text-center">
            <p className="text-muted-foreground">Don&apos;t see what you need?</p>
            <a
              href="/"
              className="mt-4 inline-block rounded-xl bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110"
            >
              Create your own skill
            </a>
          </div>
        </div>
      </main>
    </PageShell>
  );
}
