import { describe, it, expect } from 'vitest';
import { detectLoop } from '../skills/loop-detection.js';
import type { AgentStep } from '../types.js';

function makeStep(action: string, ref?: string, step = 0, url = 'https://example.com'): AgentStep {
  return {
    step,
    action: { action: action as AgentStep['action']['action'], reasoning: 'test', ref },
    url,
    page_title: 'Test',
    timestamp: new Date().toISOString(),
  };
}

function makeFailedStep(action: string, ref?: string, step = 0): AgentStep {
  return {
    step,
    action: {
      action: action as AgentStep['action']['action'],
      reasoning: 'test',
      ref,
      error_feedback: 'Element not found or not visible',
    },
    url: 'https://example.com',
    page_title: 'Test',
    timestamp: new Date().toISOString(),
  };
}

describe('detectLoop', () => {
  it('returns null for short history', () => {
    expect(detectLoop({ action: 'click', ref: '5' }, [])).toBeNull();
    expect(detectLoop({ action: 'click', ref: '5' }, [makeStep('click', '5')])).toBeNull();
  });

  it('returns null when actions are varied', () => {
    const history = [
      makeStep('click', '5', 0),
      makeStep('type', '3', 1),
      makeStep('navigate', undefined, 2),
      makeStep('scroll', undefined, 3),
      makeStep('click', '7', 4),
    ];
    expect(detectLoop({ action: 'click', ref: '5' }, history)).toBeNull();
  });

  it('returns gentle nudge at 5 repetitions', () => {
    const history = Array.from({ length: 5 }, (_, i) => makeStep('click', '5', i));
    const nudge = detectLoop({ action: 'click', ref: '5' }, history);
    expect(nudge).toEqual(expect.objectContaining({ level: 'gentle' }));
  });

  it('returns warning nudge at 8 repetitions', () => {
    const history = Array.from({ length: 8 }, (_, i) => makeStep('click', '5', i));
    const nudge = detectLoop({ action: 'click', ref: '5' }, history);
    expect(nudge).toEqual(expect.objectContaining({ level: 'warning' }));
  });

  it('returns urgent nudge at 12 repetitions', () => {
    const history = Array.from({ length: 12 }, (_, i) => makeStep('click', '5', i));
    const nudge = detectLoop({ action: 'click', ref: '5' }, history);
    expect(nudge).toEqual(expect.objectContaining({ level: 'urgent' }));
  });

  it('distinguishes actions by ref', () => {
    const history = [
      makeStep('click', '5', 0, 'https://example.com/a'),
      makeStep('click', '6', 1, 'https://example.com/b'),
      makeStep('click', '5', 2, 'https://example.com/c'),
      makeStep('click', '6', 3, 'https://example.com/d'),
      makeStep('click', '5', 4, 'https://example.com/e'),
    ];
    // click:5 appears 3 times, click:6 appears 2 times — neither hits threshold
    expect(detectLoop({ action: 'click', ref: '5' }, history)).toBeNull();
  });

  it('detects stagnant page with few actions', () => {
    const history = [
      makeStep('scroll', undefined, 0, 'https://example.com/page'),
      makeStep('scroll', undefined, 1, 'https://example.com/page'),
      makeStep('scroll', undefined, 2, 'https://example.com/page'),
      makeStep('scroll', undefined, 3, 'https://example.com/page'),
      makeStep('scroll', undefined, 4, 'https://example.com/page'),
    ];
    const nudge = detectLoop({ action: 'scroll' }, history);
    // Could be either stagnant-page warning or repetition nudge
    expect(nudge).toEqual(expect.objectContaining({ level: 'gentle' }));
  });

  it('no stagnant detection when URLs differ', () => {
    const history = [
      makeStep('click', '1', 0, 'https://example.com/a'),
      makeStep('click', '2', 1, 'https://example.com/b'),
      makeStep('click', '3', 2, 'https://example.com/c'),
      makeStep('click', '4', 3, 'https://example.com/d'),
      makeStep('click', '5', 4, 'https://example.com/e'),
    ];
    expect(detectLoop({ action: 'click', ref: '6' }, history)).toBeNull();
  });

  it('fires urgently after two consecutive failed attempts on the same ref', () => {
    const history = [makeFailedStep('click', 'e3783', 0), makeFailedStep('click', 'e3783', 1)];
    const nudge = detectLoop({ action: 'click', ref: 'e3783' }, history);
    expect(nudge).toEqual(expect.objectContaining({ level: 'urgent' }));
    expect(nudge?.message).toContain('e3783');
  });

  it('does not fire fast-path when only one of the last two failed', () => {
    const history = [makeFailedStep('click', 'e3783', 0), makeStep('click', 'e3783', 1)];
    expect(detectLoop({ action: 'click', ref: 'e3783' }, history)).toBeNull();
  });

  it('does not fire fast-path when previous failures targeted a different ref', () => {
    const history = [makeFailedStep('click', 'other', 0), makeFailedStep('click', 'e3783', 1)];
    expect(detectLoop({ action: 'click', ref: 'e3783' }, history)).toBeNull();
  });

  it('does not fire fast-path on refless actions', () => {
    const history = [makeFailedStep('scroll', undefined, 0), makeFailedStep('scroll', undefined, 1)];
    expect(detectLoop({ action: 'scroll' }, history)).toBeNull();
  });

  it('fires urgently on two consecutive web_search calls', () => {
    const history = [makeStep('web_search', undefined, 0)];
    const nudge = detectLoop({ action: 'web_search' }, history);
    expect(nudge).toEqual(expect.objectContaining({ level: 'urgent' }));
  });

  it('does not fire web_search rule when previous action was different', () => {
    const history = [makeStep('navigate', undefined, 0)];
    expect(detectLoop({ action: 'web_search' }, history)).toBeNull();
  });

  it('fires urgently on three consecutive back actions (back-loop)', () => {
    const history = [makeStep('back', undefined, 0), makeStep('back', undefined, 1)];
    const nudge = detectLoop({ action: 'back' }, history);
    expect(nudge).toEqual(expect.objectContaining({ level: 'urgent' }));
  });

  it('does not fire back-loop rule when only two back actions have happened', () => {
    const history = [makeStep('navigate', undefined, 0), makeStep('back', undefined, 1)];
    expect(detectLoop({ action: 'back' }, history)).toBeNull();
  });
});
