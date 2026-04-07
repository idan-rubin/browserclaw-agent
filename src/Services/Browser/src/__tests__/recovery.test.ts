import { describe, it, expect } from 'vitest';
import { diagnoseStuckAgent, formatRecovery } from '../skills/recovery.js';
import type { AgentStep } from '../types.js';

function makeStep(
  overrides: Partial<AgentStep['action']> & { action: string },
  step = 0,
  url = 'https://example.com',
): AgentStep {
  return {
    step,
    action: { reasoning: 'test', ...overrides } as AgentStep['action'],
    url,
    page_title: 'Test',
    timestamp: new Date().toISOString(),
  };
}

describe('diagnoseStuckAgent', () => {
  it('returns null for short history', () => {
    const history = [makeStep({ action: 'click', ref: '1' })];
    expect(diagnoseStuckAgent(history, 'https://example.com')).toBeNull();
  });

  it('returns null when agent is making progress', () => {
    const history = [
      makeStep({ action: 'click', ref: '1' }, 0),
      makeStep({ action: 'type', ref: '2', text: 'hello' }, 1),
      makeStep({ action: 'click', ref: '3' }, 2),
      makeStep({ action: 'scroll', direction: 'down' }, 3),
      makeStep({ action: 'click', ref: '4' }, 4),
      makeStep({ action: 'type', ref: '5', text: 'world' }, 5),
      makeStep({ action: 'click', ref: '6' }, 6),
    ];
    expect(diagnoseStuckAgent(history, 'https://example.com')).toBeNull();
  });

  // --- detectAlternatingFailures ---

  it('detects alternating failures', () => {
    const history = Array.from({ length: 8 }, (_, i) =>
      makeStep({ action: i % 2 === 0 ? 'click' : 'type', ref: String(i), error_feedback: 'failed' }, i),
    );
    const result = diagnoseStuckAgent(history, 'https://example.com');
    expect(result).not.toBeNull();
    expect(result?.diagnosis).toContain('alternating');
  });

  it('does not fire alternating failures with fewer than 5 errors', () => {
    const history = [
      makeStep({ action: 'click', ref: '1', error_feedback: 'failed' }, 0, 'https://a.com'),
      makeStep({ action: 'type', ref: '2', error_feedback: 'failed' }, 1, 'https://b.com'),
      makeStep({ action: 'click', ref: '3', error_feedback: 'failed' }, 2, 'https://c.com'),
      makeStep({ action: 'type', ref: '4', error_feedback: 'failed' }, 3, 'https://d.com'),
      makeStep({ action: 'click', ref: '5' }, 4, 'https://e.com'), // success
      makeStep({ action: 'navigate', url: 'https://other.com' }, 5, 'https://f.com'),
      makeStep({ action: 'click', ref: '6' }, 6, 'https://g.com'),
    ];
    expect(diagnoseStuckAgent(history, 'https://g.com')).toBeNull();
  });

  // --- detectScatterClicks ---

  it('detects scatter clicks', () => {
    const history = [
      makeStep({ action: 'scroll', direction: 'down' }, 0),
      makeStep({ action: 'scroll', direction: 'down' }, 1),
      makeStep({ action: 'click', ref: '10', error_feedback: 'not found' }, 2),
      makeStep({ action: 'click', ref: '11', error_feedback: 'not found' }, 3),
      makeStep({ action: 'click', ref: '12', error_feedback: 'not found' }, 4),
      makeStep({ action: 'click', ref: '13', error_feedback: 'not found' }, 5),
      makeStep({ action: 'scroll', direction: 'down' }, 6),
    ];
    const result = diagnoseStuckAgent(history, 'https://example.com');
    expect(result).not.toBeNull();
    expect(result?.diagnosis).toContain('click attempts');
  });

  it('does not fire scatter clicks when clicks succeed', () => {
    const history = [
      makeStep({ action: 'click', ref: '10' }, 0),
      makeStep({ action: 'click', ref: '11' }, 1),
      makeStep({ action: 'click', ref: '12' }, 2),
      makeStep({ action: 'click', ref: '13' }, 3),
      makeStep({ action: 'click', ref: '14' }, 4),
      makeStep({ action: 'click', ref: '15' }, 5),
      makeStep({ action: 'scroll', direction: 'down' }, 6),
    ];
    expect(diagnoseStuckAgent(history, 'https://example.com')).toBeNull();
  });

  // --- detectSearchWithoutResults ---

  it('detects repeated search without clicking results', () => {
    const history = [
      makeStep({ action: 'click', ref: '5' }, 0),
      makeStep({ action: 'type', ref: '3', text: 'apartments' }, 1),
      makeStep({ action: 'scroll', direction: 'down' }, 2),
      makeStep({ action: 'type', ref: '3', text: 'apartments Chelsea' }, 3),
      makeStep({ action: 'scroll', direction: 'down' }, 4),
      makeStep({ action: 'type', ref: '3', text: 'Chelsea apartments' }, 5),
      makeStep({ action: 'scroll', direction: 'down' }, 6),
    ];
    const result = diagnoseStuckAgent(history, 'https://example.com');
    expect(result).not.toBeNull();
    expect(result?.diagnosis).toContain('search queries');
  });

  it('does not fire for multi-field form filling (different refs)', () => {
    const history = [
      makeStep({ action: 'click', ref: '1' }, 0),
      makeStep({ action: 'type', ref: '2', text: 'John' }, 1),
      makeStep({ action: 'type', ref: '3', text: 'Doe' }, 2),
      makeStep({ action: 'type', ref: '4', text: 'john@example.com' }, 3),
      makeStep({ action: 'type', ref: '5', text: '555-1234' }, 4),
      makeStep({ action: 'click', ref: '6' }, 5),
      makeStep({ action: 'scroll', direction: 'down' }, 6),
    ];
    expect(diagnoseStuckAgent(history, 'https://example.com')).toBeNull();
  });

  // --- detectStagnation ---

  it('detects stagnation on same URL with errors', () => {
    const url = 'https://example.com/page';
    // 4+ distinct action types avoids detectAlternatingFailures (which requires ≤3 types)
    const history = [
      makeStep({ action: 'click', ref: '1', error_feedback: 'failed' }, 0, url),
      makeStep({ action: 'scroll', direction: 'down', error_feedback: 'failed' }, 1, url),
      makeStep({ action: 'type', ref: '2', text: 'a', error_feedback: 'failed' }, 2, url),
      makeStep({ action: 'keyboard', key: 'Escape', error_feedback: 'failed' }, 3, url),
      makeStep({ action: 'click', ref: '3', error_feedback: 'failed' }, 4, url),
      makeStep({ action: 'scroll', direction: 'down', error_feedback: 'failed' }, 5, url),
      makeStep({ action: 'type', ref: '4', text: 'b', error_feedback: 'failed' }, 6, url),
      makeStep({ action: 'keyboard', key: 'Tab', error_feedback: 'failed' }, 7, url),
    ];
    const result = diagnoseStuckAgent(history, url);
    expect(result).not.toBeNull();
    expect(result?.diagnosis).toContain('same page');
  });

  it('does not fire stagnation when errors are absent', () => {
    const url = 'https://example.com/form';
    const history = [
      makeStep({ action: 'click', ref: '1' }, 0, url),
      makeStep({ action: 'type', ref: '2', text: 'a' }, 1, url),
      makeStep({ action: 'type', ref: '3', text: 'b' }, 2, url),
      makeStep({ action: 'type', ref: '4', text: 'c' }, 3, url),
      makeStep({ action: 'click', ref: '5' }, 4, url),
      makeStep({ action: 'scroll', direction: 'down' }, 5, url),
      makeStep({ action: 'click', ref: '6' }, 6, url),
      makeStep({ action: 'type', ref: '7', text: 'd' }, 7, url),
    ];
    expect(diagnoseStuckAgent(history, url)).toBeNull();
  });

  // --- detectNavigationLoop ---

  it('detects A-B-A-B navigation loop', () => {
    const history = [
      makeStep({ action: 'click', ref: '1' }, 0, 'https://a.com'),
      makeStep({ action: 'click', ref: '2' }, 1, 'https://b.com'),
      makeStep({ action: 'click', ref: '3' }, 2, 'https://a.com'),
      makeStep({ action: 'click', ref: '4' }, 3, 'https://b.com'),
      makeStep({ action: 'click', ref: '5' }, 4, 'https://a.com'),
      makeStep({ action: 'click', ref: '6' }, 5, 'https://b.com'),
    ];
    const result = diagnoseStuckAgent(history, 'https://b.com');
    expect(result).not.toBeNull();
    expect(result?.diagnosis).toContain('back and forth');
  });

  it('detects revisiting same URL 3+ times', () => {
    const history = [
      makeStep({ action: 'click', ref: '1' }, 0, 'https://a.com'),
      makeStep({ action: 'click', ref: '2' }, 1, 'https://b.com'),
      makeStep({ action: 'click', ref: '3' }, 2, 'https://c.com'),
      makeStep({ action: 'click', ref: '4' }, 3, 'https://a.com'),
      makeStep({ action: 'click', ref: '5' }, 4, 'https://d.com'),
      makeStep({ action: 'click', ref: '6' }, 5, 'https://a.com'),
    ];
    const result = diagnoseStuckAgent(history, 'https://a.com');
    expect(result).not.toBeNull();
    expect(result?.diagnosis).toContain('3+ times');
  });

  it('does not fire navigation loop when URLs are diverse', () => {
    const history = [
      makeStep({ action: 'click', ref: '1' }, 0, 'https://a.com'),
      makeStep({ action: 'click', ref: '2' }, 1, 'https://b.com'),
      makeStep({ action: 'click', ref: '3' }, 2, 'https://c.com'),
      makeStep({ action: 'click', ref: '4' }, 3, 'https://d.com'),
      makeStep({ action: 'click', ref: '5' }, 4, 'https://e.com'),
      makeStep({ action: 'click', ref: '6' }, 5, 'https://f.com'),
    ];
    expect(diagnoseStuckAgent(history, 'https://f.com')).toBeNull();
  });
});

describe('formatRecovery', () => {
  it('formats a recovery strategy as a message', () => {
    const msg = formatRecovery({
      diagnosis: 'You are stuck.',
      suggestions: ['Try A', 'Try B'],
    });
    expect(msg).toContain('RECOVERY NEEDED');
    expect(msg).toContain('You are stuck.');
    expect(msg).toContain('Try A');
    expect(msg).toContain('Try B');
  });
});
