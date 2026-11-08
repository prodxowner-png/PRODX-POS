# PRODX POS — MFA Security Design V2

**Status:** Proposed design; Product/Security approval required before production enforcement.  
**Source:** POS Production Development Specification V2 and repository review at main `c3329c99cf0d0c8095ad9d732a3cfca5a23d69ec`.

## 1. Decision summary

Extend the existing authentication/session architecture. Do not create a parallel session issuer or session table.

- Backend resolves effective MFA policy; client cannot waive it.
- First-factor success creates a restricted pre-authentication transaction when MFA is required.
- PostgreSQL is the durable authority for challenge, factor, recovery-code, and session transitions.
- Redis is supplemental for rate limits and ephemeral coordination, not the sole replay/concurrency control.
- TOTP secrets are envelope-encrypted; backup codes are stored as keyed/salted hashes.
- TOTP time-step replay protection is independent from challenge replay protection.
- Recovery creates a restricted recovery session until a new factor is enrolled.
- Device identity, employee identity, login MFA, and manager transaction approval remain separate.
- Offline mode cannot create a new MFA-required session.

**Gate:** HOLD — design ready for review; implementation and production enforcement remain blocked pending D1–D7 approval and exact-head verification.

## 2. Trust and authority boundaries

1. Client state is never authoritative for MFA policy, factor status, challenge consumption, recovery, assurance, role, or store scope.
2. PostgreSQL owns durable state transitions.
3. Fixed-purpose `SECURITY DEFINER` functions with fixed `search_path` mediate pre-authentication state and audit writes.
4. KMS/HSM-backed envelope encryption protects recoverable TOTP secrets.
5. Security notifications use a transactional outbox.
6. Device authentication does not authenticate the employee using the device.

## 3. State model

### Login transaction

`CREDENTIALS_PENDING → MFA_PENDING → AUTHENTICATED`

Failure transitions: `REJECTED`, `LOCKED`, `EXPIRED`. Approved recovery transitions: `RECOVERY_PENDING → RECOVERY_RESTRICTED → NEW_FACTOR_REQUIRED → AUTHENTICATED`.

Invariants:
- No full session before all required factors pass.
- Challenge bound to user, organization, device context, purpose, auth transaction, policy version, and expiry.
- Challenge is single-use.
- TOTP accepted time step is single-use per factor.
- A failed/expired transaction cannot be promoted to authenticated state.

### Enrollment

`NOT_ENROLLED → REAUTH_REQUIRED → ENROLLMENT_PENDING → ACTIVE`

Invalid proof does not activate a factor. Expired pending enrollment is discarded. Factor replacement/revocation is step-up protected and audited.

### Recovery

`RECOVERY_REQUESTED → RECOVERY_PROOF_PENDING → RECOVERY_RESTRICTED → OLD_FACTOR_REVOKED → SESSIONS_REVOKED → NEW_FACTOR_REQUIRED → RECOVERY_COMPLETED`

Recovery never grants full business access before the required factor is enrolled. Recovery permissions are limited to security settings and factor enrollment.

## 4. Cryptographic storage

| Material | Storage |
|---|---|
| TOTP shared secret | Envelope-encrypted ciphertext, nonce/tag, key version |
| WebAuthn credential | Credential ID, public key, safe metadata |
| Backup code | Keyed/salted hash only |
| Opaque pre-auth/challenge handle | Hash of high-entropy random token |
| POS bearer token | Existing hash-only session persistence |
| Submitted OTP/proof | Memory only; never persist or log |

TOTP secrets cannot be one-way hashed because the verifier must calculate expected codes. Restrict decrypt permissions to the authentication service identity. Never log passwords, PINs, OTPs, TOTP secrets, backup codes, bearer tokens, refresh tokens, or private keys.

### TOTP replay

