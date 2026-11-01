import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { Linter } from 'eslint';
import type { ESLint } from 'eslint';

const require = createRequire(import.meta.url);
const requireFromNext = createRequire(require.resolve('eslint-config-next'));

function lint(pluginName: string, rule: string, options: unknown[], code: string) {
  const plugin = requireFromNext(`eslint-plugin-${pluginName}`) as ESLint.Plugin;
  return new Linter().verify(
    code,
    [
      {
        files: ['**/*.{js,jsx}'],
        languageOptions: {
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { [pluginName]: plugin },
        rules: { [`${pluginName}/${rule}`]: ['error', ...options] },
      },
    ],
    { filename: 'src/widgets/fixture.jsx' },
  );
}

// These plugins call the legacy CommonJS export in optional wildcard paths that
// ordinary project linting does not necessarily exercise. Check both matching
// and nonmatching cases so an export error or a disabled rule cannot pass.
await test('React prop and component wildcards still enforce restrictions', () => {
  const options = [{ forbid: [{ propNamePattern: 'debug*', allowedForPatterns: ['Safe*'] }] }];
  assert.deepEqual(lint('react', 'forbid-component-props', options, '<SafeWidget debugMode />;'), []);
  const messages = lint('react', 'forbid-component-props', options, '<OtherWidget debugMode />;');
  assert.deepEqual(
    messages.map((message) => message.ruleId),
    ['react/forbid-component-props'],
  );
});

await test('Import extension wildcards still control exceptions', () => {
  const code = "import icon from './assets/icon.svg';";
  const options = ['never', { pattern: {}, pathGroupOverrides: [{ pattern: './assets/*.svg', action: 'ignore' }] }];
  assert.deepEqual(lint('import', 'extensions', options, code), []);
  const unmatchedOptions = [
    'never',
    { pattern: {}, pathGroupOverrides: [{ pattern: './assets/*.png', action: 'ignore' }] },
  ];
  const messages = lint('import', 'extensions', unmatchedOptions, code);
  assert.deepEqual(
    messages.map((message) => message.ruleId),
    ['import/extensions'],
  );
});

await test('Accessibility control wildcards still require a matching control', () => {
  const options = [{ assert: 'nesting', controlComponents: ['Control*'] }];
  const code = '<label>Name<ControlInput /></label>;';
  assert.deepEqual(lint('jsx-a11y', 'label-has-associated-control', options, code), []);
  const messages = lint('jsx-a11y', 'label-has-associated-control', options, '<label>Name<Other /></label>;');
  assert.deepEqual(
    messages.map((message) => message.ruleId),
    ['jsx-a11y/label-has-associated-control'],
  );
});
