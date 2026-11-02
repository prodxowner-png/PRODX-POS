-- 0047: server-owned, tenant/store-scoped discount policy and checkout-bound supervisor grants.
-- Keep refund/void authorization semantics while adding a distinct discount command scope.

CREATE TABLE IF NOT EXISTS prodx_discount_policies (
  organization_id UUID NOT NULL REFERENCES prodx_organizations(id) ON DELETE RESTRICT,
  store_id UUID NOT NULL,
  require_supervisor_approval BOOLEAN NOT NULL DEFAULT TRUE,
  max_discount_without_approval_bps INTEGER NOT NULL DEFAULT 1500,
  updated_by_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, store_id),
  CONSTRAINT prodx_discount_policies_store_org_fk
    FOREIGN KEY (store_id, organization_id) REFERENCES prodx_stores(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT prodx_discount_policies_threshold_valid
    CHECK (max_discount_without_approval_bps BETWEEN 0 AND 10000),
  CONSTRAINT prodx_discount_policies_updated_by_org_fk
    FOREIGN KEY (updated_by_user_id, organization_id) REFERENCES prodx_users(id, organization_id) ON DELETE RESTRICT
);

INSERT INTO prodx_discount_policies (organization_id, store_id)
SELECT organization_id, id FROM prodx_stores
ON CONFLICT (organization_id, store_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.prodx_seed_discount_policy_for_store()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  INSERT INTO public.prodx_discount_policies (organization_id, store_id)
  VALUES (NEW.organization_id, NEW.id)
  ON CONFLICT (organization_id, store_id) DO NOTHING;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prodx_stores_seed_discount_policy ON prodx_stores;
CREATE TRIGGER prodx_stores_seed_discount_policy
AFTER INSERT ON prodx_stores
FOR EACH ROW EXECUTE FUNCTION public.prodx_seed_discount_policy_for_store();
REVOKE ALL ON FUNCTION public.prodx_seed_discount_policy_for_store() FROM PUBLIC;

ALTER TABLE prodx_supervisor_authorizations
  ALTER COLUMN order_id DROP NOT NULL;
-- Keep the existing composite order/store FK: NULL order_id is permitted for discount grants,
-- while refund/void grants remain protected by the FK and the command-scope CHECK.
ALTER TABLE prodx_supervisor_authorizations
  DROP CONSTRAINT IF EXISTS prodx_supervisor_authorizations_action_valid;
ALTER TABLE prodx_supervisor_authorizations
  ADD COLUMN IF NOT EXISTS checkout_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS checkout_payload_hash TEXT,
  ADD COLUMN IF NOT EXISTS policy_threshold_bps INTEGER,
  ADD COLUMN IF NOT EXISTS policy_requires_approval BOOLEAN;
ALTER TABLE prodx_supervisor_authorizations
  DROP CONSTRAINT IF EXISTS prodx_supervisor_authorizations_command_scope_valid;
ALTER TABLE prodx_supervisor_authorizations
  ADD CONSTRAINT prodx_supervisor_authorizations_action_valid
    CHECK (action_key IN ('refund', 'void', 'discount')),
  ADD CONSTRAINT prodx_supervisor_authorizations_command_scope_valid CHECK (
    (action_key IN ('refund', 'void') AND order_id IS NOT NULL
      AND checkout_idempotency_key IS NULL AND checkout_payload_hash IS NULL
      AND policy_threshold_bps IS NULL AND policy_requires_approval IS NULL)
    OR
    (action_key = 'discount' AND order_id IS NULL
      AND checkout_idempotency_key IS NOT NULL AND length(btrim(checkout_idempotency_key)) > 0
      AND checkout_payload_hash IS NOT NULL AND checkout_payload_hash ~ '^[0-9a-f]{64}$'
      AND policy_threshold_bps IS NOT NULL AND policy_threshold_bps BETWEEN 0 AND 10000
      AND policy_requires_approval IS TRUE)
  );

INSERT INTO prodx_permissions (id, permission_key, description)
VALUES ('10000000-0000-4000-8000-000000000031', 'pos.discount.approve', 'Approve discounts above the store policy threshold')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO prodx_role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM prodx_roles r
JOIN prodx_permissions p ON p.permission_key = 'pos.discount.approve'
WHERE r.role_key IN ('owner', 'admin', 'manager') AND r.active = TRUE
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;


-- Supervisor credential reads are tenant/store-scoped and must not grant the app
-- role direct access to the credential table.
CREATE OR REPLACE FUNCTION public.prodx_auth_find_supervisor_by_supabase_subject(
  p_organization_id UUID,
  p_store_id UUID,
  p_supabase_subject UUID
)
RETURNS TABLE (user_id UUID, status TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT u.id, u.status
    FROM public.prodx_users u
    JOIN public.prodx_store_memberships m
      ON m.organization_id = u.organization_id
     AND m.user_id = u.id
   WHERE p_organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
     AND p_store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
     AND u.organization_id = p_organization_id
     AND u.supabase_auth_user_id = p_supabase_subject
     AND u.status = 'active'
     AND m.store_id = p_store_id
     AND m.active = TRUE
   LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public.prodx_auth_find_supervisor_by_supabase_subject(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prodx_auth_find_supervisor_by_supabase_subject(UUID, UUID, UUID) TO prodx_app;

CREATE OR REPLACE FUNCTION public.prodx_auth_find_supervisor_credential(
  p_organization_id UUID, p_store_id UUID, p_lookup TEXT
)
RETURNS TABLE("userId" UUID, "organizationId" UUID, status TEXT, "secretHash" TEXT,
              "failedAttempts" INTEGER, "lockedUntil" TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT u.id, u.organization_id, u.status, c.secret_hash, c.failed_attempts, c.locked_until
    FROM public.prodx_users u
    JOIN public.prodx_user_credentials c ON c.user_id = u.id
    JOIN public.prodx_store_memberships m
      ON m.organization_id = u.organization_id AND m.user_id = u.id
   WHERE p_organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
     AND p_store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
     AND u.organization_id = p_organization_id
     AND c.credential_type = 'password'
     AND m.store_id = p_store_id AND m.active = TRUE
     AND (u.id::text = p_lookup OR lower(u.username) = lower(p_lookup))
   LIMIT 1
$function$;
REVOKE ALL ON FUNCTION public.prodx_auth_find_supervisor_credential(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prodx_auth_find_supervisor_credential(UUID, UUID, TEXT) TO prodx_app;

-- Security audit rows are append-only; expose only a narrow tenant-checked append function.
CREATE OR REPLACE FUNCTION public.prodx_record_security_audit_event(
  p_id UUID, p_organization_id UUID, p_user_id UUID, p_event_type TEXT, p_metadata JSONB
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF p_organization_id IS DISTINCT FROM NULLIF(current_setting('app.organization_id', true), '')::uuid
     OR p_event_type IS NULL OR length(btrim(p_event_type)) = 0
     OR p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object'
     OR (p_user_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.prodx_users u
        WHERE u.id = p_user_id AND u.organization_id = p_organization_id
     )) THEN
    RAISE EXCEPTION 'Security audit event scope or payload is invalid' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.prodx_security_audit_events (id, organization_id, user_id, event_type, metadata)
  VALUES (p_id, p_organization_id, p_user_id, p_event_type, p_metadata);
END;
$function$;
REVOKE ALL ON FUNCTION public.prodx_record_security_audit_event(UUID, UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prodx_record_security_audit_event(UUID, UUID, UUID, TEXT, JSONB) TO prodx_app;

-- Cashiers may request ordinary discounts; the approval token is a separate capability.
INSERT INTO prodx_role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM prodx_roles r
JOIN prodx_permissions p ON p.permission_key = 'pos.discount'
WHERE r.role_key = 'cashier' AND r.active = TRUE
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

ALTER TABLE prodx_discount_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prodx_app_tenant_isolation ON prodx_discount_policies;
CREATE POLICY prodx_app_tenant_isolation ON prodx_discount_policies
  FOR ALL TO prodx_app
  USING (
    organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
    AND store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
    AND store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
  );

GRANT SELECT, INSERT, UPDATE ON TABLE prodx_discount_policies TO prodx_app;
GRANT SELECT, INSERT, UPDATE ON TABLE prodx_supervisor_authorizations TO prodx_app;
GRANT USAGE ON SCHEMA public TO prodx_app;

INSERT INTO prodx_schema_migrations(version)
VALUES ('0047_m10_server_discount_authorization')
ON CONFLICT (version) DO NOTHING;
