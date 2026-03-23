import type { CrawlPage, BrowserClaw } from 'browserclaw';
import { pressAndHold, detectAntiBot, enrichSnapshot, getPageText } from './skills/press-and-hold.js';
import { clickCloudflareCheckbox } from './skills/cloudflare-checkbox.js';
import { detectPopup, dismissPopup } from './skills/dismiss-popup.js';
import { detectLoop, loopRecoveryStep } from './skills/loop-detection.js';
import { TabManager } from './skills/tab-manager.js';
import { llmJson } from './llm.js';
import type { AgentAction, AgentStep, AgentLoopResult, CatalogSkill } from './types.js';
import { logger } from './logger.js';
import {
  WAIT_AFTER_TYPE_MS,
  WAIT_AFTER_CLICK_MS,
  WAIT_AFTER_OTHER_MS,
  WAIT_ACTION_MS,
  SCROLL_PIXELS,
  LLM_MAX_TOKENS,
  MAX_STEPS,
} from './config.js';

const SYSTEM_PROMPT = `You are a browser automation agent. You read accessibility snapshots and act.

Respond with valid JSON:
{
  "reasoning": "what you're doing and why — THIS IS YOUR MEMORY. Record all data you collect here: names, prices, URLs, findings, comparisons. Your previous reasoning is the ONLY context you have between steps. Be thorough.",
  "action": "click" | "type" | "navigate" | "back" | "select" | "scroll" | "keyboard" | "wait" | "press_and_hold" | "click_cloudflare" | "ask_user" | "done" | "fail",
  "ref": "element ref number (for click, type, select)",
  "text": "text to type (for type) or question (for ask_user)",
  "url": "URL (for navigate)",
  "key": "key name (for keyboard) — e.g. Enter, Escape, Tab, ArrowDown, ArrowUp",
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
- "keyboard" to press special keys: Enter (submit forms), Escape (close dropdowns/dialogs), Tab (move between fields), ArrowDown/ArrowUp (navigate dropdowns).
- "back" to go back in browser history. Use this instead of manually tracking URLs when you need to return to the previous page.
- "press_and_hold" for press-and-hold anti-bot challenges. Wait after, check if it worked. If the challenge cleared but the page still looks the same (no new content loaded), refresh the page by navigating to the current URL. Try twice before asking user.
- "click_cloudflare" for Cloudflare security checks ("Verify you are human" checkbox). The system will find and click the checkbox. Wait after, check if it worked. Try twice before asking user.
- "ask_user" only when you need info you can't get from the page (MFA codes, credentials, preferences).
- "done" when finished. Include "answer" if the task asked a question — be specific with what you found.
- "fail" when the task is impossible. In reasoning, give a SHORT summary: what you tried, why it failed, and any partial results you found. Don't dump your full scratchpad — the user sees this.
- If a PLAYBOOK is provided, follow it. Deviate only if a step fails.

Complex tasks:
- Break the task into phases. Finish one phase completely before moving to the next.
- In "reasoning", maintain a running log of everything you've found. Accumulate data — don't overwrite previous findings.
- When collecting data from multiple listings/pages, record each one: name, key details, URL.
- When comparing, lay out the comparison in reasoning before giving the final answer.
- For research tasks: gather first, analyze second, synthesize last. Don't try to answer before you have the data.
- Your "answer" for complex tasks should be structured: use sections, bullet points, or a ranking — not a single sentence.

Page processing:
- Extract ALL useful data from a page before navigating away. Don't visit the same page twice.
- If the snapshot looks sparse, try one scroll down — content may be lazy-loaded.

Navigation:
- Before going back to search results, scroll down on the current page and check the snapshot for related content. Look for headings or text containing "Similar", "Related", "Recommended", "You may also like", "More like this", "People also viewed", "Nearby listings", or "Compare with".
- Near these headings, you'll find clickable links or buttons leading to other listings. There may also be arrow buttons (labeled "Next", "Previous", ">", "<") or "See more" / "View all" links — these load additional related items. Click them.
- Using related content links is better than going back to search results. When you go back, you lose scroll position, pages may reload, and filters can reset. Related links keep you moving forward.
- Only go back to search results when the current page has no related content section or when the related items don't match the task.

Strategy:
- You understand how websites work. Search pages have filters. Results pages have listings. Detail pages have specifics. Government sites have navigation menus and FAQ sections. E-commerce sites have categories and product pages.
- Before your first action, identify what type of site you're on and what the typical flow looks like to reach your goal.
- At each step, know where you are in that flow and what comes next.
- Every action should move you closer to the goal. If it doesn't, you're wasting steps.

When you hit a wall:
- Stop. Don't retry the same thing.
- Evaluate: what actually went wrong? Is it the page, the element, or your approach?
- Re-strategize: your plan can change at any time. The initial plan was a guess — adapt based on what you've learned about the site.
- Think about alternative paths to the same information. Can you use the site's navigation differently? Is there a direct URL? A different section of the site? A search box you haven't tried?
- Be resourceful. The information is on the site — you just need to find the right path to it.

Before giving up:
- If one approach fails, try a different path. Don't repeat the same failed action.
- If the results page doesn't show details, click into individual listings.
- Only "fail" after you've genuinely exhausted your options.`;

