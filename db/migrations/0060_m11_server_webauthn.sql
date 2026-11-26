-- 0060: server-authoritative WebAuthn credentials, single-use challenges and sessions.
-- Credential/challenge tables are inaccessible to API roles and prodx_app directly;
-- all operations are exposed through narrow SECURITY DEFINER functions.

CREATE TABLE public.prodx_webauthn_credentials (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.prodx_organizations(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL,
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  credential_id text NOT NULL UNIQUE,
  public_key bytea NOT NULL,
  sign_count bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports text[] NOT NULL DEFAULT ARRAY[]::text[] CHECK (transports <@ ARRAY['usb', 'nfc', 'ble', 'internal', 'hybrid', 'smart-card', 'cable']::text[]),
  device_type text NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up boolean NOT NULL DEFAULT false,
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80 AND label !~ '[[:cntrl:]]'),
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT prodx_webauthn_credentials_user_scope_fk
    FOREIGN KEY (user_id, organization_id) REFERENCES public.prodx_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_webauthn_credentials_device_scope_fk
    FOREIGN KEY (device_id, organization_id) REFERENCES public.prodx_devices(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_webauthn_credentials_store_scope_fk
    FOREIGN KEY (store_id, organization_id) REFERENCES public.prodx_stores(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX prodx_webauthn_credentials_user_active_idx
  ON public.prodx_webauthn_credentials (organization_id, store_id, user_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE public.prodx_webauthn_challenges (
  id uuid PRIMARY KEY,
  challenge text NOT NULL UNIQUE CHECK (challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
  purpose text NOT NULL CHECK (purpose IN ('authentication', 'registration')),
  organization_id uuid NOT NULL REFERENCES public.prodx_organizations(id) ON DELETE RESTRICT,
  store_id uuid NOT NULL,
  user_id uuid NOT NULL,
  device_id uuid NOT NULL,
  session_id uuid REFERENCES public.prodx_sessions(id) ON DELETE CASCADE,
  require_admin boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT prodx_webauthn_challenges_user_scope_fk
    FOREIGN KEY (user_id, organization_id) REFERENCES public.prodx_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_webauthn_challenges_device_scope_fk
    FOREIGN KEY (device_id, organization_id) REFERENCES public.prodx_devices(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_webauthn_challenges_store_scope_fk
    FOREIGN KEY (store_id, organization_id) REFERENCES public.prodx_stores(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT prodx_webauthn_challenges_expiry_valid CHECK (expires_at > created_at)
);
CREATE INDEX prodx_webauthn_challenges_expiry_idx ON public.prodx_webauthn_challenges (expires_at);

ALTER TABLE public.prodx_webauthn_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prodx_webauthn_credentials FORCE ROW LEVEL SECURITY;
ALTER TABLE public.prodx_webauthn_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prodx_webauthn_challenges FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.prodx_webauthn_credentials, public.prodx_webauthn_challenges FROM PUBLIC;
REVOKE ALL ON TABLE public.prodx_webauthn_credentials, public.prodx_webauthn_challenges FROM prodx_app;
DO $table_revoke$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.prodx_webauthn_credentials, public.prodx_webauthn_challenges FROM %I', role_name);
    END IF;
  END LOOP;
END
$table_revoke$;

CREATE OR REPLACE FUNCTION public.prodx_webauthn_resolve_login(
  p_organization_code text, p_store_code text, p_device_key text, p_username text
) RETURNS TABLE(organization_id uuid, store_id uuid, device_id uuid, user_id uuid, username text, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
  SELECT o.id, s.id, d.id, u.id, u.username, u.display_name
    FROM public.prodx_organizations o
    JOIN public.prodx_stores s ON s.organization_id = o.id AND lower(s.code) = lower(p_store_code) AND s.active = true
    JOIN public.prodx_devices d ON d.organization_id = o.id AND d.store_id = s.id AND d.device_key = p_device_key AND d.status = 'active'
    JOIN public.prodx_users u ON u.organization_id = o.id AND lower(u.username) = lower(p_username) AND u.status = 'active'
    JOIN public.prodx_store_memberships m ON m.organization_id = o.id AND m.store_id = s.id AND m.user_id = u.id AND m.active = true
    LEFT JOIN public.prodx_user_roles ur ON ur.organization_id = o.id AND ur.store_id = s.id AND ur.user_id = u.id AND ur.active = true
    LEFT JOIN public.prodx_roles r ON r.id = ur.role_id AND r.organization_id = o.id AND r.active = true
   WHERE lower(o.code) = lower(p_organization_code)
     AND NOT EXISTS (SELECT 1 FROM public.prodx_user_credentials uc WHERE uc.user_id = u.id AND uc.locked_until > CURRENT_TIMESTAMP)
   ORDER BY CASE r.role_key WHEN 'owner' THEN 0 WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.prodx_webauthn_list_login_credentials(p_organization_id uuid, p_store_id uuid, p_user_id uuid)
RETURNS TABLE(credential_id text, transports text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.prodx_users u JOIN public.prodx_store_memberships m
      ON m.organization_id = u.organization_id AND m.user_id = u.id AND m.active = true
     WHERE u.id = p_user_id AND u.organization_id = p_organization_id AND u.status = 'active' AND m.store_id = p_store_id
  ) THEN RAISE EXCEPTION 'WebAuthn identity scope is invalid' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT c.credential_id, c.transports FROM public.prodx_webauthn_credentials c
   WHERE c.organization_id = p_organization_id AND c.store_id = p_store_id AND c.user_id = p_user_id
     AND c.revoked_at IS NULL ORDER BY c.created_at;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_webauthn_resolve_registration(p_session_id uuid)
RETURNS TABLE(device_id uuid, username text, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
  SELECT s.device_id, u.username, u.display_name
    FROM public.prodx_sessions s
    JOIN public.prodx_users u ON u.id = s.user_id AND u.organization_id = s.organization_id
    JOIN public.prodx_devices d ON d.id = s.device_id AND d.organization_id = s.organization_id
    JOIN public.prodx_stores st ON st.id = d.store_id AND st.organization_id = d.organization_id
    JOIN public.prodx_store_memberships m ON m.organization_id = s.organization_id AND m.store_id = d.store_id AND m.user_id = s.user_id
   WHERE s.id = p_session_id AND s.user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
     AND s.organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
     AND d.store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
     AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP
     AND u.status = 'active' AND d.status = 'active' AND st.active = true AND m.active = true
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.prodx_webauthn_issue_challenge(
  p_id uuid, p_challenge text, p_purpose text, p_organization_id uuid, p_store_id uuid,
  p_user_id uuid, p_device_id uuid, p_session_id uuid, p_require_admin boolean, p_expires_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
BEGIN
  DELETE FROM public.prodx_webauthn_challenges WHERE expires_at <= CURRENT_TIMESTAMP OR consumed_at IS NOT NULL;
  IF p_purpose NOT IN ('authentication', 'registration') OR p_expires_at <= CURRENT_TIMESTAMP
     OR p_expires_at > CURRENT_TIMESTAMP + INTERVAL '3 minutes'
     OR p_challenge !~ '^[A-Za-z0-9_-]{43,128}$' THEN
    RAISE EXCEPTION 'WebAuthn challenge parameters are invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.prodx_users u
    JOIN public.prodx_store_memberships m ON m.organization_id = u.organization_id AND m.user_id = u.id AND m.store_id = p_store_id AND m.active = true
    JOIN public.prodx_devices d ON d.organization_id = u.organization_id AND d.store_id = p_store_id AND d.id = p_device_id AND d.status = 'active'
    JOIN public.prodx_stores s ON s.organization_id = u.organization_id AND s.id = p_store_id AND s.active = true
    WHERE u.id = p_user_id AND u.organization_id = p_organization_id AND u.status = 'active'
  ) THEN RAISE EXCEPTION 'WebAuthn challenge scope is invalid' USING ERRCODE = '42501'; END IF;
  IF p_purpose = 'registration' AND (
    p_session_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.prodx_sessions ss WHERE ss.id = p_session_id AND ss.organization_id = p_organization_id AND ss.user_id = p_user_id AND ss.device_id = p_device_id AND ss.revoked_at IS NULL AND ss.expires_at > CURRENT_TIMESTAMP)
    OR p_organization_id IS DISTINCT FROM NULLIF(current_setting('app.organization_id', true), '')::uuid
    OR p_store_id IS DISTINCT FROM NULLIF(current_setting('app.store_id', true), '')::uuid
    OR p_user_id IS DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid
  ) THEN RAISE EXCEPTION 'WebAuthn registration requires the authenticated user scope' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.prodx_webauthn_challenges(id, challenge, purpose, organization_id, store_id, user_id, device_id, session_id, require_admin, expires_at)
  VALUES (p_id, p_challenge, p_purpose, p_organization_id, p_store_id, p_user_id, p_device_id, p_session_id, p_require_admin, p_expires_at);
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_webauthn_get_challenge(p_id uuid, p_purpose text)
RETURNS TABLE(challenge text, organization_id uuid, store_id uuid, user_id uuid, device_id uuid, require_admin boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
  SELECT c.challenge, c.organization_id, c.store_id, c.user_id, c.device_id, c.require_admin
    FROM public.prodx_webauthn_challenges c
   WHERE c.id = p_id AND c.purpose = p_purpose AND c.consumed_at IS NULL AND c.expires_at > CURRENT_TIMESTAMP
$function$;

CREATE OR REPLACE FUNCTION public.prodx_webauthn_get_auth_credential(p_challenge_id uuid, p_credential_id text)
RETURNS TABLE(user_id uuid, public_key bytea, sign_count bigint, transports text[], device_type text, backed_up boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
  SELECT c.user_id, c.public_key, c.sign_count, c.transports, c.device_type, c.backed_up
    FROM public.prodx_webauthn_challenges ch
    JOIN public.prodx_webauthn_credentials c ON c.credential_id = p_credential_id
      AND c.organization_id = ch.organization_id AND c.store_id = ch.store_id AND c.user_id = ch.user_id
   WHERE ch.id = p_challenge_id AND ch.purpose = 'authentication' AND ch.consumed_at IS NULL
     AND ch.expires_at > CURRENT_TIMESTAMP AND c.revoked_at IS NULL
$function$;

CREATE OR REPLACE FUNCTION public.prodx_webauthn_complete_authentication(
  p_challenge_id uuid, p_credential_id text, p_new_sign_count bigint, p_session_id uuid,
  p_token_hash text, p_expires_at timestamptz
) RETURNS TABLE(user_id uuid, organization_id uuid, device_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE v_ch public.prodx_webauthn_challenges%ROWTYPE; v_cred public.prodx_webauthn_credentials%ROWTYPE;
BEGIN
  SELECT * INTO v_ch FROM public.prodx_webauthn_challenges WHERE id = p_challenge_id AND purpose = 'authentication' AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WebAuthn challenge is invalid or already consumed' USING ERRCODE = '28000'; END IF;
  SELECT c.* INTO v_cred FROM public.prodx_webauthn_credentials AS c WHERE c.credential_id = p_credential_id AND c.organization_id = v_ch.organization_id AND c.store_id = v_ch.store_id AND c.user_id = v_ch.user_id AND c.revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND OR p_new_sign_count < 0 OR (v_cred.sign_count > 0 AND p_new_sign_count <= v_cred.sign_count) THEN
    RAISE EXCEPTION 'WebAuthn credential counter or scope is invalid' USING ERRCODE = '28000';
  END IF;
  PERFORM 1 FROM public.prodx_users AS u
   WHERE u.id = v_ch.user_id AND u.organization_id = v_ch.organization_id AND u.status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WebAuthn user is no longer active' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.prodx_stores AS s
   WHERE s.id = v_ch.store_id AND s.organization_id = v_ch.organization_id AND s.active = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WebAuthn store is no longer active' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.prodx_devices AS d
   WHERE d.id = v_ch.device_id AND d.organization_id = v_ch.organization_id AND d.store_id = v_ch.store_id AND d.status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WebAuthn device is no longer active' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.prodx_store_memberships AS m
   WHERE m.organization_id = v_ch.organization_id AND m.store_id = v_ch.store_id AND m.user_id = v_ch.user_id AND m.active = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WebAuthn store membership is no longer active' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.prodx_user_credentials AS uc WHERE uc.user_id = v_ch.user_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.prodx_user_credentials AS uc WHERE uc.user_id = v_ch.user_id AND uc.locked_until > CURRENT_TIMESTAMP) THEN
    RAISE EXCEPTION 'WebAuthn account is locked' USING ERRCODE = '42501';
  END IF;
  IF v_ch.require_admin AND NOT EXISTS (
    SELECT 1 FROM public.prodx_user_roles ur JOIN public.prodx_roles r ON r.id = ur.role_id AND r.organization_id = ur.organization_id AND r.active = true
    WHERE ur.organization_id = v_ch.organization_id AND ur.store_id = v_ch.store_id AND ur.user_id = v_ch.user_id AND ur.active = true AND r.role_key IN ('admin', 'owner')
  ) THEN RAISE EXCEPTION 'Administrator role is required' USING ERRCODE = '42501'; END IF;
  IF p_token_hash !~ '^[0-9a-f]{64}$' OR p_expires_at <= CURRENT_TIMESTAMP OR p_expires_at > CURRENT_TIMESTAMP + INTERVAL '8 hours' THEN
    RAISE EXCEPTION 'WebAuthn session parameters are invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.prodx_webauthn_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = v_ch.id;
  UPDATE public.prodx_webauthn_credentials SET sign_count = p_new_sign_count, last_used_at = CURRENT_TIMESTAMP WHERE id = v_cred.id;
  PERFORM public.prodx_auth_reset_failed_attempts(v_ch.user_id, v_ch.organization_id, gen_random_uuid());
  INSERT INTO public.prodx_sessions(id, organization_id, user_id, device_id, token_hash, expires_at)
  VALUES (p_session_id, v_ch.organization_id, v_ch.user_id, v_ch.device_id, p_token_hash, p_expires_at);
  INSERT INTO public.prodx_security_audit_events(id, organization_id, user_id, event_type, metadata)
  VALUES (gen_random_uuid(), v_ch.organization_id, v_ch.user_id, 'AUTH_WEBAUTHN_LOGIN', jsonb_build_object('deviceId', v_ch.device_id));
  RETURN QUERY SELECT v_ch.user_id, v_ch.organization_id, v_ch.device_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_webauthn_record_failed_attempt(p_challenge_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE v_ch public.prodx_webauthn_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_ch FROM public.prodx_webauthn_challenges
   WHERE id = p_challenge_id AND purpose = 'authentication' AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.prodx_webauthn_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = v_ch.id;
  PERFORM public.prodx_auth_record_failed_attempt(v_ch.user_id, v_ch.organization_id, gen_random_uuid());
  INSERT INTO public.prodx_security_audit_events(id, organization_id, user_id, event_type, metadata)
  VALUES (gen_random_uuid(), v_ch.organization_id, v_ch.user_id, 'AUTH_WEBAUTHN_FAILED', jsonb_build_object('challengeId', v_ch.id));
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_webauthn_list_credentials()
RETURNS TABLE(id uuid, credential_id text, label text, transports text[], device_type text, backed_up boolean, created_at timestamptz, last_used_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE v_org uuid := NULLIF(current_setting('app.organization_id', true), '')::uuid; v_store uuid := NULLIF(current_setting('app.store_id', true), '')::uuid; v_user uuid := NULLIF(current_setting('app.user_id', true), '');
BEGIN
  IF v_org IS NULL OR v_store IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'Authenticated WebAuthn context required' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT c.id, c.credential_id, c.label, c.transports, c.device_type, c.backed_up, c.created_at, c.last_used_at
    FROM public.prodx_webauthn_credentials c WHERE c.organization_id = v_org AND c.store_id = v_store AND c.user_id = v_user AND c.revoked_at IS NULL ORDER BY c.created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_webauthn_complete_registration(
  p_challenge_id uuid, p_session_id uuid, p_id uuid, p_credential_id text, p_public_key bytea, p_sign_count bigint,
  p_transports text[], p_device_type text, p_backed_up boolean, p_label text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE v_ch public.prodx_webauthn_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_ch FROM public.prodx_webauthn_challenges WHERE id = p_challenge_id AND purpose = 'registration' AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP FOR UPDATE;
  IF NOT FOUND OR v_ch.session_id IS DISTINCT FROM p_session_id
     OR NOT EXISTS (SELECT 1 FROM public.prodx_sessions ss WHERE ss.id = p_session_id AND ss.organization_id = v_ch.organization_id AND ss.user_id = v_ch.user_id AND ss.device_id = v_ch.device_id AND ss.revoked_at IS NULL AND ss.expires_at > CURRENT_TIMESTAMP)
     OR v_ch.organization_id IS DISTINCT FROM NULLIF(current_setting('app.organization_id', true), '')::uuid
     OR v_ch.store_id IS DISTINCT FROM NULLIF(current_setting('app.store_id', true), '')::uuid
     OR v_ch.user_id IS DISTINCT FROM NULLIF(current_setting('app.user_id', true), '')::uuid
     OR NOT EXISTS (SELECT 1 FROM public.prodx_devices d WHERE d.id = v_ch.device_id AND d.organization_id = v_ch.organization_id AND d.store_id = v_ch.store_id AND d.status = 'active')
  THEN RAISE EXCEPTION 'WebAuthn registration challenge is invalid or out of scope' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.prodx_sessions AS ss
   WHERE ss.id = p_session_id AND ss.organization_id = v_ch.organization_id AND ss.user_id = v_ch.user_id
     AND ss.device_id = v_ch.device_id AND ss.revoked_at IS NULL AND ss.expires_at > CURRENT_TIMESTAMP FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WebAuthn registration session is no longer active' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.prodx_users AS u WHERE u.id = v_ch.user_id AND u.organization_id = v_ch.organization_id AND u.status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WebAuthn user is no longer active' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.prodx_stores AS st WHERE st.id = v_ch.store_id AND st.organization_id = v_ch.organization_id AND st.active = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WebAuthn store is no longer active' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.prodx_devices AS d WHERE d.id = v_ch.device_id AND d.organization_id = v_ch.organization_id AND d.store_id = v_ch.store_id AND d.status = 'active' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WebAuthn device is no longer active' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.prodx_store_memberships AS m WHERE m.organization_id = v_ch.organization_id AND m.store_id = v_ch.store_id AND m.user_id = v_ch.user_id AND m.active = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WebAuthn store membership is no longer active' USING ERRCODE = '42501'; END IF;
  IF p_credential_id IS NULL OR length(p_credential_id) NOT BETWEEN 16 AND 2048 OR p_public_key IS NULL OR octet_length(p_public_key) NOT BETWEEN 32 AND 8192
     OR p_sign_count < 0 OR p_device_type NOT IN ('singleDevice', 'multiDevice') OR length(btrim(p_label)) NOT BETWEEN 1 AND 80 THEN
    RAISE EXCEPTION 'WebAuthn credential data is invalid' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM public.prodx_webauthn_credentials c WHERE c.organization_id = v_ch.organization_id AND c.store_id = v_ch.store_id AND c.user_id = v_ch.user_id AND c.revoked_at IS NULL) >= 10 THEN
    RAISE EXCEPTION 'WebAuthn credential limit reached' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.prodx_webauthn_credentials(id, organization_id, store_id, user_id, device_id, credential_id, public_key, sign_count, transports, device_type, backed_up, label)
  VALUES (p_id, v_ch.organization_id, v_ch.store_id, v_ch.user_id, v_ch.device_id, p_credential_id, p_public_key, p_sign_count, COALESCE(p_transports, ARRAY[]::text[]), p_device_type, p_backed_up, btrim(p_label));
  UPDATE public.prodx_webauthn_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = v_ch.id;
  INSERT INTO public.prodx_security_audit_events(id, organization_id, user_id, event_type, metadata)
  VALUES (gen_random_uuid(), v_ch.organization_id, v_ch.user_id, 'AUTH_WEBAUTHN_REGISTERED', jsonb_build_object('deviceId', v_ch.device_id, 'label', btrim(p_label), 'deviceType', p_device_type, 'backedUp', p_backed_up));
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_webauthn_fail_registration(p_challenge_id uuid, p_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE v_ch public.prodx_webauthn_challenges%ROWTYPE;
BEGIN
  SELECT * INTO v_ch FROM public.prodx_webauthn_challenges
   WHERE id = p_challenge_id AND purpose = 'registration' AND session_id = p_session_id
     AND consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP
   FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.prodx_sessions ss WHERE ss.id = p_session_id
      AND ss.organization_id = v_ch.organization_id AND ss.user_id = v_ch.user_id
      AND ss.device_id = v_ch.device_id AND ss.revoked_at IS NULL AND ss.expires_at > CURRENT_TIMESTAMP
  ) THEN RETURN false; END IF;
  UPDATE public.prodx_webauthn_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = v_ch.id;
  INSERT INTO public.prodx_security_audit_events(id, organization_id, user_id, event_type, metadata)
  VALUES (gen_random_uuid(), v_ch.organization_id, v_ch.user_id, 'AUTH_WEBAUTHN_REGISTRATION_FAILED', jsonb_build_object('deviceId', v_ch.device_id));
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_webauthn_rename_credential(p_id uuid, p_label text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_org uuid := NULLIF(current_setting('app.organization_id', true), '')::uuid;
  v_store uuid := NULLIF(current_setting('app.store_id', true), '')::uuid;
  v_user uuid := NULLIF(current_setting('app.user_id', true), '');
  v_previous_label text;
BEGIN
  IF p_label IS NULL OR length(btrim(p_label)) NOT BETWEEN 1 AND 80 OR p_label ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Credential label must be 1-80 printable characters' USING ERRCODE = '22023';
  END IF;
  SELECT c.label INTO v_previous_label FROM public.prodx_webauthn_credentials AS c
   WHERE c.id = p_id AND c.organization_id = v_org AND c.store_id = v_store AND c.user_id = v_user AND c.revoked_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.prodx_webauthn_credentials SET label = btrim(p_label)
   WHERE id = p_id AND organization_id = v_org AND store_id = v_store AND user_id = v_user AND revoked_at IS NULL;
  INSERT INTO public.prodx_security_audit_events(id, organization_id, user_id, event_type, metadata)
  VALUES (gen_random_uuid(), v_org, v_user, 'AUTH_WEBAUTHN_RENAMED', jsonb_build_object('previousLabel', v_previous_label, 'newLabel', btrim(p_label)));
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prodx_webauthn_revoke_credential(p_id uuid, p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_org uuid := NULLIF(current_setting('app.organization_id', true), '')::uuid;
  v_store uuid := NULLIF(current_setting('app.store_id', true), '')::uuid;
  v_user uuid := NULLIF(current_setting('app.user_id', true), '');
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('lost_device', 'compromised', 'replaced', 'manual') THEN
    RAISE EXCEPTION 'WebAuthn revocation reason is invalid' USING ERRCODE = '22023';
  END IF;
  UPDATE public.prodx_webauthn_credentials SET revoked_at = CURRENT_TIMESTAMP
   WHERE id = p_id AND organization_id = v_org AND store_id = v_store AND user_id = v_user AND revoked_at IS NULL;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.prodx_security_audit_events(id, organization_id, user_id, event_type, metadata)
  VALUES (gen_random_uuid(), v_org, v_user, 'AUTH_WEBAUTHN_REVOKED', jsonb_build_object('reason', p_reason));
  RETURN true;
END;
$function$;

DO $privileges$
DECLARE signature text; role_name text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'prodx_webauthn_resolve_login(text,text,text,text)',
    'prodx_webauthn_list_login_credentials(uuid,uuid,uuid)',
    'prodx_webauthn_resolve_registration(uuid)',
    'prodx_webauthn_issue_challenge(uuid,text,text,uuid,uuid,uuid,uuid,uuid,boolean,timestamptz)',
    'prodx_webauthn_get_challenge(uuid,text)',
    'prodx_webauthn_get_auth_credential(uuid,text)',
    'prodx_webauthn_record_failed_attempt(uuid)',
    'prodx_webauthn_complete_authentication(uuid,text,bigint,uuid,text,timestamptz)',
    'prodx_webauthn_list_credentials()',
    'prodx_webauthn_complete_registration(uuid,uuid,uuid,text,bytea,bigint,text[],text,boolean,text)',
    'prodx_webauthn_fail_registration(uuid,uuid)',
    'prodx_webauthn_rename_credential(uuid,text)',
    'prodx_webauthn_revoke_credential(uuid,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', signature);
    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM %I', signature, role_name);
      END IF;
    END LOOP;
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO prodx_app', signature);
  END LOOP;
END
$privileges$;

INSERT INTO public.prodx_schema_migrations(version)
VALUES ('0060_m11_server_webauthn') ON CONFLICT (version) DO NOTHING;
