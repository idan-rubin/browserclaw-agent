import { getAvailableProviders, getActiveProvider, getModel } from './llm.js';
import { logger } from './logger.js';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    logger.fatal({ envVar: name }, 'Required environment variable not set');
    process.exit(1);
  }
  return value;
}

export function requireEnvInt(name: string): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    logger.fatal({ envVar: name }, 'Required environment variable not set');
    process.exit(1);
  }
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    logger.fatal({ envVar: name, value: raw }, 'Environment variable must be a number');
    process.exit(1);
  }
  return parsed;
}

export interface AgentConfig {
  waitAfterTypeMs: number;
  waitAfterClickMs: number;
  waitAfterOtherMs: number;
  waitActionMs: number;
  scrollPixels: number;
  maxSteps: number;
  llmMaxTokens: number;
}

const AGENT_DEFAULTS: AgentConfig = {
  waitAfterTypeMs: 800,
  waitAfterClickMs: 500,
  waitAfterOtherMs: 300,
  waitActionMs: 2000,
  scrollPixels: 500,
  maxSteps: 50,
  llmMaxTokens: 1024,
};

export function defaultAgentConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  return {
    waitAfterTypeMs: parseInt(process.env.WAIT_AFTER_TYPE_MS ?? String(AGENT_DEFAULTS.waitAfterTypeMs), 10),
    waitAfterClickMs: parseInt(process.env.WAIT_AFTER_CLICK_MS ?? String(AGENT_DEFAULTS.waitAfterClickMs), 10),
    waitAfterOtherMs: parseInt(process.env.WAIT_AFTER_OTHER_MS ?? String(AGENT_DEFAULTS.waitAfterOtherMs), 10),
    waitActionMs: parseInt(process.env.WAIT_ACTION_MS ?? String(AGENT_DEFAULTS.waitActionMs), 10),
    scrollPixels: AGENT_DEFAULTS.scrollPixels,
    maxSteps: parseInt(process.env.MAX_STEPS ?? String(AGENT_DEFAULTS.maxSteps), 10),
    llmMaxTokens: parseInt(process.env.LLM_MAX_TOKENS ?? String(AGENT_DEFAULTS.llmMaxTokens), 10),
    ...overrides,
  };
}

// Agent timing (ms) — read from env with safe defaults; server.ts may override
// via requireEnvInt for strict validation, but the library needs no env vars set.
export const WAIT_AFTER_TYPE_MS = parseInt(process.env.WAIT_AFTER_TYPE_MS ?? '800', 10);
export const WAIT_AFTER_CLICK_MS = parseInt(process.env.WAIT_AFTER_CLICK_MS ?? '500', 10);
export const WAIT_AFTER_OTHER_MS = parseInt(process.env.WAIT_AFTER_OTHER_MS ?? '300', 10);
export const WAIT_ACTION_MS = parseInt(process.env.WAIT_ACTION_MS ?? '2000', 10);
export const SCROLL_PIXELS = 500;
export const USER_RESPONSE_TIMEOUT_MS = parseInt(process.env.USER_RESPONSE_TIMEOUT_MS ?? '300000', 10);
export const MAX_STEPS = parseInt(process.env.MAX_STEPS ?? '50', 10);
export const LLM_MAX_TOKENS = parseInt(process.env.LLM_MAX_TOKENS ?? '1024', 10);

// User-interjection limits (always-on user chat feature).
export const USER_INTERJECTION_ENABLED = process.env.ENABLE_USER_INTERJECTION === 'true';
export const MAX_INTERJECTIONS_PER_RUN = 20;
export const INTERJECTION_MIN_INTERVAL_MS = 2_000;
export const INTERJECTION_MAX_CHARS = 10_000;
export const INTERJECTION_INJECTION_MAX_CHARS = 2_000;

export interface MinioConfig {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  bucket: string;
}

export function getMinioConfig(): MinioConfig {
  return {
    endpoint: requireEnv('MINIO_ENDPOINT'),
    accessKey: requireEnv('MINIO_ACCESS_KEY'),
    secretKey: requireEnv('MINIO_SECRET_KEY'),
    bucket: requireEnv('MINIO_BUCKET'),
  };
}

interface ServerConfig {
  port: number;
  rateLimitMax: number;
  rateLimitWindowMs: number;
  internalToken: string;
}

export function validateConfig(): ServerConfig {
  const available = getAvailableProviders();
  if (available.length === 0) {
    logger.fatal('No AI providers available — set at least one provider API key');
    process.exit(1);
  }
  logger.info({ providers: available.map((p) => p.provider) }, 'Available providers');

  // Validate LLM_PROVIDER + API key at startup so we fail fast
  const active = getActiveProvider();
  logger.info({ provider: active.provider, model: getModel() }, 'Active provider');

  return {
    port: requireEnvInt('PORT'),
    rateLimitMax: requireEnvInt('RATE_LIMIT_MAX'),
    rateLimitWindowMs: requireEnvInt('RATE_LIMIT_WINDOW_MS'),
    internalToken: requireEnv('BROWSER_INTERNAL_TOKEN'),
  };
}
