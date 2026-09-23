# M1.3 Device & Session Persistence

M1.3 establishes the persistence boundary needed for authenticated POS access without introducing business transaction state.

## Devices

`prodx_devices` is organization- and store-scoped. A device belongs to exactly one store, and PostgreSQL enforces that the store belongs to the same organization. Device keys are unique within an organization. Lifecycle is explicitly `active` or `disabled`.

## Sessions

`prodx_sessions` binds a session to one organization, user, and device. Composite foreign keys prevent cross-organization joins. Only a `token_hash` is persisted; plaintext session tokens never belong in PostgreSQL.

A session has explicit `issued_at`, `expires_at`, optional `revoked_at`, and optional `last_seen_at`. Database checks require expiry after issuance and revocation not before issuance. Token hashes are globally unique to prevent accidental duplicate bearer-token state.

## Current implementation status

M1.3 is implemented and fresh exact-head PostgreSQL device/session invariant and authentication-security checks are passing.

## Deliberate exclusions

M1.3 does not implement token issuance, password verification, refresh-token rotation, device attestation, API routes, Redis sessions, business transactions, cash, inventory, or payments. Those behaviors require application/service contracts and later production-hardening decisions.

## Tenant invariants

- PostgreSQL remains authoritative.
- Organization scope is carried through device and session rows.
- A device cannot reference a store from another organization.
- A session cannot reference a user or device from another organization.
- Disabled devices and expired/revoked sessions must be rejected by the authentication service; database state alone is not an authorization decision.
- UI visibility is never an authorization boundary.
