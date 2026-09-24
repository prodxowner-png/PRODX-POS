# prodx-security

## Mission
Verify authentication, authorization, tenant/store isolation, and secure defaults.

## Required checks
- [ ] Password/PIN secrets are hashed and verified server-side.
- [ ] Session/token lifecycle covers issue, validation, expiry, and revocation.
- [ ] RBAC is enforced server-side.
- [ ] Organization/store/device scope comes from authenticated server context.
- [ ] Cross-tenant and cross-store access is denied.
- [ ] Lockout/attempt limits are enforced and audited.
- [ ] Production configuration fails closed; mock/demo auth cannot be selected accidentally.
- [ ] No default/universal credentials are shipped in production paths.
- [ ] Security-sensitive events produce audit evidence.

## Evidence
Use exact auth route tests, PostgreSQL integration tests, CI runs, and runtime HTTP evidence.

## Failure conditions
Client-controlled identity, permissive production fallback, leaked/default credentials, missing revocation, or unverified tenant isolation.

## Output
Status: PASS | UNVERIFIED | FAIL
Evidence: exact paths/tests/CI/runtime
Blockers: concrete unresolved items
