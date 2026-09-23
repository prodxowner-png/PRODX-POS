# PRODX AI Capability Boundary

## Current status — 2026-09-24

Production application AI is Gemini-only and is exposed through POST /api/v1/ai/chat. The browser never calls Gemini directly and never holds the provider credential.

AI capabilities are assistive only and require the authenticated ai:use permission.

Allowed capability classes:
- assistant
- explanation
- draft

Authoritative POS facts remain owned by the backend/domain layer. AI must not become the source of truth for financial totals, VAT, inventory, payments, refunds, authorization, or audit data.

## Authorization

ai:use is registered by migration 0018. The migration does not grant it to a default role. Tenant administrators must grant it through an organization-owned role and store-scoped user-role assignment.
