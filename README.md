## Reverification after documentation updates — 2026-09-24

Current exact HEAD is 13d154b795b36fcceb5ccc54a8cdb599d358edb2. The deterministic workflows for this documentation-updated HEAD are currently queued/pending, so prior PASS evidence from b76001ca8ff6ec85e45a7834e9b3b63854ad5d3b is historical evidence and is not claimed for the current HEAD. Gemini hosted review and autonomous Gemini runs are also queued.

# PRODX-POS

Production-oriented point-of-sale system with server-authoritative transaction, inventory, authentication, audit, and AI boundaries.

## Current production architecture

- Browser/client is never authoritative for identity, authorization, money, inventory, numbering, or final transaction state.
- PostgreSQL is the authoritative transactional store.
- Production HTTP backend is wired in the repository and authenticates requests from verified backend session context.
- Production AI path is POST /api/v1/ai/chat -> authentication/RBAC (ai:use) -> AI Gateway -> Gemini Provider -> Gemini API.
- Provider credentials remain server-side; no non-Gemini provider is a production fallback.
- AI is assistive only and never the source of truth for financial totals, VAT, inventory, payment, refund, authorization, or audit state.

## Verification status

Exact current-branch verification is recorded in repository CI and production-engineering documentation. Deterministic checks on the current head are passing, while genuine Gemini/Antigravity provider execution remains a release blocker. The repository is not currently declared Production Ready.

## Development

Changes are developed through pull requests and validated by repository CI gates before merging to main.

See docs/architecture/, docs/, and server/ai/ for the current architecture and gate evidence.
