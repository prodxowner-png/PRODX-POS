## Reverification after documentation updates — 2026-09-24

Current exact HEAD is 13d154b795b36fcceb5ccc54a8cdb599d358edb2. The deterministic workflows for this documentation-updated HEAD are currently queued/pending, so prior PASS evidence from b76001ca8ff6ec85e45a7834e9b3b63854ad5d3b is historical evidence and is not claimed for the current HEAD. Gemini hosted review and autonomous Gemini runs are also queued.

# PRODX Database Foundation

PostgreSQL is the authoritative transactional store for PRODX POS. The current migration chain on this branch extends through migration 0018 for the Gemini AI permission boundary.

## Current invariants

- PostgreSQL is authoritative for transactional state.
- Authoritative timestamps use UTC (TIMESTAMPTZ).
- Business timezone is supplied explicitly by store/application context.
- Monetary persistence uses PostgreSQL NUMERIC/decimal semantics; JavaScript floating point is not authoritative money.
- Tenant-owned data carries organization/store scope where applicable.
- Transactional writes are atomic.
- Retried external writes require durable, scope-aware idempotency keys.
- Inventory, cash, financial state, and document numbering require explicit concurrency controls where applicable.
- Migration history has one authoritative head and is validated in CI.
- ai:use is a canonical RBAC permission registered by migration 0018 and intentionally not granted to a default role by migration.

## Migration policy

Migrations are forward-only, reviewable SQL files under db/migrations/. CI applies every migration in lexical order against PostgreSQL 16 and verifies migration head, timestamp behavior, numeric precision, and migration idempotency.

## Current gate evidence

At HEAD b76001ca8ff6ec85e45a7834e9b3b63854ad5d3b, fresh PostgreSQL transaction-integrity, device/session-invariant, and backend/PostgreSQL/build/security checks are passing. Gemini provider runtime evidence and runtime tenant provisioning for ai:use remain release blockers.
