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
  if (history.length < 5) return null;

  const actionKey = `${action.action}:${action.ref ?? ''}`;
  const window = history.slice(-LOOP_WINDOW);
  const windowKeys = window.map((h) => `${h.action.action}:${h.action.ref ?? ''}`);

  // Count how many times this exact action appears in the window
  const repetitions = windowKeys.filter((k) => k === actionKey).length;

  if (repetitions >= 12) {
    return {
      level: 'urgent',
      message:
        'STUCK: You have repeated this exact action 12+ times. This approach is not working. You MUST try something completely different. If a popup, date picker, or overlay is blocking the UI, use "keyboard" with "Escape" to close it. Otherwise try a different element, a different page, or a different strategy entirely.',
    };
  }

  if (repetitions >= 8) {
    return {
      level: 'warning',
      message:
        'You have repeated this action 8+ times. Consider whether this approach is making progress. If not, try pressing Escape to dismiss any blocking popups or overlays, then try a different path — use site navigation, search, or a different element.',
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
