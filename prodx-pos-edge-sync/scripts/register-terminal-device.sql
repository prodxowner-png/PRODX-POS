\set ON_ERROR_STOP on
-- Required psql variables: tenant_id, terminal_id, store_id, fingerprint (SHA-256 hex), actor_id, payload_hash.
BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id', true);
WITH enrolled AS (
  INSERT INTO terminal_devices(tenant_id,terminal_id,store_id,cert_fingerprint_sha256,active,not_before,not_after,revoked_at)
  VALUES (:'tenant_id'::uuid,:'terminal_id'::uuid,:'store_id'::uuid,replace(lower(:'fingerprint'),':',''),true,now(),NULL,NULL)
  ON CONFLICT (tenant_id,terminal_id,cert_fingerprint_sha256)
  DO UPDATE SET store_id=EXCLUDED.store_id,active=true,not_before=now(),not_after=NULL,revoked_at=NULL
  RETURNING tenant_id,terminal_id,store_id,cert_fingerprint_sha256
)
INSERT INTO audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,payload_hash,catalog_version,metadata)
SELECT tenant_id,'USER',:'actor_id'::uuid,'TERMINAL_CERTIFICATE_ENROLLED',
       'TERMINAL_DEVICE_CERTIFICATE',terminal_id,lower(:'payload_hash'),NULL,
       jsonb_build_object('terminal_id',terminal_id,'store_id',store_id,'cert_fingerprint_sha256',cert_fingerprint_sha256)
FROM enrolled;
COMMIT;
