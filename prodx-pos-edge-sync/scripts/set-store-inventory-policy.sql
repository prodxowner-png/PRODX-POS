\set ON_ERROR_STOP on
-- Required psql variables: tenant_id, store_id, allow_negative_stock (true/false),
-- actor_id, payload_hash (SHA-256 hex), and change_id (UUID).
BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id', true);
WITH changed AS (
  UPDATE store_inventory_settings
     SET allow_negative_stock=:'allow_negative_stock'::boolean,
         updated_at=now(),
         updated_by=:'actor_id'::uuid
   WHERE tenant_id=:'tenant_id'::uuid
     AND store_id=:'store_id'::uuid
  RETURNING tenant_id,store_id,allow_negative_stock
)
INSERT INTO audit_logs(
  tenant_id,actor_type,actor_id,action,entity_type,entity_id,
  payload_hash,catalog_version,metadata
)
SELECT tenant_id,'USER',:'actor_id'::uuid,'STORE_INVENTORY_POLICY_UPDATED',
       'STORE_INVENTORY_SETTINGS',store_id,lower(:'payload_hash'),NULL,
       jsonb_build_object(
         'store_id',store_id,
         'allow_negative_stock',allow_negative_stock,
         'change_id',:'change_id'::uuid
       )
FROM changed;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM audit_logs
     WHERE tenant_id=:'tenant_id'::uuid
       AND entity_id=:'store_id'::uuid
       AND action='STORE_INVENTORY_POLICY_UPDATED'
       AND metadata->>'change_id'=:'change_id'
  ) THEN
    RAISE EXCEPTION 'STORE_INVENTORY_POLICY_UPDATE_NOT_APPLIED_OR_AUDITED';
  END IF;
END $$;
COMMIT;
