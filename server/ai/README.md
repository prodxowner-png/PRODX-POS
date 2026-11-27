# PRODX AI Provider Boundary

This directory contains the server-side, provider-neutral AI boundary for PRODX.

## Provider policy

PRODX application AI is provider-independent. External providers are optional adapters behind the PRODX AI Gateway and must never be coupled directly to browser code.

Production uses Vercel AI Gateway with runtime OIDC authentication; no static provider key is required. If an AI Gateway API key is explicitly configured, it takes precedence over OIDC. Authentication material remains server-side and must never be committed or bundled into the browser.

Gateway requests have a 30-second default timeout. Operators may set `AI_GATEWAY_TIMEOUT_MS` to a value from 1,000 to 120,000 milliseconds; invalid or non-positive values fall back to 30 seconds. Requests are aborted at the timeout boundary, including stalled upstream calls.

The engineering review lane may use an approved external provider, but that provider choice is an implementation detail of the engineering lane and is not part of the application-facing PRODX AI contract.

## Request flow

PRODX frontend -> authenticated backend AI route -> Vercel AI Gateway (OIDC) -> server-allowlisted model -> redacted audit event

The application boundary enforces authorization, rate limits, quota policy, audit logging, tenant/store scope, and data-redaction rules before an AI request leaves PRODX.

## Verification

Provider tests use mocked implementations and never require a real provider API key.

Run the standard verification checks before changing the provider boundary:

```bash
npm run lint
npm run server:check
npm run server:test
npm run build
```
