# PRODX POS — Forest Luxury Design System v1

- Status: Phase 2 design specification (proposal; not yet wired into runtime)
- Date: 2026-11-17
- Product: PRODX POS, multi-tenant retail POS
- Selected direction: A — Forest Luxury POS
- Visual references: approved POS screen (forest sidebar / cream workspace / orange payment CTA) and the three-direction proposal board, with Direction A selected.
- Scope: Frontend visual system only. No backend, database, RLS, grants, auth, financial, inventory, or sync behavior changes.

## 1. Design intent

Create one coherent, responsive visual language for cashier-facing POS and management/back-office workflows. The system should feel premium and calm without slowing down high-frequency retail operations. The POS screen is the reference composition: persistent forest navigation, warm cream workspace, product discovery grid, persistent cart/checkout summary on wide screens, and a clear orange payment action.

### Goals
- One semantic token contract shared by every module.
- Predictable component anatomy, variants, states, and accessibility behavior.
- Desktop, tablet, and mobile layouts that preserve task priority rather than merely shrinking desktop.
- Ten selectable visual presets that change brand expression without changing business meaning.
- Incremental adoption without breaking existing runtime theme settings.

### Non-goals
- No change to API contracts, business rules, transaction calculations, inventory authority, offline queue behavior, authentication, authorization, tenant/store scoping, or audit semantics.
- No direct replacement of all current styles in this phase.
- No claim that this spec is already implemented or production-verified.

## 2. Repository baseline and constraints

Reviewed on `main` at `dbd8db8b56f0634830624b4b4c67c1f7b2e7e392`:
- `src/context/ThemeContext.tsx` currently exposes six presets and injects legacy variables such as `--primary-color`, `--bg-color`, and `--card-color`.
- `src/prodx-brand-tokens.css` defines an additive, opt-in Green/Cream/Orange semantic palette. Existing components do not yet consume these roles.
- `src/premium-design-system.css` maps its brand and surface roles to legacy runtime variables. Its primary button uses white text, which is not suitable for the approved orange CTA rule.
- `src/components/layout/AppShell.tsx` already has a desktop sidebar, mobile navigation drawer, top navigation, offline banner, mobile quick navigation, and status bar.
- `package.json` provides React 19, TypeScript 5.8, Vite 6, Tailwind CSS 4, and lucide-react. Do not add a font or UI dependency solely for this phase.

### Integration guardrails
1. Treat `prodx-brand-tokens.css` as the semantic source of truth for the selected Forest Luxury direction.
2. Keep legacy variables working during migration; do not silently change their meaning.
3. Do not import new token files globally until the consuming components and contrast checks are verified.
4. Do not let a visual theme alter tax, discount, payment, refund, stock, authorization, or audit meaning.
5. Preserve tenant and branch-specific configuration boundaries; a theme selection is presentation configuration, never authorization.
6. Theme changes must not alter persisted operational data.

## 3. Foundation tokens

The values below reuse the approved values already present in `src/prodx-brand-tokens.css`. Components should consume semantic roles, not raw palette values.

### 3.1 Core palette

| Role | Token | Value | Usage |
|---|---|---:|---|
| Forest 900 | `--brand-green-900` | `#0f2a22` | Main sidebar / deepest brand surface |
| Forest 800 | `--brand-green-800` | `#183d32` | Primary navigation and brand controls |
| Forest 700 | `--brand-green-700` | `#245a47` | Hover / secondary forest surface |
| Forest 600 | `--brand-green-600` | `#2f6f58` | Pressed / dark-mode primary |
| Cream 50 | `--brand-cream-50` | `#fbf8f3` | Raised workspace surface |
| Cream 100 | `--brand-cream-100` | `#f7f1e8` | Main workspace background |
| Cream 200 | `--brand-cream-200` | `#ede4d5` | Muted surface |
| Ink 900 | `--brand-ink-900` | `#20242b` | Primary text |
| Ink 700 | `--brand-ink-700` | `#3a404a` | Secondary text |
| Ink 500 | `--brand-ink-500` | `#5a616d` | Muted text |
| Orange 500 | `--brand-orange-500` | `#e8894a` | Primary CTA fill |
| Orange hover | `--brand-orange-hover` | `#ee9659` | CTA hover |
| Orange 600 | `--brand-orange-600` | `#d97a3b` | CTA pressed |
| Orange 800 | `--brand-orange-800` | `#a84c1a` | Readable accent text on cream |
| Gold 500 | `--brand-gold-500` | `#d5a64a` | Decorative/icon use on dark green only |

