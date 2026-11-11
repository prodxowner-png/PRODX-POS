# CF-01 — PRODX Checkout Adapter Contract

**Status:** Design contract / implementation blocked  
**Branch:** `feat/cf01-checkout-adapter-contract`  
**Scope:** Define the only acceptable integration boundary between Cloudflare Edge Sync and the existing PRODX POS financial services.  
**Safety:** Documentation-only. No database migration, Cloudflare resource, secret, RLS policy, grant, production setting, or deployment is changed by this document.

## 1. Decision

Cloudflare Edge Sync must not write to a parallel financial schema. The authoritative financial write path remains the existing PRODX POS checkout domain service:

- `server/transactions/checkout-service.ts`
- `server/http/checkout-route.ts`
- `server/http/sync-route.ts`
- `server/db/transaction.ts`

The Edge Worker may validate device identity, signed offline evidence, sequence/HLC metadata and queue durability. It must not become a second financial authority.

The existing Edge Sync PostgreSQL CTE is not an integration adapter. It writes to a separate model (`sales`, `sale_lines`, `inventory_ledger`, `audit_logs`, `pos_idempotency`, `terminal_sync_state`) and assumes `app.current_tenant_id`. The core PRODX checkout path uses `prodx_orders`, `prodx_order_items`, `prodx_inventory_ledger`, `prodx_audit_log`, payments/cash movements and transaction-local `app.organization_id`, `app.store_id`, `app.user_id` context.

**Do not apply** `prodx-pos-edge-sync/migrations/001_pos_ledger.sql` to the PRODX-POS database. It provisions a second financial ledger and does not retrofit the established PRODX schema.

## 2. Verified current contracts

### 2.1 Existing authenticated API

`server/http/sync-route.ts` already exposes `POST /api/v1/sync/commands` for an `order_transaction` outbox item. It:

1. Requires the normal authenticated request context and `pos.sell` permission.
2. Requires the outbox idempotency key to equal the payload checkout idempotency key.
3. Uses the authenticated principal's store and user IDs rather than trusting those fields from the client.
4. Calls `createCheckoutService(db).checkout(...)`.
5. Returns the server-confirmed order and the cached/idempotency result.

The current integration test `server/http/sync-route.test.ts` exercises first commit and exact replay against PostgreSQL when `DATABASE_URL` is configured.

### 2.2 Financial authority

`createCheckoutService()` executes one database transaction covering active shift validation, product locking, server-side price/tax calculation, total comparison, order insertion, stock decrement, order-item insertion, inventory-ledger append, payment insertion, cash movement append and audit-log append.

The DB transaction executor sets transaction-local `app.organization_id`, `app.store_id`, and `app.user_id` from the server-verified request principal. The adapter must use this executor and must not set caller-controlled tenant context.

### 2.3 Offline contract mismatch

The Edge Sync contract currently represents `tenant_id` and `terminal_id`, signed price proofs, sequence/HLC and a minor-unit sale payload. The core checkout contract represents `storeId`, `registerId`, `cashierId`, domain cart items/totals and payments.

These contracts are not interchangeable by a field rename. The conversion requires a trusted identity mapping and a server-authoritative price policy.

### 2.4 Additional verified implementation gaps (2026-11-11)

The following are confirmed from the current `main` source and the owner-selected Preview database:

