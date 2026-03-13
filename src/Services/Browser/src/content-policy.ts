import { llmJson } from './llm.js';

export async function moderatePrompt(prompt: string): Promise<{ allowed: boolean; reason?: string }> {
  const result = await llmJson<{ allowed: boolean; reason?: string }>({
    system: `You are a content moderation filter for a browser automation service. Users type a prompt describing what they want an AI to do in a web browser.

REJECT prompts related to: pornography, sexual content, gambling, weapons/guns, drugs, violence, hacking, illegal activity, harassment, doxxing, or any harmful content.

ALLOW normal browser tasks like: searching, shopping, research, form filling, data extraction, testing.

Respond with ONLY valid JSON:
{"allowed": true} or {"allowed": false, "reason": "brief explanation"}`,
    message: prompt,
    maxTokens: 128,
  });

  return { allowed: Boolean(result.allowed), reason: result.reason };
}
