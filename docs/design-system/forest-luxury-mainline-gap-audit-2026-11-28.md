# PRODX POS — Forest Luxury Mainline Gap Audit

- Audit date: 2026-11-28
- Repository: `prodxowner-png/PRODX-POS`
- Audited base: `dad6e0cc7ad307569696cf462cc9badcd8eb82d3`
- Branch: `audit/forest-luxury-mainline-gap-20261128`
- Scope: static source and documentation audit of the existing frontend design-system integration
- Execution boundary: read-only source inspection; no application code, runtime configuration, database, migration, auth, RLS, or production changes
- Runtime limitation: the registered Desktop Commander device was offline during this audit, so local tests and browser-based screenshot verification were not executed

## Executive summary

The Forest Luxury design-system foundation is present on `main`: the semantic brand stylesheet is imported, Tailwind semantic utilities are registered, the theme adapter maps ten presets into both semantic and legacy variables, and application components consume semantic roles in multiple modules.

The repository documentation does not consistently reflect that state. Several documents still describe the tokens as opt-in or not wired, despite the current import graph and consumers. At the same time, the UI is a deliberate mixed migration: semantic roles coexist with legacy Tailwind theme utilities. This is not automatically a defect because the existing design-system plan explicitly preserves the legacy variable contract during incremental adoption.

The next safe step is a measured, route-by-route semantic migration and visual verification—not a global search-and-replace or a new parallel design system.

## Evidence inspected

- `src/main.tsx`: imports `index.css`, `premium-design-system.css`, and `prodx-brand-tokens.css`.
- `src/index.css`: imports `prodx-brand-tokens.css` and maps semantic brand, CTA, and status roles into Tailwind utilities.
- `src/context/ThemeContext.tsx`: applies `buildThemeVariables` and persists theme/preset configuration through the existing configuration manager.
- `src/context/themePresets.ts`: defines ten presets and legacy preset aliases.
- `src/context/themeTokenAdapter.ts`: maps semantic and legacy variables, validates custom accents, and calculates contrast.
- `src/design-system/semanticTokenContract.ts` and tests: enforce required light/dark semantic token presence and CTA/status token invariants.
- `src/design-system/contrastEvidence.test.ts`: checks selected semantic contrast pairs and all ten presets in light/dark modes.
- Representative consumers inspected: `LoginScreen.tsx`, `AdminLoginScreen.tsx`, `AdminConsoleLayout.tsx`, `Sidebar.tsx`, `RbacGuard.tsx`, `CartPanel.tsx`, `PaymentConfirmationModal.tsx`, `DashboardScreen.tsx`, and `InventoryScreen.tsx`.
- Existing records: `docs/design-system/forest-luxury-design-system-v1.md`, `forest-luxury-implementation-status.md`, `forest-luxury-visual-qa.md`, and `docs/design/brand-tokens.md`.

## Findings

### F-01 — Documentation state is stale relative to the current source
- Severity: Medium
- Blocking: No for runtime; blocking for trustworthy design-system handoff/release evidence
- Evidence:
  - The design-system specification labels the system as a proposal not wired into runtime and says existing components do not consume semantic roles.
  - `docs/design/brand-tokens.md` still describes the palette as opt-in and says existing components do not consume the roles.
  - Current `src/main.tsx` and `src/index.css` import/register the brand stylesheet and utilities; current components use `bg-brand-*`, `text-brand-*`, and CTA utilities.
- Cause: implementation evolved after the original proposal, but the baseline/status wording was not reconciled.
- Recommendation: update the document status and baseline with the exact main SHA and distinguish (a) token foundation wired, (b) modules partially migrated, and (c) route-level visual QA evidence. Do not rewrite historical verification claims as if they were rerun.

### F-02 — Semantic and legacy styling coexist across active modules
- Severity: Medium
- Blocking: No, provided the legacy compatibility contract remains intact
- Evidence:
  - Semantic classes are present in authentication, admin, RBAC, and selected POS surfaces.
  - Shared shell and POS components still contain legacy utility patterns such as `bg-card`, `text-text`, and `border-border`; examples include `AppShell.tsx`, `Sidebar.tsx`, `CartPanel.tsx`, and `PaymentConfirmationModal.tsx`.
  - The existing implementation plan explicitly requires legacy variables to remain valid during migration.
- Cause: incremental adoption is incomplete or mixed at component level; legacy classes still resolve through the active theme adapter.
- Recommendation: define a route/component migration matrix, prioritize high-frequency cashier flows and shared shell primitives, and migrate one cohesive surface at a time with behavior-preserving tests. Do not globally replace legacy classes.

