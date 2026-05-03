import { createHash } from 'node:crypto';

/**
 * Idempotency-Key helpers for POST /api/v1/sessions.
 *
 * Codex review on PR #139 caught that the prior implementation scoped
 * cache entries only by the raw key, which meant:
 *   1. Two clients colliding on a key (or one client maliciously reusing
 *      another's key) could receive the wrong session_id — cross-user leak.
 *   2. The same client sending the same key with a different body would
 *      silently get the prior session back instead of a fresh one or an error.
 *
 * Fix: scope cache keys by caller (clientIp) and verify request body
 * fingerprint matches on replay. On fingerprint mismatch return 409 per
 * RFC-style idempotency semantics.
 */

export const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
export const IDEMPOTENCY_MAX_KEY_LENGTH = 256;

/**
 * The subset of CreateSessionRequest used to fingerprint a request. We
 * deliberately EXCLUDE `llm_config.api_key`: it's a secret that should not
 * be retained in memory (even hashed), and replays with a different api_key
 * for the same prompt+model are reasonable for BYOK clients.
 */
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

/**
 * Build a stable hex-digest fingerprint of the meaningful request shape.
 * Two requests with the same shape produce the same fingerprint regardless
 * of property order or undefined-vs-omitted differences.
 */
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

/**
 * Compose the cache key. Scoping by clientIp blocks the cross-user leak:
 * two different IPs with the same Idempotency-Key now hit different cache
 * entries. (When a real auth/user identity is wired in, prefer that over
 * IP — until then, IP is the strongest stable caller signal we have.)
 */
export function getIdempotencyCacheKey(clientIp: string, idempotencyKey: string): string {
  return `${clientIp}:${idempotencyKey}`;
}

/** Validate and normalize an Idempotency-Key header value. */
export function normalizeIdempotencyKey(raw: unknown): string | undefined {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > IDEMPOTENCY_MAX_KEY_LENGTH) return undefined;
  return trimmed;
}

export interface IdempotencyCacheEntry {
  sessionId: string;
  fingerprint: string;
  createdAt: number;
}

export type IdempotencyLookupResult =
  | { kind: 'miss' }
  | { kind: 'hit'; sessionId: string }
  | { kind: 'fingerprint_mismatch' };

/**
 * Look up a cache entry and decide replay/conflict/miss without mutating.
 * Caller is responsible for actually replaying or creating-and-storing.
 */
export function lookupIdempotency(
  cache: Map<string, IdempotencyCacheEntry>,
  cacheKey: string,
  fingerprint: string,
  now: number,
): IdempotencyLookupResult {
  const entry = cache.get(cacheKey);
  if (entry === undefined) return { kind: 'miss' };
  if (now - entry.createdAt > IDEMPOTENCY_TTL_MS) {
    cache.delete(cacheKey);
    return { kind: 'miss' };
  }
  if (entry.fingerprint !== fingerprint) {
    return { kind: 'fingerprint_mismatch' };
  }
  return { kind: 'hit', sessionId: entry.sessionId };
}
