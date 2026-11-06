import { describe, expect, it } from 'vitest';
import { isPageReady } from '../agent-loop.js';

const LEAN_FORM = [
  '- textbox "Card number" [ref=e1]',
  '- textbox "Name on card" [ref=e2]',
  '- combobox "Month" [ref=e3]',
  '- combobox "Year" [ref=e4]',
  '- textbox "CVV" [ref=e5]',
  '- textbox "ZIP" [ref=e6]',
  '- button "Pay $147.50" [ref=e7]',
].join('\n');

describe('isPageReady', () => {
  it('treats a short page with interactive elements as ready', () => {
    expect(isPageReady(LEAN_FORM)).toBe('ready');
  });

  it('treats a receipt with a single link as ready', () => {
    expect(isPageReady('- heading "Payment received"\n- link "Pay another bill" [ref=e1]')).toBe('ready');
  });

  it('treats a blank page as empty', () => {
    expect(isPageReady('')).toBe('empty');
  });

  it('treats a short page without anything to act on as empty', () => {
    expect(isPageReady('- text "Loading your account"\n- text "Please wait"')).toBe('empty');
  });

  it('still flags skeleton pages', () => {
    const skeleton = Array.from({ length: 25 }, (_, i) => `- [ref=e${String(i)}]`).join('\n');
    expect(isPageReady(skeleton)).toBe('skeleton');
  });
});
