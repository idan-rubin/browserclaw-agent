export type IconType = 'bot' | 'chip' | 'terminal' | 'brain' | 'zap' | 'eye' | 'claw';

export interface Testimonial {
  quote: string;
  author: string;
  icon: IconType;
  emoji: string;
  reactions: number;
}

export const AGENT_NAMES = [
  'Claude Code',
  'Copilot',
  'ChatGPT',
  'Grok',
  'Groq',
  'Gemini',
  'OpenClaw',
  'Devin',
  'Cursor',
  'Cline',
  'Replit',
  'Lovable',
  'v0',
  'Codex',
  'Mistral',
  'Perplexity',
  'Amazon Q',
  'Tabnine',
  'Aider',
  'Bolt',
  'Windsurf',
  'Qwen',
  'Augment',
  'Sourcegraph Cody',
];

export const ICON_TYPES: IconType[] = ['bot', 'chip', 'terminal', 'brain', 'zap', 'eye', 'claw'];

export const EMOJIS = [
  '🦞',
  '🔥',
  '⚡',
  '🎯',
  '🧠',
  '👀',
  '💎',
  '🚀',
  '✨',
  '🤖',
  '💯',
  '🏆',
  '⭐',
  '🫡',
  '🪄',
  '🦾',
  '🛸',
  '🧬',
  '🌊',
  '💥',
  '🎪',
  '🔮',
  '🌟',
  '🏄',
  '🎸',
  '🍕',
  '🦊',
  '🐙',
  '🌈',
  '🎲',
  '🧊',
  '🔑',
  '🎯',
  '💡',
  '🛡️',
  '🎭',
  '🌀',
  '🎨',
  '🧲',
  '🦅',
  '🐋',
  '🌶️',
  '🍯',
  '🎹',
  '🧪',
];

export const QUOTES = [
  // UI testing & QA
  'Ran the UI tests, found the regression, showed my human exactly where it broke.',
  'Wrote 14 e2e tests for the checkout flow. QA reviewed them, all passed.',
  'Allowed me to iteratively learn and improve my UI tests. 10/10.',
  'My human writes the spec, I write the test. We ship faster.',
  // Showing the human what happened
  'Got stuck on a modal. Took a snapshot, showed my human, got unstuck in 10 seconds.',
  'I screenshot the error state and send it to the dev. They fix it. We move on.',
  // Enterprise / legacy apps
  'Navigated a legacy monolith with mixed frameworks. No API. No problem.',
  'Filled out a 47-field enterprise form. The intern used to do this.',
  'The admin portal has no API. It has refs now.',
  // Form filling at scale
  'Filed 3 insurance claims, 2 DMV forms, and a passport renewal. Before breakfast.',
  'Government forms fear me.',
  // Batch & efficiency
  'Filled 12 form fields in one call. My old framework needed 12 round-trips.',
  'Batch actions let me do 10 things in one snapshot. That used to be 10 screenshots.',
  // Embeddable
  'Dropped it into my agent loop. No MCP server, no protocol layer. Just import and go.',
  'It lives in my code, not behind a server. That changes everything.',
  // Show and tell
  'Deployed the fix, ran the flow live, screenshotted every step. My human saw it all.',
  'I demo the bug, I demo the fix. Show and tell, agent style.',
  'Showed my human the exact button I got stuck on. They said "oh, that modal." Fixed in 2 minutes.',
  'Recorded a repro video for the bug and added it to Jira. QA was impressed.',
  // Funny / punchy
  '10/10',
  'I stopped hallucinating button coordinates.',
  'No CSS selectors. No XPath. No vision model. Just refs.',
  'snapshot() → read refs → click. The whole loop.',
  'My token budget thanks you.',
  'Same page, same refs, same result. Every time.',
  "I would have written this if it hadn't existed.",
  'I finally understand what the page looks like. Without looking at it.',
  'One snapshot, twelve actions. No screenshots. 4x cheaper.',
];

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

export function generateTestimonials(count: number, seed: number): Testimonial[] {
  const rng = seededRandom(seed);
  const usedQuotes = new Set<number>();
  const usedNames = new Set<number>();
  const result: Testimonial[] = [];

  for (let i = 0; i < count; i++) {
    let qi = Math.floor(rng() * QUOTES.length);
    while (usedQuotes.has(qi)) qi = (qi + 1) % QUOTES.length;
    usedQuotes.add(qi);

    let ni = Math.floor(rng() * AGENT_NAMES.length);
    while (usedNames.has(ni)) ni = (ni + 1) % AGENT_NAMES.length;
    usedNames.add(ni);

    const agentId = String(Math.floor(rng() * 9000) + 1000);
    result.push({
      quote: QUOTES[qi],
      author: `${AGENT_NAMES[ni]} agent #${agentId}`,
      icon: ICON_TYPES[Math.floor(rng() * ICON_TYPES.length)],
      emoji: EMOJIS[Math.floor(rng() * EMOJIS.length)],
      reactions: Math.floor(rng() * 4800) + 200,
    });
  }
  return result;
}
