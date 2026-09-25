# PRODX-POS

Production-oriented point-of-sale system foundation with server-authoritative transaction, inventory, authentication, audit, and AI boundaries.

> **Current release gate: HOLD / NOT PRODUCTION READY.**
> Repository code and CI results are the source of truth. Current work is being validated through PR #151; a successful unit/test implementation does not by itself constitute production readiness.

## Engineering principles

- **Financial and inventory integrity** — money, VAT, payment, refund, stock, and transaction state remain server/database authoritative.
- **Security by default** — authentication, RBAC, credential custody, input validation, and audit controls are enforced at the backend boundary.
- **Auditability and idempotency** — business-critical effects must be traceable and safe under retries.
- **Offline resilience** — offline work follows an explicit persist → enqueue → send → receive → replay/complete/fail lifecycle with idempotency and conflict handling.
- **Server-authoritative business rules** — the browser is never the source of truth for authorization, monetary totals, inventory, numbering, or final transaction state.
- **PostgreSQL as transactional source of truth** — critical invariants, transaction boundaries, and migration safety are enforced at the database/application boundary.
- **Automated architecture, database, security, and production gates** — CI is treated as release evidence, not decoration.

## Current production architecture

### Core request path

```text
Browser
  ↓
Authenticated production backend
  ↓
Verified session / RBAC / organization-store scope
  ↓
Application service
  ↓
Domain + repository boundaries
  ↓
PostgreSQL
```

### Production AI path

```text
Browser
  ↓
POST /api/v1/ai/chat
  ↓
Verified session
  ↓
RBAC: ai:use
  ↓
AI Gateway
  ↓
Gemini Provider
  ↓
Gemini API
```

Production AI policy:

- **Gemini is the active production application provider.**
- Provider credentials remain server-side; the browser does not receive the Gemini credential.
- The gateway owns provider selection, authorization, limits, audit logging, safe provider errors, bounded transient retries, and the server-owned model allowlist.
- AI is assistive only. It is **not** authoritative for financial totals, VAT, inventory, payment, refund, authorization, or audit state.
- Historical provider references are retained only where needed for audit/history and are not production fallbacks.

## Authorization

The `ai:use` permission is registered by the RBAC migration but is not implicitly granted by a migration. Tenant-owned RBAC administration must explicitly grant it to an organization-owned role and assign that role within the applicable organization/store scope.

## Verification and release status

The repository distinguishes implementation evidence from runtime evidence:

- Unit and integration tests using mocks validate code behavior but do not prove external-provider availability.
- Exact-head GitHub Actions results are required before a CI gate is considered passed.
- Genuine Gemini/Antigravity execution and structured review evidence remain a release requirement.
- Runtime tenant provisioning must demonstrate that an authorized organization/store role can reach `POST /api/v1/ai/chat`.
- If a required gate is failed, cancelled, or unverified, the release remains **NOT PRODUCTION READY**.

## Development

Changes are developed through pull requests and validated by repository CI gates before merging to `main`.

Useful documentation:

- `docs/PRODX-CURRENT-STATE.md` — current repository state and source-of-truth rules
- `docs/architecture/` — architecture and engineering operating model
- `docs/database/` and `db/` — PostgreSQL, migrations, and database foundations
- `server/ai/` — production AI boundary, contracts, tests, and gate evidence

For the active work, see **PR #151** and its exact-head CI checks. Do not treat historical PR descriptions or older audit notes as current status when repository/CI evidence differs.
