import { describe, it, expect } from 'vitest';
import OpenAI from 'openai';
import { extractProviderError, extractProviderMessage, isFailFastError } from '../llm.js';

function makeAPIError(
  status: number,
  body: Record<string, unknown> | undefined,
  message: string,
): InstanceType<typeof OpenAI.APIError> {
  return new OpenAI.APIError(status, body, message, undefined);
}

describe('extractProviderError', () => {
  it('extracts OpenAI SDK quota error with status and body message', () => {
    const body = {
      message: 'You exceeded your current quota, please check your plan and billing details.',
      type: 'insufficient_quota',
      code: 'insufficient_quota',
    };
    const err = makeAPIError(
      429,
      body,
      '429 You exceeded your current quota, please check your plan and billing details.',
    );
    const result = extractProviderError(err);
    expect(result).toEqual({
      status: 429,
      message: 'You exceeded your current quota, please check your plan and billing details.',
    });
  });

  it('falls back to message (without status prefix) when SDK body has no message', () => {
    const err = makeAPIError(401, undefined, '401 Unauthorized');
    expect(extractProviderError(err)).toEqual({ status: 401, message: 'Unauthorized' });
  });

  it('handles plain-text "<status> <message>" thrown as Error', () => {
    const err = new Error('429 You exceeded your current quota, please check your plan and billing details.');
    expect(extractProviderError(err)).toEqual({
      status: 429,
      message: 'You exceeded your current quota, please check your plan and billing details.',
    });
  });

  it('handles JSON-bodied errors with leading status', () => {
    const err = new Error('400 {"error": {"message": "Invalid model"}}');
    expect(extractProviderError(err)).toEqual({ status: 400, message: 'Invalid model' });
  });

  it('handles JSON-bodied errors without leading status', () => {
    const err = new Error('Bad: {"error": "model not found"}');
    expect(extractProviderError(err)).toEqual({ status: null, message: 'model not found' });
  });

  it('returns null for arbitrary Error without recognizable shape', () => {
    expect(extractProviderError(new Error('something blew up'))).toBeNull();
  });

  it('returns null for non-Error values', () => {
    expect(extractProviderError('boom')).toBeNull();
    expect(extractProviderError(null)).toBeNull();
    expect(extractProviderError(undefined)).toBeNull();
  });
});

describe('extractProviderMessage', () => {
  it('returns the message string for SDK errors', () => {
    const err = makeAPIError(429, { message: 'quota exhausted' }, '429 quota exhausted');
    expect(extractProviderMessage(err)).toBe('quota exhausted');
  });

  it('returns null when no provider error can be extracted', () => {
    expect(extractProviderMessage(new Error('regular error'))).toBeNull();
  });
});

describe('isFailFastError', () => {
  it('flags OpenAI SDK 401 as fail-fast', () => {
    const err = makeAPIError(401, { message: 'bad key' }, '401 bad key');
    expect(isFailFastError(err)).toBe(true);
  });

  it('flags OpenAI SDK 403 as fail-fast', () => {
    const err = makeAPIError(403, { message: 'forbidden' }, '403 forbidden');
    expect(isFailFastError(err)).toBe(true);
  });

  it('flags OpenAI SDK insufficient_quota body code as fail-fast', () => {
    const err = makeAPIError(429, { message: 'quota', code: 'insufficient_quota' }, '429 quota');
    expect(isFailFastError(err)).toBe(true);
  });

  it('does NOT flag plain 429 rate-limit as fail-fast', () => {
    const err = makeAPIError(429, { message: 'slow down', code: 'rate_limit_exceeded' }, '429 slow down');
    expect(isFailFastError(err)).toBe(false);
  });

  it('flags plain-text 401 message as fail-fast', () => {
    expect(isFailFastError(new Error('401 Unauthorized'))).toBe(true);
  });

  it('flags insufficient_quota in raw message as fail-fast', () => {
    expect(isFailFastError(new Error('insufficient_quota: you ran out'))).toBe(true);
  });
});
