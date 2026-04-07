import type { AgentStep } from '../types.js';

/**
 * Analyzes recent agent history and suggests concrete recovery strategies
 * when the agent appears stuck. Unlike loop-detection (which just nudges),
 * this provides actionable escape plans based on failure patterns.
 */

export interface RecoveryStrategy {
  diagnosis: string;
  suggestions: string[];
}

/**
 * Analyze the last N steps to detect *why* the agent is stuck
 * and suggest concrete recovery actions.
 */
export function diagnoseStuckAgent(history: AgentStep[], currentUrl: string): RecoveryStrategy | null {
  if (history.length < 6) return null;

  const recent = history.slice(-8);

  // Pattern 1: Alternating between two failing approaches
  const alternatingFailure = detectAlternatingFailures(recent);
  if (alternatingFailure !== null) return alternatingFailure;

  // Pattern 2: Repeated clicks on different refs that all fail (wrong page section)
  const scatterClicks = detectScatterClicks(recent);
  if (scatterClicks !== null) return scatterClicks;

  // Pattern 3: Typing in search fields but never finding/clicking results
  const searchWithoutResults = detectSearchWithoutResults(recent);
  if (searchWithoutResults !== null) return searchWithoutResults;

  // Pattern 4: Stuck on same URL with no progress (diverse actions but no advancement)
  const stagnation = detectStagnation(recent, currentUrl);
  if (stagnation !== null) return stagnation;

  // Pattern 5: Navigation loops (going back and forth between pages)
  const navLoop = detectNavigationLoop(recent);
  if (navLoop !== null) return navLoop;

  // Pattern 6: Site is blocking automation (anti-bot actions or repeated access failures)
  const siteBlocking = detectSiteBlocking(recent, currentUrl);
  if (siteBlocking !== null) return siteBlocking;

  return null;
}

function detectAlternatingFailures(recent: AgentStep[]): RecoveryStrategy | null {
  const failed = recent.filter((s) => s.action.error_feedback !== undefined);
  if (failed.length < 5) return null;

  // Check if the agent is alternating between 2-3 different actions that all fail
  // Threshold is 5+ (higher than loop-detection's semantic check at 4) to avoid duplicate nudges
  const failedActions = new Set(failed.map((s) => s.action.action));
  if (failedActions.size <= 3 && failed.length >= 5) {
    return {
      diagnosis: 'You are alternating between approaches that all fail.',
      suggestions: [
        'STOP trying variations of the same approach.',
        "Scroll the page to find different interactive elements you haven't tried.",
        'Try navigating to the page via a different URL or site section.',
        'If elements exist but clicks fail, there may be an overlay blocking them — try pressing Escape first.',
        "Use the site's main navigation menu or search bar instead of the current approach.",
      ],
    };
  }
  return null;
}

function detectScatterClicks(recent: AgentStep[]): RecoveryStrategy | null {
  const clicks = recent.filter((s) => s.action.action === 'click');
  const failedClicks = clicks.filter((s) => s.action.error_feedback !== undefined);

  if (failedClicks.length >= 3) {
    // Many different refs tried, all failing
    const uniqueRefs = new Set(failedClicks.map((s) => s.action.ref));
    if (uniqueRefs.size >= 3) {
      return {
        diagnosis: 'Multiple click attempts on different elements are failing.',
        suggestions: [
          'The elements may not be clickable — check if they are behind an overlay or iframe.',
          'Try scrolling to reveal the elements before clicking.',
          'The page structure may have changed since your last snapshot. Wait and get a fresh snapshot.',
          'Try using keyboard navigation (Tab + Enter) instead of clicking.',
          'Navigate directly to a URL if you know where you need to go.',
        ],
      };
    }
  }
  return null;
}

function detectSearchWithoutResults(recent: AgentStep[]): RecoveryStrategy | null {
  const typeActions = recent.filter((s) => s.action.action === 'type');
  const clickActions = recent.filter((s) => s.action.action === 'click');

  // Only trigger if same field was typed into multiple times (re-searching) — not for multi-field forms
  const typedRefs = typeActions.map((s) => s.action.ref).filter(Boolean);
  const uniqueTypedRefs = new Set(typedRefs);
  const hasRepeatedSearches = typedRefs.length >= 2 && uniqueTypedRefs.size === 1;

  if (hasRepeatedSearches && clickActions.length <= 1) {
    return {
      diagnosis: 'You have typed search queries but are not clicking on results.',
      suggestions: [
        'After typing, wait for autocomplete suggestions to appear and click the matching option.',
        'If no autocomplete appears, press Enter to submit the search.',
        'After submitting, scroll down to find the search results section.',
        'The search results may be in a different format than expected — look for list items, cards, or links.',
        'Try a simpler or shorter search query.',
      ],
    };
  }
  return null;
}

