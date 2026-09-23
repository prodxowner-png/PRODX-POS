# Production Blockers — Issue #152

Exact HEAD reviewed: `40110747bb65ff648f0a84a07e32e473b94b823c`

Status: HOLD / NOT PRODUCTION READY

Observed root causes:
- Browser AI requests do not send the session Bearer token, while the production entrypoint authenticates AI HTTP requests from `Authorization: Bearer`.
- `ai:use` is registered by migration 0018 but no role grant is provisioned.
- Production Quality Gate still checks `SELECT count(*) = 15 FROM prodx_permissions`, which is not a failing assertion and is stale after migration 0018.
- Provider failures occur before the gateway success audit.
- Gemini provider errors are only generic status errors and there is no bounded provider retry/backoff.
- Gateway conversation normalization turns assistant history into user content.
- Backend accepts arbitrary Gemini model identifiers matching the Gemini prefix rather than a server-owned allowlist.

Acceptance evidence required before closing:
1. Authenticated browser → backend AI route regression coverage.
2. Explicit `ai:use` RBAC provisioning policy and DB evidence.
3. Fail-closed permission invariant in CI with `ai:use` existence assertion.
4. Audit coverage for denied, successful, timeout, 429, and provider-failure outcomes.
5. Typed safe Gemini errors and bounded jittered retries only for transient classes; no non-Gemini fallback.
6. Correct multi-turn role preservation with caller system text treated as untrusted context.
7. Server-authoritative Gemini model allowlist.
8. Exact-head targeted tests, full required CI, and renewed Gemini runtime evidence.
