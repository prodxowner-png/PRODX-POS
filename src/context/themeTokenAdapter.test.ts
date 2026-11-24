import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_PRESETS } from './themePresets';
import {
  buildThemeVariables,
  getContrastRatio,
  resolveAccessibleAccentForeground,
  validateCustomAccent,
} from './themeTokenAdapter';

const signature = THEME_PRESETS[0];

test('builds a complete light semantic and legacy variable map from the selected preset', () => {
  const vars = buildThemeVariables(signature, 'light', null);
  assert.equal(vars['--bg-color'], signature.background);
  assert.equal(vars['--card-color'], signature.card);
  assert.equal(vars['--brand-bg'], signature.semanticTokens.bg);
  assert.equal(vars['--brand-cta'], '#e8894a');
  assert.equal(vars['--brand-cta-text'], '#20242b');
  assert.equal(vars['--brand-cta-subtle'], signature.semanticTokens.ctaSubtle);
  assert.equal(vars['--primary-dark'], signature.semanticTokens.primaryHover);
  assert.equal(vars['--primary-text'], signature.semanticTokens.primaryText);
  assert.equal(vars['--brand-primary-text'], signature.semanticTokens.primaryText);
  assert.equal(vars['--focus-ring'], '#0f2a22');
  assert.equal(vars['--brand-success-text'], signature.semanticTokens.successText);
  assert.equal(vars['--brand-warning-text'], signature.semanticTokens.warningText);
});

test('dark mode overrides light preset surfaces and emits dark-mode status text/subtle tokens', () => {
  const vars = buildThemeVariables(signature, 'dark', null);
  assert.equal(vars['--bg-color'], '#12171a');
  assert.equal(vars['--card-color'], '#1b2227');
  assert.equal(vars['--text-color'], '#f2ede4');
  assert.equal(vars['--brand-bg'], '#12171a');
  assert.equal(vars['--brand-text'], '#f2ede4');
  assert.equal(vars['--brand-cta'], '#e8894a');
  assert.equal(vars['--brand-cta-text'], '#20242b');
  assert.equal(vars['--brand-cta-subtle'], '#2f231c');
  assert.notEqual(vars['--brand-cta-subtle'], signature.semanticTokens.ctaSubtle);
  assert.ok(
    getContrastRatio(vars['--brand-cta'], vars['--brand-cta-subtle']) >= 4.5,
    'Dark mode --brand-cta on --brand-cta-subtle must meet >= 4.5:1',
  );
  assert.ok(
    getContrastRatio(vars['--brand-text'], vars['--brand-cta-subtle']) >= 4.5,
    'Dark mode --brand-text on --brand-cta-subtle must meet >= 4.5:1',
  );
  assert.equal(vars['--brand-danger'], '#c62f2f');

  // Dark mode status tokens must match prodx-brand-tokens.css (:root.dark) and meet >= 4.5:1
  for (const role of ['success', 'warning', 'danger', 'info'] as const) {
    assert.equal(vars[`--brand-${role}-text`], '#f2ede4');
    assert.equal(vars[`--brand-${role}-subtle`], '#1b2227');
    assert.ok(
      getContrastRatio(vars[`--brand-${role}-text`], vars[`--brand-${role}-subtle`]) >= 4.5,
      `Dark mode ${role} status text/subtle must meet >= 4.5:1`,
    );
  }
});

