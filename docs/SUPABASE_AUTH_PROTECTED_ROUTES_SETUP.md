# Supabase Auth + protected routes for PRODX POS

## Current state

- Supabase project: `PRODX-ORG` (`wcyqyiewbzpmrekoljfw`), Singapore, PostgreSQL 17.
- The current `main` application already has a server-authoritative POS session, store/device scoping, a PIN/passkey login flow, and UI RBAC guards. Do not replace that with a client-only `getSession()` check.
- Migration `0039_m5_supabase_identity_binding.sql` adds `prodx_users.supabase_auth_user_id` and a server-only resolver. It explicitly forbids linking POS users by email automatically.
- Supabase Auth should be introduced as an additional verified identity method, exchanging the verified Supabase JWT for the app's short-lived POS bearer session. The POS backend remains the authorization authority for organization/store/device and role/permission checks.
- Keep the existing password/PIN/passkey path until each eligible account has an explicitly provisioned Supabase Auth subject and this new path has passed integration tests.

## Configure app environment

Set the following environment variables in the deployment target (Vercel project) and in the local environment where relevant:

- `VITE_SUPABASE_POS_AUTH_URL=https://wcyqyiewbzpmrekoljfw.supabase.co`
- `VITE_SUPABASE_POS_AUTH_PUBLISHABLE_KEY=<the active sb_publishable_ key for the POS Auth project>`
- `SUPABASE_POS_AUTH_URL=https://wcyqyiewbzpmrekoljfw.supabase.co`
- `SUPABASE_POS_AUTH_JWKS_URL=https://wcyqyiewbzpmrekoljfw.supabase.co/auth/v1/.well-known/jwks.json`
- `VITE_AUTH_API_BASE_URL=/` when `/auth/*` and `/organizations/*` are routed to the same-origin backend.

The `VITE_` values are public and may be sent to the browser. These POS-specific variables must target the POS Auth issuer, not the separate Owner Console Auth project. Never use `service_role`, secret keys, database passwords, or other server credentials in frontend variables.

The active publishable key can be copied from the POS Auth project Supabase Dashboard → Project Settings → API Keys. Configure `SUPABASE_POS_AUTH_URL` and optionally `SUPABASE_POS_AUTH_JWKS_URL` on the server. The server verifier does not fall back to the legacy `SUPABASE_URL` or `SUPABASE_JWKS_URL`. Do not commit credentials to the repository.

## Configure Supabase Auth

In Supabase Dashboard → Authentication → URL Configuration:

1. Set Site URL to the real production origin.
2. Add the production origin and localhost development origin to Redirect URLs, as appropriate.
3. Choose enabled sign-in methods intentionally (email/password if that is the desired login UX).
4. Enable leaked-password protection and choose a reasonable minimum password length in Authentication → Settings/Security.
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
- Never expose POS tables/RPCs directly to browser `anon` or `authenticated` roles. The current schema is intended to be accessed through the backend's `prodx_app` role; preserve that boundary.
- Keep sign-in, sign-out, expiry, account-linking, tenant/store isolation, invalid JWT, unlinked identity, role denial and return-to-login behavior covered by tests.

## MCP and optional Agent Skills

Supabase MCP is already connected in this workspace. Official MCP URL: `https://mcp.supabase.com/mcp`. In a separate MCP client, add the official Supabase server and complete the OAuth flow in that client rather than pasting access tokens into chat.

Optional developer-side skill installation (run in your own terminal, not in the Supabase SQL editor):

```bash
npx skills add supabase/agent-skills
```

## Readiness status

This document is an implementation/configuration checklist. Do not claim production-ready until the environment variables are set in the deployment target, account linking is provisioned explicitly, integration tests and CI pass, and the live login flow is verified end-to-end. No production database schema changes are made by this checklist.
