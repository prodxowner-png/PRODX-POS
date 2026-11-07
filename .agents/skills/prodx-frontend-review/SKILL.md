---
name: prodx-frontend-review
description: Performs evidence-based visual, UX, accessibility, responsive, and production-integration reviews of PRODX-POS frontend changes.
---

# PRODX-POS Frontend Review

## Review posture
Assume a frontend change may look correct in one screenshot while failing in real workflows. Review the diff and relevant callers/components; do not invent findings or report unchanged pre-existing issues as introduced defects.

## Mandatory review areas
1. **Requirement and UX fit:** Verify the changed flow meets acceptance criteria and supports normal, empty, loading, validation, failure, offline, and recovery states.
2. **Visual consistency:** Check use of canonical design tokens, typography, spacing, layout, component variants, theme presets, and interaction states.
3. **Responsive behavior:** Inspect affected supported breakpoints for overflow, clipping, hidden controls, and unusable dense views.
4. **Accessibility:** Check semantic structure, labels, keyboard operation, focus, contrast, status announcements, and non-color cues.
5. **Production wiring:** Trace UI events through hooks/services to the real API path. Detect placeholders, fake success, dead buttons, unreachable components, and mock adapters in production.
6. **Security and authority:** Ensure client-side guards are not treated as authorization and client-calculated price/tax/stock/transaction status is never authoritative.
7. **Reliability:** Check duplicate submission, request races, stale state, cancellation/cleanup, offline retry behavior, and error recovery.
8. **Performance:** Look for unnecessary rerenders, unbounded lists, expensive work on interaction paths, oversized assets, and avoidable bundle/dependency growth.
9. **Tests and gates:** Verify meaningful behavior tests and relevant type/lint/build/theme/architecture gates.

## Severity
- **CRITICAL:** Frontend exposes secrets or privileged capabilities, enables cross-tenant data access, or represents an untrusted client result as an authoritative financial/inventory settlement in a way the server accepts.
- **HIGH:** A critical cashier/payment flow is unusable, duplicate submission can create unsafe effects, production path is fake/unwired, or permission-sensitive actions bypass server enforcement.
- **MEDIUM:** Significant responsive/accessibility failure, missing critical failure state, theme inconsistency affecting usability, or material regression in workflow efficiency.
- **LOW:** Minor visual inconsistency, non-blocking maintainability issue, or small polish opportunity.

## Output contract
Return:
- Verdict: PASS / WARN / FAIL.
- Findings with severity, exact file and line, evidence, user/operational impact, and minimal remediation.
- Screens/viewports/states actually inspected.
- Tests and gates executed with exact outcomes.
- Unverified assumptions and external blockers.

Do not claim visual or accessibility verification without direct inspection evidence. Missing screenshots/browser access is UNVERIFIED, not PASS. Do not merge or deploy as part of review.
