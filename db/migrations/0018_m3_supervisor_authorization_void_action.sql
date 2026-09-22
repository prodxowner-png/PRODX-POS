-- Extend supervisor authorization actions for both refunds and voids.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prodx_supervisor_authorizations_action_valid') THEN
    ALTER TABLE prodx_supervisor_authorizations DROP CONSTRAINT prodx_supervisor_authorizations_action_valid;
  END IF;
  ALTER TABLE prodx_supervisor_authorizations
    ADD CONSTRAINT prodx_supervisor_authorizations_action_valid
    CHECK (action_key IN ('refund','void'));
END $$;

INSERT INTO prodx_schema_migrations(version)
VALUES ('0018_m3_supervisor_authorization_void_action')
ON CONFLICT(version) DO NOTHING;