- **Legacy schema is absent from Preview.** The Worker directly queries/writes `terminal_devices`, `terminal_sync_state`, `pos_idempotency`, `sales`, `sale_lines`, `inventory_ledger`, `audit_logs`, and `tenant_catalog_versions`. None of these tables exist in `PRODX-POS-PREVIEW`. The Preview database instead contains the established `prodx_orders`, `prodx_order_items`, `prodx_payments`, `prodx_cash_movements`, `prodx_inventory_ledger`, and `prodx_audit_log` tables. Do not apply the legacy Edge migration to make the current Worker run.
- **Existing checkout idempotency is not payload-bound.** `createCheckoutService()` looks up `prodx_orders` by `store_id + idempotency_key` and returns the existing order without comparing a canonical payload hash, sale ID, terminal ID, or sequence. The current `prodx_orders` schema has no `payload_hash`, `sale_id`, or `terminal_seq_no` columns. B3/B4 therefore require a durable, transactionally enforced identity/hash mapping and a same-key/different-payload rejection before the adapter can safely reuse the service.
- **Register identity is not currently server-derived by the sync route.** `sync-route.ts` overwrites `storeId` and `cashierId` from the authenticated principal but retains `registerId` from the payload. The adapter must resolve the terminal's authorized register from backend-owned device/session mappings and override or strictly validate the client field.
- **Catalog proof custody is Worker-local today.** `catalog-crypto.ts` signs and verifies HMAC-SHA256 catalog/price proofs using `CATALOG_SIGNING_KEY`, loaded from a Worker secret. The backend CheckoutService does not currently verify these proofs. The backend must independently verify offline price evidence. Prefer an asymmetric signing design with the signing private key held only by the trusted backend and a public verification key distributed to verifiers; do not ship or copy the HMAC signing secret to POS clients or duplicate it across environments without a documented key-custody decision.
- **Preview DB guardrails were inspected read-only.** `prodx_app` is a login role with `NOBYPASSRLS`, is not table owner, and has INSERT but not UPDATE/DELETE on audit, inventory-ledger, and cash-movement tables. The 39 PRODX tables have RLS enabled and are owned by `postgres`; no grants or policies were changed.

These are implementation gaps, not approvals to modify the database. They must be closed by reviewed code/schema changes and exact-head tests before staging deployment.

## 3. Required adapter boundary

The eventual production flow must be:

```text
POS local outbox
  -> authenticated Edge ingress
  -> device identity + signed payload verification
  -> durable Edge receipt / queue (accepted != committed)
  -> trusted PRODX backend integration endpoint
  -> server-verified principal + tenant/store/register/cashier mapping
  -> existing CheckoutService transaction
  -> PRODX order + payment + cash + inventory ledger + audit
  -> authoritative committed receipt
  -> Edge receipt marked committed
  -> POS local outbox acknowledged
```

The integration endpoint must call the same checkout service used by the existing API. It must not connect to PostgreSQL using a new Worker role to write financial rows directly.

The backend must derive `organizationId`, `storeId`, `registerId`, and `cashierId` from trusted, server-verified identity/device/session mappings. A Worker-supplied `tenant_id`, `terminal_id`, `role`, `storeId`, or `cashierId` is untrusted input until independently verified by the backend.

## 4. Blocking decisions and correctness gaps

### B1 — Trusted identity bridge (High / Blocking)

Current Edge `auth.ts` expects top-level Access JWT `tenant_id` and `terminal_id`; the operator path expects top-level `role`. The documented Service Token claims do not provide those application claims by default. The owner has approved the Free-plan device-auth direction for CF-01 Staging protocol/design only: per-device asymmetric signatures plus Access Service Token as a separate ingress control. Production remains on its existing mTLS contract. Runtime implementation remains blocked by the protocol, threat-model, test-vector, and independent-review gates.

**Entitlement revalidation (2026-11-11):** Cloudflare's current documentation states that Access mTLS is available on Enterprise and pay-as-you-go Zero Trust plans and is **not included in the Free plan**. The connected account currently has zero Access certificate authorities and zero Cloudflare zones. See [Cloudflare Access Mutual TLS availability](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/mutual-tls-authentication/). Zone-level mTLS is a separate product path and cannot be assumed available without a zone and plan verification.

For CF-01 Staging only, use the owner-approved direction: per-device asymmetric signing with a non-exportable terminal private key where supported, backend-held public-key enrollment/revocation, and Cloudflare Access Service Token as an independent ingress control. This is **not equivalent to transport-layer mTLS**. Production mTLS remains unchanged. Do not remove the Production certificate check, trust caller-supplied fingerprints, or treat the Staging approval as permission to deploy or change Runtime authentication before all implementation gates pass.

Required before code:
- Prove tenant, terminal, store, register, cashier and active shift mapping server-side.
- Keep the existing mTLS/certificate verification contract unchanged in Production; Staging uses only the separately owner-approved device-signature design and must not be represented as equivalent to mTLS.
- Do not trust request-body IDs or caller-supplied certificate fingerprints.
- Test cross-tenant, cross-store, revoked-device, unknown-terminal and cashier/register mismatch rejection.

### B2 — Signed offline price semantics (High / Blocking)

