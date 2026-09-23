# PRODX POS — Current Repository State

**Verified:** 2026-09-24
**Repository:** prodxowner-png/PRODX-POS
**Branch:** chore/bootstrap-pr150-ai-gates
**Exact HEAD:** b76001ca8ff6ec85e45a7834e9b3b63854ad5d3b
**PR:** #151, open

## Source of truth

Repository code, tests, migrations, workflow results, and current configuration take precedence over historical documents, PR descriptions, Notion notes, and memory.

## Current production path

Browser -> authenticated production backend -> PostgreSQL-backed session/authentication -> organization/store authorization -> application service -> domain/repository boundaries.

AI path:

Browser -> POST /api/v1/ai/chat -> verified session -> ai:use -> AI Gateway -> Gemini Provider -> Gemini API.

AI is assistive only. Transactional truth for money, VAT, inventory, payment, refund, authorization, and audit remains in authoritative PRODX services/database.

## Current provider policy

- Production application AI provider: Gemini only.
- CI engineering-review provider: Gemini through the pinned Antigravity CLI.
- OKMD, OpenRouter, and OpenAI are historical provider references, not current production fallbacks.
- No provider fallback may bypass production security or correctness gates.

## Current exact-head CI evidence

PASS:
- backend/typecheck/PostgreSQL/build/security validation
- PostgreSQL transaction integrity
- PostgreSQL device/session invariants
- auth-security
- retired-provider drift check

NOT CLEAR:
- Gemini hosted review: real execution attempted, but no valid structured verdict was produced.
- Gemini autonomous lane: direct Gemini API smoke returned HTTP 429 RESOURCE_EXHAUSTED for the configured Free Tier quota; no successful Antigravity provider smoke was obtained.

## Remaining release blockers

1. Genuine successful Gemini/Antigravity execution and structured review evidence for the exact final HEAD.
2. Runtime tenant provisioning evidence showing a real organization/store role receives ai:use and reaches the production route.
3. Final production-readiness gate evidence after the external provider/runtime blocker is cleared.

## Documentation rule

Historical milestone and audit documents may preserve the state that was true when they were written. When a statement conflicts with this current-state document or repository evidence, the historical statement must be read as historical, not current implementation status.
