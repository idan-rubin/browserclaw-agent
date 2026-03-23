import { describe, it, expect } from 'vitest';
import { parseJsonResponse } from '../parse-json-response.js';

describe('parseJsonResponse', () => {
  it('parses plain JSON', () => {
    const result = parseJsonResponse('{"action": "click"}');
    expect(result).toEqual({ action: 'click' });
  });

  it('parses JSON wrapped in markdown code fences', () => {
    const input = '```json\n{"action": "click", "ref": "42"}\n```';
    const result = parseJsonResponse(input);
    expect(result).toEqual({ action: 'click', ref: '42' });
  });

  it('parses JSON wrapped in code fences without language tag', () => {
    const input = '```\n{"action": "done"}\n```';
    const result = parseJsonResponse(input);
    expect(result).toEqual({ action: 'done' });
  });

  it('handles trailing text after valid JSON', () => {
    const input = '{"action": "click", "ref": "5"} I hope this helps!';
    const result = parseJsonResponse(input);
    expect(result).toEqual({ action: 'click', ref: '5' });
  });

  it('handles leading text before JSON object', () => {
    const input = 'Here is my response: {"action": "navigate", "url": "https://example.com"}';
    const result = parseJsonResponse(input);
    expect(result).toEqual({ action: 'navigate', url: 'https://example.com' });
  });

  it('handles nested JSON objects', () => {
    const input = '{"action": "click", "meta": {"nested": true}}';
    const result = parseJsonResponse(input);
    expect(result).toEqual({ action: 'click', meta: { nested: true } });
  });

  it('handles strings with escaped quotes', () => {
    const input = '{"reasoning": "Click the \\"Submit\\" button"}';
    const result = parseJsonResponse(input);
    expect(result).toEqual({ reasoning: 'Click the "Submit" button' });
  });

  it('handles strings containing braces', () => {
    const input = '{"text": "function() { return {} }"}';
    const result = parseJsonResponse(input);
    expect(result).toEqual({ text: 'function() { return {} }' });
  });

  it('throws on empty input', () => {
    expect(() => parseJsonResponse('')).toThrow();
  });

  it('throws on input with no JSON object', () => {
    expect(() => parseJsonResponse('This is just plain text')).toThrow('No JSON object found');
  });

  it('throws on unterminated JSON', () => {
    expect(() => parseJsonResponse('{"action": "click"')).toThrow('Unterminated JSON object');
  });

  it('handles whitespace around JSON', () => {
    const input = '  \n  {"action": "done"}  \n  ';
    const result = parseJsonResponse(input);
    expect(result).toEqual({ action: 'done' });
  });

  it('handles JSON with arrays', () => {
    const input = '{"options": ["a", "b", "c"]}';
    const result = parseJsonResponse(input);
    expect(result).toEqual({ options: ['a', 'b', 'c'] });
  });

  it('handles JSON with null values', () => {
    const input = '{"ref": null, "action": "scroll"}';
    const result = parseJsonResponse(input);
    expect(result).toEqual({ ref: null, action: 'scroll' });
  });
});