- Verify using trusted server time and an approved narrow time-step window.
- Store `last_used_timestep` per factor.
- Reject a step less than or equal to the last consumed step.
- Advance the step with a conditional atomic update requiring exactly one affected row.
- Consume the pre-auth challenge and create the full session in a transactionally consistent operation.

### WebAuthn/passkeys

If approved, validate challenge, origin, RP ID, credential binding, ceremony purpose, expiry, and approved user-presence/user-verification policy server-side. Do not treat client-supplied “verified” flags as proof.

## 5. PostgreSQL logical model

Extend existing `prodx_sessions` and audit architecture; add new tables only through forward migrations after migration-stack reconciliation.

### `mfa_policy`

Logical fields: `id`, `organization_id`, nullable `store_id`, nullable `role_key`, `required`, `allowed_factor_types`, `challenge_ttl_seconds`, `max_attempts`, `policy_version`, `effective_at`, timestamps.

Policy precedence must be deterministic. Conflicting or invalid policy fails closed for privileged roles.

### `mfa_factors`

Logical fields: `id`, `user_id`, `organization_id`, `factor_type`, `status`, encrypted TOTP fields, WebAuthn public credential fields, `last_used_timestep`, lifecycle timestamps.

Constraints enforce factor-type-specific columns, unique WebAuthn credential IDs, and no authentication by revoked factors.

### `mfa_challenges`

Logical fields: `id`, unique `token_hash`, `user_id`, `organization_id`, `login_transaction_id`, `purpose`, `status`, `attempt_count`, `expires_at`, `consumed_at`, `created_at`.

### `mfa_recovery_codes`

Logical fields: `id`, `user_id`, `organization_id`, `code_hash`, `set_id`, `status`, lifecycle timestamps. Regeneration invalidates the previous set atomically.

### `auth_transactions`

Logical fields: `id`, `user_id`, `organization_id`, `device_id`, `status`, `assurance_level`, `policy_version`, `expires_at`, timestamps.

### Existing `prodx_sessions`

Add approved provenance fields such as `assurance_level`, `auth_transaction_id`, `authenticated_at`, `authentication_method`, and `policy_version`. Preserve token hash, expiry, revocation, device binding, tenant scope, and existing session lifecycle.

### RLS and grants

Every new table must have explicit organization/store scope, constraints, indexes, RLS policies, and narrow grants. The runtime role must not receive direct INSERT/UPDATE/DELETE access to `prodx_security_audit_events`; use fixed-purpose database functions.

## 6. Transaction boundaries

Successful MFA login must transactionally couple:
1. Challenge transition PENDING → CONSUMED.
2. Factor proof consumption (including TOTP step or WebAuthn challenge).
3. Session issuance record.
4. Authentication transaction transition to AUTHENTICATED.
5. Durable audit/outbox event.

If any required durable step fails, no usable full session is returned.

Recovery success must transactionally couple recovery-proof consumption, restricted recovery state, required factor/session revocation records, restricted session issuance, and audit/outbox evidence.

If the session store is external, use a durable idempotent issuance intent keyed by auth transaction ID and reconcile incomplete intents. Never return a bearer before durable issuance is confirmed.

## 7. Backend API proposal

- `POST /v1/auth/login` — first factor; returns full session only when MFA is not required, otherwise a restricted transaction handle.
- `POST /v1/auth/mfa/verify` — verifies and consumes proof; issues a new session only after commit.
- `POST /v1/me/mfa/enrollments` — recent re-authentication; creates pending enrollment.
- `POST /v1/me/mfa/enrollments/{id}/verify` — proof of possession; activates factor.
- `GET /v1/me/mfa/factors` — safe metadata only.
- `DELETE /v1/me/mfa/factors/{id}` — step-up protected.
- `POST /v1/auth/mfa/recovery` and `/verify` — approved recovery proof; restricted session only.
- `POST /v1/me/mfa/recovery-codes/regenerate` — step-up protected; invalidates old set.
- `GET/PUT /v1/admin/security/mfa-policy` — privileged, step-up protected, scoped, versioned, audited.