The current checkout service recalculates using the product's current database price and tax rate. The Edge package supports signed historical price proofs so an offline sale can use a price that was valid when the catalog was downloaded.

A naive mapping into `CheckoutRequest` either rejects a legitimate signed historical price or risks trusting a client price. Before adapter implementation, the domain must explicitly support a verified, server-authenticated price snapshot/proof as an input to the checkout transaction, and revalidate it at the financial authority. The implementation must define:
- Exact integer/minor-unit and VAT rounding rules shared by terminal, Edge and backend.
- Proof expiry and offline-duration policy.
- Product deactivation and price-change behavior.
- Discount and order-discount authority.
- Audit fields for catalog version, proof key/version and verification result.

No floating-point money arithmetic and no trust in unsigned client totals.

### B3 — Terminal sequence and HLC authority (High / Blocking)

Edge DO sequence state and the backend's checkout idempotency are separate. The authoritative backend needs a durable unique mapping for tenant/store/register/terminal sequence and must atomically reject gaps/reuse/regressions with the financial commit, or a rigorously specified replay coordinator must guarantee the same property.

Do not treat DO-local sequence checkpoints as the permanent financial authority. Do not acknowledge the POS outbox until the backend returns a committed order reference.

### B4 — Idempotency identity (High / Blocking)

The current checkout service uses store-scoped `idempotencyKey`. Edge Sync uses tenant + key and also carries `sale_id`, payload hash and terminal sequence. A versioned mapping must define collision scope and bind the key to terminal, sale ID and canonical payload hash. Same key/same immutable payload returns the original committed result; same key/different payload fails permanently. Concurrent duplicate tests are required.

### B5 — Payments and offline tender (High / Blocking)

Edge's `SaleLine` model currently has no payment/tender breakdown. Core checkout requires payment entries and enforces payment total equals the server-authoritative grand total. The adapter contract must carry and validate tender method, amount, currency, cash tender/change, terminal reference and any authorization evidence. It must not invent a payment or mark a payment settled based only on an offline client assertion. Card/QR offline acceptance requires an explicit provider settlement/reconciliation design.

### B6 — Inventory concurrency (High / Blocking)

The financial transaction must preserve product row locking, atomic stock decrement, non-negative stock enforcement, append-only inventory ledger and tenant/store constraints. Edge must not write inventory balances or ledger tables directly.

### B7 — RLS and grants (High / Blocking)

Use the existing backend transaction executor and normal authenticated service boundary. No `BYPASSRLS`, no superuser/owner DB role, no direct Worker financial DML, no grant expansion, and no weakening of append-only protections. The runtime role must retain least privilege and the current audit/cash/inventory restrictions.

### B8 — Request and queue semantics (Medium / Blocking)

Edge must enforce the body limit while streaming, not only after buffering the entire body. Queue delivery is at-least-once. Queue acceptance is not financial commit. The backend committed receipt is the only event that permits Edge receipt finalization and local outbox acknowledgement.

## 5. Adapter API contract (proposed, not implemented)

The preferred adapter is a private backend-to-backend integration endpoint, not a public financial DB writer. Its wire schema must be versioned and contain:

- `protocol_version`
- `tenant_id`, `terminal_id`, `sale_id`, `terminal_seq_no`
- `idempotency_key`, `payload_hash`, canonical sale payload
- Signed price proof references and device signature/key ID when the approved device-auth design requires it
- Tender/payment evidence
- Original client timestamp and Edge receive timestamp
- A trusted, verifiable Edge service identity (audience, issuer and key rotation contract)

The backend must:
1. Authenticate the Edge service independently.
2. Resolve terminal -> organization/store/register and authorized cashier/membership from backend-owned records.
3. Verify the device signature and canonical hash against a versioned protocol.
4. Verify signed price evidence and calculate exact financial totals server-side.
5. Enforce idempotency, terminal sequence/HLC, active shift, payment and inventory invariants.
6. Call the existing checkout domain service (or a carefully extracted shared domain command) inside the existing transaction executor.
7. Append the immutable audit event in that same transaction.
8. Return a stable committed order ID, server commit timestamp and replay indicator.
9. Allow Edge to mark the durable receipt committed only after that response is authenticated and validated.

No endpoint may accept a caller-provided `organization_id/store_id/user_id` as authority.

