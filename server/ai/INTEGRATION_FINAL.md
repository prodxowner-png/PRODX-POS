# AI Integration Final Boundary

## Current state — 2026-09-24

The former external/future-backend description is superseded. The repository now contains the production backend composition and authenticated AI route.

Current path:

Browser -> POST /api/v1/ai/chat -> verified session -> ai:use authorization -> AI Gateway -> Gemini Provider -> Gemini API

The route is not public: unauthenticated requests are rejected, and authenticated requests without ai:use are rejected. Provider credentials remain server-side.

AI remains assistive and the POS domain remains authoritative for financial, inventory, payment, refund, authorization, and audit state.
