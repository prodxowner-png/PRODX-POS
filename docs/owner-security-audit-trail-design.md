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
6. Apply atomic rate controls to unauthenticated failure reports.
7. Treat client-reported sign-in failures as unverified telemetry, not proof that Auth rejected a credential.

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

### `public.owner_security_audit_rate_limits`

Separate mutable operational state; it is not part of the immutable event ledger. Use a keyed HMAC of the trusted gateway client IP as the primary key, a fixed time window, and an atomic upsert counter. Do not persist raw IP addresses. Store the HMAC key only as a server-side Edge Function secret. Enable RLS, define no browser policies, revoke browser privileges, and grant only the required rate-limit operations to `service_role`.

The Edge Function must derive the client address from a platform-supplied, gateway-normalized header. Do not trust a client-provided actor or IP field in the request body. If the hosted runtime cannot provide a trustworthy client IP, unauthenticated failure telemetry must remain disabled rather than using a spoofable header.

## Proposed Edge Function boundary

Add `owner-audit` as a separate Edge Function. It validates the exact configured Owner Console origin and accepts a strict event schema.

- Authenticated events: validate the bearer token with Supabase Auth; derive actor ID and role from the verified user; require trusted `app_metadata.owner_role === 'owner'`. Require verified TOTP + AAL2 for privileged post-auth events. For TOTP verification failure and authorization denial, allow the verified Owner identity at AAL1 only where necessary to record the denied/failed transition; do not elevate authorization.
- Unauthenticated sign-in failure: allow only the fixed `owner.sign_in.failure` event type, no actor ID, no email, no client-supplied reason, and enforce an atomic IP-HMAC rate limit. Mark `source = 'client_reported'` because a browser cannot prove the Auth server rejected the credentials.
- Trusted provisioning/revocation: do not expose this through the browser endpoint. Instrument only after a dedicated server-side Admin API provisioning/revocation path exists; derive actor and target from that trusted path.
- Logout: submit while the valid session is still available, before local token removal. A failure to record must never prevent local sign-out.

The Edge Function uses a server-only secret key to write through the database API. No service-role or secret key may enter Vite variables, client bundles, browser requests, or logs. The existing `owner-authorize` function remains an authorization decision endpoint and is not overloaded with audit writes.

## Event catalogue

- `owner.sign_in.success`
- `owner.sign_in.failure` (source must be `client_reported` unless sourced from a trusted server-side Auth event)
- `owner.totp.enrollment.started`
- `owner.totp.enrollment.completed`
- `owner.totp.verification.success`
- `owner.totp.verification.failure`
- `owner.authorization.denied`
- `owner.logout`
- `owner.role.provisioned` (trusted admin path only)
- `owner.role.revoked` (trusted admin path only)

## Verification plan

- Unit tests for strict event allowlist, origin allowlist, request size limits, actor derivation, and redaction.
- Tests proving browser roles cannot SELECT/INSERT/UPDATE/DELETE either table.
- Tests proving UPDATE, DELETE, and TRUNCATE fail even for a role with insert privileges.
- Concurrency tests for rate-limit upsert and expiry behavior.
- Tests proving client payloads cannot set actor ID, role, email, or source.
- Tests for unauthenticated failure telemetry: no actor, no raw IP, HMAC key absent/misconfigured fails closed, rate limit returns 429.
- Deno typecheck and Edge Function tests in CI.
- Preview browser checks, real Owner login + TOTP E2E, and an independent security review before merge.

## Rollout and rollback

No remote schema, Supabase config, Edge Function, or Vercel deployment has been changed by this design.

Before applying the additive migration, provide the complete SQL diff and verify it against a disposable/local PostgreSQL 17 instance. Rollback is a separate reviewed migration that revokes Edge Function writes first, exports/preserves audit evidence, then removes only the newly introduced audit objects if explicitly approved. Never rewrite or delete historical audit events as part of ordinary rollback.

## Open implementation gates

1. Confirm the hosted Edge Runtime's trusted client-IP header contract before enabling unauthenticated failure telemetry.
2. Decide whether Supabase Auth's built-in audit stream can provide authoritative failed-login events; if not, preserve the `client_reported` source classification.
3. Generate the migration using `supabase migration new owner_security_audit_trail` from the repository environment, then review the generated timestamped file.
4. Do not apply the migration to the remote Owner Auth project without explicit approval.
