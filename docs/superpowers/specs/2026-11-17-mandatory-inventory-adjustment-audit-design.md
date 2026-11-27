# Inventory Ledger Audit and Idempotency — Design

## Intent
Ensure every non-POS inventory ledger insert creates an immutable audit event in the same PostgreSQL transaction, even when the inventory-admin role writes directly instead of using the provided psql scripts.

## Goals
- Require an explicit non-null ledger reference ID; remove the random database default so retries cannot silently become new movements.
- Preserve one ledger row per tenant/reference/product/reason; a same-reason replay cannot double stock, while a distinct reason may represent a separate void/return movement against the same source transaction.
- Reject non-POS ledger inserts without a transaction-local actor UUID and 64-character SHA-256 payload hash.
- Create the audit row inside the existing SECURITY DEFINER inventory trigger, atomically with the balance update and ledger insert.
- Keep POS_SALE auditing in the existing sale CTE so it is not duplicated.
- Update opening-stock and adjustment scripts to supply audit context and rely on the database trigger.
- Add integration regressions proving the actual `prodx_inventory_admin` role cannot write without audit context and that a valid direct write produces exactly one audit row; missing/malformed audit context and missing reference IDs leave no writes; same-reason duplicate replay is rejected without partial effects; and rollback removes ledger, balance, and audit together.

## Non-goals
- Authenticate the human represented by actor_id inside PostgreSQL; the trusted operator/service remains responsible for that identity.
- Backfill actor identities for historical ledger rows.
- Change store creation or terminal enrollment audit workflows.
- Change RLS, grants, append-only enforcement, or inventory policy semantics.

## Approaches
1. **Trigger-enforced transaction context (recommended):** require app.inventory_actor_id and app.inventory_payload_hash for non-sale ledger inserts, then append the audit row from the existing inventory trigger. This closes the direct-INSERT bypass while preserving the existing role and scripts.
2. **Stored procedure only:** revoke direct ledger INSERT and expose a SECURITY DEFINER procedure. Strong boundary, but changes role contracts and script invocation more broadly.
3. **Script-only audit:** keep manual audit inserts. Rejected because the granted role can bypass the scripts.

## Constraints
- Keep POS sale idempotency on its existing sale/reference unique constraints.
- Preserve the existing audit action names: OPENING_BALANCE_RECORDED for opening stock and INVENTORY_ADJUSTMENT_RECORDED for other inventory movements.
- PostgreSQL remains authoritative.
- Audit rows remain append-only.
- Inventory balance updates and ledger inserts remain atomic.
- POS_SALE audit remains exactly once in the sale CTE.
- No live database migration or deployment is part of this change.
