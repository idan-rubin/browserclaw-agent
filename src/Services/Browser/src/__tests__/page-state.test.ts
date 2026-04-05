import { describe, it, expect } from 'vitest';
import { detectPageState, shouldBlockDone } from '../skills/page-state.js';

describe('detectPageState', () => {
  it('detects login pages', () => {
    expect(
      detectPageState({
        snapshot: 'Sign In\nForgot your password?',
        domText: '',
        title: 'Login',
        url: 'https://example.com/login',
        antiBotType: null,
      }),
    ).toBe('login');
  });

  it('detects results pages', () => {
    expect(
      detectPageState({
        snapshot: 'show_time_show_1\nshow_time_show_2\nresults',
        domText: '2 listings found',
        title: 'Results',
        url: 'https://example.com/show_time/index',
        antiBotType: null,
      }),
    ).toBe('results');
  });

  it('detects anti bot from signal', () => {
    expect(
      detectPageState({
        snapshot: 'Verify you are human',
        domText: '',
        title: 'Challenge',
        url: 'https://example.com',
        antiBotType: 'cloudflare',
      }),
    ).toBe('anti_bot');
  });
});

describe('shouldBlockDone', () => {
  it('blocks done on login page', () => {
    expect(shouldBlockDone('login', 3, 'done')).toContain('Do not use done yet');
  });

  it('blocks weak early completion', () => {
    expect(shouldBlockDone('unknown', 1, 'ok')).toContain('too early');
  });

  it('allows done with enough answer text on results page', () => {
    expect(shouldBlockDone('results', 4, 'Found 3 listings with names, URLs, and prices.')).toBeNull();
  });
});
