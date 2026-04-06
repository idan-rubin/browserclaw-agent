import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CrawlPage } from 'browserclaw';
import { LlmParseError } from '../types.js';
import type { AgentLoopResult } from '../types.js';

// Mock external dependencies
vi.mock('../llm.js', () => ({
  llmJson: vi.fn(),
}));

vi.mock('../skills/press-and-hold.js', () => ({
  pressAndHold: vi.fn().mockResolvedValue(true),
  detectAntiBot: vi.fn().mockReturnValue(null),
  enrichSnapshot: vi.fn((s: string) => s),
  getPageText: vi.fn().mockResolvedValue(''),
}));

vi.mock('../skills/dismiss-popup.js', () => ({
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
  WAIT_AFTER_TYPE_MS: 100,
  WAIT_AFTER_CLICK_MS: 100,
  WAIT_AFTER_OTHER_MS: 100,
  WAIT_ACTION_MS: 100,
  SCROLL_PIXELS: 500,
  LLM_MAX_TOKENS: 1024,
  MAX_STEPS: 100,
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
      .mockResolvedValueOnce({ action: 'navigate', reasoning: 'Go to URL', url: 'https://test.com' })
      .mockResolvedValueOnce({ action: 'done', reasoning: 'Done' });

    const { page, mock } = mockPage();
    const emit = vi.fn();
    const controller = new AbortController();

    await runAgentLoop('Go to test.com', page, emit, controller.signal);

    expect(mock.goto).toHaveBeenCalledWith('https://test.com');
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
    expect(result.steps[0].action.error_feedback).toContain('not found');
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

    // Progress should be passed to the next LLM call via buildUserMessage
    const lastLlmCall = mockedLlmJson.mock.calls[mockedLlmJson.mock.calls.length - 1][0];
    expect(lastLlmCall.message).toContain('Progress');
    expect(lastLlmCall.message).toContain('found the search page');
    expect(lastLlmCall.message).toContain('entering search criteria');
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
