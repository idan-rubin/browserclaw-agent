import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentLoopResult } from '../types.js';

// Mock llm module before importing skill-generator
vi.mock('../llm.js', () => ({
  llmJson: vi.fn(),
}));

// Must import after mock setup
const { generateSkill } = await import('../skill-generator.js');
const { llmJson } = await import('../llm.js');
const mockedLlmJson = vi.mocked(llmJson);

function makeResult(overrides?: Partial<AgentLoopResult>): AgentLoopResult {
  return {
    success: true,
    steps: [
      {
        step: 0,
        action: { action: 'navigate', reasoning: 'Go to example.com', url: 'https://example.com' },
        url: 'https://example.com',
        page_title: 'Example',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
      {
        step: 1,
        action: { action: 'click', reasoning: 'Click the search button', ref: '5' },
        url: 'https://example.com',
        page_title: 'Example',
        timestamp: '2024-01-01T00:00:01.000Z',
      },
      {
        step: 2,
        action: { action: 'type', reasoning: 'Type query', ref: '3', text: 'test query' },
        url: 'https://example.com/search',
        page_title: 'Search',
        timestamp: '2024-01-01T00:00:02.000Z',
      },
      {
        step: 3,
        action: { action: 'done', reasoning: 'Task complete' },
        url: 'https://example.com/results',
        page_title: 'Results',
        timestamp: '2024-01-01T00:00:03.000Z',
      },
    ],
    duration_ms: 3000,
    final_url: 'https://example.com/results',
    ...overrides,
  };
}

describe('generateSkill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a valid SkillOutput from LLM response', async () => {
    mockedLlmJson.mockResolvedValue({
      title: 'Search Example.com',
      description: 'Searches example.com for a query.',
      steps: [
        { number: 1, description: 'Navigate to example.com', action: 'navigate', details: 'https://example.com' },
        { number: 2, description: 'Click search', action: 'click' },
        { number: 3, description: 'Type search query', action: 'type', details: 'test query' },
      ],
    });

    const result = await generateSkill('Search for test', makeResult());

    expect(result.title).toBe('Search Example.com');
    expect(result.description).toBe('Searches example.com for a query.');
    expect(result.steps).toHaveLength(3);
    expect(result.metadata.prompt).toBe('Search for test');
    expect(result.metadata.url).toBe('https://example.com/results');
    expect(result.metadata.total_steps).toBe(4);
    expect(result.metadata.duration_ms).toBe(3000);
    expect(result.markdown).toContain('# Search Example.com');
    expect(result.markdown).toContain('Navigate to example.com');
  });

  it('generates correct markdown format', async () => {
    mockedLlmJson.mockResolvedValue({
      title: 'Test Skill',
      description: 'A test skill description.',
      steps: [
        { number: 1, description: 'Step one', action: 'click', details: 'Click the button' },
        { number: 2, description: 'Step two', action: 'type' },
      ],
    });

    const result = await generateSkill('Do something', makeResult());

    expect(result.markdown).toContain('# Test Skill');
    expect(result.markdown).toContain('A test skill description.');
    expect(result.markdown).toContain('## Steps');
    expect(result.markdown).toContain('1. **Step one**');
    expect(result.markdown).toContain('   Click the button');
    expect(result.markdown).toContain('2. **Step two**');
    expect(result.markdown).toContain('**Prompt:** Do something');
    expect(result.markdown).toContain('**Final URL:** https://example.com/results');
    expect(result.markdown).toContain('**Duration:** 3.0s');
  });

  it('passes action history to LLM in the message', async () => {
    mockedLlmJson.mockResolvedValue({
      title: 'Skill',
      description: 'Desc',
      steps: [],
    });

    await generateSkill('My prompt', makeResult());

    expect(mockedLlmJson).toHaveBeenCalledOnce();
    const call = mockedLlmJson.mock.calls[0][0];
    expect(call.message).toContain('Original task: My prompt');
    expect(call.message).toContain('Step 0: navigate');
    expect(call.message).toContain('Step 1: click');
    expect(call.message).toContain('Step 2: type');
    expect(call.message).toContain('Duration: 3000ms');
  });

  it('includes final_url in prompt', async () => {
    mockedLlmJson.mockResolvedValue({
      title: 'Skill',
      description: 'Desc',
      steps: [],
    });

    await generateSkill('test', makeResult({ final_url: 'https://foo.com/bar' }));

    const call = mockedLlmJson.mock.calls[0][0];
    expect(call.message).toContain('Final URL: https://foo.com/bar');
  });
});
