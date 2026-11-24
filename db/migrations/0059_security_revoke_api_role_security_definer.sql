-- 0059: explicitly revoke SECURITY DEFINER RPC execution from Supabase API roles.
-- 0058 revoked PUBLIC only; explicit role revocation is required because Supabase
-- API roles can retain direct grants independently of PUBLIC privileges.
-- The server runtime keeps only the three narrow, tenant-scoped RPCs.
--
-- Plain PostgreSQL CI databases do not provision Supabase's API roles. Revoke
-- from each role when present; on Supabase all three roles exist and are revoked.

REVOKE ALL ON FUNCTION public.prodx_seed_discount_policy_for_store() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_auth_find_supervisor_by_supabase_subject(UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_auth_find_supervisor_credential(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_record_security_audit_event(UUID, UUID, UUID, TEXT, JSONB) FROM PUBLIC;

DO $migration$
DECLARE
  api_role TEXT;
  function_signature TEXT;
  api_roles TEXT[] := ARRAY['anon', 'authenticated', 'service_role'];
  protected_functions TEXT[] := ARRAY[
    'prodx_seed_discount_policy_for_store()',
    'prodx_auth_find_supervisor_by_supabase_subject(UUID, UUID, UUID)',
    'prodx_auth_find_supervisor_credential(UUID, UUID, TEXT)',
    'prodx_record_security_audit_event(UUID, UUID, UUID, TEXT, JSONB)'
  ];
BEGIN
  FOREACH api_role IN ARRAY api_roles LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      FOREACH function_signature IN ARRAY protected_functions LOOP
        EXECUTE format(
          'REVOKE ALL ON FUNCTION public.%s FROM %I',
          function_signature,
          api_role
        );
      END LOOP;
    END IF;
  END LOOP;
END
$migration$;

GRANT EXECUTE ON FUNCTION public.prodx_auth_find_supervisor_by_supabase_subject(UUID, UUID, UUID) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_auth_find_supervisor_credential(UUID, UUID, TEXT) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_record_security_audit_event(UUID, UUID, UUID, TEXT, JSONB) TO prodx_app;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0059_security_revoke_api_role_security_definer')
ON CONFLICT (version) DO NOTHING;
