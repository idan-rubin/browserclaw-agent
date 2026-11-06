import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { llm, llmJson, runWithLlmConfig, setLlmAbortSignal } from '../llm.js';

const CONFIG = { provider: 'openai-oauth' as const, model: 'gpt-test', api_key: 'token' };
const REQUEST = { system: 'Respond with valid JSON.', message: 'Say hi', maxTokens: 64 };

function sse(events: Record<string, unknown>[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}`).join('\n\n') + '\n';
}

function completed(text: string): Record<string, unknown> {
  return {
    type: 'response.completed',
    response: { usage: { input_tokens: 1, output_tokens: 1 }, output: [{ content: [{ type: 'output_text', text }] }] },
  };
}

const fetchMock = vi.fn<typeof fetch>();

function respondWith(body: string): void {
  fetchMock.mockResolvedValue(new Response(body, { status: 200 }));
}

function sentBody(): Record<string, unknown> {
  const init = fetchMock.mock.calls[0][1];
  return JSON.parse(init?.body as string) as Record<string, unknown>;
}

describe('Codex Responses client', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the streamed text once although the completed event repeats it', async () => {
    respondWith(sse([{ type: 'response.output_text.done', text: '2 + 2 = 4.' }, completed('2 + 2 = 4.')]));

    const { text } = await runWithLlmConfig(CONFIG, () => llm(REQUEST));

    expect(text).toBe('2 + 2 = 4.');
  });

  it('falls back to the completed event when nothing was streamed', async () => {
    respondWith(sse([completed('{"ok":true}')]));

    const { text } = await runWithLlmConfig(CONFIG, () => llm(REQUEST));

    expect(text).toBe('{"ok":true}');
  });

  it('asks for a JSON object when the caller needs JSON', async () => {
    respondWith(
      sse([{ type: 'response.output_text.done', text: '{"action":"done"}' }, completed('{"action":"done"}')]),
    );

    await runWithLlmConfig(CONFIG, () => llmJson(REQUEST));

    expect(sentBody().text).toEqual({
      format: { type: 'json_schema', name: 'json_object', strict: false, schema: { type: 'object' } },
    });
  });

  it('leaves the output format open for plain text calls', async () => {
    respondWith(sse([{ type: 'response.output_text.done', text: 'hi' }, completed('hi')]));

    await runWithLlmConfig(CONFIG, () => llm(REQUEST));

    expect(sentBody()).not.toHaveProperty('text');
  });

  it('passes the context abort signal to fetch', async () => {
    respondWith(sse([{ type: 'response.output_text.done', text: 'hi' }, completed('hi')]));
    const controller = new AbortController();

    await runWithLlmConfig(CONFIG, async () => {
      setLlmAbortSignal(controller.signal);
      return llm(REQUEST);
    });

    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });
});
