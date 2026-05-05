import type { AgentStep } from '../types.js';

const LOOP_WINDOW = 20;

interface LoopNudge {
  level: 'gentle' | 'warning' | 'urgent';
  message: string;
}

/**
 * Detects exact action repetition (same action + same ref) with escalating severity.
 * Pattern-based stuck diagnosis (stagnation, alternating failures, etc.) is handled
 * by recovery.ts which provides richer diagnostics.
 */
export function detectLoop(action: { action: string; ref?: string }, history: AgentStep[]): LoopNudge | null {
  const actionKey = `${action.action}:${action.ref ?? ''}`;

  if (
    action.action === 'web_search' &&
    history.length >= 1 &&
    history[history.length - 1].action.action === 'web_search'
  ) {
    return {
      level: 'urgent',
      message:
        'You just ran web_search twice in a row. The previous search already returned results — pick one URL from those results and navigate there. Do not refine the query again. If every returned site turned out to be blocked, navigate directly to a known working alternative (e.g. Zumper, Apartments.com) instead of searching yet again.',
    };
  }

  if (
    action.action === 'back' &&
    history.length >= 2 &&
    history[history.length - 1].action.action === 'back' &&
    history[history.length - 2].action.action === 'back'
  ) {
    return {
      level: 'urgent',
      message:
        'You have pressed "back" three times in a row without recovering. Back navigation is not escaping this error/block page. Do NOT press back again. Instead, use "navigate" to a known-good URL (a listings-site home or results page you reached earlier) or use "web_search" to find an alternative site.',
    };
  }

  if (action.ref !== undefined && action.ref !== '' && history.length >= 2) {
    const lastTwo = history.slice(-2);
    const bothFailed = lastTwo.every(
      (h) => h.action.error_feedback !== undefined && `${h.action.action}:${h.action.ref ?? ''}` === actionKey,
    );
    if (bothFailed) {
      return {
        level: 'urgent',
        message: `STOP: ref "${action.ref}" just failed twice on "${action.action}". Do NOT try this ref again — it is blocked or not actionable. The most common cause is an overlay intercepting clicks: cookie/GDPR banner, newsletter signup, sign-in modal, "Sign in with Google" tile, marketing/upsell popup, or app-install prompt. Try: (a) keyboard "Escape" to dismiss the topmost overlay, (b) extract document.body.innerText.slice(0, 500) to see what's actually on the page, or (c) pick a DIFFERENT ref. If still stuck, navigate elsewhere.`,
      };
    }
  }

  if (history.length < 5) return null;

  const window = history.slice(-LOOP_WINDOW);
  const windowKeys = window.map((h) => `${h.action.action}:${h.action.ref ?? ''}`);

  const repetitions = windowKeys.filter((k) => k === actionKey).length;

  if (repetitions >= 12) {
    return {
      level: 'urgent',
      message:
        'STUCK: You have repeated this exact action 12+ times. This approach is not working. You MUST try something completely different. The most likely culprit is an overlay intercepting your clicks — cookie banner, newsletter popup, marketing/upsell modal, sign-in tile, app-install prompt, or date picker. Press "keyboard" "Escape" to dismiss the topmost overlay, then re-snapshot. If that fails, extract document.body.innerText.slice(0, 500) to confirm what is actually on the page, then try a different element, page, or strategy.',
    };
  }

  if (repetitions >= 8) {
    return {
      level: 'warning',
      message:
        'You have repeated this action 8+ times. Consider whether this approach is making progress. The most common silent blocker is an overlay (cookie banner, newsletter popup, sign-in modal, marketing/upsell, app-install prompt) intercepting clicks. Press "keyboard" "Escape" to dismiss it, then try a different path — site navigation, search, or a different element.',
    };
  }

  if (repetitions >= 5) {
    return {
      level: 'gentle',
      message:
        'You have repeated this action several times. If you are making progress with each repetition, keep going. If not, try a different approach: use "keyboard" with "Escape" to close any blocking popups, date pickers, or overlays, then try a different element or strategy.',
    };
  }

  return null;
}
