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
    <div className="rounded-3xl border border-border bg-card p-2 sm:p-3">
      <div className="flex flex-wrap items-center gap-1 rounded-full bg-muted p-1 sm:w-fit">
        {SAMPLES.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => {
              setActive(i);
            }}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition-all sm:text-sm ${
              i === active ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            }`}
            aria-pressed={i === active}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-5 px-4 py-6 sm:flex-row sm:items-center sm:gap-8 sm:px-5 sm:py-8">
        <p className="flex-1 text-base text-foreground sm:text-xl sm:leading-snug">{current.prompt}</p>
        <Link
          href={`/try?prompt=${encodeURIComponent(current.prompt)}`}
          className="shrink-0 rounded-full bg-primary px-6 py-3 text-center text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.03] active:scale-[0.97] sm:text-base"
        >
          Try this &rarr;
        </Link>
      </div>
    </div>
  );
}
