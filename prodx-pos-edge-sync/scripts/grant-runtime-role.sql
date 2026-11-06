\set ON_ERROR_STOP on

-- Run as a database administrator after creating these six LOGIN roles.
-- Application roles are NOINHERIT/NOSUPERUSER/NOBYPASSRLS and must not own tables.
-- Only prodx_reconciliation_admin has BYPASSRLS; it is read-only and never a Worker role.
ALTER ROLE prodx_pos_worker LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
ALTER ROLE prodx_catalog_writer LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
ALTER ROLE prodx_device_admin LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
ALTER ROLE prodx_inventory_admin LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
ALTER ROLE prodx_rls_auditor LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
ALTER ROLE prodx_reconciliation_admin LOGIN NOINHERIT NOSUPERUSER BYPASSRLS;

SELECT format('GRANT CONNECT ON DATABASE %I TO prodx_pos_worker',current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO prodx_catalog_writer',current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO prodx_device_admin',current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO prodx_inventory_admin',current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO prodx_rls_auditor',current_database()) \gexec
SELECT format('GRANT CONNECT, TEMP ON DATABASE %I TO prodx_reconciliation_admin',current_database()) \gexec
GRANT USAGE ON SCHEMA public TO prodx_pos_worker,prodx_catalog_writer,prodx_device_admin,prodx_inventory_admin,prodx_rls_auditor,prodx_reconciliation_admin;

-- POS Worker: only the reads and transactional writes required by checkout.
GRANT SELECT ON products,tenant_catalog_versions,terminal_devices TO prodx_pos_worker;
GRANT SELECT,INSERT,UPDATE ON pos_idempotency,terminal_sync_state TO prodx_pos_worker;
GRANT SELECT ON inventory_balances TO prodx_pos_worker;
GRANT SELECT,INSERT ON sales TO prodx_pos_worker;
GRANT INSERT ON sale_lines,inventory_ledger,audit_logs TO prodx_pos_worker;
-- Edge Sync records and resolves origin-authoritative failed terminal sequences.
-- Both tables are append-only; the Worker needs tenant-scoped SELECT + INSERT only.
GRANT SELECT,INSERT ON terminal_sequence_failures,terminal_sequence_resolutions TO prodx_pos_worker;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO prodx_pos_worker;
-- Re-run the sequence GRANT after any later migration that adds a serial/bigserial column.

-- Catalog mutation is intentionally disabled in this Edge Sync deployment.
-- Revoke legacy direct grants before restoring the read-only policy; GRANT SELECT
-- alone does not remove INSERT/UPDATE privileges left by an earlier provisioning run.
-- No authenticated catalog-writer route currently binds a verified operator UUID
-- to the mutation transaction and its immutable audit_logs event.
REVOKE ALL PRIVILEGES ON TABLE products,tenant_catalog_versions FROM prodx_catalog_writer;
GRANT SELECT ON products,tenant_catalog_versions TO prodx_catalog_writer;

-- Device enrollment/revocation runs separately and must set app.current_tenant_id.
GRANT SELECT,INSERT,UPDATE ON terminal_devices TO prodx_device_admin;
GRANT INSERT ON audit_logs TO prodx_device_admin;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO prodx_device_admin;

-- Initial stock and audited inventory adjustments are separate from POS checkout.
GRANT SELECT ON products TO prodx_inventory_admin;
GRANT SELECT,INSERT ON inventory_ledger TO prodx_inventory_admin;
GRANT SELECT ON inventory_balances TO prodx_inventory_admin;
GRANT INSERT ON audit_logs TO prodx_inventory_admin;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO prodx_inventory_admin;

-- Read-only tenant-scoped role for RLS smoke tests; never use it as the Worker role.
GRANT SELECT ON products,sales,sale_lines,pos_idempotency,inventory_ledger,
  inventory_balances,audit_logs,tenant_catalog_versions,terminal_sync_state,terminal_devices,
  terminal_sequence_failures,terminal_sequence_resolutions
TO prodx_rls_auditor;

-- Privileged read-only reconciliation role. BYPASSRLS is intentional for cross-tenant
-- audits only; keep its credentials out of Workers and application runtimes.
GRANT SELECT ON products,sales,sale_lines,pos_idempotency,inventory_ledger,
  inventory_balances,audit_logs,tenant_catalog_versions,terminal_sync_state,terminal_devices,
  terminal_sequence_failures,terminal_sequence_resolutions
TO prodx_reconciliation_admin;

-- Trigger functions are executable only by the roles that can cause their triggers.
GRANT EXECUTE ON FUNCTION apply_inventory_ledger_delta() TO prodx_pos_worker,prodx_inventory_admin;
GRANT EXECUTE ON FUNCTION increment_product_version() TO prodx_catalog_writer;
GRANT EXECUTE ON FUNCTION bump_tenant_catalog_version() TO prodx_catalog_writer;

-- Fail the permission gate if an unaudited catalog mutation path is reintroduced.
DO $$
BEGIN
  IF NOT has_table_privilege('prodx_catalog_writer','public.products','SELECT') THEN
    RAISE EXCEPTION 'catalog writer must retain product read access';
  END IF;
  IF has_table_privilege('prodx_catalog_writer','public.products','INSERT')
     OR has_table_privilege('prodx_catalog_writer','public.products','UPDATE')
     OR has_table_privilege('prodx_catalog_writer','public.products','DELETE')
     OR has_table_privilege('prodx_catalog_writer','public.tenant_catalog_versions','INSERT')
     OR has_table_privilege('prodx_catalog_writer','public.tenant_catalog_versions','UPDATE')
     OR has_table_privilege('prodx_catalog_writer','public.tenant_catalog_versions','DELETE') THEN
    RAISE EXCEPTION 'unaudited catalog writer mutation privilege detected';
  END IF;
END $$;
