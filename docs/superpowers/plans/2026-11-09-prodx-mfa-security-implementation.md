# PRODX POS MFA Security Implementation Plan

> **For agentic workers:** Execute task-by-task using the PRODX workflow. Do not bypass security, database, architecture, migration-governance, or production gates.

**Goal:** Extend the existing PRODX POS authentication/session architecture with server-authoritative MFA, enrollment, recovery, auditability, and POS-safe session assurance without creating a parallel session system.

**Architecture:** Reconcile the shared authentication changes on current main first. Then extend the existing SessionIssuer, PostgreSQL authentication repository, `prodx_sessions`, and security-audit function boundary with a pre-authentication transaction and factor state. PostgreSQL remains the durable authority; Redis is supplemental for rate limits only.

**Tech Stack:** TypeScript, Node.js, Express, PostgreSQL, existing `pg` repository adapter, existing migration runner and governance checker, Node test runner, existing CI PostgreSQL 16 service.

**Spec:** `docs/security/PRODX-POS-MFA-Security-Design-V2.md` (companion design artifact; add to repository before implementation begins).

## Global Constraints

- Existing session token hashes remain hash-only in PostgreSQL.
- Backend owns MFA policy, challenge consumption, factor state, session assurance, tenant/store scope, and authorization.
- Existing password lockout policy (5 consecutive failures / 15 minutes) is not silently changed.
- No raw password, PIN, OTP, TOTP secret, backup code, access token, refresh token, or private key may enter logs or audit payloads.
- PostgreSQL is authoritative for durable security state; Redis locks are not the sole replay/concurrency control.
- Existing migrations are immutable; new migration IDs must follow the current integrated migration-governance manifest.
- D1 is approved: accept server-verified Supabase `aal2` only with an explicit allowlisted `amr` mapping; otherwise continue PRODX pre-authentication and require a PRODX-owned factor. PRODX remains authoritative for POS session assurance and authorization.
- D2–D7 remain pending; no production behavior changes until those decisions and release approval are recorded.
- Shared POS device identity, employee identity, login MFA, and manager transaction approval remain separate.
- Offline mode cannot create a new MFA-required authenticated session.

## Review Focus

- Concurrent login/verification attempts must never create two full sessions from one challenge.
- The same TOTP time step must not be accepted twice for the same factor, even across different challenges.
- Supabase JWT authentication must not bypass the effective PRODX MFA policy.
- Recovery must never yield full POS privileges before the required new factor is enrolled.
- Shared-terminal user switching and offline reconnect must not reuse another employee's assurance or stale session.

---

## Task 0: Reconcile authentication dependencies

**Files:**
- Review only: `server/auth/session.ts`
- Review only: `server/http/auth-route.ts`
- Review only: `server/auth/postgres-repository.ts`
- Review only: `db/migrations/manifest.json`
- Review PRs: #346, #344, #331, #303, #291, and their shared-base dependencies.

**Interfaces:**
- Consumes: current-main auth/session contract and verified PR dependency state.
- Produces: one agreed current-main authentication contract; no MFA code yet.

- [ ] Identify which auth PR changes are required and port only those changes onto current main.
- [ ] Reconcile migration ordering against the actual merged #340/#342 dependency stack.
- [ ] Verify one source of truth for Supabase identity verification and POS session renewal.
- [ ] Confirm exact current-main commit and CI before beginning MFA implementation.

**Exit:** Shared auth/session contract is consolidated; no MFA branch is based on historical PR heads.

## Task 1: Add pre-authentication transaction domain

**Files:**
- Modify: `server/auth/session.ts`
- Modify: `server/auth/postgres-repository.ts`
- Create: `server/auth/pre-authentication.test.ts`
- Create: `server/auth/postgres-pre-auth.integration.test.ts`

**Interfaces:**
- Produces `beginAuthentication(input): Promise<PreAuthResult | AuthenticatedSessionResult>`.
- Produces `completeAuthentication(input): Promise<AuthenticatedSessionResult | null>`.
- Produces `PreAuthResult = { transactionHandle: string; expiresAt: Date; allowedFactors: FactorType[] }`.

