import { describe, it, expect, vi } from 'vitest';
import OpenAI from 'openai';
import * as sdk from '../index.js';
import { BYOK_PROVIDERS, llmVision, runWithLlmConfig } from '../llm.js';
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

describe('vision requests', () => {
  it.each([
    ['openai', 'gpt-6.2-sol', 'max_completion_tokens'],
    ['gemini', 'gemini-4-hydrogen', 'max_tokens'],
  ] as const)('uses the %s token limit field for screenshots', async (provider, model, limitField) => {
    const create = vi.spyOn(OpenAI.Chat.Completions.prototype, 'create').mockRejectedValue(new Error('intercepted'));
    try {
      await expect(
        runWithLlmConfig({ provider, model, api_key: 'test' }, () => llmVision('Read', 'What is visible?', 'aW1n')),
      ).rejects.toThrow('intercepted');
      const [request] = create.mock.calls[0];
      expect(request).toMatchObject({ model, [limitField]: 2048 });
      expect(request).not.toHaveProperty(limitField === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens');
    } finally {
      create.mockRestore();
    }
  });
});

describe('public entry point', () => {
  it('exposes the model calls so a host can proxy its subscription', () => {
    expect(typeof sdk.llm).toBe('function');
    expect(typeof sdk.llmJson).toBe('function');
    expect(typeof sdk.runWithLlmConfig).toBe('function');
  });
});
