# Production Blockers — Issue #152

Latest exact HEAD reviewed: b76001ca8ff6ec85e45a7834e9b3b63854ad5d3b

Status: HOLD / NOT PRODUCTION READY

## Resolved implementation defects

- Browser AI requests propagate the verified session bearer to POST /api/v1/ai/chat.
- Production Quality Gate fails closed at the current canonical permission count and explicitly asserts ai:use; the invalid PostgreSQL dollar-quote defect found in fresh CI was corrected at the current HEAD.
- Gemini provider failures are typed and safely mapped; transient retries are bounded and jittered.
- Provider failures create audit events.
- Gateway preserves assistant/model turns and treats caller system content as untrusted context.
- Gemini model selection is server-owned through an allowlist.
- Production AI route is wired and covered by authenticated integration tests.

## Fresh exact-head evidence

At b76001ca8ff6ec85e45a7834e9b3b63854ad5d3b, deterministic GitHub Actions checks observed are passing:
- backend/typecheck/PostgreSQL/build/security validation — PASS
- PostgreSQL transaction integrity — PASS
- PostgreSQL device/session invariants — PASS
- auth-security — PASS
- retired-provider drift check — PASS

The Gemini hosted review reached the real Antigravity/Gemini execution stage but did not produce a structured verdict. The autonomous Gemini lane reached direct API smoke and received HTTP 429 RESOURCE_EXHAUSTED on the configured Free Tier quota; Antigravity provider smoke did not produce a successful runtime result.

## Remaining acceptance evidence

1. Runtime tenant provisioning evidence for ai:use.
2. Genuine successful Gemini/Antigravity execution on the exact final HEAD.
3. Final production-readiness gate evidence after the provider lane is available.

No non-Gemini fallback, bypass, forced merge, or weakened gate is permitted.
