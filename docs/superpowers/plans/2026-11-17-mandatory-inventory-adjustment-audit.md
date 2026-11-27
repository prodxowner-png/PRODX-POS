# Inventory Ledger Audit and Idempotency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent duplicate stock effects and unaudited non-POS inventory ledger writes at the PostgreSQL boundary.

**Architecture:** Require explicit ledger `reference_id` values, preserve the reason-sensitive `(tenant_id, reference_id, product_id, reason)` ledger idempotency key, and extend the existing Store-scoped `apply_inventory_ledger_delta()` trigger to require transaction-local actor/hash context and append audit in the same transaction. Keep POS sale auditing in the sale CTE and remove duplicate manual audit inserts from the two operator scripts.

**Tech Stack:** PostgreSQL 16+, TypeScript, node-postgres, Vitest integration harness.

**Spec:** `docs/superpowers/specs/2026-11-17-mandatory-inventory-adjustment-audit-design.md`

## Global Constraints
- PostgreSQL remains the source of truth.
- Do not weaken RLS, grants, append-only audit, or authorization.
- Preserve `POS_SALE` audit behavior and Store-scoped inventory semantics.
- No Production/Preview DB writes or deployments.

## Review Focus
- Missing actor context: reject before any inventory or audit effect.
- Missing reference ID: reject before any inventory or audit effect.
- Same-reason duplicate reference replay: reject without a second balance or audit effect; a distinct reason remains valid for void/return flows.
- Missing/malformed payload hash: reject before any inventory or audit effect.
- Valid context: exactly one audit event per non-sale ledger insert.
- Transaction rollback: audit, ledger, and balance changes all roll back together.
- POS sale: no duplicate audit event from the new non-sale path.

---

### Task 1: Enforce and test atomic audit for non-sale inventory ledger writes

**Files:**
- Modify: `prodx-pos-edge-sync/migrations/002_store_scoped_inventory.sql`
- Modify: `prodx-pos-edge-sync/scripts/seed-opening-inventory.sql`
- Modify: `prodx-pos-edge-sync/scripts/record-inventory-adjustment.sql`
- Modify: `prodx-pos-edge-sync/scripts/inventory-integrity-integration.ts`
- Modify: `prodx-pos-edge-sync/scripts/postgres-price-integration.ts`
- Modify: `prodx-pos-edge-sync/scripts/chaos-load-test.ts`
- Modify: `prodx-pos-edge-sync/README.md`

**Interfaces:**
- Required ledger input: explicit `reference_id` UUID; no database-generated fallback.
- Ledger idempotency key: `(tenant_id, reference_id, product_id, reason)`; a distinct reason may legitimately reference the same source transaction for a void or return.
- Transaction-local inputs: `app.inventory_actor_id` (UUID) and `app.inventory_payload_hash` (64 lowercase hex characters).
- Existing trigger: `apply_inventory_ledger_delta()`; no new application API.
- Non-sale audit entity: `INVENTORY_ADJUSTMENT`, entity ID = ledger `reference_id`.

- [x] **Step 1: Write failing integration regressions** for missing/malformed audit context, direct `prodx_inventory_admin` writes, omitted reference IDs, same-reason duplicate reference replay, and atomic rollback; assert no partial ledger, balance, or audit effects.
- [x] **Step 2: Run the regressions against the pre-fix schema and observe the expected failures** for missing audit context, malformed hashes, and omitted reference IDs; same-reason duplicate replay remains blocked by the existing unique key.
- [x] **Step 3: Extend the migration and trigger** to require explicit reference IDs, preserve reason-sensitive idempotency, require actor/hash context, and append the compatible audit event atomically after the balance update.
- [x] **Step 4: Update operator scripts and integration fixtures** to provide explicit references and transaction-local actor/hash context; remove manual audit INSERTs.
- [x] **Step 5: Assert valid context creates exactly one audit event** and that POS sale audit remains exactly once.
- [x] **Step 6: Run `npm run types`, Edge typecheck/tests, migration preflight, PostgreSQL price integration, Store inventory integration, the 300-terminal/15,000-sale/3,000-replay chaos test, `npm audit`, and `git diff --check` on a fresh local PostgreSQL 16 database.**
- [ ] **Step 7: Review diff and commit** only the scoped files.
- [ ] **Step 8: Push the PR branch and verify exact-head GitHub Actions.**
