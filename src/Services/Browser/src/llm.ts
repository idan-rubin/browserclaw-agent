import OpenAI from 'openai';
import { AsyncLocalStorage } from 'node:async_hooks';
import { parseJsonResponse } from './parse-json-response.js';
import { logger } from './logger.js';
import { LlmParseError } from './types.js';
import type { LlmConfig } from './types.js';

const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS ?? '30000', 10);
const LLM_CODEX_TIMEOUT_MS = parseInt(process.env.LLM_OAUTH_TIMEOUT_MS ?? '90000', 10);

// ── Sanitization ─────────────────────────────────────────────────────────────

/** Redact tokens, keys, and credentials from error text before logging. */
const SENSITIVE_PATTERN =
  /(?:eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|xox[bpas]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|[A-Za-z0-9+/]{40,}={0,2})/g;

export function sanitizeErrorText(text: string): string {
  return text.replace(SENSITIVE_PATTERN, '[REDACTED]').slice(0, 500);
}

export function extractProviderMessage(err: unknown): string | null {
  if (!(err instanceof Error)) return null;
  const bodyStart = err.message.indexOf('{');
  if (bodyStart === -1) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(err.message.slice(bodyStart));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const candidates: unknown[] = [
    (obj.error as { message?: unknown } | undefined)?.message,
    typeof obj.error === 'string' ? obj.error : undefined,
    obj.message,
    obj.detail,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim() !== '') return c;
  }
  return null;
}

export function isFailFastError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const m = err.message;
  if (/insufficient_quota/i.test(m)) return true;
  if (/^(401|403)\s/.test(m)) return true;
  return /token_expired|invalid_api_key|invalid_grant|invalid_client|unauthorized/i.test(m);
}

// ── Per-session context via AsyncLocalStorage ──────────────────────────────
interface SessionLlmContext {
  llmConfig: LlmConfig;
  llmCallCount: number;
  inputTokens: number;
  outputTokens: number;
  byokClient?: OpenAI;
}

function requireCtx(): SessionLlmContext {
  const ctx = sessionLlmStore.getStore();
  if (ctx === undefined) {
    throw new Error('LLM call outside of runWithLlmConfig — BYOK config is required');
  }
  return ctx;
}

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

const sessionLlmStore = new AsyncLocalStorage<SessionLlmContext>();

/**
 * Run an async function with a BYOK LLM config scoped to the current async context.
 * All llm() / llmJson() calls inside `fn` will use the provided config
 * instead of the server's environment variables.
 */
export function runWithLlmConfig<T>(config: LlmConfig, fn: () => Promise<T>): Promise<T> {
  return sessionLlmStore.run({ llmConfig: config, llmCallCount: 0, inputTokens: 0, outputTokens: 0 }, fn);
}

function recordUsage(input: number, output: number): void {
  const ctx = requireCtx();
  ctx.inputTokens += input;
  ctx.outputTokens += output;
}

