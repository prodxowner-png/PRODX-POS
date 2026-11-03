# PRODX production database broker

Supabase Edge Function that hands the PRODX Vercel production deployment the connection URL of the
restricted `prodx_app` PostgreSQL role. The server resolves it at startup via `PRODX_DB_BROKER_URL`
(see `server/db/postgres.ts`).

Nothing in this directory is deployed by CI. Deploying it, setting its secrets, and running migrations
are manual, owner-approved steps.

## Files

- `handler.ts`: runtime-neutral request handler and config validation (unit-tested in `server/broker/handler.test.ts`).
- `index.ts`: Deno/Supabase entrypoint that wires Vercel OIDC verification (`jose`, RS256, remote JWKS) into the handler.

## Behavior

- `GET` only. Anything else returns 405.
- Missing or invalid configuration returns 503 for every request (fail closed).
- Missing or malformed `Authorization: Bearer` returns 401. A token that fails signature, issuer, audience or expiry checks returns 401 with no detail.
- A verified token whose `sub` is not in the allow-list returns 403.
- Success returns `200 {"databaseUrl": "..."}` with `Cache-Control: no-store`.
- Tokens, connection URLs and raw verification errors are never logged or returned.
- Configuration is rejected (broker returns 503) if the database URL does not use the `prodx_app` role, so an administrative or service-role connection string cannot be served by mistake.

## Secrets (set in the target Supabase project `PRODX-ORG` (`wcyqyiewbzpmrekoljfw`), never in git)

| Name | Value |
| --- | --- |
| `PRODX_OIDC_ISSUER` | Expected team issuer: `https://oidc.vercel.com/prodx-team` (verify the real token `iss` claim before setting) |
| `PRODX_OIDC_AUDIENCE` | Expected team audience: `https://vercel.com/prodx-team` (verify the real token `aud` claim before setting) |
| `PRODX_OIDC_ALLOWED_SUBJECTS` | Expected production subject for Vercel project `prodx-pos-org`: `owner:prodx-team:project:prodx-pos-org:environment:production`. Verify against a real token before setting. Never allow `preview` or `development`. |
| `PRODX_RUNTIME_DATABASE_URL` | Restricted-role session-pooler URL for `PRODX-ORG`: `postgresql://prodx_app.wcyqyiewbzpmrekoljfw:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require`. |

Verify the exact `iss`, `aud` and `sub` values from a real Vercel production OIDC token before enabling.

## Deploy

Deploy as a function named `prodx-db-broker` with **JWT verification disabled** (`verify_jwt = false`).
Callers authenticate with a Vercel OIDC token, not a Supabase JWT, and the function verifies that token itself.
Then set `PRODX_DB_BROKER_URL` on the Vercel production environment to the function URL
(`https://<project-ref>.supabase.co/functions/v1/prodx-db-broker`).

## Database prerequisites

Run `npm run db:migrate` against `PRODX-ORG` after the complete migration set passes isolated PostgreSQL tests. The role is created without a password; set a unique password and keep the resulting URL only in Supabase Edge Function secrets.
Migrations 0033, 0034, 0036, 0037 and 0038 scope runtime grants, RLS and API-role cleanup to PRODX-owned objects; Owner Console Auth objects are not granted to the POS runtime role.
Do not add broad default privileges for `public`; future POS migrations must explicitly grant the runtime role
access only to the PRODX tables and sequences they create. The schema-ownership integration test checks existing
foreign objects, sequence privileges, default ACLs, and objects created by another application.
