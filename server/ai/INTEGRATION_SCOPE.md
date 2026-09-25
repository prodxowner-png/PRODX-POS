# AI Integration Scope

This repository now contains the production AI HTTP adapter as well as the application/domain boundary.

## Included

- POST /api/v1/ai/chat
- Backend authentication and ai:use authorization
- Tenant/store scoping from the verified principal
- Gemini-only provider registry
- Provider error classification, bounded retries, audit logging, and model allowlist
- Authenticated route integration tests

## Not a source of truth

AI output never becomes authoritative transaction, inventory, payment, refund, authorization, or audit state.