### F-03 — The premium utility stylesheet is currently dormant by class-reference search
- Severity: Low
- Blocking: No
- Evidence: repository code search for `.prodx-premium-button-primary`, `.prodx-premium-surface`, and `.prodx-premium-card` returned only `src/premium-design-system.css`, with no component consumers found.
- Cause: a second premium styling layer exists but is not demonstrably part of active component rendering.
- Recommendation: keep it out of the migration path until ownership is decided. Either document it as a dormant compatibility layer or later consolidate/remove it in a separately reviewed change after a complete reference check. Its legacy primary-button foreground must not be treated as the approved orange payment CTA rule.

### F-04 — Brand stylesheet is imported through two source paths
- Severity: Low
- Blocking: No; build output was not available to prove whether bundling deduplicates it
- Evidence: `src/index.css` imports `./prodx-brand-tokens.css`, and `src/main.tsx` imports that stylesheet directly as well.
- Cause: token registration was retained at both the global CSS entry and module entry.
- Recommendation: inspect Vite production CSS output before changing either import. If duplicated rules are emitted, retain one canonical import and add a build-level regression assertion.

### F-05 — Current automated contracts validate token data more strongly than rendered consumer coverage
- Severity: Medium
- Blocking: No for current token foundation; blocking for a claim of complete route-level visual conformance
- Evidence:
  - The semantic contract tests validate the token stylesheet and dark overrides.
  - Contrast tests exercise semantic token pairs across ten presets and both modes.
  - These tests do not establish that every rendered component/route uses the intended semantic role or that every interactive state has the expected rendered contrast.
- Cause: token correctness and component adoption are separate test concerns.
- Recommendation: add a bounded consumer-coverage contract for agreed critical components, plus browser-based visual/a11y checks for light/dark and responsive states. Keep source-level checks distinct from screenshot/runtime evidence.

### F-06 — Visual QA evidence has explicit hardware and assistive-technology limits
- Severity: Low
- Blocking: No for software-only CI; blocking for a claim of full physical-device accessibility validation
- Evidence: the existing visual QA record marks physical POS touchscreen pressure/latency and synthesized screen-reader audio verification as not tested.
- Cause: those checks require physical POS hardware and human-operated screen-reader sessions.
- Recommendation: preserve these as explicit release checklist items; do not convert them to PASS based on source inspection or automated tests.

## Verified design-system foundations

- Ten deterministic theme preset IDs and backward-compatible aliases are defined and covered by tests.
- The theme adapter emits both semantic brand roles and legacy runtime variables.
- Semantic CTA text is separated from the orange CTA fill in the token contract.
- The contrast test iterates all ten presets in light and dark modes for selected semantic foreground/background pairs.
- Existing code preserves the current configuration persistence and theme storage synchronization paths.
- The inspected changes are presentation-layer only; no evidence in this audit suggests changes to checkout, financial calculations, inventory authority, tenant isolation, authentication, RLS, or audit semantics.

## Verification status

| Check | Result | Evidence / limitation |
|---|---|---|
| Main branch and exact commit identified | PASS | `dad6e0cc7ad307569696cf462cc9badcd8eb82d3` |
| Source imports and token mapping inspected | PASS | Files listed above |
| Representative semantic consumers inspected | PASS | Auth, admin, shell, RBAC, POS, dashboard, inventory |
| Ten-preset contrast test source inspected | PASS (source only) | Test exists; it was not executed in this environment |
| Local unit/type/build tests | BLOCKED | Desktop Commander device was offline; no test execution is claimed |
| Browser screenshots / live route audit | BLOCKED | No connected browser runtime available in this turn |
| Production / database / secret changes | NOT PERFORMED | Read-only audit boundary |

## Recommended next implementation sequence

1. Reconcile documentation wording with the verified mainline source state; preserve dated historical evidence.
2. Produce a route/component adoption matrix for the 15 application routes, separating semantic consumers from legacy-token consumers.
3. Prioritize shared shell, POS catalog/cart/payment, inventory, and admin surfaces; migrate only scoped components per PR.
4. Add consumer coverage tests for the selected critical surfaces and verify CTA/destructive/status distinctions.
5. Run the repository's pinned toolchain (Node 24.12.x, npm 11.21.x) and required lint, server check, theme validation, client/server tests, and build gates.
6. Run browser visual QA across the approved breakpoints and light/dark modes; separately record physical hardware and screen-reader checks.
7. Keep PR #360's Edge Sync recovery work independent and on HOLD until its own current-head independent review and isolated Cloudflare Staging gates are satisfied.

## Release and safety decision

- This audit does not authorize merging PR #360, deploying to Production, modifying production configuration, or changing database/security controls.
- No application code or runtime behavior was changed by this audit.
- The design-system foundation is present, but complete route-level semantic adoption and visual verification are not established by this static audit.
