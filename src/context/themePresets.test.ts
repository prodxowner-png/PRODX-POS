import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_PRESETS, resolveLegacyPresetId, REQUIRED_THEME_SEMANTIC_ROLES } from './themePresets';

const expectedIds = [
  'prodx_signature',
  'forest_luxury',
  'enterprise_obsidian',
  'nordic_slate',
  'royal_emerald',
  'cyberpunk_neon',
  'sunset_terracotta',
  'midnight_indigo',
  'rose_luxury',
  'classic_light',
];

test('provides exactly ten uniquely identified and named theme presets', () => {
  assert.equal(THEME_PRESETS.length, 10);
  assert.deepEqual(THEME_PRESETS.map(({ id }) => id), expectedIds);
  assert.equal(new Set(THEME_PRESETS.map(({ id }) => id)).size, 10);
  for (const preset of THEME_PRESETS) {
    assert.ok(preset.name.en.trim());
    assert.ok(preset.name.th.trim());
    assert.ok(preset.tagline.en.trim());
    assert.ok(preset.tagline.th.trim());
  }
});

test('every preset defines the complete semantic token contract', () => {
  for (const preset of THEME_PRESETS) {
    assert.deepEqual(
      Object.keys(preset.semanticTokens).sort(),
      [...REQUIRED_THEME_SEMANTIC_ROLES].sort(),
      preset.id,
    );
    for (const [key, value] of Object.entries(preset.semanticTokens)) {
      assert.ok(value.trim(), `${preset.id} has an empty semantic role: ${key}`);
    }
  }
});

test('all themes preserve payment CTA and status meanings independently of brand personality', () => {
  const signature = THEME_PRESETS[0].semanticTokens;
  for (const preset of THEME_PRESETS) {
    assert.equal(preset.semanticTokens.cta, signature.cta);
    assert.equal(preset.semanticTokens.ctaText, signature.ctaText);
    assert.equal(preset.semanticTokens.ctaHover, signature.ctaHover);
    assert.equal(preset.semanticTokens.ctaPressed, signature.ctaPressed);
    assert.equal(preset.semanticTokens.danger, signature.danger);
    assert.equal(preset.semanticTokens.dangerText, signature.dangerText);
    assert.equal(preset.semanticTokens.warning, signature.warning);
    assert.equal(preset.semanticTokens.success, signature.success);
    assert.equal(preset.semanticTokens.info, signature.info);
  }
});

test('resolveLegacyPresetId resolves legacy and existing preset IDs backward-compatibly', () => {
  for (const id of expectedIds) {
    assert.equal(resolveLegacyPresetId(id), id);
  }
  assert.equal(resolveLegacyPresetId('enterprise_blue'), 'nordic_slate');
  assert.equal(resolveLegacyPresetId('modern'), 'nordic_slate');
  assert.equal(resolveLegacyPresetId('minimal'), 'nordic_slate');
  assert.equal(resolveLegacyPresetId('ocean'), 'nordic_slate');
  assert.equal(resolveLegacyPresetId('deep_obsidian'), 'enterprise_obsidian');
  assert.equal(resolveLegacyPresetId('dark_elegant'), 'enterprise_obsidian');
  assert.equal(resolveLegacyPresetId('emerald'), 'royal_emerald');
  assert.equal(resolveLegacyPresetId('cyberpunk'), 'cyberpunk_neon');
  assert.equal(resolveLegacyPresetId('sunset'), 'sunset_terracotta');
  assert.equal(resolveLegacyPresetId('lavender'), 'midnight_indigo');
  assert.equal(resolveLegacyPresetId('unknown_random_id'), 'prodx_signature');
});
