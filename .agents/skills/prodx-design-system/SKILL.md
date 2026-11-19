---
name: prodx-design-system
description: Maintains the PRODX-POS visual language, design tokens, themes, typography, spacing, component variants, and reusable UI patterns.
---

# PRODX-POS Design System

## Objective
Keep the product visually coherent, accessible, themeable, and maintainable across POS, Owner Console, and administration surfaces.

## Source of truth
- Inspect existing theme definitions, CSS variables, component primitives, theme presets, and `theme-validator.ts` before changing styles.
- Extend the existing source of truth; do not create parallel token systems or hard-code values that bypass theme infrastructure.
- Preserve existing brand decisions and theme compatibility. Do not silently replace the established palette, typography, radii, shadows, or density.
- Prefer semantic tokens (surface, text, border, accent, success, warning, danger, focus) over raw color values in feature components.

## Token and component rules
- Define tokens by purpose, not by a single screen or component name.
- Keep color contrast appropriate for text, controls, disabled states, focus indicators, and status communication.
- Establish consistent typography roles, spacing scale, sizing, radii, elevation, borders, and motion durations.
- Component variants must express meaningful states (size, emphasis, intent, density, loading, disabled) without multiplying near-duplicate components.
- Components must expose accessible names, labels, focus behavior, and state semantics.
- Theme presets must provide equivalent semantic token coverage; missing values must have safe fallbacks.
- Avoid one-off inline styling when a reusable token or component variant is appropriate.
- Do not use color alone to communicate success, warning, error, selection, or disabled state.

## Required workflow
1. Inventory current tokens, themes, primitives, and usage before editing.
2. Identify whether the change belongs in a token, shared component, or feature-level composition.
3. Make the smallest coherent extension and document any new semantic token.
4. Verify all existing themes and affected component variants.
5. Run the repository theme validator and relevant visual/component tests.
6. Check for hard-coded colors, duplicated CSS, inconsistent states, and regressions.

## Checklist
- [ ] Existing token/theme source of truth is reused.
- [ ] Semantic tokens cover light/dark or supported theme variants.
- [ ] No accidental palette or brand drift is introduced.
- [ ] Typography, spacing, states, and component variants are consistent.
- [ ] Contrast and focus states are visible.
- [ ] Theme validator and applicable tests pass on the candidate revision.
- [ ] No unrelated global restyling or dependency churn is included.

## Evidence contract
List changed token/theme/component files, theme presets exercised, validator/test commands and results, and exact SHA. If screenshot or browser verification is unavailable, mark it UNVERIFIED rather than PASS.
