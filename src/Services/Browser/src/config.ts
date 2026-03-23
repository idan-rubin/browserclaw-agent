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

// Agent timing (ms)
export const WAIT_AFTER_TYPE_MS = requireEnvInt('WAIT_AFTER_TYPE_MS');
export const WAIT_AFTER_CLICK_MS = requireEnvInt('WAIT_AFTER_CLICK_MS');
export const WAIT_AFTER_OTHER_MS = requireEnvInt('WAIT_AFTER_OTHER_MS');
export const WAIT_ACTION_MS = requireEnvInt('WAIT_ACTION_MS');
export const SCROLL_PIXELS = 500;
export const USER_RESPONSE_TIMEOUT_MS = requireEnvInt('USER_RESPONSE_TIMEOUT_MS');
export const MAX_STEPS = parseInt(process.env.MAX_STEPS ?? '100', 10);
export const LLM_MAX_TOKENS = parseInt(process.env.LLM_MAX_TOKENS ?? '1024', 10);

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
