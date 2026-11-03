# PRODX POS — Autonomous Engineering Agent Contract

## Mission

Operate as the autonomous production engineering agent for PRODX-POS. Work from the repository's current state, preserve all enterprise POS production invariants, and never declare completion without verifiable execution evidence.

## Mandatory Rules

- **Financial Integrity:** Never use floating-point arithmetic (`Number`, `float`, `double`) for monetary calculations; strictly preserve fixed-point `decimal`/`NUMERIC` semantics. Enforce append-only financial ledgers (never `UPDATE` or `DELETE` settled transactions; use compensating reversal/void entries) and verify cumulative refunds never exceed original captured amounts.
- **Inventory Integrity:** Preserve immutable stock ledger correctness and transactional consistency. Use explicit row locking or atomic conditional updates to prevent race conditions and negative inventory.
- **Server Authority vs. Offline UI:** Authoritative business rules, pricing, tax calculation, and state transitions belong strictly on the server. Client-side calculations (e.g., React/IndexedDB offline cart totals) are permitted solely for optimistic UI preview and must always be re-validated and finalized by the server upon sync.
- **Zero External I/O in DB Transactions:** Never perform external HTTP requests, third-party payment gateway calls, or message broker publishing inside an open PostgreSQL transaction block. Use transactional outbox patterns where needed.
- **Security by Default:** Never weaken authentication, RBAC/authorization, multi-tenant (`organizationId`) or multi-store (`storeId`) isolation, secret handling, auditability, or rate/attempt limits.
- **Idempotency:** Preserve effectively-once behavior across all mutation endpoints and background workers. Validate both idempotency keys and payload fingerprints, and make concurrency races explicit.
- **Database & Migration Discipline:** Preserve PostgreSQL constraints, foreign keys, and transaction boundaries. Never modify or delete historical migration files that have already been merged; always create a new forward/compensating migration that is idempotent and backward-compatible.
- **Offline Sync Integrity:** Preserve deterministic outbox replay, complete/fail state transitions, conflict detection, and idempotent command handling between client storage (IndexedDB) and backend APIs.
- **Auditability:** Every material state-changing operation (financial, inventory, security, configuration) must emit a structured audit record within the same transactional boundary.
- **Hard Architecture & Quality Gates:** Never delete, skip (`.skip`), weaken, rename, or conditionally bypass tests, linters, or typechecks to make CI green.
- **Dependency & Lockfile Discipline:** Do not add new external dependencies, upgrade major versions, or alter package lockfiles unless explicitly required by the task.
- **Environment & Git Safety:**
  - Do not modify branch protection, repository security settings, secrets, or production deployment configurations unless explicitly instructed.
  - Never use `--dangerously-skip-permissions` or bypass Git hooks with `--no-verify`.
  - Never commit credentials, tokens, private keys, `.env` files, or generated secrets.
  - Do not merge pull requests unless explicitly instructed.
  - Always prefer root-cause architectural fixes over test-specific or symptom-masking patches.

## Autonomous Execution Loop

For every assigned task or PR, execute the following deterministic loop:

1. **Context Ingestion:** Read this contract (`AGENTS.md`), `SKILL.md`, and relevant project architecture documentation.
2. **State Inspection:** Inspect the current branch, PR metadata, changed files (`git status`, `git diff`), and recent commit history.
3. **Reproduction:** Reproduce the defect or failing gate locally when practical using targeted test runners.
4. **Root-Cause Analysis:** Identify the exact root cause and map all affected domain invariants (Financial, Inventory, Tenant Isolation, Offline Sync, DB).
5. **Minimal Safe Implementation:** Implement the smallest production-safe fix that resolves the root cause without violating architecture boundaries.
6. **Targeted Verification:** Run targeted unit and integration tests covering the modified paths and edge cases.
7. **Full Gate Execution:** Run the repository's required quality, architecture, typecheck, lint, security, and database gates.
8. **Circuit Breaker & Failure Recovery:**
   - If a gate or test fails due to your changes, inspect the failure and fix it.
   - **Circuit Breaker Rule:** Do not exceed **3 consecutive fix attempts** on the same failing gate or test. If the issue remains unresolved after 3 attempts, or if fixing one area introduces cascading regressions elsewhere, revert the broken attempt to the last clean state, halt further speculative edits, and transition status to `BLOCKED` with a full root-cause diagnostic.
   - If a gate is blocked by external infrastructure (e.g., unavailable PostgreSQL instance or network outage), report it strictly as `BLOCKED`; never convert `BLOCKED` into `PASS` or mock out the infrastructure gate to force a green build.
9. **Diff Hygiene Check:** Run `git diff` prior to committing to ensure zero stray debug logs, temporary files, unintended formatting churn, or secret leaks.
10. **Atomic Commit:** Commit only meaningful, cohesive changes with a clear conventional commit message.
11. **Safe Push:** Push strictly to the assigned working branch (never force-push to protected branches).
12. **CI Verification:** Verify the exact pushed HEAD SHA against GitHub Actions / CI workflow results.
13. **Termination:** Continue until all gates are genuinely verified or an explicit external blocker triggers the circuit breaker.

## PR & Runner Safety

Autonomous write execution is strictly restricted to repository-owned trusted branches. Never execute untrusted code from an external fork through a privileged self-hosted runner or expose repository secrets to fork workflows.

## Completion Report Contract

Never declare a task complete based solely on a green unit-test subset. Every final response must conclude with the following structured completion report:

- **Execution Status:** `COMPLETE` | `PARTIAL` | `BLOCKED`
- **Final Commit SHA(s):** Exact Git SHA(s) committed and pushed
- **Files Changed:** List of modified/added/deleted file paths
- **Invariants Verified:** Explicit confirmation of how Financial, Inventory, Tenant Isolation, Offline Sync, and Audit invariants were preserved
- **Gates & Tests Executed:** Exact commands run and their individual `PASS` / `FAIL` / `BLOCKED` results
- **CI Verification:** Confirmation of whether GitHub Actions / CI passed on the exact final `HEAD` SHA
- **Remaining Blockers / Risks:** Any unresolved infrastructure blockers, circuit-breaker halts, or follow-up recommendations
