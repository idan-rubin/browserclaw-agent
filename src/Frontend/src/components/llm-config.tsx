'use client';

import { useEffect, useCallback, useState, useMemo } from 'react';

export interface LlmConfig {
  provider: 'anthropic' | 'openai' | 'openai-oauth' | 'gemini';
  model: string;
  api_key: string;
}

export const PROVIDERS = [
  { value: 'anthropic' as const, label: 'Anthropic' },
  { value: 'openai' as const, label: 'OpenAI' },
  { value: 'openai-oauth' as const, label: 'OpenAI (Codex)' },
  { value: 'gemini' as const, label: 'Google Gemini' },
];

const MODELS: Record<string, { value: string; label: string }[]> = {
  anthropic: [
    { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { value: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  ],
  openai: [
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  ],
  'openai-oauth': [
    { value: 'gpt-5.4', label: 'GPT-5.4' },
    { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
  ],
  gemini: [
    { value: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  ],
};

const DEFAULT_PROVIDER: LlmConfig['provider'] = 'anthropic';
const STORAGE_KEY = 'browserclaw_llm_config';
const OPENAI_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const OPENAI_TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REFRESH_AT_LIFETIME_FRACTION = 0.8;

interface StoredConfig {
  provider: LlmConfig['provider'];
  model: string;
  api_key: string;
  refresh_token: string;
}

function emptyConfig(): StoredConfig {
  return { provider: DEFAULT_PROVIDER, model: MODELS[DEFAULT_PROVIDER][0].value, api_key: '', refresh_token: '' };
}

function loadStoredConfig(): StoredConfig {
  if (typeof window === 'undefined') return emptyConfig();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return emptyConfig();
    const parsed = JSON.parse(raw) as Partial<StoredConfig>;
    const provider = parsed.provider ?? DEFAULT_PROVIDER;
    const models = MODELS[provider] ?? [];
    const model =
      parsed.model !== undefined && parsed.model !== '' && models.some((m) => m.value === parsed.model)
        ? parsed.model
        : (models[0]?.value ?? '');
    return { provider, model, api_key: parsed.api_key ?? '', refresh_token: parsed.refresh_token ?? '' };
  } catch {
    return emptyConfig();
  }
}

function saveStoredConfig(c: StoredConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

function parseJwtTimes(jwt: string): { iat: number; exp: number } | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payloadJson = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson) as { iat?: number; exp?: number };
    if (typeof payload.iat === 'number' && typeof payload.exp === 'number') {
      return { iat: payload.iat * 1000, exp: payload.exp * 1000 };
    }
    return null;
  } catch {
    return null;
  }
}

function shouldRefresh(accessToken: string): boolean {
  const times = parseJwtTimes(accessToken);
  if (times === null) return false;
  const lifetime = times.exp - times.iat;
  if (lifetime <= 0) return false;
  return Date.now() - times.iat > lifetime * REFRESH_AT_LIFETIME_FRACTION;
}

const refreshInFlight = new Map<string, Promise<{ access_token: string; refresh_token: string }>>();

async function refreshOpenAIOAuthTokens(
  refreshToken: string,
): Promise<{ access_token: string; refresh_token: string }> {
  const existing = refreshInFlight.get(refreshToken);
  if (existing !== undefined) return existing;

  const promise = (async () => {
    const res = await fetch(OPENAI_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: OPENAI_OAUTH_CLIENT_ID,
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OAuth token refresh failed (${String(res.status)}): ${text.slice(0, 200)}`);
    }
    const tokens = (await res.json()) as { access_token: string; refresh_token?: string };
    return { access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? refreshToken };
  })();

  refreshInFlight.set(refreshToken, promise);
  try {
    return await promise;
  } finally {
    refreshInFlight.delete(refreshToken);
  }
}

export function useLlmConfig() {
  const initial = loadStoredConfig();
  const [provider, setProvider] = useState<LlmConfig['provider']>(initial.provider);
  const [model, setModel] = useState(initial.model);
  const [apiKey, setApiKey] = useState(initial.api_key);
  const [refreshToken, setRefreshToken] = useState(initial.refresh_token);

  // Resolve model when provider changes
  const resolvedModel = useMemo(() => {
    const models = MODELS[provider] ?? [];
    if (models.some((m) => m.value === model)) return model;
    return models[0]?.value ?? '';
  }, [provider, model]);

  useEffect(() => {
    saveStoredConfig({ provider, model: resolvedModel, api_key: apiKey, refresh_token: refreshToken });
  }, [provider, resolvedModel, apiKey, refreshToken]);

  const handleSetProvider = useCallback((p: LlmConfig['provider']) => {
    setProvider(p);
    const models = MODELS[p] ?? [];
    setModel(models[0]?.value ?? '');
  }, []);

  const getConfig = useCallback(async (): Promise<LlmConfig | undefined> => {
    const trimmedKey = apiKey.trim();
    if (trimmedKey === '') return undefined;
    let accessToken = trimmedKey;
    if (provider === 'openai-oauth' && refreshToken.trim() !== '' && shouldRefresh(accessToken)) {
      const fresh = await refreshOpenAIOAuthTokens(refreshToken.trim());
      accessToken = fresh.access_token;
      setApiKey(fresh.access_token);
      setRefreshToken(fresh.refresh_token);
    }
    return { provider, model: resolvedModel, api_key: accessToken };
  }, [provider, resolvedModel, apiKey, refreshToken]);

  return {
    provider,
    setProvider: handleSetProvider,
    model: resolvedModel,
    setModel,
    apiKey,
    setApiKey,
    refreshToken,
    setRefreshToken,
    getConfig,
  };
}

const FIELD_CLASS =
  'appearance-none rounded-lg border border-border bg-background px-3 py-2 text-sm leading-5 text-foreground transition-colors focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20';

export function LlmConfigPanel({
  provider,
  setProvider,
  model,
  setModel,
  apiKey,
  setApiKey,
  refreshToken,
  setRefreshToken,
  allowedProviders,
}: {
  provider: LlmConfig['provider'];
  setProvider: (p: LlmConfig['provider']) => void;
  model: string;
  setModel: (m: string) => void;
  apiKey: string;
  setApiKey: (k: string) => void;
  refreshToken: string;
  setRefreshToken: (t: string) => void;
  /**
   * Optional filter for the provider dropdown. Pages that integrate with
   * backends that don't support every provider can narrow the list.
   */
  allowedProviders?: readonly LlmConfig['provider'][];
}) {
  const [open, setOpen] = useState(apiKey === '');
  const models = MODELS[provider] ?? [];
  const shownProviders =
    allowedProviders !== undefined ? PROVIDERS.filter((p) => allowedProviders.includes(p.value)) : PROVIDERS;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => {
          setOpen(!open);
        }}
        className="flex items-center gap-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-muted-foreground"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="truncate">
          {apiKey !== ''
            ? `${PROVIDERS.find((p) => p.value === provider)?.label ?? provider} — ${models.find((m) => m.value === model)?.label ?? model}`
            : 'Bring your own API key'}
        </span>
      </button>

      {open && (
        <div
          className={`mt-3 space-y-3 rounded-xl border bg-card/40 p-4 backdrop-blur-sm animate-in fade-in slide-in-from-top-1 duration-200 ${apiKey !== '' ? 'border-border/60' : 'border-amber-500/40'}`}
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Stored only in your browser. Refreshed against the provider directly — never on our servers.
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as LlmConfig['provider']);
              }}
              aria-label="LLM Provider"
              className={`${FIELD_CLASS} sm:w-40`}
            >
              {shownProviders.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>

            <select
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
              }}
              aria-label="Model"
              className={`${FIELD_CLASS} sm:w-48`}
            >
              {models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>

            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
              }}
              placeholder={provider === 'openai-oauth' ? 'OAuth token' : 'API key'}
              aria-label={provider === 'openai-oauth' ? 'OAuth Token' : 'API Key'}
              autoComplete="off"
              className={`${FIELD_CLASS} flex-1 placeholder:text-muted-foreground/40`}
            />
          </div>

          {provider === 'openai-oauth' && (
            <input
              type="password"
              value={refreshToken}
              onChange={(e) => {
                setRefreshToken(e.target.value);
              }}
              placeholder="Refresh token (optional — auto-refreshes expired OAuth tokens)"
              aria-label="OAuth Refresh Token"
              autoComplete="off"
              className={`${FIELD_CLASS} w-full placeholder:text-muted-foreground/40`}
            />
          )}

          <p className="text-[11px] leading-relaxed text-muted-foreground/50">
            Saved in your browser&apos;s local storage. Only the current access token is sent to our server per request,
            never the refresh token. We hold no credentials.
          </p>
        </div>
      )}
    </div>
  );
}
