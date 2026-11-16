# Supabase POS identity binding

The POS Supabase Auth exchange binds a verified JWT `sub` to `public.prodx_users.supabase_auth_user_id`. It does not match accounts by email, username, user metadata, or client-supplied role flags. Owner Console Auth must use its separate issuer and must never be configured as the POS Auth issuer.

## Deployment requirements

- The POS browser client reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; both must identify the approved PRODX-ORG project.
- The POS server verifier reads `SUPABASE_URL` and `SUPABASE_JWKS_URL`; these server-side values must identify the same PRODX-ORG Auth issuer. Never use the Owner Console issuer for POS JWT verification.
- Ordinary POS Supabase session exchange is disabled unless `SUPABASE_POS_AUTH_ENABLED=true` is explicitly set on the server. Keep it false until first-tenant bootstrap, identity checks, and live E2E authorization tests have passed. The bootstrap route remains separately protected by its operator secret and exact allowlisted Auth subject.
- Missing or invalid URL/JWKS configuration fails closed; password/PIN authentication remains on the existing production provider.
- `SUPABASE_OWNER_URL` / `SUPABASE_OWNER_JWKS_URL` belong to the separate Owner Console issuer and must not be substituted for the POS variables.
- Migration `0039_m5_supabase_identity_binding` is additive and creates no links. Existing accounts remain unlinked until an operator provisions an explicit identity mapping.

## Provisioning requirements

1. Verify the user in the intended POS Auth project and obtain the immutable Auth user UUID from a trusted administrative workflow. Never accept a UUID supplied by the browser as proof of identity.
2. Independently verify the intended POS organization and staff account with the account owner.
3. Bind that Auth UUID to the existing POS user using a controlled, audited provisioning workflow. Do not create a link based only on matching email addresses.
4. Verify the mapping is unique and the POS user is active before allowing sign-in.
5. Restrict direct writes to authorized provisioning operators.

The migration adds a nullable UUID column, a unique partial index, and a narrow `SECURITY DEFINER` lookup function with a fixed `search_path`. The lookup resolves only the user's `password` credential for the active device's organization. Existing accounts remain unlinked and Supabase sign-in fails closed until an explicit mapping is provisioned.

## POS session renewal

The browser refreshes the Supabase Auth session with `supabase.auth.refreshSession()` and sends the new access JWT together with the existing POS bearer to `POST /auth/supabase/renew`.

The server verifies the Supabase JWT and re-resolves its immutable subject against the explicit POS identity binding for the existing session's device. It does not accept browser-supplied user, organization, store, role, or permission claims.

Renewal deliberately keeps the existing POS bearer stable rather than creating a replacement session. PostgreSQL atomically extends the existing session expiry using the greater of its current expiry and the expiry bounded by the verified Supabase JWT and the eight-hour POS maximum. The database function also rechecks the linked subject, active user, active device/store, active store membership, unrevoked state, and unexpired session. The function is executable only by `prodx_app`.

Duplicate and concurrent renewal requests are idempotent without creating duplicate sessions. An expired or revoked POS bearer cannot be revived. If Supabase refresh or POS renewal fails, the client retries only while the current POS session remains valid and clears the local session at its authoritative expiry. Password/PIN sessions without a Supabase identity do not use this renewal endpoint.

The renewal response is marked `Cache-Control: private, no-store`. The POS backend never receives or stores the Supabase refresh token.

## Verification

- JWT signature, issuer, audience, expiry, and UUID subject are verified server-side.
- The subject lookup is scoped to the active device through a narrow database function.
- The POS session is short-lived and stores only a hash of its bearer token.
- Client request fields cannot grant admin permissions; authorization remains server-side and database-backed.
