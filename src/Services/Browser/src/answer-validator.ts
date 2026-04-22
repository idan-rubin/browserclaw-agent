import { llmJson, sanitizeErrorText } from './llm.js';
import { logger } from './logger.js';

export interface AnswerSchema {
  isListTask: boolean;
  count: number;
  requiredFields: string[];
  priceCap?: number;
  priceCapInclusive?: boolean;
  location?: string;
}

const SCHEMA_PROMPT = `You analyze a user's browser task and extract the machine-checkable output contract.

Respond with JSON matching this shape:
{
  "isListTask": boolean,
  "count": number,
  "requiredFields": string[],
  "priceCap": number | null,
  "priceCapInclusive": boolean,
  "location": string | null
}

Rules:
- isListTask = true when the user asks for a list of N items with per-item fields
- count = the N requested (default 1 for single-item tasks)
- requiredFields = field names the user explicitly mentions per-item (e.g. "price, address, available units" → ["price","address","units"])
- priceCap = numeric value if the user bounds price (null if no price constraint)
- priceCapInclusive = false when the user says "under X" / "less than X"; true for "at or below X" / "up to X"
- location = the specific location the user requested (null if not location-specific)`;

export async function extractSchema(prompt: string): Promise<AnswerSchema> {
  try {
    const schema = await llmJson<{
      isListTask: boolean;
      count: number;
      requiredFields: string[];
      priceCap: number | null;
      priceCapInclusive: boolean;
      location: string | null;
    }>({
      system: SCHEMA_PROMPT,
      message: `Task: ${prompt}`,
      maxTokens: 200,
    });
    return {
      isListTask: schema.isListTask,
      count: schema.count,
      requiredFields: schema.requiredFields,
      priceCap: schema.priceCap ?? undefined,
      priceCapInclusive: schema.priceCapInclusive,
      location: schema.location ?? undefined,
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? sanitizeErrorText(err.message) : 'unknown' }, 'Schema extraction failed');
    return { isListTask: false, count: 1, requiredFields: [], priceCapInclusive: false };
  }
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function parsePrice(text: string): number | null {
  const match = /\$?\s?([\d,]+(?:\.\d+)?)/.exec(text);
  if (!match) return null;
  const num = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(num) ? num : null;
}

function countItems(answer: string): number {
  const matches = answer.match(/^\s*(?:\d+[.)]|[-*])\s+/gm);
  return matches?.length ?? 0;
}

const CONTEXT_PRICE_RE = /(?:under|below|less than|up to|at most|max(?:imum)?|cap(?:ped at)?)\s+\$?\s?[\d,]+/gi;

function collectPrices(answer: string): number[] {
  const stripped = answer.replace(CONTEXT_PRICE_RE, '');
  const re = /\$\s?([\d,]+(?:\.\d+)?)/g;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const p = parsePrice(m[0]);
    if (p !== null) out.push(p);
  }
  return out;
}

export function validateAnswer(schema: AnswerSchema, answer: string): ValidationResult {
  if (!schema.isListTask) return { valid: true, errors: [] };
  const errors: string[] = [];

  const itemCount = countItems(answer);
  if (itemCount < schema.count) {
    errors.push(`Expected ${String(schema.count)} items, found ${String(itemCount)}`);
  }

  for (const field of schema.requiredFields) {
    if (!answer.toLowerCase().includes(field.toLowerCase())) {
      errors.push(`Required field "${field}" not mentioned in the answer`);
    }
  }

  if (schema.priceCap !== undefined) {
    const prices = collectPrices(answer);
    const cap = schema.priceCap;
    const inclusive = schema.priceCapInclusive === true;
    const over = prices.filter((p) => (inclusive ? p > cap : p >= cap));
    if (over.length > 0) {
      errors.push(
        `${String(over.length)} price(s) violate the cap ($${String(cap)}${inclusive ? ' inclusive' : ' strict'}): ${over.map((p) => '$' + String(p)).join(', ')}`,
      );
    }
  }

  if (schema.location !== undefined && !answer.toLowerCase().includes(schema.location.toLowerCase())) {
    errors.push(`Required location "${schema.location}" not mentioned in the answer`);
  }

  return { valid: errors.length === 0, errors };
}
