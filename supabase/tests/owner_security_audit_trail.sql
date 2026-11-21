-- Run after the owner_security_audit_trail migration in a disposable PostgreSQL 17 database.
-- This fixture contains fake IDs and fake IP data only.
\set ON_ERROR_STOP on

begin;

insert into auth.audit_log_entries(instance_id, id, payload, created_at, ip_address)
values (
  gen_random_uuid(),
  gen_random_uuid(),
  '{"action":"login","user_id":"11111111-1111-4111-8111-111111111111","metadata":{"provider":"email"},"ip_address":"203.0.113.9","user_agent":"must-not-leak"}'::json,
  now(),
  '203.0.113.9'
);

insert into public.owner_security_audit_events (
  event_type, outcome, actor_user_id, reason_code, source
) values (
  'owner.authorization.denied',
  'denied',
  '11111111-1111-4111-8111-111111111111',
  'aal2_required',
  'server_verified'
);

do $$
declare
  feed_count integer;
  feed_json text;
begin
  if not (select relrowsecurity and relforcerowsecurity
          from pg_class where oid = 'public.owner_security_audit_events'::regclass) then
    raise exception 'RLS must be enabled and forced';
  end if;

  if has_table_privilege('anon', 'public.owner_security_audit_events', 'SELECT')
     or has_table_privilege('anon', 'public.owner_security_audit_events', 'INSERT')
     or has_table_privilege('anon', 'public.owner_security_audit_events', 'UPDATE')
     or has_table_privilege('anon', 'public.owner_security_audit_events', 'DELETE')
     or has_table_privilege('authenticated', 'public.owner_security_audit_events', 'SELECT')
     or has_table_privilege('authenticated', 'public.owner_security_audit_events', 'INSERT')
     or has_table_privilege('authenticated', 'public.owner_security_audit_events', 'UPDATE')
     or has_table_privilege('authenticated', 'public.owner_security_audit_events', 'DELETE')
     or has_function_privilege('anon', 'public.owner_security_audit_feed(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.owner_security_audit_feed(integer)', 'EXECUTE') then
    raise exception 'browser roles must not access the Owner audit ledger or feed';
  end if;

  if has_table_privilege('service_role', 'public.owner_security_audit_events', 'SELECT')
     or not has_table_privilege('service_role', 'public.owner_security_audit_events', 'INSERT')
     or has_table_privilege('service_role', 'public.owner_security_audit_events', 'UPDATE')
     or has_table_privilege('service_role', 'public.owner_security_audit_events', 'DELETE')
     or not has_function_privilege('service_role', 'public.owner_security_audit_feed(integer)', 'EXECUTE') then
    raise exception 'service_role has incorrect server-only privileges';
  end if;

  if not (select prosecdef from pg_proc
          where oid = 'public.owner_security_audit_feed(integer)'::regprocedure) then
    raise exception 'audit feed must be SECURITY DEFINER';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'owner_security_audit_events'
      and column_name in ('ip_address', 'user_agent', 'payload', 'email', 'password', 'token')
  ) then
    raise exception 'audit ledger must not persist raw credentials or network metadata';
  end if;

  select count(*) into feed_count from public.owner_security_audit_feed(100);
  if feed_count < 2 then
    raise exception 'expected at least 2 sanitized audit events, got %', feed_count;
  end if;

  if exists (
    select 1 from public.owner_security_audit_feed(100)
    where event_type not in ('auth.login', 'owner.authorization.denied')
  ) then
    raise exception 'audit feed returned an unexpected event type';
  end if;

  select coalesce(json_agg(to_jsonb(f))::text, '[]')
    into feed_json
    from public.owner_security_audit_feed(100) as f;
  if feed_json like '%203.0.113.9%'
     or feed_json like '%must-not-leak%'
     or feed_json like '%provider%' then
    raise exception 'sanitized feed leaked raw IP, user-agent, or Auth metadata';
  end if;
end;
$$;

-- Verify the server-only service role can read the sanitized feed through the RPC.
set local role service_role;
insert into public.owner_security_audit_events (
  event_type, outcome, actor_user_id, reason_code, source
) values (
  'owner.authorization.denied',
  'denied',
  '11111111-1111-4111-8111-111111111111',
  'owner_role_required',
  'server_verified'
);
do $$
declare
  feed_count integer;
begin
  select count(*) into feed_count from public.owner_security_audit_feed(100);
  if feed_count < 3 then
    raise exception 'service_role insert or sanitized feed access failed';
  end if;
end;
$$;
reset role;

-- A denied authorization event must carry a non-null reason code.
do $
begin
  begin
    insert into public.owner_security_audit_events (
      event_type, outcome, actor_user_id, reason_code, source
    ) values (
      'owner.authorization.denied',
      'denied',
      '11111111-1111-4111-8111-111111111111',
      null,
      'server_verified'
    );
    raise exception 'NULL denial reason unexpectedly succeeded';
  exception when check_violation then
    null;
  end;
end;
$;

-- Row-level UPDATE/DELETE and statement-level TRUNCATE are rejected even for postgres.
do $$
begin
  begin
    update public.owner_security_audit_events
       set reason_code = 'aal2_required';
    raise exception 'UPDATE unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    delete from public.owner_security_audit_events;
    raise exception 'DELETE unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    execute 'truncate public.owner_security_audit_events';
    raise exception 'TRUNCATE unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

rollback;
