import type { Express, NextFunction, Request, Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import type { SqlExecutor } from '../auth/postgres-repository.ts';
import { hashSessionToken, type SessionIssuer } from '../auth/session.ts';
import { checkLoginThrottle, recordLoginFailure } from '../auth/login-rate-limit.ts';
import { runWithRequestContext } from './request-context-storage.ts';

const jsonError = (request: Request, response: Response, status: number, code: string, message: string) =>
  response.status(status).json({ error: { code, message, requestId: request.id } });
const asyncRoute = (handler: (request: Request, response: Response) => Promise<void>) =>
  (request: Request, response: Response, next: NextFunction): void => { handler(request, response).catch(next); };
const readObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const readString = (value: unknown, max = 256): string | null =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max ? value.trim() : null;
const readLabel = (value: unknown): string | null => {
  const label = readString(value, 80);
  return label && !/[\u0000-\u001f\u007f]/.test(label) ? label : null;
};
const bearerToken = (request: Request): string | null => {
  const header = request.header('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
};

type WebAuthnConfig = { rpId: string; rpName: string; origins: string[] };
type WebAuthnConfigResult = { config: WebAuthnConfig | null; error?: string };
const resolveConfig = (env: NodeJS.ProcessEnv = process.env): WebAuthnConfigResult => {
  const rpId = env.WEBAUTHN_RP_ID?.trim().toLowerCase();
  const rpName = env.WEBAUTHN_RP_NAME?.trim() || 'PRODX POS';
  const origins = (env.WEBAUTHN_ORIGIN ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (!rpId || !origins.length || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(rpId) || rpId.includes('..')) {
    return { config: null, error: 'WebAuthn RP ID and exact allowed origins are not configured.' };
  }
  try {
    const normalized = [...new Set(origins.map((origin) => {
      const url = new URL(origin);
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.origin !== origin || (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) ||
          !(url.hostname === rpId || url.hostname.endsWith(`.${rpId}`))) throw new Error('Invalid WebAuthn origin configuration.');
      return url.origin;
    }))];
    if (normalized.length !== origins.length) return { config: null, error: 'WebAuthn origins must be unique exact origins.' };
    return { config: { rpId, rpName, origins: normalized } };
  } catch {
    return { config: null, error: 'WebAuthn origin configuration is invalid.' };
  }
};
const requestOriginAllowed = (request: Request, config: WebAuthnConfig, allowMissing = false): boolean => {
  const origin = request.header('origin');
  return origin ? config.origins.includes(origin) : allowMissing;
};
const uuidBytes = (id: string): Uint8Array => new Uint8Array(Buffer.from(id.replace(/-/g, ''), 'hex'));
const challengeValue = (): string => randomBytes(32).toString('base64url');
const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const expiresAt = (): Date => new Date(Date.now() + 2 * 60_000);
const isStringArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export const registerWebAuthnRoutes = (app: Express, db: SqlExecutor, sessions: SessionIssuer): void => {
  app.get('/auth/webauthn/status', (_request, response) => {
    const { config, error } = resolveConfig();
    response.json({ enabled: Boolean(config), rpId: config?.rpId ?? null, error: config ? null : error });
  });

  app.post('/auth/webauthn/login/options', asyncRoute(async (request, response) => {
    const { config } = resolveConfig();
    if (!config) { jsonError(request, response, 503, 'WEBAUTHN_UNAVAILABLE', 'Passkey authentication is not configured.'); return; }
    if (!requestOriginAllowed(request, config)) { jsonError(request, response, 403, 'WEBAUTHN_ORIGIN_REJECTED', 'Request origin is not allowed.'); return; }
    const body = readObject(request.body);
    const organizationSlug = readString(body?.organizationSlug);
    const storeCode = readString(body?.storeCode);
    const registerId = readString(body?.registerId);
    const username = readString(body?.username);
    if (!organizationSlug || !storeCode || !registerId || !username) {
      jsonError(request, response, 400, 'WEBAUTHN_REQUEST_INVALID', 'organizationSlug, storeCode, registerId and username are required.'); return;
    }
    const throttle = await checkLoginThrottle(db, request.ip || 'unknown');
    if (!throttle.allowed) { response.setHeader('retry-after', String(throttle.retryAfterSeconds ?? 60)); jsonError(request, response, 429, 'AUTH_RATE_LIMITED', 'Too many authentication attempts.'); return; }
    const identities = await db.query<{ organization_id: string; store_id: string; device_id: string; user_id: string; username: string; display_name: string }>(
      'SELECT * FROM public.prodx_webauthn_resolve_login($1, $2, $3, $4)', [organizationSlug, storeCode, registerId, username],
    );
    const identity = identities[0];
    if (!identity) { await recordLoginFailure(db, request.ip || 'unknown'); jsonError(request, response, 401, 'AUTHENTICATION_FAILED', 'Invalid credentials or store scope.'); return; }
    const requireAdmin = body?.requireAdminRole === true || ['ADMIN-CONSOLE', 'ADMIN_CONSOLE', 'TERM-ADMIN'].includes(registerId.toUpperCase());
    const registered = await db.query<{ credential_id: string; transports: string[] }>(
      'SELECT * FROM public.prodx_webauthn_list_login_credentials($1::uuid, $2::uuid, $3::uuid)',
      [identity.organization_id, identity.store_id, identity.user_id],
    );
    if (!registered.length) { await recordLoginFailure(db, request.ip || 'unknown'); jsonError(request, response, 401, 'AUTHENTICATION_FAILED', 'Authentication failed. Check your account and store details.'); return; }
    const challenge = challengeValue();
    const challengeId = randomUUID();
    const expiry = expiresAt();
    const options = await generateAuthenticationOptions({
      rpID: config.rpId,
      challenge,
      allowCredentials: registered.map((item) => ({ id: item.credential_id, transports: item.transports })),
      userVerification: 'required',
      timeout: 60_000,
    });
    await db.query('SELECT public.prodx_webauthn_issue_challenge($1::uuid,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::uuid,$9,$10::timestamptz)',
      [challengeId, challenge, 'authentication', identity.organization_id, identity.store_id, identity.user_id, identity.device_id, null, requireAdmin, expiry.toISOString()]);
    response.setHeader('Cache-Control', 'no-store');
    response.json({ challengeId, options });
  }));

  app.post('/auth/webauthn/login/verify', asyncRoute(async (request, response) => {
    const { config } = resolveConfig();
    if (!config) { jsonError(request, response, 503, 'WEBAUTHN_UNAVAILABLE', 'Passkey authentication is not configured.'); return; }
    if (!requestOriginAllowed(request, config)) { jsonError(request, response, 403, 'WEBAUTHN_ORIGIN_REJECTED', 'Request origin is not allowed.'); return; }
    const body = readObject(request.body);
    const challengeId = readString(body?.challengeId, 64);
    if (!challengeId || !isUuid(challengeId)) { jsonError(request, response, 400, 'WEBAUTHN_REQUEST_INVALID', 'A valid challengeId is required.'); return; }
    const assertion = readObject(body?.response) as unknown as AuthenticationResponseJSON | null;
    if (!assertion || typeof assertion.id !== 'string' || !assertion.response || typeof assertion.response !== 'object') {
      jsonError(request, response, 400, 'WEBAUTHN_REQUEST_INVALID', 'A challengeId and WebAuthn assertion are required.'); return;
    }
    const throttle = await checkLoginThrottle(db, request.ip || 'unknown');
    if (!throttle.allowed) { response.setHeader('retry-after', String(throttle.retryAfterSeconds ?? 60)); jsonError(request, response, 429, 'AUTH_RATE_LIMITED', 'Too many authentication attempts.'); return; }
    const challenges = await db.query<{ challenge: string; organization_id: string; store_id: string; user_id: string; device_id: string; require_admin: boolean }>(
      "SELECT * FROM public.prodx_webauthn_get_challenge($1::uuid, 'authentication')", [challengeId],
    );
    const challenge = challenges[0];
    if (!challenge) { await recordLoginFailure(db, request.ip || 'unknown'); jsonError(request, response, 401, 'WEBAUTHN_CHALLENGE_INVALID', 'Passkey challenge is invalid or expired.'); return; }
    const credentials = await db.query<{ user_id: string; public_key: Buffer; sign_count: string | number; transports: string[]; device_type: string; backed_up: boolean }>(
      "SELECT * FROM public.prodx_webauthn_get_auth_credential($1::uuid, $2)", [challengeId, assertion.id],
    );
    const stored = credentials[0];
    if (!stored || stored.user_id !== challenge.user_id) { await db.query('SELECT public.prodx_webauthn_record_failed_attempt($1::uuid)', [challengeId]); await recordLoginFailure(db, request.ip || 'unknown'); jsonError(request, response, 401, 'WEBAUTHN_CREDENTIAL_INVALID', 'Passkey is not registered for this account.'); return; }
    let verified = false;
    let newCounter = Number(stored.sign_count);
    try {
      const result = await verifyAuthenticationResponse({
        response: assertion,
        expectedChallenge: challenge.challenge,
        expectedOrigin: config.origins,
        expectedRPID: config.rpId,
        requireUserVerification: true,
        credential: { id: assertion.id, publicKey: new Uint8Array(stored.public_key), counter: Number(stored.sign_count), transports: stored.transports as never },
      });
      verified = result.verified && result.authenticationInfo.userVerified && result.authenticationInfo.credentialID === assertion.id;
      newCounter = result.authenticationInfo.newCounter;
    } catch {
      verified = false;
    }
    if (!verified) { await db.query('SELECT public.prodx_webauthn_record_failed_attempt($1::uuid)', [challengeId]); await recordLoginFailure(db, request.ip || 'unknown'); jsonError(request, response, 401, 'WEBAUTHN_VERIFICATION_FAILED', 'Passkey verification failed.'); return; }
    const token = randomBytes(32).toString('base64url');
    const sessionId = randomUUID();
    const sessionExpiry = new Date(Date.now() + 8 * 60 * 60_000);
    try {
      await db.query('SELECT * FROM public.prodx_webauthn_complete_authentication($1::uuid,$2,$3::bigint,$4::uuid,$5,$6::timestamptz)',
        [challengeId, assertion.id, newCounter, sessionId, hashSessionToken(token), sessionExpiry.toISOString()]);
    } catch (error) {
      const databaseCode = error && typeof error === 'object' && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
      if (databaseCode === '28000') {
        await db.query('SELECT public.prodx_webauthn_record_failed_attempt($1::uuid)', [challengeId]);
        await recordLoginFailure(db, request.ip || 'unknown');
        jsonError(request, response, 401, 'WEBAUTHN_VERIFICATION_FAILED', 'Passkey verification failed.');
        return;
      }
      if (databaseCode === '42501') {
        jsonError(request, response, 403, 'WEBAUTHN_SCOPE_REJECTED', 'Passkey is not authorized for this account, store, or terminal.');
        return;
      }
      throw error;
    }
    const principal = await sessions.authenticateBearer(token);
    if (!principal) { await sessions.revokeBearer(token); jsonError(request, response, 401, 'WEBAUTHN_SESSION_REJECTED', 'Passkey session could not be established.'); return; }
    response.setHeader('Cache-Control', 'no-store');
    response.status(200).json({ token, sessionId, expiresAt: sessionExpiry.toISOString() });
  }));

  app.post('/auth/webauthn/registration/options', asyncRoute(async (request, response) => {
    const { config } = resolveConfig();
    if (!config) { jsonError(request, response, 503, 'WEBAUTHN_UNAVAILABLE', 'Passkey registration is not configured.'); return; }
    if (!requestOriginAllowed(request, config)) { jsonError(request, response, 403, 'WEBAUTHN_ORIGIN_REJECTED', 'Request origin is not allowed.'); return; }
    const token = bearerToken(request);
    if (!token) { jsonError(request, response, 401, 'UNAUTHENTICATED', 'Authentication is required.'); return; }
    const principal = await sessions.authenticateBearer(token);
    if (!principal) { jsonError(request, response, 401, 'UNAUTHENTICATED', 'Authentication session is invalid.'); return; }
    const label = readLabel(readObject(request.body)?.label) ?? 'Passkey';
    const rows = await runWithRequestContext({ requestId: request.id, principal }, async () => {
      const identities = await db.query<{ device_id: string; username: string; display_name: string }>(
        'SELECT * FROM public.prodx_webauthn_resolve_registration($1::uuid)', [principal.sessionId],
      );
      const identity = identities[0];
      if (!identity) return null;
      const registered = await db.query<{ credential_id: string; transports: string[] }>(
        'SELECT * FROM public.prodx_webauthn_list_login_credentials($1::uuid, $2::uuid, $3::uuid)',
        [principal.organizationId, principal.storeId, principal.userId],
      );
      return { deviceId: identity.device_id, username: identity.username, displayName: identity.display_name, registered };
    });
    if (!rows) { jsonError(request, response, 401, 'UNAUTHENTICATED', 'Authentication session is invalid.'); return; }
    const challenge = challengeValue();
    const challengeId = randomUUID();
    const expiry = expiresAt();
    const options = await generateRegistrationOptions({
      rpName: config.rpName,
      rpID: config.rpId,
      userID: uuidBytes(principal.userId),
      userName: rows.username,
      userDisplayName: rows.displayName,
      challenge,
      timeout: 60_000,
      attestationType: 'none',
      excludeCredentials: rows.registered.map((item) => ({ id: item.credential_id, transports: item.transports })),
      authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
    });
    await runWithRequestContext({ requestId: request.id, principal }, () => db.query(
      'SELECT public.prodx_webauthn_issue_challenge($1::uuid,$2,$3,$4::uuid,$5::uuid,$6::uuid,$7::uuid,$8::uuid,false,$9::timestamptz)',
      [challengeId, challenge, 'registration', principal.organizationId, principal.storeId, principal.userId, rows.deviceId, principal.sessionId, expiry.toISOString()],
    ));
    response.setHeader('Cache-Control', 'no-store');
    response.json({ challengeId, options, label });
  }));

  app.post('/auth/webauthn/registration/verify', asyncRoute(async (request, response) => {
    const { config } = resolveConfig();
    if (!config) { jsonError(request, response, 503, 'WEBAUTHN_UNAVAILABLE', 'Passkey registration is not configured.'); return; }
    if (!requestOriginAllowed(request, config)) { jsonError(request, response, 403, 'WEBAUTHN_ORIGIN_REJECTED', 'Request origin is not allowed.'); return; }
    const token = bearerToken(request);
    if (!token) { jsonError(request, response, 401, 'UNAUTHENTICATED', 'Authentication is required.'); return; }
    const principal = await sessions.authenticateBearer(token);
    if (!principal) { jsonError(request, response, 401, 'UNAUTHENTICATED', 'Authentication session is invalid.'); return; }
    const body = readObject(request.body);
    const challengeId = readString(body?.challengeId, 64);
    if (!challengeId || !isUuid(challengeId)) { jsonError(request, response, 400, 'WEBAUTHN_REQUEST_INVALID', 'A valid challengeId is required.'); return; }
    const label = readLabel(body?.label) ?? 'Passkey';
    const attestation = readObject(body?.response) as unknown as RegistrationResponseJSON | null;
    if (!challengeId || !attestation || typeof attestation.id !== 'string' || typeof attestation.response !== 'object') {
      jsonError(request, response, 400, 'WEBAUTHN_REQUEST_INVALID', 'A challengeId and WebAuthn registration response are required.'); return;
    }
    const challengeRows = await runWithRequestContext({ requestId: request.id, principal }, () => db.query<{ challenge: string; organization_id: string; store_id: string; user_id: string; device_id: string; require_admin: boolean }>(
      "SELECT * FROM public.prodx_webauthn_get_challenge($1::uuid, 'registration')", [challengeId],
    ));
    const challenge = challengeRows[0];
    if (!challenge || challenge.organization_id !== principal.organizationId || challenge.store_id !== principal.storeId || challenge.user_id !== principal.userId) {
      jsonError(request, response, 401, 'WEBAUTHN_CHALLENGE_INVALID', 'Registration challenge is invalid or expired.'); return;
    }
    let result;
    try {
      result = await verifyRegistrationResponse({ response: attestation, expectedChallenge: challenge.challenge, expectedOrigin: config.origins, expectedRPID: config.rpId, requireUserVerification: true });
    } catch {
      await runWithRequestContext({ requestId: request.id, principal }, () => db.query(
        'SELECT public.prodx_webauthn_fail_registration($1::uuid,$2::uuid)', [challengeId, principal.sessionId],
      ));
      jsonError(request, response, 400, 'WEBAUTHN_VERIFICATION_FAILED', 'Passkey registration verification failed.'); return;
    }
    if (!result.verified || !result.registrationInfo.userVerified) {
      await runWithRequestContext({ requestId: request.id, principal }, () => db.query(
        'SELECT public.prodx_webauthn_fail_registration($1::uuid,$2::uuid)', [challengeId, principal.sessionId],
      ));
      jsonError(request, response, 400, 'WEBAUTHN_VERIFICATION_FAILED', 'Passkey registration verification failed.'); return;
    }
    const info = result.registrationInfo;
    try {
      await runWithRequestContext({ requestId: request.id, principal }, () => db.query(
        'SELECT public.prodx_webauthn_complete_registration($1::uuid,$2::uuid,$3::uuid,$4,$5::bytea,$6::bigint,$7::text[],$8,$9,$10)',
        [challengeId, principal.sessionId, randomUUID(), info.credential.id, Buffer.from(info.credential.publicKey), info.credential.counter, isStringArray(info.credential.transports), info.credentialDeviceType, info.credentialBackedUp, label],
      ));
    } catch {
      await runWithRequestContext({ requestId: request.id, principal }, () => db.query(
        'SELECT public.prodx_webauthn_fail_registration($1::uuid,$2::uuid)', [challengeId, principal.sessionId],
      ));
      jsonError(request, response, 409, 'WEBAUTHN_REGISTRATION_REJECTED', 'Passkey could not be registered. It may already exist or the credential limit was reached.'); return;
    }
    response.status(201).json({ registered: true });
  }));

  app.get('/auth/webauthn/credentials', asyncRoute(async (request, response) => {
    const { config } = resolveConfig();
    if (!config) { jsonError(request, response, 503, 'WEBAUTHN_UNAVAILABLE', 'Passkey management is not configured.'); return; }
    if (!requestOriginAllowed(request, config, true)) { jsonError(request, response, 403, 'WEBAUTHN_ORIGIN_REJECTED', 'Request origin is not allowed.'); return; }
    const token = bearerToken(request);
    if (!token) { jsonError(request, response, 401, 'UNAUTHENTICATED', 'Authentication is required.'); return; }
    const principal = await sessions.authenticateBearer(token);
    if (!principal) { jsonError(request, response, 401, 'UNAUTHENTICATED', 'Authentication session is invalid.'); return; }
    const rows = await runWithRequestContext({ requestId: request.id, principal }, () => db.query(
      'SELECT * FROM public.prodx_webauthn_list_credentials()',
    ));
    response.setHeader('Cache-Control', 'no-store');
    response.json(rows.map(({ credential_id: _credentialId, ...row }) => row));
  }));

  app.patch('/auth/webauthn/credentials/:credentialId', asyncRoute(async (request, response) => {
    const { config } = resolveConfig();
    if (!config) { jsonError(request, response, 503, 'WEBAUTHN_UNAVAILABLE', 'Passkey management is not configured.'); return; }
    if (!requestOriginAllowed(request, config)) { jsonError(request, response, 403, 'WEBAUTHN_ORIGIN_REJECTED', 'Request origin is not allowed.'); return; }
    const token = bearerToken(request);
    if (!token) { jsonError(request, response, 401, 'UNAUTHENTICATED', 'Authentication is required.'); return; }
    const principal = await sessions.authenticateBearer(token);
    if (!principal) { jsonError(request, response, 401, 'UNAUTHENTICATED', 'Authentication session is invalid.'); return; }
    if (!isUuid(request.params.credentialId)) { jsonError(request, response, 400, 'WEBAUTHN_REQUEST_INVALID', 'A valid credentialId is required.'); return; }
    const body = readObject(request.body);
    const label = readString(body?.label, 80);
    if (!label) { jsonError(request, response, 400, 'WEBAUTHN_REQUEST_INVALID', 'A label between 1 and 80 printable characters is required.'); return; }
    const rows = await runWithRequestContext({ requestId: request.id, principal }, () => db.query<{ renamed: boolean }>(
      'SELECT public.prodx_webauthn_rename_credential($1::uuid,$2) AS renamed', [request.params.credentialId, label],
    ));
    if (!rows[0]?.renamed) { jsonError(request, response, 404, 'WEBAUTHN_CREDENTIAL_NOT_FOUND', 'Passkey not found.'); return; }
    response.status(204).send();
  }));

  app.delete('/auth/webauthn/credentials/:credentialId', asyncRoute(async (request, response) => {
    const { config } = resolveConfig();
    if (!config) { jsonError(request, response, 503, 'WEBAUTHN_UNAVAILABLE', 'Passkey management is not configured.'); return; }
    if (!requestOriginAllowed(request, config)) { jsonError(request, response, 403, 'WEBAUTHN_ORIGIN_REJECTED', 'Request origin is not allowed.'); return; }
    const token = bearerToken(request);
    if (!token) { jsonError(request, response, 401, 'UNAUTHENTICATED', 'Authentication is required.'); return; }
    const principal = await sessions.authenticateBearer(token);
    if (!principal) { jsonError(request, response, 401, 'UNAUTHENTICATED', 'Authentication session is invalid.'); return; }
    if (!isUuid(request.params.credentialId)) { jsonError(request, response, 400, 'WEBAUTHN_REQUEST_INVALID', 'A valid credentialId is required.'); return; }
    const reason = readString(readObject(request.body)?.reason, 32);
    if (!reason || !['lost_device', 'compromised', 'replaced', 'manual'].includes(reason)) {
      jsonError(request, response, 400, 'WEBAUTHN_REQUEST_INVALID', 'A valid passkey revocation reason is required.'); return;
    }
    const rows = await runWithRequestContext({ requestId: request.id, principal }, () => db.query<{ revoked: boolean }>(
      'SELECT public.prodx_webauthn_revoke_credential($1::uuid,$2) AS revoked', [request.params.credentialId, reason],
    ));
    if (!rows[0]?.revoked) { jsonError(request, response, 404, 'WEBAUTHN_CREDENTIAL_NOT_FOUND', 'Passkey not found.'); return; }
    response.status(204).send();
  }));
};
