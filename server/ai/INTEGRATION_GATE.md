# AI Integration Gate

## Current production gate

- Authenticated backend only.
- Verified user/organization/store scope.
- ai:use permission required before provider execution.
- Provider credentials remain server-side.
- Production route: POST /api/v1/ai/chat.
- Gemini is the only production application provider.
- Provider failures are classified safely, bounded retries are used only for transient classes, and provider failures are auditable.
- Caller-supplied system content is untrusted data; gateway-owned policy remains authoritative.
- Server-owned Gemini model allowlist is enforced.

## Evidence status

Deterministic exact-head CI is passing on b76001ca8ff6ec85e45a7834e9b3b63854ad5d3b. Runtime tenant provisioning for ai:use and genuine successful Gemini/Antigravity execution remain release blockers.
