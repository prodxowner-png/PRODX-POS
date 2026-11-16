# PRODX brand tokens (Green × Cream × Orange)

Source: `src/prodx-brand-tokens.css`.

## Status

Additive and **opt-in**. Existing components do not consume these roles yet, so
registering the variables does not change current screen styles. The runtime
theme variables (`--primary-color`, `--bg-color`, `--card-color`, ...) and
`premium-design-system.css` remain untouched.

## Usage

Use semantic roles (`--brand-bg`, `--brand-text`, `--brand-cta`, ...) in
components. They switch with the `.dark` class (also
`[data-theme="dark"]`). Raw palette variables (`--brand-green-800`, ...)
are reference values for defining semantic roles.

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
- Gold is for icons and badges on dark green, or decorative lines; do not use gold as text on charcoal dark surfaces.
- Input and outlined-button borders use `--brand-border-strong`, not `--brand-border`.
- Destructive actions (refund, delete) use `--brand-danger` and must stay visually separate from the CTA.
- Never rely on colour alone for status; pair with an icon or text.
- Use status text tokens on their corresponding subtle surface. Status fill tokens are not automatically safe for small white text.
- All literal colour values in this token file are restricted to the approved palette; do not add new shades without explicit approval.

## Validated contrast pairs (WCAG 2.x, calculated)

| Pair | Ratio | Requirement |
|---|---:|---|
| green-800 on cream-100 | 10.7:1 | text 4.5:1 |
| ink-900 on cream-100 | 13.9:1 | text 4.5:1 |
| ink-500 on cream-100 | 5.6:1 | text 4.5:1 |
| ink-900 on orange-500 (CTA) | 6.0:1 | text 4.5:1 |
| ink-900 on orange-600 (pressed) | 5.0:1 | text 4.5:1 |
| orange-800 on cream-100 | 5.0:1 | text 4.5:1 |
| gold-500 on green-800 | 5.4:1 | text/icon 4.5:1 |
| success-800 text on success-100 | 6.3:1 | text 4.5:1 |
| warning-800 text on warning-100 | 6.3:1 | text 4.5:1 |
| danger-800 text on danger-100 | 6.6:1 | text 4.5:1 |
| info-800 text on info-100 | 7.0:1 | text 4.5:1 |
| ink-400 on cream-100 (input borders) | 3.3:1 | UI 3.0:1 |
| night text on night surface-1 | 13.8:1 | text 4.5:1 |
| orange-500 on night surface-1 | 6.2:1 | text 4.5:1 |
| night border-strong on surface-1 | 3.9:1 | UI 3.0:1 |

Known limits:
- `--brand-success` (#1A7F4F) used as small text on cream is 4.46:1; use
  `--brand-success-text` on `--brand-success-subtle` instead.
- White on `--brand-success` is 4.3:1 and does not meet 4.5:1. Do not use
  white small text on that fill. Use the status text/subtle pair.
- `ink-300` and `cream-300` are for disabled / decorative use only.
- Hairline and decorative borders are not substitutes for required interactive
  boundaries; use `--brand-border-strong` for input and outlined controls.

Values are calculated, not eyeballed. Review the actual login, payment, refund,
and responsive screens before adopting these tokens across the app.

## Not included (follow-up decisions)

- Wiring these roles into the runtime theme injector (`index.html` / `src/context`)
  so the whole app switches to green/cream. The app currently defaults to a
  blue/slate dark theme, so this remains a separate product decision.
- Tailwind v4 `@theme` utilities (for example `bg-brand-cta`). Add them when
  components start consuming these utilities.
