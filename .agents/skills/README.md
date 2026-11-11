# PRODX-POS Engineering Skill Pack

These agent skills turn PRODX-POS production principles into repeatable engineering and design procedures. They are guardrails and checklists, not evidence that the system passes a gate.

## Core production engineering
- [prodx-architecture](prodx-architecture/SKILL.md) — dependency boundaries and production wiring.
- [prodx-security](prodx-security/SKILL.md) — authentication, authorization, tenancy, secrets, and audit controls.
- [prodx-postgresql](prodx-postgresql/SKILL.md) — schema, migrations, constraints, RLS, transactions, and concurrency.
- [prodx-financial-integrity](prodx-financial-integrity/SKILL.md) — exact money, tax/rounding, payment, refund, void, and reconciliation.
- [prodx-inventory-integrity](prodx-inventory-integrity/SKILL.md) — stock ledger, concurrent mutations, reversals, and reconciliation.
- [prodx-idempotency](prodx-idempotency/SKILL.md) — durable duplicate suppression and exactly-once effect.
- [prodx-distributed-systems](prodx-distributed-systems/SKILL.md) — consistency, outbox/inbox, delivery semantics, ordering, failure recovery, and cross-service workflows.
- [prodx-offline-sync](prodx-offline-sync/SKILL.md) — durable outbox, replay, retry, ordering, and conflict recovery.
- [prodx-testing](prodx-testing/SKILL.md) — risk-based tests and exact-head evidence.
- [prodx-observability](prodx-observability/SKILL.md) — safe diagnostics, correlation, metrics, alerts, and audit boundaries.
- [prodx-ci-cd](prodx-ci-cd/SKILL.md) — CI gates, branch protection, artifact provenance, release, and rollback.
- [prodx-backup-recovery](prodx-backup-recovery/SKILL.md) — restore drills, integrity checks, RPO/RTO, and DR.
- [prodx-production-readiness](prodx-production-readiness/SKILL.md) — aggregate hard-gate decision and status reporting.
- [prodx-code-review](prodx-code-review/SKILL.md) — adversarial pull-request review contract.
- [prodx-ai-tooling](prodx-ai-tooling/SKILL.md) — safe AI tool-calling, permission boundaries, prompt injection, idempotency, and auditable execution.

## Frontend design and experience
- [prodx-ui-ux-design](prodx-ui-ux-design/SKILL.md) — cashier-first UX, user journeys, screen hierarchy, and interaction states.
- [prodx-design-system](prodx-design-system/SKILL.md) — visual language, semantic tokens, themes, typography, spacing, and reusable components.
- [prodx-frontend-engineering](prodx-frontend-engineering/SKILL.md) — production React/TypeScript implementation and real API wiring.
- [prodx-responsive-accessibility](prodx-responsive-accessibility/SKILL.md) — responsive behavior, keyboard/touch usability, and accessibility.
- [prodx-frontend-review](prodx-frontend-review/SKILL.md) — visual, UX, accessibility, responsive, and production-integration review.

## Upstream Superpowers workflow (MIT)

PRODX vendors the upstream `obra/superpowers` skill set under the original skill names:
- [brainstorming](brainstorming/SKILL.md)
- [diagnosing-superpowers](diagnosing-superpowers/SKILL.md)
- [dispatching-parallel-agents](dispatching-parallel-agents/SKILL.md)
- [executing-plans](executing-plans/SKILL.md)
- [finishing-a-development-branch](finishing-a-development-branch/SKILL.md)
- [receiving-code-review](receiving-code-review/SKILL.md)
- [requesting-code-review](requesting-code-review/SKILL.md)
- [subagent-driven-development](subagent-driven-development/SKILL.md)
- [systematic-debugging](systematic-debugging/SKILL.md)
- [test-driven-development](test-driven-development/SKILL.md)
- [using-git-worktrees](using-git-worktrees/SKILL.md)
- [using-superpowers](using-superpowers/SKILL.md)
- [verification-before-completion](verification-before-completion/SKILL.md)
- [writing-plans](writing-plans/SKILL.md)
- [writing-skills](writing-skills/SKILL.md)

Use [prodx-superpowers-integration](prodx-superpowers-integration/SKILL.md) as the PRODX-specific entry point. It defines precedence, mapping, and safe use of this upstream workflow. Preserve upstream attribution and the [MIT license](THIRD-PARTY-LICENSES/obra-superpowers-LICENSE).

## Required evidence vocabulary
Every skill must distinguish:
- **PASS** — current direct evidence proves the criterion.
- **FAIL** — direct evidence demonstrates a violated criterion.
- **BLOCKED** — the required environment, access, or prerequisite is unavailable.
- **UNVERIFIED** — evidence is absent, stale, indirect, or insufficient.
- **NOT APPLICABLE** — a documented reason shows the criterion does not apply.

Never convert missing evidence into PASS. Include exact commit SHA, source/test paths, command or CI run, and runtime evidence when relevant. A skill file, passing unit test, or successful build does not make PRODX-POS Production Ready.
