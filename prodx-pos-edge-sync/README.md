# PRODX POS Edge Sync — legacy direct-PostgreSQL prototype (v1.1.2)

> **PRODUCTION HOLD — DO NOT DEPLOY OR APPLY THIS SCHEMA TO PRODX-POS.**
>
> This package currently writes to a separate Edge financial schema (`sales`, `sale_lines`, `inventory_ledger`, `inventory_balances`, `audit_logs`, `pos_idempotency`). That is a parallel financial authority and conflicts with the approved CF-01 architecture. Do not deploy this Worker, provision Hyperdrive for it, create its runtime DB roles/secrets, or apply `migrations/001_pos_ledger.sql` to Preview or Production.
>
> The approved target is **PWA → Cloudflare Worker → Durable Object/Queue → authenticated PRODX backend adapter → existing `CheckoutService` → existing PRODX PostgreSQL schema**. The Worker is a transport/queue tier only; it must not write financial tables or hold a PostgreSQL credential. See PR #376 (CF-01 Checkout Adapter Contract) and `docs/superpowers/specs/2026-11-16-direct-pwa-device-auth-design.md`.
>
> `202 Accepted` means only that the Edge transport accepted work; it is never a committed sale. POS clients retain the local outbox until the backend's authenticated committed receipt is returned.


## Legacy prototype internals — not the approved production architecture

- Worker ES Modules entrypoint; no Service Worker event listeners.
- One SQLite-backed Durable Object shard per `tenant_id:terminal_id`.
- One RPC + one SQLite transaction validates each batch (10–50 sales), key/hash conflicts, HLC monotonicity and terminal sequence state.
- DO SQLite outbox persists `ENQUEUE_PENDING` and keeps `QUEUED` records until PostgreSQL commit is confirmed. The single alarm per DO re-enqueues uncommitted records with exponential backoff (10, 20, 40, then 60 minutes) so Queue retention/consumer loss cannot silently strand a sale. Queue is at-least-once; PostgreSQL unique constraints make replay financially idempotent. Outbox sends are chunked below the 256 KB `sendBatch` request ceiling, and each sale is capped at 100 KB to stay below the 128 KB per-message limit.
- HMAC-SHA256 signs each catalog page and each product price proof. The HMAC secret stays server-side; the POS stores the per-product proof and sends only proofs for products in the sale. The Worker verifies the proofs before Edge acceptance and again in the PostgreSQL transaction. The catalog page signature covers product ID, SKU, name, product version, unit price and tax rate. New `sale_lines` rows persist `catalog_version`, `signed_unit_price_minor` and `signed_price_verified=true`; legacy rows remain explicitly unverified rather than being backfilled with invented signature evidence. `audit_logs` stores the catalog version as a column and the signed unit-price list in immutable metadata. Hyperdrive CACHED page results carry their own `catalog_version` and are accepted only when it matches the uncached DIRECT version read; otherwise the Worker falls back to DIRECT, preventing stale cached prices from being re-signed under a newer version. A sale can use its signed price even after the current product price changes, while expired/forged proofs fail.

- **Inventory balance integrity:** `inventory_ledger` is the only write path. An `AFTER INSERT` `SECURITY DEFINER` trigger applies each append-only delta to `inventory_balances` inside the same transaction. POS and inventory-admin roles cannot directly update balances. Opening stock and manual adjustments must use `scripts/seed-opening-inventory.sql` or `scripts/record-inventory-adjustment.sql`; do not seed `inventory_balances` directly. On an existing database, run reconciliation first and record any opening delta before enabling live writes.
- PostgreSQL transactions set tenant context with `set_config('app.current_tenant_id',$1,true)` before tenant queries. RLS is enabled and forced for business tables and the terminal certificate registry. The Worker verifies the Cloudflare mTLS certificate fingerprint against `terminal_devices` under the same tenant/terminal identity in an uncached Hyperdrive transaction. The Worker DB role must be `NOBYPASSRLS` and must not be a superuser.
- `HYPERDRIVE_DIRECT` is used for transactional writes; `HYPERDRIVE_CACHED` is used for catalog reads. DB clients are per invocation and closed in `finally`.

## Important contracts

### Signed catalog

`GET /api/v1/catalog` returns `catalog_version`, a page-level `signed_catalog`, and a `signed_price_proofs` entry for each product. Each proof binds one product ID, unit price, tax rate, catalog version, issuance time and expiry to an HMAC-SHA256 signature.

