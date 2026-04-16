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

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

// Agent timing (ms) — env vars override defaults; safe to import without env
export const WAIT_AFTER_TYPE_MS = envInt('WAIT_AFTER_TYPE_MS', 1500);
export const WAIT_AFTER_CLICK_MS = envInt('WAIT_AFTER_CLICK_MS', 1500);
export const WAIT_AFTER_OTHER_MS = envInt('WAIT_AFTER_OTHER_MS', 500);
export const WAIT_ACTION_MS = envInt('WAIT_ACTION_MS', 2000);
export const SCROLL_PIXELS = 500;
export const USER_RESPONSE_TIMEOUT_MS = envInt('USER_RESPONSE_TIMEOUT_MS', 120_000);
export const MAX_STEPS = envInt('MAX_STEPS', 50);
export const LLM_MAX_TOKENS = envInt('LLM_MAX_TOKENS', 1024);
export const MAX_SESSIONS = envInt('MAX_SESSIONS', 10);
export const SESSION_IDLE_TIMEOUT_MS = envInt('SESSION_IDLE_TIMEOUT_MS', 300_000);

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
