# Owner Security Audit Trail — Design

Status: proposed implementation design for Issue #399  
Scope: dedicated `PRODX-OWNER-AUTH` project only. This document does not apply database changes or deploy Edge Functions.

## Verified starting state (2026-11-21)

- Supabase project `tohgadyunmsfcopaldvz` is `ACTIVE_HEALTHY`, PostgreSQL 17.12.
- The project has no recorded user migrations.
- The `public` schema has no application tables or views.
- The `private` schema does not exist.
- No application functions exist in `public` or `private`.
- `anon`, `authenticated`, and `service_role` currently have USAGE on `public`.
- Owner Console uses a dedicated Auth project and its current `owner-authorize` function verifies the JWT, trusted `app_metadata.owner_role`, verified TOTP factor, and AAL2.
- Public sign-up is disabled. No POS Staff Auth or POS production database is in scope.

## Security goals

1. Never accept actor identity, role, email, outcome, or reason as authoritative from browser metadata.
2. Never store passwords, OTP values, TOTP secrets, access/refresh tokens, API keys, raw request bodies, or unnecessary PII.
3. Keep audit writes server-side and isolated from POS data.
4. Make the event store append-only at both privilege and trigger layers.
5. Keep browser roles unable to read or write audit/rate-limit tables.
6. Do not create browser-reported copies of authentication events that Supabase Auth already records; preserve the Auth service as the source of truth for credential and MFA outcomes.
7. Keep Owner-specific authorization and role-administration decisions in the application audit ledger.

## Proposed database objects

### `public.owner_security_audit_events`

The table is in `public` so the Edge Function can use the project Data API without exposing a new custom schema. Explicit grants and RLS keep browser roles out.

Suggested columns:
- `id uuid primary key default gen_random_uuid()`
- `occurred_at timestamptz not null default now()`
- `event_type text not null` constrained to the approved event catalogue
- `outcome text not null` constrained to `success`, `failure`, `denied`, or `started`
- `actor_user_id uuid null` populated only from a server-verified JWT or trusted Admin API operation
- `request_id text null` validated and length-limited
- `reason_code text null` selected from a finite allowlist
- `source text not null` constrained to `server_verified`, `trusted_admin`, or `client_reported`

No arbitrary JSON metadata column is planned. This reduces accidental credential/PII capture.

Enable RLS and create no browser policies. Revoke all table privileges from `PUBLIC`, `anon`, and `authenticated`. Grant only the minimum required `SELECT, INSERT` to `service_role`. Add a trigger rejecting UPDATE and DELETE, plus a statement-level trigger rejecting TRUNCATE. This is defense in depth; privileged database administrators remain outside the application threat model.

### Supabase Auth Audit Logs (source of truth for authentication)

Do not ask the browser to report successful/failed password sign-ins, TOTP enrollment, TOTP verification, challenge creation, or logout as custom audit events. Supabase Auth already records these lifecycle events in its Auth Audit Logs, including `login`, `logout`, `factor_in_progress`, `challenge_created`, and `verification_attempted`. This avoids treating a client assertion as authoritative and avoids a public unauthenticated logging endpoint.

Supabase stores Auth Audit Logs in external log storage by default; optional Postgres persistence writes to `auth.audit_log_entries`. The current Owner Auth database has that managed table, but the inspected table had zero rows and `service_role` currently has no SELECT privilege on it. A read-only Logs query for `auth_audit_logs` also returned no events in the inspected 24-hour window. This does not prove audit logging is disabled; no real Owner login/TOTP E2E has occurred yet.

For Owner Console visibility, a separate server-side read path must be designed and tested. It may expose only a sanitized projection of the Auth audit events after independently verifying Owner role and AAL2. Do not grant browser access to the `auth` schema or return raw payloads, IP addresses, emails, or metadata. If Postgres persistence must be enabled, treat that as a separate remote Auth configuration change requiring explicit approval.

## Proposed Edge Function boundary

Add `owner-audit` as a separate Edge Function. It validates the exact configured Owner Console origin and accepts a strict event schema.

- Auth lifecycle events are not accepted from the browser as authoritative; consume Supabase Auth Audit Logs through the privileged server-side read path described above.
- Owner-specific authorization denied: validate the bearer token where present, derive actor ID from Supabase Auth, and record only a normalized reason code. For invalid/no-session denials, record actor as null and do not accept an actor ID or email from the client.
- Trusted provisioning/revocation: do not expose this through the browser endpoint. Instrument only after a dedicated server-side Admin API provisioning/revocation path exists; derive actor and target from that trusted path.
- The write endpoint must use a strict event allowlist, exact configured origin, request-size limits, and server-only service credentials. Fail closed on missing secrets or invalid authorization.

The Edge Function uses a server-only secret key to write through the database API. No service-role or secret key may enter Vite variables, client bundles, browser requests, or logs. The existing `owner-authorize` function remains an authorization decision endpoint and is not overloaded with audit writes.

## Event catalogue

- Supabase Auth Audit Logs: `login`, `logout`, `factor_in_progress`, `factor_unenrolled`, `challenge_created`, `verification_attempted`, `mfa_code_login`, and related Auth events.
- Custom Owner ledger: `owner.authorization.denied`, `owner.role.provisioned`, and `owner.role.revoked` (the latter two only from a trusted administrative path).

## Verification plan

- Unit tests for strict event allowlist, origin allowlist, request size limits, actor derivation, and redaction.
- Tests proving browser roles cannot SELECT/INSERT/UPDATE/DELETE either table.
- Tests proving UPDATE, DELETE, and TRUNCATE fail even for a role with insert privileges.
- Concurrency tests for rate-limit upsert and expiry behavior.
- Tests proving client payloads cannot set actor ID, role, email, or source.
- Tests proving the Owner audit read path requires trusted `app_metadata.owner_role` and AAL2, and returns only sanitized fields from Auth Audit Logs.
- Tests proving missing Postgres Auth Audit persistence or unavailable Auth logs fails closed without fabricating missing events.
- Deno typecheck and Edge Function tests in CI.
- Preview browser checks, real Owner login + TOTP E2E, and an independent security review before merge.

## Rollout and rollback

No remote schema, Supabase config, Edge Function, or Vercel deployment has been changed by this design.

Before applying the additive migration, provide the complete SQL diff and verify it against a disposable/local PostgreSQL 17 instance. Rollback is a separate reviewed migration that revokes Edge Function writes first, exports/preserves audit evidence, then removes only the newly introduced audit objects if explicitly approved. Never rewrite or delete historical audit events as part of ordinary rollback.

## Open implementation gates

1. Confirm whether Auth Audit Logs Postgres persistence is enabled; the current read-only inspection did not establish this setting.
2. Design and test a server-only, Owner+AAL2-protected read path for sanitized Auth Audit Log projections. Do not grant browser access to the `auth` schema.
3. Decide whether Owner Console must display Auth Audit Logs directly or link operators to the Supabase dashboard; this affects whether read-only grants/views are required.
4. Generate the additive migration using `supabase migration new owner_security_audit_trail` from the repository environment, then review the generated timestamped file.
5. Do not apply the migration or change Auth audit-log storage configuration on the remote Owner Auth project without explicit approval.
