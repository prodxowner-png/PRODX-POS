-- 0046: make security audit events immutable and retain historical identity references.
-- Audit rows must survive user/organization deletion without FK-driven UPDATEs.
-- Tenant isolation remains enforced by the existing organization_id RLS policy.

DO $constraints$
DECLARE
  constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT conname
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.prodx_security_audit_events'::regclass
       AND contype = 'f'
       AND confrelid IN (
         'public.prodx_organizations'::regclass,
         'public.prodx_users'::regclass
       )
  LOOP
    EXECUTE format(
      'ALTER TABLE public.prodx_security_audit_events DROP CONSTRAINT %I',
      constraint_row.conname
    );
  END LOOP;
END
$constraints$;

COMMENT ON TABLE public.prodx_security_audit_events IS
  'Append-only security audit events. organization_id and user_id are immutable historical identifiers, intentionally not foreign keys so events survive entity deletion.';

CREATE OR REPLACE FUNCTION public.prodx_reject_security_audit_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'prodx_security_audit_events is append-only; % is forbidden', TG_OP
    USING ERRCODE = '55000';
END;
$function$;

REVOKE ALL ON FUNCTION public.prodx_reject_security_audit_event_mutation() FROM PUBLIC;

DO $revoke$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'prodx_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.prodx_reject_security_audit_event_mutation() FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$revoke$;

DROP TRIGGER IF EXISTS prodx_security_audit_events_immutable_guard
  ON public.prodx_security_audit_events;

CREATE TRIGGER prodx_security_audit_events_immutable_guard
  BEFORE UPDATE OR DELETE ON public.prodx_security_audit_events
  FOR EACH ROW
  EXECUTE FUNCTION public.prodx_reject_security_audit_event_mutation();

ALTER TABLE public.prodx_security_audit_events
  ENABLE ALWAYS TRIGGER prodx_security_audit_events_immutable_guard;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0046_security_audit_events_append_only')
ON CONFLICT (version) DO NOTHING;
