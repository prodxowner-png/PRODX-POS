# PRODX Owner Console

A separately deployable Vite application for platform-owner identity, isolated from POS Staff authentication.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Set the dedicated `PRODX-OWNER-AUTH` project URL and publishable key.
3. Run `npm install`, then `npm run dev`.

## Vercel

Create a separate Vercel project linked to `prodxowner-png/PRODX-POS` with **Root Directory** set to `owner-console`. Build command: `npm run build`; output directory: `dist`. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the dedicated Owner Auth project. This project must not be the POS Vercel project and must not receive any POS production credentials.

`vercel.json` pins npm to the same version as CI and verifies the lifecycle-script policy (`strict-allow-scripts`) before `npm ci`, and it sets the security headers for every route: a Content-Security-Policy (`script-src 'self'`, `frame-ancestors 'none'`), `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, and `X-Robots-Tag`. The CSP `connect-src` is pinned to the Owner Auth project origin declared in `.env.example`; if the Owner Auth project ever changes, update `.env.example` and the CSP together (a test fails if they drift). Verify the headers on the first Vercel Preview before promoting to Production.

## Owner Auth project prerequisites

Configure these in the dedicated `PRODX-OWNER-AUTH` Supabase project before the first sign-in:

- Disable public sign-ups in the project's Auth settings, and enable TOTP MFA.
- Deploy the Edge Function from the repository root so `supabase/config.toml` (`verify_jwt = true`) applies, for example `supabase functions deploy owner-authorize --project-ref <owner-auth-project-ref>`. Never deploy it with `--no-verify-jwt`.
- Set `OWNER_CONSOLE_ORIGINS` (see below), for example `supabase secrets set OWNER_CONSOLE_ORIGINS=https://<console-domain> --project-ref <owner-auth-project-ref>`. `SUPABASE_URL` and `SUPABASE_ANON_KEY` are provided to Edge Functions by the platform.

## Owner provisioning

Public sign-up is intentionally absent. Provision owner identities through a trusted administrative process. Set `app_metadata.owner_role = owner` using a trusted server-side Admin API workflow; never allow the browser to write this claim.

## Server-side authorization

After the client verifies the Owner identity and completes TOTP MFA, it calls the `owner-authorize` Edge Function. That function independently validates the access token with Supabase Auth, checks the trusted `app_metadata.owner_role` claim, verifies an active `totp` factor, and requires `aal2`. Gateway JWT verification is explicitly enabled in `supabase/config.toml` (`verify_jwt = true`). The browser fails closed if the function is unavailable or denies the session.

Configure the Edge Function secret `OWNER_CONSOLE_ORIGINS` as a comma-separated list of exact origins (scheme + host + optional port), with no paths or trailing slash. Example format: `https://your-confirmed-owner-console-domain.example`. There is deliberately no default or wildcard origin. Until the actual Owner Console domain is selected and configured, browser requests are denied.

## Session handling

The browser client does not adopt sessions from the URL (`detectSessionInUrl: false`) because no OAuth, magic-link, or password-recovery flow exists. Re-enable it only together with a reviewed redirect flow. Passive auth events (tab refocus, token refresh) do not reset an in-progress MFA enrollment or challenge for the same user; every other event re-verifies the session server-side and fails closed.

Run automated security and state-transition tests locally with `npm test` inside `owner-console/`.

**Security boundary:** `owner-authorize` is an identity/authorization check, not a general-purpose authorization grant or a substitute for protecting business APIs. Every future privileged API must independently validate the Supabase JWT, verify owner membership/role using trusted server-side data, enforce MFA assurance as required, and apply database RLS. Never put a Supabase secret/service-role key in Vite environment variables.

## Scope

This app intentionally does not share the POS Staff AuthContext, POS session storage, POS database broker, or POS routing tree. No Production POS data is queried by this milestone.