async function safeSnapshot(page: CrawlPage): Promise<string> {
  try {
    return (await page.snapshot({ interactive: true, compact: true })).snapshot;
  } catch {
    await page.waitFor({ timeMs: 2000 });
    try {
      return (await page.snapshot({ interactive: true, compact: true })).snapshot;
    } catch (err) {
      logger.error({ err }, 'Snapshot failed after retry');
      return '[Snapshot unavailable — page may be loading]';
    }
  }
}

const SKILL_INJECT_MAX_STEP = 2;
const HISTORY_RECENT_WINDOW = 10;

function truncateHistory(history: AgentStep[]): string {
  if (history.length <= HISTORY_RECENT_WINDOW) {
    // All history fits in window — render fully
    let out = 'Previous actions:\n';
    for (const step of history) {
      out += formatStep(step);
    }
    return out;
  }

  // Summarize older steps, show recent ones in full
  const older = history.slice(0, history.length - HISTORY_RECENT_WINDOW);
  const recent = history.slice(history.length - HISTORY_RECENT_WINDOW);

  let out = `Previous actions (${String(history.length)} total, showing last ${String(HISTORY_RECENT_WINDOW)} in detail):\n`;
  out += '  Earlier steps summary: ';
  out += older.map((s) => `${s.action.action}${s.action.error_feedback !== undefined ? '(FAILED)' : ''}`).join(' → ');
  out += '\n';

  // Include the last older step's reasoning as context bridge
  const lastOlderStep = older[older.length - 1];
  out += `  [Context from step ${String(lastOlderStep.step)}]: ${lastOlderStep.action.reasoning.substring(0, 300)}\n\n`;

  for (const step of recent) {
    out += formatStep(step);
  }
  return out;
}

function formatStep(step: AgentStep): string {
  let line = `  Step ${String(step.step)}: ${step.action.action} — ${step.action.reasoning}\n`;
  if (step.action.error_feedback !== undefined) {
    line += `    ⚠ ACTION FAILED: ${step.action.error_feedback}\n`;
  }
  if (step.user_response !== undefined) {
    line += `    User responded: "${step.user_response}"\n`;
  }
  return line;
}

interface BuildUserMessageOptions {
  plan?: string | null;
  tabCount?: number;
  domainSkill?: CatalogSkill | null;
  stepsRemaining?: number;
}

function buildUserMessage(
  prompt: string,
  snapshot: string,
  history: AgentStep[],
  url: string,
  title: string,
  opts?: BuildUserMessageOptions,
): string {
  const { plan, tabCount, domainSkill, stepsRemaining } = opts ?? {};
  let message = `Task: ${prompt}\n`;

  if (plan !== undefined && plan !== null && plan !== '') {
    message += `\nPlan: ${plan}\n`;
  }

  if (stepsRemaining !== undefined && stepsRemaining <= 10) {
    message += `\n⚠ WARNING: Only ${String(stepsRemaining)} steps remaining. Wrap up now — summarize what you've found and use "done" or "fail".\n`;
  }

  if (domainSkill !== undefined && domainSkill !== null) {
    message += '\n--- PLAYBOOK (proven workflow for this site) ---\n';
    message += `\n"${domainSkill.skill.title}" — ${domainSkill.skill.description}\n`;
    for (const step of domainSkill.skill.steps) {
      let line = `  ${String(step.number)}. [${step.action}] ${step.description}`;
      if (step.details !== undefined && step.details !== '') line += ` — ${step.details}`;
      message += `${line}\n`;
    }
    if (domainSkill.skill.tips.length > 0) {
      message += '\nTips for this site:\n';
      for (const tip of domainSkill.skill.tips) {
        message += `  - ${tip}\n`;
      }
    }
    message += '--- END PLAYBOOK ---\n';
  }

  message += `\nCurrent page: ${title}\nURL: ${url}\n`;
  if (tabCount !== undefined && tabCount > 1) {
    message += `Open tabs: ${String(tabCount)}\n`;
  }
  message += '\n';

  if (history.length > 0) {
    message += truncateHistory(history);
    message += '\n';
  }

  const alertLines = snapshot
    .split('\n')
    .filter((line) => /\b(alert|status|dialog|banner|toast|notification|error|warning)\b/i.test(line))
    .map((line) => line.trim())
    .filter(Boolean);

  if (alertLines.length > 0) {
    message += `⚠ Active alerts/notifications on page:\n${alertLines.join('\n')}\n\n`;
  }

  message += `Page snapshot:\n${snapshot}`;

  return message;
}

