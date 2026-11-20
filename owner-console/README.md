# PRODX Owner Console

A separately deployable Vite application for platform-owner identity, isolated from POS Staff authentication.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Set the dedicated `PRODX-OWNER-AUTH` project URL and publishable key.
3. Run `npm install`, then `npm run dev`.

## Vercel

Create a separate Vercel project linked to `Prodx-organization/PRODX-POS` with **Root Directory** set to `owner-console`. Build command: `npm run build`; output directory: `dist`. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the dedicated Owner Auth project.

## Owner provisioning

Public sign-up is intentionally absent. Provision owner identities through a trusted administrative process. Set `app_metadata.owner_role = owner` using a trusted server-side Admin API workflow; never allow the browser to write this claim.

## Server-side authorization

After the client verifies the Owner identity and completes TOTP MFA, it calls the `owner-authorize` Edge Function. That function independently validates the access token with Supabase Auth, checks the trusted `app_metadata.owner_role` claim, and requires `aal2`. The browser fails closed if the function is unavailable or denies the session.

Configure the Edge Function secret `OWNER_CONSOLE_ORIGINS` as a comma-separated list of exact origins (scheme + host + optional port), with no paths or trailing slash. Example format: `https://your-confirmed-owner-console-domain.example`. There is deliberately no default or wildcard origin. Until the actual Owner Console domain is selected and configured, browser requests are denied.

**Security boundary:** `owner-authorize` is an identity/authorization check, not a general-purpose authorization grant or a substitute for protecting business APIs. Every future privileged API must independently validate the Supabase JWT, verify owner membership/role using trusted server-side data, enforce MFA assurance as required, and apply database RLS. Never put a Supabase secret/service-role key in Vite environment variables.

## Scope

This app intentionally does not share the POS Staff AuthContext, POS session storage, POS database broker, or POS routing tree. No Production POS data is queried by this milestone.
