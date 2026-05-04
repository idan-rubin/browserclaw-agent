function snippetFor(text: string, max = 500): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[truncated ${String(text.length - max)} chars]`;
}

export class JsonResponseParseError extends SyntaxError {
  readonly snippet: string;

  constructor(message: string, raw: string) {
    super(`${message} (raw: ${snippetFor(raw)})`);
    this.name = 'JsonResponseParseError';
    this.snippet = snippetFor(raw);
  }
}

/**
 * Extracts and parses JSON from an LLM response that may be wrapped in
 * markdown code fences or followed by trailing text.
 */
export function parseJsonResponse(text: string): unknown {
  let jsonStr = text.trim();

  // Strip markdown code fences
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(jsonStr);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  // Try direct parse first (fast path)
  try {
    return JSON.parse(jsonStr) as unknown;
  } catch {
    // Extract first JSON object — handles trailing text after valid JSON
    const start = jsonStr.indexOf('{');
    if (start === -1) throw new JsonResponseParseError('No JSON object found in response', text);

    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < jsonStr.length; i++) {
      const ch = jsonStr[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(jsonStr.slice(start, i + 1)) as unknown;
          } catch (err) {
            throw new JsonResponseParseError(err instanceof Error ? err.message : 'JSON.parse failed', text);
          }
        }
      }
    }
    throw new JsonResponseParseError('Unterminated JSON object in response', text);
  }
}
