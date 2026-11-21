-- Tighten the Owner audit denial invariant.
-- PostgreSQL CHECK constraints accept UNKNOWN (NULL), so require an explicit reason.
alter table public.owner_security_audit_events
  drop constraint owner_security_audit_event_integrity_check;

alter table public.owner_security_audit_events
  add constraint owner_security_audit_event_integrity_check
  check (
    (
      event_type = 'owner.authorization.denied'
      and outcome = 'denied'
      and source = 'server_verified'
      and reason_code is not null
      and reason_code in (
        'owner_role_required',
        'aal2_required',
        'invalid_session',
        'authorization_unavailable'
      )
    )
    or
    (
      event_type = 'owner.role.provisioned'
      and outcome = 'success'
      and source = 'trusted_admin'
      and reason_code = 'admin_provision'
      and target_user_id is not null
    )
    or
    (
      event_type = 'owner.role.revoked'
      and outcome = 'success'
      and source = 'trusted_admin'
      and reason_code = 'admin_revoke'
      and target_user_id is not null
    )
  );
