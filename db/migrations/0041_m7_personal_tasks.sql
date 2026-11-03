-- M7: personal task management migrated from Firebase/Firestore to PostgreSQL.
-- Rows are scoped to the authenticated user, organization and store.
CREATE TABLE IF NOT EXISTS public.prodx_tasks (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.prodx_organizations(id) ON DELETE RESTRICT,
  store_id UUID NOT NULL,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT prodx_tasks_title_not_blank CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT prodx_tasks_description_length CHECK (length(description) <= 1000),
  CONSTRAINT prodx_tasks_store_org_fk FOREIGN KEY (store_id, organization_id)
    REFERENCES public.prodx_stores(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_tasks_user_org_fk FOREIGN KEY (user_id, organization_id)
    REFERENCES public.prodx_users(id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS prodx_tasks_owner_scope_created_idx
  ON public.prodx_tasks (organization_id, store_id, user_id, created_at DESC, id);

ALTER TABLE public.prodx_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prodx_tasks_owner_scope ON public.prodx_tasks;
CREATE POLICY prodx_tasks_owner_scope ON public.prodx_tasks
  FOR ALL TO prodx_app
  USING (
    organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
    AND store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  )
  WITH CHECK (
    organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
    AND store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
    AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  );

REVOKE ALL PRIVILEGES ON TABLE public.prodx_tasks FROM PUBLIC;
DO $$
DECLARE role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.prodx_tasks FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prodx_tasks TO prodx_app;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0041_m7_personal_tasks')
ON CONFLICT (version) DO NOTHING;
