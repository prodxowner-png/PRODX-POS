# ADR-002 — Vercel, Supabase, Gemini, and Antigravity Runtime Boundaries

- **Status:** Accepted target architecture; implementation and production cutover are **not yet approved**
- **Date:** 2026-10-21
- **Owner direction:** Vercel for frontend; Supabase as the intended backend platform; Gemini for user-facing AI; Antigravity for backend engineering/operations assistance
- **Repository:** `Prodx-organization/PRODX-POS`

## 1. Decision

The intended target architecture is:

1. **Frontend — Vercel:** host and deliver the React + TypeScript + Vite POS PWA and Owner Console.
2. **Backend platform — Supabase:** use Supabase PostgreSQL as the single authoritative transactional datastore, Supabase Auth for identity, Row Level Security (RLS) for tenant-aware data access, and Edge Functions/server-side functions for authenticated API boundaries and provider calls.
3. **Frontend AI — Gemini:** provide product lookup assistance, natural-language help, and safe explanations/summaries through an authenticated server-side AI gateway. Provider credentials must never be shipped in browser bundles.
4. **Backend AI/agent — Antigravity:** act as an engineering and operations agent for evidence collection, log triage, test generation, security review, patch proposals, and controlled remediation in branches/sandboxes. It is not the authoritative transaction engine or the sole health monitor.

This decision sets the target, not a claim that the repository or deployed services already implement it end-to-end.

## 2. Responsibility boundaries

### Vercel frontend

- Serve the user interface and static/PWA assets.
- Hold only public configuration such as the Supabase project URL and publishable/anon key.
- Never hold a service-role key, database password, Gemini secret, or other privileged credential.
- Treat browser state as untrusted. Client-side validation improves UX but does not establish transaction correctness.

### Supabase backend

- **PostgreSQL:** authoritative state for sales, payments, inventory ledger, cash/shift operations, refunds, audit records, idempotency, and sync reconciliation after each capability has passed its implementation gate.
- **Auth:** authenticate users and issue verified identity context.
- **RLS and authorization:** enforce organization/store isolation and role-based access. Do not rely on a client-supplied user, organization, store, or role.
- **Edge Functions / server-side API:** expose narrow authenticated operations; validate inputs, authorize actions, apply rate limits, and call Gemini only after permission checks.
- **Database functions/transactions:** use atomic database transactions, constraints, durable idempotency keys, concurrency control, and exact decimal money representation for financial mutations.

Do not allow the browser to write authoritative sales/payment/inventory state directly through broad table grants. Direct client access is permitted only for explicitly approved tables and policies.

### Gemini frontend AI

- User-facing assistance such as natural-language product search, catalog explanations, and summaries of data returned by authorized APIs.
- The AI may propose a product/search interpretation, but the backend must independently resolve product IDs, price, tax, stock, discounts, and final totals.
- Do not permit model output to authorize refunds, discounts, payments, stock adjustments, user-role changes, or other privileged mutations.
- Apply request-size/output limits, rate limits, safe logging, and data minimization.

### Antigravity backend agent

- Collect read-only health evidence, sanitized logs, test/build results, migration state, and deployment metadata.
- Triage incidents, identify likely causes, prepare tests, and propose fixes.
- Make changes only in isolated branches/sandboxes; run the relevant quality gates before proposing a pull request.
- Production remediation, database DDL, role/grant changes, financial data mutation, and deployment must remain blocked behind explicit, auditable release/authorization gates.
- A normal monitor/health endpoint must determine service health. Antigravity can interpret evidence and suggest action; it must not be the only uptime detector.

## 3. Health-check and operations design

Use deterministic checks first, AI analysis second:

1. **Liveness:** process/runtime can respond.
2. **Readiness:** required Supabase database connection and required dependencies are reachable; required schema/migration level is correct.
3. **Synthetic checks:** authenticated non-mutating checks verify key API contracts. Do not use real customer transactions for health probes.
4. **Observability:** capture request ID, latency, status, dependency failures, and sanitized error codes. Never log tokens, passwords, payment credentials, or unnecessary personal data.
5. **Triage:** trigger Antigravity from a failed check, incident, CI failure, or scheduled review. Attach sanitized evidence and a risk classification.
6. **Remediation:** propose a branch/patch, execute tests and security checks, then open a PR. No automatic bypass of production quality gates.
7. **Post-deploy verification:** rerun readiness and synthetic checks; roll back or stop rollout if required checks fail.

Health endpoints should distinguish liveness from readiness. A response from a provider endpoint (including an authorization error) is not proof that the application has valid credentials or can read/write required data.

## 4. Current repository and connected-project evidence

The following was observed during the 2026-10-21 review. It is a point-in-time snapshot, not a production certification.

