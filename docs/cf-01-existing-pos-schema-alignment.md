# CF-01 — Existing PRODX POS Schema Alignment

**Status:** Architecture proposal — not approved for database implementation  
**Scope:** Cloudflare Edge Sync integration with the existing `PRODX-POS-PREVIEW` PostgreSQL schema  
**Safety boundary:** This document does not authorize migrations, grants, role creation, secret changes, Hyperdrive provisioning, Worker deployment, or production changes.

## 1. Decision

CF-01 must integrate with the existing `public.prodx_*` POS domain. Do not create a parallel generic `sales`, `sale_lines`, `inventory_ledger`, or `audit_logs` financial model.

The Preview database is reachable through the primary Supabase MCP connection and is healthy (PostgreSQL 17.11, project `jciucoqfmjuenssleyzo`). The prior `28P01` error was specific to the separate read-only connector credential path; it is not proof that the database itself is unavailable.

## 2. Verified schema facts

Read-only inspection found 39 application tables in `public`. The following existing tables are the likely domain targets:

| Edge Sync concept | Existing PRODX relation | Required alignment |
|---|---|---|
| Catalog products | `public.prodx_products` | Scope by `organization_id` and `store_id`; map `price_amount`, `tax_rate_bps`, currency, SKU, active state |
| Sale header | `public.prodx_orders` | Must preserve register, cashier, shift, order number, idempotency key, financial totals and server commit lifecycle |
| Sale lines | `public.prodx_order_items` | Preserve numeric amounts, discount, tax, currency and order/store/org foreign keys |
| Inventory journal | `public.prodx_inventory_ledger` | Append-only movement with resulting stock and actor; never update stock balances directly |
| Operational audit | `public.prodx_audit_log` | Preserve append-only behavior, actor, store/register and source-event idempotency |
| Security audit | `public.prodx_security_audit_events` | Use for security events, not as a replacement for financial/order audit |
| Terminal/device registry | `public.prodx_devices` | Existing organization/store/device key and active status; no certificate fingerprint mapping was found in current columns |
| Payment lifecycle | `public.prodx_payments`, `public.prodx_payment_attempts` | Reuse existing payment state machine and idempotency constraints; do not invent a second payment ledger |
| Tenant/store context | `public.prodx_organizations`, `public.prodx_stores` | The canonical scope is organization + store |

The Edge Sync source currently expects these relations, none of which exists in the Preview database: `tenant_catalog_versions`, `products`, `terminal_devices`, `terminal_sync_state`, `pos_idempotency`, `sales`, `sale_lines`, `inventory_ledger`, `audit_logs`.

## 3. Blocking contract mismatches

### 3.1 Tenant and RLS context

Existing `prodx_app` policies scope rows using transaction-local settings:
- `app.organization_id`
- `app.store_id`
- `app.user_id` for user-owned/session-sensitive records

The current Worker only receives `tenant_id` and `terminal_id`, then sets `app.current_tenant_id`. That is not sufficient to satisfy the existing RLS policies.

**Required:** resolve the trusted terminal to organization, store, device, and authorized operator context server-side. Set all required transaction-local context values on every transaction before touching tenant-scoped relations. Never accept organization/store/user identity solely from an untrusted request body.

### 3.2 Device identity and mTLS

The current Worker expects a Cloudflare Access JWT with top-level `tenant_id` and `terminal_id`, plus a separate operator `role` claim. It also expects a certificate fingerprint to map to an active `terminal_devices` row.

The current POS schema has `prodx_devices`, but the inspected columns do not include a certificate fingerprint or terminal sequence checkpoint. The mapping must be designed explicitly; do not replace mTLS with a caller-supplied fingerprint or shared-secret bypass.

### 3.3 Financial identity

The existing order header requires `register_id`, `cashier_id`, and `shift_id`. The Worker currently knows only tenant and terminal IDs. The integration must define how an enrolled device is bound to a valid register and how an authenticated cashier/shift is resolved and checked at commit time.

### 3.4 Money and catalog proof

The Worker payload represents prices as integer minor units and expects product columns such as `unit_price_minor` and `tax_bps`. The existing catalog uses numeric `price_amount`, currency, and `tax_rate_bps`.

**Required:** define exact currency minor-unit conversion and rounding rules; preserve PostgreSQL numeric precision and existing financial invariant triggers. Catalog proof must bind organization/store, product, price, tax, currency and catalog version. Do not assume every currency has two decimal places without an explicit currency contract.

