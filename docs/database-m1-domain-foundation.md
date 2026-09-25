# PRODX M1 — Domain Persistence Foundation

M1 is the first Gate C slice after the verified M0 backend boundary and PostgreSQL foundation.

## Scope

This migration establishes only the tenancy roots needed by later domain modules:

- `prodx_organizations` — authoritative organization identity and unique organization code.
- `prodx_stores` — store identity scoped to an organization, unique store code within that organization, explicit business timezone, and active state.

Authentication, users, roles, permissions, catalog, inventory, sales, payments, shifts, refunds, audit events, and offline outbox state remain outside this slice.

## Invariants

1. PostgreSQL is authoritative for persisted state.
2. Organization and store identifiers are UUIDs.
3. Store rows cannot exist without an organization.
4. Store codes are unique only within their organization scope.
5. Business timezone is explicit and required; timestamps remain `TIMESTAMPTZ`.
6. Blank organization/store codes and names are rejected by database constraints.
7. Organization deletion is restricted while stores exist.
8. The migration is idempotent and records its version in `prodx_schema_migrations`.
9. No monetary values are introduced in M1; later financial tables must use PostgreSQL `NUMERIC`/`DECIMAL`.

## Current implementation status

The organization/store foundation is active in the migration chain and is used by later authentication, RBAC, device/session, transaction, refund, and AI authorization boundaries.

## Next Gate C slices

- M1.1 authentication identity persistence
- M1.2 RBAC and permission persistence
- M1.3 device/session foundations
- M2 catalog and inventory persistence

Each slice must preserve tenant/store isolation and pass the production quality gate before merge.
