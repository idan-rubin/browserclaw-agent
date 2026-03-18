import { describe, it, expect } from 'vitest';
import { detectLoop, loopRecoveryStep } from '../skills/loop-detection.js';
import type { AgentStep } from '../types.js';

function makeStep(action: string, ref?: string, step = 0): AgentStep {
  return {
    step,
    action: { action: action as AgentStep['action']['action'], reasoning: 'test', ref },
    url: 'https://example.com',
    page_title: 'Test',
    timestamp: new Date().toISOString(),
  };
}

describe('detectLoop', () => {
  it('returns false for empty history', () => {
    expect(detectLoop({ action: 'click', ref: '5' }, [])).toBe(false);
  });

  it('returns false for fewer than 3 recent steps', () => {
    const history = [makeStep('click', '5'), makeStep('click', '5')];
    expect(detectLoop({ action: 'click', ref: '5' }, history)).toBe(false);
  });

  it('detects loop when last 3 steps match current action', () => {
    const history = [
      makeStep('click', '5', 0),
      makeStep('click', '5', 1),
      makeStep('click', '5', 2),
    ];
    expect(detectLoop({ action: 'click', ref: '5' }, history)).toBe(true);
  });

  it('returns false when actions differ', () => {
    const history = [
      makeStep('click', '5', 0),
      makeStep('type', '5', 1),
      makeStep('click', '5', 2),
    ];
    expect(detectLoop({ action: 'click', ref: '5' }, history)).toBe(false);
  });

  it('returns false when refs differ', () => {
    const history = [
      makeStep('click', '5', 0),
      makeStep('click', '6', 1),
      makeStep('click', '5', 2),
    ];
    expect(detectLoop({ action: 'click', ref: '5' }, history)).toBe(false);
  });

  it('only checks last 3 steps', () => {
    const history = [
      makeStep('type', '3', 0),
      makeStep('navigate', undefined, 1),
      makeStep('click', '5', 2),
      makeStep('click', '5', 3),
      makeStep('click', '5', 4),
    ];
    expect(detectLoop({ action: 'click', ref: '5' }, history)).toBe(true);
  });

  it('handles actions without ref', () => {
    const history = [
      makeStep('scroll', undefined, 0),
      makeStep('scroll', undefined, 1),
      makeStep('scroll', undefined, 2),
    ];
    expect(detectLoop({ action: 'scroll' }, history)).toBe(true);
  });
});

describe('loopRecoveryStep', () => {
  it('returns a wait action with recovery reasoning', () => {
    const step = loopRecoveryStep(5);
    expect(step.step).toBe(5);
    expect(step.action.action).toBe('wait');
    expect(step.action.reasoning).toContain('LOOP DETECTED');
    expect(step.timestamp).toBeDefined();
  });
});
