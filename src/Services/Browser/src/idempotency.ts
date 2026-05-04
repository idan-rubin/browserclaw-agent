import { createHash } from 'node:crypto';

export const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
export const IDEMPOTENCY_MAX_KEY_LENGTH = 256;

export interface FingerprintInput {
  prompt: string;
  url?: string;
  headless?: boolean;
  skip_moderation?: boolean;
  skip_postprocessing?: boolean;
  llm_config?: {
    provider: string;
    model: string;
  };
}

// api_key is intentionally NOT in the fingerprint: don't retain digests of
// secrets in memory, and BYOK clients can rotate keys without losing replay.
export function buildRequestFingerprint(input: FingerprintInput): string {
  const canonical = {
    prompt: input.prompt,
    url: input.url ?? null,
    headless: input.headless ?? null,
    skip_moderation: input.skip_moderation ?? false,
    skip_postprocessing: input.skip_postprocessing ?? false,
    llm_provider: input.llm_config?.provider ?? null,
    llm_model: input.llm_config?.model ?? null,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

// Tuple-encoded so colons in IPv6 / opaque keys can't cause ambiguous collapses.
export function getIdempotencyCacheKey(clientIp: string, idempotencyKey: string): string {
  return JSON.stringify([clientIp, idempotencyKey]);
}

export function normalizeIdempotencyKey(raw: unknown): string | undefined {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > IDEMPOTENCY_MAX_KEY_LENGTH) return undefined;
  return trimmed;
}

export interface PendingIdempotencyEntry<T> {
  kind: 'pending';
  fingerprint: string;
  createdAt: number;
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

export interface CompletedIdempotencyEntry<T> {
  kind: 'completed';
  fingerprint: string;
  createdAt: number;
  response: T;
}

export type IdempotencyCacheEntry<T> = PendingIdempotencyEntry<T> | CompletedIdempotencyEntry<T>;

export type IdempotencyLookupResult<T> =
  | { kind: 'miss' }
  | { kind: 'fingerprint_mismatch' }
  | { kind: 'pending_match'; promise: Promise<T> }
  | { kind: 'completed_match'; response: T };

// Reject + evict any pending entry older than IDEMPOTENCY_TTL_MS so a wedged
// createSession can't poison the (clientIp, key) slot indefinitely. Waiters
// awaiting the rejected promise unblock with a clean error.
export function expirePendingIdempotency<T>(cache: Map<string, IdempotencyCacheEntry<T>>, now: number): void {
  for (const [key, entry] of cache) {
    if (entry.kind === 'pending' && now - entry.createdAt > IDEMPOTENCY_TTL_MS) {
      cache.delete(key);
      entry.reject(new Error('Idempotency reservation expired (original request did not complete in time)'));
    }
  }
}

export function lookupIdempotency<T>(
  cache: Map<string, IdempotencyCacheEntry<T>>,
  cacheKey: string,
  fingerprint: string,
  now: number,
): IdempotencyLookupResult<T> {
  const entry = cache.get(cacheKey);
  if (entry === undefined) return { kind: 'miss' };
  if (now - entry.createdAt > IDEMPOTENCY_TTL_MS) {
    cache.delete(cacheKey);
    if (entry.kind === 'pending') {
      entry.reject(new Error('Idempotency reservation expired (original request did not complete in time)'));
    }
    return { kind: 'miss' };
  }
  if (entry.fingerprint !== fingerprint) {
    return { kind: 'fingerprint_mismatch' };
  }
  if (entry.kind === 'pending') {
    return { kind: 'pending_match', promise: entry.promise };
  }
  return { kind: 'completed_match', response: entry.response };
}

export function reserveIdempotency<T>(
  cache: Map<string, IdempotencyCacheEntry<T>>,
  cacheKey: string,
  fingerprint: string,
  now: number,
): PendingIdempotencyEntry<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined);
  const entry: PendingIdempotencyEntry<T> = {
    kind: 'pending',
    fingerprint,
    createdAt: now,
    promise,
    resolve,
    reject,
  };
  cache.set(cacheKey, entry);
  return entry;
}

// Reservation passed to complete/fail so a wedged-then-recovered handler can't
// overwrite a fresh entry that another request created after cleanup evicted us.
export function completeIdempotency<T>(
  cache: Map<string, IdempotencyCacheEntry<T>>,
  cacheKey: string,
  reservation: PendingIdempotencyEntry<T>,
  response: T,
  now: number,
): void {
  if (cache.get(cacheKey) !== reservation) return;
  cache.set(cacheKey, {
    kind: 'completed',
    fingerprint: reservation.fingerprint,
    createdAt: now,
    response,
  });
  reservation.resolve(response);
}

export function failIdempotency<T>(
  cache: Map<string, IdempotencyCacheEntry<T>>,
  cacheKey: string,
  reservation: PendingIdempotencyEntry<T>,
  error: Error,
): void {
  if (cache.get(cacheKey) === reservation) {
    cache.delete(cacheKey);
  }
  reservation.reject(error);
}