function parseAction(parsed: Record<string, unknown>): AgentAction {
  if (typeof parsed.action !== 'string') {
    throw new Error('Response missing or invalid "action" field — expected a string');
  }
  if (typeof parsed.reasoning !== 'string') {
    throw new Error('Response missing or invalid "reasoning" field — expected a string');
  }

  return {
    action: parsed.action as AgentAction['action'],
    reasoning: parsed.reasoning,
    answer: parsed.answer as string | undefined,
    ref: parsed.ref as string | undefined,
    text: parsed.text as string | undefined,
    url: parsed.url as string | undefined,
    key: parsed.key as string | undefined,
    options: parsed.options as string[] | undefined,
    direction: parsed.direction as AgentAction['direction'],
  };
}

async function executeAction(action: AgentAction, page: CrawlPage): Promise<void> {
  switch (action.action) {
    case 'click':
      if (action.ref === undefined || action.ref === '') throw new Error('click action requires ref');
      await page.click(action.ref);
      break;

    case 'type':
      if (action.ref === undefined || action.ref === '') throw new Error('type action requires ref');
      if (action.text === undefined || action.text === '') throw new Error('type action requires text');
      await page.type(action.ref, action.text, { submit: false });
      break;

    case 'navigate':
      if (action.url === undefined || action.url === '') throw new Error('navigate action requires url');
      await page.goto(action.url);
      break;

    case 'back':
      await page.evaluate('window.history.back()');
      break;

    case 'keyboard':
      if (action.key === undefined || action.key === '') throw new Error('keyboard action requires key');
      await page.press(action.key);
      break;

    case 'select':
      if (action.ref === undefined || action.ref === '') throw new Error('select action requires ref');
      if (action.options === undefined || action.options.length === 0)
        throw new Error('select action requires options');
      await page.select(action.ref, ...action.options);
      break;

    case 'scroll':
      await page.evaluate(
        action.direction === 'up'
          ? `window.scrollBy(0, -${String(SCROLL_PIXELS)})`
          : `window.scrollBy(0, ${String(SCROLL_PIXELS)})`,
      );
      break;

    case 'wait':
      await page.waitFor({ timeMs: WAIT_ACTION_MS });
      break;

    case 'done':
    case 'fail':
    case 'ask_user':
    case 'press_and_hold':
    case 'click_cloudflare':
      break;
  }
}

function getWaitMs(action: AgentAction['action']): number {
  switch (action) {
    case 'type':
      return WAIT_AFTER_TYPE_MS;
    case 'click':
      return WAIT_AFTER_CLICK_MS;
    case 'navigate':
    case 'back':
    case 'select':
    case 'scroll':
    case 'keyboard':
    case 'wait':
    case 'press_and_hold':
    case 'click_cloudflare':
    case 'done':
    case 'fail':
    case 'ask_user':
      return WAIT_AFTER_OTHER_MS;
  }
}

