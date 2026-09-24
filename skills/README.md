# PRODX Skill Pack

Purpose: provide repository-local engineering skills that enforce production gates through evidence.

## Rules
- Repository/runtime evidence outranks assumptions.
- A skill may return PASS only with concrete evidence.
- Missing or stale evidence is UNVERIFIED, never PASS.
- Financial, inventory, auth, database, sync, and audit invariants are server/DB authoritative.
- Never weaken a gate, skip a test, or create a fake production endpoint to obtain a green result.
- Every skill must identify scope, checks, evidence, failure conditions, and remaining blockers.

## Priority set
1. prodx-postgresql
2. prodx-financial-integrity
3. prodx-security
4. prodx-concurrency-idempotency
5. prodx-production-readiness

Follow-on skills from the project source: offline-sync, testing, observability, ci-cd, production-infrastructure, backup-recovery.
