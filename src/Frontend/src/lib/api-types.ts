/**
 * Mirror of `src/Services/Browser/src/api-types.ts`.
 *
 * The two files are kept in sync manually — separate tsconfigs and module
 * resolution settings (rootDir on the backend, bundler resolution on the
 * frontend) prevent a single canonical import without restructuring the
 * build. When you touch one file, update the other in the same commit.
 *
 * Treat this file as the contract the Frontend code can rely on — the
 * `typecheck` script on each side validates each half independently, and
 * any drift will surface here as a type error in callers.
 */

export const API_VERSION = 1;
export type ApiVersion = typeof API_VERSION;

export interface LlmConfig {
  provider: string;
  model: string;
  api_key: string;
}

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

interface BaseSSEEvent {
  apiVersion: ApiVersion;
}

export type SSEEvent =
  | (BaseSSEEvent & { type: 'connected'; session_id: string })
  | (BaseSSEEvent & { type: 'step'; step: number; action?: unknown; url?: string; title?: string })
  | (BaseSSEEvent & { type: 'thinking'; step: number; message: string })
  | (BaseSSEEvent & { type: 'completed'; answer?: string; duration_ms?: number })
  | (BaseSSEEvent & { type: 'failed'; step?: number; error: string })
  | (BaseSSEEvent & { type: 'step_error'; step: number; action?: string; error: string })
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

export interface ApiErrorBody {
  error?: string;
  code?: string;
  message?: string;
}
