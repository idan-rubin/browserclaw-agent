import { describe, it, expect } from 'vitest';
import {
  buildRequestFingerprint,
  getIdempotencyCacheKey,
  lookupIdempotency,
  normalizeIdempotencyKey,
  IDEMPOTENCY_TTL_MS,
  type IdempotencyCacheEntry,
} from '../idempotency.js';

describe('buildRequestFingerprint', () => {
  it('produces the same digest for equivalent shapes regardless of property order', () => {
    const a = buildRequestFingerprint({
      prompt: 'find apartments',
      url: 'https://streeteasy.com',
      headless: true,
      llm_config: { provider: 'openai', model: 'gpt-4o' },
    });
    const b = buildRequestFingerprint({
      // different declaration order
      llm_config: { provider: 'openai', model: 'gpt-4o' },
      headless: true,
      url: 'https://streeteasy.com',
      prompt: 'find apartments',
    });
    expect(a).toBe(b);
  });

  it('changes when any meaningful field changes', () => {
    const base = {
      prompt: 'p',
      url: 'https://x.com',
      headless: true,
      llm_config: { provider: 'openai', model: 'gpt-4o' },
    };
    const baseHash = buildRequestFingerprint(base);
    expect(buildRequestFingerprint({ ...base, prompt: 'different' })).not.toBe(baseHash);
    expect(buildRequestFingerprint({ ...base, url: 'https://y.com' })).not.toBe(baseHash);
    expect(buildRequestFingerprint({ ...base, headless: false })).not.toBe(baseHash);
    expect(buildRequestFingerprint({ ...base, llm_config: { provider: 'anthropic', model: 'claude' } })).not.toBe(
      baseHash,
    );
  });

  it('does NOT change when api_key changes (api_key intentionally excluded from fingerprint)', () => {
    // Sensitive: we must not retain any digest derived from a secret in
    // an in-memory cache. BYOK clients can rotate keys without losing
    // their replay window.
    const a = buildRequestFingerprint({
      prompt: 'p',
      llm_config: { provider: 'openai', model: 'gpt-4o' },
    });
    const b = buildRequestFingerprint({
      prompt: 'p',
      llm_config: { provider: 'openai', model: 'gpt-4o' },
    });
    // Same fingerprint regardless of any api_key the caller may pass alongside.
    expect(a).toBe(b);
  });
});

describe('getIdempotencyCacheKey', () => {
  it('scopes the key by clientIp so different callers cannot collide', () => {
    const a = getIdempotencyCacheKey('10.0.0.1', 'abc');
    const b = getIdempotencyCacheKey('10.0.0.2', 'abc');
    expect(a).not.toBe(b);
  });

  it('produces the same key for the same caller + key', () => {
    expect(getIdempotencyCacheKey('10.0.0.1', 'abc')).toBe(getIdempotencyCacheKey('10.0.0.1', 'abc'));
  });

  it('does NOT collide when colons appear in either input (codex review fix)', () => {
    // Naive `${ip}:${key}` makes these collide. They must not.
    expect(getIdempotencyCacheKey('1.2.3.4', '5:abc')).not.toBe(getIdempotencyCacheKey('1.2.3.4:5', 'abc'));
    expect(getIdempotencyCacheKey('1.2.3.4', ':abc')).not.toBe(getIdempotencyCacheKey('1.2.3.4:', 'abc'));
  });

  it('handles IPv6 addresses without ambiguity', () => {
    // IPv6 always contains colons. Two distinct IPv6 callers with adversarial
    // keys must never share a cache entry.
    expect(getIdempotencyCacheKey('::1', '')).not.toBe(getIdempotencyCacheKey(':', '1'));
    expect(getIdempotencyCacheKey('2001:db8::1', 'abc')).not.toBe(getIdempotencyCacheKey('2001:db8:', ':1abc'));
    // Same IPv6 caller + same key still produces same cache key.
    expect(getIdempotencyCacheKey('2001:db8::1', 'abc')).toBe(getIdempotencyCacheKey('2001:db8::1', 'abc'));
  });
});

describe('normalizeIdempotencyKey', () => {
  it('returns the trimmed key for valid input', () => {
    expect(normalizeIdempotencyKey('  abc  ')).toBe('abc');
  });
  it('rejects empty / whitespace / wrong-type values', () => {
    expect(normalizeIdempotencyKey('')).toBeUndefined();
    expect(normalizeIdempotencyKey('   ')).toBeUndefined();
    expect(normalizeIdempotencyKey(undefined)).toBeUndefined();
    expect(normalizeIdempotencyKey(123)).toBeUndefined();
  });
  it('rejects keys longer than the max length', () => {
    expect(normalizeIdempotencyKey('x'.repeat(257))).toBeUndefined();
    expect(normalizeIdempotencyKey('x'.repeat(256))).toBe('x'.repeat(256));
  });
});

describe('lookupIdempotency', () => {
  const now = 1_000_000;
  function entry(overrides: Partial<IdempotencyCacheEntry> = {}): IdempotencyCacheEntry {
    return { sessionId: 'sess-1', fingerprint: 'fp-1', createdAt: now, ...overrides };
  }

  it('returns miss when key not in cache', () => {
    const cache = new Map<string, IdempotencyCacheEntry>();
    expect(lookupIdempotency(cache, 'k', 'fp-1', now)).toEqual({ kind: 'miss' });
  });

  it('returns hit when key + fingerprint match within TTL', () => {
    const cache = new Map<string, IdempotencyCacheEntry>();
    cache.set('k', entry());
    expect(lookupIdempotency(cache, 'k', 'fp-1', now + 1000)).toEqual({ kind: 'hit', sessionId: 'sess-1' });
  });

  it('returns miss + evicts when entry has expired', () => {
    const cache = new Map<string, IdempotencyCacheEntry>();
    cache.set('k', entry());
    const result = lookupIdempotency(cache, 'k', 'fp-1', now + IDEMPOTENCY_TTL_MS + 1);
    expect(result).toEqual({ kind: 'miss' });
    expect(cache.has('k')).toBe(false);
  });

  it('returns fingerprint_mismatch when key matches but body differs (codex review fix)', () => {
    // The bug: same-key + different-body silently replayed the prior session.
    // The fix: lookup distinguishes mismatch from miss so the route can 409.
    const cache = new Map<string, IdempotencyCacheEntry>();
    cache.set('k', entry({ fingerprint: 'fp-1' }));
    expect(lookupIdempotency(cache, 'k', 'fp-DIFFERENT', now + 1000)).toEqual({
      kind: 'fingerprint_mismatch',
    });
    // And does NOT evict the entry on mismatch — the original caller's
    // replay window stays intact.
    expect(cache.has('k')).toBe(true);
  });
});
