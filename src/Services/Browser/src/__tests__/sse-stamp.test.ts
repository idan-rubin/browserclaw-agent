import { describe, it, expect } from 'vitest';
import { stampSSEPayload } from '../sse-stamp.js';
import type { SSEEvent } from '../api-types.js';

describe('stampSSEPayload', () => {
  it('payload `type` cannot clobber the SSE channel type', () => {
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

  it('payload `apiVersion` cannot clobber the canonical version', () => {
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

describe('new SSE event payloads', () => {
  it('domain_blocked carries domain, reason, and attempt', () => {
    const stamped = stampSSEPayload('domain_blocked', {
      domain: 'evil.example.com',
      reason: 'wall',
      attempt: 2,
    }) as unknown as Extract<SSEEvent, { type: 'domain_blocked' }>;
    expect(stamped.type).toBe('domain_blocked');
    expect(stamped.apiVersion).toBe(1);
    expect(stamped.domain).toBe('evil.example.com');
    expect(stamped.reason).toBe('wall');
    expect(stamped.attempt).toBe(2);
  });

  it('skill_skipped carries domain and reason', () => {
    const stamped = stampSSEPayload('skill_skipped', {
      domain: 'streeteasy.com',
      reason: 'task does not match playbook',
    }) as unknown as Extract<SSEEvent, { type: 'skill_skipped' }>;
    expect(stamped.type).toBe('skill_skipped');
    expect(stamped.apiVersion).toBe(1);
    expect(stamped.domain).toBe('streeteasy.com');
    expect(stamped.reason).toBe('task does not match playbook');
  });

  it('context_compress_failed carries step and error', () => {
    const stamped = stampSSEPayload('context_compress_failed', {
      step: 17,
      error: 'rate limited',
    }) as unknown as Extract<SSEEvent, { type: 'context_compress_failed' }>;
    expect(stamped.type).toBe('context_compress_failed');
    expect(stamped.apiVersion).toBe(1);
    expect(stamped.step).toBe(17);
    expect(stamped.error).toBe('rate limited');
  });

  it('user_interjection_timeout carries step and question', () => {
    const stamped = stampSSEPayload('user_interjection_timeout', {
      step: 4,
      question: 'Which apartment do you want?',
    }) as unknown as Extract<SSEEvent, { type: 'user_interjection_timeout' }>;
    expect(stamped.type).toBe('user_interjection_timeout');
    expect(stamped.apiVersion).toBe(1);
    expect(stamped.step).toBe(4);
    expect(stamped.question).toBe('Which apartment do you want?');
  });

  it('payload `type` cannot clobber the channel type for new events', () => {
    const stamped = stampSSEPayload('domain_blocked', {
      domain: 'a.com',
      reason: 'r',
      attempt: 1,
      type: 'malicious_override',
    });
    expect(stamped.type).toBe('domain_blocked');
  });
});
