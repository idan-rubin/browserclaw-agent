import { API_VERSION } from './api-types.js';

/**
 * Stamp a payload with the canonical `type` (SSE channel name) and `apiVersion`.
 *
 * IMPORTANT: payload is spread FIRST so the channel `type` and `apiVersion`
 * always win. step_error and similar events carry their own `type` field for
 * inner classification (renamed to `error_kind` in api-types.ts) but
 * historically the order was `{ type: event, ...data }`, which let the
 * payload's `type` clobber the SSEEvent contract. Pulled out of
 * session-manager.ts so it's unit-testable without booting the whole
 * config/env layer (which calls process.exit on missing vars at module load).
 */
export function stampSSEPayload(event: string, data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === 'object') {
    return { ...(data as Record<string, unknown>), apiVersion: API_VERSION, type: event };
  }
  return { value: data, apiVersion: API_VERSION, type: event };
}
