import OpenAI from 'openai';
import { parseJsonResponse } from './parse-json-response.js';
import { logger } from './logger.js';

export interface ProviderConfig {
  provider: string;
  label: string;
  defaultModel: string;
  baseURL: string;
  apiKeyEnv: string;
  useMaxCompletionTokens: boolean;
}

const DEFAULT_MODELS: Record<string, string> = {
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  'openai-oauth': 'gpt-4o',
  anthropic: 'claude-sonnet-4-6',
};

function providerModel(provider: string): string {
  const envKey = `${provider.toUpperCase().replace(/-/g, '_')}_MODEL`;
  return process.env[envKey] || DEFAULT_MODELS[provider] || 'unknown';
}

const PROVIDERS: ProviderConfig[] = [
  {
    provider: 'groq',
    label: 'Groq',
    defaultModel: providerModel('groq'),
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    useMaxCompletionTokens: false,
  },
  {
    provider: 'gemini',
    label: 'Gemini',
    defaultModel: providerModel('gemini'),
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKeyEnv: 'GEMINI_API_KEY',
    useMaxCompletionTokens: false,
  },
  {
    provider: 'openai',
    label: 'OpenAI',
    defaultModel: providerModel('openai'),
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    useMaxCompletionTokens: true,
  },
  {
    provider: 'openai-oauth',
    label: 'OpenAI (ChatGPT Subscription)',
    defaultModel: providerModel('openai-oauth'),
    baseURL: 'https://chatgpt.com/backend-api',
    apiKeyEnv: 'OPENAI_OAUTH_TOKEN',
    useMaxCompletionTokens: true,
  },
  {
    provider: 'anthropic',
    label: 'Anthropic',
    defaultModel: providerModel('anthropic'),
    baseURL: 'https://api.anthropic.com/v1/',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    useMaxCompletionTokens: false,
  },
];

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const TOKEN_LIFETIME_HOURS = parseInt(process.env.OPENAI_TOKEN_EXPIRATION_IN_HOURS || '0', 10);
const TOKEN_LIFETIME_MS = TOKEN_LIFETIME_HOURS * 60 * 60 * 1000;
const REFRESH_BUFFER_MS = 60 * 60 * 1000; // refresh 1 hour before expiry

let oauthTokenIssuedAt: number | null = null;
const clientCache = new Map<string, OpenAI>();

async function refreshOAuthToken(): Promise<void> {
  const refreshToken = process.env.OPENAI_REFRESH_TOKEN;
  if (!refreshToken) throw new Error('OPENAI_REFRESH_TOKEN is required to refresh the access token');

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
    throw new Error(`OAuth token refresh failed (${res.status}): ${text}`);
  }

  const token = await res.json() as { access_token: string; refresh_token?: string };
  process.env.OPENAI_OAUTH_TOKEN = token.access_token;
  if (token.refresh_token) {
    process.env.OPENAI_REFRESH_TOKEN = token.refresh_token;
  }
  oauthTokenIssuedAt = Date.now();
  clientCache.delete('openai-oauth');
  logger.info('OpenAI OAuth token refreshed successfully');
}

function shouldRefreshOAuthToken(): boolean {
  if (!oauthTokenIssuedAt || TOKEN_LIFETIME_MS === 0) return false;
  return Date.now() - oauthTokenIssuedAt > TOKEN_LIFETIME_MS - REFRESH_BUFFER_MS;
}

function resolveProvider(name: string): ProviderConfig {
  const found = PROVIDERS.find(p => p.provider === name);
  if (!found) throw new Error(`Unknown provider: ${name}. Valid: ${PROVIDERS.map(p => p.provider).join(', ')}`);
  const apiKey = process.env[found.apiKeyEnv];
  if (!apiKey) throw new Error(`${found.apiKeyEnv} is required for provider "${name}"`);
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
  return PROVIDERS.filter(p => Boolean(process.env[p.apiKeyEnv]));
}

export function getActiveProvider(): ProviderConfig {
  const name = process.env.LLM_PROVIDER;
  if (!name) throw new Error(`LLM_PROVIDER is required. Valid: ${PROVIDERS.map(p => p.provider).join(', ')}`);
  return resolveProvider(name);
}

export function getModel(): string {
  return process.env.LLM_MODEL || getActiveProvider().defaultModel;
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
  const apiKey = process.env[provider.apiKeyEnv];
  const url = `${provider.baseURL}/codex/responses`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'originator': 'openclaw',
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
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }

  const body = await res.text();
  const lines = body.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      if (data.type === 'response.completed') {
        const text = data.response?.output?.[0]?.content?.[0]?.text;
        if (text) return { text };
      }
    }
  }

  throw new Error('Codex Responses API returned no completed response');
}

async function callChatCompletions(provider: ProviderConfig, model: string, req: LLMRequest): Promise<LLMResponse> {
  const response = await getClient(provider).chat.completions.create({
    model,
    ...(provider.useMaxCompletionTokens
      ? { max_completion_tokens: req.maxTokens }
      : { max_tokens: req.maxTokens }),
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.message },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('LLM returned empty response');
  return { text: content };
}

async function callLLM(provider: ProviderConfig, model: string, req: LLMRequest): Promise<LLMResponse> {
  if (provider.provider === 'openai-oauth') {
    return callCodexResponsesAPI(provider, model, req);
  }
  return callChatCompletions(provider, model, req);
}

let _llmCallCount = 0;

export function getLLMCallCount(): number {
  return _llmCallCount;
}

export function resetLLMCallCount(): void {
  _llmCallCount = 0;
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
    return await callLLM(provider, model, req);
  } catch (err) {
    if (isSubscription && err instanceof Error && err.message.includes('401')) {
      await refreshOAuthToken();
      return callLLM(provider, model, req);
    }
    throw err;
  }
}

export async function llmJson<T>(req: LLMRequest): Promise<T> {
  const { text } = await llm(req);
  return parseJsonResponse<T>(text);
}