## 6. Required contract tests

Before enabling any integration:
- Missing/invalid Edge service assertion -> 401; wrong audience/issuer/expired assertion -> 401.
- Unknown, disabled or revoked terminal -> 403.
- Terminal mapped to a different tenant/store/register -> 403.
- Cashier not an active store member -> 403.
- Register mismatch or no active shift -> conflict; no financial writes.
- Invalid, expired, tampered or wrong-product signed price proof -> permanent rejection; no financial writes.
- Historical signed price follows the explicitly approved policy; no current-price substitution.
- Exact tax rounding vectors shared across Edge and backend.
- Same idempotency key + same payload -> one order, one payment set, one stock decrement, one audit event.
- Same key + different hash or sale ID -> permanent conflict; no second financial write.
- Concurrent duplicate delivery -> exactly one financial commit.
- Sequence gap, sequence reuse, HLC regression and cross-terminal replay -> rejected/retryable according to the approved sequence policy.
- Concurrent oversell -> stock never becomes negative; no partial order/payment/audit effects.
- Queue retry after backend commit but before Edge acknowledgement -> returns the same committed order.
- Edge Queue/DLQ/DO outage and recovery -> no lost outbox record and no false committed status.
- RLS tests with NOBYPASSRLS runtime role prove cross-tenant and cross-store isolation.
- Append-only audit, inventory and cash movement protections remain intact.

## 7. Explicit non-actions

This design work does not authorize:
- Applying `prodx-pos-edge-sync/migrations/001_pos_ledger.sql`.
- Creating Hyperdrive configs, Cloudflare Access apps, service tokens, mTLS CAs or queues.
- Creating/resetting database credentials or using Production credentials in Preview.
- Implementing the approved Staging device-auth RFC before its protocol, threat-model, test-vector, and independent-review gates are complete.
- Disabling or weakening RLS, grants, mTLS, audit immutability, inventory controls or auth.
- Merging, deploying, or changing Production.

## 8. Exit criteria

CF-01 remains **HOLD** until all blockers B1–B8 have approved contracts, implementation, exact-head CI, independent security review and a live isolated Staging E2E proving Worker -> Queue -> backend -> existing CheckoutService -> committed receipt -> Edge acknowledgement. PostgreSQL CI alone is not live Cloudflare E2E.

## 9. Owner-approved Quarantine policy for revoked device keys

The owner approved **Quarantine** on 2026-11-11 for a sale that claims to have been signed while its device key was active but reaches the server after that key has been revoked. This policy applies to CF-01 Staging design only; it does not authorize Runtime implementation.

- Never auto-commit a post-revocation upload, even if its client-supplied `issued_at` predates the revocation timestamp. Client time is not trusted timestamp evidence.
- Preserve original signed request bytes, canonical payload hash, signature, key ID, device/tenant binding, sale ID, terminal sequence/HLC, Edge receipt time, server receipt time, and reason for quarantine as immutable evidence.
- Quarantine is a non-financial state. It must not create an order, payment, cash movement, inventory decrement, or financial ledger entry.
- A separate privileged reviewer workflow may resolve the case. The reviewer cannot edit the signed payload or reactivate the revoked key. Any approved reconciliation must revalidate tenant/device mapping, signature evidence, sequence/HLC, payload-bound idempotency, catalog price proof, payment/tender, active shift, stock, and all normal checkout invariants before invoking the existing `CheckoutService`.
- Reconciliation must use the original immutable idempotency identity. A changed payload is a permanent conflict, not a corrected retry. A correction must be a separately authorized business operation with its own audit trail.
- Quarantine, assignment, access, review, approval/rejection, escalation, expiry, and final disposition must generate append-only audit events. Evidence access must be least-privilege and audited.
- Pending evidence must not be TTL-deleted. After disposition, evidence retention must follow the approved financial/audit retention schedule; expiry of a review SLA changes workflow status only and never silently deletes evidence or auto-commits a sale.
- Define reviewer role, separation of duties, dual-control conditions, review SLA/escalation, maximum pending age, retention schedule, and final disposition rules in the dedicated Quarantine workflow contract before Runtime implementation.

The detailed state machine, security controls, and proposed test matrix are in `docs/cf01-quarantine-workflow-contract.md`.
