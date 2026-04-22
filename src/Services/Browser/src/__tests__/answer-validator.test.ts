import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AnswerSchema } from '../answer-validator.js';

vi.mock('../llm.js', () => ({
  llmJson: vi.fn(),
}));
vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { extractSchema, validateAnswer } = await import('../answer-validator.js');
const { llmJson } = await import('../llm.js');
const mockedLlmJson = vi.mocked(llmJson);

describe('extractSchema', () => {
  beforeEach(() => {
    mockedLlmJson.mockReset();
  });

  it('maps null priceCap and location to undefined', async () => {
    mockedLlmJson.mockResolvedValue({
      isListTask: false,
      count: 1,
      requiredFields: [],
      priceCap: null,
      priceCapInclusive: false,
      location: null,
    });
    const schema = await extractSchema('anything');
    expect(schema.priceCap).toBeUndefined();
    expect(schema.location).toBeUndefined();
  });

  it('passes through priceCap, priceCapInclusive, location, and requiredFields', async () => {
    mockedLlmJson.mockResolvedValue({
      isListTask: true,
      count: 5,
      requiredFields: ['price', 'address'],
      priceCap: 3000,
      priceCapInclusive: true,
      location: 'Chelsea',
    });
    const schema = await extractSchema('find 5 apartments');
    expect(schema).toEqual({
      isListTask: true,
      count: 5,
      requiredFields: ['price', 'address'],
      priceCap: 3000,
      priceCapInclusive: true,
      location: 'Chelsea',
    });
  });

  it('returns safe defaults when the LLM call throws', async () => {
    mockedLlmJson.mockRejectedValue(new Error('llm down'));
    const schema = await extractSchema('anything');
    expect(schema).toEqual({
      isListTask: false,
      count: 1,
      requiredFields: [],
      priceCapInclusive: false,
    });
  });
});

describe('validateAnswer', () => {
  const listSchema = (overrides?: Partial<AnswerSchema>): AnswerSchema => ({
    isListTask: true,
    count: 3,
    requiredFields: [],
    priceCapInclusive: false,
    ...overrides,
  });

  it('returns valid for non-list tasks regardless of content', () => {
    const schema: AnswerSchema = {
      isListTask: false,
      count: 1,
      requiredFields: ['price'],
      priceCap: 100,
      priceCapInclusive: false,
      location: 'Chelsea',
    };
    expect(validateAnswer(schema, 'no markers, no price, no location').valid).toBe(true);
  });

  it('counts numbered items with both "." and ")" forms', () => {
    const answer = '1. First\n2) Second\n3. Third';
    const result = validateAnswer(listSchema({ count: 3 }), answer);
    expect(result.valid).toBe(true);
  });

  it('counts bulleted items with "-" and "*"', () => {
    const answer = '- One\n* Two\n- Three';
    const result = validateAnswer(listSchema({ count: 3 }), answer);
    expect(result.valid).toBe(true);
  });

  it('flags too few items', () => {
    const result = validateAnswer(listSchema({ count: 5 }), '1. One\n2. Two');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Expected 5 items, found 2');
  });

  it('does not flag extra items beyond the requested count', () => {
    const answer = '1. One\n2. Two\n3. Three\n4. Four';
    const result = validateAnswer(listSchema({ count: 3 }), answer);
    expect(result.valid).toBe(true);
  });

  it('flags a missing required field', () => {
    const schema = listSchema({ count: 1, requiredFields: ['price', 'address'] });
    const answer = '1. Luxury unit — address: 42 Main St';
    const result = validateAnswer(schema, answer);
    expect(result.errors).toContain('Required field "price" not mentioned in the answer');
    expect(result.errors).not.toContain('Required field "address" not mentioned in the answer');
  });

  it('matches required fields case-insensitively', () => {
    const schema = listSchema({ count: 1, requiredFields: ['Price'] });
    const result = validateAnswer(schema, '1. Listed PRICE is $2400');
    expect(result.valid).toBe(true);
  });

  it('exclusive price cap: rejects prices equal to the cap', () => {
    const schema = listSchema({ count: 1, priceCap: 3000, priceCapInclusive: false });
    const result = validateAnswer(schema, '1. $3000 apartment');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('1 price(s) violate the cap ($3000 strict)');
  });

  it('exclusive price cap: accepts prices under the cap', () => {
    const schema = listSchema({ count: 1, priceCap: 3000, priceCapInclusive: false });
    const result = validateAnswer(schema, '1. $2999 apartment');
    expect(result.valid).toBe(true);
  });

  it('inclusive price cap: accepts prices equal to the cap', () => {
    const schema = listSchema({ count: 1, priceCap: 3000, priceCapInclusive: true });
    const result = validateAnswer(schema, '1. $3000 apartment');
    expect(result.valid).toBe(true);
  });

  it('inclusive price cap: rejects prices over the cap', () => {
    const schema = listSchema({ count: 1, priceCap: 3000, priceCapInclusive: true });
    const result = validateAnswer(schema, '1. $3001 apartment');
    expect(result.valid).toBe(false);
  });

  it('handles comma-separated prices', () => {
    const schema = listSchema({ count: 1, priceCap: 3000, priceCapInclusive: false });
    const result = validateAnswer(schema, '1. $3,500 apartment');
    expect(result.valid).toBe(false);
  });

  it('strips "under $X" / "up to $X" narrative context before checking the cap', () => {
    const schema = listSchema({ count: 2, priceCap: 3000, priceCapInclusive: false });
    const answer = 'All under $3000. Listings:\n1. $2500 studio\n2. Larger unit at $2800';
    const result = validateAnswer(schema, answer);
    expect(result.valid).toBe(true);
  });

  it('strips multiple context-price prefixes', () => {
    const schema = listSchema({ count: 1, priceCap: 5000, priceCapInclusive: false });
    const answer = 'Less than $5000 cap, at most $4999.\n1. Found at $4500.';
    const result = validateAnswer(schema, answer);
    expect(result.valid).toBe(true);
  });

  it('reports every offending price in the error message', () => {
    const schema = listSchema({ count: 2, priceCap: 1000, priceCapInclusive: false });
    const answer = '1. $1500\n2. $2000';
    const result = validateAnswer(schema, answer);
    expect(result.errors[0]).toContain('2 price(s) violate');
    expect(result.errors[0]).toContain('$1500');
    expect(result.errors[0]).toContain('$2000');
  });

  it('flags a missing location', () => {
    const schema = listSchema({ count: 1, location: 'Chelsea' });
    const result = validateAnswer(schema, '1. Loft in SoHo');
    expect(result.errors).toContain('Required location "Chelsea" not mentioned in the answer');
  });

  it('matches location case-insensitively', () => {
    const schema = listSchema({ count: 1, location: 'Chelsea' });
    const result = validateAnswer(schema, '1. Loft in CHELSEA');
    expect(result.valid).toBe(true);
  });

  it('accumulates multiple errors', () => {
    const schema = listSchema({
      count: 3,
      requiredFields: ['price'],
      priceCap: 1000,
      priceCapInclusive: false,
      location: 'Chelsea',
    });
    const result = validateAnswer(schema, '1. Loft $1500 in SoHo');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(4);
  });
});