- `algorithm: HMAC-SHA256`
- `issued_at`, `expires_at`
- sorted `items` containing `product_id`, `sku`, `name`, `product_version`, `unit_price_minor`, `tax_bps`
- `signature`

The terminal retains the signed price proof alongside each cached product. Each sale includes `signed_price_proofs` for the distinct products in its lines (maximum 200); all proofs must have the same `catalog_version`. If the catalog version changes while downloading pages, discard the partial catalog and restart. The Worker verifies each proof and requires every sale line's price/tax to match it. This avoids copying an entire catalog page into every Queue message.

The HMAC key is a server secret and must never be shipped to POS clients. Clients retain the signed price proofs; only the trusted Worker verifies them. HMAC does not provide client-side public verification. If the POS must independently verify signatures, migrate to Ed25519 and distribute only the public key to clients.

### Sequence/HLC

Each sale contains `terminal_seq_no` and `hlc: { physical_ms, logical }`. DO tracks `last_contiguous_seq_no`, last HLC, seen sequence numbers and open gaps. The response includes `has_sequence_gaps`, `sequence_gaps`, `last_contiguous_seq_no`, and the current contiguous `last_hlc` checkpoint. A terminal enrollment/reset workflow must initialize the expected sequence baseline before a device starts with a non-1 sequence.

### Legacy prototype database / RLS — disposable sandbox only

The migrations create a parallel Edge ledger and are **not** migrations for the existing PRODX-POS database. Do not apply them to Preview, Staging shared databases, or Production. The only acceptable use of these migrations is an isolated, disposable test database with a verified database name/host allowlist and synthetic data. The approved integration must call the existing backend `CheckoutService` and use the existing PRODX transaction executor, RLS, grants, inventory ledger, payment/cash movement, and audit tables.

## Current setup status

This package is **not approved for deployment**. The connected Cloudflare account inventory on 2026-11-16 found no deployed Edge Sync Worker, no Durable Object namespaces, no Hyperdrive configurations, and two staging Queues with zero producers and consumers. No provisioning or deployment is authorized by this README.

Safe local checks (with the pinned Node/npm toolchain and committed lockfile):

```bash
npm ci --no-audit --no-fund --legacy-peer-deps
npm run typecheck
npm run test:edge
```

`npm run integration:postgres` and `npm run chaos` require a disposable PostgreSQL test database only. Never point them at a shared, Preview, or Production database. Do not run `wrangler deploy`, `wrangler hyperdrive create`, `wrangler queues create`, `wrangler secret put`, or `psql -f migrations/001_pos_ledger.sql` until the CF-01 runtime design, backend adapter, isolated staging credentials, and explicit owner authorization are complete.

## Tests and chaos harness

Cloudflare renamed `@cloudflare/vitest-pool-workers` to `@cloudflare/vitest-plugin` in August 2026. This package uses the current `@cloudflare/vitest-plugin` 1.x API rather than retaining the old package name. `wrangler.test.jsonc` isolates the DO/Queue test bindings from production Hyperdrive IDs.

```bash
npm run test:edge
npm run test
```

The suite covers 50-item batch atomicity on an existing-key hash mismatch, DO Alarm recovery after an injected Queue outage, queued-outbox re-enqueue until commit, sequence gap/HLC recovery, permanent-failure finalization, and signed offline-price acceptance/tamper rejection. `scripts/postgres-price-integration.ts` is a separate real-PostgreSQL integration harness: it issues a signed old price, changes the current product price, commits through the runtime role, verifies the old signed price persisted, replays the same idempotency key, checks active/unknown mTLS certificate mapping, and verifies cross-tenant RLS isolation. Run it only against a disposable integration database after applying the migration.

For the 300-terminal load harness, provide 300 valid Access JWTs and 300 matching client certificate/key file pairs in the same order (each fingerprint enrolled for its own terminal in `terminal_devices`). The load harness obtains signed price proofs through the API and never needs the HMAC secret. Never place tokens or private keys in command history or source control:

```bash
export POS_SYNC_URL="https://staging-api.example.com"
export POS_LOAD_TOKENS='["<jwt-1>","<jwt-2>","..."]'
export POS_LOAD_CLIENT_CERTS='[{"cert_path":"/secure/certs/terminal-1.crt","key_path":"/secure/certs/terminal-1.key"}, {"cert_path":"/secure/certs/terminal-2.crt","key_path":"/secure/certs/terminal-2.key"}]'
npm run chaos
```