- The repository currently contains a Node.js/TypeScript Express server, PostgreSQL access through `pg`, a Gemini provider/AI gateway, and Firestore-related health-check logic. The production entrypoint currently initializes a PostgreSQL pool and calls Firestore in its readiness check.
- `vercel.json` currently builds a Vite frontend and bundles `server/entrypoint.ts` for a Vercel API route. The Vercel project exists and has a recent deployment in `READY` state, but the project metadata reports `live: false` and the deployment target is not marked as production. This does not prove a production deployment is serving traffic.
- The connected Supabase account exposes one project, `supabase-amber-mountain`, in `ap-southeast-1`, status `ACTIVE_HEALTHY`. Its inspected public schema currently has a `user_roles` table with RLS enabled; two migrations are recorded and no Edge Functions are listed.
- The inspected Supabase project has not yet been verified as the intended production PRODX POS project. Do not apply POS schema migrations, move data, change auth providers, or point production traffic at it until ownership/environment and backup/recovery posture are confirmed.
- The current repository also contains Cloud SQL/Firestore-specific assumptions. They must be inventoried and removed or explicitly retained for a documented, non-authoritative purpose during the migration; do not allow two competing authoritative stores.

Evidence files:
- `package.json`
- `vercel.json`
- `server/entrypoint.ts`
- `server/services/systemHealthCheckService.ts`
- `server/ai/production-composition.ts`
- `docs/architecture/ADR-001-database-backend-foundation.md`

## 5. Migration plan and gates

### Phase 0 — Verify target and preserve current state

- Confirm which Supabase project is intended for development, staging, and production.
- Export/record current project metadata, Auth configuration, RLS policies, migrations, and schema.
- Establish backup and restore evidence before data or schema changes.
- Inventory Vercel project environment-variable names and deployment targets without exposing secret values.
- Record existing Cloud SQL, Firestore, Supabase, and Vercel responsibilities and data ownership.

**Exit criteria:** intended projects/environments are identified; backup/recovery path is documented; no secrets are exposed.

### Phase 1 — Backend/Auth foundation

- Define the verified identity context and organization/store/role authorization contract.
- Map Supabase Auth identities to application roles without trusting browser-supplied role claims.
- Design and test RLS policies for anonymous, authenticated, cashier, manager, admin, and owner access.
- Establish separate least-privilege runtime and migration credentials where supported.
- Add server-side environment validation and fail closed if required database/auth configuration is missing.

**Exit criteria:** auth and RLS tests prove both permitted and denied access, including cross-tenant access attempts.

### Phase 2 — Transactional database foundation

- Reconcile existing PostgreSQL migrations with the target Supabase schema before any cutover.
- Establish a single authoritative migration history and repeatable CI validation.
- Preserve numeric money types, UTC timestamps, tenant keys, foreign keys, unique idempotency constraints, and transaction/concurrency rules.
- Port or adapt domain persistence capability-by-capability; do not replace financial logic with client-side Supabase calls.
- Add integration tests against an isolated test database/project.

**Exit criteria:** migrations are reproducible; transaction, concurrency, idempotency, and tenant-isolation tests pass.

### Phase 3 — Gemini gateway

- Route browser AI requests through an authenticated server-side endpoint/Edge Function.
- Store provider secrets only in server-side secrets management.
- Authorize the AI capability before provider execution and audit the outcome without storing sensitive prompt content unnecessarily.
- Test timeouts, provider failures, rate limits, oversized inputs, and prompt-injection attempts.

**Exit criteria:** no provider secret in built assets; denied users cannot invoke AI; AI cannot directly commit financial mutations.

### Phase 4 — Antigravity operations agent

- Add deterministic liveness/readiness and sanitized diagnostics.
- Trigger the agent from CI failures, health alerts, or scheduled reviews.
- Start read-only; allow patch creation in a branch only after evidence is collected.
- Require test results, security review, and migration review in the pull request.
- Keep production secrets, production database writes, and deploy credentials out of the agent's default scope.

**Exit criteria:** a simulated failure produces a useful evidence-based report and a tested proposed patch without modifying production.

### Phase 5 — Cutover and production readiness

- Run staging end-to-end tests and a recovery drill.
- Compare key transaction invariants and migration results before cutover.
- Use a documented cutover/rollback plan; do not dual-write financial records without a formally tested reconciliation design.
- Verify production deployment target, environment configuration, health endpoints, auth/RLS, logs, and synthetic tests.
- Declare Production Ready only when all required quality gates have fresh evidence.

## 6. Non-negotiable production invariants

- PostgreSQL/Supabase is the only authoritative source for each migrated transactional capability.
- Financial and inventory writes are server-authoritative, atomic, idempotent, and auditable.
- No floating-point arithmetic for authoritative money.
- Tenant isolation is enforced by backend authorization and database policies/constraints.
- Provider keys and privileged credentials remain server-side.
- AI output is advisory and cannot bypass permissions or transaction rules.
- No production cutover, destructive migration, or quality-gate bypass based on this ADR alone.

## 7. Acceptance

The owner has approved this target direction on 2026-10-21. Implementation remains gated by Phase 0 project verification and the acceptance criteria above. This ADR does not authorize production data migration, schema changes on an unverified Supabase project, or deployment cutover.
