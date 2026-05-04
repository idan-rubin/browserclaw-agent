import { describe, it, expect } from 'vitest';
import {
  buildRequestFingerprint,
  completeIdempotency,
  expirePendingIdempotency,
  failIdempotency,
  getIdempotencyCacheKey,
  lookupIdempotency,
  normalizeIdempotencyKey,
  reserveIdempotency,
  IDEMPOTENCY_TTL_MS,
  type IdempotencyCacheEntry,
} from '../idempotency.js';

interface TestResponse {
  session_id: string;
}

describe('buildRequestFingerprint', () => {
  it('produces the same digest for equivalent shapes regardless of property order', () => {
    const a = buildRequestFingerprint({
      prompt: 'find apartments',
      url: 'https://streeteasy.com',
      headless: true,
      llm_config: { provider: 'openai', model: 'gpt-4o' },
    });
    const b = buildRequestFingerprint({
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

  it('excludes api_key (do not retain secret digests; BYOK rotation must not break replay)', () => {
    const a = buildRequestFingerprint({ prompt: 'p', llm_config: { provider: 'openai', model: 'gpt-4o' } });
    const b = buildRequestFingerprint({ prompt: 'p', llm_config: { provider: 'openai', model: 'gpt-4o' } });
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

  it('does not collide when colons appear in either input', () => {
    expect(getIdempotencyCacheKey('1.2.3.4', '5:abc')).not.toBe(getIdempotencyCacheKey('1.2.3.4:5', 'abc'));
    expect(getIdempotencyCacheKey('1.2.3.4', ':abc')).not.toBe(getIdempotencyCacheKey('1.2.3.4:', 'abc'));
  });

  it('handles IPv6 addresses without ambiguity', () => {
    expect(getIdempotencyCacheKey('::1', '')).not.toBe(getIdempotencyCacheKey(':', '1'));
    expect(getIdempotencyCacheKey('2001:db8::1', 'abc')).not.toBe(getIdempotencyCacheKey('2001:db8:', ':1abc'));
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
  function completed(
    overrides: Partial<IdempotencyCacheEntry<TestResponse>> = {},
  ): IdempotencyCacheEntry<TestResponse> {
    return {
      kind: 'completed',
      fingerprint: 'fp-1',
      createdAt: now,
      response: { session_id: 'sess-1' },
      ...overrides,
    } as IdempotencyCacheEntry<TestResponse>;
  }

  it('returns miss when key not in cache', () => {
    const cache = new Map<string, IdempotencyCacheEntry<TestResponse>>();
    expect(lookupIdempotency(cache, 'k', 'fp-1', now)).toEqual({ kind: 'miss' });
  });

  it('returns completed_match when key + fingerprint match within TTL', () => {
    const cache = new Map<string, IdempotencyCacheEntry<TestResponse>>();
    cache.set('k', completed());
    expect(lookupIdempotency(cache, 'k', 'fp-1', now + 1000)).toEqual({
      kind: 'completed_match',
      response: { session_id: 'sess-1' },
    });
  });

  it('returns miss + evicts when completed entry has expired', () => {
    const cache = new Map<string, IdempotencyCacheEntry<TestResponse>>();
    cache.set('k', completed());
    const result = lookupIdempotency(cache, 'k', 'fp-1', now + IDEMPOTENCY_TTL_MS + 1);
    expect(result).toEqual({ kind: 'miss' });
    expect(cache.has('k')).toBe(false);
  });

  it('returns fingerprint_mismatch without evicting the entry', () => {
    const cache = new Map<string, IdempotencyCacheEntry<TestResponse>>();
    cache.set('k', completed());
    expect(lookupIdempotency(cache, 'k', 'fp-DIFFERENT', now + 1000)).toEqual({
      kind: 'fingerprint_mismatch',
    });
    expect(cache.has('k')).toBe(true);
  });

  it('returns pending_match while a request is in flight', async () => {
    const cache = new Map<string, IdempotencyCacheEntry<TestResponse>>();
    const reservation = reserveIdempotency<TestResponse>(cache, 'k', 'fp-1', now);
    const result = lookupIdempotency(cache, 'k', 'fp-1', now + 1000);
    expect(result.kind).toBe('pending_match');
    if (result.kind !== 'pending_match') throw new Error('unreachable');
    const final = { session_id: 'sess-shared' };
    completeIdempotency(cache, 'k', reservation, final, now + 2000);
    await expect(result.promise).resolves.toEqual(final);
  });

  it('rejects + evicts a pending entry that has gone past TTL via lookup (anti-wedge)', async () => {
    const cache = new Map<string, IdempotencyCacheEntry<TestResponse>>();
    const reservation = reserveIdempotency<TestResponse>(cache, 'k', 'fp-1', now);
    const result = lookupIdempotency(cache, 'k', 'fp-1', now + IDEMPOTENCY_TTL_MS + 1);
    expect(result).toEqual({ kind: 'miss' });
    expect(cache.has('k')).toBe(false);
    await expect(reservation.promise).rejects.toThrow(/expired/);
  });
});

describe('reserve / complete / fail lifecycle', () => {
  const now = 2_000_000;

  it('replays the cached response even when the live session is gone', () => {
    const cache = new Map<string, IdempotencyCacheEntry<TestResponse>>();
    const original: TestResponse = { session_id: 'sess-original' };
    const reservation = reserveIdempotency<TestResponse>(cache, 'k', 'fp-1', now);
    completeIdempotency(cache, 'k', reservation, original, now + 100);
    expect(lookupIdempotency(cache, 'k', 'fp-1', now + 60_000)).toEqual({
      kind: 'completed_match',
      response: original,
    });
  });

  it('failIdempotency rejects waiters and evicts so retries can succeed', async () => {
    const cache = new Map<string, IdempotencyCacheEntry<TestResponse>>();
    const reservation = reserveIdempotency<TestResponse>(cache, 'k', 'fp-1', now);
    const second = lookupIdempotency(cache, 'k', 'fp-1', now + 1);
    if (second.kind !== 'pending_match') throw new Error('expected pending_match');
    failIdempotency(cache, 'k', reservation, new Error('createSession failed'));
    await expect(second.promise).rejects.toThrow(/createSession failed/);
    expect(cache.has('k')).toBe(false);
    expect(lookupIdempotency(cache, 'k', 'fp-1', now + 2)).toEqual({ kind: 'miss' });
  });

  it('forwards the original Error instance to waiters so the route can preserve its status', async () => {
    class FakeHttpError extends Error {
      constructor(
        public statusCode: number,
        message: string,
      ) {
        super(message);
      }
    }
    const cache = new Map<string, IdempotencyCacheEntry<TestResponse>>();
    const reservation = reserveIdempotency<TestResponse>(cache, 'k', 'fp-1', now);
    const second = lookupIdempotency(cache, 'k', 'fp-1', now + 1);
    if (second.kind !== 'pending_match') throw new Error('expected pending_match');
    failIdempotency(cache, 'k', reservation, new FakeHttpError(422, 'Prompt blocked by content policy.'));
    await expect(second.promise).rejects.toBeInstanceOf(FakeHttpError);
    await expect(second.promise).rejects.toMatchObject({
      statusCode: 422,
      message: 'Prompt blocked by content policy.',
    });
  });

  it('completeIdempotency unblocks waiters and persists the response for replay', async () => {
    const cache = new Map<string, IdempotencyCacheEntry<TestResponse>>();
    const reservation = reserveIdempotency<TestResponse>(cache, 'k', 'fp-1', now);
    const second = lookupIdempotency(cache, 'k', 'fp-1', now + 1);
    if (second.kind !== 'pending_match') throw new Error('expected pending_match');
    const response: TestResponse = { session_id: 'sess-1' };
    completeIdempotency(cache, 'k', reservation, response, now + 100);
    await expect(second.promise).resolves.toEqual(response);
    expect(lookupIdempotency(cache, 'k', 'fp-1', now + 200)).toEqual({
      kind: 'completed_match',
      response,
    });
  });

  it('expirePendingIdempotency rejects + evicts wedged pending entries', async () => {
    const cache = new Map<string, IdempotencyCacheEntry<TestResponse>>();
    const reservation = reserveIdempotency<TestResponse>(cache, 'wedged', 'fp-1', now);
    const waiter = lookupIdempotency(cache, 'wedged', 'fp-1', now + 1);
    if (waiter.kind !== 'pending_match') throw new Error('expected pending_match');

    expirePendingIdempotency(cache, now + IDEMPOTENCY_TTL_MS + 1);

    await expect(reservation.promise).rejects.toThrow(/expired/);
    await expect(waiter.promise).rejects.toThrow(/expired/);
    expect(cache.has('wedged')).toBe(false);
  });

  it('completeIdempotency is a no-op if the reservation was already evicted (recovered wedge cannot poison fresh entries)', async () => {
    const cache = new Map<string, IdempotencyCacheEntry<TestResponse>>();
    const wedged = reserveIdempotency<TestResponse>(cache, 'k', 'fp-1', now);
    expirePendingIdempotency(cache, now + IDEMPOTENCY_TTL_MS + 1);
    await expect(wedged.promise).rejects.toThrow();
    // A fresh reservation comes in for the same key.
    const fresh = reserveIdempotency<TestResponse>(cache, 'k', 'fp-1', now + IDEMPOTENCY_TTL_MS + 100);
    // The wedged handler eventually completes — must NOT overwrite the fresh entry.
    completeIdempotency(cache, 'k', wedged, { session_id: 'sess-wedged' }, now + IDEMPOTENCY_TTL_MS + 200);
    expect(cache.get('k')).toBe(fresh);
    // The fresh request can still complete normally.
    completeIdempotency(cache, 'k', fresh, { session_id: 'sess-fresh' }, now + IDEMPOTENCY_TTL_MS + 300);
    expect(lookupIdempotency(cache, 'k', 'fp-1', now + IDEMPOTENCY_TTL_MS + 400)).toEqual({
      kind: 'completed_match',
      response: { session_id: 'sess-fresh' },
    });
  });
});
