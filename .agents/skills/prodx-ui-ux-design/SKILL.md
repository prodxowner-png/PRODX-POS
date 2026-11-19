---
name: prodx-ui-ux-design
description: Designs and improves production POS user journeys, information architecture, interaction patterns, and high-fidelity React UI for PRODX-POS.
---

# PRODX-POS UI/UX Design

## Objective
Design cashier-first, operationally clear interfaces for retail POS workflows. Optimize correctness, speed, learnability, and recovery under real store conditions—not visual novelty alone.

## Mandatory context
1. Read `AGENTS.md`, `docs/PRODUCTION-HANDBOOK.md`, `docs/engineering-skills/README.md`, and the relevant existing screens/components before proposing changes.
2. Identify the primary actor, task, frequency, time pressure, device, connectivity assumptions, permissions, and failure/recovery paths.
3. Reuse established routes, terminology, components, tokens, and interaction patterns unless there is evidence they are defective.
4. For POS flows, prioritize scan/search → cart review → tender/payment → confirmation/receipt, with explicit handling for unavailable products, stock conflicts, payment failure, duplicate submission, and offline state.

## Design principles
- Make the next safe action obvious; distinguish primary, secondary, destructive, and irreversible actions.
- Keep high-frequency cashier actions reachable and minimize unnecessary navigation, typing, and modal stacking.
- Show clear item identity, quantity, unit price, discounts, tax breakdown, and totals. Treat client totals as previews only; never make the UI authoritative for money, tax, stock, or final transaction state.
- Provide clear loading, empty, success, validation, error, offline, retrying, and permission-denied states.
- Preserve user input safely across recoverable failures; confirm destructive or irreversible actions.
- Use progressive disclosure for infrequent advanced settings without hiding critical transaction information.
- Prefer plain language, consistent labels, predictable keyboard behavior, and touch-friendly targets.
- Design responsive layouts for the actual workflow and viewport; do not merely shrink a desktop screen.

## Required workflow
1. Inspect current implementation, route map, design tokens, component library, and relevant tests.
2. Write a concise task flow and acceptance criteria before implementation.
3. Map normal, validation, empty, loading, failure, offline, and recovery states.
4. Sketch the hierarchy/layout in text or existing design tooling when the change is structurally significant.
5. Implement using existing components and tokens; avoid introducing dependencies without explicit authorization.
6. Verify the actual screen at supported breakpoints and test keyboard/touch interactions.
7. Run applicable frontend checks and inspect the final diff.

## POS-specific acceptance checks
- [ ] Product scan/search and cart editing remain fast and unambiguous.
- [ ] Quantity, price, discount, tax, and total are legible and clearly labeled.
- [ ] Payment submission prevents accidental duplicate actions and communicates pending/failure states.
- [ ] Offline status and queued/syncing/failed states are explicit without implying server settlement.
- [ ] Role/permission restrictions are reflected in UI and still enforced by the server.
- [ ] Destructive actions have appropriate confirmation and recovery guidance.
- [ ] No sensitive data, credentials, or unnecessary PII appears in UI/logging.

## Evidence contract
Report the exact screens/routes and files inspected, interaction states verified, viewport/device coverage, test commands, and candidate commit SHA. Mark unavailable visual/browser testing as BLOCKED or UNVERIFIED; never claim a visual check that was not performed.
