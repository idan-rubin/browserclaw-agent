import OpenAI from 'openai';
import { AsyncLocalStorage } from 'node:async_hooks';
import { parseJsonResponse } from './parse-json-response.js';
import { logger } from './logger.js';
import { LlmParseError } from './types.js';
import type { LlmConfig } from './types.js';

const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS ?? '30000', 10);
const LLM_OAUTH_TIMEOUT_MS = parseInt(process.env.LLM_OAUTH_TIMEOUT_MS ?? '90000', 10);

// ── Sanitization ─────────────────────────────────────────────────────────────

/** Redact tokens, keys, and credentials from error text before logging. */
const SENSITIVE_PATTERN =
  /(?:eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|gsk_[A-Za-z0-9]{20,}|xox[bpas]-[A-Za-z0-9-]{20,}|AIza[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|[A-Za-z0-9+/]{40,}={0,2})/g;

export function sanitizeErrorText(text: string): string {
  return text.replace(SENSITIVE_PATTERN, '[REDACTED]').slice(0, 500);
}

// ── Per-session context via AsyncLocalStorage ──────────────────────────────
interface SessionLlmContext {
  llmConfig: LlmConfig;
  llmCallCount: number;
  inputTokens: number;
  outputTokens: number;
  byokClient?: OpenAI;
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
  const ctx = sessionLlmStore.getStore();
  if (ctx) {
    ctx.inputTokens += input;
    ctx.outputTokens += output;
  } else {
    _fallbackInputTokens += input;
    _fallbackOutputTokens += output;
  }
}

export const BYOK_PROVIDERS: Partial<Record<string, { baseURL: string; useMaxCompletionTokens: boolean }>> = {
  anthropic: { baseURL: 'https://api.anthropic.com/v1/', useMaxCompletionTokens: false },
  openai: { baseURL: 'https://api.openai.com/v1', useMaxCompletionTokens: true },
  'openai-oauth': { baseURL: 'https://chatgpt.com/backend-api', useMaxCompletionTokens: true },
  gemini: { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', useMaxCompletionTokens: false },
};

export interface ProviderConfig {
  provider: string;
  label: string;
  baseURL: string;
  apiKeyEnv: string;
  useMaxCompletionTokens: boolean;
}

const PROVIDERS: ProviderConfig[] = [
  {
    provider: 'groq',
    label: 'Groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    useMaxCompletionTokens: false,
  },
  {
    provider: 'gemini',
    label: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKeyEnv: 'GEMINI_API_KEY',
    useMaxCompletionTokens: false,
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    useMaxCompletionTokens: true,
  },
  {
    provider: 'openai-oauth',
    label: 'OpenAI (Subscription)',
    baseURL: 'https://chatgpt.com/backend-api',
    apiKeyEnv: 'OPENAI_OAUTH_TOKEN',
    useMaxCompletionTokens: true,
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    baseURL: 'https://api.anthropic.com/v1/',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    useMaxCompletionTokens: false,
  },
];

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const TOKEN_LIFETIME_HOURS = parseInt(process.env.OPENAI_TOKEN_EXPIRATION_IN_HOURS ?? '0', 10);
const TOKEN_LIFETIME_MS = TOKEN_LIFETIME_HOURS * 60 * 60 * 1000;
const REFRESH_BUFFER_MS = 60 * 60 * 1000; // refresh 1 hour before expiry

let oauthTokenIssuedAt: number | null = null;
const clientCache = new Map<string, OpenAI>();
// Concurrent callers share a single in-flight refresh so we don't race on process.env.
let oauthRefreshInFlight: Promise<void> | null = null;

async function refreshOAuthToken(): Promise<void> {
  if (oauthRefreshInFlight !== null) return oauthRefreshInFlight;
  oauthRefreshInFlight = (async () => {
    const refreshToken = process.env.OPENAI_REFRESH_TOKEN;
    if (refreshToken === undefined || refreshToken === '')
      throw new Error('OPENAI_REFRESH_TOKEN is required to refresh the access token');

    logger.info('Refreshing OpenAI OAuth token');
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OAuth token refresh failed (${String(res.status)}): ${sanitizeErrorText(text)}`);
    }

    const token = (await res.json()) as { access_token: string; refresh_token?: string };
    process.env.OPENAI_OAUTH_TOKEN = token.access_token;
    if (token.refresh_token !== undefined) {
      process.env.OPENAI_REFRESH_TOKEN = token.refresh_token;
    }
    oauthTokenIssuedAt = Date.now();
    clientCache.delete('openai-oauth');
    logger.info('OpenAI OAuth token refreshed successfully');
  })();
  try {
    await oauthRefreshInFlight;
  } finally {
    oauthRefreshInFlight = null;
  }
}

function shouldRefreshOAuthToken(): boolean {
  if (oauthTokenIssuedAt === null || TOKEN_LIFETIME_MS === 0) return false;
  return Date.now() - oauthTokenIssuedAt > TOKEN_LIFETIME_MS - REFRESH_BUFFER_MS;
}

function resolveProvider(name: string): ProviderConfig {
  const found = PROVIDERS.find((p) => p.provider === name);
  if (!found) throw new Error(`Unknown provider: ${name}. Valid: ${PROVIDERS.map((p) => p.provider).join(', ')}`);
  const apiKey = process.env[found.apiKeyEnv];
  if (apiKey === undefined || apiKey === '') throw new Error(`${found.apiKeyEnv} is required for provider "${name}"`);
  return found;
}

function getClient(config: ProviderConfig): OpenAI {
  const cached = clientCache.get(config.provider);
  if (cached) return cached;

  const client = new OpenAI({
    apiKey: process.env[config.apiKeyEnv],
    baseURL: config.baseURL,
  });
  clientCache.set(config.provider, client);
  return client;
}

export function getAvailableProviders(): ProviderConfig[] {
  return PROVIDERS.filter((p) => Boolean(process.env[p.apiKeyEnv]));
}

export function getActiveProvider(): ProviderConfig {
  const name = process.env.LLM_PROVIDER;
  if (name === undefined || name === '')
    throw new Error(`LLM_PROVIDER is required. Valid: ${PROVIDERS.map((p) => p.provider).join(', ')}`);
  return resolveProvider(name);
}

export function getModel(): string {
  const model = process.env.LLM_MODEL;
  if (model === undefined || model === '') {
    logger.fatal('LLM_MODEL is required but not set');
    process.exit(1);
  }
  return model;
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
  apiKeyOverride?: string,
): Promise<LLMResponse> {
  const apiKey = apiKeyOverride ?? process.env[provider.apiKeyEnv] ?? '';
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
  clientOverride?: OpenAI,
): Promise<LLMResponse> {
  const client = clientOverride ?? getClient(provider);
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

async function callLLM(provider: ProviderConfig, model: string, req: LLMRequest): Promise<LLMResponse> {
  if (provider.provider === 'openai-oauth') {
    // Raw fetch — no SDK retries, so we add our own
    return retryTransient(() => callCodexResponsesAPI(provider, model, req), 'Codex API');
  }
  // OpenAI SDK handles its own retries for chat completions
  return callChatCompletions(provider, model, req);
}

// Per-session LLM call counter backed by AsyncLocalStorage.
// Falls back to a module-level counter for calls outside a session context.
let _fallbackLlmCallCount = 0;
let _fallbackInputTokens = 0;
let _fallbackOutputTokens = 0;

export function getLLMCallCount(): number {
  const ctx = sessionLlmStore.getStore();
  return ctx ? ctx.llmCallCount : _fallbackLlmCallCount;
}

export function getTokenUsage(): TokenUsage {
  const ctx = sessionLlmStore.getStore();
  const input = ctx ? ctx.inputTokens : _fallbackInputTokens;
  const output = ctx ? ctx.outputTokens : _fallbackOutputTokens;
  return { input, output, total: input + output };
}

export function resetLLMCallCount(): void {
  const ctx = sessionLlmStore.getStore();
  if (ctx) {
    ctx.llmCallCount = 0;
    ctx.inputTokens = 0;
    ctx.outputTokens = 0;
  } else {
    _fallbackLlmCallCount = 0;
    _fallbackInputTokens = 0;
    _fallbackOutputTokens = 0;
  }
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

function resolveByokProvider(config: LlmConfig): ProviderConfig {
  const byok = BYOK_PROVIDERS[config.provider];
  if (!byok) throw new Error(`Unsupported BYOK provider: ${config.provider}`);
  return {
    provider: config.provider,
    label: config.provider,
    baseURL: byok.baseURL,
    apiKeyEnv: '', // not used for BYOK
    useMaxCompletionTokens: byok.useMaxCompletionTokens,
  };
}

function getByokClient(config: LlmConfig, providerConfig: ProviderConfig): OpenAI {
  return new OpenAI({
    apiKey: config.api_key,
    baseURL: providerConfig.baseURL,
  });
}

export async function llm(req: LLMRequest): Promise<LLMResponse> {
  const ctx = sessionLlmStore.getStore();
  if (ctx) {
    ctx.llmCallCount++;
  } else {
    _fallbackLlmCallCount++;
  }

  if (ctx) {
    const byokConfig = ctx.llmConfig;
    const providerConfig = resolveByokProvider(byokConfig);
    if (byokConfig.provider === 'openai-oauth') {
      return await withTimeout(
        retryTransient(
          () => callCodexResponsesAPI(providerConfig, byokConfig.model, req, byokConfig.api_key),
          'BYOK Codex API',
        ),
        LLM_OAUTH_TIMEOUT_MS,
        'LLM call (BYOK OAuth)',
      );
    }
    // Cache the BYOK client in the session context to avoid creating a new one per call
    ctx.byokClient ??= getByokClient(byokConfig, providerConfig);
    return await withTimeout(
      callChatCompletions(providerConfig, byokConfig.model, req, ctx.byokClient),
      LLM_TIMEOUT_MS,
      'LLM call (BYOK)',
    );
  }

  // Fall back to server-configured provider
  const provider = getActiveProvider();
  const model = getModel();
  const isSubscription = provider.provider === 'openai-oauth';

  if (isSubscription && shouldRefreshOAuthToken()) {
    await refreshOAuthToken();
  }

  try {
    return await withTimeout(callLLM(provider, model, req), LLM_TIMEOUT_MS, 'LLM call');
  } catch (err) {
    if (isSubscription && err instanceof Error && err.message.includes('401')) {
      await refreshOAuthToken();
      return withTimeout(callLLM(provider, model, req), LLM_TIMEOUT_MS, 'LLM call (retry)');
    }
    throw err;
  }
}

export async function llmJson<T>(req: LLMRequest): Promise<T> {
  const { text } = await llm(req);
  try {
    return parseJsonResponse(text) as T;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new LlmParseError(err.message, text);
    }
    throw err;
  }
}

/**
 * Call the LLM with a screenshot image for visual extraction.
 */
export async function llmVision(system: string, message: string, imageBase64: string): Promise<string> {
  const ctx = sessionLlmStore.getStore();
  if (ctx) {
    ctx.llmCallCount++;
  } else {
    _fallbackLlmCallCount++;
  }

  let provider: ProviderConfig;
  let model: string;
  let client: OpenAI;

  if (ctx) {
    provider = resolveByokProvider(ctx.llmConfig);
    model = ctx.llmConfig.model;
    ctx.byokClient ??= getByokClient(ctx.llmConfig, provider);
    client = ctx.byokClient;
  } else {
    provider = getActiveProvider();
    model = getModel();
    client = getClient(provider);
  }

  const response = await retryTransient(
    () =>
      withTimeout(
        client.chat.completions.create({
          model,
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
