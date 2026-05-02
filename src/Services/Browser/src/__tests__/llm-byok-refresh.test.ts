import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { llm, runWithLlmConfig } from '../llm.js';

function sseOk(text: string): Response {
  const body = [
    `data: ${JSON.stringify({ type: 'response.output_text.done', text })}`,
    `data: ${JSON.stringify({ type: 'response.completed', response: { usage: { input_tokens: 1, output_tokens: 1 } } })}`,
  ].join('\n');
  return new Response(body, { status: 200 });
}

describe('BYOK openai-oauth refresh on 401', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('refreshes the OAuth token once and retries on 401', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":{"code":"token_expired"}}', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'fresh-token', refresh_token: 'r2' }), { status: 200 }),
      )
      .mockResolvedValueOnce(sseOk('hello'));

    const result = await runWithLlmConfig(
      { provider: 'openai-oauth', model: 'gpt-5.4', api_key: 'expired-token', refresh_token: 'r1' },
      () => llm({ system: 's', message: 'm', maxTokens: 16 }),
    );

    expect(result.text).toBe('hello');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const tokenCallArg = fetchMock.mock.calls[1][0] as string | URL;
    const tokenUrl = typeof tokenCallArg === 'string' ? tokenCallArg : tokenCallArg.href;
    expect(tokenUrl).toContain('auth.openai.com/oauth/token');
    const retryHeaders = fetchMock.mock.calls[2][1]?.headers as Record<string, string>;
    expect(retryHeaders.Authorization).toBe('Bearer fresh-token');
  });

  it('does not refresh when no refresh_token is provided', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"code":"token_expired"}}', { status: 401 }));

    await expect(
      runWithLlmConfig({ provider: 'openai-oauth', model: 'gpt-5.4', api_key: 'expired-token' }, () =>
        llm({ system: 's', message: 'm', maxTokens: 16 }),
      ),
    ).rejects.toThrow(/^401/);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not lock the session when the refresh endpoint fails transiently', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    // First llm call: 401 → refresh fails with 5xx → propagates
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":{"code":"token_expired"}}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{"error":"server"}', { status: 503 }));

    await expect(
      runWithLlmConfig({ provider: 'openai-oauth', model: 'gpt-5.4', api_key: 'expired', refresh_token: 'r1' }, () =>
        llm({ system: 's', message: 'm', maxTokens: 16 }),
      ),
    ).rejects.toThrow(/OAuth token refresh failed/);

    // Second llm call in the same session must still attempt the refresh — the prior failure didn't poison the session.
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":{"code":"token_expired"}}', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'fresh-token', refresh_token: 'r2' }), { status: 200 }),
      )
      .mockResolvedValueOnce(sseOk('recovered'));

    const second = await runWithLlmConfig(
      { provider: 'openai-oauth', model: 'gpt-5.4', api_key: 'expired', refresh_token: 'r1' },
      () => llm({ system: 's', message: 'm', maxTokens: 16 }),
    );
    expect(second.text).toBe('recovered');
  });

  it('only refreshes once per session even if the retry also 401s', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":{"code":"token_expired"}}', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'fresh-token', refresh_token: 'r2' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response('{"error":{"code":"token_expired"}}', { status: 401 }));

    await expect(
      runWithLlmConfig({ provider: 'openai-oauth', model: 'gpt-5.4', api_key: 'expired', refresh_token: 'r1' }, () =>
        llm({ system: 's', message: 'm', maxTokens: 16 }),
      ),
    ).rejects.toThrow(/^401/);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
