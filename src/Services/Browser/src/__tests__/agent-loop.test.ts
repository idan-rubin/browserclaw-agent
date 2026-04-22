import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CrawlPage } from 'browserclaw';
import { LlmParseError } from '../types.js';
import type { AgentLoopResult } from '../types.js';

// Mock external dependencies
vi.mock('../llm.js', () => ({
  llmJson: vi.fn(),
  llmVision: vi.fn(),
  sanitizeErrorText: (s: string) => s,
  getTokenUsage: vi.fn(() => ({ input: 0, output: 0, total: 0 })),
  getLLMCallCount: vi.fn(() => 0),
  resetLLMCallCount: vi.fn(),
  runWithLlmConfig: <T>(_config: unknown, fn: () => Promise<T>) => fn(),
}));

vi.mock('../skills/press-and-hold.js', () => ({
  pressAndHold: vi.fn().mockResolvedValue(true),
  detectAntiBot: vi.fn().mockReturnValue(null),
  enrichSnapshot: vi.fn((s: string) => s),
  getPageText: vi.fn().mockResolvedValue(''),
}));

vi.mock('../skills/dismiss-popup.js', () => ({
  capturePopupSignatures: vi.fn().mockResolvedValue(new Set<string>()),
  detectPopup: vi.fn().mockResolvedValue(false),
  dismissPopup: vi.fn().mockResolvedValue(false),
}));

vi.mock('../skills/loop-detection.js', () => ({
  detectLoop: vi.fn().mockReturnValue(null),
}));

vi.mock('../skills/tab-manager.js', () => ({
  TabManager: vi.fn(),
}));

