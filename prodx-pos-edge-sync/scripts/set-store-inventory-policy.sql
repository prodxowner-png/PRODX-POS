\set ON_ERROR_STOP on
-- Required psql variables: tenant_id, store_id, allow_negative_stock (true/false),
-- actor_id, payload_hash (SHA-256 hex), and change_id (UUID).
BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id', true);
SELECT set_config('app.inventory_store_id', :'store_id', true);
SELECT set_config('app.inventory_change_id', :'change_id', true);
UPDATE store_inventory_settings
   SET allow_negative_stock=:'allow_negative_stock'::boolean,
       updated_at=now(),
       updated_by=:'actor_id'::uuid,
       last_change_hash=lower(:'payload_hash'),
       last_change_id=:'change_id'::uuid
 WHERE tenant_id=:'tenant_id'::uuid
   AND store_id=:'store_id'::uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM audit_logs
     WHERE tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid
       AND entity_id=NULLIF(current_setting('app.inventory_store_id',true),'')::uuid
       AND action='STORE_INVENTORY_POLICY_UPDATED'
       AND metadata->>'change_id'=current_setting('app.inventory_change_id',true)
  ) THEN
    RAISE EXCEPTION 'STORE_INVENTORY_POLICY_UPDATE_NOT_APPLIED_OR_AUDITED';
  END IF;
END $$;
COMMIT;