Every auth response carrying a token or pre-auth handle must set `Cache-Control: no-store`.

## 8. Session assurance and POS behavior

| Assurance | Meaning | Access |
|---|---|---|
| `PASSWORD` | First factor; MFA not required by effective policy | Normal access only if policy permits |
| `MFA` | Required MFA completed | Existing RBAC/store-scoped access |
| `RECOVERY_RESTRICTED` | Recovery proof accepted; factor enrollment incomplete | Security recovery endpoints only |
| `STEP_UP` | Recent proof bound to one risky action | Only the bound operation |

Shared POS terminal rules:
- Device identity and employee identity are independent.
- User switch/logout revokes employee session and clears local sensitive state.
- New employee cannot inherit prior employee assurance.
- Manager approval remains bound to a specific action/order/store/requester and is not login MFA.

Offline proposal:
- New MFA-required login, enrollment, factor replacement, recovery, and policy changes are online-only.
- Offline continuation may use only a previously issued, bounded, device/user/store-bound authorization.
- No new full session is created offline.
- High-risk operations remain denied unless separately approved by offline risk policy.
- Reconnect checks revocation before restoring online privileges.

## 9. Audit catalog

Add allowlisted events as appropriate:
`MFA_CHALLENGE_CREATED`, `MFA_CHALLENGE_EXPIRED`, `MFA_VERIFICATION_FAILED`, `MFA_VERIFICATION_SUCCEEDED`, `MFA_ENROLLMENT_STARTED`, `MFA_ENROLLMENT_SUCCEEDED`, `MFA_ENROLLMENT_FAILED`, `MFA_FACTOR_REVOKED`, `MFA_FACTOR_REPLACED`, `MFA_FACTOR_DISABLED`, `MFA_BACKUP_CODES_GENERATED`, `MFA_BACKUP_CODE_USED`, `MFA_RECOVERY_STARTED`, `MFA_RECOVERY_SUCCEEDED`, `MFA_RECOVERY_FAILED`, `MFA_RECOVERY_APPROVED`, `MFA_RECOVERY_REJECTED`, `MFA_LOCKOUT_APPLIED`, `MFA_POLICY_CHANGED`.

Payloads contain actor/subject, tenant/store, device/session/auth transaction reference, correlation ID, server timestamp, outcome, reason code, and policy version. Never include submitted proofs or secrets. Use append-only database functions and transactional outbox semantics.

## 10. Acceptance criteria

1. MFA-required accounts receive no full session before successful MFA.
2. Backend resolves policy; client cannot waive it.
3. Challenges bind to account, tenant, device, purpose, transaction, policy version, and expiry.
4. Expired, consumed, revoked, or replayed challenges are rejected.
5. Concurrent requests cannot consume one challenge twice.
6. TOTP time steps cannot be replayed across different challenges for the same factor.
7. Retry limits are server-side and separate from password lockout.
8. Factor enrollment requires recent re-authentication and proof of possession.
9. Recovery produces restricted assurance until new factor enrollment completes.
10. Session identifier/token is newly issued after MFA.
11. Challenge/proof consumption, session issuance, auth transaction completion, and audit are transactionally consistent.
12. Supabase authentication cannot bypass the effective PRODX MFA policy.
13. Bootstrap has an explicit safe enrollment policy.
14. Shared-terminal user switching cannot reuse previous assurance.
15. Offline mode cannot create a new MFA-required session.
16. All auth responses containing tokens/handles are no-store.
17. RLS, grants, secret redaction, audit completeness, expiry, replay, concurrency, and cross-store tests pass.

## 11. Decisions required — D1–D7