### 3.2 Semantic roles

Light mode:
- Background: `--brand-bg`
- Surface: `--brand-surface`
- Raised surface: `--brand-surface-raised`
- Muted surface: `--brand-surface-muted`
- Selected surface: `--brand-surface-selected`
- Text: `--brand-text`
- Secondary / muted text: `--brand-text-secondary` / `--brand-text-muted`
- Border / strong border: `--brand-border` / `--brand-border-strong`
- Primary navigation: `--brand-primary`
- Payment/action CTA: `--brand-cta`, label `--brand-cta-text`
- Status: `--brand-success`, `--brand-warning`, `--brand-danger`, `--brand-info` paired with corresponding `*-text` and `*-subtle` roles.

Dark mode uses the existing `--brand-night-*` palette and semantic overrides in `prodx-brand-tokens.css`.

### 3.3 Non-negotiable color rules
- Orange CTA label is dark ink (`--brand-cta-text`); never white on orange.
- Do not use orange or gold as small text on cream. Use `--brand-text-accent` / `--brand-text-gold`.
- Gold is limited to decoration or icons/badges on dark green.
- Refund, delete, void, and other destructive actions use danger roles and must remain visually distinct from the payment CTA.
- Never communicate online/offline, success/failure, stock state, or payment state by color alone; pair color with text and/or icon.
- Use `--brand-border-strong` for input and outlined-control boundaries.
- Do not add literal palette shades to the current approved token file without a separately reviewed palette change.

### 3.4 Existing contrast evidence

The current brand-token documentation records these calculated pairs:
- Forest 800 on Cream 100: 10.7:1.
- Ink 900 on Cream 100: 13.9:1.
- Ink 500 on Cream 100: 5.6:1.
- Ink 900 on Orange 500 CTA: 6.0:1.
- Orange 800 on Cream 100: 5.0:1.
- Gold 500 on Forest 800: 5.4:1.
- Danger 800 on Danger 100: 6.6:1.

These are existing token-pair results, not a blanket claim that every component or every theme passes WCAG. Recalculate actual rendered pairs for every theme and state before release.

## 4. Typography

Use a no-download font stack for the initial implementation:
- Latin: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif.
- Thai fallback: "Noto Sans Thai", "Leelawadee UI", Tahoma, sans-serif.

Proposed type scale:
| Token | Size | Typical use |
|---|---:|---|
| `--type-xs` | 12px | Metadata, helper text |
| `--type-sm` | 14px | Labels, secondary controls |
| `--type-md` | 16px | Default body and form text |
| `--type-lg` | 20px | Section headings |
| `--type-xl` | 24px | Page headings |
| `--type-2xl` | 32px | KPI / major totals |
| `--type-3xl` | 40px | High-emphasis amount on wide displays |

Body line-height: 1.5. Numeric financial values should use tabular numerals where supported. Avoid using font size alone to imply status.

## 5. Spacing, layout, radius, and elevation

All spacing derives from a 4px base:
- 1: 4px, 2: 8px, 3: 12px, 4: 16px, 5: 20px, 6: 24px, 8: 32px, 10: 40px, 12: 48px, 16: 64px.

Proposed shape tokens:
- Small control radius: 8px.
- Standard control radius: 12px.
- Card radius: 16px.
- Large panel radius: 20px.
- Pill: 999px.

