\set ON_ERROR_STOP on
-- CI-only role bootstrap. Each role receives a distinct per-run ephemeral password.
-- Invoke with the six matching *_role_password psql variables; never use in production.
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', 'prodx_pos_worker', :'worker_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prodx_pos_worker') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', 'prodx_catalog_writer', :'catalog_writer_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prodx_catalog_writer') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', 'prodx_device_admin', :'device_admin_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prodx_device_admin') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', 'prodx_inventory_admin', :'inventory_admin_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prodx_inventory_admin') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', 'prodx_rls_auditor', :'rls_auditor_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prodx_rls_auditor') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER BYPASSRLS', 'prodx_reconciliation_admin', :'reconciliation_admin_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prodx_reconciliation_admin') \gexec
