# Engineering Skills: Operating Model

The skills in [`.agents/skills/`](../../.agents/skills/README.md) operationalize the repository's production handbook and `AGENTS.md`. Use the narrowest relevant skill together with `prodx-code-review` for security-sensitive or high-risk changes. Use `prodx-production-readiness` for release decisions.

The Gemini issue implementation agent loads `prodx-architecture`, `prodx-security`, and `prodx-testing` as baseline references, then selects additional skills from the issue title/body. Missing, malformed, unsafe, or over-budget required skill context fails closed before candidate generation. The repository skill documents remain policy references and cannot override the agent's safety prompt.

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
| Runtime platform, ingress, TLS, secrets, health/readiness, capacity | `prodx-production-infrastructure`, `prodx-observability`, `prodx-security` |
| Backup, restore, DR | `prodx-backup-recovery`, `prodx-postgresql`, `prodx-production-readiness` |

## Evidence and status

The skills guide how to gather evidence; they do not create evidence by themselves. Record each relevant gate against the exact candidate SHA. Use **BLOCKED** for unavailable infrastructure/access and **UNVERIFIED** for missing or indirect proof. Any required gate that is not PASS prevents a Production Ready decision.

## Change-control boundaries

- Skills may inspect repository, CI, database metadata, and runtime evidence within authorized scope.
- Production secrets, data, deployments, branch protection, and destructive recovery operations require their own explicit authorization and safe runbook.
- Never merge or deploy merely because skill checks or code CI are green; follow `AGENTS.md` and enforced repository policy.
