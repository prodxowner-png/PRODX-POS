# Secure first-tenant bootstrap

The first tenant is created only through `POST /auth/supabase/bootstrap`. This is a separate, one-time provisioning path; ordinary Supabase session exchange still requires an already-provisioned device.

## Operator configuration

Keep all values server-side. Do not expose them through `VITE_*` variables, browser configuration, source control, or client request bodies.

Required environment variables:

- `PRODX_FIRST_TENANT_BOOTSTRAP_SECRET`: independently generated random secret with at least 32 characters.
- `PRODX_FIRST_TENANT_BOOTSTRAP_SUBJECT`: exact Supabase Auth subject UUID authorized for first bootstrap.
- `PRODX_FIRST_TENANT_ORGANIZATION_CODE` and `PRODX_FIRST_TENANT_ORGANIZATION_NAME`.
- `PRODX_FIRST_TENANT_STORE_CODE`, `PRODX_FIRST_TENANT_STORE_NAME`, and `PRODX_FIRST_TENANT_STORE_TIMEZONE`.
- `PRODX_FIRST_TENANT_OWNER_USERNAME` and `PRODX_FIRST_TENANT_OWNER_DISPLAY_NAME`.
- `PRODX_FIRST_TENANT_DEVICE_KEY` and `PRODX_FIRST_TENANT_DEVICE_NAME`.

If any value is missing or invalid, the endpoint is hidden and bootstrap remains disabled. Use the operator-approved organization/store/device identifiers; do not assume defaults.

## Request contract

Send the Supabase access JWT as `Authorization: Bearer <access-token>` and the independent operator secret as `X-PRODX-Bootstrap-Secret`. The request body is ignored. The server verifies JWT signature, issuer, audience, and expiry, then requires the verified `sub` to match the configured UUID exactly. Email and user metadata are not identity keys.

The route calls the PostgreSQL bootstrap repository, issues the ordinary POS session through the existing authentication service, resolves the server-side session context, and requires the tenant-scoped Owner role to satisfy the existing Admin Console role contract. The response is private and non-cacheable.

## Database guarantees

Migration `0045_m9_secure_first_tenant_bootstrap.sql` installs a SECURITY DEFINER function with a fixed `pg_catalog` search path. Execution is granted only to `prodx_app`; PUBLIC, anon, authenticated, and service_role are revoked.

A transaction-scoped advisory lock serializes competing first-tenant requests. The function:

1. Rejects incomplete configuration, invalid timezones, an empty permission catalog, or any pre-existing tenant state that is not an exact complete retry for the original subject/configuration.
2. Creates organization, store, UUID-bound user, tenant-scoped Owner role, membership, role assignment, canonical permission grants, and trusted Admin Console device in one transaction.
3. Inserts `first_tenant_bootstrapped` into the security audit table in the same transaction.
4. Returns the original IDs for an exact retry without creating duplicate rows or audit events.

A failed insert (including audit failure) rolls back the entire provisioning transaction. No local password credential is created. No Production records are written merely by deploying this migration.

## Verification and activation

Before configuring the operator secret in a production runtime:

- Apply migrations to an isolated PostgreSQL database.
- Pass the dedicated bootstrap PostgreSQL integration test, including rollback, concurrent first-claim, idempotent retry, canonical permission grant, and second-subject rejection.
- Pass HTTP boundary tests for missing/incorrect secret, unverified or non-allowlisted subject, ignored client-supplied identifiers, server-issued POS session, and Owner/Admin role admission.
- Complete a controlled end-to-end rehearsal with an isolated Supabase Auth user and non-production database.
- Review the PR and required CI/security checks.

Do not enable Production bootstrap or write Production tenant rows until the above evidence and an explicit operator activation decision are present. The bootstrap endpoint is not a general tenant-provisioning API.
