/**
 * Shared API contract between the Browser backend service and the Next.js
 * Frontend. The Frontend keeps a mirror at
 * `src/Frontend/src/lib/api-types.ts` whose declarations match this file
 * verbatim (kept in sync manually — separate tsconfigs prevent a single
 * canonical import without restructuring the build).
 *
 * Whenever you touch this file, update the mirror in the same commit.
 */

import type { LlmConfig } from './types.js';

/** Marker version for SSE events and API payload shapes. Bump on breaking changes. */
export const API_VERSION = 1;
export type ApiVersion = typeof API_VERSION;

// ────────────────────────────────────────────────────────────────────────
// Sessions
// ────────────────────────────────────────────────────────────────────────

export interface CreateSessionRequest {
  prompt: string;
  url?: string;
  headless?: boolean;
  skip_moderation?: boolean;
  skip_postprocessing?: boolean;
  llm_config?: LlmConfig;
}

export interface CreateSessionResponse {
  session_id: string;
  status: string;
  created_at: string;
}

// ────────────────────────────────────────────────────────────────────────
// Runs
// ────────────────────────────────────────────────────────────────────────

export interface RunRequest {
  prompt: string;
  url?: string;
  headless?: boolean;
  llm_config?: LlmConfig;
}

export interface RunResponse {
  session_id: string;
  status: string;
  created_at: string;
}

// ────────────────────────────────────────────────────────────────────────
// SSE event union
//
// Every event carries `apiVersion: 1` so a future v2 stream can be detected
// by clients without renaming the type tags. Add new event types as a new
// member of the union — never reuse a `type` value with a different shape.
// ────────────────────────────────────────────────────────────────────────

interface BaseSSEEvent {
  apiVersion: ApiVersion;
}

export type SSEEvent =
  | (BaseSSEEvent & { type: 'connected'; session_id: string })
  | (BaseSSEEvent & { type: 'step'; step: number; action?: unknown; url?: string; title?: string })
  | (BaseSSEEvent & { type: 'thinking'; step: number; message: string })
  | (BaseSSEEvent & { type: 'completed'; answer?: string; duration_ms?: number })
  | (BaseSSEEvent & { type: 'failed'; step?: number; error: string })
  | (BaseSSEEvent & {
      type: 'step_error';
      step: number;
      action?: string;
      error: string;
      // Optional inner classifier (e.g. 'parse_error' | 'api_error'). The SSE
      // channel type stays 'step_error'; this discriminates the cause.
      error_kind?: string;
    })
  | (BaseSSEEvent & {
      type: 'context_compressed';
      step: number;
      droppedSteps: number;
      summary: string;
      summary_length: number;
    })
  | (BaseSSEEvent & { type: 'context_compress_failed'; step: number; error: string })
  | (BaseSSEEvent & { type: 'domain_blocked'; domain: string; reason: string; attempt: number })
  | (BaseSSEEvent & { type: 'skill_skipped'; domain: string; reason: string })
  | (BaseSSEEvent & { type: 'user_interjection_timeout'; step: number; question: string })
  | (BaseSSEEvent & { type: 'ask_user'; step: number; question: string })
  | (BaseSSEEvent & { type: 'user_response'; step: number; text: string });

export type SSEEventType = SSEEvent['type'];
