-- Defense-in-depth: ensure service_role can append audit events but cannot read or mutate history.
-- Safe to re-apply after the initial owner_security_audit_trail migration.
revoke all privileges on table public.owner_security_audit_events from service_role;
grant insert on table public.owner_security_audit_events to service_role;
