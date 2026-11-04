---
name: prodx-frontend-engineering
description: Implements production React and TypeScript frontend features for PRODX-POS with robust state, API boundaries, error handling, and maintainable component architecture.
---

# PRODX-POS Frontend Engineering

## Objective
Translate approved UX and product requirements into reliable production React/TypeScript features that integrate with real application services.

## Architecture rules
- Inspect the existing app structure, routing, state management, API clients, query/cache patterns, form validation, and component conventions before coding.
- Keep UI components focused on presentation and interaction; place reusable application behavior in the established hooks/services/modules.
- Do not introduce a second API client, state store, routing system, design system, or validation framework when an established one exists.
- Treat browser state, IndexedDB, cached data, and client calculations as untrusted/optimistic. The server remains authoritative for identity, authorization, price, tax, inventory, numbering, payment, and final transaction state.
- Enforce permission-aware presentation for usability, but never rely on hidden buttons or client route guards as authorization.
- Model async states explicitly: idle, loading, success, empty, validation error, network error, forbidden, offline, retrying, and stale/conflicted where relevant.
- Prevent duplicate submissions and stale-response races; use established idempotency and request lifecycle patterns.
- Clean up subscriptions, timers, event listeners, and abortable requests. Avoid memory leaks and stale closures.
- Keep secrets and privileged credentials out of browser bundles, local storage, logs, and error messages.
- Avoid adding dependencies or changing lockfiles unless explicitly required and authorized.

## Implementation procedure
1. Read `AGENTS.md`, applicable PRODX skills, feature specification, and neighboring implementation/tests.
2. Trace the real user interaction from route/screen through hooks/services to the backend contract.
3. Define component boundaries, state ownership, loading/error/empty behavior, and acceptance tests.
4. Implement the narrowest cohesive change using existing conventions.
5. Add tests for user-visible behavior, state transitions, validation, failure handling, and permission presentation.
6. Run TypeScript checks, lint, frontend tests, production build, theme validation, and relevant architecture/mock-boundary gates.
7. Inspect the rendered behavior when browser tooling is available; record limitations explicitly.

## Production checks
- [ ] Real API/service path is wired; no fake success or placeholder data in production flow.
- [ ] Server-owned business decisions are not recomputed as authoritative in the browser.
- [ ] Loading, empty, validation, network, offline, and permission states are handled.
- [ ] Duplicate clicks, retries, and stale responses cannot corrupt visible state.
- [ ] Accessible labels, keyboard interaction, and focus management are implemented.
- [ ] Tests cover normal and failure paths.
- [ ] No secret, privileged operation, or authorization decision is exposed to the client.

## Evidence contract
Report changed routes/components/services, production API path, tests and commands with PASS/FAIL/BLOCKED/UNVERIFIED status, visual verification coverage, and exact candidate SHA. A successful build alone does not prove a feature is wired or production-ready.
