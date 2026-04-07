import type { CrawlPage, BrowserClaw } from 'browserclaw';
import { pressAndHold, detectAntiBot, enrichSnapshot, getPageText } from './skills/press-and-hold.js';
import { clickCloudflareCheckbox } from './skills/cloudflare-checkbox.js';
import { detectPopup, dismissPopup } from './skills/dismiss-popup.js';
import { detectLoop } from './skills/loop-detection.js';
import { detectPageState, shouldBlockDone } from './skills/page-state.js';
import { diagnoseStuckAgent, formatRecovery } from './skills/recovery.js';
import { TabManager } from './skills/tab-manager.js';
import { getCdpBaseUrl, activateCdpTarget } from './skills/cdp-utils.js';
import { llmJson, llmVision, sanitizeErrorText } from './llm.js';
import { getLesson, formatLessonForPrompt } from './lesson-store.js';
import { LlmParseError } from './types.js';
import type { AgentAction, AgentStep, AgentLoopResult, AgentProgress, CatalogSkill, TaskLesson } from './types.js';
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
  "evaluation_previous_goal": "Did the previous action succeed? What changed? What went wrong? Check the outcome feedback from the last step. (skip on first step)",
  "memory": "Running scratchpad of ALL accumulated data: names, prices, URLs, findings, comparisons. Carry forward everything from previous memory — never drop data. This is your only persistent storage between steps.",
  "progress": {
    "completed": ["short descriptions of completed phases/milestones"],
    "current": "what you're working on right now",
    "blocked_by": "what's blocking you, or null"
  },
  "next_goal": "What you will do next and why — one clear sentence",
  "reasoning": "Brief explanation of what you're doing right now",
  "actions": [
    {
      "action": "click" | "type" | "navigate" | "back" | "select" | "scroll" | "keyboard" | "wait" | "press_and_hold" | "click_cloudflare" | "extract" | "switch_tab" | "close_tab" | "ask_user" | "done" | "fail",
      "ref": "element ref number (for click, type, select)",
      "text": "text to type (for type) or question (for ask_user)",
      "url": "URL (for navigate)",
      "key": "key name (for keyboard) — e.g. Enter, Escape, Tab, ArrowDown, ArrowUp",
      "options": ["values (for select)"],
      "direction": "up" | "down" (for scroll),
      "expression": "JavaScript expression to evaluate (for extract) — e.g. 'Array.from(document.querySelectorAll(\".price\")).map(el => el.textContent)'",
      "tab_id": "target ID of the tab to switch to or close (for switch_tab / close_tab)",
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
- After typing in a search or autocomplete field, wait — then check for dropdown suggestions and click the matching option.
- After typing in a filter or form field (price, date, quantity), press Enter or click the submit/apply/search button to apply the value. Don't just type and move on — filters don't take effect until submitted.
- "keyboard" to press special keys: Enter (submit forms), Escape (close dropdowns/dialogs/popups/date pickers/calendars), Tab (move between fields), ArrowDown/ArrowUp (navigate dropdowns).
- If a popup, modal, date picker, calendar widget, or overlay is blocking the UI, dismiss it immediately: click its "Cancel", "Close", or "X" button, or use "keyboard" with "Escape". Do NOT try to click elements behind a blocking overlay — dismiss the overlay first.
- "back" to go back in browser history. Use this instead of manually tracking URLs when you need to return to the previous page.
- "press_and_hold" for press-and-hold anti-bot challenges. Wait after, check if it worked. If the challenge cleared but the page still looks the same (no new content loaded), refresh the page by navigating to the current URL. Try twice before asking user.
- "click_cloudflare" for Cloudflare security checks ("Verify you are human" checkbox). The system will find and click the checkbox. Wait after, check if it worked. Try twice before asking user.
- "extract" when the accessibility snapshot is missing data you need — prices, descriptions, table values, form field values, counts, or any text that's visually on the page but absent from the snapshot. Provide a JavaScript expression; the result appears in the next step. Examples: 'document.querySelector(".price")?.textContent', 'Array.from(document.querySelectorAll("td")).map(el=>el.textContent.trim())'. Use this like a human would: when you can see there's content but can't read it from the snapshot.
- "switch_tab" to switch to a different open tab. Use the tab_id from the tab list shown in the context. Use this when a link opened a new tab and you want to return to a previous one, or when the information you need is in a different tab.
- "close_tab" to close a tab by tab_id. Use only when a tab is no longer needed.
- Perception ladder: use the cheapest sufficient method first — accessibility snapshot -> DOM text -> extract -> screenshot fallback -> ask_user.
- "ask_user" only when you need info you can't get from the page (MFA codes, credentials, preferences).
- "done" when finished. Include "answer" if the task asked a question — be specific with what you found. Before done, verify you actually satisfied the task.
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
- Listing detail pages often have data spread across the page — scroll through the ENTIRE page to find price, address, bedrooms, bathrooms, square footage, etc. Don't leave a detail page until you've captured all key attributes.
- If data appears in a structured format (tables, data grids, key-value pairs), read the snapshot carefully — the data is there but may be split across multiple lines.
- When a listing page shows "See more" or "Show details" buttons, click them before extracting data — hidden sections often contain the most important information.

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

Filters and search:
- After applying any filter (price, date, location, amenity), ALWAYS submit it: press Enter, click "Apply" or "Search".
- After submitting, VERIFY the filter took effect in the NEXT snapshot. Check that results actually changed — prices should be within range, locations should match, etc. If results still show items outside your filter (e.g. you set max $4,200 but see $6,000+ listings), the filter did NOT work. Try again: clear the field, re-type, and submit differently (try a different button, or add the filter to the URL).
- Do NOT proceed to browse results until you have confirmed filters are active. Browsing unfiltered results wastes every subsequent step.
- If the filter controls you need aren't visible after 2 scrolls, they probably don't exist on this page. Use URL parameters instead (e.g. ?max_price=4200) or verify criteria on individual listing pages.
- Don't waste steps hunting for perfect filter UI. URL parameters + manual verification on detail pages beats endlessly searching for filter controls that may not exist.

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

Site blocking — when to move on:
- If a site shows anti-bot challenges (press-and-hold, Cloudflare, CAPTCHA) more than once, the site is actively blocking automation. Do NOT waste more steps — navigate to a different site that has the same information.
- If clicks keep failing, the page is mostly empty after loading, or you're getting access-denied/403 pages — the site is hostile. Move on immediately.
- There are always multiple sites with the same information. Real estate: Zillow, Apartments.com, Realtor.com, Redfin. Flights: Google Flights, Kayak, Skyscanner. Hotels: Booking.com, Hotels.com, Google Hotels. Shopping: Amazon, Google Shopping, Best Buy.
- When moving to a new site, navigate directly to it with your search criteria in the URL if possible (e.g. apartments.com/chelsea-new-york-ny).

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

const DOM_TEXT_SPARSE_THRESHOLD = 400;

/**
 * Last-resort fallback: when both the a11y snapshot and DOM text are sparse
 * (canvas-rendered, cross-origin iframes, unusual rendering), take a screenshot
 * and use vision to extract visible text and data.
 */
async function screenshotFallback(page: CrawlPage, snapshot: string): Promise<string> {
  try {
    const buf = await page.screenshot();
    const base64 = buf.toString('base64');
    const extracted = await llmVision(
      'Extract all visible text, data, prices, labels, and content from this screenshot. Return plain text — no commentary, no formatting, just what you see.',
      'What text and data is visible on this page?',
      base64,
    );
    if (extracted.trim().length > 50) {
      logger.info('Screenshot fallback: injecting vision-extracted content into snapshot');
      return `${snapshot}\n\n[VISION EXTRACTED — snapshot was sparse, data below from screenshot]\n${extracted}`;
    }
  } catch {
    logger.warn('Screenshot fallback failed');
  }
  return snapshot;
}

async function isBrowserAlive(page: CrawlPage): Promise<boolean> {
  try {
    await page.url();
    return true;
  } catch {
    return false;
  }
}

const SKILL_INJECT_MAX_STEP = 2;
const PLAN_INJECT_MAX_STEP = 8;
const HISTORY_RECENT_WINDOW = 8;
const MAX_ACTIONS_PER_STEP = 4;
const REPLAN_BASE_INTERVAL = 8;
const REPLAN_FAILURE_THRESHOLD = 3;
const CONTEXT_COMPRESS_INTERVAL = 20;

function truncateHistory(history: AgentStep[], contextSummary?: string): string {
  if (history.length <= HISTORY_RECENT_WINDOW) {
    let out = 'Previous actions:\n';
    for (const step of history) {
      out += formatStep(step);
    }
    return out;
  }

  const recent = history.slice(history.length - HISTORY_RECENT_WINDOW);

  let out = `Previous actions (${String(history.length)} total, showing last ${String(HISTORY_RECENT_WINDOW)} in detail):\n`;

  if (contextSummary !== undefined && contextSummary !== '') {
    out += `  Session context: ${contextSummary}\n\n`;
  } else {
    // Fall back to arrow-chain summary when no compressed context available
    const older = history.slice(0, history.length - HISTORY_RECENT_WINDOW);
    out += '  Earlier steps summary: ';
    out += older.map((s) => `${s.action.action}${s.action.error_feedback !== undefined ? '(FAILED)' : ''}`).join(' → ');
    out += '\n';

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

    const lastOlderStep = older[older.length - 1];
    out += `  [Context from step ${String(lastOlderStep.step)}]: ${lastOlderStep.action.reasoning.substring(0, 300)}\n\n`;
  }

  for (const step of recent) {
    out += formatStep(step);
  }
  return out;
}

function formatStep(step: AgentStep): string {
  let line = `  Step ${String(step.step)}: ${step.action.action} — ${step.action.reasoning}\n`;
  if (step.action.extract_result !== undefined) {
    const preview = step.action.extract_result.slice(0, 500);
    const truncated = step.action.extract_result.length > 500 ? '…(truncated)' : '';
    line += `    📊 Extracted: ${preview}${truncated}\n`;
  }
  if (step.outcome !== undefined) {
    line += `    → Outcome: ${step.outcome}\n`;
  }
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

type ContextLevel = 'full' | 'reduced' | 'minimal';

interface TabInfo {
  targetId: string;
  title: string;
  url: string;
}

interface BuildUserMessageOptions {
  plan?: string | null;
  tabCount?: number;
  tabs?: TabInfo[];
  pageState?: string;
  domainSkill?: CatalogSkill | null;
  taskLesson?: TaskLesson | null;
  stepsRemaining?: number;
  maxSteps?: number;
  recoveryMessage?: string | null;
  contextSummary?: string;
  progress?: AgentProgress | null;
  contextLevel?: ContextLevel;
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
    tabs,
    pageState,
    domainSkill,
    taskLesson,
    stepsRemaining,
    maxSteps: totalSteps,
    recoveryMessage,
    contextSummary,
    progress,
    contextLevel = 'full',
  } = opts ?? {};
  let message = `Task: ${task}\n`;

  // In reduced/minimal mode, drop plan and playbook to shrink context
  if (contextLevel === 'full' && plan !== undefined && plan !== null && plan !== '') {
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
  } else if (
    stepsRemaining !== undefined &&
    totalSteps !== undefined &&
    totalSteps > 0 &&
    (totalSteps - stepsRemaining) / totalSteps >= 0.5
  ) {
    message += `\nℹ Halfway through your step budget. Make sure you're making progress toward the goal.\n`;
  }

  if (taskLesson !== undefined && taskLesson !== null) {
    const lessonText = formatLessonForPrompt(taskLesson);
    if (lessonText !== '') {
      message += `\n${lessonText}\n`;
    }
  }

  if (recoveryMessage !== undefined && recoveryMessage !== null) {
    message += recoveryMessage;
  }

  if (contextLevel === 'full' && domainSkill !== undefined && domainSkill !== null) {
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
    if (domainSkill.skill.what_worked !== undefined && domainSkill.skill.what_worked.length > 0) {
      message += '\nWhat worked before:\n';
      for (const w of domainSkill.skill.what_worked) {
        message += `  - ${w}\n`;
      }
    }
    if (domainSkill.skill.failure_notes !== undefined && domainSkill.skill.failure_notes.length > 0) {
      message += '\n⚠ Known failure modes (avoid these):\n';
      for (const note of domainSkill.skill.failure_notes) {
        message += `  - ${note}\n`;
      }
    }
    message += '--- END PLAYBOOK ---\n';
  }

  // Progress tracking — structured view of where the agent is
  if (progress !== undefined && progress !== null) {
    message += '\n📊 Progress:\n';
    if (progress.completed.length > 0) {
      message += `  Completed: ${progress.completed.join(' → ')}\n`;
    }
    message += `  Current: ${progress.current}\n`;
    if (progress.blocked_by !== null) {
      message += `  ⚠ Blocked by: ${progress.blocked_by}\n`;
    }
  }

  const lastMemory = getLastMemory(history);
  if (lastMemory !== undefined) {
    message += `\n🧠 Your memory from previous steps:\n${lastMemory}\n`;
  }

  message += `\nCurrent page: ${title}\nURL: ${url}\n`;
  if (tabs !== undefined && tabs.length > 1) {
    message += `Open tabs (${String(tabs.length)}):\n`;
    for (const tab of tabs) {
      message += `  [${tab.targetId}] ${tab.title} — ${tab.url}\n`;
    }
  } else if (tabCount !== undefined && tabCount > 1) {
    message += `Open tabs: ${String(tabCount)}\n`;
  }
  if (pageState !== undefined && pageState !== '') {
    message += `Detected page state: ${pageState}\n`;
  }
  message += '\n';

  if (contextLevel === 'minimal') {
    // Strip history entirely — just task + snapshot
  } else if (history.length > 0) {
    if (contextLevel === 'reduced') {
      // Show history but strip error_feedback noise to reduce context
      const stripped = history.map((s) => ({
        ...s,
        action: { ...s.action, error_feedback: undefined },
      }));
      message += truncateHistory(stripped as typeof history, contextSummary);
    } else {
      message += truncateHistory(history, contextSummary);
    }
    message += '\n';
  }

  if (contextLevel !== 'minimal') {
    const alertLines = snapshot
      .split('\n')
      .filter((line) => /\b(alert|status|dialog|banner|toast|notification|error|warning)\b/i.test(line))
      .map((line) => line.trim())
      .filter(Boolean);

    if (alertLines.length > 0) {
      message += `⚠ Active alerts/notifications on page:\n${alertLines.join('\n')}\n\n`;
    }
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
  expression?: string;
  tab_id?: string;
  confidence?: string;
  answer?: string;
}

function parseProgress(parsed: Record<string, unknown>): AgentProgress | null {
  const raw = parsed.progress;
  if (raw === undefined || raw === null || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  return {
    completed: Array.isArray(p.completed) ? (p.completed as string[]) : [],
    current: typeof p.current === 'string' ? p.current : '',
    blocked_by: typeof p.blocked_by === 'string' && p.blocked_by !== 'null' ? p.blocked_by : null,
  };
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
      expression: item.expression,
      tab_id: item.tab_id,
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
    case 'extract':
    case 'switch_tab':
    case 'close_tab':
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
    case 'extract':
    case 'switch_tab':
    case 'close_tab':
    case 'done':
    case 'fail':
    case 'ask_user':
      return WAIT_AFTER_OTHER_MS;
  }
}

function describeActionError(action: AgentAction, err: unknown): string {
  const raw = err instanceof Error ? err.message : 'Action execution failed';
  const lower = raw.toLowerCase();
  if (action.action === 'click' || action.action === 'type' || action.action === 'select') {
    if (lower.includes('not found') || lower.includes('no element'))
      return `Element ref ${action.ref ?? '?'} not found — it may have been removed by a page update or is outside the visible area. Try scrolling or re-reading the page.`;
    if (lower.includes('intercept') || lower.includes('covered') || lower.includes('obscured'))
      return `Click on ref ${action.ref ?? '?'} was intercepted by another element covering it — dismiss any overlays or popups first.`;
    if (lower.includes('detach') || lower.includes('stale'))
      return `Element ref ${action.ref ?? '?'} became stale — the page content changed. Take a new snapshot and find the updated element.`;
    if (lower.includes('disabled') || lower.includes('not interactable'))
      return `Element ref ${action.ref ?? '?'} is disabled or not interactable — check if a prerequisite field needs to be filled first.`;
  }
  if (action.action === 'navigate') {
    if (lower.includes('timeout') || lower.includes('timed out'))
      return `Navigation to ${action.url ?? 'URL'} timed out — the page may be loading slowly or the URL may be incorrect.`;
    if (lower.includes('err_name_not_resolved') || lower.includes('dns'))
      return `Could not resolve ${action.url ?? 'URL'} — the domain may be incorrect. Double-check the URL.`;
    if (lower.includes('refused') || lower.includes('blocked'))
      return `Connection to ${action.url ?? 'URL'} was refused or blocked. Try a different URL or approach.`;
  }
  return raw;
}

function validateAction(
  action: AgentAction,
  preUrl: string,
  postUrl: string,
  preSnapshotLength: number,
  postSnapshotLength: number,
): string | undefined {
  const urlChanged = preUrl !== postUrl;
  const sizeDelta = postSnapshotLength - preSnapshotLength;
  const significantChange = Math.abs(sizeDelta) > preSnapshotLength * 0.1;

  switch (action.action) {
    case 'click':
      if (urlChanged) return `Navigated to new page: ${postUrl}`;
      if (significantChange) return 'Page content changed after click';
      return 'Click executed — no visible page change detected. Element may have toggled state, or the click had no effect.';
    case 'type':
      return undefined; // Autocomplete detection already handles type validation
    case 'navigate':
      if (urlChanged) return `Navigated to: ${postUrl}`;
      return 'Navigate executed but URL unchanged — page may have redirected back.';
    case 'scroll':
      return undefined; // Scrolls are always "successful"
    case 'select':
      return 'Selection made';
    case 'keyboard':
      if (urlChanged) return `Key press triggered navigation to: ${postUrl}`;
      if (significantChange) return 'Page content changed after key press';
      return undefined;
    case 'back':
    case 'wait':
    case 'done':
    case 'fail':
    case 'ask_user':
    case 'press_and_hold':
    case 'click_cloudflare':
    case 'extract':
    case 'switch_tab':
    case 'close_tab':
      return undefined;
  }
}

async function compressContext(
  prompt: string,
  history: AgentStep[],
  currentProgress: AgentProgress | null,
): Promise<string> {
  try {
    const stepSummaries = history
      .map(
        (s) =>
          `Step ${String(s.step)}: [${s.action.action}] ${s.action.reasoning}${s.action.error_feedback !== undefined ? ' (FAILED)' : ''}${s.outcome !== undefined ? ` → ${s.outcome}` : ''}`,
      )
      .join('\n');

    const progressStr =
      currentProgress !== null
        ? `\nProgress: completed=[${currentProgress.completed.join(', ')}], current="${currentProgress.current}", blocked_by=${currentProgress.blocked_by ?? 'none'}`
        : '';

    const result = await llmJson<{ summary: string }>({
      system: `Summarize this browser automation session into a compact context block. Include:
1. Task progress — what has been accomplished so far
2. Key findings — data, URLs, names, prices discovered
3. Failed approaches — what was tried and didn't work (so we don't repeat)
4. Current strategy — what the agent is doing now and why
Be concise but preserve all important data points. Respond with JSON: {"summary": "your summary"}`,
      message: `Task: ${prompt}${progressStr}\n\nFull history (${String(history.length)} steps):\n${stepSummaries}`,
      maxTokens: 1024,
    });
    return result.summary;
  } catch {
    logger.warn('Context compression failed — falling back to simple truncation');
    return '';
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
  let crossSiteParseFailures = 0;
  let consecutiveApiFailures = 0;
  const MAX_PARSE_FAILURES_PER_SITE = 5;
  const MAX_CROSS_SITE_PARSE_FAILURES = 8;
  const MAX_API_FAILURES = 3;
  const MAX_SITE_SWITCHES = 3;
  let siteSwitchCount = 0;
  let consecutiveRecoveryCount = 0;
  let lastRecoveryDomain: string | null = null;
  let pendingSiteSwitch: string | null = null;
  let duplicateMemoryCount = 0;

  const forceComplete = async (reason: string): Promise<AgentLoopResult> => {
    logger.warn({ step, reason }, 'Force-completing run');
    const answer = await getFinalSummary(refinedPrompt, history);
    const doneAction: AgentAction = {
      action: 'done',
      reasoning: reason,
      answer,
    };
    const currentUrl = await holder.page.url();
    history.push({
      step,
      action: doneAction,
      url: currentUrl,
      page_title: await holder.page.title(),
      timestamp: new Date().toISOString(),
    });
    emit('step', { step, action: 'done', reasoning: reason, answer });
    return {
      success: true,
      steps: history,
      answer,
      duration_ms: Date.now() - startTime,
      final_url: currentUrl,
    };
  };

  // ── Load task lessons ──────────────────────────────────────────────────────
  let taskLesson: TaskLesson | null = null;
  try {
    taskLesson = await getLesson(prompt);
    if (taskLesson !== null) {
      const blocked = taskLesson.domains.filter((d) => d.status === 'blocked').length;
      const worked = taskLesson.domains.filter((d) => d.status === 'worked').length;
      logger.info({ blocked, worked, hash: taskLesson.task_hash }, 'Loaded task lessons');
    }
  } catch (err) {
    logger.error({ err }, 'Failed to load task lessons');
  }

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
    if (taskLesson !== null) {
      const lessonText = formatLessonForPrompt(taskLesson);
      if (lessonText !== '') {
        planMessage += `\n\n${lessonText}\nDo NOT navigate to blocked domains. Use alternatives that worked before.`;
      }
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
  let replanInterval = REPLAN_BASE_INTERVAL;
  let nextReplanStep = replanInterval;
  let contextSummary = '';
  let lastProgress: AgentProgress | null = null;
  let lastDomain = '';
  let lastScreenshotStep = -3; // throttle: skip if fired within last 3 steps
  while (step < maxSteps) {
    if (signal.aborted) {
      return {
        success: false,
        steps: history,
        error: 'Session aborted',
        duration_ms: Date.now() - startTime,
      };
    }

    if (!(await isBrowserAlive(holder.page))) {
      logger.error({ step }, 'Browser connection lost');
      emit('failed', { step, error: 'Browser connection lost' });
      return {
        success: false,
        steps: history,
        error: 'Browser connection lost',
        duration_ms: Date.now() - startTime,
        final_url: history.length > 0 ? history[history.length - 1].url : undefined,
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
    const pageState = detectPageState({ snapshot, domText, title, url, antiBotType });

    // #5 Screenshot fallback: when a11y snapshot and DOM text are both sparse,
    // take a screenshot and use vision to extract what's visually present.
    // Throttled to at most once every 3 steps to avoid expensive repeated calls.
    if (
      antiBotType === null &&
      isPageReady(snapshot) === 'skeleton' &&
      domText.trim().length < DOM_TEXT_SPARSE_THRESHOLD &&
      step - lastScreenshotStep >= 3
    ) {
      lastScreenshotStep = step;
      snapshot = await screenshotFallback(holder.page, snapshot);
    }

    emit('thinking', { step, message: `Analyzing page: ${title}` });

    // --- Context compression ---
    if (step > 0 && step % CONTEXT_COMPRESS_INTERVAL === 0) {
      contextSummary = await compressContext(refinedPrompt, history, lastProgress);
      if (contextSummary !== '') {
        logger.info({ step }, 'Context compressed');
        emit('context_compressed', { step, summary_length: contextSummary.length });
      }
    }

    // --- Domain change detection (proactive replanning trigger) ---
    let domainChanged = false;
    try {
      const currentDomain = new URL(url).hostname;
      if (lastDomain !== '' && currentDomain !== lastDomain) {
        domainChanged = true;
      }
      lastDomain = currentDomain;
    } catch {
      // URL may not be parseable (about:blank etc.)
    }

    // --- Re-planning checkpoint ---
    // Uses adaptive intervals: extends when healthy, contracts on failures.
    // Also triggers on domain changes (proactive).
    const atReplanCheckpoint = step > 0 && step >= nextReplanStep;
    const shouldReplan =
      (atReplanCheckpoint && recentFailureCount >= REPLAN_FAILURE_THRESHOLD) || (domainChanged && step > 4);

    if (atReplanCheckpoint) {
      if (recentFailureCount < REPLAN_FAILURE_THRESHOLD) {
        replanInterval = Math.min(replanInterval + 4, 20); // Extend interval when healthy
      } else {
        replanInterval = Math.max(replanInterval - 2, 6); // Contract interval on failures
      }
      nextReplanStep = step + replanInterval;
      recentFailureCount = 0;
    }

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

        const progressContext =
          lastProgress !== null
            ? `\nProgress: completed=[${lastProgress.completed.join(', ')}], current="${lastProgress.current}"${lastProgress.blocked_by !== null ? `, blocked_by="${lastProgress.blocked_by}"` : ''}`
            : '';
        const replanReason = domainChanged
          ? 'navigated to a different site/section'
          : 'failures detected in last interval';

        const replan = await llmJson<{ plan: string }>({
          system: `You are a browser automation planner. The agent needs a new plan.
Analyze what's been tried, what failed, and suggest a DIFFERENT approach.
Don't repeat strategies that already failed. Be creative — try different site sections, different URLs, different interaction patterns.
Include a specific alternative strategy, not just "try something different".
IMPORTANT: If the agent hit anti-bot challenges (press_and_hold, click_cloudflare, CAPTCHA), the current site is blocking automation. Your new plan MUST use a completely different website. Navigate directly to the alternative with search criteria in the URL.
Respond with JSON: {"plan": "your revised plan here"}`,
          message: `Original task: ${refinedPrompt}\n\nOriginal plan: ${planText ?? 'none'}\n\nCurrent page: ${title} (${url})${progressContext}\n\nMemory: ${lastMemory ?? 'none'}\n\nRecent actions:\n${recentSummary}\n\nStep ${String(step)} of ${String(maxSteps)} — ${replanReason}.`,
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

    // --- Recovery diagnosis (only when the agent is struggling) ---
    let recoveryMessage: string | null = null;
    if (step > 0 && step % 4 === 0 && recentFailureCount > 0) {
      const recovery = diagnoseStuckAgent(history, url);
      if (recovery !== null) {
        recoveryMessage = formatRecovery(recovery);
        logger.info({ step, diagnosis: recovery.diagnosis }, 'Recovery strategy triggered');

        let currentDomain: string;
        try {
          currentDomain = new URL(url).hostname;
        } catch {
          currentDomain = url;
        }
        if (currentDomain === lastRecoveryDomain) {
          consecutiveRecoveryCount++;
        } else {
          consecutiveRecoveryCount = 1;
          lastRecoveryDomain = currentDomain;
        }

        if (consecutiveRecoveryCount >= 3) {
          siteSwitchCount++;
          logger.warn(
            { step, domain: currentDomain, recoveries: consecutiveRecoveryCount, switchCount: siteSwitchCount },
            'Switching sites: repeated recovery on same domain',
          );
          if (siteSwitchCount > MAX_SITE_SWITCHES) {
            return await forceComplete(
              `Exhausted ${String(MAX_SITE_SWITCHES)} site switches — presenting partial results`,
            );
          }
          consecutiveRecoveryCount = 0;
          lastRecoveryDomain = null;
          recoveryMessage += `\n\n🔄 SITE SWITCH REQUIRED: You have been stuck on ${currentDomain} for too long. You MUST navigate to a COMPLETELY DIFFERENT website to accomplish this task. Do NOT return to ${currentDomain}. Choose a well-known alternative site and try a fresh approach.\n`;
          emit('site_switch', { step, reason: 'recovery', domain: currentDomain, switchCount: siteSwitchCount });
        }
      } else {
        consecutiveRecoveryCount = 0;
        lastRecoveryDomain = null;
      }
    }

    // Consume pending site switch message from previous iteration (e.g. after parse failure navigation)
    if (pendingSiteSwitch !== null) {
      recoveryMessage = (recoveryMessage !== null ? recoveryMessage + '\n' : '') + pendingSiteSwitch;
      pendingSiteSwitch = null;
    }

    let tabCount: number | undefined;
    let tabs: TabInfo[] | undefined;
    if (browser !== undefined) {
      try {
        const allTabs = (await browser.tabs()) as TabInfo[];
        tabCount = allTabs.length;
        if (tabCount > 1) tabs = allTabs;
      } catch (err) {
        logger.warn(
          { error: sanitizeErrorText(err instanceof Error ? err.message : 'unknown') },
          'Failed to get tab count',
        );
      }
    }
    const skillForStep = step <= SKILL_INJECT_MAX_STEP ? domainSkill : undefined;
    const lessonForStep = step <= PLAN_INJECT_MAX_STEP ? taskLesson : null;
    // Keep plan available for longer — it's cheap context and prevents drift
    const planForStep = step <= PLAN_INJECT_MAX_STEP ? planText : null;
    const stepsRemaining = maxSteps - step - 1;

    // #3 Progressive context simplification on consecutive parse failures:
    // first failure = full, second = reduced (strip error_feedback noise), third = minimal
    const contextLevel: ContextLevel =
      consecutiveParseFailures >= 2 ? 'minimal' : consecutiveParseFailures >= 1 ? 'reduced' : 'full';

    const userMessage = buildUserMessage(refinedPrompt, snapshot, history, url, title, {
      plan: planForStep,
      tabCount,
      tabs,
      pageState,
      domainSkill: skillForStep,
      taskLesson: lessonForStep,
      stepsRemaining,
      maxSteps,
      recoveryMessage,
      contextSummary,
      progress: lastProgress,
      contextLevel,
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
      crossSiteParseFailures = 0;
      consecutiveApiFailures = 0;

      // Extract progress tracking (backward compatible — falls back to null if not provided)
      const stepProgress = parseProgress(parsed);
      if (stepProgress !== null) {
        lastProgress = stepProgress;
      }
      logger.info(
        { step, actionCount: actions.length, firstAction: actions[0].action, reasoning: actions[0].reasoning },
        'Agent step',
      );

      // Skip loop detection when recovery already diagnosed the problem — avoid double-messaging
      if (recoveryMessage === null) {
        const loopNudge = detectLoop(actions[0], history);
        if (loopNudge !== null) {
          logger.warn({ step, level: loopNudge.level }, 'Loop nudge');
          let nudgeMessage = loopNudge.message;

          // On urgent/warning loops, inject DOM text extract so the agent has raw page
          // content to work with instead of spinning on stale refs.
          if (loopNudge.level === 'urgent' || loopNudge.level === 'warning') {
            if (domText.trim().length > 100) {
              const domPreview = domText.slice(0, 800);
              nudgeMessage += `\n\nDOM TEXT (extracted directly — use this to find the data you need):\n${domPreview}${domText.length > 800 ? '\n…(truncated)' : ''}`;
              nudgeMessage +=
                '\n\nIf you have partial results, use "done" now with what you have. A partial answer is better than getting stuck.';
            }
          }

          actions[0].error_feedback = nudgeMessage;
          recentFailureCount++;
        }
      }

      // Detect stale extraction: same memory content as previous step
      if (actions[0].memory !== undefined && actions[0].memory !== '' && history.length > 0) {
        const prevMemory = getLastMemory(history);
        if (prevMemory === actions[0].memory) {
          duplicateMemoryCount++;
          let feedback: string;
          if (duplicateMemoryCount >= 3) {
            feedback =
              'STALE EXTRACTION (3x): You have failed to make progress 3 times in a row. You MUST try a fundamentally different approach NOW: navigate to a completely different page or site section, simplify your search, or use a different interaction pattern. Do NOT repeat any extraction you have already tried.';
          } else {
            feedback =
              'DUPLICATE MEMORY: Your memory is identical to the previous step — you are not making new progress with this approach. Try a DIFFERENT extraction method: navigate to a different page that has the same data, scroll to a different section, or try extracting from individual detail pages instead of a listing page. Do NOT repeat the same extraction.';
          }
          actions[0].error_feedback =
            actions[0].error_feedback !== undefined ? `${actions[0].error_feedback}\n${feedback}` : feedback;
        } else {
          duplicateMemoryCount = 0;
        }
      }
    } catch (err) {
      if (err instanceof LlmParseError) {
        // LLM responded but not with valid JSON — burn a step, the call was made
        consecutiveParseFailures++;
        crossSiteParseFailures++;
        logger.warn(
          { step, consecutive: consecutiveParseFailures, crossSite: crossSiteParseFailures },
          'LLM returned non-JSON response',
        );
        emit('step_error', {
          step,
          error: 'LLM response was not valid JSON',
          type: 'parse_error',
          ...(process.env.DEBUG !== undefined && { rawText: err.responseSnippet }),
        });

        // Absolute last resort: too many parse failures across all sites
        if (crossSiteParseFailures >= MAX_CROSS_SITE_PARSE_FAILURES) {
          return await forceComplete(
            `${String(crossSiteParseFailures)} parse failures across sites — presenting partial results`,
          );
        }

        // Per-site threshold: switch to a different site
        if (consecutiveParseFailures >= MAX_PARSE_FAILURES_PER_SITE) {
          siteSwitchCount++;
          if (siteSwitchCount > MAX_SITE_SWITCHES) {
            return await forceComplete(
              `Exhausted ${String(MAX_SITE_SWITCHES)} site switches — presenting partial results`,
            );
          }
          logger.warn({ step, switchCount: siteSwitchCount }, 'Switching sites: repeated parse failures');
          consecutiveParseFailures = 0;
          try {
            await holder.page.goto('about:blank');
          } catch {
            /* ignore navigation error */
          }
          pendingSiteSwitch = `🔄 SITE SWITCH REQUIRED: The previous site caused ${String(MAX_PARSE_FAILURES_PER_SITE)} consecutive parsing failures. Navigate to a COMPLETELY DIFFERENT website to accomplish this task. Choose a well-known, major site and try a fresh approach.`;
          emit('site_switch', { step, reason: 'parse_failures', switchCount: siteSwitchCount });
        }
        step++;
        continue;
      }

      // API/network error — don't burn a step, the agent never got to act
      consecutiveApiFailures++;
      logger.error({ step, attempt: consecutiveApiFailures, maxAttempts: MAX_API_FAILURES }, 'LLM API error');
      emit('step_error', { step, error: 'AI service temporarily unavailable', type: 'api_error' });
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
        const doneBlockReason = shouldBlockDone(pageState, history.length, action.answer);
        if (doneBlockReason !== null) {
          agentStep.action.error_feedback = doneBlockReason;
          recentFailureCount++;
          step++;
          break;
        }
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

      // #1 Evaluate fallback: LLM-requested JS extraction
      if (action.action === 'extract') {
        if (action.expression !== undefined && action.expression !== '') {
          try {
            const raw = await holder.page.evaluate(action.expression);
            const result = typeof raw === 'string' ? raw : JSON.stringify(raw);
            agentStep.action.extract_result = result.slice(0, 2000);
            if (result.length > 2000) {
              agentStep.action.extract_result += '\n…(truncated)';
            }
          } catch (evalErr) {
            agentStep.action.extract_result = `Error: ${evalErr instanceof Error ? evalErr.message : 'evaluation failed'}`;
          }
        } else {
          agentStep.action.extract_result = 'Error: no expression provided';
        }
        logger.info({ step, result: agentStep.action.extract_result.slice(0, 100) }, 'Extract action');
        step++;
        break;
      }

      // #2 Tab switching
      if (action.action === 'switch_tab') {
        if (browser !== undefined && action.tab_id !== undefined && action.tab_id !== '') {
          try {
            const newPage = browser.page(action.tab_id);
            const cdpBase = getCdpBaseUrl(holder.page);
            await activateCdpTarget(cdpBase, action.tab_id);
            holder.page = newPage;
            logger.info({ step, tab_id: action.tab_id }, 'Switched tab');
          } catch (tabErr) {
            agentStep.action.error_feedback = `Failed to switch tab: ${tabErr instanceof Error ? tabErr.message : 'unknown'}`;
            recentFailureCount++;
          }
        } else {
          agentStep.action.error_feedback = 'switch_tab requires tab_id and browser context';
          recentFailureCount++;
        }
        step++;
        break;
      }

      if (action.action === 'close_tab') {
        if (browser !== undefined && action.tab_id !== undefined && action.tab_id !== '') {
          if (action.tab_id === holder.page.id) {
            agentStep.action.error_feedback =
              'close_tab: cannot close the active tab; switch to another tab first, then close this one';
            recentFailureCount++;
          } else {
            try {
              await browser.close(action.tab_id);
              logger.info({ step, tab_id: action.tab_id }, 'Closed tab');
            } catch (tabErr) {
              agentStep.action.error_feedback = `Failed to close tab: ${tabErr instanceof Error ? tabErr.message : 'unknown'}`;
              recentFailureCount++;
            }
          }
        } else {
          agentStep.action.error_feedback = 'close_tab requires tab_id and browser context';
          recentFailureCount++;
        }
        step++;
        break;
      }

      // --- Normal actions ---

      const preActionUrl = await holder.page.url();

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

        // Validate action outcome — provide natural language feedback
        try {
          const postActionUrl = await holder.page.url();
          const postSnapshot = (await holder.page.snapshot({ interactive: true, compact: true })).snapshot;
          const outcome = validateAction(action, preActionUrl, postActionUrl, snapshot.length, postSnapshot.length);
          if (outcome !== undefined) {
            agentStep.outcome = outcome;
          }
        } catch {
          // Validation snapshot failed — not critical, skip
        }
      } catch (err) {
        const feedback = describeActionError(action, err);
        const rawMessage = err instanceof Error ? err.message : 'Action execution failed';
        logger.error({ step, action: action.action, error: rawMessage }, 'Action execution failed');
        emit('step_error', { step, action: action.action, error: rawMessage });
        agentStep.action.error_feedback = feedback;
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