## 4. Proposed persistence design

Reuse existing domain tables for all financial effects. Consider adding only narrowly scoped operational tables after review:

1. **Terminal sync checkpoint** — organization/store/device scope, contiguous terminal sequence, HLC checkpoint, updated timestamp; unique key on the enrolled terminal identity.
2. **Sync idempotency receipt** — organization/store/device scope, idempotency key, canonical payload hash, linked `prodx_orders.id`, lifecycle state and timestamps; enforce uniqueness so retries cannot create a second order.
3. **Device certificate enrollment mapping** — only if the existing device registry cannot safely represent certificate fingerprint, validity window, revocation and rotation. Prefer a separate relation with a strict FK to `prodx_devices` over duplicating device identity.
4. **Catalog revision** — only if no existing reliable revision source exists. It must be transactionally advanced by product/catalog mutations and scoped to organization/store.

Do not add duplicate order, order-line, payment, inventory, or financial audit tables.

## 5. Runtime role and authorization

The existing `prodx_app` role is LOGIN and NOBYPASSRLS, but its inspected table grants are broader than the Edge Sync runtime contract. Do not reuse it blindly.

Prepare a dedicated Edge Sync LOGIN role with:
- `NOSUPERUSER NOBYPASSRLS`
- no ownership of application tables or schemas
- no membership in privileged roles
- explicit schema USAGE and table/sequence/function privileges only
- RLS policies explicitly targeting the new role and using organization/store context
- no DELETE/UPDATE on append-only inventory or audit relations
- execution only on specifically reviewed functions, if any

Do not use `postgres`, `service_role`, a BYPASSRLS role, or `SECURITY DEFINER` as a shortcut. Any genuinely required privileged function must be narrowly scoped, non-publicly executable, and independently reviewed.

## 6. Atomic commit contract

The server-authoritative commit must be one database transaction that:
1. validates the trusted device and organization/store/register/shift/cashier bindings;
2. claims the idempotency key and checks canonical payload hash;
3. validates sequence and HLC monotonicity;
4. revalidates signed catalog prices against the authoritative product/catalog state;
5. creates the order and order items through existing financial invariant paths;
6. appends inventory ledger movements through the existing inventory mechanism;
7. appends immutable audit evidence;
8. links the idempotency receipt to the committed order and advances the terminal checkpoint.

A retry with the same key and same payload must return the original result. Reuse of the key with a different payload must fail closed. A partial order/inventory/audit/checkpoint commit must be impossible.

The implementation must be designed against actual triggers, constraints, functions, and current checkout orchestration before choosing direct SQL versus a dedicated database function.

## 7. Required verification gates

Before any Preview migration or Hyperdrive provisioning:
- [ ] Review exact table constraints, unique indexes, triggers, functions, and append-only enforcement for the target domain.
- [ ] Define and test trusted device → organization/store/register mapping.
- [ ] Define cashier/shift authority at commit time.
- [ ] Define certificate enrollment, rotation and revocation lifecycle.
- [ ] Specify RLS policies and grants for the dedicated NOBYPASSRLS role.
- [ ] Write additive migration with a rollback plan; do not weaken existing RLS/grants/audit protections.
- [ ] Test exact duplicate replay and conflicting payload replay.
- [ ] Test concurrent duplicate claims and sequence/HLC races.
- [ ] Test cross-organization and cross-store isolation using the real runtime role.
- [ ] Reconcile order totals, payment state, inventory ledger/balance and immutable audit after retries/failures.
- [ ] Run PostgreSQL integration tests against a disposable database first.
- [ ] Only after the schema contract is approved, provision separate Hyperdrive DIRECT (caching disabled) and CACHED configurations for Preview.

## 8. Current status

- Preview project healthy and accessible via Supabase MCP primary connection.
- Existing Preview schema inspected read-only; no database changes made.
- Cloudflare Hyperdrive config count remains zero.
- Existing staging Queue resources remain unbound to a deployed Worker.
- Edge Sync Worker remains undeployed; its current Wrangler config contains placeholder Hyperdrive IDs and placeholder Access audience.
- CF-01 remains **HOLD — schema and identity contract mismatch**.
- OCI Bridge PR #374 remains Draft; it is separate from CF-01 and remains unmerged/undeployed.

## 9. Rollback boundary

This proposal has no runtime effect and requires no rollback. When implementation is proposed, the migration plan must identify each additive object and its reverse operation. Any destructive or data-transforming step must be separately reviewed and explicitly approved before execution.
