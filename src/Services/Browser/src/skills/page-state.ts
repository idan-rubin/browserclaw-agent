export type PageState = 'login' | 'loading' | 'error' | 'anti_bot' | 'empty' | 'results' | 'detail' | 'unknown';

export interface DetectPageStateInput {
  snapshot: string;
  domText: string;
  title: string;
  url: string;
  antiBotType: string | null;
}

function hasAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export function detectPageState(input: DetectPageStateInput): PageState {
  const snapshot = input.snapshot || '';
  const domText = input.domText || '';
  const title = input.title || '';
  const url = input.url || '';
  const joined = `${title}\n${url}\n${snapshot}\n${domText}`;

  if (input.antiBotType !== null) return 'anti_bot';

  if (hasAny(joined, [/loading/i, /please wait/i, /skeleton/i, /spinner/i])) {
    return 'loading';
  }

  if (hasAny(joined, [/404/i, /500/i, /error/i, /something went wrong/i, /access denied/i, /forbidden/i])) {
    return 'error';
  }

  if (
    hasAny(joined, [/sign in/i, /log in/i, /login/i, /forgot your password/i, /keep me logged in/i, /create account/i])
  ) {
    return 'login';
  }

  if (hasAny(joined, [/no results/i, /0 results/i, /nothing found/i, /no events/i, /no listings/i])) {
    return 'empty';
  }

  if (hasAny(joined, [/details/i, /description/i, /about this/i, /overview/i, /specifications/i])) {
    return 'detail';
  }

  if (
    hasAny(joined, [
      /results/i,
      /event/i,
      /listing/i,
      /show_time/i,
      /activities/i,
      /search results/i,
      /\/[a-z0-9-]*results/i,
    ])
  ) {
    return 'results';
  }

  if (snapshot.trim() === '' && domText.trim() === '') return 'empty';

  return 'unknown';
}

export function shouldBlockDone(state: PageState, historyLength: number, answer?: string): string | null {
  const answerText = (answer ?? '').trim();
  if (historyLength < 2 && answerText.length < 40) {
    return 'You are trying to finish too early. Verify the page and gather at least one concrete result before using done.';
  }

  if (state === 'login' || state === 'anti_bot') {
    return `The current page state is ${state}. Do not use done yet — resolve the page state or gather verified results first.`;
  }

  if ((state === 'results' || state === 'detail') && answerText.length < 40) {
    return 'Your answer is too thin for the current page. Extract concrete findings before using done.';
  }

  return null;
}
