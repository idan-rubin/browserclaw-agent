import { llmJson } from './llm.js';
import type { AgentLoopResult, SkillOutput, SkillStep } from './types.js';

interface TagResult {
  tags: string[];
}

export async function generateSkillTags(prompt: string, skill: SkillOutput): Promise<string[]> {
  try {
    const result = await llmJson<TagResult>({
      system: `Generate 3-5 short tags for a browser automation skill. Tags should describe the type of task (e.g. "search", "booking", "form-fill", "navigation", "price-check"). Respond with JSON: {"tags": ["tag1", "tag2", ...]}`,
      message: `Prompt: ${prompt}\nSkill: ${skill.title} — ${skill.description}`,
      maxTokens: 128,
    });
    return result.tags;
  } catch {
    return [];
  }
}

interface ParsedSkill {
  title: string;
  description: string;
  steps: SkillStep[];
  tips?: string[];
}

const SYSTEM_PROMPT = `You are a skill documentation generator. Given a browser automation task and the actions that were taken, generate a clean, structured skill document.

You MUST respond with valid JSON matching this schema:
{
  "title": "short descriptive title",
  "description": "one-sentence description of what this skill does",
  "steps": [
    {
      "number": 1,
      "description": "what this step does in plain language",
      "action": "click | type | navigate | select | scroll | wait",
      "details": "specific details like what was clicked or typed (optional)"
    }
  ],
  "tips": [
    "practical tips about this site that would save time on the next visit"
  ]
}

Rules:
- Title should be concise (under 60 chars).
- Collapse redundant or failed steps — only include the successful logical steps.
- Description should be one sentence explaining the end-to-end task.
- Steps should be human-readable — use natural language, not technical refs.
- Omit intermediate waits and scrolls unless they're meaningful to the workflow.
- Tips should capture site-specific knowledge: cookie banners, autocomplete behavior, loading delays, popup dismissals, anti-bot challenges, hidden buttons, required wait times, URL patterns — anything the agent struggled with or discovered that would help next time.`;

function buildPrompt(userPrompt: string, result: AgentLoopResult): string {
  let message = `Original task: ${userPrompt}\n\n`;
  message += `Final URL: ${result.final_url ?? 'unknown'}\n`;
  message += `Total steps executed: ${String(result.steps.length)}\n`;
  message += `Duration: ${String(result.duration_ms)}ms\n\n`;
  message += 'Action history:\n';

  for (const step of result.steps) {
    const action = step.action;
    let detail = `Step ${String(step.step)}: ${action.action} — ${action.reasoning}`;
    if (action.ref !== undefined && action.ref !== '') detail += ` (ref: ${action.ref})`;
    if (action.text !== undefined && action.text !== '') detail += ` (text: "${action.text}")`;
    if (action.url !== undefined && action.url !== '') detail += ` (url: ${action.url})`;
    if (step.page_title !== undefined && step.page_title !== '') detail += ` [page: ${step.page_title}]`;
    message += `  ${detail}\n`;
  }

  return message;
}

function toMarkdown(
  title: string,
  description: string,
  steps: SkillStep[],
  tips: string[],
  prompt: string,
  url: string,
  durationMs: number,
): string {
  const lines: string[] = [`# ${title}`, '', description, '', '## Steps', ''];

  for (const step of steps) {
    lines.push(`${String(step.number)}. **${step.description}**`);
    if (step.details !== undefined && step.details !== '') lines.push(`   ${step.details}`);
  }

  if (tips.length > 0) {
    lines.push('', '## Tips', '');
    for (const tip of tips) {
      lines.push(`- ${tip}`);
    }
  }

  lines.push('', '---', '');
  lines.push(`- **Prompt:** ${prompt}`);
  lines.push(`- **Final URL:** ${url}`);
  lines.push(`- **Duration:** ${(durationMs / 1000).toFixed(1)}s`);
  lines.push(`- **Generated:** ${new Date().toISOString()}`);
  lines.push(`- **Engine:** [BrowserClaw](https://github.com/idan-rubin/browserclaw)`);
  lines.push('');

  return lines.join('\n');
}

export async function generateSkill(prompt: string, result: AgentLoopResult): Promise<SkillOutput> {
  const parsed = await llmJson<ParsedSkill>({
    system: SYSTEM_PROMPT,
    message: buildPrompt(prompt, result),
    maxTokens: 2048,
  });

  const metadata = {
    prompt,
    url: result.final_url ?? '',
    total_steps: result.steps.length,
    duration_ms: result.duration_ms,
    generated_at: new Date().toISOString(),
  };

  return {
    title: parsed.title,
    description: parsed.description,
    steps: parsed.steps,
    tips: parsed.tips ?? [],
    metadata,
    markdown: toMarkdown(
      parsed.title,
      parsed.description,
      parsed.steps,
      parsed.tips ?? [],
      prompt,
      metadata.url,
      metadata.duration_ms,
    ),
  };
}
