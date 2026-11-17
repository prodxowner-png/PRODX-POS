import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REQUIRED_BRAND_SEMANTIC_TOKENS, validateBrandTokenContract } from './semanticTokenContract';

const css = readFileSync(resolve(process.cwd(), 'src/prodx-brand-tokens.css'), 'utf8');

test('brand stylesheet declares every required light semantic role', () => {
  const result = validateBrandTokenContract(css);
  assert.deepEqual(result.missingLightTokens, []);
});

test('dark mode keeps CTA text ink-dark and overrides all semantic surface and text roles', () => {
  const result = validateBrandTokenContract(css);
  assert.deepEqual(result.missingDarkOverrides, []);
  assert.equal(result.darkCtaText, 'var(--brand-ink-900)');
});

test('brand token contract keeps payment CTA separate from semantic status and destructive roles', () => {
  const result = validateBrandTokenContract(css);
  assert.equal(result.ctaUsesApprovedOrange, true);
  assert.equal(result.statusRolesComplete, true);
});
