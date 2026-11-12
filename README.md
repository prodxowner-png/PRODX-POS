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

The optional `api/staging-edge.ts` Vercel Function exposes only the three Gate 6 endpoints through the `/__staging/edge/` prefix. It is hard-disabled unless `VERCEL_ENV=preview`, requires a dedicated inbound bearer token, uses a fixed HTTPS `prodx-pos-edge-sync-staging.<account-subdomain>.workers.dev` origin, forwards an upstream Cloudflare Access JWT using the Linked App Token header so the downstream Access application can validate it and issue a new JWT scoped to the Worker AUD, and presents a dedicated CI mTLS certificate to Cloudflare. It does not accept caller-supplied upstream URLs or forward caller-supplied `cf-access-*` headers. Responses are marked `no-store`; request bodies are capped at 1 MB.

Configure these variables only for the dedicated Gate 6 Preview branch in Vercel (never Production): `POS_STAGING_PROXY_TOKEN`, `POS_STAGING_WORKER_ORIGIN`, `POS_STAGING_ACCESS_TOKEN`, `POS_STAGING_OPS_ACCESS_TOKEN`, `POS_STAGING_MTLS_CERT_PEM`, and `POS_STAGING_MTLS_KEY_PEM`. Enable `workers_dev` only for the Staging Worker. Protect its exact `workers.dev` hostname with a dedicated Cloudflare Access application. Its Service Auth policy must require both the upstream Linked App Token (for terminal/operator JWT claims) and a valid mTLS client certificate issued by a CA associated with that hostname. The Worker must continue validating the downstream Access JWT, certificate fingerprint, and enrolled test-terminal mapping. The GitHub Actions caller must use the Vercel Preview deployment's protection-bypass secret and the same `POS_STAGING_PROXY_TOKEN`; neither secret belongs in source control or browser-exposed `VITE_*` variables.

**Identity boundary:** Vercel terminates inbound TLS and establishes a new outbound TLS connection. Cloudflare therefore sees the dedicated Vercel-to-Worker CI certificate, not an original POS terminal certificate. This proxy is strictly for isolated Gate 6 CI testing with a separately enrolled test terminal identity. Real POS terminals must continue to call Cloudflare directly with their own enrolled mTLS certificates. Do not route production terminal sync through this proxy.

Access mTLS is a prerequisite for this `workers.dev` Staging ingress. Cloudflare documents Access mTLS as available on Enterprise and pay-as-you-go Zero Trust plans, not Free. The connected Cloudflare OAuth identity cannot read Billing subscriptions (the API returned 403 for Billing Read scope), so entitlement remains unverified. Do not deploy Gate 6 Staging until the account entitlement and Worker-visible client-certificate fingerprint have been verified. If Access mTLS is unavailable, keep Gate 6 on HOLD; do not replace certificate verification with caller-supplied headers or a shared-secret bypass.

## OCI tenancy read-only bridge (Staging Preview only)

The server-side `GET /api/v1/infrastructure/oci/tenancy` endpoint requires the existing
`settings.manage` permission and returns only allowlisted tenancy metadata. It does not
return the tenancy OCID or private key and responds with `Cache-Control: no-store`.

Configure `OCI_BRIDGE_PREVIEW_URL`, `OCI_BRIDGE_ACCESS_CLIENT_ID`,
`OCI_BRIDGE_ACCESS_CLIENT_SECRET`, and `OCI_BRIDGE_BEARER_TOKEN` only in the
dedicated Staging/Preview environment. Keep the three credential values in the platform
secret store; never commit them or expose them through browser-side `VITE_*` variables.
The URL must use the exact 8-hex-ID Staging Preview hostname pattern enforced by the
server (for example, the active preview deployment hostname); when that preview is
recreated, update the Preview URL to its new hostname. Do not configure this bridge
on Production or route Production infrastructure requests through the Staging Worker.
