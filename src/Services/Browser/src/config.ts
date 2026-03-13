import { getAvailableProviders, getActiveProvider, getModel } from './llm.js';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`FATAL: ${name} is required but not set`);
    process.exit(1);
  }
  return value;
}

export function requireEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    console.error(`FATAL: ${name} must be a number, got "${raw}"`);
    process.exit(1);
  }
  return parsed;
}

// Agent timing (ms)
export const WAIT_AFTER_TYPE_MS = requireEnvInt('WAIT_AFTER_TYPE_MS', 2000);
export const WAIT_AFTER_CLICK_MS = requireEnvInt('WAIT_AFTER_CLICK_MS', 1000);
export const WAIT_AFTER_OTHER_MS = requireEnvInt('WAIT_AFTER_OTHER_MS', 500);
export const WAIT_ACTION_MS = requireEnvInt('WAIT_ACTION_MS', 2000);
export const MAX_AGENT_STEPS = requireEnvInt('MAX_AGENT_STEPS', 50);
export const SCROLL_PIXELS = 500;
export const USER_RESPONSE_TIMEOUT_MS = requireEnvInt('USER_RESPONSE_TIMEOUT_MS', 300_000);
export const LLM_MAX_TOKENS = 1024;

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
  internalToken: string | undefined;
}

export function validateConfig(): ServerConfig {
  const available = getAvailableProviders();
  if (available.length === 0) {
    console.error('FATAL: No AI providers available. Set at least one provider API key.');
    process.exit(1);
  }
  console.log(`Available providers: ${available.map(p => p.provider).join(', ')}`);

  // Validate LLM_PROVIDER + API key at startup so we fail fast
  const active = getActiveProvider();
  console.log(`Active provider: ${active.provider}, model: ${getModel()}`);

  return {
    port: requireEnvInt('PORT', 5040),
    rateLimitMax: requireEnvInt('RATE_LIMIT_MAX', 20),
    rateLimitWindowMs: requireEnvInt('RATE_LIMIT_WINDOW_MS', 86_400_000),
    internalToken: process.env.BROWSER_INTERNAL_TOKEN,
  };
}