Elevation:
- Level 0: no shadow; rely on surface and border.
- Level 1: subtle card separation.
- Level 2: popovers, menus, and floating controls.
- Level 3: dialogs and mobile sheets.
Use shadows sparingly; preserve visible borders on cream surfaces.

## 6. Responsive layout contract

| Viewport | Width | Shell | POS composition |
|---|---:|---|---|
| Mobile | <= 767px | Drawer + compact top bar + bottom quick nav | Product list first; cart opens as a dedicated bottom sheet |
| Tablet | 768–1279px | Collapsible sidebar / compact navigation | Split workspace when landscape; cart panel may become a sheet in portrait |
| Desktop | >= 1280px | Persistent forest sidebar + top bar | Product grid and persistent right-side cart |

Rules:
- Use content-driven breakpoints where a module needs more room; the table above is the default contract.
- Touch targets: minimum 44×44px; prefer 48×48px for primary POS controls.
- Never solve mobile by scaling the desktop two-column POS down until text becomes unreadable.
- Preserve keyboard access and focus order when panels become drawers/sheets.
- Respect safe-area insets on mobile devices.
- Keep primary checkout action visible without hiding subtotal, discount, tax, or final amount.

## 7. Component library contract

Every shared component must define purpose, anatomy, variants, sizes, states, responsive behavior, and accessibility before adoption.

| Component | Required variants / states | Key behavior |
|---|---|---|
| Button | Primary, secondary, tertiary/ghost, destructive; default, hover, focus, active, disabled, loading | Explicit type; disabled/loading semantics; visible focus |
| Icon button | Default, selected, disabled, destructive | Accessible name; tooltip only supplements label |
| Text input | Default, hover, focus, invalid, disabled, read-only | Persistent label; error text linked to field |
| Search / barcode input | Search, scanning, loading, no result, error | Keyboard submit; scanner is an enhancement, not the only input path |
| Select / combobox | Closed, open, selected, empty, invalid, disabled | Keyboard navigation and clear selected value |
| Checkbox / radio | Unchecked, checked, indeterminate where valid, disabled | Native semantics and label association |
| Segmented control / tabs | Default, selected, disabled, focus | Selected state exposed semantically |
| Product card | Default, hover, selected, unavailable, low-stock | Product availability is text/icon, not color alone |
| Cart line item | Default, quantity editing, removing, unavailable | Quantity control has accessible increment/decrement labels |
| Payment summary | Subtotal, discount, tax, total, pending/paid | Render server-provided monetary values; do not calculate financial truth in UI |
| Status badge | Success, warning, danger, info, neutral | Icon/text plus color |
| Alert / toast | Info, success, warning, error | Announced politely; critical failures remain visible |
| Modal / drawer / bottom sheet | Open, closing, loading, error | Focus trap, Escape handling where safe, restore focus |
| Data table | Loading, empty, populated, error, selected | Responsive alternative for narrow screens |
| Pagination | First, previous, next, last, disabled | Announce current page and result range |
| Skeleton / empty / error | Loading, empty, retryable error, terminal error | Never disguise failed data as empty successful data |

### POS-specific patterns
- Product discovery: category, search, barcode entry, product grid/list, keyboard shortcuts.
- Cart: customer/order type, line items, quantity, notes, discount affordance, hold/resume.
- Payment summary: subtotal, discount, tax, total, payment CTA.
- Shift status: open/closed and cash state with explicit labels.
- Offline/sync: connection state, pending count, last sync, retry/attention state; no false claim that a queued command is completed.

## 8. Theme preset model — ten independent presets

A preset is a complete semantic token mapping, not a decorative accent swap. Each preset must define light/dark surface mapping, primary brand role, text roles, border roles, focus ring, status role pairings, and component appearance. All themes preserve the same semantic meanings for payment, success, warning, danger, offline, and inventory status.

