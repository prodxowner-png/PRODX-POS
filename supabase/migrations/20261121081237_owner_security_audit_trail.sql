-- Owner-only security audit ledger and sanitized Auth audit feed.
-- Scope: PRODX-OWNER-AUTH project only. Apply only after explicit approval.

create table public.owner_security_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  event_type text not null,
  outcome text not null,
  actor_user_id uuid,
  target_user_id uuid,
  request_id uuid not null default gen_random_uuid(),
  reason_code text,
  source text not null,
  constraint owner_security_audit_event_type_check
    check (event_type in (
      'owner.authorization.denied',
      'owner.role.provisioned',
      'owner.role.revoked'
    )),
  constraint owner_security_audit_outcome_check
    check (outcome in ('denied', 'success')),
  constraint owner_security_audit_source_check
    check (source in ('server_verified', 'trusted_admin')),
  constraint owner_security_audit_reason_check
    check (
      reason_code is null or reason_code in (
        'owner_role_required',
        'aal2_required',
        'invalid_session',
        'authorization_unavailable',
        'admin_provision',
        'admin_revoke'
      )
    ),
  constraint owner_security_audit_event_integrity_check
    check (
      (event_type = 'owner.authorization.denied'
        and outcome = 'denied'
        and source = 'server_verified'
        and reason_code in (
          'owner_role_required',
          'aal2_required',
          'invalid_session',
          'authorization_unavailable'
        ))
      or
      (event_type = 'owner.role.provisioned'
        and outcome = 'success'
        and source = 'trusted_admin'
        and reason_code = 'admin_provision'
        and target_user_id is not null)
      or
      (event_type = 'owner.role.revoked'
        and outcome = 'success'
        and source = 'trusted_admin'
        and reason_code = 'admin_revoke'
        and target_user_id is not null)
    )
);

create index owner_security_audit_events_occurred_idx
  on public.owner_security_audit_events (occurred_at desc, id desc);
create index owner_security_audit_events_actor_idx
  on public.owner_security_audit_events (actor_user_id, occurred_at desc)
  where actor_user_id is not null;

alter table public.owner_security_audit_events enable row level security;
alter table public.owner_security_audit_events force row level security;

revoke all on table public.owner_security_audit_events from public, anon, authenticated;
grant insert on table public.owner_security_audit_events to service_role;

create function public.reject_owner_security_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'owner_security_audit_events is append-only';
end;
$$;

revoke all on function public.reject_owner_security_audit_mutation() from public, anon, authenticated, service_role;

create trigger owner_security_audit_no_row_mutation
  before update or delete on public.owner_security_audit_events
  for each row execute function public.reject_owner_security_audit_mutation();

create trigger owner_security_audit_no_truncate
  before truncate on public.owner_security_audit_events
  for each statement execute function public.reject_owner_security_audit_mutation();

-- Auth Audit Logs are maintained by Supabase Auth. Never return raw payload,
-- IP address, user agent, or arbitrary metadata to the Owner Console.
create function public.owner_security_audit_feed(p_limit integer default 100)
returns table (
  event_id uuid,
  occurred_at timestamptz,
  event_type text,
  actor_user_id uuid,
  outcome text,
  reason_code text,
  source text
)
language sql
stable
security definer
set search_path = pg_catalog
set row_security = off
as $$
  with auth_events as (
    select
      a.id as event_id,
      a.created_at as occurred_at,
      ('auth.' || coalesce(nullif(a.payload ->> 'action', ''), 'unknown'))::text as event_type,
      case
        when (a.payload ->> 'user_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (a.payload ->> 'user_id')::uuid
        else null
      end as actor_user_id,
      null::text as outcome,
      null::text as reason_code,
      'supabase_auth'::text as source
    from auth.audit_log_entries as a
    where a.created_at is not null
      and a.payload ->> 'action' in (
        'login',
        'logout',
        'factor_in_progress',
        'factor_unenrolled',
        'challenge_created',
        'verification_attempted',
        'factor_deleted',
        'factor_updated',
        'mfa_code_login',
        'generate_recovery_codes',
        'recovery_codes_deleted'
      )
  ),
  owner_events as (
    select
      e.id as event_id,
      e.occurred_at,
      e.event_type,
      e.actor_user_id,
      e.outcome,
      e.reason_code,
      e.source
    from public.owner_security_audit_events as e
  )
  select combined.event_id, combined.occurred_at, combined.event_type,
         combined.actor_user_id, combined.outcome, combined.reason_code,
         combined.source
  from (
    select * from auth_events
    union all
    select * from owner_events
  ) as combined
  order by combined.occurred_at desc, combined.event_id desc
  limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

revoke all on function public.owner_security_audit_feed(integer)
  from public, anon, authenticated;
grant execute on function public.owner_security_audit_feed(integer)
  to service_role;

comment on table public.owner_security_audit_events is
  'Append-only Owner authorization and trusted role administration events; no POS business data.';
comment on function public.owner_security_audit_feed(integer) is
  'Server-only sanitized projection of Supabase Auth Audit Logs and Owner security events.';
