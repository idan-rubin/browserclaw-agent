'use client';

import { useState } from 'react';

interface Sample {
  label: string;
  prompt: string;
  result: string;
}

const SAMPLES: Sample[] = [
  {
    label: 'Apartments',
    prompt: 'Find 5 dog-friendly apartments in Chelsea under $4,200/month',
    result: `[
  { "addr": "251 W 19th St #4B", "rent": 3950, "beds": 1, "pets": "yes" },
  { "addr": "310 W 23rd St #12C", "rent": 4100, "beds": 1, "pets": "cats+dogs" },
  { "addr": "150 W 22nd St #7", "rent": 4195, "beds": 1, "pets": "yes" },
  { "addr": "425 W 23rd St #3E", "rent": 4000, "beds": 1, "pets": "yes" },
  { "addr": "200 W 20th St #9D", "rent": 3875, "beds": 1, "pets": "yes" }
]`,
  },
  {
    label: 'Government',
    prompt: "Documents needed to renew my NY driver's license",
    result: `{
  "docs": ["current license", "SSN", "proof of address"],
  "fees": { "renewal": 64.50, "online": 64.50 },
  "online_eligible": true,
  "in_person_required_if": ["license expired > 2 years", "photo > 10 years old"]
}`,
  },
  {
    label: 'Tickets',
    prompt: 'Table for 4 tonight 8:30pm at Carbone, Rezdora, or Raoul\u2019s',
    result: `{
  "available": "Raoul\u2019s",
  "time": "20:45",
  "party_size": 4,
  "booking_url": "https://resy.com/cities/ny/raouls?date=..."
}`,
  },
  {
    label: 'Jobs',
    prompt: '5 senior eng roles in NYC, last 14 days, salary ≥ $200k',
    result: `[
  { "co": "Anthropic", "title": "Sr Eng — Infra", "base": 230000, "posted": "3d" },
  { "co": "Ramp", "title": "Staff Eng — Payments", "base": 245000, "posted": "5d" },
  { "co": "Figma", "title": "Sr Eng — Desktop", "base": 220000, "posted": "7d" },
  { "co": "Datadog", "title": "Sr Eng — APM", "base": 210000, "posted": "10d" },
  { "co": "Notion", "title": "Sr Eng — AI", "base": 235000, "posted": "12d" }
]`,
  },
];

export function HeroDemoMock() {
  const [active, setActive] = useState(0);
  const current = SAMPLES[active] ?? SAMPLES[0];
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm shadow-2xl overflow-hidden">
      <div className="flex items-center gap-1 border-b border-border/60 bg-background/40 px-2 py-1.5">
        {SAMPLES.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => {
              setActive(i);
            }}
            className={`rounded-md px-2.5 py-1 font-[family-name:var(--font-jetbrains-mono)] text-[10px] uppercase tracking-widest transition-colors ${
              i === active ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground/70 hover:text-foreground'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="px-5 py-4 font-[family-name:var(--font-jetbrains-mono)] text-[12px] leading-relaxed">
        <div className="mb-3 flex gap-2">
          <span className="text-primary">{'>'}</span>
          <span className="text-foreground/90">{current.prompt}</span>
        </div>
        <pre className="whitespace-pre-wrap text-muted-foreground">{current.result}</pre>
      </div>
    </div>
  );
}
