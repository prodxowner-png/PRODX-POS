# PRODX POS — MFA Architecture Gap Review

**Review date:** 2026-11-09  
**Repository:** `prodxowner-png/PRODX-POS`  
**Reviewed ref:** `main` at `c3329c99cf0d0c8095ad9d732a3cfca5a23d69ec`  
**Review type:** Static source and migration review  
**Status:** **HOLD — D1 approved; D2–D7 pending; implementation gate remains closed**

## 1. Executive finding

The repository already has a server-authoritative password/Supabase authentication and PostgreSQL session foundation. MFA must extend that foundation; it must not introduce a parallel session issuer, duplicate session table, or a second audit system.

The most important integration gap is that both credential authentication and Supabase token exchange currently create a full local POS session immediately after the first authentication factor. MFA cannot be safely added only at the frontend or as a route-level prompt. The session issuance contract and all session-creation entry points must be changed together.

This review is static. It does not claim that the current branch was built, tested, or deployed in this turn.

## 2. Evidence reviewed

- `server/http/auth-route.ts`
- `server/auth/session.ts`
- `server/auth/postgres-repository.ts`
- `server/auth/composition.ts`
- `server/auth/login-rate-limit.ts`
- `server/auth/supervisor-authorization.ts`
- `server/auth/session.test.ts`
- `server/auth/postgres.integration.test.ts`
- `server/http/auth-first-tenant-bootstrap.test.ts`
- `db/migrations/0005_m1_3_device_session.sql`
- `db/migrations/0006_m2_auth_security_audit.sql`
- `db/migrations/0030_m5_audit_log_immutability.sql`
- `db/migrations/0036_security_tenant_store_rls.sql`
- `db/migrations/manifest.json`
- Open auth-related PR metadata and changed-file lists for #291, #303, #331, #344, #346.

## 3. Findings

### F-01 — Full POS session is issued before an MFA decision

**Severity:** Critical for any rollout that makes MFA mandatory.

Evidence:
- `SessionIssuer.authenticateCredentials` verifies the password, resets failed attempts, creates a bearer token, persists `prodx_sessions`, and returns the token.
- `SessionIssuer.authenticateSupabaseToken` verifies a Supabase JWT and also creates a local POS session.
- `handleCredentialLogin` calls `authenticateCredentials` before loading role/store context.
- `/auth/supabase/session` and the one-time bootstrap route call `authenticateSupabaseToken`.

Required change:
- Split first-factor verification from full-session issuance.
- Create a restricted, short-lived pre-authentication transaction for accounts whose effective policy requires MFA.
- Keep all four session-creation entry points in scope: credential login, Supabase session exchange, first-tenant bootstrap, and any future alternate login adapter.
- Issue a new full session only after server-side MFA policy and proof validation succeed.

### F-02 — Supabase JWT verifier does not expose MFA assurance claims

**Severity:** High.

Evidence:
- `createSupabaseTokenVerifier` validates signature/JWKS, issuer, audience, UUID subject, and expiry.
- Its returned identity contains only `userId` and `expiresAt`.
- No `aal` / `amr` or equivalent assurance information is surfaced to the POS policy layer.

Required change:
- Decide whether MFA is owned by PRODX, Supabase Auth, or a deliberate hybrid.
- If Supabase MFA is accepted as proof, validate the exact documented assurance claims and bind them to the verified JWT; never trust client-supplied assurance flags.
- If PRODX owns MFA, Supabase authentication remains only the first factor and must enter the same pre-authentication transaction as password login.

### F-03 — Existing session contract has no assurance provenance

**Severity:** High.

Evidence:
- `AuthenticatedSession` contains session/user/organization/store identifiers but no assurance level or authentication transaction reference.
- `SessionRecord` and `prodx_sessions` do not currently persist MFA assurance, authentication method, MFA verification time, or originating auth transaction.

Required change:
- Extend the existing session contract and table with an approved assurance/provenance model (for example, assurance level, authenticated-at, auth transaction ID, and policy version).
- Preserve existing token-hash storage, expiry, revocation, device binding, organization scope, and store scope.
- Do not create a parallel session table.

### F-04 — Security audit writes are intentionally restricted to narrow database functions

**Severity:** High for implementation design.

Evidence:
- `0036_security_tenant_store_rls.sql` revokes direct INSERT/UPDATE/DELETE on `prodx_security_audit_events` from `prodx_app`.
- Authentication lockout/reset writes use fixed `SECURITY DEFINER` functions.
- `0030_m5_audit_log_immutability.sql` adds an UPDATE/DELETE trigger to `prodx_audit_log`; that trigger is not the same table as `prodx_security_audit_events`.

