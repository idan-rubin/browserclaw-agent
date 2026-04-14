'use client';

import Link from 'next/link';
import { useState } from 'react';

interface Sample {
  label: string;
  prompt: string;
}

const SAMPLES: Sample[] = [
  {
    label: 'Apartments',
    prompt:
      'Find 5 dog-friendly apartments in Chelsea under $4,200/month. For each listing, report the price, address, number of bedrooms, and listing URL.',
  },
  {
    label: 'Government',
    prompt:
      "Use the New York DMV site to find the documents needed to renew a driver's license. List the ID requirements, fees, and whether it can be done online or requires an in-person visit.",
  },
  {
    label: 'Tickets',
    prompt:
      'Find a table for 4 tonight at 8:30pm — whichever of Carbone, Rezdora, or Raoul\u2019s has availability first. Report the restaurant, time, and booking link.',
  },
  {
    label: 'Jobs',
    prompt:
      'Find 5 senior software engineer roles in NYC posted in the last 14 days with a disclosed base salary of $200k or more. Report company, title, salary, and posted date.',
  },
];

export function SamplePrompts() {
  const [active, setActive] = useState(0);
  const current = SAMPLES[active] ?? SAMPLES[0];
  return (
    <div className="rounded-2xl border border-border bg-card/60 p-2 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-1 rounded-xl bg-background/40 p-1">
        {SAMPLES.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => {
              setActive(i);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold tracking-wide transition-all sm:text-sm ${
              i === active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-card/60 hover:text-foreground'
            }`}
            aria-pressed={i === active}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:gap-5">
        <p className="flex-1 text-sm text-foreground/90 sm:text-base">{current.prompt}</p>
        <Link
          href={`/try?prompt=${encodeURIComponent(current.prompt)}`}
          className="shrink-0 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:brightness-110 active:scale-[0.97]"
        >
          Try this &rarr;
        </Link>
      </div>
    </div>
  );
}
