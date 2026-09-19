-- PRODX POS M3 supervisor authorization persistence.
-- Supervisor grants are tenant-, store-, requester-, session-, action-, and order-bound.

-- Preserve requester identity so refund idempotency can distinguish requester from approver.
ALTER TABLE prodx_refunds
  ADD COLUMN IF NOT EXISTS requester_user_id UUID;

UPDATE prodx_refunds
   SET requester_user_id = authorized_by_user_id
 WHERE requester_user_id IS NULL;

ALTER TABLE prodx_refunds
  ALTER COLUMN requester_user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prodx_refunds_requester_user_org_fk') THEN
    ALTER TABLE prodx_refunds ADD CONSTRAINT prodx_refunds_requester_user_org_fk
      FOREIGN KEY (requester_user_id, organization_id)
      REFERENCES prodx_users(id, organization_id) ON DELETE RESTRICT;
  END IF;
END $$;

-- A scoped session FK needs the user/organization columns in its referenced key.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prodx_sessions_id_org_user_unique') THEN
    ALTER TABLE prodx_sessions ADD CONSTRAINT prodx_sessions_id_org_user_unique
      UNIQUE (id, organization_id, user_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS prodx_supervisor_authorizations (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES prodx_organizations(id) ON DELETE RESTRICT,
  store_id UUID NOT NULL,
  requester_user_id UUID NOT NULL,
  requester_session_id UUID NOT NULL,
  supervisor_user_id UUID NOT NULL,
  action_key TEXT NOT NULL,
  order_id UUID NOT NULL,
  authorization_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT prodx_supervisor_authorizations_store_org_fk
    FOREIGN KEY (store_id, organization_id)
    REFERENCES prodx_stores(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_supervisor_authorizations_requester_user_org_fk
    FOREIGN KEY (requester_user_id, organization_id)
    REFERENCES prodx_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_supervisor_authorizations_requester_session_scope_fk
    FOREIGN KEY (requester_session_id, organization_id, requester_user_id)
    REFERENCES prodx_sessions(id, organization_id, user_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_supervisor_authorizations_supervisor_user_org_fk
    FOREIGN KEY (supervisor_user_id, organization_id)
    REFERENCES prodx_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_supervisor_authorizations_order_store_fk
    FOREIGN KEY (order_id, store_id)
    REFERENCES prodx_orders(id, store_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_supervisor_authorizations_action_valid CHECK (action_key IN ('refund')),
  CONSTRAINT prodx_supervisor_authorizations_hash_not_blank CHECK (length(btrim(authorization_hash)) > 0),
  CONSTRAINT prodx_supervisor_authorizations_expiry_valid CHECK (expires_at > created_at),
  CONSTRAINT prodx_supervisor_authorizations_consumed_valid CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prodx_supervisor_authorizations_store_org_fk') THEN
    ALTER TABLE prodx_supervisor_authorizations ADD CONSTRAINT prodx_supervisor_authorizations_store_org_fk
      FOREIGN KEY (store_id, organization_id) REFERENCES prodx_stores(id, organization_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prodx_supervisor_authorizations_requester_user_org_fk') THEN
    ALTER TABLE prodx_supervisor_authorizations ADD CONSTRAINT prodx_supervisor_authorizations_requester_user_org_fk
      FOREIGN KEY (requester_user_id, organization_id) REFERENCES prodx_users(id, organization_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prodx_supervisor_authorizations_requester_session_scope_fk') THEN
    ALTER TABLE prodx_supervisor_authorizations ADD CONSTRAINT prodx_supervisor_authorizations_requester_session_scope_fk
      FOREIGN KEY (requester_session_id, organization_id, requester_user_id)
      REFERENCES prodx_sessions(id, organization_id, user_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prodx_supervisor_authorizations_supervisor_user_org_fk') THEN
    ALTER TABLE prodx_supervisor_authorizations ADD CONSTRAINT prodx_supervisor_authorizations_supervisor_user_org_fk
      FOREIGN KEY (supervisor_user_id, organization_id) REFERENCES prodx_users(id, organization_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prodx_supervisor_authorizations_order_store_fk') THEN
    ALTER TABLE prodx_supervisor_authorizations ADD CONSTRAINT prodx_supervisor_authorizations_order_store_fk
      FOREIGN KEY (order_id, store_id) REFERENCES prodx_orders(id, store_id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS prodx_supervisor_authorizations_lookup_idx
  ON prodx_supervisor_authorizations (organization_id, store_id, requester_session_id, action_key, order_id, expires_at);

CREATE INDEX IF NOT EXISTS prodx_supervisor_authorizations_expiry_idx
  ON prodx_supervisor_authorizations (expires_at)
  WHERE consumed_at IS NULL;

INSERT INTO prodx_schema_migrations(version)
VALUES ('0016_m3_supervisor_authorization')
ON CONFLICT(version) DO NOTHING;
