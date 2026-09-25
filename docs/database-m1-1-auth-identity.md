# PRODX M1.1 — Authentication Identity Persistence

M1.1 extends the Gate C foundation with the minimum durable identity state required before authentication can become production-backed.

## Scope

- `prodx_users` stores organization-scoped user identity and lifecycle state.
- `prodx_user_credentials` stores only a password credential hash and bounded authentication-failure state.
- PostgreSQL remains authoritative; timestamps use `TIMESTAMPTZ`.

## Security invariants

1. Users are always scoped to an organization.
2. Usernames are unique within an organization.
3. User status is explicitly `active` or `disabled`.
4. Credential material is represented only by `secret_hash`; plaintext passwords/PINs are not persisted.
5. Credential hashes cannot be blank.
6. Failed-attempt counters cannot be negative.
7. Credential rows cannot outlive their user; deleting a user cascades to the credential row.
8. Roles, permissions, store memberships, sessions, devices, manager authorization, and transaction state remain outside M1.1.
9. Authentication implementation must verify hashes server-side and must never expose credential hashes to the client.

## Current implementation status

M1.1 is active in the PostgreSQL migration chain and is exercised by authentication/security gates. Authentication verifies hashes server-side and never exposes credential hashes to the client.

## Next slice

M1.2 establishes RBAC and permission persistence, including explicit organization/store authorization scope.
