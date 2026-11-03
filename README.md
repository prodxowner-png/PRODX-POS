# PRODX-POS

Production-oriented point-of-sale system foundation.

## Engineering principles

- Financial and inventory integrity
- Security by default
- Auditability and idempotency
- Offline resilience
- Server-authoritative business rules
- Automated architecture, database, and security gates

## Development

Changes are developed through pull requests and validated by the repository CI gates before merging to `main`.

See `docs/architecture/` and `docs/` for the current engineering and database foundations.

## Gate 6 Vercel Preview proxy (CI-only)

The optional `api/staging-edge.ts` Vercel Function exposes only the three Gate 6 endpoints through the `/__staging/edge/` prefix. It is hard-disabled unless `VERCEL_ENV=preview`, requires a dedicated inbound bearer token, uses a fixed HTTPS `*.workers.dev` origin, forwards an upstream Cloudflare Access JWT using the Linked App Token header so the downstream Access application can validate it and issue a new JWT scoped to the Worker AUD, and presents a dedicated CI mTLS certificate to Cloudflare. It does not accept caller-supplied upstream URLs or forward caller-supplied `cf-access-*` headers. Responses are marked `no-store`; request bodies are capped at 1 MB.

Configure these variables only for the dedicated Gate 6 Preview branch in Vercel (never Production): `POS_STAGING_PROXY_TOKEN`, `POS_STAGING_WORKER_ORIGIN`, `POS_STAGING_ACCESS_TOKEN`, `POS_STAGING_OPS_ACCESS_TOKEN`, `POS_STAGING_MTLS_CERT_PEM`, and `POS_STAGING_MTLS_KEY_PEM`. The Cloudflare Worker Access application must have a Service Auth policy using a Linked App Token selector for the upstream Access application that issues the terminal/operator JWTs. The GitHub Actions caller must use the Vercel Preview deployment's protection-bypass secret and the same `POS_STAGING_PROXY_TOKEN`; neither secret belongs in source control or browser-exposed `VITE_*` variables.

**Identity boundary:** Vercel terminates inbound TLS and establishes a new outbound TLS connection. Cloudflare therefore sees the dedicated Vercel-to-Worker CI certificate, not an original POS terminal certificate. This proxy is strictly for isolated Gate 6 CI testing with a separately enrolled test terminal identity. Real POS terminals must continue to call Cloudflare directly with their own enrolled mTLS certificates. Do not route production terminal sync through this proxy.
