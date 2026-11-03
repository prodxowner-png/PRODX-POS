\set ON_ERROR_STOP on
-- CI-only role bootstrap. The shared password is ephemeral and never used in production.
-- Invoke with: psql ... -v ci_role_password="$CI_ROLE_PASSWORD" -f scripts/create-ci-roles.sql
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', 'prodx_pos_worker', :'ci_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prodx_pos_worker') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', 'prodx_catalog_writer', :'ci_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prodx_catalog_writer') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', 'prodx_device_admin', :'ci_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prodx_device_admin') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', 'prodx_inventory_admin', :'ci_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prodx_inventory_admin') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', 'prodx_rls_auditor', :'ci_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prodx_rls_auditor') \gexec
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER BYPASSRLS', 'prodx_reconciliation_admin', :'ci_role_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='prodx_reconciliation_admin') \gexec
