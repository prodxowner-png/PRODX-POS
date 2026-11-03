\set ON_ERROR_STOP on
-- Required psql variables: tenant_id, terminal_id, fingerprint (SHA-256 hex), actor_id, payload_hash.
BEGIN;
SELECT set_config('app.current_tenant_id', :'tenant_id', true);
WITH revoked AS (
  UPDATE terminal_devices
     SET active=false,revoked_at=now()
   WHERE tenant_id=:'tenant_id'::uuid
     AND terminal_id=:'terminal_id'::uuid
     AND cert_fingerprint_sha256=replace(lower(:'fingerprint'),':','')
  RETURNING tenant_id,terminal_id,cert_fingerprint_sha256
)
INSERT INTO audit_logs(tenant_id,actor_type,actor_id,action,entity_type,entity_id,payload_hash,catalog_version,metadata)
SELECT tenant_id,'USER',:'actor_id'::uuid,'TERMINAL_CERTIFICATE_REVOKED',
       'TERMINAL_DEVICE_CERTIFICATE',terminal_id,lower(:'payload_hash'),NULL,
       jsonb_build_object('terminal_id',terminal_id,'cert_fingerprint_sha256',cert_fingerprint_sha256)
FROM revoked;
COMMIT;
