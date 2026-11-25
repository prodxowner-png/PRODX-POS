import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { THEME_PRESETS } from '../../../context/themePresets.ts';
import { buildThemeVariables } from '../../../context/themeTokenAdapter.ts';

const COMPONENT_PATH = resolve(
  process.cwd(),
  'src/modules/settings/components/AppearanceSettingsTab.tsx'
);

test('AppearanceSettingsTab delegates preview and cleanup restore to buildThemeVariables without raw preset style writes', () => {
  const source = readFileSync(COMPONENT_PATH, 'utf8');

  assert.match(
    source,
    /import\s+\{\s*buildThemeVariables\s*\}\s+from\s+['"]\.\.\/\.\.\/\.\.\/context\/themeTokenAdapter['"]/,
    'AppearanceSettingsTab must import buildThemeVariables from themeTokenAdapter'
  );

  assert.match(
    source,
    /if\s*\(\s*!previewPresetId\s*\)\s*\{\s*return;\s*\}/,
    'AppearanceSettingsTab must skip applying preview variables when previewPresetId is null'
  );

  assert.match(
    source,
    /buildThemeVariables\(\s*presetToApply,\s*theme,\s*previewPresetId\s*\?\s*null\s*:\s*customAccentColor\s*\)/,
    'AppearanceSettingsTab must build preview variables with current theme mode'
  );

  assert.match(
    source,
    /return\s*\(\)\s*=>\s*\{[\s\S]*?buildThemeVariables\(\s*currentPreset,\s*theme,\s*customAccentColor\s*\)/,
    'AppearanceSettingsTab must restore currentPreset with theme and customAccentColor on cleanup'
  );

  const forbiddenRawWrites = [
    "root.style.setProperty('--primary-color', presetToApply.primary)",
    "root.style.setProperty('--bg-color', presetToApply.background)",
    "root.style.setProperty('--card-color', presetToApply.card)",
    "root.style.setProperty('--text-color', presetToApply.text)",
    "root.style.setProperty('--border-color', presetToApply.border)",
  ];

  for (const rawWrite of forbiddenRawWrites) {
    assert.equal(
      source.includes(rawWrite),
      false,
      `AppearanceSettingsTab must not directly write raw preset token: ${rawWrite}`
    );
  }
});

test('buildThemeVariables preserves dark mode during light-preset preview and restores custom accent on cleanup', () => {
  const lightPreset = THEME_PRESETS.find((p) => p.id === 'prodx_signature');
  const previewPreset = THEME_PRESETS.find((p) => p.id === 'classic_light');
  assert.ok(lightPreset, 'prodx_signature preset must exist');
  assert.ok(previewPreset, 'classic_light preset must exist');

  const previewVars = buildThemeVariables(previewPreset, 'dark', null);
  assert.equal(previewVars['--bg-color'], '#12171a', 'Preview in dark mode must preserve dark background');
  assert.equal(previewVars['--brand-bg'], '#12171a', 'Preview in dark mode must preserve dark --brand-bg');
  assert.equal(previewVars['--brand-primary'], previewPreset.primary, 'Preview must show hovered preset primary');

  const restoredVars = buildThemeVariables(lightPreset, 'dark', '#047857');
  assert.equal(restoredVars['--bg-color'], '#12171a', 'Restore in dark mode must preserve dark background');
  assert.equal(restoredVars['--primary-color'], '#047857', 'Restore must re-apply customAccentColor');
  assert.equal(restoredVars['--brand-primary'], '#047857', 'Restore must re-apply customAccentColor to --brand-primary');
});
