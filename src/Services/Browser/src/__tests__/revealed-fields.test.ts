import { describe, expect, it } from 'vitest';
import { newFormFields } from '../agent-loop.js';

const STEP = [
  '- combobox "Country" [ref=e1]:',
  '  - option "Select" [ref=e2] [selected]',
  '  - option "United States" [ref=e3]',
  '- textbox "Security code" [ref=e4]',
  '- button "Continue" [ref=e5]',
].join('\n');

describe('newFormFields', () => {
  it('lists a field that a selection revealed', () => {
    const after = `${STEP}\n- textbox "Billing ZIP code" [ref=e6]`;
    expect(newFormFields(STEP, after)).toEqual(['- textbox "Billing ZIP code"']);
  });

  it('ignores filled values, renumbered refs and a renamed control', () => {
    const after = STEP.replace('[ref=e4]', '[ref=e14]: "123"').replace(
      'combobox "Country"',
      'combobox "United States"',
    );
    expect(newFormFields(STEP, after)).toEqual([]);
  });

  it('counts a second unnamed textbox as new', () => {
    const before = '- textbox [ref=e1]\n- button "Continue" [ref=e2]';
    const after = '- textbox [ref=e1]: "4242"\n- textbox [ref=e3]\n- button "Continue" [ref=e2]';
    expect(newFormFields(before, after)).toEqual(['- textbox']);
  });

  it('ignores a page that lost fields', () => {
    expect(newFormFields(STEP, '- button "Pay now" [ref=e1]')).toEqual([]);
  });
});
