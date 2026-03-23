import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from './logger.js';
import { requireEnv } from './config.js';

const LOG_DIR = requireEnv('PROMPT_LOG_DIR');

interface PromptLogEntry {
  timestamp: string;
  session_id: string;
  ip: string;
  prompt: string;
  url?: string;
  status: 'started' | 'completed' | 'failed';
  steps?: number;
  duration_ms?: number;
  error?: string;
  domain?: string;
  skills_loaded?: number;
  skill_outcome?: 'saved' | 'improved' | 'validated' | 'none';
}

let ensureDirPromise: Promise<void> | null = null;

function ensureDir(): Promise<void> {
  ensureDirPromise ??= mkdir(LOG_DIR, { recursive: true }).then(
    () => {
      /* dir created */
    },
    (err: unknown) => {
      ensureDirPromise = null;
      throw err;
    },
  );
  return ensureDirPromise;
}

export async function logPrompt(entry: PromptLogEntry): Promise<void> {
  logger.info({ type: 'prompt_log', ...entry }, 'Prompt log');

  try {
    await ensureDir();
    const date = new Date().toISOString().slice(0, 10);
    const file = join(LOG_DIR, `prompts-${date}.jsonl`);
    await appendFile(file, JSON.stringify(entry) + '\n');
  } catch (err) {
    logger.error({ err }, 'Failed to write prompt log');
  }
}
