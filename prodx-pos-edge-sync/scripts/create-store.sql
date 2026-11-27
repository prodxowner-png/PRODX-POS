\set ON_ERROR_STOP on
-- Required psql variables: tenant_id, store_id, store_name, actor_id,
-- payload_hash (SHA-256 hex of the canonical Store creation payload).
BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id', true);
WITH created AS (
  INSERT INTO pos_stores(id,tenant_id,name,is_default,active)
  VALUES (:'store_id'::uuid,:'tenant_id'::uuid,:'store_name',false,true)
  RETURNING tenant_id,id,name
)
INSERT INTO audit_logs(
  tenant_id,actor_type,actor_id,action,entity_type,entity_id,
  payload_hash,catalog_version,metadata
)
SELECT tenant_id,'USER',:'actor_id'::uuid,'STORE_CREATED','STORE',id,
       lower(:'payload_hash'),NULL,
       jsonb_build_object('store_id',id,'store_name',name,'allow_negative_stock',false)
FROM created;
COMMIT;
