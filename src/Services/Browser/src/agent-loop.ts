import type { CrawlPage } from 'browserclaw';
import { pressAndHold, detectAntiBot, enrichSnapshot, getPageText } from './skills/press-and-hold.js';
import { detectPopup, dismissPopup } from './skills/dismiss-popup.js';
import { detectLoop, loopRecoveryStep } from './skills/loop-detection.js';
import { TabManager } from './skills/tab-manager.js';
import { llmJson } from './llm.js';
import type { AgentAction, AgentStep, AgentLoopResult, CatalogSkill } from './types.js';
import {
  WAIT_AFTER_TYPE_MS,
  WAIT_AFTER_CLICK_MS,
  WAIT_AFTER_OTHER_MS,
  WAIT_ACTION_MS,
  SCROLL_PIXELS,
  LLM_MAX_TOKENS,
} from './config.js';

const SYSTEM_PROMPT = `You are a browser automation agent. You read accessibility snapshots and act.

Respond with valid JSON:
{
  "reasoning": "what you're doing and why — THIS IS YOUR MEMORY. Record all data you collect here: names, prices, URLs, findings, comparisons. Your previous reasoning is the ONLY context you have between steps. Be thorough.",
  "action": "click" | "type" | "navigate" | "select" | "scroll" | "wait" | "press_and_hold" | "ask_user" | "done" | "fail",
  "ref": "element ref number (for click, type, select)",
  "text": "text to type (for type) or question (for ask_user)",
  "url": "URL (for navigate)",
  "options": ["values (for select)"],
  "direction": "up" | "down" (for scroll),
  "answer": "direct answer to the user's question (for done)"
}

Rules:
- Use exact ref numbers from the snapshot.
- After every action, check the next snapshot to see if it worked.
- If something failed, try a different approach. Never repeat a failed action.
- "type" clears the field first, then types.
- After typing in any field, wait — then check for autocomplete dropdowns and click the matching option.
- "press_and_hold" for anti-bot challenges. Wait after, check if it worked. Try twice before asking user.
- "ask_user" only when you need info you can't get from the page (MFA codes, credentials, preferences).
- "done" when finished. Include "answer" if the task asked a question — be specific with what you found.
- "fail" when the task is impossible. Say why.
- If a PLAYBOOK is provided, follow it. Deviate only if a step fails.

Complex tasks:
- Break the task into phases. Finish one phase completely before moving to the next.
- In "reasoning", maintain a running log of everything you've found. Accumulate data — don't overwrite previous findings.
- When collecting data from multiple listings/pages, record each one: name, key details, URL.
- When comparing, lay out the comparison in reasoning before giving the final answer.
- For research tasks: gather first, analyze second, synthesize last. Don't try to answer before you have the data.
- Your "answer" for complex tasks should be structured: use sections, bullet points, or a ranking — not a single sentence.`;

async function safeSnapshot(page: CrawlPage): Promise<string> {
  try {
    return (await page.snapshot({ interactive: true, compact: true })).snapshot;
  } catch {
    await page.waitFor({ timeMs: 2000 });
    try {
      return (await page.snapshot({ interactive: true, compact: true })).snapshot;
    } catch (err) {
      console.error('Snapshot failed after retry:', err instanceof Error ? err.message : err);
      return '[Snapshot unavailable — page may be loading]';
    }
  }
}

const SKILL_INJECT_MAX_STEP = 2;

function buildUserMessage(prompt: string, snapshot: string, history: AgentStep[], url: string, title: string, tabCount?: number, domainSkill?: CatalogSkill | null): string {
  let message = `Task: ${prompt}\n`;

  if (domainSkill) {
    message += '\n--- PLAYBOOK (proven workflow for this site) ---\n';
    message += `\n"${domainSkill.skill.title}" — ${domainSkill.skill.description}\n`;
    for (const step of domainSkill.skill.steps) {
      let line = `  ${step.number}. [${step.action}] ${step.description}`;
      if (step.details) line += ` — ${step.details}`;
      message += `${line}\n`;
    }
    message += '--- END PLAYBOOK ---\n';
  }

  message += `\nCurrent page: ${title}\nURL: ${url}\n`;
  if (tabCount && tabCount > 1) {
    message += `Open tabs: ${tabCount}\n`;
  }
  message += '\n';

  if (history.length > 0) {
    message += 'Previous actions:\n';
    for (const step of history) {
      message += `  Step ${step.step}: ${step.action.action} — ${step.action.reasoning}\n`;
      if (step.user_response) {
        message += `    User responded: "${step.user_response}"\n`;
      }
    }
    message += '\n';
  }

  const alertLines = snapshot
    .split('\n')
    .filter(line => /\b(alert|status|dialog|banner|toast|notification|error|warning)\b/i.test(line))
    .map(line => line.trim())
    .filter(Boolean);

  if (alertLines.length > 0) {
    message += `⚠ Active alerts/notifications on page:\n${alertLines.join('\n')}\n\n`;
  }

  message += `Page snapshot:\n${snapshot}`;

  return message;
}