1. **PRODX Signature** — Forest / Cream / Peach; default and canonical brand.
2. **Forest Luxury** — deeper forest and warm cream; premium hospitality and specialty retail.
3. **Obsidian Executive** — charcoal/night surfaces with controlled brand orange.
4. **Nordic Clean** — cool, bright neutral surfaces with high information clarity.
5. **Royal Emerald** — emerald-led light surfaces for gourmet and wellness retail.
6. **Cyber Neon** — dark high-energy surfaces; keep neon accents away from financial/status semantics.
7. **Sunset Gourmet** — warm cream and terracotta-inspired expression.
8. **Executive Slate** — restrained charcoal/slate for dense back-office use.
9. **Rose Luxury** — soft rose-neutral expression with unchanged danger semantics.
10. **Classic Light** — timeless neutral light interface with PRODX CTA semantics.

Theme isolation rules:
- A preset must be deterministic and fully specified; no runtime color guessing or deriving contrast variants by appending alpha bytes to arbitrary strings.
- User custom accent must be validated and mapped to readable semantic variants before activation; invalid values fail closed to the selected preset.
- A preset change must not change authorization, data scope, money, stock, or operational state.
- Existing six preset IDs must remain readable during migration. Do not remove or rename persisted IDs without a compatibility mapping and tests.

## 9. Accessibility and interaction

Target WCAG 2.2 AA for new components (the project brief previously named WCAG 2.1 AA; use the stricter current target for new work without claiming legacy screens already comply):
- Text contrast >= 4.5:1 for normal text and >= 3:1 for large text.
- Non-text interactive boundaries and focus indicators >= 3:1 against adjacent colors.
- Keyboard operation for every interactive control.
- Visible `:focus-visible` ring with offset; never remove focus without replacement.
- Touch targets >= 44×44px; prefer 48px in POS flows.
- Accessible names for icon-only controls; labels and descriptions for all form fields.
- Announce asynchronous status changes; do not rely on toast alone for critical errors.
- Respect `prefers-reduced-motion`.
- Use semantic landmarks, headings, table headers, and dialog semantics.

## 10. Adoption sequence

1. Keep current runtime theme behavior unchanged.
2. Map the canonical Forest Luxury preset to existing semantic brand tokens.
3. Add token contract tests and theme validation before runtime wiring.
4. Migrate shared shell primitives first (sidebar, top navigation, surfaces, buttons, inputs).
5. Migrate POS components and verify payment/cart contrast at desktop, tablet, and mobile.
6. Migrate back-office modules incrementally.
7. Add the remaining nine presets only after each palette has complete semantic mappings and contrast evidence.
8. Remove legacy token duplication only after repository-wide usage search and compatibility tests.

## 11. Acceptance criteria for Phase 2

- [ ] Semantic token contract is documented and maps to one source of truth.
- [ ] Ten theme presets have explicit, deterministic token maps and persisted-ID compatibility.
- [ ] Button, input, navigation, card, cart, payment summary, status, dialog, table, and feedback patterns have states documented.
- [ ] Desktop, tablet, and mobile shell/POS rules are explicit.
- [ ] WCAG contrast evidence exists for every actual foreground/background pair used in components and theme presets.
- [ ] No business logic, backend, auth, RLS, grants, financial, inventory, audit, or offline-sync behavior changes.
- [ ] Runtime implementation has tests and is reviewed independently before merge.
- [ ] Build, lint/typecheck, theme validation, and relevant visual QA pass on the exact PR head.

## 12. Known blockers / decisions before runtime adoption

- The existing runtime theme engine has six presets, not ten.
- Brand semantic tokens are opt-in and are not consumed by current components yet.
- The legacy premium button maps primary color to white text, which conflicts with the approved orange CTA text rule.
- The current runtime theme injector and brand semantic layer need an explicit adapter contract before they can safely coexist.
- Actual component-level contrast and mobile POS behavior have not yet been revalidated in a browser.

These are implementation gates, not reasons to weaken existing auth, data, or business invariants.
