import { describe, it, expect } from 'vitest';
import { stampSSEPayload } from '../sse-stamp.js';

describe('stampSSEPayload', () => {
  it('preserves the SSE channel type even when payload carries its own `type` field (codex review regression)', () => {
    // Regression for the bug caught by codex review on PR #139:
    // `{ type: event, ...data }` let a payload's inner `type` clobber the
    // channel name. The contract is that the SSE channel `type` always
    // matches the event tag.
    const stamped = stampSSEPayload('step_error', {
      step: 3,
      error: 'bad',
      error_kind: 'parse_error',
      type: 'inner_should_not_win',
    });
    expect(stamped.type).toBe('step_error');
    expect(stamped.error_kind).toBe('parse_error');
  });

  it('stamps every event with apiVersion: 1', () => {
    const stamped = stampSSEPayload('thinking', { step: 1, message: 'hi' });
    expect(stamped.apiVersion).toBe(1);
    expect(stamped.type).toBe('thinking');
  });

  it('payload `apiVersion` cannot clobber the canonical version either', () => {
    const stamped = stampSSEPayload('step', { step: 1, apiVersion: 999 });
    expect(stamped.apiVersion).toBe(1);
  });

  it('wraps non-object payloads in { value }', () => {
    const stamped = stampSSEPayload('completed', 'all done');
    expect(stamped.type).toBe('completed');
    expect(stamped.value).toBe('all done');
    expect(stamped.apiVersion).toBe(1);
  });

  it('handles null payload as a primitive', () => {
    const stamped = stampSSEPayload('failed', null);
    expect(stamped.type).toBe('failed');
    expect(stamped.value).toBeNull();
  });
});
