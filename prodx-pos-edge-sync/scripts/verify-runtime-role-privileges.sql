\set ON_ERROR_STOP on

-- Read-only least-privilege verification. Run only after migrations and grant-runtime-role.sql.
DO $least_privilege_gate$
DECLARE
  violation record;
  missing_tables text[];
  owned_table text;
BEGIN
  SELECT array_agg(required.table_name)
    INTO missing_tables
    FROM unnest(ARRAY[
      'products','sales','sale_lines','pos_idempotency','inventory_ledger',
      'inventory_balances','audit_logs','tenant_catalog_versions','terminal_sync_state',
      'terminal_devices','terminal_sequence_failures','terminal_sequence_resolutions',
      'terminal_sequence_retry_failures'
    ]) AS required(table_name)
   WHERE to_regclass(format('public.%I',required.table_name)) IS NULL;
  IF missing_tables IS NOT NULL THEN
    RAISE EXCEPTION 'STAGING_REQUIRED_TABLES_MISSING: %',array_to_string(missing_tables,',');
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_auth_members m
    JOIN pg_roles member_role ON member_role.oid=m.member
    WHERE member_role.rolname IN (
      'prodx_pos_worker','prodx_catalog_writer','prodx_device_admin',
      'prodx_inventory_admin','prodx_rls_auditor','prodx_reconciliation_admin'
    )
  ) THEN
    RAISE EXCEPTION 'STAGING_RUNTIME_ROLE_MEMBERSHIP_NOT_ALLOWED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname IN (
      'prodx_pos_worker','prodx_catalog_writer','prodx_device_admin',
      'prodx_inventory_admin','prodx_rls_auditor'
    ) AND (r.rolsuper OR r.rolbypassrls OR NOT r.rolcanlogin OR r.rolinherit
      OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication)
  ) THEN
    RAISE EXCEPTION 'STAGING_APP_ROLE_ATTRIBUTE_MISMATCH';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname='prodx_reconciliation_admin' AND r.rolcanlogin
      AND NOT r.rolsuper AND r.rolbypassrls AND NOT r.rolinherit
      AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication
  ) THEN
    RAISE EXCEPTION 'STAGING_RECONCILIATION_ROLE_ATTRIBUTE_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles r
    WHERE r.rolname IN (
      'prodx_pos_worker','prodx_catalog_writer','prodx_device_admin',
      'prodx_inventory_admin','prodx_rls_auditor','prodx_reconciliation_admin'
    ) AND (has_schema_privilege(r.rolname,'public','CREATE')
      OR has_database_privilege(r.rolname,current_database(),'CREATE'))
  ) THEN
    RAISE EXCEPTION 'STAGING_RUNTIME_ROLE_DDL_PRIVILEGE_NOT_ALLOWED';
  END IF;

  -- Runtime roles and PUBLIC must never receive grantable table privileges.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    WHERE n.nspname='public'
      AND c.relname IN (
        'products','sales','sale_lines','pos_idempotency','inventory_ledger',
        'inventory_balances','audit_logs','tenant_catalog_versions','terminal_sync_state',
        'terminal_devices','terminal_sequence_failures','terminal_sequence_resolutions',
        'terminal_sequence_retry_failures'
      )
      AND acl.is_grantable
      AND (acl.grantee=0 OR acl.grantee IN (
        SELECT oid FROM pg_roles WHERE rolname IN (
          'prodx_pos_worker','prodx_catalog_writer','prodx_device_admin',
          'prodx_inventory_admin','prodx_rls_auditor','prodx_reconciliation_admin'
        )
      ))
  ) THEN
    RAISE EXCEPTION 'STAGING_RUNTIME_ROLE_GRANT_OPTION_NOT_ALLOWED';
  END IF;

  SELECT c.relname INTO owned_table
  FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_roles r ON r.oid=c.relowner
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
    AND c.relname IN (
      'products','sales','sale_lines','pos_idempotency','inventory_ledger',
      'inventory_balances','audit_logs','tenant_catalog_versions','terminal_sync_state',
      'terminal_devices','terminal_sequence_failures','terminal_sequence_resolutions',
      'terminal_sequence_retry_failures'
    )
    AND r.rolname IN (
      'prodx_pos_worker','prodx_catalog_writer','prodx_device_admin',
      'prodx_inventory_admin','prodx_rls_auditor','prodx_reconciliation_admin'
    ) LIMIT 1;
  IF owned_table IS NOT NULL THEN
    RAISE EXCEPTION 'STAGING_RUNTIME_ROLE_MUST_NOT_OWN_TABLE: %',owned_table;
  END IF;

  -- RLS auditor and cross-tenant reconciliation are read-only on every business table.
  FOR violation IN
    SELECT role_name,table_name,privilege
    FROM (VALUES
      ('prodx_rls_auditor','products'),('prodx_rls_auditor','sales'),
      ('prodx_rls_auditor','sale_lines'),('prodx_rls_auditor','pos_idempotency'),
      ('prodx_rls_auditor','inventory_ledger'),('prodx_rls_auditor','inventory_balances'),
      ('prodx_rls_auditor','audit_logs'),('prodx_rls_auditor','tenant_catalog_versions'),
      ('prodx_rls_auditor','terminal_sync_state'),('prodx_rls_auditor','terminal_devices'),
      ('prodx_rls_auditor','terminal_sequence_failures'),('prodx_rls_auditor','terminal_sequence_resolutions'),
      ('prodx_rls_auditor','terminal_sequence_retry_failures'),
      ('prodx_reconciliation_admin','products'),('prodx_reconciliation_admin','sales'),
      ('prodx_reconciliation_admin','sale_lines'),('prodx_reconciliation_admin','pos_idempotency'),
      ('prodx_reconciliation_admin','inventory_ledger'),('prodx_reconciliation_admin','inventory_balances'),
      ('prodx_reconciliation_admin','audit_logs'),('prodx_reconciliation_admin','tenant_catalog_versions'),
      ('prodx_reconciliation_admin','terminal_sync_state'),('prodx_reconciliation_admin','terminal_devices'),
      ('prodx_reconciliation_admin','terminal_sequence_failures'),('prodx_reconciliation_admin','terminal_sequence_resolutions'),
      ('prodx_reconciliation_admin','terminal_sequence_retry_failures')
    ) AS tables(role_name,table_name)
    CROSS JOIN (VALUES ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) AS privileges(privilege)
    WHERE has_table_privilege(role_name,format('public.%I',table_name),privilege)
  LOOP
    RAISE EXCEPTION 'STAGING_READ_ONLY_ROLE_HAS_WRITE_PRIVILEGE: role %, table %, privilege %',
      violation.role_name,violation.table_name,violation.privilege;
  END LOOP;

  -- POS worker may append financial/audit/recovery records, never rewrite or delete them.
  FOR violation IN
    SELECT table_name,privilege
    FROM (VALUES
      ('sales','UPDATE'),('sales','DELETE'),('sales','TRUNCATE'),('sales','REFERENCES'),('sales','TRIGGER'),
      ('sale_lines','UPDATE'),('sale_lines','DELETE'),('sale_lines','TRUNCATE'),('sale_lines','REFERENCES'),('sale_lines','TRIGGER'),
      ('inventory_ledger','UPDATE'),('inventory_ledger','DELETE'),('inventory_ledger','TRUNCATE'),('inventory_ledger','REFERENCES'),('inventory_ledger','TRIGGER'),
      ('audit_logs','UPDATE'),('audit_logs','DELETE'),('audit_logs','TRUNCATE'),('audit_logs','REFERENCES'),('audit_logs','TRIGGER'),
      ('terminal_sequence_failures','UPDATE'),('terminal_sequence_failures','DELETE'),('terminal_sequence_failures','TRUNCATE'),('terminal_sequence_failures','REFERENCES'),('terminal_sequence_failures','TRIGGER'),
      ('terminal_sequence_resolutions','UPDATE'),('terminal_sequence_resolutions','DELETE'),('terminal_sequence_resolutions','TRUNCATE'),('terminal_sequence_resolutions','REFERENCES'),('terminal_sequence_resolutions','TRIGGER'),
      ('terminal_sequence_retry_failures','UPDATE'),('terminal_sequence_retry_failures','DELETE'),('terminal_sequence_retry_failures','TRUNCATE'),('terminal_sequence_retry_failures','REFERENCES'),('terminal_sequence_retry_failures','TRIGGER'),
      ('products','INSERT'),('products','UPDATE'),('products','DELETE'),('products','TRUNCATE'),('products','REFERENCES'),('products','TRIGGER'),
      ('tenant_catalog_versions','INSERT'),('tenant_catalog_versions','UPDATE'),('tenant_catalog_versions','DELETE'),('tenant_catalog_versions','TRUNCATE'),('tenant_catalog_versions','REFERENCES'),('tenant_catalog_versions','TRIGGER'),
      ('terminal_devices','INSERT'),('terminal_devices','UPDATE'),('terminal_devices','DELETE'),('terminal_devices','TRUNCATE'),('terminal_devices','REFERENCES'),('terminal_devices','TRIGGER'),
      ('inventory_balances','INSERT'),('inventory_balances','UPDATE'),('inventory_balances','DELETE'),('inventory_balances','TRUNCATE'),('inventory_balances','REFERENCES'),('inventory_balances','TRIGGER'),
      ('pos_idempotency','DELETE'),('pos_idempotency','TRUNCATE'),('pos_idempotency','REFERENCES'),('pos_idempotency','TRIGGER'),
      ('terminal_sync_state','DELETE'),('terminal_sync_state','TRUNCATE'),('terminal_sync_state','REFERENCES'),('terminal_sync_state','TRIGGER')
    ) AS forbidden(table_name,privilege)
    WHERE has_table_privilege('prodx_pos_worker',format('public.%I',table_name),privilege)
  LOOP
    RAISE EXCEPTION 'STAGING_POS_WORKER_PRIVILEGE_MISMATCH: table %, privilege %',
      violation.table_name,violation.privilege;
  END LOOP;

  -- Catalog writer may create/update catalog rows but never delete or truncate history.
  FOR violation IN
    SELECT table_name,privilege
    FROM (VALUES
      ('products','DELETE'),('products','TRUNCATE'),('products','REFERENCES'),('products','TRIGGER'),
      ('tenant_catalog_versions','DELETE'),('tenant_catalog_versions','TRUNCATE'),
      ('tenant_catalog_versions','REFERENCES'),('tenant_catalog_versions','TRIGGER')
    ) AS forbidden(table_name,privilege)
    WHERE has_table_privilege('prodx_catalog_writer',format('public.%I',table_name),privilege)
  LOOP
    RAISE EXCEPTION 'STAGING_CATALOG_WRITER_PRIVILEGE_MISMATCH: table %, privilege %',
      violation.table_name,violation.privilege;
  END LOOP;

  -- Device admin may enroll/update devices and append audit events only.
  FOR violation IN
    SELECT table_name,privilege
    FROM (VALUES
      ('terminal_devices','DELETE'),('terminal_devices','TRUNCATE'),('terminal_devices','REFERENCES'),('terminal_devices','TRIGGER'),
      ('audit_logs','UPDATE'),('audit_logs','DELETE'),('audit_logs','TRUNCATE'),('audit_logs','REFERENCES'),('audit_logs','TRIGGER')
    ) AS forbidden(table_name,privilege)
    WHERE has_table_privilege('prodx_device_admin',format('public.%I',table_name),privilege)
  LOOP
    RAISE EXCEPTION 'STAGING_DEVICE_ADMIN_PRIVILEGE_MISMATCH: table %, privilege %',
      violation.table_name,violation.privilege;
  END LOOP;

  -- Inventory admin may append ledger/audit adjustments but cannot rewrite balances or history.
  FOR violation IN
    SELECT table_name,privilege
    FROM (VALUES
      ('inventory_ledger','UPDATE'),('inventory_ledger','DELETE'),('inventory_ledger','TRUNCATE'),('inventory_ledger','REFERENCES'),('inventory_ledger','TRIGGER'),
      ('inventory_balances','INSERT'),('inventory_balances','UPDATE'),('inventory_balances','DELETE'),('inventory_balances','TRUNCATE'),('inventory_balances','REFERENCES'),('inventory_balances','TRIGGER'),
      ('audit_logs','UPDATE'),('audit_logs','DELETE'),('audit_logs','TRUNCATE'),('audit_logs','REFERENCES'),('audit_logs','TRIGGER')
    ) AS forbidden(table_name,privilege)
    WHERE has_table_privilege('prodx_inventory_admin',format('public.%I',table_name),privilege)
  LOOP
    RAISE EXCEPTION 'STAGING_INVENTORY_ADMIN_PRIVILEGE_MISMATCH: table %, privilege %',
      violation.table_name,violation.privilege;
  END LOOP;
END $least_privilege_gate$;