- [ ] Add failing unit tests proving MFA-required credentials return only a pre-auth handle and never a full session.
- [ ] Add failing tests proving a client-supplied MFA bypass flag is ignored.
- [ ] Implement transaction binding to user, organization, device, purpose, policy version, and expiry.
- [ ] Add PostgreSQL persistence and single-use state transition using the established fixed-function repository boundary.
- [ ] Add concurrent completion integration test; exactly one request may complete the transaction.

**Exit:** First-factor success cannot issue a full session when effective policy requires MFA.

## Task 2: Add MFA policy and factor persistence

**Files:**
- Create migration: next approved unique ID after migration-stack reconciliation.
- Modify: `server/auth/postgres-repository.ts`
- Create: `server/auth/mfa-policy.ts`
- Create: `server/auth/mfa-policy.test.ts`
- Create: `server/auth/mfa-factor.test.ts`

**Interfaces:**
- Produces `resolveMfaPolicy({ userId, organizationId, storeId, roleKey }): Promise<EffectiveMfaPolicy>`.
- Produces factor lifecycle methods for pending, active, and revoked states.

- [ ] Add tests for organization/store/role policy precedence and fail-closed conflicts.
- [ ] Add tables with organization scope, required constraints, indexes, RLS, and narrow grants.
- [ ] Add fixed-purpose SECURITY DEFINER functions for pre-auth/factor state access.
- [ ] Add encrypted TOTP secret persistence using KMS envelope-encryption interface.
- [ ] Add WebAuthn credential persistence only if D1 approves Passkeys.
- [ ] Verify new tables are covered by RLS and migration governance.

**Exit:** Policy and factor state are server-authoritative and tenant-safe.

## Task 3: Implement TOTP verification and replay protection

**Files:**
- Create: `server/auth/totp.ts`
- Create: `server/auth/totp.test.ts`
- Modify: `server/auth/postgres-repository.ts`
- Create: `server/auth/totp-postgres.integration.test.ts`

**Interfaces:**
- Produces `verifyAndConsumeTotp({ factorId, challengeId, submittedCode, now }): Promise<boolean>`.

- [ ] Test valid/invalid codes, expiry windows, clock drift bounds, and secret-decryption failure.
- [ ] Test replay of the same accepted time step across different challenges.
- [ ] Implement a vetted TOTP verifier with server time and approved time-step window.
- [ ] Atomically advance `last_used_timestep`; require exactly one affected row.
- [ ] Consume challenge, TOTP time step, create session, complete auth transaction, and append audit evidence within a consistent database transaction.
- [ ] Test 2+ concurrent requests using the same TOTP time step; at most one succeeds.

**Exit:** Challenge replay and TOTP time-step replay are independently prevented.

## Task 4: Implement WebAuthn/passkeys if approved

**Files:**
- Create: `server/auth/webauthn.ts`
- Create: `server/auth/webauthn.test.ts`
- Modify: `server/auth/postgres-repository.ts`

**Interfaces:**
- Produces registration and authentication ceremony methods with strict typed inputs/results.

- [ ] Validate challenge, origin, RP ID, credential binding, user-presence/user-verification policy, expiry, and one-time use.
- [ ] Reject malformed, wrong-origin, wrong-RP-ID, wrong-purpose, and replayed ceremonies.
- [ ] Persist only public credential material and safe metadata.
- [ ] Add concurrency and cross-account credential-binding tests.

**Exit:** Passkey support is complete only if D1 approves it; otherwise this task remains explicitly out of scope.

## Task 5: Implement enrollment and recovery

**Files:**
- Modify: `server/http/auth-route.ts`
- Modify: `server/auth/session.ts`
- Create: `server/auth/mfa-recovery.test.ts`
- Create: `server/http/auth-mfa-route.test.ts`
- Modify: MFA repository and migrations from Task 2.

**Interfaces:**
- Enrollment requires recent re-authentication and proof of possession.
- Recovery creates `RECOVERY_RESTRICTED` assurance, not a full session.

