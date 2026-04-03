import type { CrawlPage, BrowserClaw } from 'browserclaw';
import { pressAndHold, detectAntiBot, enrichSnapshot, getPageText } from './skills/press-and-hold.js';
import { clickCloudflareCheckbox } from './skills/cloudflare-checkbox.js';
import { detectPopup, dismissPopup } from './skills/dismiss-popup.js';
import { detectLoop } from './skills/loop-detection.js';
import { diagnoseStuckAgent, formatRecovery } from './skills/recovery.js';
import { TabManager } from './skills/tab-manager.js';
import { llmJson, sanitizeErrorText } from './llm.js';
import { LlmParseError } from './types.js';
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
  "evaluation_previous_goal": "Did the previous action succeed? What changed? What went wrong? (skip on first step)",
  "memory": "Running scratchpad of ALL accumulated data: names, prices, URLs, findings, comparisons. Carry forward everything from previous memory — never drop data. This is your only persistent storage between steps.",
  "next_goal": "What you will do next and why — one clear sentence",
  "reasoning": "Brief explanation of what you're doing right now",
  "actions": [
    {
      "action": "click" | "type" | "navigate" | "back" | "select" | "scroll" | "keyboard" | "wait" | "press_and_hold" | "click_cloudflare" | "ask_user" | "done" | "fail",
      "ref": "element ref number (for click, type, select)",
      "text": "text to type (for type) or question (for ask_user)",
      "url": "URL (for navigate)",
      "key": "key name (for keyboard) — e.g. Enter, Escape, Tab, ArrowDown, ArrowUp",
      "options": ["values (for select)"],
      "direction": "up" | "down" (for scroll),
      "answer": "direct answer to the user's question (for done)"
    }
  ]
}

You can return 1-4 actions per response. They execute sequentially. Use multiple actions for:
- Form filling: click field → type value → click next field → type value
- Sequential clicks: click a tab → click an item in the tab
- Simple sequences where you don't need to see the page change between actions
Use a single action when:
- Navigation (page will change — you need the new snapshot)
- After typing in autocomplete/search fields (need to see dropdown)
- When uncertain about the page state
- Terminal actions: "done", "fail", "ask_user" must always be the LAST action

Rules:
- Use exact ref numbers from the snapshot.
- After every action, check the next snapshot to see if it worked.
- If something failed, try a different approach. Never repeat a failed action.
- "type" clears the field first, then types.
- After typing in any field, wait — then check for autocomplete dropdowns and click the matching option.
- "keyboard" to press special keys: Enter (submit forms), Escape (close dropdowns/dialogs/popups/date pickers/calendars), Tab (move between fields), ArrowDown/ArrowUp (navigate dropdowns).
- If a popup, modal, date picker, calendar widget, or overlay is blocking the UI, dismiss it immediately: click its "Cancel", "Close", or "X" button, or use "keyboard" with "Escape". Do NOT try to click elements behind a blocking overlay — dismiss the overlay first.
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

Result scoping:
- When collecting multiple results (listings, products, flights, etc.), work in batches: gather results from the current page, then decide whether to continue.
- After each batch, check: are new results still relevant and distinct? If results are repeating, becoming less relevant, or the page has no more content — stop and present what you have.
- Do NOT endlessly paginate or click into dozens of listings. Quality beats quantity — well-detailed results with key attributes are more useful than many shallow ones.
- For each result, extract: name/title, price (if applicable), key attributes, and URL.
- If the task specifies a number (e.g. "find 3 hotels"), use that exact number.
- If no number is specified, use your judgment: stop when new results aren't adding value. 3 great results is better than getting stuck trying to find 10.
- IMPORTANT: If you have results and the next page is slow, blocked, or repeating — present what you have immediately. Never get stuck chasing more results when you already have useful ones.

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

