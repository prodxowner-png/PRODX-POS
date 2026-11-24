-- 0059: explicitly revoke SECURITY DEFINER RPC execution from Supabase API roles.
-- 0058 revoked PUBLIC only; explicit role revocation is required because Supabase
-- API roles can retain direct grants independently of PUBLIC privileges.
-- The server runtime keeps only the three narrow, tenant-scoped RPCs.

REVOKE ALL ON FUNCTION public.prodx_seed_discount_policy_for_store()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prodx_auth_find_supervisor_by_supabase_subject(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prodx_auth_find_supervisor_credential(UUID, UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prodx_record_security_audit_event(UUID, UUID, UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.prodx_auth_find_supervisor_by_supabase_subject(UUID, UUID, UUID) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_auth_find_supervisor_credential(UUID, UUID, TEXT) TO prodx_app;
GRANT EXECUTE ON FUNCTION public.prodx_record_security_audit_event(UUID, UUID, UUID, TEXT, JSONB) TO prodx_app;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0059_security_revoke_api_role_security_definer')
ON CONFLICT (version) DO NOTHING;
