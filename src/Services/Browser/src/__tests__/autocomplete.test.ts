import { describe, expect, it } from 'vitest';
import { suggestionListAppeared } from '../agent-loop.js';

const FORM_WITH_SELECT = [
  '- textbox "Security code" [ref=e1]',
  '- combobox "Country" [ref=e2]:',
  '  - option "Select" [ref=e3] [selected]',
  '  - option "United States" [ref=e4]',
  '- textbox "Billing ZIP code" [ref=e5]',
].join('\n');

describe('suggestionListAppeared', () => {
  it('ignores a native select that was already on the page', () => {
    const after = FORM_WITH_SELECT.replace('[ref=e5]', '[ref=e5]: "62704"');
    expect(suggestionListAppeared(FORM_WITH_SELECT, after)).toBe(false);
  });

  it('flags a suggestion list that appeared after typing', () => {
    const after = `${FORM_WITH_SELECT}\n- listbox [ref=e6]:\n  - option "62704 Springfield" [ref=e7]`;
    expect(suggestionListAppeared(FORM_WITH_SELECT, after)).toBe(true);
  });

  it('flags a combobox that expanded after typing', () => {
    const before = '- combobox "City" [ref=e1]';
    expect(suggestionListAppeared(before, '- combobox "City" [ref=e1] [expanded]')).toBe(true);
  });

  it('ignores an unchanged page', () => {
    expect(suggestionListAppeared('- textbox "Name" [ref=e1]', '- textbox "Name" [ref=e1]: "Jane"')).toBe(false);
  });
});
