import type { AgentAction, AgentStep } from './types.js';
import { logger } from './logger.js';

// Pilot must have had a real chance before co-pilot overrides a `fail`.
const MIN_STEPS_BEFORE_VETO_FAIL = 3;
// Remaining steps required to be worth a fresh attempt (one new site from scratch).
const MIN_STEPS_REMAINING_FOR_VETO_FAIL = 10;
// At least this many candidate URLs to make batch worth it vs single-click drill.
const MIN_URLS_FOR_BATCH = 5;
// Batch applies only shortly after a list extract; beyond this many steps the context is stale.
const MAX_STEPS_SINCE_LIST_EXTRACT = 3;
// Upper bound on URLs sent to batch extract (matches extractItemsFromUrls cap).
const MAX_URLS_PER_BATCH = 8;
// A list extract only earns the "list" label if it returned this many records with URLs.
const MIN_RECORDS_FOR_LIST_LABEL = 3;
// Cap when harvesting URLs from extract records into observation state.
const MAX_URLS_TO_OBSERVE = 10;

export type CopilotDirective =
  | { kind: 'construct_url'; url: string; reason: string }
  | { kind: 'batch_details'; urls: string[]; reason: string }
  | { kind: 'switch_target'; query: string; excludeHost: string; reason: string }
  | { kind: 'veto_fail'; replacementQuery: string; reason: string };

export interface CopilotState {
  seenFilterTokens: Set<string>;
  blockedDomains: Set<string>;
  recentListExtractUrls: string[];
  lastListExtractStep: number;
  extractsWithDataCount: number;
  firedDirectives: Set<string>;
}

export function newCopilotState(): CopilotState {
  return {
    seenFilterTokens: new Set(),
    blockedDomains: new Set(),
    recentListExtractUrls: [],
    lastListExtractStep: -1,
    extractsWithDataCount: 0,
    firedDirectives: new Set(),
  };
}

export interface ObserveInput {
  step: number;
  preUrl: string;
  postUrl: string;
  extractRecords?: { url?: string }[];
  navigateError?: { host: string } | null;
}

export function observe(state: CopilotState, input: ObserveInput): void {
  if (input.preUrl !== input.postUrl) {
    for (const t of extractFilterTokens(input.preUrl)) state.seenFilterTokens.add(t);
    for (const t of extractFilterTokens(input.postUrl)) state.seenFilterTokens.add(t);
  }

  if (input.extractRecords !== undefined) {
    const urls: string[] = [];
    for (const r of input.extractRecords) {
      const u = typeof r.url === 'string' ? r.url : '';
      if (u !== '' && !urls.includes(u)) urls.push(u);
      if (urls.length >= MAX_URLS_TO_OBSERVE) break;
    }
    if (urls.length >= MIN_RECORDS_FOR_LIST_LABEL) {
      state.recentListExtractUrls = urls;
      state.lastListExtractStep = input.step;
    }
    if (input.extractRecords.length > 0) state.extractsWithDataCount++;
  }

  if (input.navigateError !== undefined && input.navigateError !== null) {
    if (input.navigateError.host !== '') state.blockedDomains.add(input.navigateError.host);
  }
}

export interface EvaluateInput {
  step: number;
  stepsRemaining: number;
  pendingActions: AgentAction[];
  currentUrl: string;
  history: AgentStep[];
}