export async function runAgentLoop(
  prompt: string,
  page: CrawlPage,
  emit: (event: string, data: unknown) => void,
  signal: AbortSignal,
  waitForUser?: () => Promise<string>,
  browser?: BrowserClaw,
  domainSkill?: CatalogSkill | null,
  maxSteps = MAX_STEPS,
): Promise<AgentLoopResult> {
  const history: AgentStep[] = [];
  const startTime = Date.now();
  const tabManager = browser !== undefined ? new TabManager(page) : null;
  let consecutiveParseFailures = 0;
  const MAX_PARSE_FAILURES = 3;

  let planText: string | null = null;
  try {
    let planMessage = `User prompt: ${prompt}`;
    if (domainSkill !== undefined && domainSkill !== null) {
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
    if (plan.plan !== '') {
      planText = plan.plan;
      emit('plan', { prompt, plan: plan.plan });
    }
  } catch (err) {
    logger.error({ err }, 'Failed to generate plan');
  }

  for (let step = 0; step < maxSteps; step++) {
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
    const antiBotType = detectAntiBot(domText);
    if (antiBotType !== null) {
      snapshot = enrichSnapshot(snapshot, domText, antiBotType);
    }

    emit('thinking', { step, message: `Analyzing page: ${title}` });

    let tabCount: number | undefined;
    if (browser !== undefined) {
      try {
        tabCount = (await browser.tabs()).length;
      } catch (err) {
        logger.warn({ err }, 'Failed to get tab count');
      }
    }
    const skillForStep = step <= SKILL_INJECT_MAX_STEP ? domainSkill : undefined;
    const planForStep = step <= SKILL_INJECT_MAX_STEP ? planText : null;
    const stepsRemaining = maxSteps - step - 1;
    const userMessage = buildUserMessage(prompt, snapshot, history, url, title, {
      plan: planForStep,
      tabCount,
      domainSkill: skillForStep,
      stepsRemaining,
    });

    let action: AgentAction;
    try {
      const parsed = await llmJson<Record<string, unknown>>({
        system: SYSTEM_PROMPT,
        message: userMessage,
        maxTokens: LLM_MAX_TOKENS,
      });
      action = parseAction(parsed);
      consecutiveParseFailures = 0;
      logger.info({ step, action: action.action, reasoning: action.reasoning }, 'Agent step');

      if (detectLoop(action, history)) {
        logger.warn({ step }, 'Loop detected');
        history.push(loopRecoveryStep(step));
        continue;
      }
    } catch (err) {
      consecutiveParseFailures++;
      const message = err instanceof Error ? err.message : 'Failed to parse action';
      logger.error(
        { step, attempt: consecutiveParseFailures, maxAttempts: MAX_PARSE_FAILURES, error: message },
        'Failed to parse LLM response',
      );
      emit('step_error', { step, error: `LLM response error: ${message}` });
      if (consecutiveParseFailures >= MAX_PARSE_FAILURES) {
        return {
          success: false,
          steps: history,
          error: `${String(MAX_PARSE_FAILURES)} consecutive LLM failures — aborting`,
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

      if (waitForUser === undefined) {
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

    if (action.action === 'click_cloudflare') {
      await clickCloudflareCheckbox(page);
      continue;
    }

    try {
      await executeAction(action, page);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action execution failed';
      logger.error({ step, action: action.action, error: message }, 'Action execution failed');
      emit('step_error', { step, action: action.action, error: message });
      agentStep.action.error_feedback = message;
      await page.waitFor({ timeMs: 1000 });

      if (await detectPopup(page)) {
        await dismissPopup(page);
        continue;
      }
    }

    if (tabManager !== null && browser !== undefined && action.action === 'click') {
      const newPage = await tabManager.checkForNewTab(browser);
      if (newPage !== null) {
        try {
          const newUrl = await newPage.url();
          const newTitle = await newPage.title();
          page = newPage;
          history.push({
            step,
            action: { action: 'navigate', reasoning: `Click opened a new tab: ${newTitle}` },
            url: newUrl,
            page_title: newTitle,
            timestamp: new Date().toISOString(),
          });
        } catch {
          logger.info('tab-manager: new tab not accessible, staying on current page');
        }
      }
    }

    const waitMs = getWaitMs(action.action);
    await page.waitFor({ timeMs: waitMs });
  }

  // maxSteps reached
  logger.warn({ steps: history.length, maxSteps }, 'Agent hit step limit');
  const lastReasoning = history.length > 0 ? history[history.length - 1].action.reasoning : '';
  return {
    success: false,
    steps: history,
    error: `Reached maximum step limit (${String(maxSteps)}). Last reasoning: ${lastReasoning.substring(0, 200)}`,
    duration_ms: Date.now() - startTime,
    final_url: history.length > 0 ? history[history.length - 1].url : undefined,
  };
}
