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

  it('flags an open list whose suggestions changed after typing', () => {
    const open =
      '- combobox "City" [ref=e1] [expanded]\n- listbox [ref=e2]:\n  - option "Springfield" [ref=e3]\n  - option "Spring Valley" [ref=e4]';
    const filtered =
      '- combobox "City" [ref=e1] [expanded]: "Springf"\n- listbox [ref=e2]:\n  - option "Springfield" [ref=e5]';
    expect(suggestionListAppeared(open, filtered)).toBe(true);
  });

  it('ignores a typed value that mentions an option', () => {
    const before = '- textbox "Notes" [ref=e1]';
    expect(suggestionListAppeared(before, '- textbox "Notes" [ref=e1]: "Please include a vegetarian option"')).toBe(
      false,
    );
  });

  it('ignores a native select whose refs were renumbered', () => {
    const after = FORM_WITH_SELECT.replace('[ref=e3]', '[ref=e13]').replace('[ref=e4]', '[ref=e14]');
    expect(suggestionListAppeared(FORM_WITH_SELECT, after)).toBe(false);
  });
});
