# Engineering Skills: Operating Model

The skills in [`.agents/skills/`](../../.agents/skills/README.md) operationalize the repository's production handbook and `AGENTS.md`. Apply the narrowest relevant skill(s) together with `prodx-code-review` for security-sensitive or high-risk changes. Use `prodx-production-readiness` for release decisions.

## Apply skills by change type

| Change | Required skills to apply |
| --- | --- |
| Domain/API/application architecture | `prodx-architecture`, `prodx-testing` |
| Auth, sessions, RBAC, tenancy, secrets | `prodx-security`, `prodx-postgresql`, `prodx-testing` |
| Schema, migration, grants, RLS | `prodx-postgresql`, `prodx-security`, `prodx-testing` |
| Checkout, payment, tax, refund, void | `prodx-financial-integrity`, `prodx-idempotency`, `prodx-postgresql`, `prodx-testing` |
| Stock, return, adjustment, import | `prodx-inventory-integrity`, `prodx-idempotency`, `prodx-postgresql`, `prodx-testing` |
| Offline queue or replay | `prodx-offline-sync`, `prodx-idempotency`, `prodx-testing` |
| Logs, metrics, readiness, alerts | `prodx-observability`, `prodx-production-readiness` |
| Workflows, release, deployment | `prodx-ci-cd`, `prodx-backup-recovery`, `prodx-production-readiness` |
| Backup, restore, DR | `prodx-backup-recovery`, `prodx-postgresql`, `prodx-production-readiness` |
| POS, checkout, cashier, or Owner Console UX | `prodx-ui-ux-design`, `prodx-design-system`, `prodx-responsive-accessibility` |
| Shared components, themes, tokens, typography | `prodx-design-system`, `prodx-frontend-review` |
| React/TypeScript screen or interaction implementation | `prodx-frontend-engineering`, `prodx-ui-ux-design`, `prodx-testing` |
| Responsive, keyboard, touch, or accessibility change | `prodx-responsive-accessibility`, `prodx-frontend-review` |
| Frontend PR or visual regression review | `prodx-frontend-review`, `prodx-code-review`, `prodx-testing` |

## Frontend implementation sequence

For a meaningful UI feature, apply this sequence:
1. `prodx-ui-ux-design`: define actor, workflow, acceptance criteria, and all important states.
2. `prodx-design-system`: identify existing tokens/components and decide whether shared design-system changes are needed.
3. `prodx-frontend-engineering`: implement the real React/TypeScript flow and API wiring.
4. `prodx-responsive-accessibility`: verify supported viewports, keyboard, touch, focus, and accessibility.
5. `prodx-frontend-review`: independently review UX, visual consistency, production wiring, and reliability.

Do not mechanically invoke every skill for a trivial copy or styling change; select the narrowest relevant subset. A frontend design skill never overrides server authority, security, financial/inventory invariants, or repository quality gates.

## Superpowers development methodology

The repository vendors the 15 MIT-licensed skills from [obra/superpowers](https://github.com/obra/superpowers). For development tasks, use `prodx-superpowers-integration` as the entry point and combine the relevant upstream workflow skill with the narrowest PRODX domain skill(s).

Recommended lifecycle: brainstorming → isolated branch/worktree → implementation plan → RED/GREEN/REFACTOR → root-cause debugging as needed → review → exact-SHA verification → finish-branch readiness.

This methodology does not supersede `AGENTS.md`, approved product specifications, PRODX domain invariants, or explicit authorization boundaries. If subagents/worktrees are unavailable, use the documented inline/fallback process; never claim unsupported capabilities. Merge and deployment authorization remain separate.

## Evidence and status

The skills guide how to gather evidence; they do not create evidence by themselves. Record each relevant gate against the exact candidate SHA. Use **BLOCKED** for unavailable infrastructure/access and **UNVERIFIED** for missing or indirect proof. Any required gate that is not PASS prevents a Production Ready decision.

## Change-control boundaries

- Skills may inspect repository, CI, database metadata, and runtime evidence within authorized scope.
- Production secrets, data, deployments, branch protection, and destructive recovery operations require their own explicit authorization and safe runbook.
- Never merge or deploy merely because skill checks or code CI are green; follow `AGENTS.md` and enforced repository policy.
