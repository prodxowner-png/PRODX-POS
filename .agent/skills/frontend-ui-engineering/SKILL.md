---
name: frontend-ui-engineering
description: Builds production-quality, accessible, responsive user-facing UIs. Use when building or modifying interfaces and pages, creating components, implementing layouts, meeting WCAG accessibility requirements, managing state, or when the output needs to look and feel production-quality rather than AI-generated.
---

# Frontend UI Engineering

## Mission

Build production-quality user interfaces that are accessible, performant, responsive, and visually deliberate. Follow the existing product design system; do not produce generic AI-styled interfaces or stop at a mockup when production UI is requested.

## When to Use

- Building or modifying UI components, pages, dashboards, or application flows.
- Implementing responsive layouts, interaction states, or client-side state.
- Fixing visual, usability, accessibility, or frontend performance issues.
- Reviewing frontend changes for production readiness.

## Required Workflow

1. Inspect the existing application structure, routes, components, styles, design tokens, and relevant tests before changing code.
2. Identify the user's task, primary action, information hierarchy, required states, responsive behavior, and accessibility needs. Record assumptions when product requirements are unclear.
3. Reuse the established design system and component patterns. Do not introduce a second styling system or new dependency without a clear need.
4. Build the smallest cohesive, reusable components. Prefer composition over large configurable components; keep data fetching and business logic separate from presentation.
5. Implement loading, empty, error, success, disabled, and permission states where applicable. Never leave a blank screen for an expected state.
6. Verify the rendered UI at the required breakpoints and exercise keyboard and pointer interactions.
7. Run relevant frontend tests, typecheck, lint, and build commands that exist in the repository. Report exact commands and results; never claim checks that were not run.

## Component Architecture

- Colocate component implementation, tests, stories (if used), hooks, and component-specific types.
- Keep components focused and avoid prop drilling deeper than three levels.
- Use local state for component-only state; lifted state for nearby shared state; context for stable cross-cutting concerns such as theme/auth/locale; URL state for shareable filters and pagination; server-state tools for remote cached data; global stores only for genuinely complex shared client state.
- Use semantic HTML and native controls before custom interactive elements.
- Separate presentation from data access and side effects.

## Design Quality

### Reference-led design

When a distinct visual direction is needed:
1. Review two or three relevant, trustworthy product references or supplied design references.
2. Note hierarchy, density, navigation, controls, responsive behavior, and interaction states.
3. Write a short design contract: screen purpose, primary action, key content, required states, responsive rules, and patterns to avoid.
4. Translate useful principles into the product's own design tokens, components, content, and brand. Never copy another product's exact layout, branding, proprietary text, or imagery.

If references are unavailable, state assumptions and follow the repository's current design system.

### Avoid generic AI styling

- Do not default to purple/indigo palettes, excessive gradients, giant rounded cards, oversized whitespace, generic hero sections, or uniform card grids.
- Use the actual product palette, semantic color tokens, meaningful content, purposeful density, and consistent radius/shadow scales.
- Prefer content-first layouts and information hierarchy based on real user tasks.
- Use the project's spacing and typography scales; avoid arbitrary one-off values.
- Do not use color as the only way to communicate status.

## Accessibility — WCAG 2.1 AA baseline

- All functionality must be keyboard operable with visible focus indicators.
- Use semantic landmarks, headings in order, labels, and native buttons/inputs.
- Provide accessible names for icon-only controls and meaningful alt text for informative images.
- Manage focus correctly in dialogs, drawers, menus, and dynamic flows.
- Announce relevant asynchronous status and validation feedback to assistive technology.
- Maintain contrast of at least 4.5:1 for normal text and 3:1 for large text and essential UI graphics.
- Respect reduced-motion preferences; do not communicate meaning through motion alone.
- Use the accompanying `references/accessibility-checklist.md` during review.

## Responsive Design

Design mobile-first, then expand. Verify at 320px, 768px, 1024px, and 1440px. Check overflow, touch target size, navigation changes, table behavior, modal sizing, and readable content density. Do not treat responsive work as a later polish step.

## State, Performance, and Resilience

- Use the simplest state solution that fits the actual sharing and persistence requirements.
- Avoid unnecessary re-renders, oversized bundles, layout shifts, and expensive work on the main thread.
- Use skeletons for content loading where appropriate; provide retryable errors and useful empty states.
- Optimistic updates must have rollback/error handling and must not imply server confirmation before the server confirms it.
- Do not put secrets, privileged credentials, or authoritative business rules in client code.

## PRODX POS Frontend Constraints

- Preserve the existing PRODX POS brand and approved design tokens; do not invent a new visual identity.
- Preserve multi-tenant and multi-store boundaries in every UI data flow. Client-side hiding is not authorization; backend authorization remains authoritative.
- Treat client-side prices, tax, totals, inventory availability, and payment status as previews only. The server remains authoritative for all financial and inventory outcomes.
- Preserve offline queue and sync semantics. UI must distinguish pending, synced, conflicted, and failed operations without silently dropping user work.
- Never weaken authentication, RBAC, RLS, auditability, idempotency, or server-side validation to simplify UI implementation.
- Never expose secrets or service-role credentials in browser bundles, local storage, or client logs.
- Keep frontend changes scoped; do not modify backend contracts or database behavior unless the task explicitly requires it and the owning backend agent coordinates the change.

## Verification Gate

Before reporting frontend work complete, verify as applicable:

- [ ] No browser console errors or React warnings.
- [ ] Typecheck, lint, relevant tests, and production build pass.
- [ ] Keyboard-only navigation and visible focus work.
- [ ] Screen-reader names, labels, landmarks, and status announcements are meaningful.
- [ ] Layout works at 320px, 768px, 1024px, and 1440px without unintended overflow.
- [ ] Loading, empty, error, success, disabled, and permission states are covered.
- [ ] Existing design tokens and component conventions are followed.
- [ ] No secrets or privileged logic are exposed to the client.
- [ ] UI behavior preserves server authority, tenant isolation, and offline-sync integrity.
- [ ] Final rendered UI has been inspected; if it could not be rendered, mark visual verification BLOCKED or UNVERIFIED.

Report exact files changed, commands executed, results, and any unverified items. A skill checklist is not evidence that a gate passed.
