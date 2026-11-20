# PRODX Owner Console

A separately deployable Vite application for platform-owner identity, isolated from POS Staff authentication.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Set the dedicated `PRODX-OWNER-AUTH` project URL and publishable key.
3. Run `npm install`, then `npm run dev`.

## Vercel

Create a separate Vercel project linked to `Prodx-organization/PRODX-POS` with **Root Directory** set to `owner-console`. Build command: `npm run build`; output directory: `dist`. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for the dedicated Owner Auth project. Configure the Supabase Edge Function secret `OWNER_CONSOLE_ORIGINS` as a comma-separated list of exact origins (scheme + host + optional port), for example `https://owner.example.com,http://localhost:5173`. Do not include paths or trailing slashes. The function intentionally fails closed when this secret is missing or the request Origin is not an exact allowlist entry.

## Owner provisioning

Public sign-up is intentionally absent. Provision owner identities through a trusted administrative process. Set `app_metadata.owner_role = owner` using a trusted server-side Admin API workflow; never allow the browser to write this claim. The application calls `auth.getUser()` for early UI feedback and then invokes the `owner-authorize` Edge Function. The function independently verifies the JWT, trusted `app_metadata.owner_role`, and AAL2 before the UI renders the Owner workspace. CORS is restricted to the configured `OWNER_CONSOLE_ORIGINS` allowlist.

**Security boundary:** this initial milestone contains no privileged business-data API calls. UI gating is not a substitute for server-side authorization. Before exposing owner operations, every API must validate the Supabase JWT, verify owner membership/role using trusted server-side data, enforce MFA assurance as required, and apply database RLS. Never put a Supabase secret/service-role key in Vite environment variables.

## Scope

This app intentionally does not share the POS Staff AuthContext, POS session storage, POS database broker, or POS routing tree.
