## Reverification after documentation updates — 2026-09-24

Current exact HEAD is 13d154b795b36fcceb5ccc54a8cdb599d358edb2. The deterministic workflows for this documentation-updated HEAD are currently queued/pending, so prior PASS evidence from b76001ca8ff6ec85e45a7834e9b3b63854ad5d3b is historical evidence and is not claimed for the current HEAD. Gemini hosted review and autonomous Gemini runs are also queued.

# AI Integration Review

## Current review focus

1. Authentication provenance and bearer propagation.
2. Organization/store scope from the verified backend principal.
3. ai:use enforcement before Gemini execution.
4. Provider-secret isolation.
5. Gemini-only provider registry and server-owned model allowlist.
6. Safe typed provider errors, bounded transient retry/backoff, and provider-failure auditability.
7. Conversation role preservation while treating caller system content as untrusted context.
8. No unauthenticated AI route and no non-Gemini fallback.

## Current verification

Fresh deterministic CI for exact HEAD b76001ca8ff6ec85e45a7834e9b3b63854ad5d3b is passing. External Gemini quota/runtime verification remains unsatisfied.
