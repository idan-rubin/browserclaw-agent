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
  it('extracts OpenAI SDK 429 quota error with body message', () => {
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
    expect(extractProviderError(err)).toEqual({
      status: 429,
      message: 'You exceeded your current quota, please check your plan and billing details.',
    });
  });

  it('extracts OpenAI SDK 401 auth error with body message', () => {
    const body = { message: 'Incorrect API key provided.', type: 'invalid_request_error', code: 'invalid_api_key' };
    const err = makeAPIError(401, body, '401 Incorrect API key provided.');
    expect(extractProviderError(err)).toEqual({
      status: 401,
      message: 'Incorrect API key provided.',
    });
  });

  it('extracts OpenAI SDK 403 permission error with body message', () => {
    const body = { message: 'You do not have access to this resource.', type: 'permission_error' };
    const err = makeAPIError(403, body, '403 You do not have access to this resource.');
    expect(extractProviderError(err)).toEqual({
      status: 403,
      message: 'You do not have access to this resource.',
    });
  });

  it('falls back to SDK message (status prefix stripped) when body has no message', () => {
    const err = makeAPIError(401, undefined, '401 Unauthorized');
    expect(extractProviderError(err)).toEqual({ status: 401, message: 'Unauthorized' });
  });

  it('handles plain-text "<status> <message>" Error (raw fetch path)', () => {
    const err = new Error('429 You exceeded your current quota, please check your plan and billing details.');
    expect(extractProviderError(err)).toEqual({
      status: 429,
      message: 'You exceeded your current quota, please check your plan and billing details.',
    });
  });

  it('handles JSON-bodied error with leading status', () => {
    const err = new Error('400 {"error": {"message": "Invalid model"}}');
    expect(extractProviderError(err)).toEqual({ status: 400, message: 'Invalid model' });
  });

  it('handles JSON-bodied error without leading status', () => {
    const err = new Error('Bad: {"error": "model not found"}');
    expect(extractProviderError(err)).toEqual({ status: null, message: 'model not found' });
  });

  it('returns null for unknown Error so caller falls through to generic message', () => {
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
  it('flags plain-text 401 message as fail-fast', () => {
    expect(isFailFastError(new Error('401 Unauthorized'))).toBe(true);
  });

  it('flags insufficient_quota in raw message as fail-fast', () => {
    expect(isFailFastError(new Error('insufficient_quota: you ran out'))).toBe(true);
  });
});
