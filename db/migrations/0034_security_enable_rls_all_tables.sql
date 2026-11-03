-- Security hardening: Explicitly enable Row Level Security (RLS) on PRODX-owned tables.
-- Shared public-schema tables belonging to other applications (for example the Owner
-- Console's public.user_roles) must retain their independently managed RLS policies.
-- Combined with 0033_security_prodx_app_role and 0036_security_tenant_store_rls,
-- POS-owned tables use the dedicated runtime role and explicit policies.

DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname LIKE 'prodx\_%' ESCAPE '\'
      AND c.relname NOT IN ('prodx_schema_migrations', 'prodx_migration_lock')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  END LOOP;
END
$$;

INSERT INTO prodx_schema_migrations(version)
VALUES ('0034_security_enable_rls_all_tables')
ON CONFLICT(version) DO NOTHING;
