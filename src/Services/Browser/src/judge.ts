import { llmJson } from './llm.js';
import type { AgentLoopResult } from './types.js';
import { logger } from './logger.js';

interface JudgeVerdict {
  success: boolean;
  reasoning: string;
}

const JUDGE_PROMPT = `You are a strict evaluator of browser automation runs. Your job is to determine whether the agent actually completed its task successfully.

Be initially doubtful of the agent's self-reported success. Check for:
1. Did the agent's actions actually achieve the goal, or did it just claim success?
2. Is the answer grounded in data from actual page snapshots, or does it contain fabricated/hallucinated data?
3. Did the agent get blocked by a login wall, paywall, CAPTCHA, or error page and report success anyway?
4. Did the agent complete ALL requirements of the task, not just part of it?
5. Are there signs the agent gave up early and reported partial results as complete?

Respond with JSON:
{
  "success": true/false,
  "reasoning": "why you believe the run succeeded or failed"
}

Set success=false if ANY of the above checks fail.`;

function buildJudgeMessage(prompt: string, result: AgentLoopResult): string {
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

export async function judgeRun(prompt: string, result: AgentLoopResult): Promise<JudgeVerdict> {
  try {
    const verdict = await llmJson<JudgeVerdict>({
      system: JUDGE_PROMPT,
      message: buildJudgeMessage(prompt, result),
      maxTokens: 256,
    });
    logger.info({ success: verdict.success, reasoning: verdict.reasoning }, 'Judge verdict');
    return verdict;
  } catch (err) {
    logger.warn(
      { error_type: err instanceof Error ? err.constructor.name : 'unknown' },
      'Judge evaluation failed — defaulting to agent result',
    );
    return { success: result.success, reasoning: 'Judge evaluation failed' };
  }
}
