# M2 Authentication PostgreSQL Repository

## Purpose

Provide the application-facing persistence adapter for the M2 authentication/session service without coupling the auth domain to a PostgreSQL client library.

## Security invariants

- Password hashes are read from `prodx_user_credentials`; plaintext passwords never enter SQL.
- Bearer tokens are represented in persistence only by their SHA-256 `token_hash`.
- User status is authoritative from `prodx_users` when a session is resolved; it is not stored as client-controlled session state.
- Session and device records are scoped by organization through the database foreign keys and the repository queries.
- All values are passed as SQL parameters; SQL text is never constructed from credentials or tokens.

## M2 failed-login lockout policy

The product-owner authorization for this implementation establishes the following explicit, testable policy:

- Maximum failed credential attempts: **5** consecutive failures.
- Lockout duration: **15 minutes** from the fifth failed attempt.
- Scope: **user/credential identity** represented by the user credential row; one password credential per user in the current M1.1 model.
- Attempts during an active lockout: **rejected without incrementing the counter**.
- Successful authentication: resets `failed_attempts` to `0` and clears `locked_until`.
- Security audit requirement: lockout and unlock/reset events must be represented as authentication security events when the audit-event persistence slice is introduced; the authentication implementation must not silently weaken or bypass that requirement.

The policy is deliberately server-authoritative and tenant-safe. The application, not the client, decides whether a credential is locked, and the PostgreSQL adapter persists the resulting lockout timestamp.

## Current implementation status

The PostgreSQL authentication adapter is used through the production composition boundary. The lockout policy below is enforced by the authentication service and represented in PostgreSQL security-audit state.

## Current boundary

`SqlExecutor` is intentionally minimal and vendor-independent. The concrete PostgreSQL client is supplied by the application composition root. This keeps the auth service testable and prevents a database SDK from leaking into the authentication policy layer.
