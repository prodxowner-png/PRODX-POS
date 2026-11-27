-- 0061: the store-seeding function is trigger-only and must not be callable by the runtime role.
-- Keep the SECURITY DEFINER function available to its owning trigger, but revoke direct execution.
REVOKE ALL ON FUNCTION public.prodx_seed_discount_policy_for_store() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prodx_seed_discount_policy_for_store() FROM prodx_app;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0061_security_revoke_runtime_trigger_function')
ON CONFLICT (version) DO NOTHING;
