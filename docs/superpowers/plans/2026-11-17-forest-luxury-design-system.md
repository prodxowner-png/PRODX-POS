# PRODX POS Forest Luxury Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely adopt the approved Forest Luxury semantic design system across PRODX POS, add ten deterministic theme presets, and migrate shared UI patterns without changing backend or business behavior.

**Architecture:** Keep the current ThemeContext and legacy CSS variable contract operational while introducing a single semantic token adapter. Theme presets supply complete semantic maps; shared shell and POS components consume semantic roles incrementally. The selected Forest Luxury preset is canonical, and all existing persisted preset IDs remain backward compatible.

**Tech Stack:** React 19, TypeScript 5.8, Vite 6, Tailwind CSS 4, CSS custom properties, lucide-react, existing Node test runner and theme validator.

**Spec:** `docs/design-system/forest-luxury-design-system-v1.md`

## Global Constraints

- Do not modify backend APIs, business logic, database schemas, migrations, RLS, grants, authentication, authorization, audit semantics, financial calculations, inventory rules, or offline-sync lifecycle.
- Keep the existing legacy runtime variables (`--primary-color`, `--bg-color`, `--card-color`, etc.) valid during migration.
- Use semantic roles from `src/prodx-brand-tokens.css`; do not duplicate raw brand colors in components.
- Orange CTA labels use `--brand-cta-text`; never white on orange.
- Destructive actions remain separate from payment/primary actions.
- Every theme preserves semantic status meanings and must have deterministic contrast-safe token mappings.
- Preserve existing persisted theme IDs through explicit compatibility mapping.
- No new font or UI dependency without separate justification.
- No production deployment or live configuration changes.

## Review Focus

- Legacy persisted preset IDs and unknown IDs must resolve deterministically without losing user settings.
- Custom accent values that are malformed or produce unreadable contrast must fail closed to a valid preset.
- Switching between light and dark mode must not leave stale semantic variables from the previous preset.
- Offline, sync, payment, inventory, and destructive states must retain explicit text/icon semantics across every theme.
- Mobile POS cart sheet and navigation must preserve keyboard focus, safe-area behavior, and minimum touch targets.

---

### Task 1: Lock semantic token contract

**Files:**
- Modify: `src/prodx-brand-tokens.css`
- Create: `src/design-system/semantic-token-contract.ts`
- Create: `src/design-system/semantic-token-contract.test.ts`

**Interfaces:**
- Produces: typed token-name contract for brand, surface, text, border, CTA, focus, and status roles.
- Consumes: existing approved palette values and semantic mappings from the spec.

- [x] **Step 1: Write failing contract tests** for required token names, approved palette values, and presence of light/dark semantic roles.
- [x] **Step 2: Run** `node --import tsx --test src/design-system/semantic-token-contract.test.ts`; expect failure because the contract module is not yet present.
- [x] **Step 3: Implement** a typed semantic token contract without changing existing runtime variable names.
- [x] **Step 4: Run the focused test** and existing theme validator.
- [x] **Step 5: Review the CSS diff** to confirm only approved palette values are introduced.

### Task 2: Define ten deterministic theme presets

**Files:**
- Modify: `src/context/ThemeContext.tsx`
- Create: `src/context/themePresets.ts`
- Create: `src/context/themePresets.test.ts`

**Interfaces:**
- `ThemePreset`: stable `id`, bilingual metadata, `isDark`, semantic token map, and swatches.
- `THEME_PRESETS`: exactly ten supported presets.
- `resolveLegacyPresetId(id: string): string`: resolves all six current IDs and documented legacy IDs to supported presets.

- [x] **Step 1: Write failing tests** for exactly ten unique IDs, complete semantic maps, valid hex/color values, and backward compatibility for every existing preset ID.
- [x] **Step 2: Run** `node --import tsx --test src/context/themePresets.test.ts`; expect failure before implementation.
- [x] **Step 3: Extract** preset data from ThemeContext into `themePresets.ts`; keep current six IDs readable and map them explicitly.
- [x] **Step 4: Add** the four new presets from the spec; every preset must define all semantic roles and light/dark behavior.
- [x] **Step 5: Run** focused tests and `npm run theme:validate`; do not use the auto-fix command as a substitute for review.