- [ ] Test enrollment cannot activate before proof verification.
- [ ] Test pending enrollment expiry leaves factor inactive.
- [ ] If D3 approves backup codes, test high entropy, one-time display contract, atomic consume, and set regeneration invalidation.
- [ ] Test recovery cannot call checkout, refund, cash management, RBAC, or other privileged operations.
- [ ] Revoke the lost factor and affected sessions according to D4.
- [ ] Require new factor enrollment before normal assurance is issued.
- [ ] Persist audit/outbox events atomically with every security state transition.

**Exit:** Enrollment and recovery are complete, auditable, and cannot bypass full MFA.

## Task 6: Integrate every login entry point and session assurance

**Files:**
- Modify: `server/http/auth-route.ts`
- Modify: `server/auth/session.ts`
- Modify: `server/auth/postgres-repository.ts`
- Modify: existing session migration through a new forward migration only.
- Modify: frontend auth adapters and context only after backend contract tests pass.

**Interfaces:**
- Session records carry approved assurance level, auth transaction reference, authentication method, authenticated-at, and policy version.
- All auth responses carrying tokens or pre-auth handles set `Cache-Control: no-store`.

- [ ] Add route tests for `/auth/login`, `/auth/admin/login`, `/auth/supabase/session`, and `/auth/supabase/bootstrap`.
- [ ] Extend Supabase JWT verification to return typed, verified assurance claims (`aal`, `amr`) only after signature/issuer/audience/subject/expiry validation.
- [ ] Enforce the approved D1 allowlist for `aal2` + approved `amr`; reject unknown or contradictory claims and ignore all client-supplied assurance flags.
- [ ] Map accepted Supabase assurance into PRODX-owned session provenance and policy version; otherwise require the PRODX pre-authentication flow.
- [ ] Define and test first-tenant bootstrap enrollment policy to avoid a bootstrap deadlock or reusable bypass.
- [ ] Verify pre-auth handles cannot call protected API routes.
- [ ] Rotate/create a new POS session only after all required factors succeed.
- [ ] Test session revocation, expiry, role/store scope, and assurance requirements on every protected boundary.

**Exit:** No login path can bypass the effective MFA policy.

## Task 7: POS shared-terminal and offline controls

**Files:**
- Modify: POS auth/session lifecycle modules.
- Create: `server/auth/shared-terminal-mfa.integration.test.ts`
- Create: `server/auth/offline-session-mfa.test.ts`
- Modify: offline sync authorization only where the approved policy requires it.

- [ ] Test cashier A logout followed by cashier B login on the same device; no session/assurance/local secret is inherited.
- [ ] Test device trust never substitutes for employee authentication.
- [ ] Test manager approval remains bound to action/order/store/requester and is not treated as login MFA.
- [ ] Test offline mode cannot create a new MFA-required authenticated session.
- [ ] Test offline continuation is time/device/user/store bounded and re-checks revocation on reconnect.

**Exit:** Shared terminal and offline behavior match approved D5/D6 policy.

## Task 8: Security verification and rollout gate

**Files:**
- Modify: relevant unit/integration tests.
- Modify: CI workflow only if required to run the approved tests.
- Create: security verification evidence report.

- [ ] Run frontend lint/typecheck and backend typecheck.
- [ ] Run full server test suite.
- [ ] Run PostgreSQL 16 migrations on a disposable database.
- [ ] Run PostgreSQL integration tests, concurrency/replay tests, migration governance, and migration idempotency.
- [ ] Run secret-scanning/log-redaction tests.
- [ ] Run independent security review on exact PR HEAD.
- [ ] Keep feature flag disabled by default until all gates pass.
- [ ] Stage rollout in a test organization/store and validate rollback.

**Exit:** Implementation Gate can be considered for approval only with exact-head evidence and explicit Product/Security release approval.

---

## Non-negotiable hold points

- No implementation on historical auth PR branches.
- No direct INSERT grant for `prodx_app` on `prodx_security_audit_events`.
- No migration ID chosen before migration-stack reconciliation.
- No Production MFA enforcement before D1–D7 approval.
- No full session before required MFA.
- No client-side MFA bypass, factor status, role, or assurance authority.