Required change:
- Add narrowly scoped, fixed-purpose `SECURITY DEFINER` functions for MFA state transitions and audit append operations, with fixed `search_path`, explicit grants, and tenant/user/device checks.
- Do not add direct runtime INSERT access to the security audit table.
- Preserve the distinction between business audit history and authentication security events.

### F-05 — MFA retry policy must not accidentally reuse password lockout semantics

**Severity:** High.

Evidence:
- The existing credential policy is five consecutive failed password attempts followed by a 15-minute lockout.
- The IP throttle is a separate 10-minute window with a 20-failure threshold and a one-minute lockout.
- Supervisor authorization also uses the credential record's failed-attempt/lockout fields.

Required change:
- Keep password lockout, IP throttling, MFA challenge attempts, factor-level replay protection, and recovery throttling as distinct controls.
- Define how MFA failures affect account-level risk without allowing a low-assurance attacker to trivially lock out an employee's password or supervisor workflow.
- Do not silently change the existing approved password lockout contract.

### F-06 — New MFA tables must integrate with the existing RLS/grant model

**Severity:** High.

Evidence:
- Migration 0036 classifies PRODX tables and installs tenant/store RLS policies.
- The runtime role uses narrow grants and fixed functions for pre-authentication access.
- The migration governance manifest pins the existing baseline and requires new migration IDs greater than 0045 with unique four-digit prefixes.

Required change:
- Add explicit organization/store ownership, constraints, indexes, RLS policies, grants, and fixed database functions for each new MFA table.
- Use the next valid migration ID only after the current migration integration stack is reconciled. Do not edit immutable baseline migrations.
- PR #340/#342 describe migration work in the 0044–0049 range; the current MFA migration number must be selected against the actual integrated mainline, not guessed from a stale branch.

### F-07 — Auth responses should consistently prevent caching

**Severity:** Medium.

Evidence:
- First-tenant bootstrap and the Supabase session-renewal change set `Cache-Control: private, no-store`.
- The credential-login and Supabase-session response paths in current `auth-route.ts` do not consistently set the same header before returning a context that includes the local bearer token.

Required change:
- Apply `Cache-Control: no-store` consistently to every response that contains a POS session token or pre-authentication handle.
- Add route-level regression tests.

### F-08 — First-tenant bootstrap needs an explicit MFA bootstrap policy

**Severity:** High.

Evidence:
- `/auth/supabase/bootstrap` requires a one-time configured secret and an allowlisted verified Supabase subject, then issues a local POS session for the first Owner.
- The bootstrap integration test verifies the secret/subject boundary but has no MFA enrollment/assurance step.

Required change:
- Define a one-time bootstrap exception or a restricted bootstrap session that can only enroll the first approved factor.
- Do not deadlock initial tenant creation by requiring an MFA factor that cannot yet exist.
- The bootstrap path must never become a reusable MFA bypass.

### F-09 — Supervisor approval is a separate authorization flow, not login MFA

**Severity:** Medium.

Evidence:
- `server/auth/supervisor-authorization.ts` creates a short-lived authorization token bound to organization, store, requester, requester session, action, and order.
- Consumption is conditional and single-use.
- It verifies a supervisor credential; it does not establish employee login MFA.

Required change:
- Preserve this as transaction-specific manager authorization.
- Do not count Manager PIN/password approval as a second factor for login.
- Review shared failed-attempt counter effects when implementing separate MFA retry counters.

## 4. Existing PR dependency assessment

There is no open PR explicitly titled MFA, but several open PRs modify the shared authentication/session surface.

| PR | Current status observed | Relevance |
|---|---|---|
| #346 Supabase POS session renewal | Open, non-draft, mergeable; based on old base SHA `2bb1699...` | Modifies `session.ts`, `auth-route.ts`, repository and migration 0058 |
| #344 Unify Supabase connections | Open Draft; based on old base SHA `2bb1699...` | Modifies Supabase verifier configuration in `session.ts` |
| #331 Supabase POS identity/Gmail OAuth | Open, non-draft, dirty; old base | Modifies auth composition and frontend adapter wiring |
| #303 Supabase Auth/protected Owner route | Open Draft, dirty and substantially behind main | Modifies session and auth routes |
| #291 Owner Console/Supabase client | Open Draft, dirty | Modifies Owner auth/session boundary |

