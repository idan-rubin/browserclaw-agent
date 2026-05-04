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

export function lookupIdempotency<T>(
  cache: Map<string, IdempotencyCacheEntry<T>>,
  cacheKey: string,
  fingerprint: string,
  now: number,
): IdempotencyLookupResult<T> {
  const entry = cache.get(cacheKey);
  if (entry === undefined) return { kind: 'miss' };
  if (entry.kind === 'completed' && now - entry.createdAt > IDEMPOTENCY_TTL_MS) {
    cache.delete(cacheKey);
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
): { resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  promise.catch(() => undefined);
  cache.set(cacheKey, { kind: 'pending', fingerprint, createdAt: now, promise, resolve, reject });
  return { resolve, reject };
}

export function completeIdempotency<T>(
  cache: Map<string, IdempotencyCacheEntry<T>>,
  cacheKey: string,
  response: T,
  fingerprint: string,
  now: number,
): void {
  const prior = cache.get(cacheKey);
  cache.set(cacheKey, { kind: 'completed', fingerprint, createdAt: now, response });
  if (prior?.kind === 'pending') {
    prior.resolve(response);
  }
}

export function failIdempotency<T>(cache: Map<string, IdempotencyCacheEntry<T>>, cacheKey: string, error: Error): void {
  const prior = cache.get(cacheKey);
  cache.delete(cacheKey);
  if (prior?.kind === 'pending') {
    prior.reject(error);
  }
}
