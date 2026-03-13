import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const LOG_DIR = process.env.PROMPT_LOG_DIR || '/app/data/prompts';

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
  if (!ensureDirPromise) {
    ensureDirPromise = mkdir(LOG_DIR, { recursive: true }).then(
      () => {},
      (err) => {
        ensureDirPromise = null;
        throw err;
      },
    );
  }
  return ensureDirPromise;
}

export async function logPrompt(entry: PromptLogEntry): Promise<void> {
  console.log(JSON.stringify({ type: 'prompt_log', ...entry }));

  try {
    await ensureDir();
    const date = new Date().toISOString().slice(0, 10);
    const file = join(LOG_DIR, `prompts-${date}.jsonl`);
    await appendFile(file, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('Failed to write prompt log:', err);
  }
}