test('enforces WCAG AA >= 4.5:1 for custom accents and adapts primary foreground for light and dark accents', () => {
  // #0284c7 vs #ffffff is 4.08:1 (< 4.5:1) -> MUST be rejected against #ffffff and with auto foreground
  assert.equal(validateCustomAccent('#0284c7', '#ffffff'), null);
  assert.equal(validateCustomAccent('#0284c7'), null);
  assert.equal(validateCustomAccent('#777777'), null);
  assert.equal(validateCustomAccent('not-a-color', '#ffffff'), null);
  assert.equal(validateCustomAccent('#fef08a', '#ffffff'), null);

  // Dark custom accent (#0369a1: 5.93:1 vs #ffffff / 5.65:1 vs #fbf8f3) -> accepted with light foreground
  assert.equal(validateCustomAccent('#0369a1', '#ffffff'), '#0369a1');
  assert.equal(validateCustomAccent('#0369a1'), '#0369a1');
  const darkAccentVars = buildThemeVariables(signature, 'light', '#0369a1');
  assert.equal(darkAccentVars['--primary-color'], '#0369a1');
  assert.equal(darkAccentVars['--brand-primary'], '#0369a1');
  assert.equal(darkAccentVars['--brand-primary-hover'], '#0369a1');
  assert.equal(darkAccentVars['--brand-primary-pressed'], '#0369a1');
  assert.equal(darkAccentVars['--primary-dark'], '#0369a1');
  assert.equal(darkAccentVars['--brand-primary-text'], '#fbf8f3');
  assert.equal(darkAccentVars['--primary-text'], '#fbf8f3');
  assert.ok(
    getContrastRatio(darkAccentVars['--brand-primary'], darkAccentVars['--brand-primary-text']) >= 4.5,
  );
  assert.ok(
    getContrastRatio(darkAccentVars['--brand-primary-hover'], darkAccentVars['--brand-primary-text']) >= 4.5,
  );
  assert.ok(
    getContrastRatio(darkAccentVars['--brand-primary-pressed'], darkAccentVars['--brand-primary-text']) >= 4.5,
  );

  // Light custom accent (#f59e0b amber: fails against white, passes >= 4.5:1 against dark ink #20242b)
  assert.equal(validateCustomAccent('#f59e0b', '#ffffff'), null);
  assert.equal(validateCustomAccent('#f59e0b', '#20242b'), '#f59e0b');
  assert.equal(validateCustomAccent('#f59e0b'), '#f59e0b');
  assert.equal(resolveAccessibleAccentForeground('#f59e0b', '#fbf8f3'), '#20242b');

  const lightAccentVars = buildThemeVariables(signature, 'light', '#f59e0b');
  assert.equal(lightAccentVars['--primary-color'], '#f59e0b');
  assert.equal(lightAccentVars['--brand-primary'], '#f59e0b');
  assert.equal(lightAccentVars['--brand-primary-hover'], '#f59e0b');
  assert.equal(lightAccentVars['--brand-primary-pressed'], '#f59e0b');
  assert.equal(lightAccentVars['--primary-dark'], '#f59e0b');
  assert.equal(lightAccentVars['--brand-primary-text'], '#20242b');
  assert.equal(lightAccentVars['--primary-text'], '#20242b');
  assert.ok(
    getContrastRatio(lightAccentVars['--brand-primary'], lightAccentVars['--brand-primary-text']) >= 4.5,
  );
  assert.ok(
    getContrastRatio(lightAccentVars['--brand-primary-hover'], lightAccentVars['--brand-primary-text']) >= 4.5,
  );
  assert.ok(
    getContrastRatio(lightAccentVars['--brand-primary-pressed'], lightAccentVars['--brand-primary-text']) >= 4.5,
  );
  assert.ok(
    getContrastRatio(lightAccentVars['--primary-dark'], lightAccentVars['--primary-text']) >= 4.5,
  );

  // Low-contrast mid-tone accent falls back cleanly to preset primary and primaryText
  const fallbackVars = buildThemeVariables(signature, 'light', '#777777');
  assert.equal(fallbackVars['--primary-color'], signature.primary);
  assert.equal(fallbackVars['--brand-primary-hover'], signature.semanticTokens.primaryHover);
  assert.equal(fallbackVars['--brand-primary-pressed'], signature.semanticTokens.primaryPressed);
  assert.equal(fallbackVars['--primary-dark'], signature.semanticTokens.primaryHover);
  assert.equal(fallbackVars['--brand-primary-text'], signature.semanticTokens.primaryText);
  assert.equal(fallbackVars['--primary-text'], signature.semanticTokens.primaryText);
});