- **D1 Factor strategy:** TOTP, passkeys, or both; role enrollment scope; Supabase MFA delegation or PRODX-owned MFA.
- **D2 Challenge policy:** APPROVED — challenge TTL 5 minutes; maximum 5 verification attempts per challenge; Supabase MFA freshness 5 minutes for new POS session issuance; TOTP accepts current time step ±1 step; reject TOTP time-step replay across all challenges for the same factor. MFA challenge counters remain distinct from password lockout.
- **D3 Backup codes:** enablement, quantity, storage, display, regeneration and invalidation.
- **D4 Recovery assurance:** identity proofing, approval, notifications, factor/session revocation, restricted session duration.
- **D5 Enforcement scope:** Owner/Admin, Manager, Cashier, organization/store overrides.
- **D6 Offline authentication:** max duration, operation allowlist, device/user/store binding, revocation reconciliation.
- **D7 Audit/notification assurance:** retention, tamper evidence, event completeness, notification retries and alerts.

No numeric proposal or role scope is production policy until explicitly approved.

## 12. Release gate

**HOLD** until:
- Shared auth/session PR changes are consolidated onto current main.
- D1–D7 are approved and versioned.
- Threat model covers phishing, replay, brute force, session fixation, recovery abuse, device theft, shared terminals, offline exposure, and cross-store access.
- Database migration, RLS, grants, and fixed functions are reviewed.
- Unit, PostgreSQL 16 integration, concurrency, replay, secret-scanning, migration-governance, and exact-head CI checks pass.
- Feature flag is off by default and staged rollout/rollback are verified.

This design does not authorize changing production authentication behavior.


## Approved Decision Record — D1 (2026-11-09)

**Status: APPROVED**

**Decision:** Use a hybrid factor strategy. A Supabase-authenticated identity may satisfy the PRODX POS MFA requirement only when the backend validates the signed JWT and accepts `aal2` together with an explicitly allowlisted `amr` combination. If claims are absent, malformed, unknown, contradictory, or fail verification, Supabase is treated as first-factor-only and the request must continue through the PRODX pre-authentication flow. Never trust client-supplied AAL/AMR/MFA-complete flags.

PRODX remains authoritative for effective POS MFA policy, session issuance, assurance provenance, permissions, tenant/store scope, revocation, and step-up authorization. The accepted Supabase assurance must be represented in the PRODX session contract and bound to the verified identity and authentication transaction. PRODX-owned TOTP remains the fallback factor. Passkeys/WebAuthn may be considered later as an optional factor under a separate reviewed decision; D1 does not require them.

D1 does not approve D2–D7. Challenge/retry policy, backup codes, recovery, role coverage, offline behavior, and audit retention/notifications remain pending. The production MFA implementation gate stays closed until those decisions and all required quality/security gates are complete.


## Approved Decision Record — D2 (2026-11-09)

**Status: APPROVED**

| Control | Approved policy |
|---|---|
| MFA challenge lifetime | 5 minutes from server-side creation |
| Verification attempts | Maximum 5 attempts per challenge; enforce atomically on the server |
| Supabase MFA freshness | The accepted AMR factor timestamp must be no older than 5 minutes when issuing a new POS session; missing, invalid, or stale timestamps fail closed |
| TOTP time-step window | Current time step ±1 step |
| TOTP replay | Reject a previously accepted time step for the same factor, including across different challenges and concurrent requests |

Implementation requirements:
- Challenge expiry and attempt consumption are server-authoritative and atomic; the sixth attempt is rejected.
- Challenge handles are single-use. Concurrent completion requests must yield at most one successful completion.
- Persist and atomically advance the factor's last accepted TOTP time step; an in-memory or Redis-only replay check is insufficient.
- Keep MFA challenge attempts separate from the existing password failed-attempt/lockout counter. D2 does not silently change the existing password lockout policy.
- Add tests for expiry boundary, attempt limit, stale Supabase AMR timestamp, ±1 TOTP drift, same-step replay across distinct challenges, and concurrent verification.

D2 does not approve D3–D7. Backup codes, recovery, role enforcement, offline behavior, and audit retention/notification policy remain pending. Production MFA implementation remains gated until all remaining decisions and quality/security gates are complete.
