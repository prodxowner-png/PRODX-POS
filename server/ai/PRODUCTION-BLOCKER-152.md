# Production Blockers — Issue #152

Latest exact HEAD reviewed: `405517445c0f1792df8c4396dd6c5588969dedfe`

Status: HOLD / NOT PRODUCTION READY

Observed root causes:
- Browser AI Bearer propagation is fixed and covered by tests.
- `ai:use` is registered by migration 0018 but intentionally has no default role grant; RBAC docs now explicitly define tenant-owned role provisioning and store-scoped assignment as the required production policy.
- Production Quality Gate was changed to fail closed at 16 canonical permissions and explicitly require `ai:use`, but the first exact-head run exposed an invalid PostgreSQL dollar-quote in the gate script; that CI defect was fixed on the latest head.
- Provider failures are now audited with typed Gemini failure classes.
- Gemini provider errors now use bounded jittered retry/backoff for transient classes only.
- Gateway conversation normalization preserves assistant/model turns and treats caller system content as untrusted context.
- Backend now enforces a server-owned Gemini model allowlist.

Acceptance evidence required before closing:
1. Authenticated browser → backend AI route regression coverage. **Implemented/tested.**
2. Explicit `ai:use` RBAC provisioning policy and DB evidence. **Policy documented; runtime tenant provisioning evidence remains required.**
3. Fail-closed permission invariant in CI with `ai:use` existence assertion. **Implemented; first fresh run found and fixed a PostgreSQL dollar-quote defect in the gate script.**
4. Audit coverage for denied, successful, timeout, 429, and provider-failure outcomes. **Targeted provider-failure audit coverage implemented; full exact-head outcome matrix remains to verify.**
5. Typed safe Gemini errors and bounded jittered retries only for transient classes; no non-Gemini fallback. **Implemented.**
6. Correct multi-turn role preservation with caller system text treated as untrusted context. **Implemented/tested.**
7. Server-authoritative Gemini model allowlist. **Implemented/tested.**
8. Exact-head targeted tests, full required CI, and renewed Gemini runtime evidence. **Still required after latest CI correction.**
