import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_PRESETS } from './themePresets';
import { buildThemeVariables, validateCustomAccent } from './themeTokenAdapter';

const signature = THEME_PRESETS[0];

test('builds a complete light semantic and legacy variable map from the selected preset', () => {
  const vars = buildThemeVariables(signature, 'light', null);
  assert.equal(vars['--bg-color'], signature.background);
  assert.equal(vars['--card-color'], signature.card);
  assert.equal(vars['--brand-bg'], signature.semanticTokens.bg);
  assert.equal(vars['--brand-cta'], '#e8894a');
  assert.equal(vars['--brand-cta-text'], '#20242b');
  assert.equal(vars['--primary-dark'], signature.semanticTokens.primaryHover);
  assert.equal(vars['--focus-ring'], '#0f2a22');
});

test('dark mode overrides light preset surfaces and text without changing CTA or status semantics', () => {
  const vars = buildThemeVariables(signature, 'dark', null);
  assert.equal(vars['--bg-color'], '#12171a');
  assert.equal(vars['--card-color'], '#1b2227');
  assert.equal(vars['--text-color'], '#f2ede4');
  assert.equal(vars['--brand-bg'], '#12171a');
  assert.equal(vars['--brand-text'], '#f2ede4');
  assert.equal(vars['--brand-cta'], '#e8894a');
  assert.equal(vars['--brand-cta-text'], '#20242b');
  assert.equal(vars['--brand-danger'], '#c62f2f');
});

test('accepts only a hex custom accent with sufficient contrast against the primary label', () => {
  const accepted = validateCustomAccent('#0284c7', '#ffffff');
  assert.equal(accepted, '#0284c7');

  const invalidFormat = validateCustomAccent('not-a-color', '#ffffff');
  assert.equal(invalidFormat, null);

  const lowContrast = validateCustomAccent('#fef08a', '#ffffff');
  assert.equal(lowContrast, null);

  const vars = buildThemeVariables(signature, 'light', '#0284c7');
  assert.equal(vars['--primary-color'], '#0284c7');
  assert.equal(vars['--brand-primary'], '#0284c7');

  const fallbackVars = buildThemeVariables(signature, 'light', '#ffff00');
  assert.equal(fallbackVars['--primary-color'], signature.primary);
});
