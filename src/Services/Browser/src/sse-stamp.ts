import { API_VERSION } from './api-types.js';

// Spread payload first so the canonical `type` and `apiVersion` always win.
export function stampSSEPayload(event: string, data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === 'object') {
    return { ...(data as Record<string, unknown>), apiVersion: API_VERSION, type: event };
  }
  return { value: data, apiVersion: API_VERSION, type: event };
}