function parseAction(parsed: Record<string, unknown>): AgentAction {
  if (!parsed.action || !parsed.reasoning) {
    throw new Error('Response missing required fields: action, reasoning');
  }

  return {
    action: parsed.action as AgentAction['action'],
    reasoning: parsed.reasoning as string,
    answer: parsed.answer as string | undefined,
    ref: parsed.ref as string | undefined,
    text: parsed.text as string | undefined,
    url: parsed.url as string | undefined,
    options: parsed.options as string[] | undefined,
    direction: parsed.direction as AgentAction['direction'],
  };
}

async function executeAction(action: AgentAction, page: CrawlPage): Promise<void> {
  switch (action.action) {
    case 'click':
      if (!action.ref) throw new Error('click action requires ref');
      await page.click(action.ref);
      break;

    case 'type':
      if (!action.ref) throw new Error('type action requires ref');
      if (!action.text) throw new Error('type action requires text');
      await page.type(action.ref, action.text, { submit: false });
      break;

    case 'navigate':
      if (!action.url) throw new Error('navigate action requires url');
      await page.goto(action.url);
      break;

    case 'select':
      if (!action.ref) throw new Error('select action requires ref');
      if (!action.options || action.options.length === 0) throw new Error('select action requires options');
      await page.select(action.ref, ...action.options);
      break;

    case 'scroll':
      await page.evaluate(
        action.direction === 'up'
          ? `window.scrollBy(0, -${SCROLL_PIXELS})`
          : `window.scrollBy(0, ${SCROLL_PIXELS})`,
      );
      break;

    case 'wait':
      await page.waitFor({ timeMs: WAIT_ACTION_MS });
      break;

    case 'done':
    case 'fail':
    case 'ask_user':
      break;

    default:
      throw new Error(`Unknown action: ${action.action}`);
  }
}

function getWaitMs(action: AgentAction['action']): number {
  switch (action) {
    case 'type':  return WAIT_AFTER_TYPE_MS;
    case 'click': return WAIT_AFTER_CLICK_MS;
    default:      return WAIT_AFTER_OTHER_MS;
  }
}

