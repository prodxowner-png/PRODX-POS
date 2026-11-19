import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { THEME_PRESETS } from '../../context/themePresets.ts';
import { getContrastRatio } from '../../context/themeTokenAdapter.ts';

const BUTTON_PATH = resolve(process.cwd(), 'src/components/common/Button.tsx');
const BRAND_TOKENS_PATH = resolve(process.cwd(), 'src/prodx-brand-tokens.css');
const INDEX_CSS_PATH = resolve(process.cwd(), 'src/index.css');

test('Button danger and success variants use text-brand-on-solid instead of text-brand-primary-text', () => {
  const buttonSource = readFileSync(BUTTON_PATH, 'utf8');

  const dangerMatch = buttonSource.match(/danger:\s*['"]([^'"]+)['"]/);
  const successMatch = buttonSource.match(/success:\s*['"]([^'"]+)['"]/);

  assert.ok(dangerMatch, 'Button.tsx must define danger variant styles');
  assert.ok(successMatch, 'Button.tsx must define success variant styles');

  assert.match(dangerMatch[1], /\btext-brand-on-solid\b/);
  assert.doesNotMatch(dangerMatch[1], /\btext-brand-primary-text\b/);
  assert.doesNotMatch(dangerMatch[1], /\btext-white\b/);

  assert.match(successMatch[1], /\btext-brand-on-solid\b/);
  assert.doesNotMatch(successMatch[1], /\btext-brand-primary-text\b/);
  assert.doesNotMatch(successMatch[1], /\btext-white\b/);
});

test('--brand-on-solid token is defined in prodx-brand-tokens.css and mapped in index.css @theme', () => {
  const brandTokensCss = readFileSync(BRAND_TOKENS_PATH, 'utf8');
  const indexCss = readFileSync(INDEX_CSS_PATH, 'utf8');

  const onSolidMatch = brandTokensCss.match(/--brand-on-solid:\s*(#[0-9a-fA-F]{6})\s*;/);
  assert.ok(onSolidMatch, 'prodx-brand-tokens.css must define --brand-on-solid hex value');
  assert.equal(onSolidMatch[1].toLowerCase(), '#fbf8f3');

  assert.match(
    indexCss,
    /--color-brand-on-solid:\s*var\(--brand-on-solid\)\s*;/,
    'src/index.css must expose --color-brand-on-solid in @theme'
  );
});

test('--brand-on-solid (#fbf8f3) meets WCAG AA >= 4.5:1 against --brand-danger and --brand-success across CSS and all presets', () => {
  const brandTokensCss = readFileSync(BRAND_TOKENS_PATH, 'utf8');

  const onSolidHex = brandTokensCss.match(/--brand-on-solid:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1];
  const dangerHex = brandTokensCss.match(/--brand-danger-600:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1];
  const successHex = brandTokensCss.match(/--brand-success-600:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1];

  assert.ok(onSolidHex && dangerHex && successHex, 'CSS tokens for on-solid, danger, and success must exist');

  const cssDangerContrast = getContrastRatio(onSolidHex, dangerHex);
  const cssSuccessContrast = getContrastRatio(onSolidHex, successHex);

  assert.ok(
    cssDangerContrast >= 4.5,
    `Expected --brand-on-solid (${onSolidHex}) on --brand-danger (${dangerHex}) >= 4.5:1, got ${cssDangerContrast.toFixed(2)}:1`
  );
  assert.ok(
    cssSuccessContrast >= 4.5,
    `Expected --brand-on-solid (${onSolidHex}) on --brand-success (${successHex}) >= 4.5:1, got ${cssSuccessContrast.toFixed(2)}:1`
  );

  for (const preset of THEME_PRESETS) {
    const presetDangerContrast = getContrastRatio(onSolidHex, preset.semanticTokens.danger);
    const presetSuccessContrast = getContrastRatio(onSolidHex, preset.semanticTokens.success);
    assert.ok(
      presetDangerContrast >= 4.5,
      `Preset ${preset.id}: --brand-on-solid (${onSolidHex}) on danger (${preset.semanticTokens.danger}) got ${presetDangerContrast.toFixed(2)}:1 (< 4.5:1)`
    );
    assert.ok(
      presetSuccessContrast >= 4.5,
      `Preset ${preset.id}: --brand-on-solid (${onSolidHex}) on success (${preset.semanticTokens.success}) got ${presetSuccessContrast.toFixed(2)}:1 (< 4.5:1)`
    );
  }
});
