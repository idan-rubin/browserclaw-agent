import { llmJson } from './llm.js';
import type { AgentLoopResult } from './types.js';
import { logger } from './logger.js';

interface AdvisorReview {
  success: boolean;
  reasoning: string;
}

const ADVISOR_PROMPT = `You are a quality advisor for browser automation runs. You review the agent's completed trace and flag quality issues as advisory notes — you do NOT gate success.

Review for:
1. Did the agent's actions actually achieve the goal, or did it just claim success?
2. Is the answer grounded in data from actual page snapshots, or does it contain fabricated/hallucinated data?
3. Did the agent get blocked by a login wall, paywall, CAPTCHA, or error page and report success anyway?
4. Did the agent complete ALL requirements of the task, not just part of it?
5. Are there signs the agent gave up early and reported partial results as complete?

Respond with JSON:
{
  "success": true/false,
  "reasoning": "one-paragraph quality note — what you'd tell a reviewer to check"
}

Set success=false when you'd want a human reviewer to double-check the answer. Callers treat this as advisory metadata, not a blocking verdict.`;

function buildAdvisorMessage(prompt: string, result: AgentLoopResult): string {
  let message = `Task: ${prompt}\n`;
  message += `Agent reported: ${result.success ? 'SUCCESS' : 'FAILURE'}\n`;
  if (result.answer !== undefined) {
    message += `Agent answer: ${result.answer}\n`;
  }
  if (result.error !== undefined) {
    message += `Agent error: ${result.error}\n`;
  }
  message += `\nExecution trace (${String(result.steps.length)} steps):\n`;

  for (const step of result.steps) {
    let line = `  Step ${String(step.step)}: [${step.action.action}] ${step.action.reasoning}`;
    if (step.url !== undefined) line += ` (${step.url})`;
    if (step.action.error_feedback !== undefined) line += ` ⚠ FAILED: ${step.action.error_feedback}`;
    if (step.action.memory !== undefined && step.action.memory !== '') {
      line += `\n    Memory: ${step.action.memory.substring(0, 200)}`;
    }
    message += `${line}\n`;
  }

  return message;
}

export async function advisorReview(prompt: string, result: AgentLoopResult): Promise<AdvisorReview> {
  try {
    const review = await llmJson<AdvisorReview>({
      system: ADVISOR_PROMPT,
      message: buildAdvisorMessage(prompt, result),
      maxTokens: 256,
    });
    logger.info({ advisor_ran: true, quality_ok: review.success }, 'Advisor review');
    return review;
  } catch {
    logger.warn({ advisor_failed: true }, 'Advisor review failed — treating run as clean');
    return { success: true, reasoning: 'Advisor review unavailable' };
  }
}