Do not merge or build MFA on top of these historical branches independently. Consolidate the intended auth/session changes onto current main first, then implement MFA against the resulting single contract. PR #367 is the active dependency-security workstream and is not an MFA implementation dependency.

## 5. Existing strengths to preserve

- SHA-256 hash-only persistence for local POS bearer tokens.
- Cryptographically random local bearer generation.
- Server-side device, organization, store membership, and active-user checks.
- Parameterized SQL and narrow `SECURITY DEFINER` pre-auth functions.
- PostgreSQL-backed credential lockout and IP throttle.
- Session expiry, revocation, and disabled-device checks.
- PostgreSQL integration tests for credential lockout, tenant isolation, token-hash persistence, and session lifecycle.
- Existing supervisor authorization is scoped to the exact business action and is single-use.

## 6. Verification status

| Evidence | Status |
|---|---|
| Static source inspection on current main SHA | **PASS — inspected** |
| Existing M2 unit/integration test definitions | **PASS — present** |
| MFA-specific unit/integration tests | **NOT PRESENT in reviewed paths** |
| Exact-head CI for current main in this review | **UNVERIFIED — no check records returned** |
| PostgreSQL migrations executed in this review | **NOT RUN** |
| Production runtime behavior | **NOT TESTED** |

## 7. Approved decision record

### D1 — Factor strategy: APPROVED

**Decision:** Accept verified Supabase MFA as satisfying the PRODX POS MFA factor requirement when, and only when, the backend validates the signed Supabase JWT and its assurance claims against an explicit PRODX trust policy.

Required enforcement conditions:
- Validate signature/JWKS, issuer, audience, subject, expiry, and the exact supported assurance claims on the server.
- Require `aal2` and an explicitly allowlisted `amr` combination; reject missing, malformed, unknown, or contradictory assurance claims.
- Bind the accepted assurance result to the verified token and authenticated identity; never accept browser/client-supplied AAL, AMR, or “MFA complete” flags.
- Map the verified result into a PRODX-owned assurance contract and persist its provenance on the POS session (method, assurance level, authenticated-at, auth transaction, and policy version).
- PRODX remains authoritative for effective POS policy, session issuance, role/store authorization, revocation, and step-up requirements. A valid Supabase AAL2 result does not grant POS permissions by itself.
- If the assurance evidence fails validation or does not meet the allowlist, treat Supabase authentication as first-factor-only and continue through the PRODX pre-authentication flow; do not issue a full POS session.
- PRODX-owned TOTP remains the fallback factor. Passkeys/WebAuthn may be added later as an optional PRODX factor after separate design and implementation review; they are not required by this D1 decision.

**D2 is also approved:** challenge TTL 5 minutes, maximum 5 attempts per challenge, Supabase MFA freshness 5 minutes, TOTP current time step ±1, and cross-challenge TOTP replay rejection. D3–D7 remain pending: backup codes, recovery restrictions, role coverage, offline behavior, and audit retention/notification policy.

## 8. Gate decision

**HOLD — DESIGN REVIEW ONLY.**

Next implementation must:
1. Reconcile shared auth/session PRs onto current main.
2. Approve the remaining D2–D7 decisions in the MFA Security Design V2 (D1 is approved; see above).
3. Implement pre-authentication and session assurance before factor UI.
4. Add database state transitions, RLS, fixed functions, and audit events.
5. Add the security test matrix and run exact-head PostgreSQL 16 CI.

No production authentication behavior or database schema was changed by this review.


## 8. Approved Decision Record — D2 (2026-11-09)

**Status: APPROVED**

- Challenge TTL: 5 minutes from server-side creation.
- Maximum verification attempts: 5 per challenge, atomically enforced; attempt 6 is rejected.
- Supabase MFA freshness: accepted AMR factor timestamp must be no older than 5 minutes at new POS session issuance. Missing, malformed, stale, or invalid timestamps fail closed.
- TOTP time window: current server time step ±1 step.
- Replay: a TOTP time step accepted once for a factor cannot be accepted again on another challenge; enforce across concurrent requests with an atomic durable database transition.
- MFA attempts are independent from the existing password failed-attempt and lockout counter.

Required regression coverage includes expiry, attempt boundary, stale Supabase factor timestamp, TOTP drift, replay across challenges, and concurrent verification. D3–D7 remain pending; no production implementation is authorized by D1/D2 alone.