Blocking overlays (popups, modals, date pickers, calendars, cookie banners):
- If a popup, modal, date picker, calendar, or overlay is covering the page and blocking your clicks, you MUST dismiss it before doing anything else.
- To dismiss: click the overlay's "Cancel", "Close", "X", or "No thanks" button using "click" with its ref number. If there's no visible close button, use "keyboard" with "Escape".
- After dismissing, check the next snapshot — there may be another overlay underneath (e.g. a date picker on top of a filters modal). Dismiss each layer one at a time.
- Do NOT repeatedly click elements behind an overlay. If a click fails and the snapshot still shows an overlay, dismiss the overlay first.

When you hit a wall:
- Stop. Don't retry the same thing.
- Evaluate: what actually went wrong? Is it the page, the element, or your approach?
- Re-strategize: your plan can change at any time. The initial plan was a guess — adapt based on what you've learned about the site.
- Think about alternative paths to the same information. Can you use the site's navigation differently? Is there a direct URL? A different section of the site? A search box you haven't tried?
- Be resourceful. The information is on the site — you just need to find the right path to it.

Before giving up:
- If one approach fails, try a different path. Don't repeat the same failed action.
- If the results page doesn't show details, click into individual listings.
- Only "fail" after you've genuinely exhausted your options.

Before calling "done":
- Re-read the original task. Check every requirement against your findings.
- DATA GROUNDING: Every value in your answer MUST appear verbatim in a snapshot you saw. Never fill gaps with your training knowledge. If you didn't see it on the page, don't include it.
- Verify your actions actually completed by checking the page state, not just assuming.
- If any requirement is uncertain or unverified, say so in your answer rather than guessing.`;

const LAST_STEP_PROMPT = `This is your FINAL step. You MUST respond with "done" or "fail" — no other action is allowed.

Respond with valid JSON:
{
  "evaluation_previous_goal": "Did the previous action succeed?",
  "memory": "Your accumulated findings",
  "reasoning": "Final assessment",
  "action": "done" or "fail",
  "answer": "Your complete answer with all findings. Structure with sections and bullet points. Only include data you saw on actual pages — never fill gaps with training knowledge."
}