export const BYOK_PROVIDERS: Partial<Record<string, { baseURL: string; useMaxCompletionTokens: boolean }>> = {
  anthropic: { baseURL: 'https://api.anthropic.com/v1/', useMaxCompletionTokens: false },
  openai: { baseURL: 'https://api.openai.com/v1', useMaxCompletionTokens: true },
  'openai-oauth': { baseURL: 'https://chatgpt.com/backend-api', useMaxCompletionTokens: true },
  gemini: { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', useMaxCompletionTokens: false },
};

interface ProviderConfig {
  provider: string;
  baseURL: string;
  useMaxCompletionTokens: boolean;
}

export interface LLMRequest {
  system: string;
  message: string;
  maxTokens: number;
}

interface LLMResponse {
  text: string;
}

async function callCodexResponsesAPI(
  provider: ProviderConfig,
  model: string,
  req: LLMRequest,
  apiKey: string,
): Promise<LLMResponse> {
  const url = `${provider.baseURL}/codex/responses`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      originator: 'openclaw',
      'User-Agent': 'openclaw/1.0',
    },
    body: JSON.stringify({
      model,
      instructions: req.system,
      input: [{ role: 'user', content: req.message }],
      store: false,
      stream: true,
      reasoning: { effort: 'low' },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${String(res.status)} ${sanitizeErrorText(errText)}`);
  }

  const body = await res.text();
  const lines = body.split('\n');
  const textParts: string[] = [];
  let sawCompleted = false;
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(line.slice(6)) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (data.type === 'response.output_text.done') {
      const text = data.text as string | undefined;
      if (text !== undefined && text !== '') textParts.push(text);
    } else if (data.type === 'response.completed') {
      sawCompleted = true;
      const resp = data.response as Record<string, unknown> | undefined;
      const usage = resp?.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      if (usage) recordUsage(usage.input_tokens ?? 0, usage.output_tokens ?? 0);
      const output = (resp?.output as Record<string, unknown>[] | undefined)?.[0];
      const content = (output?.content as Record<string, unknown>[] | undefined)?.[0];
      const legacyText = content?.text as string | undefined;
      if (legacyText !== undefined && legacyText !== '') textParts.push(legacyText);
    }
  }
  if (sawCompleted && textParts.length > 0) return { text: textParts.join('') };

  throw new Error('Codex Responses API returned no completed response');
}

async function callChatCompletions(
  provider: ProviderConfig,
  model: string,
  req: LLMRequest,
  client: OpenAI,
): Promise<LLMResponse> {
  const response = await client.chat.completions.create({
    model,
    ...(provider.useMaxCompletionTokens ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }),
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.message },
    ],
  });

  if (response.usage) {
    recordUsage(response.usage.prompt_tokens, response.usage.completion_tokens);
  }
  const content = response.choices[0]?.message.content ?? null;
  if (content === null) throw new Error('LLM returned empty response');
  return { text: content };
}

export function getLLMCallCount(): number {
  return requireCtx().llmCallCount;
}

export function getTokenUsage(): TokenUsage {
  const ctx = requireCtx();
  return { input: ctx.inputTokens, output: ctx.outputTokens, total: ctx.inputTokens + ctx.outputTokens };
}

export function resetLLMCallCount(): void {
  const ctx = requireCtx();
  ctx.llmCallCount = 0;
  ctx.inputTokens = 0;
  ctx.outputTokens = 0;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ── Transient error retry (for raw-fetch paths without SDK retries) ──────────

const LLM_MAX_RETRIES = 2;
const LLM_RETRY_BASE_MS = 1000;

function isTransientError(err: unknown): boolean {
  if (err instanceof OpenAI.APIError) {
    const status = err.status as number | undefined;
    return status === 429 || status === 408 || status === 409 || (status !== undefined && status >= 500);
  }
  if (err instanceof OpenAI.APIConnectionError) return true;

  // Raw fetch errors (callCodexResponsesAPI)
  if (err instanceof TypeError && (err.message.includes('fetch') || err.message.includes('network'))) return true;

  // Our own timeout wrapper or HTTP status codes from callCodexResponsesAPI ("429 ...")
  if (err instanceof Error) {
    if (err.message.includes('timed out after')) return true;
    const match = /^(\d{3})\s/.exec(err.message);
    if (match) {
      const status = parseInt(match[1], 10);
      return status === 429 || status === 408 || status >= 500;
    }
  }

  return false;
}

async function retryTransient<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < LLM_MAX_RETRIES && isTransientError(err)) {
        const delayMs = LLM_RETRY_BASE_MS * 2 ** attempt;
        logger.warn(
          {
            attempt: attempt + 1,
            maxRetries: LLM_MAX_RETRIES,
            delayMs,
            error: err instanceof Error ? sanitizeErrorText(err.message) : 'unknown',
          },
          `${label}: transient error, retrying`,
        );
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function resolveProvider(config: LlmConfig): ProviderConfig {
  const byok = BYOK_PROVIDERS[config.provider];
  if (!byok) throw new Error(`Unsupported provider: ${config.provider}`);
  return {
    provider: config.provider,
    baseURL: byok.baseURL,
    useMaxCompletionTokens: byok.useMaxCompletionTokens,
  };
}

function getClient(ctx: SessionLlmContext, provider: ProviderConfig): OpenAI {
  ctx.byokClient ??= new OpenAI({ apiKey: ctx.llmConfig.api_key, baseURL: provider.baseURL });
  return ctx.byokClient;
}

export async function llm(req: LLMRequest): Promise<LLMResponse> {
  const ctx = requireCtx();
  ctx.llmCallCount++;

  const config = ctx.llmConfig;
  const provider = resolveProvider(config);

  if (config.provider === 'openai-oauth') {
    return await withTimeout(
      retryTransient(() => callCodexResponsesAPI(provider, config.model, req, config.api_key), 'BYOK Codex API'),
      LLM_CODEX_TIMEOUT_MS,
      'LLM call (BYOK OAuth)',
    );
  }

  return await withTimeout(
    callChatCompletions(provider, config.model, req, getClient(ctx, provider)),
    LLM_TIMEOUT_MS,
    'LLM call (BYOK)',
  );
}

export async function llmJson<T>(req: LLMRequest): Promise<T> {
  const { text } = await llm(req);
  try {
    return parseJsonResponse(text) as T;
  } catch (err) {
    if (err instanceof SyntaxError) {
      // The raw response is critical for diagnosing malformed LLM output.
      // LlmParseError stores the first 500 chars on the error itself, and we
      // also log it here so the diagnostic appears even if the caller only
      // serializes the error message.
      logger.warn(
        {
          parseError: err.message,
          rawSnippet: text.length > 500 ? `${text.slice(0, 500)}…[truncated ${String(text.length - 500)} chars]` : text,
          rawLength: text.length,
        },
        'LLM JSON parse failed',
      );
      throw new LlmParseError(err.message, text);
    }
    throw err;
  }
}

/**
 * Call the LLM with a screenshot image for visual extraction.
 */
export async function llmVision(system: string, message: string, imageBase64: string): Promise<string> {
  const ctx = requireCtx();
  ctx.llmCallCount++;

  const config = ctx.llmConfig;
  const provider = resolveProvider(config);
  const client = getClient(ctx, provider);

  const response = await retryTransient(
    () =>
      withTimeout(
        client.chat.completions.create({
          model: config.model,
          max_tokens: 2048,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
                { type: 'text', text: message },
              ],
            },
          ],
        }),
        LLM_TIMEOUT_MS,
        'LLM vision call',
      ),
    'LLM vision call',
  );

  if (response.usage) {
    recordUsage(response.usage.prompt_tokens, response.usage.completion_tokens);
  }
  return response.choices[0]?.message.content ?? '';
}
