# PRODX AI — Production Boundary

## Current architecture

The active production application AI provider is Google Gemini only. Historical OKMD/OpenRouter/OpenAI references are legacy audit history and are not current production provider architecture.

Production request flow:

Browser -> POST /api/v1/ai/chat -> authentication/session -> ai:use RBAC -> AI Gateway -> Gemini Provider -> Gemini API

The browser never receives or stores the Gemini provider credential. The backend owns provider selection, credential custody, authorization, redaction, request limits, audit logging, safe provider errors, bounded transient retries, and the server-owned model allowlist.

## AI code-review lane

The canonical CI review lane also uses Gemini through the pinned Antigravity CLI. It reviews the exact PR head using a sanitized diff and publishes a structured result only when genuine provider execution succeeds.

Current exact-head evidence at b76001ca8ff6ec85e45a7834e9b3b63854ad5d3b: deterministic repository gates pass, but the Gemini hosted review/autonomous provider lane is blocked by quota/runtime evidence. No structured Gemini verdict is claimed.

## Authorization

ai:use is registered by migration 0018. It is not implicitly granted by role name and is not granted by the migration. Tenant-owned RBAC administration must explicitly grant the permission to an organization-owned role and assign that role within organization/store scope.

## Verification

Provider unit tests use mocked implementations and do not claim real provider availability. Exact-head runtime evidence must be obtained separately.

Standard checks:

```bash
npm run lint
npm run server:check
npm run server:test
npm run build
```
