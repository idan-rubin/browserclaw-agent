import { describe, it, expect } from 'vitest';
import { BYOK_PROVIDERS } from '../llm.js';
import type { LlmProvider } from '../types.js';

const REQUIRED_PROVIDERS: LlmProvider[] = ['anthropic', 'openai', 'openai-oauth', 'gemini'];

describe('BYOK_PROVIDERS', () => {
  it.each(REQUIRED_PROVIDERS)('"%s" exists with a base URL', (provider) => {
    const entry = BYOK_PROVIDERS[provider];
    expect(entry).toBeDefined();
    expect(entry?.baseURL).toBeTruthy();
  });

  it('openai and openai-oauth have different base URLs', () => {
    expect(BYOK_PROVIDERS.openai?.baseURL).not.toBe(BYOK_PROVIDERS['openai-oauth']?.baseURL);
  });
});
