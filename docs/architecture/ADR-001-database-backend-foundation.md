# ADR-001 — Database & Backend Foundation Decision Gate

- **Status:** Accepted by Owner
- **Date:** 2026-09-09
- **Accepted:** 2026-09-11
- **Scope:** Production backend and persistence foundation for PRODX POS
- **Gate:** Database Decision Gate (accepted before persistence implementation)

## Context

The repository now contains a production TypeScript server composition and PostgreSQL-backed authentication/authorization boundary. The AI HTTP adapter is wired at POST /api/v1/ai/chat; it derives authorization from the verified backend principal and requires ai:use. The browser never supplies authoritative identity or permissions.

The original architectural decision remains valid. Earlier statements that the backend/persistence layer were future work are historical context and are superseded by the implemented M0/M1/M2 slices on the current branch.

## Decision

The production foundation is defined as follows:

1. **Authoritative backend:** Node.js + TypeScript backend, using NestJS or an equivalent modular HTTP framework that preserves strict domain/application/infrastructure boundaries.
2. **Primary database:** PostgreSQL for authoritative transactional state.
3. **Money:** PostgreSQL `NUMERIC(12,2)` (or stricter precision where a domain calculation requires it); JavaScript floating-point values must not represent authoritative monetary amounts.
4. **Time:** store authoritative timestamps in UTC; business operations use an explicit store/business timezone.
5. **Tenant isolation:** every tenant-owned query and write is scoped by organization and store where applicable; isolation is enforced in the application boundary and reinforced by database constraints/queries.
6. **Transactions:** sales, payments, inventory movements, cash operations, voids, refunds, and related financial state changes are atomic database transactions.
7. **Concurrency:** authoritative inventory/cash/numbering operations must use explicit transactional locking/concurrency controls where required; correctness must not depend on client ordering.
8. **Idempotency:** externally retried write operations use a durable idempotency key with database-enforced uniqueness at the correct tenant/scope boundary.
9. **Migrations:** schema changes are versioned, forward-applied, reviewable, and safe to validate in CI; migration state must have one authoritative head.
10. **Server authority:** the browser is never authoritative for identity, authorization, money, inventory, document numbering, or final transaction state.
11. **AI integration:** the existing AI boundary remains behind the authenticated backend; AI capability authorization occurs before provider execution and provider credentials remain server-side.
12. **Offline:** offline writes are treated as durable client outbox candidates and are reconciled through an idempotent server-owned sync protocol; offline state never overrides authoritative server state.

## Explicit non-decisions

This ADR does **not** approve implementation of:

- concrete PostgreSQL tables or migrations;
- authentication/session/token storage;
- RBAC persistence;
- sales, payment, inventory, cash, refund, or shift repositories;
- Redis topology or queue semantics;
- deployment infrastructure;
- hardware-agent integration.

Those capabilities require their own implementation gates and acceptance criteria.

## Required implementation gates after acceptance

### Gate A — Backend boundary

Must establish the authenticated HTTP boundary, request context, error contract, validation, authorization hook, and dependency direction before domain persistence is wired.

### Gate B — Database foundation

Must establish PostgreSQL connectivity, migration tooling, transaction boundary, schema conventions, UTC timestamp policy, monetary types, tenant keys, and integration-test infrastructure.

### Gate C — Domain persistence

Only after A and B pass may repositories and transactional use cases for catalog, inventory, sales, payments, shifts, voids, and refunds be implemented capability-by-capability.

## Acceptance record

Owner accepted this architectural direction on 2026-09-11. Acceptance authorizes implementation of M0 Gate A and Gate B only. It does not pre-approve domain persistence, authentication/RBAC, concrete business schemas beyond the M0 foundation, Redis, deployment, or hardware integration.

Acceptance criteria for the decision gate:

- the backend is the sole authoritative API boundary;
- PostgreSQL is the authoritative transactional store;
- domain code remains vendor-independent;
- persistence is isolated behind application interfaces;
- tenant isolation is explicit and testable;
- monetary precision and UTC/business-time rules are explicit;
- idempotency and concurrency are first-class invariants;
- migrations and integration tests are mandatory CI gates;
- no provider secret, browser identity, or client-calculated financial result becomes authoritative;
- the next implementation milestone is allowed only after this ADR is accepted.

## Rejection / rollback condition

If implementation violates the approved boundaries or begins domain persistence before Gate A and Gate B are verified, the affected work must be stopped and returned to the relevant gate. Passing frontend or AI checks does not authorize persistence implementation.

## Evidence from current repository

The repository's current package scripts provide frontend typecheck/build plus server typecheck/test commands, while the existing AI integration documentation explicitly describes the repository as a React/Vite application and says the production API route must attach to an authenticated backend boundary. These facts are the basis for this gate.


## Implementation status supersession — 2026-09-24

PostgreSQL migrations extend through 0018, production authentication/authorization and HTTP composition are present, and the authenticated Gemini AI route is wired. Fresh deterministic CI checks pass at b76001ca8ff6ec85e45a7834e9b3b63854ad5d3b. This ADR is not a Production Ready acceptance record.
