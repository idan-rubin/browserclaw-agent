import { describe, it, expect, vi } from 'vitest';

vi.mock('../config.js', () => ({
  getMinioConfig: vi.fn(() => ({ endpoint: '', bucket: '', accessKey: '', secretKey: '' })),
}));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { extractDomainLessons, hashTaskCategory } from '../lesson-store.js';
import type { AgentStep } from '../types.js';

function makeStep(
  action: AgentStep['action']['action'],
  url = 'https://example.com/page',
  opts: { reasoning?: string; error_feedback?: string } = {},
): AgentStep {
  return {
    step: 0,
    action: { action, reasoning: opts.reasoning ?? 'test', error_feedback: opts.error_feedback },
    url,
    page_title: 'Test',
    timestamp: new Date().toISOString(),
  };
}

describe('extractDomainLessons', () => {
  it('marks domain worked when anti-bot solved and agent continues', () => {
    const steps = [
      makeStep('navigate', 'https://site.com/page'),
      makeStep('press_and_hold', 'https://site.com/page'),
      makeStep('click', 'https://site.com/page'),
      makeStep('click', 'https://site.com/results'),
      makeStep('done', 'https://site.com/results'),
    ];
    const lessons = extractDomainLessons(steps, true);
    const lesson = lessons.find((l) => l.domain === 'site.com');
    expect(lesson?.status).toBe('worked');
  });

  it('does not mark blocked when anti-bot challenge was encountered but not solved — it is transient', () => {
    const steps = [
      makeStep('navigate', 'https://site.com/page'),
      makeStep('press_and_hold', 'https://site.com/page'),
      makeStep('fail', 'https://site.com/page'),
    ];
    const lessons = extractDomainLessons(steps, false);
    const lesson = lessons.find((l) => l.domain === 'site.com');
    expect(lesson?.status).not.toBe('blocked');
  });

  it('does not mark blocked on click_cloudflare alone', () => {
    const steps = [makeStep('navigate', 'https://cf.com/'), makeStep('click_cloudflare', 'https://cf.com/')];
    const lessons = extractDomainLessons(steps, false);
    const lesson = lessons.find((l) => l.domain === 'cf.com');
    expect(lesson?.status).not.toBe('blocked');
  });

  it('marks domain blocked on hard-block response text', () => {
    const steps = [
      makeStep('navigate', 'https://hostile.com/', {
        error_feedback: 'HTTP 403: access denied',
      }),
    ];
    const lessons = extractDomainLessons(steps, false);
    const lesson = lessons.find((l) => l.domain === 'hostile.com');
    expect(lesson?.status).toBe('blocked');
  });

  it('does not blacklist a site just because agent moved on after anti-bot', () => {
    const steps = [
      makeStep('navigate', 'https://sitea.com/'),
      makeStep('press_and_hold', 'https://sitea.com/'),
      makeStep('navigate', 'https://siteb.com/'),
      makeStep('click', 'https://siteb.com/results'),
      makeStep('done', 'https://siteb.com/results'),
    ];
    const lessons = extractDomainLessons(steps, true);
    const siteA = lessons.find((l) => l.domain === 'sitea.com');
    const siteB = lessons.find((l) => l.domain === 'siteb.com');
    expect(siteA?.status).not.toBe('blocked');
    expect(siteB?.status).toBe('worked');
  });

  it('does not mark domain blocked when no anti-bot and task succeeds', () => {
    const steps = [
      makeStep('navigate', 'https://clean.com/'),
      makeStep('type', 'https://clean.com/search'),
      makeStep('click', 'https://clean.com/results'),
      makeStep('extract', 'https://clean.com/results'),
      makeStep('done', 'https://clean.com/results'),
    ];
    const lessons = extractDomainLessons(steps, true);
    const lesson = lessons.find((l) => l.domain === 'clean.com');
    expect(lesson?.status).toBe('worked');
  });
});

describe('hashTaskCategory', () => {
  it('normalises synonyms', () => {
    const { terms: a } = hashTaskCategory('find apartments in Chelsea');
    const { terms: b } = hashTaskCategory('search for rentals in Chelsea');
    expect(a).toEqual(b);
  });

  it('produces same hash for semantically equivalent prompts', () => {
    const { hash: a } = hashTaskCategory('find apartments in Chelsea');
    const { hash: b } = hashTaskCategory('search for rentals in Chelsea');
    expect(a).toBe(b);
  });

  it('produces different hash for different tasks', () => {
    const { hash: a } = hashTaskCategory('find apartments in Chelsea');
    const { hash: b } = hashTaskCategory('book flights to Paris');
    expect(a).not.toBe(b);
  });
});
