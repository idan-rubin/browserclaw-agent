import type { AgentStep } from '../types.js';

export function detectLoop(action: { action: string; ref?: string }, history: AgentStep[]): boolean {
  const actionKey = `${action.action}:${action.ref || ''}`;
  const recentKeys = history.slice(-3).map(h => `${h.action.action}:${h.action.ref || ''}`);
  return recentKeys.length >= 3 && recentKeys.every(k => k === actionKey);
}

export function loopRecoveryStep(step: number): AgentStep {
  return {
    step,
    action: { action: 'wait', reasoning: 'LOOP DETECTED: You repeated the same action 3 times. This element is not working. Try a completely different approach — skip it, use a different element, or move on.' },
    url: '',
    page_title: '',
    timestamp: new Date().toISOString(),
  };
}
