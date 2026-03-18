import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentLoopResult, CatalogSkill } from '../types.js';

// Mock external dependencies
vi.mock('../llm.js', () => ({
  llmJson: vi.fn(),
}));

vi.mock('../skills/press-and-hold.js', () => ({
  pressAndHold: vi.fn().mockResolvedValue(true),
  detectAntiBot: vi.fn().mockReturnValue(false),
  enrichSnapshot: vi.fn((s: string) => s),
  getPageText: vi.fn().mockResolvedValue(''),
}));

vi.mock('../skills/dismiss-popup.js', () => ({
  detectPopup: vi.fn().mockResolvedValue(false),
  dismissPopup: vi.fn().mockResolvedValue(false),
}));

vi.mock('../skills/loop-detection.js', () => ({
  detectLoop: vi.fn().mockReturnValue(false),
  loopRecoveryStep: vi.fn().mockReturnValue({
    step: 0,
    action: { action: 'wait', reasoning: 'loop recovery' },
    url: '',
    page_title: '',
    timestamp: new Date().toISOString(),
  }),
}));

vi.mock('../skills/tab-manager.js', () => ({
  TabManager: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

const { runAgentLoop } = await import('../agent-loop.js');
const { llmJson } = await import('../llm.js');
const mockedLlmJson = vi.mocked(llmJson);

function mockPage() {
  return {
    snapshot: vi.fn().mockResolvedValue({ snapshot: 'page content' }),
    url: vi.fn().mockResolvedValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Example'),
    click: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(''),
    waitFor: vi.fn().mockResolvedValue(undefined),
    id: 'test-page-id',
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe('runAgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes successfully when agent returns done', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Navigate and complete' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Task complete', answer: 'Done!' });

    const page = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result = await runAgentLoop('Do something', page, emit, controller.signal);

    expect(result.success).toBe(true);
    expect(result.answer).toBe('Done!');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].action.action).toBe('done');
  });

  it('returns failure when agent returns fail', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Try something' })
      .mockResolvedValueOnce({ action: 'fail', reasoning: 'Cannot find the element' });

    const page = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result = await runAgentLoop('Do something', page, emit, controller.signal);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Cannot find the element');
  });

  it('executes click action correctly', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Click stuff' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Click button', ref: '42' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Finished' });

    const page = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result = await runAgentLoop('Click the button', page, emit, controller.signal);

    expect(page.click).toHaveBeenCalledWith('42');
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
  });

  it('executes type action correctly', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Type something' })
      .mockResolvedValueOnce({ action: 'type', reasoning: 'Type in field', ref: '10', text: 'hello' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const page = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Type hello', page, emit, controller.signal);

    expect(page.type).toHaveBeenCalledWith('10', 'hello', { submit: false });
  });

  it('executes navigate action correctly', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Navigate' })
      .mockResolvedValueOnce({ action: 'navigate', reasoning: 'Go to URL', url: 'https://test.com' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const page = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Go to test.com', page, emit, controller.signal);

    expect(page.goto).toHaveBeenCalledWith('https://test.com');
  });

  it('aborts on signal', async () => {
    const controller = new AbortController();
    controller.abort();

    mockedLlmJson.mockResolvedValueOnce({ plan: 'Do stuff' });

    const page = mockPage();
    const emit = vi.fn();

    const result = await runAgentLoop('Do something', page, emit, controller.signal);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Session timed out');
  });

  it('fails after max consecutive parse failures', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Try something' })
      .mockRejectedValueOnce(new Error('Parse error 1'))
      .mockRejectedValueOnce(new Error('Parse error 2'))
      .mockRejectedValueOnce(new Error('Parse error 3'));

    const page = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result = await runAgentLoop('Do something', page, emit, controller.signal);

    expect(result.success).toBe(false);
    expect(result.error).toContain('consecutive LLM failures');
  });

  it('emits step events', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Plan' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Click it', ref: '1' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const page = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Click something', page, emit, controller.signal);

    const stepEvents = emit.mock.calls.filter(([event]) => event === 'step');
    expect(stepEvents).toHaveLength(2);
    expect(stepEvents[0][1].action).toBe('click');
    expect(stepEvents[1][1].action).toBe('done');
  });

  it('emits plan event', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Go to site and click' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const page = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Do task', page, emit, controller.signal);

    const planEvents = emit.mock.calls.filter(([event]) => event === 'plan');
    expect(planEvents).toHaveLength(1);
    expect(planEvents[0][1].plan).toBe('Go to site and click');
  });

  it('resets parse failure counter on successful parse', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Plan' })
      .mockRejectedValueOnce(new Error('Parse error'))
      .mockRejectedValueOnce(new Error('Parse error'))
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Click', ref: '1' })
      .mockRejectedValueOnce(new Error('Parse error'))
      .mockRejectedValueOnce(new Error('Parse error'))
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const page = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result = await runAgentLoop('Do something', page, emit, controller.signal);

    // Should succeed because parse failures were never 3 consecutive
    expect(result.success).toBe(true);
  });
});