export async function runAgentLoop(
  prompt: string,
  page: CrawlPage,
  emit: (event: string, data: unknown) => void,
  signal: AbortSignal,
  waitForUser?: () => Promise<string>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  browser?: any,
  domainSkill?: CatalogSkill | null,
): Promise<AgentLoopResult> {
  const history: AgentStep[] = [];
  const startTime = Date.now();
  const tabManager = browser ? new TabManager(page) : null;
  let consecutiveParseFailures = 0;
  const MAX_PARSE_FAILURES = 3;

  try {
    let planMessage = `User prompt: ${prompt}`;
    if (domainSkill) {
      planMessage += `\n\nWe have a proven skill for this site: "${domainSkill.skill.title}" — ${domainSkill.skill.description}`;
      planMessage += '\nLeverage it — no need to rediscover what already works.';
    }
    const plan = await llmJson<{ plan: string }>({
      system: `You are a browser automation planner. Given a user prompt, create a plan of action. Navigate directly to the best site for the task — never search Google first. If existing skills are provided, incorporate them.

For simple tasks (search, click, fill a form): 2-4 steps.
For complex tasks (research, compare, rank): break into phases:
  Phase 1: Gather — what sites to visit, what data to collect
  Phase 2: Analyze — compare findings, identify patterns
  Phase 3: Synthesize — rank, summarize, deliver the answer

Respond with JSON: {"plan": "your plan here"}`,
      message: planMessage,
      maxTokens: 256,
    });
    if (plan.plan) {
      emit('plan', { prompt, plan: plan.plan });
    }
  } catch (err) {
    console.error('Failed to generate plan:', err instanceof Error ? err.message : err);
  }

  for (let step = 0; ; step++) {
    if (signal.aborted) {
      return {
        success: false,
        steps: history,
        error: 'Session timed out',
        duration_ms: Date.now() - startTime,
      };
    }

    if (await detectPopup(page)) {
      await dismissPopup(page);
    }

    let snapshot = await safeSnapshot(page);
    const url = await page.url();
    const title = await page.title();

    const domText = await getPageText(page);
    if (detectAntiBot(domText, snapshot)) {
      snapshot = enrichSnapshot(snapshot, domText);
    }

    emit('thinking', { step, message: `Analyzing page: ${title}` });

    let tabCount: number | undefined;
    if (browser) {
      try {
        tabCount = (await browser.tabs()).length;
      } catch (err) {
        console.error('Failed to get tab count:', err instanceof Error ? err.message : err);
      }
    }
    const skillForStep = (step <= SKILL_INJECT_MAX_STEP) ? domainSkill : undefined;
    const userMessage = buildUserMessage(prompt, snapshot, history, url, title, tabCount, skillForStep);

    let action: AgentAction;
    try {
      const parsed = await llmJson<Record<string, unknown>>({
        system: SYSTEM_PROMPT,
        message: userMessage,
        maxTokens: LLM_MAX_TOKENS,
      });
      action = parseAction(parsed);
      consecutiveParseFailures = 0;
      console.log(`Step ${step}: ${action.action} — ${action.reasoning}`);

      if (detectLoop(action, history)) {
        console.log(`Step ${step}: loop detected`);
        history.push(loopRecoveryStep(step));
        continue;
      }
    } catch (err) {
      consecutiveParseFailures++;
      const message = err instanceof Error ? err.message : 'Failed to parse action';
      console.error(`Step ${step}: failed to parse LLM response (${consecutiveParseFailures}/${MAX_PARSE_FAILURES}):`, message);
      emit('step_error', { step, error: `LLM response error: ${message}` });
      if (consecutiveParseFailures >= MAX_PARSE_FAILURES) {
        return {
          success: false,
          steps: history,
          error: `${MAX_PARSE_FAILURES} consecutive LLM failures — aborting`,
          duration_ms: Date.now() - startTime,
        };
      }
      continue;
    }

    const agentStep: AgentStep = {
      step,
      action,
      url,
      page_title: title,
      timestamp: new Date().toISOString(),
    };

    history.push(agentStep);

    emit('step', {
      step,
      action: action.action,
      reasoning: action.reasoning,
      url,
      page_title: title,
    });

    if (action.action === 'done') {
      return {
        success: true,
        steps: history,
        answer: action.answer,
        duration_ms: Date.now() - startTime,
        final_url: url,
      };
    }

    if (action.action === 'fail') {
      return {
        success: false,
        steps: history,
        error: action.reasoning,
        duration_ms: Date.now() - startTime,
        final_url: url,
      };
    }

    if (action.action === 'ask_user') {
      emit('ask_user', { step, question: action.text ?? action.reasoning });

      if (!waitForUser) {
        return {
          success: false,
          steps: history,
          error: 'Agent requested user input but interactive mode is not available',
          duration_ms: Date.now() - startTime,
        };
      }

      try {
        const userResponse = await waitForUser();
        agentStep.user_response = userResponse;
        emit('user_response', { step, text: userResponse });
        continue;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to get user response';
        emit('step_error', { step, error: message });
        return {
          success: false,
          steps: history,
          error: message,
          duration_ms: Date.now() - startTime,
        };
      }
    }

    if (action.action === 'press_and_hold') {
      await pressAndHold(page);
      continue;
    }

    try {
      await executeAction(action, page);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action execution failed';
      console.error(`Step ${step}: action ${action.action} failed:`, message);
      emit('step_error', { step, action: action.action, error: message });
      await page.waitFor({ timeMs: 1000 });

      if (await detectPopup(page)) {
        await dismissPopup(page);
        continue;
      }
    }

    if (tabManager && action.action === 'click') {
      const newPage = await tabManager.checkForNewTab(browser);
      if (newPage) {
        try {
          const newUrl = await newPage.url();
          const newTitle = await newPage.title();
          page = newPage;
          history.push({ step, action: { action: 'navigate', reasoning: `Click opened a new tab: ${newTitle}` }, url: newUrl, page_title: newTitle, timestamp: new Date().toISOString() });
        } catch {
          console.log('tab-manager: new tab not accessible, staying on current page');
        }
      }
    }

    const waitMs = getWaitMs(action.action);
    await page.waitFor({ timeMs: waitMs });
  }

  return {
    success: false,
    steps: history,
    error: 'Session timed out',
    duration_ms: Date.now() - startTime,
  };
}
