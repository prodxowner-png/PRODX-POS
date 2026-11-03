# Supabase POS identity binding

The POS Supabase Auth exchange binds a verified JWT `sub` to `public.prodx_users.supabase_auth_user_id`. It does not match accounts by email, username, user metadata, or client-supplied role flags. Owner Console Auth must use its separate issuer and must never be configured as `SUPABASE_POS_AUTH_URL`.

## Deployment requirements (breaking configuration change)

- The POS verifier now reads `SUPABASE_POS_AUTH_URL` (and optionally `SUPABASE_POS_AUTH_JWKS_URL`). It no longer falls back to the legacy `SUPABASE_URL` / `SUPABASE_JWKS_URL` variables.
- Set `SUPABASE_POS_AUTH_URL` on the production Vercel project **before** deploying this change. If it is unset or invalid, Supabase sign-in fails closed (every Supabase token is rejected); password and PIN sign-in are unaffected.
- `SUPABASE_OWNER_URL` / `SUPABASE_OWNER_JWKS_URL` belong to the Owner Console issuer and must point at a different Auth project than the POS variables.
- Apply migration `0039_m5_supabase_identity_binding` with an administrative connection. The migration is additive and idempotent; it creates no links, so no existing account can sign in through Supabase until an operator provisions one.

## Provisioning requirements

1. Verify the user in the intended POS Auth project and obtain the immutable Auth user UUID from a trusted administrative workflow. Never accept a UUID supplied by the browser as proof of identity.
2. Independently verify the intended POS organization and staff account with the account owner.
3. Bind that Auth UUID to the existing POS user using a controlled, audited provisioning workflow. Do not create a link based only on matching email addresses.
4. Verify the mapping is unique and the POS user is active before allowing sign-in.
5. Restrict direct writes to authorized provisioning operators.

The migration adds a nullable UUID column, a unique partial index, and a narrow `SECURITY DEFINER` lookup function with a fixed `search_path`. The lookup resolves only the user's `password` credential for the active device's organization. Existing accounts remain unlinked and Supabase sign-in fails closed until an explicit mapping is provisioned.

## Verification

- JWT signature, issuer, audience, expiry, and UUID subject are verified server-side.
- The subject lookup is scoped to the active device through a narrow database function.
- The POS session is short-lived and stores only a hash of its bearer token.
- Client request fields cannot grant admin permissions; authorization remains server-side and database-backed.
