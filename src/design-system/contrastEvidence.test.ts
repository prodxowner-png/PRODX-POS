import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_PRESETS } from '../context/themePresets';
import { buildThemeVariables, getContrastRatio } from '../context/themeTokenAdapter';

test('WCAG 2.2 contrast: Forest Luxury core semantic pairs meet contrast targets', () => {
  // Spec Section 3.1 & 3.4
  const cream100 = '#f7f1e8';
  const forest800 = '#183d32';
  const ink900 = '#20242b';
  const ink500 = '#5a616d';
  const orange500 = '#e8894a'; // Payment CTA fill
  const orange800 = '#a84c1a'; // Accent text on cream
  const danger800 = '#991b1b';
  const danger100 = '#fee2e2';

  // Ink 900 on Cream 100 (Primary text) target >= 7.0:1 (AAA)
  const inkOnCream = getContrastRatio(ink900, cream100);
  assert.ok(inkOnCream >= 7.0, `Ink on Cream must be >= 7.0:1, got ${inkOnCream.toFixed(2)}`);

  // Forest 800 on Cream 100 (Brand on workspace) target >= 4.5:1 (AA normal text)
  const forestOnCream = getContrastRatio(forest800, cream100);
  assert.ok(forestOnCream >= 4.5, `Forest on Cream must be >= 4.5:1, got ${forestOnCream.toFixed(2)}`);

  // Ink 900 on Orange 500 CTA (Approved orange CTA rule: ink text on orange, NEVER white)
  const inkOnOrange = getContrastRatio(ink900, orange500);
  assert.ok(inkOnOrange >= 4.5, `Ink on Orange CTA must be >= 4.5:1 (AA), got ${inkOnOrange.toFixed(2)}`);

  // Confirm white on Orange 500 fails or is worse than ink
  const whiteOnOrange = getContrastRatio('#ffffff', orange500);
  assert.ok(
    inkOnOrange > whiteOnOrange,
    `Ink on orange (${inkOnOrange.toFixed(2)}) must be higher contrast than white on orange (${whiteOnOrange.toFixed(2)})`,
  );

  // Secondary text Ink 500 on Cream 100 target >= 4.5:1
  const ink500OnCream = getContrastRatio(ink500, cream100);
  assert.ok(ink500OnCream >= 4.5, `Ink 500 on Cream must be >= 4.5:1, got ${ink500OnCream.toFixed(2)}`);

  // Accent text Orange 800 on Cream 100 target >= 4.5:1
  const orange800OnCream = getContrastRatio(orange800, cream100);
  assert.ok(orange800OnCream >= 4.5, `Orange 800 on Cream must be >= 4.5:1, got ${orange800OnCream.toFixed(2)}`);

  // Danger 800 on Danger 100 target >= 4.5:1
  const dangerOnSubtle = getContrastRatio(danger800, danger100);
  assert.ok(dangerOnSubtle >= 4.5, `Danger text on subtle must be >= 4.5:1, got ${dangerOnSubtle.toFixed(2)}`);
});

test('WCAG 2.2 contrast: all 10 presets meet >= 4.5:1 across text, muted, primary, CTA, and status pairs in light and dark modes', () => {
  for (const preset of THEME_PRESETS) {
    for (const mode of ['light', 'dark'] as const) {
      const vars = buildThemeVariables(preset, mode, null);
      const pairs: Array<[string, string, string]> = [
        ['text/surface', vars['--brand-text'], vars['--brand-surface']],
        ['text/bg', vars['--brand-text'], vars['--brand-bg']],
        ['textMuted/surface', vars['--brand-text-muted'], vars['--brand-surface']],
        ['primaryText/primary', vars['--brand-primary-text'], vars['--brand-primary']],
        ['ctaText/cta', vars['--brand-cta-text'], vars['--brand-cta']],
        ['successText/successSubtle', vars['--brand-success-text'], vars['--brand-success-subtle']],
        ['warningText/warningSubtle', vars['--brand-warning-text'], vars['--brand-warning-subtle']],
        ['dangerText/dangerSubtle', vars['--brand-danger-text'], vars['--brand-danger-subtle']],
        ['infoText/infoSubtle', vars['--brand-info-text'], vars['--brand-info-subtle']],
      ];

      for (const [label, fg, bg] of pairs) {
        const ratio = getContrastRatio(fg, bg);
        assert.ok(
          ratio >= 4.5,
          `Preset "${preset.id}" (${mode}) ${label} (${fg} on ${bg}) must be >= 4.5:1 (AA), got ${ratio.toFixed(2)}`,
        );
      }
    }
  }
});
