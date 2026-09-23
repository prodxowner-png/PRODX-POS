# M2 Authentication Enforcement Foundation

This document defines the application-security boundary for M2 authentication enforcement.

## Current implementation status — 2026-09-24

The enforcement boundary is wired into the production server path. Protected requests derive identity and tenant/store scope from the verified session rather than client-supplied scope. Fresh exact-head authentication/security checks are passing.

## Scope

M2 verifies credentials through an explicit service boundary, issues sessions without persisting plaintext bearer tokens, rejects disabled devices and expired or revoked sessions, constructs an authenticated request context, and delegates authorization to deterministic policy.

## Security invariants

- PostgreSQL remains authoritative for user, organization, store, device, and session state.
- Plaintext session tokens must never be persisted.
- Stored session state contains only a token hash.
- Disabled devices cannot authenticate requests.
- Expired or revoked sessions cannot authenticate requests.
- Authenticated context is derived from server-side session state, not caller-supplied organization/store identifiers.
- Authorization remains exact and tenant-scoped; wildcard permissions are not supported.
- No demo unlock credentials or hard-coded production credentials are permitted.

## Delivery gate

Implementation must pass the repository's typecheck, backend, database, architecture, and security gates. The branch must not weaken or bypass existing checks.
