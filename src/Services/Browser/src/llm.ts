import OpenAI from 'openai';
import { parseJsonResponse } from './parse-json-response.js';
import { logger } from './logger.js';

const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS ?? '30000', 10);

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
    label: 'OpenAI (ChatGPT Subscription)',
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

async function refreshOAuthToken(): Promise<void> {
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
    throw new Error(`OAuth token refresh failed (${String(res.status)}): ${text}`);
  }

  const token = (await res.json()) as { access_token: string; refresh_token?: string };
  process.env.OPENAI_OAUTH_TOKEN = token.access_token;
  if (token.refresh_token !== undefined) {
    process.env.OPENAI_REFRESH_TOKEN = token.refresh_token;
  }
  oauthTokenIssuedAt = Date.now();
  clientCache.delete('openai-oauth');
  logger.info('OpenAI OAuth token refreshed successfully');
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

async function callCodexResponsesAPI(provider: ProviderConfig, model: string, req: LLMRequest): Promise<LLMResponse> {
  const apiKey = process.env[provider.apiKeyEnv] ?? '';
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
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`${String(res.status)} ${errText}`);
  }

  const body = await res.text();
  const lines = body.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(line.slice(6)) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (data.type === 'response.completed') {
        const resp = data.response as Record<string, unknown> | undefined;
        const output = (resp?.output as Record<string, unknown>[] | undefined)?.[0];
        const content = (output?.content as Record<string, unknown>[] | undefined)?.[0];
        const responseText = content?.text as string | undefined;
        if (responseText !== undefined && responseText !== '') return { text: responseText };
      }
    }
  }

  throw new Error('Codex Responses API returned no completed response');
}

async function callChatCompletions(provider: ProviderConfig, model: string, req: LLMRequest): Promise<LLMResponse> {
  const response = await getClient(provider).chat.completions.create({
    model,
    ...(provider.useMaxCompletionTokens ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }),
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.message },
    ],
  });

  const content = response.choices[0]?.message.content ?? null;
  if (content === null) throw new Error('LLM returned empty response');
  return { text: content };
}

async function callLLM(provider: ProviderConfig, model: string, req: LLMRequest): Promise<LLMResponse> {
  if (provider.provider === 'openai-oauth') {
    return callCodexResponsesAPI(provider, model, req);
  }
  return callChatCompletions(provider, model, req);
}

// NOTE: this counter is shared across concurrent sessions — counts are approximate under concurrency
let _llmCallCount = 0;

export function getLLMCallCount(): number {
  return _llmCallCount;
}

export function resetLLMCallCount(): void {
  _llmCallCount = 0;
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

export async function llm(req: LLMRequest): Promise<LLMResponse> {
  _llmCallCount++;
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
  return parseJsonResponse(text) as T;
}