If you gathered useful data, use "done" with a structured answer. If not, use "fail" with what you tried.`;

function isPageReady(snapshot: string): 'ready' | 'empty' | 'skeleton' {
  const lines = snapshot.split('\n').filter((l) => l.trim() !== '');
  const elementCount = lines.length;
  const textLength = lines.reduce((sum, l) => sum + l.replace(/\[.*?\]/g, '').trim().length, 0);

  if (elementCount < 10) return 'empty';
  if (elementCount > 20 && textLength < elementCount * 5) return 'skeleton';
  return 'ready';
}

const PAGE_READY_RETRIES = 2;
const PAGE_READY_WAIT_MS = 2000;

async function safeSnapshot(page: CrawlPage): Promise<string> {
  let snapshot: string;
  try {
    snapshot = (await page.snapshot({ interactive: true, compact: true })).snapshot;
  } catch (firstErr) {
    logger.warn(
      { error: sanitizeErrorText(firstErr instanceof Error ? firstErr.message : 'unknown') },
      'Snapshot failed — retrying',
    );
    await page.waitFor({ timeMs: PAGE_READY_WAIT_MS });
    try {
      snapshot = (await page.snapshot({ interactive: true, compact: true })).snapshot;
    } catch (err) {
      logger.error(
        { error: sanitizeErrorText(err instanceof Error ? err.message : 'unknown') },
        'Snapshot failed after retry',
      );
      return '[Snapshot unavailable — page may be loading]';
    }
  }

  // Wait for page to fully load if it looks empty or skeleton-like
  const state = isPageReady(snapshot);
  if (state !== 'ready') {
    logger.info({ state }, 'Page not ready — waiting for content');
    for (let i = 0; i < PAGE_READY_RETRIES; i++) {
      await page.waitFor({ timeMs: PAGE_READY_WAIT_MS });
      try {
        snapshot = (await page.snapshot({ interactive: true, compact: true })).snapshot;
        if (isPageReady(snapshot) === 'ready') break;
      } catch (retryErr) {
        logger.warn(
          { attempt: i + 1, error: retryErr instanceof Error ? retryErr.message : 'unknown' },
          'Snapshot retry failed during page-ready wait',
        );
      }
    }
  }

  return snapshot;
}

const SKILL_INJECT_MAX_STEP = 2;
const PLAN_INJECT_MAX_STEP = 8;
const HISTORY_RECENT_WINDOW = 10;
const MAX_ACTIONS_PER_STEP = 4;
const REPLAN_CHECK_INTERVAL = 8;
const REPLAN_FAILURE_THRESHOLD = 3;

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

  // Include milestone steps from older history — steps where significant findings were recorded
  const milestones = older.filter(
    (s) =>
      s.action.action === 'navigate' ||
      (s.action.memory !== undefined && s.action.memory.length > 50) ||
      s.action.action === 'type',
  );
  if (milestones.length > 0) {
    out += '  Key earlier milestones:\n';
    for (const m of milestones.slice(-5)) {
      out += `    Step ${String(m.step)}: [${m.action.action}] ${m.action.reasoning.substring(0, 150)}`;
      if (m.url !== undefined) out += ` (${m.url})`;
      out += '\n';
    }
  }

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

function getLastMemory(history: AgentStep[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].action.memory !== undefined && history[i].action.memory !== '') {
      return history[i].action.memory;
    }
  }
  return undefined;
}

interface BuildUserMessageOptions {
  plan?: string | null;
  tabCount?: number;
  domainSkill?: CatalogSkill | null;
  stepsRemaining?: number;
  maxSteps?: number;
  recoveryMessage?: string | null;
  originalPrompt?: string;
}

function buildUserMessage(
  task: string,
  snapshot: string,
  history: AgentStep[],
  url: string,
  title: string,
  opts?: BuildUserMessageOptions,
): string {
  const {
    plan,
    tabCount,
    domainSkill,
    stepsRemaining,
    maxSteps: totalSteps,
    recoveryMessage,
    originalPrompt,
  } = opts ?? {};
  let message = '';
  if (originalPrompt !== undefined && originalPrompt !== task) {
    message += `User prompt: ${originalPrompt}\nTask: ${task}\n`;
  } else {
    message += `Task: ${task}\n`;
  }

  if (plan !== undefined && plan !== null && plan !== '') {
    message += `\nPlan: ${plan}\n`;
  }

  if (stepsRemaining !== undefined && stepsRemaining === 0) {
    message += `\n🚨 FINAL STEP. You MUST use "done" now. Summarize everything you've found — this is your last chance to deliver an answer.\n`;
  } else if (stepsRemaining !== undefined && stepsRemaining <= 10) {
    message += `\n⚠ WARNING: Only ${String(stepsRemaining)} steps remaining. Wrap up now — summarize what you've found and use "done" or "fail".\n`;
  } else if (
    stepsRemaining !== undefined &&
    totalSteps !== undefined &&
    totalSteps > 0 &&
    (totalSteps - stepsRemaining) / totalSteps >= 0.75
  ) {
    message += `\n⚠ You've used 75% of your step budget. Start consolidating your findings. If you have enough data, use "done" soon.\n`;
  }

  if (recoveryMessage !== undefined && recoveryMessage !== null) {
    message += recoveryMessage;
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

  const lastMemory = getLastMemory(history);
  if (lastMemory !== undefined) {
    message += `\n🧠 Your memory from previous steps:\n${lastMemory}\n`;
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

interface ParsedActionItem {
  action: string;
  ref?: string;
  text?: string;
  url?: string;
  key?: string;
  options?: string[];
  direction?: string;
  answer?: string;
}

function parseActions(parsed: Record<string, unknown>): AgentAction[] {
  if (typeof parsed.reasoning !== 'string') {
    throw new Error('Response missing or invalid "reasoning" field — expected a string');
  }

  const thinking = {
    reasoning: parsed.reasoning,
    memory: parsed.memory as string | undefined,
    next_goal: parsed.next_goal as string | undefined,
    evaluation_previous_goal: parsed.evaluation_previous_goal as string | undefined,
  };

  // Support both "actions" array and legacy single "action" field
  let items: ParsedActionItem[];
  if (Array.isArray(parsed.actions)) {
    items = parsed.actions as ParsedActionItem[];
  } else if (typeof parsed.action === 'string') {
    items = [parsed as unknown as ParsedActionItem];
  } else {
    throw new Error('Response missing both "actions" array and "action" field');
  }

  if (items.length === 0) {
    throw new Error('Response "actions" array is empty');
  }

  return items.slice(0, MAX_ACTIONS_PER_STEP).map((item, i) => {
    if (typeof item.action !== 'string') {
      throw new Error(`Action at index ${String(i)} missing "action" field`);
    }
    return {
      action: item.action as AgentAction['action'],
      // Thinking fields only on the first action
      ...(i === 0 ? thinking : { reasoning: `Batch action ${String(i + 1)}: ${item.action}` }),
      answer: item.answer,
      ref: item.ref,
      text: item.text,
      url: item.url,
      key: item.key,
      options: item.options,
      direction: item.direction as AgentAction['direction'],
    };
  });
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

async function getFinalSummary(prompt: string, history: AgentStep[]): Promise<string | undefined> {
  try {
    const lastMemory = getLastMemory(history);
    const steps = history
      .slice(-10)
      .map((s) => `${s.action.action}: ${s.action.reasoning}`)
      .join('\n');
    const result = await llmJson<{ answer: string }>({
      system:
        'The browser agent is being stopped due to repeated failures. Summarize what was accomplished and any partial findings. Respond with JSON: {"answer": "your summary"}',
      message: `Task: ${prompt}\n\nMemory:\n${lastMemory ?? 'none'}\n\nRecent steps:\n${steps}`,
      maxTokens: 512,
    });
    return result.answer;
  } catch {
    logger.warn('Failed to generate final summary');
    return undefined;
  }
}

export interface PageHolder {
  page: CrawlPage;
}

export async function runAgentLoop(
  prompt: string,
  pageOrHolder: CrawlPage | PageHolder,
  emit: (event: string, data: unknown) => void,
  signal: AbortSignal,
  waitForUser?: () => Promise<string>,
  browser?: BrowserClaw,
  domainSkill?: CatalogSkill | null,
  maxSteps = MAX_STEPS,
): Promise<AgentLoopResult> {
  // Accept either a bare CrawlPage or a PageHolder. When a PageHolder is
  // provided the caller's reference is updated on tab switches.
  const holder: PageHolder =
    'page' in pageOrHolder && typeof (pageOrHolder as { page: unknown }).page === 'object'
      ? (pageOrHolder as { page: CrawlPage })
      : { page: pageOrHolder as CrawlPage };
  const history: AgentStep[] = [];
  const startTime = Date.now();
  const tabManager = browser !== undefined ? new TabManager(holder.page) : null;
  let consecutiveParseFailures = 0;
  let consecutiveApiFailures = 0;
  const MAX_PARSE_FAILURES = 3;
  const MAX_API_FAILURES = 3;

  // ── Planning + goal refinement (single LLM call) ──────────────────────────
  // If the prompt is vague (e.g. "find apartments in Chelsea"), the planner
  // also produces a SMART task with clear scope and stopping criteria.
  let refinedPrompt = prompt;
  let planText: string | null = null;
  try {
    let planMessage = `User prompt: ${prompt}`;
    if (domainSkill !== undefined && domainSkill !== null) {
      planMessage += `\n\nWe have a proven skill for this site: "${domainSkill.skill.title}" — ${domainSkill.skill.description}`;
      planMessage += '\nLeverage it — no need to rediscover what already works.';
    }
    const plan = await llmJson<{ task?: string; plan: string }>({
      system: `You are a browser automation planner. Given a user prompt, produce a SMART task and a plan.

Step 1 — Refine the goal into a SMART task:
- If the prompt is vague or open-ended ("find apartments", "look for flights", "show me hotels"), make it specific:
  • Specify what details to extract for each result (price, name, URL, key attributes)
  • Scope to one site or one search
  • Define a clear stopping point: collect results until new ones stop being relevant or distinct, then present findings
  • If the user specified a count, use it. Otherwise, don't pick an arbitrary number — the agent should stop when diminishing returns kick in.
- If the prompt is already specific ("book a flight from NYC to LAX on Dec 15"), return it unchanged.
- Examples:
  • "find apartments in Chelsea" → "Search for apartments in Chelsea on a major listings site. Collect listings with: name/address, price, bedrooms, and URL. Stop when results start repeating or losing relevance."
  • "compare laptops" → "Search for laptops on an electronics site. Compare options by: name, price, specs, and rating. Gather enough to make a meaningful comparison."
  • "book a table at Nobu" → "book a table at Nobu" (already specific)

Step 2 — Create an action plan:
- Navigate directly to the best site for the task — never search Google first.
- For simple tasks (search, click, fill a form): 2-4 steps.
- For complex tasks (research, compare, rank): break into phases.
- If existing skills are provided, incorporate them.

Respond with JSON: {"task": "the SMART task", "plan": "your action plan"}`,
      message: planMessage,
      maxTokens: 512,
    });
    if (plan.task !== undefined && plan.task !== '' && plan.task !== prompt) {
      refinedPrompt = plan.task;
      emit('goal_refined', { original: prompt, refined: refinedPrompt });
      logger.info('Goal refined');
    }
    if (plan.plan !== '') {
      planText = plan.plan;
      emit('plan', { prompt: refinedPrompt, plan: plan.plan });
    }
  } catch {
    logger.error('Failed to generate plan');
  }

  let step = 0;
  let recentFailureCount = 0;
  while (step < maxSteps) {
    if (signal.aborted) {
      return {
        success: false,
        steps: history,
        error: 'Session aborted',
        duration_ms: Date.now() - startTime,
      };
    }

    if (await detectPopup(holder.page)) {
      await dismissPopup(holder.page);
    }

    let snapshot = await safeSnapshot(holder.page);
    const url = await holder.page.url();
    const title = await holder.page.title();

    const domText = await getPageText(holder.page);
    const antiBotType = detectAntiBot(domText);
    if (antiBotType !== null) {
      snapshot = enrichSnapshot(snapshot, domText, antiBotType);
    }

    emit('thinking', { step, message: `Analyzing page: ${title}` });

    // --- Re-planning checkpoint ---
    // Every REPLAN_CHECK_INTERVAL steps, if we've had enough failures since the last
    // checkpoint, generate a fresh plan. Always reset the counter at each checkpoint
    // so stale failures from earlier intervals don't trigger spurious replans.
    if (step > 0 && step % REPLAN_CHECK_INTERVAL === 0) {
      const shouldReplan = recentFailureCount >= REPLAN_FAILURE_THRESHOLD;
      recentFailureCount = 0; // Reset regardless — this is a per-interval counter
      if (shouldReplan) {
        try {
          const lastMemory = getLastMemory(history);
          const recentSummary = history
            .slice(-6)
            .map(
              (s) =>
                `${s.action.action}${s.action.error_feedback !== undefined ? '(FAILED)' : ''}: ${s.action.reasoning}`,
            )
            .join('\n');

          const replan = await llmJson<{ plan: string }>({
            system: `You are a browser automation planner. The agent is stuck and needs a new plan.
Analyze what's been tried, what failed, and suggest a DIFFERENT approach.
Don't repeat strategies that already failed. Be creative — try different site sections, different URLs, different interaction patterns.
Respond with JSON: {"plan": "your revised plan here"}`,
            message: `Original task: ${refinedPrompt}\n\nOriginal plan: ${planText ?? 'none'}\n\nCurrent page: ${title} (${url})\n\nMemory: ${lastMemory ?? 'none'}\n\nRecent actions:\n${recentSummary}\n\nStep ${String(step)} of ${String(maxSteps)} — failures detected in last interval.`,
            maxTokens: 256,
          });
          if (replan.plan !== '') {
            planText = replan.plan;
            emit('replan', { step, plan: replan.plan });
            logger.info({ step }, 'Agent re-planned');
          }
        } catch {
          logger.warn('Re-planning failed');
        }
      }
    }

    // --- Recovery diagnosis (check every 4 steps to avoid flooding the LLM context) ---
    let recoveryMessage: string | null = null;
    if (step > 0 && step % 4 === 0) {
      const recovery = diagnoseStuckAgent(history, url);
      if (recovery !== null) {
        recoveryMessage = formatRecovery(recovery);
        logger.info({ step, diagnosis: recovery.diagnosis }, 'Recovery strategy triggered');
      }
    }

    let tabCount: number | undefined;
    if (browser !== undefined) {
      try {
        tabCount = (await browser.tabs()).length;
      } catch (err) {
        logger.warn(
          { error: sanitizeErrorText(err instanceof Error ? err.message : 'unknown') },
          'Failed to get tab count',
        );
      }
    }
    const skillForStep = step <= SKILL_INJECT_MAX_STEP ? domainSkill : undefined;
    // Keep plan available for longer — it's cheap context and prevents drift
    const planForStep = step <= PLAN_INJECT_MAX_STEP ? planText : null;
    const stepsRemaining = maxSteps - step - 1;
    const userMessage = buildUserMessage(refinedPrompt, snapshot, history, url, title, {
      plan: planForStep,
      tabCount,
      domainSkill: skillForStep,
      stepsRemaining,
      maxSteps,
      recoveryMessage,
      originalPrompt: prompt,
    });

    // On the last step, force the agent to produce a final answer
    const isLastStep = stepsRemaining === 0;
    const systemPrompt = isLastStep ? LAST_STEP_PROMPT : SYSTEM_PROMPT;

    let actions: AgentAction[];
    try {
      const parsed = await llmJson<Record<string, unknown>>({
        system: systemPrompt,
        message: userMessage,
        maxTokens: LLM_MAX_TOKENS,
      });
      try {
        actions = parseActions(parsed);
      } catch (parseErr) {
        throw new LlmParseError(
          parseErr instanceof Error ? parseErr.message : 'Invalid action structure',
          JSON.stringify(parsed).slice(0, 200),
        );
      }
      consecutiveParseFailures = 0;
      consecutiveApiFailures = 0;
      logger.info(
        { step, actionCount: actions.length, firstAction: actions[0].action, reasoning: actions[0].reasoning },
        'Agent step',
      );

      const loopNudge = detectLoop(actions[0], history);
      if (loopNudge !== null) {
        logger.warn({ step, level: loopNudge.level }, 'Loop nudge');
        actions[0].error_feedback = loopNudge.message;
        recentFailureCount++;
      }
    } catch (err) {
      if (err instanceof LlmParseError) {
        // LLM responded but not with valid JSON — burn a step, the call was made
        consecutiveParseFailures++;
        logger.warn(
          { step, attempt: consecutiveParseFailures, maxAttempts: MAX_PARSE_FAILURES },
          'LLM returned non-JSON response',
        );
        emit('step_error', { step, error: 'LLM response was not valid JSON', type: 'parse_error' });
        if (consecutiveParseFailures >= MAX_PARSE_FAILURES) {
          const answer = await getFinalSummary(refinedPrompt, history);
          return {
            success: false,
            steps: history,
            answer,
            error: 'The AI could not process this page correctly. Partial findings may be available above.',
            duration_ms: Date.now() - startTime,
          };
        }
        step++;
        continue;
      }

      // API/network error — don't burn a step, the agent never got to act
      consecutiveApiFailures++;
      const apiError = sanitizeErrorText(err instanceof Error ? err.message : 'LLM API call failed');
      logger.error(
        { step, attempt: consecutiveApiFailures, maxAttempts: MAX_API_FAILURES },
        `LLM API error: ${apiError}`,
      );
      emit('step_error', { step, error: `AI service error: ${apiError}`, type: 'api_error' });
      if (consecutiveApiFailures >= MAX_API_FAILURES) {
        return {
          success: false,
          steps: history,
          error: `Unable to reach the AI service after ${String(MAX_API_FAILURES)} attempts. Please try again.`,
          duration_ms: Date.now() - startTime,
        };
      }
      continue;
    }

    // Execute batch of actions sequentially
    for (const action of actions) {
      if (step >= maxSteps) break;

      const agentStep: AgentStep = {
        step,
        action,
        url: await holder.page.url(),
        page_title: await holder.page.title(),
        timestamp: new Date().toISOString(),
      };

      history.push(agentStep);

      emit('step', {
        step,
        action: action.action,
        reasoning: action.reasoning,
        memory: action.memory,
        next_goal: action.next_goal,
        evaluation_previous_goal: action.evaluation_previous_goal,
        url: agentStep.url,
        page_title: agentStep.page_title,
      });

      // --- Terminal actions ---

      if (action.action === 'done') {
        return {
          success: true,
          steps: history,
          answer: action.answer,
          duration_ms: Date.now() - startTime,
          final_url: agentStep.url,
        };
      }

      if (action.action === 'fail') {
        return {
          success: false,
          steps: history,
          error: action.reasoning,
          duration_ms: Date.now() - startTime,
          final_url: agentStep.url,
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
        step++;
        break; // Need new snapshot after user response
      }

      // --- Special actions (break batch — need new snapshot) ---

      if (action.action === 'press_and_hold') {
        await pressAndHold(holder.page);
        step++;
        break;
      }

      if (action.action === 'click_cloudflare') {
        await clickCloudflareCheckbox(holder.page);
        step++;
        break;
      }

      // --- Normal actions ---

      try {
        await executeAction(action, holder.page);

        // After typing, detect autocomplete/combobox fields
        if (action.action === 'type') {
          await holder.page.waitFor({ timeMs: 400 });
          try {
            const postTypeSnapshot = (await holder.page.snapshot({ interactive: true, compact: true })).snapshot;
            if (/combobox|listbox|aria-autocomplete|suggestion|dropdown/i.test(postTypeSnapshot)) {
              agentStep.action.error_feedback =
                'AUTOCOMPLETE DETECTED: A dropdown/suggestion list appeared after typing. Wait for it to fully load, then click the correct suggestion. Do NOT press Enter.';
              step++;
              break; // Break batch — agent needs to see the dropdown
            }
          } catch (snapErr) {
            logger.warn(
              { error: sanitizeErrorText(snapErr instanceof Error ? snapErr.message : 'unknown') },
              'Post-type snapshot failed',
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Action execution failed';
        logger.error({ step, action: action.action, error: message }, 'Action execution failed');
        emit('step_error', { step, action: action.action, error: message });
        agentStep.action.error_feedback = message;
        recentFailureCount++;
        await holder.page.waitFor({ timeMs: 1000 });

        if (await detectPopup(holder.page)) {
          await dismissPopup(holder.page);
        }
        step++;
        break; // Break batch on failure — need new snapshot
      }

      // Check for new tabs after click
      if (tabManager !== null && browser !== undefined && action.action === 'click') {
        const newPage = await tabManager.checkForNewTab(browser);
        if (newPage !== null) {
          try {
            const newUrl = await newPage.url();
            const newTitle = await newPage.title();
            if (newUrl === '' || newUrl === 'about:blank') {
              logger.info('tab-manager: new tab URL is empty — staying on current page');
            } else {
              holder.page = newPage;
              history.push({
                step,
                action: { action: 'navigate', reasoning: `Click opened a new tab: ${newTitle}` },
                url: newUrl,
                page_title: newTitle,
                timestamp: new Date().toISOString(),
              });
            }
          } catch (tabErr) {
            logger.info(
              { error: tabErr instanceof Error ? tabErr.message : 'unknown' },
              'tab-manager: new tab not accessible, staying on current page',
            );
          }
          step++;
          break; // New tab opened — need new snapshot
        }
      }

      const waitMs = getWaitMs(action.action);
      await holder.page.waitFor({ timeMs: waitMs });
      step++;
    }
  }

  // maxSteps reached — get a final summary of what was accomplished
  logger.warn({ steps: history.length, maxSteps }, 'Agent hit step limit');
  const summary = await getFinalSummary(refinedPrompt, history);
  return {
    success: false,
    steps: history,
    answer: summary,
    error: `Reached maximum step limit (${String(maxSteps)})`,
    duration_ms: Date.now() - startTime,
    final_url: history.length > 0 ? history[history.length - 1].url : undefined,
  };
}
