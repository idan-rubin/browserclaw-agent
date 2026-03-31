'use client';

import { useEffect, useCallback, useState, useMemo } from 'react';

export interface LlmConfig {
  provider: 'anthropic' | 'openai' | 'openai-oauth' | 'gemini';
  model: string;
  api_key: string;
}

const PROVIDERS = [
  { value: 'anthropic' as const, label: 'Anthropic' },
  { value: 'openai' as const, label: 'OpenAI' },
  { value: 'openai-oauth' as const, label: 'OpenAI (Subscription)' },
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

function loadConfig(): { provider: LlmConfig['provider']; model: string; apiKey: string } {
  if (typeof window === 'undefined')
    return { provider: DEFAULT_PROVIDER, model: MODELS[DEFAULT_PROVIDER][0].value, apiKey: '' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return { provider: DEFAULT_PROVIDER, model: MODELS[DEFAULT_PROVIDER][0].value, apiKey: '' };
    const parsed = JSON.parse(raw) as Partial<LlmConfig & { api_key: string }>;
    const provider = parsed.provider ?? DEFAULT_PROVIDER;
    const models = MODELS[provider] ?? [];
    const model =
      parsed.model !== undefined && parsed.model !== '' && models.some((m) => m.value === parsed.model)
        ? parsed.model
        : (models[0]?.value ?? '');
    const apiKey = parsed.api_key ?? '';
    return { provider, model, apiKey };
  } catch {
    return { provider: DEFAULT_PROVIDER, model: MODELS[DEFAULT_PROVIDER][0].value, apiKey: '' };
  }
}

function saveConfig(provider: LlmConfig['provider'], model: string, apiKey: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider, model, api_key: apiKey }));
}

export function useLlmConfig() {
  const [provider, setProvider] = useState<LlmConfig['provider']>(() => loadConfig().provider);
  const [model, setModel] = useState(() => loadConfig().model);
  const [apiKey, setApiKey] = useState(() => loadConfig().apiKey);

  // Resolve model when provider changes
  const resolvedModel = useMemo(() => {
    const models = MODELS[provider] ?? [];
    if (models.some((m) => m.value === model)) return model;
    return models[0]?.value ?? '';
  }, [provider, model]);

  useEffect(() => {
    saveConfig(provider, resolvedModel, apiKey);
  }, [provider, resolvedModel, apiKey]);

  const handleSetProvider = useCallback((p: LlmConfig['provider']) => {
    setProvider(p);
    const models = MODELS[p] ?? [];
    setModel(models[0]?.value ?? '');
  }, []);

  const getConfig = useCallback((): LlmConfig | undefined => {
    if (apiKey.trim() === '') return undefined;
    return { provider, model: resolvedModel, api_key: apiKey.trim() };
  }, [provider, resolvedModel, apiKey]);

  return { provider, setProvider: handleSetProvider, model: resolvedModel, setModel, apiKey, setApiKey, getConfig };
}

const SELECT_CLASS =
  'h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground transition-colors focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20';

export function LlmConfigPanel({
  provider,
  setProvider,
  model,
  setModel,
  apiKey,
  setApiKey,
}: {
  provider: LlmConfig['provider'];
  setProvider: (p: LlmConfig['provider']) => void;
  model: string;
  setModel: (m: string) => void;
  apiKey: string;
  setApiKey: (k: string) => void;
}) {
  const [open, setOpen] = useState(apiKey === '');
  const models = MODELS[provider] ?? [];

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
            Your key is never stored on our servers
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value as LlmConfig['provider']);
              }}
              aria-label="LLM Provider"
              className={`${SELECT_CLASS} sm:w-40`}
            >
              {PROVIDERS.map((p) => (
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
              className={`${SELECT_CLASS} sm:w-48`}
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
              className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/40 transition-colors focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground/50">
            Your key is saved in your browser&apos;s local storage and never sent to our servers except to make LLM
            calls during your run.
          </p>
        </div>
      )}
    </div>
  );
}
