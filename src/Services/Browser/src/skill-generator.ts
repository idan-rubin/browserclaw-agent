import { llmJson } from './llm.js';
import type { AgentLoopResult, SkillOutput, SkillStep } from './types.js';

interface TagResult {
  tags: string[];
}

const NEGATIVE_TIP_RE = /^\s*(?:[⚠🔍]|avoid:?|don't|do not|never|stop|skip|don't try|⚠ Avoid:|🔍 Site quirk:)/i;

function sanitizeTips(input: string[]): string[] {
  return input.filter((t) => t.trim() !== '' && !NEGATIVE_TIP_RE.test(t));
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
  what_worked?: string[];
}

const SYSTEM_PROMPT = `You are a skill documentation generator. Given a browser automation task and the successful actions that solved it, produce a clean, reusable skill document for any future run on the same domain.

You MUST respond with valid JSON matching this schema:
{
  "title": "short descriptive title",
  "description": "one-sentence description of what this skill does",
  "steps": [
    {
      "number": 1,
      "description": "what this step does in plain language",
      "action": "click | type | navigate | select | scroll | wait | extract | press_and_hold | click_cloudflare | web_search | switch_tab | close_tab | back",
      "details": "specific details like what was clicked or typed (optional)"
    }
  ],
  "tips": [
    "concise positive site knowledge that saves time on the next visit (URL patterns, filter shortcuts, where data lives)"
  ],
  "what_worked": [
    "patterns or approaches that succeeded and should be repeated"
  ]
}

Rules:
- Title should be concise (under 60 chars).
- Capture only the successful, reusable path — collapse intermediate waits, scrolls, and any recovered failures into the clean logical sequence.
- Description should be one sentence explaining the end-to-end task.
- Steps should be human-readable — use natural language, not technical refs.
- The "action" field must exactly match the action type the step performed in the history. If a step extracted data, use "extract"; if it reviewed/processed data outside the browser, omit the step rather than picking an unrelated action name.
- Omit intermediate waits and scrolls unless they're meaningful to the workflow.
- Tips must be POSITIVE, REUSABLE site knowledge — URL patterns, filter shortcuts, where structured data lives, autocomplete/cookie behavior. Do NOT write defensive content ("avoid X", "don't Y", "this site sometimes fails"). If something failed in this run, leave it out — domain skills are recipes, not session diaries.
- URL normalization: when citing the final URL or recommending a URL pattern, include only filter tokens (path segments, query params) that map to constraints explicitly in the user's original prompt. Strip amenity/price/location/sort filters the agent added but the user did not request — they contaminate future runs with different constraints.
- what_worked: capture the successful patterns — the approach, the shortcuts, the order. Keep entries crisp and reusable across similar tasks on this domain.`;

function buildPrompt(userPrompt: string, result: AgentLoopResult): string {
  let message = `Original task: ${userPrompt}\n\n`;
  message += `Final URL: ${result.final_url ?? 'unknown'}\n`;
  message += `Total steps: ${String(result.steps.length)}\n`;
  message += `Duration: ${String(result.duration_ms)}ms\n\n`;
  message += 'Action history — capture only the successful, reusable path:\n';

  for (const step of result.steps) {
    const action = step.action;
    let detail = `Step ${String(step.step)}: ${action.action} — ${action.reasoning}`;
    if (action.ref !== undefined && action.ref !== '') detail += ` (ref: ${action.ref})`;
    if (action.text !== undefined && action.text !== '') detail += ` (text: "${action.text}")`;
    if (action.url !== undefined && action.url !== '') detail += ` (url: ${action.url})`;
    if (step.page_title !== undefined && step.page_title !== '') detail += ` [page: ${step.page_title}]`;
    if (step.outcome !== undefined && step.outcome !== '') detail += ` → ${step.outcome}`;
    message += `  ${detail}\n`;
  }

  return message;
}

function toMarkdown(
  title: string,
  description: string,
  steps: SkillStep[],
  tips: string[],
  whatWorked: string[],
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

  if (whatWorked.length > 0) {
    lines.push('', '## What Worked', '');
    for (const w of whatWorked) {
      lines.push(`- ${w}`);
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

  const tips = sanitizeTips(parsed.tips ?? []);
  const whatWorked = sanitizeTips(parsed.what_worked ?? []);

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
    tips,
    what_worked: whatWorked,
    metadata,
    markdown: toMarkdown(
      parsed.title,
      parsed.description,
      parsed.steps,
      tips,
      whatWorked,
      prompt,
      metadata.url,
      metadata.duration_ms,
    ),
  };
}

export async function mergeSkills(
  existing: SkillOutput,
  prompt: string,
  result: AgentLoopResult,
): Promise<SkillOutput> {
  const newSkill = await generateSkill(prompt, result);

  const existingTips = sanitizeTips(existing.tips);
  const allTips = [...existingTips];
  for (const tip of newSkill.tips) {
    if (!allTips.some((t) => t.toLowerCase().includes(tip.toLowerCase().slice(0, 30)))) {
      allTips.push(tip);
    }
  }

  const existingWorked = sanitizeTips(existing.what_worked ?? []);
  const allWorked = [...existingWorked];
  for (const w of newSkill.what_worked ?? []) {
    if (!allWorked.some((aw) => aw.toLowerCase().includes(w.toLowerCase().slice(0, 30)))) {
      allWorked.push(w);
    }
  }

  const steps = newSkill.steps.length < existing.steps.length ? newSkill.steps : existing.steps;

  return {
    title: existing.title,
    description: existing.description,
    steps,
    tips: allTips,
    what_worked: allWorked,
    failure_notes: existing.failure_notes,
    metadata: newSkill.metadata,
    markdown: toMarkdown(
      existing.title,
      existing.description,
      steps,
      allTips,
      allWorked,
      prompt,
      newSkill.metadata.url,
      newSkill.metadata.duration_ms,
    ),
  };
}
