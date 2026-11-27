# Owner Security Audit Trail — Design

Status: implementation prepared on `feat/owner-audit-implementation` (stacked on PR #398); remote rollout remains blocked pending explicit approval.
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
5. Keep browser roles unable to read or write the custom audit table or access the `auth` schema.
6. Do not create browser-reported copies of authentication events that Supabase Auth already records; preserve the Auth service as the source of truth for credential and MFA outcomes.
7. Keep Owner-specific authorization and role-administration decisions in the application audit ledger.

## Proposed database objects

### `public.owner_security_audit_events`

The table is in `public` so the Edge Function can use the project Data API without exposing a new custom schema. Explicit grants and RLS keep browser roles out.

Suggested columns:
- `id uuid primary key default gen_random_uuid()`
- `occurred_at timestamptz not null default now()`
- `event_type text not null` constrained to the approved event catalogue
- `outcome text not null` constrained to `success` or `denied`
- `actor_user_id uuid null` populated only from a server-verified JWT or trusted Admin API operation
- `target_user_id uuid null` for trusted role administration
- `request_id uuid not null default gen_random_uuid()`
- `reason_code text null` selected from a finite allowlist
- `source text not null` constrained to `server_verified` or `trusted_admin`

No arbitrary JSON metadata column is planned. This reduces accidental credential/PII capture. The `source` column is server-assigned only.

Enable and FORCE RLS with no browser policies. Revoke all table privileges from `PUBLIC`, `anon`, and `authenticated`. Grant only `INSERT` to `service_role`; the Owner feed reads through a separate `SECURITY DEFINER` function whose execute privilege is granted only to `service_role`. Add a trigger rejecting UPDATE and DELETE, plus a statement-level trigger rejecting TRUNCATE. This is defense in depth; privileged database administrators remain outside the application threat model.

### Supabase Auth Audit Logs (source of truth for authentication)

Do not ask the browser to report successful/failed password sign-ins, TOTP enrollment, TOTP verification, challenge creation, or logout as custom audit events. Supabase Auth already records these lifecycle events in its Auth Audit Logs, including `login`, `logout`, `factor_in_progress`, `challenge_created`, and `verification_attempted`. This avoids treating a client assertion as authoritative and avoids a public unauthenticated logging endpoint.

Supabase stores Auth Audit Logs in external log storage and can optionally persist them in `auth.audit_log_entries`. A read-only Management API inspection confirmed `audit_log_disable_postgres = true` in the Owner Auth project, so Postgres persistence is currently disabled. The managed table exists but had zero rows; `service_role` has no direct SELECT privilege on it. A read-only Logs query for `auth_audit_logs` returned no events in the inspected 24-hour window; no real Owner login/TOTP E2E has occurred yet.

To enable the Owner Console Auth event feed, the setting must change from `audit_log_disable_postgres = true` to `false`. This will persist future Supabase Auth audit payloads in the Owner Auth database, including fields such as IP address and user-agent. The Owner API returns only a sanitized projection and never returns those fields. This remote Auth configuration change requires explicit approval; rollback is setting it back to `true`, which stops future Postgres persistence but does not delete existing rows.

## Proposed Edge Function boundary

Implementation adds `owner-audit` as a GET-only Edge Function. It validates the exact configured Owner Console origin, the bearer JWT with Supabase Auth, trusted `app_metadata.owner_role === 'owner'`, a verified TOTP factor, and AAL2 before calling the server-only `owner_security_audit_feed` RPC. The RPC is `SECURITY DEFINER`, uses a fixed `pg_catalog` search path, disables row security only inside the privileged function, and returns a strict sanitized projection. No browser role can execute it.

The existing `owner-authorize` handler records `owner.authorization.denied` events from server-verified authorization decisions, deriving actor ID from `getUser()` and storing only an allowlisted reason code. Audit write failure never turns a denial into an authorization grant. Auth lifecycle events are never accepted from the browser as authoritative; they come from Supabase Auth Audit Logs.

Trusted provisioning/revocation events remain reserved. They must not be written through the browser endpoint; instrument them only after a dedicated server-side Admin API provisioning/revocation path exists. The Owner Console reads the feed through `owner-audit` and displays only the sanitized event fields. No service-role or secret key enters Vite variables, client bundles, browser requests, or logs.

## Event catalogue

- Supabase Auth Audit Logs: `login`, `logout`, `factor_in_progress`, `factor_unenrolled`, `challenge_created`, `verification_attempted`, `mfa_code_login`, and related Auth events.
- Custom Owner ledger: `owner.authorization.denied`, `owner.role.provisioned`, and `owner.role.revoked` (the latter two only from a trusted administrative path).

## Verification plan

- Unit tests for strict event allowlist, origin allowlist, request size limits, actor derivation, and redaction.
- Tests proving browser roles cannot SELECT/INSERT/UPDATE/DELETE the custom audit table or read the `auth` schema.
- Tests proving UPDATE, DELETE, and TRUNCATE fail even for a role with insert privileges.
- Tests proving client payloads cannot set actor ID, role, email, or source.
- Tests proving the Owner audit read path requires trusted `app_metadata.owner_role` and AAL2, and returns only sanitized fields from Auth Audit Logs.
- Tests proving missing Postgres Auth Audit persistence or unavailable Auth logs fails closed without fabricating missing events.
- Deno typecheck and Edge Function tests in CI.
- Preview browser checks, real Owner login + TOTP E2E, and an independent security review before merge.

## Rollout and rollback

No remote schema, Supabase config, Edge Function, or Vercel deployment has been changed by this design.

The additive migration and regression test have been generated and verified against a disposable PostgreSQL 17 container. The SQL tests cover forced RLS, browser-denied grants, server-only INSERT/RPC, append-only UPDATE/DELETE/TRUNCATE protection, and sanitization of Auth payloads. No remote migration has been applied. Rollback is a separate reviewed migration that revokes Edge Function writes first, exports/preserves audit evidence, then removes only the newly introduced audit objects if explicitly approved. Never rewrite or delete historical audit events as part of ordinary rollback.

## Open implementation gates

1. Obtain explicit approval to change `audit_log_disable_postgres` from `true` to `false` in the dedicated Owner Auth project. This persists future Auth audit payloads, including IP address and user-agent; rollback is setting it back to `true` (existing rows remain).
2. Obtain explicit approval to apply `20261121081237_owner_security_audit_trail.sql` to `PRODX-OWNER-AUTH`. It creates one append-only custom table, two functions, two triggers, and two indexes. No POS Staff Auth or POS production DB changes are in scope.
3. Merge PR #398 first; the implementation branch `feat/owner-audit-implementation` is stacked on it and must then be retargeted to `main` for the main-branch autonomous gate.
4. Deploy both Edge Functions only after the migration and Auth persistence setting are approved and applied; then run real Owner Login + TOTP E2E and Preview browser checks.
5. Implement the trusted Admin API provisioning/revocation path before claiming `owner.role.provisioned` and `owner.role.revoked` events are complete.
6. Do not apply the migration or change remote Auth audit-log storage without explicit approval.