The harness sends 300 concurrent 50-sale batches (15,000 sales) and 10 exact duplicate replays per terminal (3,000 duplicate requests). It reports Edge HTTP outcomes only; it does not by itself prove PostgreSQL commit completion. For DO-local pending/gap reconciliation, use a trusted `POS_SYNC_AUDITOR` Access JWT and the list of enrolled terminal IDs:

```bash
export POS_OPS_TOKEN="<auditor-access-jwt>"
export POS_TERMINAL_IDS='["<terminal-uuid-1>","<terminal-uuid-2>"]'
npm run export:do-health
# RECONCILIATION_DATABASE_URL uses prodx_reconciliation_admin (read-only BYPASSRLS); never use in Workers.
psql "$RECONCILIATION_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/reconcile.sql
```

The export creates `do-outbox-export.csv`; `scripts/reconcile.sql` imports it with `\copy` and runs the DO-local pending/gap/checkpoint checks in the same `psql` session. Run only against an isolated staging database with test products and inventory.

## Gate 6 Staging — HOLD / legacy proxy workflow is insufficient

The existing Gate 6 workflow targets a Vercel Preview proxy and does not prove direct PWA-to-Worker ingress or the approved backend CheckoutService path. The connected account has no deployed Edge Sync Worker or Durable Object namespaces; the two staging Queues have no producers/consumers. Do not dispatch the workflow or provision resources until the CF-01 backend adapter, device identity, service identity, isolated database, and direct-browser E2E contracts are approved. Hyperdrive is not required for the approved Worker-to-backend design. Application-layer ECDSA signatures are not mTLS; Production mTLS remains unchanged.

The WAF custom rule below is the alternative for a zone-managed hostname using Cloudflare SSL/TLS client-certificate validation; it is not the current `workers.dev` Staging enforcement mechanism.

## Legacy WAF mTLS reference only — not the approved Staging device-auth path

Block action expression:

```text
(http.request.method eq "POST"
 and http.request.uri.path eq "/api/v1/pos/sync-batch"
 and (not cf.tls_client_auth.cert_verified
      or cf.tls_client_auth.cert_revoked))
```

This expression is retained only as a historical reference for a future zone-managed mTLS deployment. It is not part of the approved Free-plan Staging WebCrypto design and is not authorization to configure DNS, a Zone, WAF, or certificates. Any future mTLS deployment requires separate owner approval and must preserve the existing Production mTLS contract.

## Known release gates / limitations

