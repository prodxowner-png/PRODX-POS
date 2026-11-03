-- Run as the actual Worker runtime DB role, not a superuser.
SELECT current_user, r.rolbypassrls, r.rolsuper
FROM pg_roles r WHERE r.rolname=current_user;
DO $$
DECLARE bypasses boolean; is_super boolean;
BEGIN
  SELECT rolbypassrls,rolsuper INTO bypasses,is_super FROM pg_roles WHERE rolname=current_user;
  IF bypasses OR is_super THEN RAISE EXCEPTION 'runtime role must be NOBYPASSRLS and NOSUPERUSER'; END IF;
  IF (SELECT COUNT(DISTINCT c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relname IN ('products','sales','sale_lines','pos_idempotency',
        'inventory_ledger','inventory_balances','audit_logs','tenant_catalog_versions','terminal_sync_state','terminal_devices')) <> 10
  THEN RAISE EXCEPTION 'one or more tenant tables are missing'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname IN ('products','sales','sale_lines','pos_idempotency',
      'inventory_ledger','inventory_balances','audit_logs','tenant_catalog_versions','terminal_sync_state','terminal_devices')
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  ) THEN RAISE EXCEPTION 'RLS ENABLE/FORCE is missing on a tenant table'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname IN ('products','sales','sale_lines','pos_idempotency',
      'inventory_ledger','inventory_balances','audit_logs','tenant_catalog_versions','terminal_sync_state','terminal_devices')
      AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='tenant_isolation')
  ) THEN RAISE EXCEPTION 'tenant_isolation policy is missing on a tenant table'; END IF;
END $$;

SELECT n.nspname AS schema_name,c.relname AS table_name,c.relrowsecurity,c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relname IN ('products','sales','sale_lines','pos_idempotency',
                    'inventory_ledger','inventory_balances','audit_logs','tenant_catalog_versions','terminal_sync_state','terminal_devices')
ORDER BY c.relname;

-- A missing tenant context must expose no tenant rows.
BEGIN;
SELECT set_config('app.current_tenant_id','',true);
SELECT 'products' AS table_name,COUNT(*) FROM products
UNION ALL SELECT 'sales',COUNT(*) FROM sales
UNION ALL SELECT 'sale_lines',COUNT(*) FROM sale_lines
UNION ALL SELECT 'pos_idempotency',COUNT(*) FROM pos_idempotency
UNION ALL SELECT 'inventory_ledger',COUNT(*) FROM inventory_ledger
UNION ALL SELECT 'inventory_balances',COUNT(*) FROM inventory_balances
UNION ALL SELECT 'audit_logs',COUNT(*) FROM audit_logs
UNION ALL SELECT 'tenant_catalog_versions',COUNT(*) FROM tenant_catalog_versions
UNION ALL SELECT 'terminal_sync_state',COUNT(*) FROM terminal_sync_state
UNION ALL SELECT 'terminal_devices',COUNT(*) FROM terminal_devices;
DO $$
DECLARE t text; visible_rows bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','sales','sale_lines','pos_idempotency',
    'inventory_ledger','inventory_balances','audit_logs','tenant_catalog_versions','terminal_sync_state','terminal_devices'] LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I',t) INTO visible_rows;
    IF visible_rows <> 0 THEN RAISE EXCEPTION 'RLS leak: % exposed % rows without tenant context',t,visible_rows; END IF;
  END LOOP;
END $$;
ROLLBACK;
