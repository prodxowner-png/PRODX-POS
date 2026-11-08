# Supabase Auth + protected routes for PRODX POS

## Current state

- Supabase project: PRODX-ORG (`wcyqyiewbzpmrekoljfw`), Singapore, PostgreSQL 17.
- This is the single Supabase project for PRODX POS frontend Auth, backend JWT verification, and database services. Do not create or reference a separate POS Auth project.
- The current application has a server-authoritative POS session, store/device scoping, a PIN/passkey login flow, and UI RBAC guards. Do not replace that with a client-only `getSession()` check.
- The identity-binding migration adds `prodx_users.supabase_auth_user_id` and a server-only resolver. It explicitly forbids linking POS users by email automatically.
- Supabase Auth exchanges a verified JWT for the app's short-lived POS bearer session. The POS backend remains the authorization authority for organization/store/device and role/permission checks.
- Keep the existing password/PIN/passkey path until each eligible account has an explicitly provisioned Supabase Auth subject and this new path has passed integration tests.

## Canonical app environment

Configure only the canonical PRODX-ORG variables:

- `VITE_SUPABASE_URL=https://wcyqyiewbzpmrekoljfw.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY=<PRODX-ORG sb_publishable_ key>`
- `SUPABASE_URL=https://wcyqyiewbzpmrekoljfw.supabase.co`
- `SUPABASE_JWKS_URL=https://wcyqyiewbzpmrekoljfw.supabase.co/auth/v1/.well-known/jwks.json`
- `VITE_AUTH_API_BASE_URL=/` when `/auth/*` and `/organizations/*` are routed to the same-origin backend.

The `VITE_` values are public and may be sent to the browser. Use only a publishable key in browser code. Never use `service_role`, secret keys, database passwords, or other server credentials in frontend variables. The browser and server URL/JWKS must identify the same PRODX-ORG project.

Retired split-project variables (`SUPABASE_POS_AUTH_URL`, `SUPABASE_POS_AUTH_JWKS_URL`, `VITE_SUPABASE_POS_AUTH_URL`, `VITE_SUPABASE_POS_AUTH_PUBLISHABLE_KEY`, `SUPABASE_OWNER_URL`, and `SUPABASE_OWNER_JWKS_URL`) must not be used by application code or configured as active runtime variables.

## Configure Supabase Auth

In Supabase Dashboard → Authentication → URL Configuration:

1. Set Site URL to the real production origin.
2. Add the production origin and localhost development origin to Redirect URLs, as appropriate.
3. Choose enabled sign-in methods intentionally (email/password if that is the desired login UX).
4. Configure password security controls supported by the active Supabase plan. Leaked-password protection is plan-dependent; do not treat it as enabled or require it when unavailable on the current plan.
5. If email confirmation is enabled, verify the confirmation flow and redirect URL before expecting users to sign in.

## Explicit account linking

Create Supabase Auth users through an approved invitation/provisioning flow. Bind the resulting Auth user UUID to exactly one existing PRODX user in a controlled server-side/admin operation after confirming identity. Never link by email-only matching and never allow a normal client to update `supabase_auth_user_id`.

Example SQL for a reviewed, privileged operator workflow only (replace both UUIDs with verified values and run only after checking both records):

```sql
UPDATE public.prodx_users
SET supabase_auth_user_id = '<verified-supabase-auth-user-uuid>'
WHERE id = '<verified-prodx-user-uuid>'
  AND supabase_auth_user_id IS NULL;
```

Confirm exactly one row was updated. If it updates zero or more than one row, stop and investigate; do not loosen uniqueness constraints.

## Protected pages and APIs

- Keep `AuthProvider` restore logic that asks the backend to validate the persisted POS bearer token.
- Keep `RbacGuard` for client-side route/module UX, including Admin-only checks. UI guards are not a security boundary.
- Every protected API route must validate the POS bearer token server-side and authorize against the server-resolved organization, store, device, role and permissions.
- Never trust browser-supplied role/permissions, store IDs, or metadata as authorization proof.
- Never expose POS tables/RPCs directly to browser `anon` or `authenticated` roles. Preserve the backend's `prodx_app` access boundary.
- Keep sign-in, sign-out, expiry, account-linking, tenant/store isolation, invalid JWT, unlinked identity, role denial and return-to-login behavior covered by tests.

## MCP

Supabase MCP is already connected in this workspace. Official MCP URL: `https://mcp.supabase.com/mcp`.

## Readiness status

Do not claim production-ready until canonical environment variables are configured, account linking is provisioned explicitly, local POS session renewal is implemented, integration tests and CI pass, and the live login flow is verified end-to-end. No production database schema changes are made by this checklist.