- HMAC key rotation requires a `key_id`/multi-key verification window before rotating active keys; this starter uses one active secret.
- The catalog endpoint signs each returned page and each product price. Sales carry only the per-product `signed_price_proofs` they use; all must share one `catalog_version`. If the catalog version changes while pages are downloaded, restart the download.
- DO storage is bounded: committed/failed Edge idempotency receipts are retained for 30 days, contiguous sequence rows are pruned after advancing the durable checkpoint, closed gaps are aged out after 30 days, and at most 1,000 out-of-order sequences / 10,000 sequence numbers ahead are accepted per terminal. PostgreSQL remains the permanent idempotency authority.
- SQLite-backed DO storage is plan-limited (Cloudflare documents 1 GB per DO on Free and 10 GB per DO on Paid; Free also has a 5 GB aggregate storage allowance). SQL rows are limited to 2 MB, statements to 100 KB and bound parameters to 100; a request can make at most six simultaneous outgoing connections. Monitor storage and alarms; per-terminal sharding is essential. A DO has one alarm, used here for outbox retries and cleanup.
- Workers Free has 10 ms CPU, 50 external subrequests/request, 1,000 internal subrequests/request and 100,000 requests/day; Paid defaults to 30 seconds CPU and 10,000 subrequests/request. Both plans have 128 MB memory. Hyperdrive Free is limited to 100,000 SQL statements/day; Paid is unlimited. Hyperdrive origin pools are approximately 20 connections/config on Free and 100 on Paid. These platform quotas must be rechecked against the active account/plan before a production load test.
- **v1.1.1 PostgreSQL write path:** one new sale is now one parameterized writable-CTE statement and one origin round-trip, independent of the number of sale lines. The CTE uses `jsonb_to_recordset` to bulk insert all sale lines and aggregate per-product inventory deltas. The first materialized CTE applies transaction-local `set_config('app.current_tenant_id', ..., true)`; all tenant-scoped writes, RLS checks, idempotency, sales, lines, inventory ledger, audit, and terminal checkpoint execute in the same implicit PostgreSQL statement transaction. No separate `BEGIN`/`COMMIT` is required because PostgreSQL treats the statement atomically. A same-snapshot duplicate is resolved in the same statement; a rare concurrent-conflict visibility race returns a retryable result for the Queue to redeliver.
- **Statement budget:** the previous implementation used `11 + line_count + distinct_product_count` statements per new sale (13 for the one-line/one-product baseline). For 15,000 unique sales that baseline was 195,000 statements. v1.1.1 uses 15,000 statements total: 1 per sale, a **92.3% reduction** and 15,000 origin round-trips instead of approximately 195,000. If the load scenario adds ten duplicate replays for every sale, each replay is normally also one statement, so 165,000 total statements (15,000 unique + 150,000 replays); that still exceeds a 100,000/day Free statement allowance. The 300-terminal duplicate-storm test therefore still requires a suitable paid quota or a split across quota windows, and must be measured against origin lock/CPU/IO limits.
- Queues limits: 128 KB/message, 100 messages or 256 KB per `sendBatch`, 100 retries, 5,000 messages/second per queue, and 24-hour retention on Free versus 4-day default (up to 14 days) on Paid. Queue operations are per-message, not per-batch; the 15,000-message run exceeds Free's 10,000 operations/day allowance. This package caps each sale at 100 KB and each send chunk at 240 KB to stay below these limits.
- PostgreSQL `FORCE RLS` does not protect against superusers or roles with `BYPASSRLS`; the runtime DB role must be independently audited.
- Permanent failures and messages nearing retry exhaustion are sent to DLQ; a dedicated DLQ consumer marks the DO receipt failed so the outbox stops resending. The DLQ still needs an operator workflow, alerting and replay policy before live money. The diagnostics endpoint requires a trusted tenant-scoped `POS_SYNC_AUDITOR` Access JWT. Each DO has one alarm; this implementation dedicates it to the outbox sweeper and performs retention cleanup opportunistically during submissions/alarms. Queue retry configuration is 100 attempts with 60-second retry delay; review the business impact of prolonged sequence gaps and DLQ redrive procedures before release.
- Edge sequence gaps are DO-local. Export/monitoring and reconciliation between DO gap state and PostgreSQL committed sequences is required before release.
- A Queue send can succeed while the DO crashes before changing `ENQUEUE_PENDING` to `QUEUED`; the Alarm may redeliver. `QUEUED` rows are also periodically re-enqueued until the database commit is acknowledged. This is intentional at-least-once delivery and must be neutralized by PostgreSQL idempotency.
- Load, DB failover, RLS integration and crash-window tests must run in staging before any Production Ready claim.


## GitHub Actions Delivery Gate Verification (v1.1.2)

The workflow `.github/workflows/verify-delivery-gates.yml` runs on push, pull request, and manual dispatch. It provisions a disposable PostgreSQL 16 service, installs Node.js 22 dependencies, generates Wrangler types, runs full TypeScript checking and the Cloudflare workerd test suite, applies the migration, creates isolated CI roles, verifies RLS, runs the PostgreSQL signed-price/CTE integration harness, executes a 300-terminal / 15,000-sale PostgreSQL CI load with 3,000 exact duplicate replays, and fails strict SQL reconciliation on any anomaly. Logs are uploaded as a GitHub Actions artifact.

The CI role bootstrap (`scripts/create-ci-roles.sql`) is only for disposable CI databases. It creates the six least-privilege roles with distinct cryptographically random passwords generated for each workflow run; do not run it against production. The PostgreSQL service's bootstrap password is fixed only inside the isolated, ephemeral GitHub Actions service container; the workflow generates a separate random credential for each database role and a random `CATALOG_SIGNING_KEY` for every run. The chaos harness uses `POS_CI_MODE=true` to test the PostgreSQL CTE directly; it does not claim to exercise a deployed Cloudflare Queue or live Durable Object alarms. Those require a separate Cloudflare staging recovery test.

The source package includes a committed `package-lock.json` (lockfileVersion 3). The delivery-gate workflow installs from it with `npm ci --no-audit --no-fund --legacy-peer-deps` using npm 10.9.4; keep local installs aligned with that command and review lockfile changes in pull requests.

The Hyperdrive IDs in `wrangler.jsonc` are valid-shape non-production placeholders for local type generation only. Replace them with actual Hyperdrive configuration IDs before deployment. The all-zero/all-one IDs are not deployable resources.
