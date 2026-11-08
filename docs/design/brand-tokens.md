# PRODX brand tokens (Green × Cream × Orange)

Source: `src/prodx-brand-tokens.css`.

## Status

Additive and **opt-in**. No existing component reads these variables, so merging
this change does not alter any current screen. The runtime theme variables
(`--primary-color`, `--bg-color`, `--card-color`, ...) and
`premium-design-system.css` are untouched.

## Usage

Use the semantic roles (`--brand-bg`, `--brand-text`, `--brand-cta`, ...) in
components. They switch automatically with the `.dark` class (also
`[data-theme="dark"]`). The raw palette (`--brand-green-800`, ...) is for
reference and for building new roles.

Example:

```css
.pay-button {
  background: var(--brand-cta);
  color: var(--brand-cta-text);
  min-height: 48px;
}
.pay-button:hover { background: var(--brand-cta-hover); }
.pay-button:active { background: var(--brand-cta-pressed); }
```

## Rules

- CTA / payment buttons: label colour is `--brand-cta-text` (ink-900). Never white on orange.
- Do not use orange `#E8894A` or gold `#D5A64A` as text on cream. Use `--brand-text-accent` / `--brand-text-gold`.
- Gold is for icons and badges on dark green, or decorative lines.
- Input and outlined-button borders use `--brand-border-strong`, not `--brand-border`.
- Destructive actions (refund, delete) use `--brand-danger` and must stay visually separate from the CTA.
- Never rely on colour alone for status; pair with an icon or text.

## Validated contrast pairs (WCAG 2.x, calculated)

| Pair | Ratio | Requirement |
|---|---|---|
| green-800 on cream-100 | 10.7 | text 4.5 |
| ink-900 on cream-100 | 13.9 | text 4.5 |
| ink-500 on cream-100 | 5.6 | text 4.5 |
| ink-900 on orange-500 (CTA) | 6.0 | text 4.5 |
| ink-900 on orange-600 (pressed) | 5.0 | text 4.5 |
| orange-800 on cream-100 | 5.0 | text 4.5 |
| gold-500 on green-800 | 5.4 | text/icon |
| white on success-600 | 5.0 | text 4.5 |
| white on danger-600 | 5.5 | text 4.5 |
| white on info-600 | 5.4 | text 4.5 |
| ink-900 on warning-500 | 6.3 | text 4.5 |
| ink-400 on cream-100 (borders) | 3.3 | UI 3.0 |
| night text on night surface-1 | 13.8 | text 4.5 |
| orange-500 on night surface-1 | 6.2 | text 4.5 |
| night border-strong on surface-1 | 3.9 | UI 3.0 |

Known limits: `--brand-success` (success-600) as *text* on cream is 4.46:1; use
`--brand-success-text` instead. `ink-300` and `cream-300` are for disabled /
decorative use only.

Values were computed, not eyeballed on a device. Review them on real screens
(login, payment, refund) before adopting them widely.

## Not included (follow-up decisions)

- Wiring these roles into the runtime theme injector (`index.html` / `src/context`)
  so the whole app can switch to the green/cream theme. The app currently defaults
  to a blue/slate dark theme, so this is a product decision, not part of this change.
- Tailwind v4 `@theme` utilities (for example `bg-brand-cta`). They need an import
  in `src/index.css`; add them when components start using utilities.