### Task 3: Adapt ThemeContext to semantic tokens

**Files:**
- Modify: `src/context/ThemeContext.tsx`
- Create: `src/context/themeTokenAdapter.ts`
- Create: `src/context/themeTokenAdapter.test.ts`

**Interfaces:**
- `buildThemeVariables(preset: ThemePreset, mode: ThemeMode, customAccent: string | null): Record<string, string>`
- Output includes all legacy variables plus the semantic `--brand-*` roles.

- [x] **Step 1: Write failing tests** for light/dark mapping, preset switching, system mode, unknown preset fallback, custom accent validation, and absence of stale variables.
- [x] **Step 2: Run** focused tests and confirm the new adapter tests fail.
- [x] **Step 3: Implement** pure token mapping; remove runtime color derivation by appending alpha bytes to arbitrary custom strings.
- [x] **Step 4: Wire** ThemeContext to apply the adapter output while preserving ConfigPersistenceManager persistence and storage-event synchronization.
- [x] **Step 5: Run** adapter tests, ThemeContext tests, and `npm run theme:validate`.

### Task 4: Migrate shared shell primitives

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Modify: `src/components/layout/TopNav.tsx`
- Modify: `src/components/layout/StatusBar.tsx`
- Modify: `src/components/layout/OfflineBanner.tsx`
- Create or update the nearest existing component tests.

**Interfaces:**
- Shared shell components consume semantic CSS roles only; route, offline, and authorization behavior remains unchanged.

- [x] **Step 1: Add regression tests** for active navigation, focus visibility, offline status text/icon, and responsive navigation visibility.
- [x] **Step 2: Migrate** sidebar, top bar, status bar, and offline banner styles to semantic roles.
- [x] **Step 3: Verify** the 44px minimum touch target and 48px preferred POS controls.
- [x] **Step 4: Run** focused component tests and TypeScript lint.

### Task 5: Migrate POS visual patterns only

**Files:**
- Modify: existing POS product-grid, cart, payment-summary, and category components under `src/modules/pos/`.
- Add/update tests next to the touched components.

**Interfaces:**
- POS components render existing values and invoke existing callbacks; they do not calculate authoritative money, taxes, discounts, inventory availability, or payment outcomes.

- [x] **Step 1: Add visual/behavior regression tests** for product selection, quantity controls, cart states, payment summary rendering, and destructive-action separation.
- [x] **Step 2: Apply** product card, cart line item, payment summary, and CTA tokens from the spec.
- [x] **Step 3: Add** responsive cart-sheet presentation without changing checkout command semantics.
- [x] **Step 4: Run** POS tests and inspect the complete diff for accidental business logic changes.

### Task 6: Accessibility and responsive validation

**Files:**
- Create: `docs/design-system/forest-luxury-visual-qa.md`
- Add/update tests for contrast and responsive behavior where deterministic.

- [x] **Step 1: Add** token-pair contrast tests for all actual theme foreground/background pairs and focus boundaries.
- [x] **Step 2: Verify** keyboard navigation, accessible names, form labels, dialog focus handling, and reduced-motion behavior.
- [x] **Step 3: Verify** Desktop (>=1280px), Tablet (768–1279px), and Mobile (<=767px) POS layouts.
- [x] **Step 4: Run** `npm run lint`, `npm run build`, `npm run theme:validate`, relevant unit tests, and full suite where practical.
- [x] **Step 5: Review** exact PR diff and CI results; do not merge or deploy without required checks and owner approval.

## Handoff gates

- Documentation in the spec is the visual contract.
- Runtime implementation starts only after this plan is reviewed and approved.
- The work must be isolated to a dedicated design branch and submitted as a reviewable PR.
- If a task exposes a conflict with existing runtime behavior, stop and report it rather than weakening security, financial, inventory, audit, or offline invariants.