vi.mock('../config.js', () => ({
  INTERJECTION_INJECTION_MAX_CHARS: 2000,
  defaultAgentConfig: (overrides?: Record<string, unknown>) => ({
    waitAfterTypeMs: 100,
    waitAfterClickMs: 100,
    waitAfterOtherMs: 100,
    waitActionMs: 100,
    scrollPixels: 500,
    maxSteps: 100,
    llmMaxTokens: 1024,
    ...overrides,
  }),
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

const { runAgentLoop, shouldCheckTermination } = await import('../agent-loop.js');
const { llmJson } = await import('../llm.js');
const mockedLlmJson = vi.mocked(llmJson);

interface MockPage {
  snapshot: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  click: ReturnType<typeof vi.fn>;
  type: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  press: ReturnType<typeof vi.fn>;
  waitFor: ReturnType<typeof vi.fn>;
  id: string;
}

function mockPage(): { page: CrawlPage; mock: MockPage } {
  const mock: MockPage = {
    snapshot: vi.fn().mockResolvedValue({ snapshot: 'page content' }),
    url: vi.fn().mockResolvedValue('https://example.com'),
    title: vi.fn().mockResolvedValue('Example'),
    click: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(''),
    press: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue(undefined),
    id: 'test-page-id',
  };
  return { page: mock as unknown as CrawlPage, mock };
}

describe('runAgentLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes successfully when agent returns done', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Navigate and complete' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Click button', ref: '1' })
      .mockResolvedValueOnce({
        action: 'done',
        reasoning: 'Task complete',
        answer: 'Task completed successfully — all required steps finished.',
      });

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Do something', page, emit, controller.signal);

    expect(result.success).toBe(true);
    expect(result.answer).toBe('Task completed successfully — all required steps finished.');
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].action.action).toBe('done');
  });

  it('returns failure when agent returns fail', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Try something' })
      .mockResolvedValueOnce({ action: 'fail', reasoning: 'Cannot find the element' });

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Do something', page, emit, controller.signal);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Cannot find the element');
  });

  it('executes click action correctly', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Click stuff' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Click button', ref: '42' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Finished' });

    const { page, mock } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Click the button', page, emit, controller.signal);

    expect(mock.click).toHaveBeenCalledWith('42');
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
  });

  it('stops clicking a ref that repeatedly fails with "intercepted" (not only "not found")', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Click' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'First try', ref: '77' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Second try', ref: '77' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Third try on same ref', ref: '77' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Give up', answer: 'no' });

    const { page, mock } = mockPage();
    mock.click.mockRejectedValue(new Error('Click on "77" was intercepted by another element.'));
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Click intercepted ref', page, emit, controller.signal);

    expect(mock.click.mock.calls.filter((c) => c[0] === '77').length).toBeLessThanOrEqual(2);
  });

  it('does not ban a ref on transient network/timeout errors', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Click' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'First try', ref: '55' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Second try', ref: '55' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Third try', ref: '55' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Give up', answer: 'ok' });

    const { page, mock } = mockPage();
    mock.click.mockRejectedValue(new Error('Timeout 30000ms exceeded waiting for response.'));
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Click flaky ref', page, emit, controller.signal);

    expect(mock.click.mock.calls.filter((c) => c[0] === '55').length).toBe(3);
  });

  it('stops clicking a ref after it has failed BAN_THRESHOLD times without triggering parse-failure cascade', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Click' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'First try', ref: '99' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Second try', ref: '99' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Third try on same ref', ref: '99' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Fourth try on same ref', ref: '99' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Give up', answer: 'no' });

    const { page, mock } = mockPage();
    mock.click.mockRejectedValue(
      new Error('Element "99" not found or not visible. Run a new snapshot to see current page elements.'),
    );
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Click banned ref', page, emit, controller.signal);

    const parseErrors = emit.mock.calls.filter(
      (c) =>
        c[0] === 'step_error' &&
        typeof c[1] === 'object' &&
        c[1] !== null &&
        (c[1] as { type?: string }).type === 'parse_error',
    );
    expect(parseErrors.length).toBe(0);
    expect(mock.click.mock.calls.filter((c) => c[0] === '99').length).toBeLessThanOrEqual(2);
  });

  it('aborts remaining queued actions when URL changes mid-batch', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'batch click' })
      .mockResolvedValueOnce({
        reasoning: 'Click two buttons',
        actions: [
          { action: 'click', reasoning: 'first click navigates', ref: '1' },
          { action: 'click', reasoning: 'second click on stale ref', ref: '2' },
        ],
      })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'done after abort', answer: 'ok' });

    const { page, mock } = mockPage();
    mock.url.mockResolvedValue('https://example.com/a');
    mock.click.mockImplementation((ref: string) => {
      if (ref === '1') mock.url.mockResolvedValue('https://example.com/b');
    });

    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('batch', page, emit, controller.signal);

    expect(mock.click).toHaveBeenCalledTimes(1);
    expect(mock.click).toHaveBeenCalledWith('1');
    const aborted = result.steps.find((s) => s.outcome?.includes('Aborting') === true);
    expect(aborted).toBeDefined();
  });

  it('executes type action correctly', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Type something' })
      .mockResolvedValueOnce({ action: 'type', reasoning: 'Type in field', ref: '10', text: 'hello' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const { page, mock } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Type hello', page, emit, controller.signal);

    expect(mock.type).toHaveBeenCalledWith('10', 'hello', { submit: false });
  });

  it('executes navigate action correctly', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Navigate' })
      .mockResolvedValueOnce({ action: 'navigate', reasoning: 'Go to URL', url: 'https://demo.playwright.dev/todomvc' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const { page, mock } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Go to the Playwright TodoMVC demo', page, emit, controller.signal);

    expect(mock.goto).toHaveBeenCalledWith('https://demo.playwright.dev/todomvc');
  });

  it('aborts on signal', async () => {
    const controller = new AbortController();
    controller.abort();

    mockedLlmJson.mockResolvedValueOnce({ plan: 'Do stuff' });

    const { page } = mockPage();
    const emit = vi.fn();

    const result: AgentLoopResult = await runAgentLoop('Do something', page, emit, controller.signal);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Session aborted');
  });

  it('switches sites after 5 parse failures, force-completes at 8 cross-site', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Try something' })
      // Site 1: 5 parse failures → site switch
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad 1'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad 2'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad 3'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad 4'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad 5'))
      // Site 2: 3 more parse failures → 8 total → force-done
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad 6'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad 7'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad 8'))
      // getFinalSummary call
      .mockResolvedValueOnce({ answer: 'Partial findings' });

    const { page, mock } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Do something', page, emit, controller.signal);

    expect(result.success).toBe(true);
    expect(result.answer).toBe('Partial findings');
    // Should have navigated to about:blank on site switch
    expect(mock.goto).toHaveBeenCalledWith('about:blank');
    // Should emit site_switch event
    const switchEvents = (emit.mock.calls as [string, unknown][]).filter(([e]) => e === 'site_switch');
    expect(switchEvents).toHaveLength(1);
  });

  it('recovers from parse failures after site switch', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Try something' })
      // Site 1: 5 parse failures → site switch
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad 1'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad 2'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad 3'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad 4'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad 5'))
      // Site 2: succeeds
      .mockResolvedValueOnce({
        action: 'done',
        reasoning: 'Found it on another site',
        answer: 'Found the result successfully on an alternative website after switching.',
      });

    const { page, mock } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Do something', page, emit, controller.signal);

    expect(result.success).toBe(true);
    expect(result.answer).toBe('Found the result successfully on an alternative website after switching.');
    expect(mock.goto).toHaveBeenCalledWith('about:blank');
  });

  it('fails after max consecutive API failures without burning steps', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Try something' })
      .mockRejectedValueOnce(new Error('429 Rate limited'))
      .mockRejectedValueOnce(new Error('500 Internal server error'))
      .mockRejectedValueOnce(new Error('Connection refused'));

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Do something', page, emit, controller.signal);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unable to reach the AI service');
  });

  it('emits step events', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Plan' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Click it', ref: '1' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Click something', page, emit, controller.signal);

    const stepEvents = (emit.mock.calls as [string, Record<string, unknown>][]).filter(([event]) => event === 'step');
    expect(stepEvents).toHaveLength(2);
    expect(stepEvents[0][1].action).toBe('click');
    expect(stepEvents[1][1].action).toBe('done');
  });

  it('emits plan event', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Go to site and click' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Do task', page, emit, controller.signal);

    const planEvents = (emit.mock.calls as [string, Record<string, unknown>][]).filter(([event]) => event === 'plan');
    expect(planEvents).toHaveLength(1);
    expect(planEvents[0][1].plan).toBe('Go to site and click');
  });

  it('executes keyboard action correctly', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Press Enter' })
      .mockResolvedValueOnce({ action: 'keyboard', reasoning: 'Submit form', key: 'Enter' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const { page, mock } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Submit the form', page, emit, controller.signal);

    expect(mock.press).toHaveBeenCalledWith('Enter');
  });

  it('executes back action correctly', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Go back' })
      .mockResolvedValueOnce({ action: 'back', reasoning: 'Return to previous page' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const { page, mock } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Go back', page, emit, controller.signal);

    expect(mock.evaluate).toHaveBeenCalledWith('window.history.back()');
  });

  it('records error feedback when action fails', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Click' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Click button', ref: '42' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const { page, mock } = mockPage();
    mock.click.mockRejectedValueOnce(new Error('Element not found'));
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Click button', page, emit, controller.signal);

    expect(result.success).toBe(true);
    expect(result.steps[0].action.error_feedback).toContain('not in the current snapshot');
  });

  it('resets parse failure counter on successful parse', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Plan' })
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad'))
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Click', ref: '1' })
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad'))
      .mockRejectedValueOnce(new LlmParseError('No JSON', 'bad'))
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Do something', page, emit, controller.signal);

    // Should succeed because parse failures were never 5 consecutive
    expect(result.success).toBe(true);
  });

  it('refines vague prompts into SMART tasks', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({
        task: 'Search for apartments in Chelsea. Collect listings with details.',
        plan: 'Go to site',
      })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Click search', ref: '1' })
      .mockResolvedValueOnce({
        action: 'done',
        reasoning: 'Found results',
        answer: 'Found 3 apartment listings in Chelsea with prices, bedrooms, and URLs.',
      });

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('find apartments in Chelsea', page, emit, controller.signal);

    expect(result.success).toBe(true);
    const goalEvents = (emit.mock.calls as [string, Record<string, unknown>][]).filter(
      ([event]) => event === 'goal_refined',
    );
    expect(goalEvents).toHaveLength(1);
    expect(goalEvents[0][1].original).toBe('find apartments in Chelsea');
    expect(goalEvents[0][1].refined).toBe('Search for apartments in Chelsea. Collect listings with details.');
  });

  it('does not refine already specific prompts', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Go to Nobu and book' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Booked', answer: 'Table booked' });

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('book a table at Nobu for 2 at 7pm', page, emit, controller.signal);

    const goalEvents = (emit.mock.calls as [string, Record<string, unknown>][]).filter(
      ([event]) => event === 'goal_refined',
    );
    expect(goalEvents).toHaveLength(0);
  });

  it('provides natural language error for intercepted click', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Click' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Click button', ref: '10' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const { page, mock } = mockPage();
    mock.click.mockRejectedValueOnce(new Error('Element click intercepted by another element'));
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Click button', page, emit, controller.signal);

    expect(result.success).toBe(true);
    expect(result.steps[0].action.error_feedback).toContain('intercepted');
    expect(result.steps[0].action.error_feedback).toContain('ref 10');
    expect(result.steps[0].action.error_feedback).toContain('overlays or popups');
  });

  it('provides natural language error for navigation timeout', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Navigate' })
      .mockResolvedValueOnce({ action: 'navigate', reasoning: 'Go', url: 'https://slow.example.com' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const { page, mock } = mockPage();
    mock.goto.mockRejectedValueOnce(new Error('Navigation timed out'));
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Navigate', page, emit, controller.signal);

    expect(result.success).toBe(true);
    expect(result.steps[0].action.error_feedback).toContain('timed out');
    expect(result.steps[0].action.error_feedback).toContain('slow.example.com');
  });

  it('records action outcome on successful click that changes URL', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Click link' })
      .mockResolvedValueOnce({ action: 'click', reasoning: 'Click link', ref: '5' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const { page, mock } = mockPage();
    // After click, URL changes — first few calls return original, later ones return new page
    mock.url
      .mockResolvedValueOnce('https://example.com') // isBrowserAlive
      .mockResolvedValueOnce('https://example.com') // step snapshot
      .mockResolvedValueOnce('https://example.com') // agentStep.url
      .mockResolvedValueOnce('https://example.com') // preActionUrl
      .mockResolvedValue('https://example.com/new-page'); // postActionUrl + all subsequent
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Click link', page, emit, controller.signal);

    expect(result.success).toBe(true);
    expect(result.steps[0].outcome).toContain('Navigated to new page');
  });

  it('extracts progress from LLM response', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Search' })
      .mockResolvedValueOnce({
        action: 'click',
        reasoning: 'Click search',
        ref: '1',
        progress: {
          completed: ['found the search page'],
          current: 'entering search criteria',
          blocked_by: null,
        },
      })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Search', page, emit, controller.signal);

    const messages = mockedLlmJson.mock.calls.map((c) => c[0].message);
    expect(
      messages.some(
        (m) => m.includes('Progress') && m.includes('found the search page') && m.includes('entering search criteria'),
      ),
    ).toBe(true);
  });

  it('injects feedback when memory is duplicated across steps', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Research' })
      .mockResolvedValueOnce({
        action: 'scroll',
        reasoning: 'Scrolling for data',
        memory: 'Found: Hotel A $100, Hotel B $200',
        direction: 'down',
      })
      .mockResolvedValueOnce({
        action: 'scroll',
        reasoning: 'Looking for more',
        memory: 'Found: Hotel A $100, Hotel B $200',
        direction: 'down',
      })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done', answer: 'Hotels found' });

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Find hotels', page, emit, controller.signal);

    expect(result.success).toBe(true);
    // The second scroll step should have duplicate memory feedback
    const scrollSteps = result.steps.filter((s) => s.action.action === 'scroll');
    expect(scrollSteps[1].action.error_feedback).toContain('DUPLICATE MEMORY');
  });

  it('escalates duplicate memory feedback after 3 consecutive duplicates', async () => {
    const staleMemory = 'Found: Hotel A $100';
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Research' })
      .mockResolvedValueOnce({ action: 'scroll', reasoning: 'First', memory: staleMemory, direction: 'down' })
      .mockResolvedValueOnce({ action: 'scroll', reasoning: 'Second', memory: staleMemory, direction: 'down' })
      .mockResolvedValueOnce({ action: 'scroll', reasoning: 'Third', memory: staleMemory, direction: 'down' })
      .mockResolvedValueOnce({ action: 'scroll', reasoning: 'Fourth', memory: staleMemory, direction: 'down' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done', answer: 'Hotels' });

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Find hotels', page, emit, controller.signal);

    expect(result.success).toBe(true);
    // After 3 duplicates (4th scroll step), feedback should escalate to STALE EXTRACTION
    const scrollSteps = result.steps.filter((s) => s.action.action === 'scroll');
    expect(scrollSteps[3].action.error_feedback).toContain('STALE EXTRACTION');
  });

  it('fails when MAX_STEPS is reached', async () => {
    mockedLlmJson
      .mockResolvedValueOnce({ plan: 'Scroll forever' })
      .mockResolvedValue({ action: 'scroll', reasoning: 'Keep scrolling', direction: 'down' });

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop(
      'Scroll',
      page,
      emit,
      controller.signal,
      undefined,
      undefined,
      undefined,
      3,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('maximum step limit');
    expect(result.steps).toHaveLength(3);
  });
});

describe('shouldCheckTermination', () => {
  it('does not trigger before the min step', () => {
    expect(shouldCheckTermination(0)).toBe(false);
    expect(shouldCheckTermination(4)).toBe(false);
  });

  it('triggers at the interval once past the min step', () => {
    expect(shouldCheckTermination(8)).toBe(true);
    expect(shouldCheckTermination(12)).toBe(true);
    expect(shouldCheckTermination(16)).toBe(true);
  });

  it('does not trigger off-interval past the min step', () => {
    expect(shouldCheckTermination(9)).toBe(false);
    expect(shouldCheckTermination(11)).toBe(false);
  });
});

describe('termination judgment integration', () => {
  it('nudges the agent to call done when the judge rules the answer is ready', async () => {
    mockedLlmJson.mockResolvedValueOnce({ plan: 'Gather data' });
    for (let i = 0; i < 8; i++) {
      mockedLlmJson.mockResolvedValueOnce({
        action: 'extract_full_page',
        reasoning: `Extract step ${String(i)}`,
        memory: `Gathered datum ${String(i)}`,
      });
    }
    mockedLlmJson.mockResolvedValueOnce({
      status: 'ready',
      answer: 'Judge-constructed answer (ignored — agent crafts its own).',
    });
    mockedLlmJson.mockResolvedValueOnce({
      action: 'done',
      reasoning: 'Judge said I have enough — finalizing with memory.',
      answer: 'Agent-crafted final answer grounded in memory.',
    });

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Research question', page, emit, controller.signal);

    expect(result.success).toBe(true);
    expect(result.answer).toBe('Agent-crafted final answer grounded in memory.');
    const doneStep = result.steps[result.steps.length - 1];
    expect(doneStep.action.action).toBe('done');
  });

  it('nudges the agent with the missing data when the judge says not ready', async () => {
    mockedLlmJson.mockResolvedValueOnce({ plan: 'Gather data' });
    for (let i = 0; i < 8; i++) {
      mockedLlmJson.mockResolvedValueOnce({
        action: 'extract_full_page',
        reasoning: `Extract step ${String(i)}`,
        memory: `Step ${String(i)} memory`,
      });
    }
    mockedLlmJson.mockResolvedValueOnce({
      status: 'needs_more',
      missing: 'the specific fee amount',
    });
    mockedLlmJson.mockResolvedValueOnce({
      action: 'done',
      reasoning: 'Finishing anyway',
      answer: 'Here is what I found. The fee could not be verified.',
    });

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Research question', page, emit, controller.signal);

    expect(result.success).toBe(true);
    const messages = mockedLlmJson.mock.calls.map((c) => c[0].message);
    expect(messages.some((m) => m.includes('the specific fee amount'))).toBe(true);
  });

  it('force-completes after 3 consecutive not-ready judgments (fatigue)', async () => {
    mockedLlmJson.mockResolvedValueOnce({ plan: 'Gather data' });
    for (let i = 0; i < 17; i++) {
      mockedLlmJson.mockResolvedValueOnce({
        action: 'extract_full_page',
        reasoning: `Extract step ${String(i)}`,
        memory: `Step ${String(i)} memory`,
      });
    }
    mockedLlmJson.mockResolvedValue({ status: 'needs_more', missing: 'exact fees' });

    const { page } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    const result: AgentLoopResult = await runAgentLoop('Research', page, emit, controller.signal);

    expect(result.success).toBe(true);
    expect(result.steps[result.steps.length - 1].action.action).toBe('done');
  });
});
