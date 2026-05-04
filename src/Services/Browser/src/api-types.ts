// Mirror lives at src/Frontend/src/lib/api-types.ts — keep in sync manually.

import type { LlmConfig } from './types.js';

export const API_VERSION = 1;
export type ApiVersion = typeof API_VERSION;

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