function detectStagnation(recent: AgentStep[], currentUrl: string): RecoveryStrategy | null {
  const sameUrlSteps = recent.filter((s) => s.url === currentUrl);
  if (sameUrlSteps.length < 6) return null;

  // On the same URL for 6+ steps with mixed actions and majority errors
  const actions = new Set(sameUrlSteps.map((s) => s.action.action));
  const errorCount = sameUrlSteps.filter((s) => s.action.error_feedback !== undefined).length;
  const errorRatio = errorCount / sameUrlSteps.length;

  // Require majority errors — a few failures on a long page is normal
  if (errorRatio >= 0.5 && actions.size >= 2) {
    return {
      diagnosis: `You have been on this same page for ${String(sameUrlSteps.length)}+ steps without making progress.`,
      suggestions: [
        'This page may not have what you need. Navigate to a different section of the site.',
        "Try using the site's search functionality to find the content directly.",
        'Check if the page requires scrolling to reveal the content you need.',
        'The page may require interaction in a specific order (e.g., select a category before results appear).',
        'Consider starting fresh: navigate directly to the target URL if you can construct it.',
      ],
    };
  }
  return null;
}

/** Collapse consecutive same-URL steps into distinct visits. */
function collapseVisits(urls: string[]): string[] {
  const visits: string[] = [];
  for (const url of urls) {
    if (visits.length === 0 || visits[visits.length - 1] !== url) {
      visits.push(url);
    }
  }
  return visits;
}

function detectNavigationLoop(recent: AgentStep[]): RecoveryStrategy | null {
  const rawUrls = recent.map((s) => s.url).filter(Boolean) as string[];
  // Collapse consecutive same-URL steps — staying on a page for 7 steps is 1 visit, not 7
  const visits = collapseVisits(rawUrls);
  if (visits.length < 4) return null;

  // Detect A→B→A→B pattern (already collapsed, so consecutive entries always differ)
  const urlSet = new Set(visits);
  if (urlSet.size === 2 && visits.length >= 4) {
    return {
      diagnosis: 'You are navigating back and forth between two pages without making progress.',
      suggestions: [
        'Pick ONE of the two pages and commit to completing your task there.',
        `Stay on the page that has the content you need and work through it systematically.`,
        "If going back resets the page state (filters, scroll position), try a different approach that doesn't require going back.",
        'Extract all needed information from each page before navigating away.',
      ],
    };
  }

  // Detect revisiting the same URL 3+ times (distinct visits, not consecutive steps)
  const visitCounts = new Map<string, number>();
  for (const url of visits) {
    visitCounts.set(url, (visitCounts.get(url) ?? 0) + 1);
  }
  for (const [url, count] of visitCounts) {
    if (count >= 3) {
      return {
        diagnosis: `You have visited the same page 3+ times: ${url}`,
        suggestions: [
          'You are going in circles. Extract everything you need from this page in ONE visit.',
          'If the page resets when you navigate away, find a way to accomplish your goal without leaving.',
          'Consider a completely different approach to the task.',
        ],
      };
    }
  }

  return null;
}

function detectSiteBlocking(recent: AgentStep[], currentUrl: string): RecoveryStrategy | null {
  const antiBotActions = recent.filter(
    (s) => s.action.action === 'press_and_hold' || s.action.action === 'click_cloudflare',
  );
  if (antiBotActions.length >= 2) {
    let domain = '';
    try {
      domain = new URL(currentUrl).hostname;
    } catch {
      /* ignore */
    }
    return {
      diagnosis: `The site${domain !== '' ? ` (${domain})` : ''} is actively blocking automation — you've triggered anti-bot challenges ${String(antiBotActions.length)} times.`,
      suggestions: [
        'STOP trying this site. It is blocking you and you will waste more steps.',
        'Navigate to a DIFFERENT site that has the same information.',
        'Go directly to the alternative site with your search terms in the URL (e.g. apartments.com/chelsea-new-york-ny).',
        'If you already have partial results from this site, combine them with results from the next site.',
      ],
    };
  }

  // Detect repeated access-denied / empty page patterns
  const errorSteps = recent.filter(
    (s) =>
      s.action.error_feedback !== undefined &&
      /denied|forbidden|blocked|captcha|robot|bot.*detected/i.test(s.action.error_feedback),
  );
  if (errorSteps.length >= 3) {
    return {
      diagnosis: 'The site is returning access-denied or bot-detection errors.',
      suggestions: [
        'This site has detected automation. Do not continue here.',
        'Navigate to an alternative site that has the same information.',
        'Try a well-known, automation-friendly alternative.',
      ],
    };
  }

  return null;
}

/**
 * Format a recovery strategy into a message that gets injected into the LLM context.
 */
export function formatRecovery(strategy: RecoveryStrategy): string {
  let msg = `\n🔧 RECOVERY NEEDED — ${strategy.diagnosis}\n`;
  msg += 'Try one of these strategies:\n';
  for (const suggestion of strategy.suggestions) {
    msg += `  • ${suggestion}\n`;
  }
  return msg;
}