export function evaluate(state: CopilotState, input: EvaluateInput): CopilotDirective | null {
  if (input.pendingActions.length === 0) return null;
  const first = input.pendingActions[0];

  if (
    first.action === 'fail' &&
    state.extractsWithDataCount === 0 &&
    input.step >= MIN_STEPS_BEFORE_VETO_FAIL &&
    input.stepsRemaining >= MIN_STEPS_REMAINING_FOR_VETO_FAIL
  ) {
    const key = `veto_fail:${String(input.step)}`;
    if (!state.firedDirectives.has(key)) {
      state.firedDirectives.add(key);
      return {
        kind: 'veto_fail',
        replacementQuery: 'apartments for rent Chelsea Manhattan listings site alternative',
        reason: 'No listings collected yet and run budget remains — try a different source before giving up.',
      };
    }
  }

  if (first.action === 'navigate' && typeof first.url === 'string') {
    const host = safeHost(first.url);
    if (host !== '' && state.blockedDomains.has(host)) {
      const key = `switch_target:${host}`;
      if (!state.firedDirectives.has(key)) {
        state.firedDirectives.add(key);
        return {
          kind: 'switch_target',
          query: 'apartments for rent Chelsea Manhattan listings site',
          excludeHost: host,
          reason: `${host} previously timed out — trying an alternative source.`,
        };
      }
    }
  }

  if (
    first.action === 'click' &&
    state.recentListExtractUrls.length >= MIN_URLS_FOR_BATCH &&
    input.step - state.lastListExtractStep <= MAX_STEPS_SINCE_LIST_EXTRACT
  ) {
    const urls = state.recentListExtractUrls.slice(0, MAX_URLS_PER_BATCH);
    const key = `batch_details:${urls.slice(0, 5).join(',')}`;
    if (!state.firedDirectives.has(key)) {
      state.firedDirectives.add(key);
      return {
        kind: 'batch_details',
        urls,
        reason: `Pilot about to drill one listing; preempting with parallel batch fetch of ${String(urls.length)} candidates.`,
      };
    }
  }

  return null;
}

export function buildFilterLossDirective(state: CopilotState, postUrl: string): CopilotDirective | null {
  const postTokens = new Set(extractFilterTokens(postUrl));
  if (postTokens.size === 0) return null;
  const lost: string[] = [];
  for (const t of state.seenFilterTokens) {
    if (!postTokens.has(t)) lost.push(t);
  }
  if (lost.length === 0) return null;
  const combined = buildCombinedTokenUrl(postUrl, state.seenFilterTokens);
  if (combined === null) return null;
  const key = `construct_url:${combined}`;
  if (state.firedDirectives.has(key)) return null;
  state.firedDirectives.add(key);
  return {
    kind: 'construct_url',
    url: combined,
    reason: `Filter token(s) "${lost.join(', ')}" dropped; consolidating into single URL.`,
  };
}

export function applyDirective(directive: CopilotDirective, pendingActions: AgentAction[]): AgentAction[] {
  logger.warn({ directive: directive.kind, reason: directive.reason }, 'copilot_directive');
  switch (directive.kind) {
    case 'batch_details':
      return [
        {
          action: 'extract',
          reasoning: `Co-pilot: ${directive.reason}`,
          urls: directive.urls,
        },
      ];
    case 'switch_target':
      return [
        {
          action: 'web_search',
          reasoning: `Co-pilot: ${directive.reason}`,
          query: directive.query,
        },
      ];
    case 'veto_fail':
      return [
        {
          action: 'web_search',
          reasoning: `Co-pilot: ${directive.reason}`,
          query: directive.replacementQuery,
        },
      ];
    case 'construct_url':
      return pendingActions;
  }
}

export function extractFilterTokens(pageUrl: string): string[] {
  try {
    const path = decodeURIComponent(new URL(pageUrl).pathname);
    const out: string[] = [];
    for (const part of path.split('/')) {
      for (const tok of part.split('|')) {
        if (tok.includes(':') && /^[A-Za-z][\w-]*:.+$/.test(tok)) out.push(tok);
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function buildCombinedTokenUrl(referenceUrl: string, tokens: Set<string>): string | null {
  try {
    const u = new URL(referenceUrl);
    const parts = decodeURIComponent(u.pathname)
      .split('/')
      .filter((p) => p.length > 0);
    const byKey = new Map<string, string[]>();
    for (const token of tokens) {
      const idx = token.indexOf(':');
      if (idx <= 0) continue;
      const key = token.slice(0, idx);
      const value = token.slice(idx + 1);
      const bucket = byKey.get(key);
      if (bucket === undefined) byKey.set(key, [value]);
      else if (!bucket.includes(value)) bucket.push(value);
    }
    if (byKey.size === 0) return null;
    const segments: string[] = [];
    for (const [key, values] of [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      segments.push(`${key}:${values.sort().join(',')}`);
    }
    const combined = segments.join('|');
    let tokenIdx = -1;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].includes(':') && /^[A-Za-z][\w-]*:/.test(parts[i])) {
        tokenIdx = i;
        break;
      }
    }
    if (tokenIdx >= 0) parts[tokenIdx] = combined;
    else parts.push(combined);
    u.pathname = '/' + parts.join('/');
    return u.toString();
  } catch {
    return null;
  }
}

function safeHost(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
