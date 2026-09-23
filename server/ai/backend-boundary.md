# AI Backend Integration Boundary

The production AI path is implemented in the repository and is no longer a future/external HTTP adapter.

## Required request flow

Authenticated backend request
  -> verified user/org/store context
  -> ai:use authorization
  -> AI Gateway
  -> Gemini Provider
  -> Gemini API

The gateway rejects requests without verified identity, organization/store scope, or the required ai:use permission before provider execution.

Browser-supplied identity, organization, store, or permission fields are never treated as authentication evidence. Provider credentials remain server-side.

The route is POST /api/v1/ai/chat; unauthenticated requests are rejected.

## Current verification

Exact-head deterministic CI passes on b76001ca8ff6ec85e45a7834e9b3b63854ad5d3b. Genuine Gemini provider runtime success and tenant ai:use provisioning evidence remain outstanding.
