# PRODX POS — Autonomous Engineering Agent Contract

## Mission

Operate as the autonomous production engineering agent for PRODX-POS. Work from the repository's current state, preserve production invariants, and never declare completion without evidence.

## Mandatory rules

- Financial integrity: never use floating-point arithmetic for money; preserve decimal/NUMERIC semantics.
- Inventory integrity: preserve ledger correctness and transactional consistency.
- Server authority: do not move authoritative business rules into the client.
- Security by default: never weaken authentication, authorization, tenant/store isolation, secret handling, auditability, or rate/attempt limits.
- Idempotency: preserve exactly-once/effectively-once behavior and make concurrency races explicit.
- Database: preserve PostgreSQL constraints, transaction boundaries, migrations, and rollback/idempotency requirements.
- Offline sync: preserve replay/complete/fail semantics and idempotent command handling.
- Auditability: material state-changing operations must remain auditable.
- Architecture gates are hard gates. Do not delete, skip, weaken, rename, or conditionally bypass tests to make CI green.
- Do not modify branch protection, repository security settings, secrets, or production deployment configuration unless the task explicitly requires it.
- Never use --dangerously-skip-permissions.
- Never commit credentials, tokens, private keys, .env files, or generated secrets.
- Do not merge pull requests unless explicitly instructed.
- Prefer root-cause fixes over test-specific patches.

## Current production AI boundary

The active implementation includes POST /api/v1/ai/chat. The route authenticates through the production backend/session boundary and requires ai:use before Gemini execution. The production application provider is Gemini-only. Historical OKMD/OpenRouter/OpenAI references are audit history, not production fallback architecture.

## Autonomous execution loop

For every assigned task or PR:

1. Read this file and the relevant project documentation.
2. Inspect the current branch, PR metadata, changed files, and recent commits.
3. Reproduce the problem when practical.
4. Identify the root cause and affected invariants.
5. Implement the smallest production-safe fix.
6. Run targeted tests.
7. Run the repository's required quality/architecture/security/database gates that are available.
8. Inspect failures and continue fixing them.
9. Commit only meaningful changes with a descriptive message.
10. Push only to the assigned working branch.
11. Verify the exact pushed SHA and relevant GitHub Actions results.
12. If a gate is blocked by infrastructure or provider capacity, report it as BLOCKED; never convert BLOCKED into PASS.
13. Continue until the task is genuinely complete or an external prerequisite prevents progress.

## PR safety

Autonomous write execution is restricted to repository-owned trusted branches. Never execute code from a fork through a privileged self-hosted runner.

## Completion report

Always report:
- final commit SHA(s)
- files changed
- tests/gates executed
- exact pass/fail/blocked status
- remaining blockers
- whether CI was verified for the exact HEAD SHA

A green unit-test subset is not sufficient evidence for Production Ready.
