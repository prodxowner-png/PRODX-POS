import assert from 'node:assert/strict';
import test from 'node:test';
import type { IAuthApi } from './types';
import type { getSupabasePosAuthClient } from '../lib/supabasePosAuth';
import { createSupabaseAuthApi } from './supabaseAuthApi';

type Client = ReturnType<typeof getSupabasePosAuthClient>;
const loginRequest = { organizationSlug: 'demo-org', storeCode: 'STORE-01', registerId: 'ADMIN-CONSOLE', emailOrPin: 'admin@example.test', passwordOrPin: 'test-password', requireAdminRole: true };
const session = { token: 'pos-session-token', currentUser: { id: 'user-1', role: 'admin' } };
const makeClient = () => {
  const calls: { signIn?: unknown; signOut: unknown[]; refresh: number } = { signOut: [], refresh: 0 };
  const client = { auth: {
    getSession: async () => ({ data: { session: { refresh_token: 'supabase-refresh-token' } }, error: null }),
    refreshSession: async () => { calls.refresh += 1; return { data: { session: { access_token: 'refreshed-supabase-token' } }, error: null }; },
    signInWithPassword: async (input: unknown) => { calls.signIn = input; return { data: { session: { access_token: 'supabase-access-token' } }, error: null }; },
    signOut: async (input?: unknown) => { calls.signOut.push(input); return { error: null }; },
  } } as unknown as Client;
  return { client, calls };
};
const fallbackApi = (overrides: Partial<IAuthApi> = {}): IAuthApi => ({ login: async () => session as never, logout: async () => undefined, renewSession: async () => null, verifySession: async () => null, getStores: async () => [], forgotPin: async () => undefined, ...overrides });

test('Supabase email login exchanges the access token and forwards server-enforced admin scope', async () => {
  const { client, calls } = makeClient();
  let requestBody: Record<string, unknown> | undefined;
  let authorization: string | null = null;
  const fetcher: typeof fetch = async (_input, init) => { requestBody = JSON.parse(String(init?.body)); authorization = new Headers(init?.headers).get('authorization'); return new Response(JSON.stringify(session), { status: 200, headers: { 'content-type': 'application/json' } }); };
  assert.deepEqual(await createSupabaseAuthApi({ getClient: () => client, fetcher }).login(loginRequest), session);
  assert.equal(authorization, 'Bearer supabase-access-token');
  assert.deepEqual(requestBody, { organizationSlug: 'demo-org', storeCode: 'STORE-01', registerId: 'ADMIN-CONSOLE', requireAdminRole: true });
  assert.deepEqual(calls.signIn, { email: 'admin@example.test', password: 'test-password' });
});

test('failed POS session exchange clears only the local Supabase session', async () => {
  const { client, calls } = makeClient();
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({ error: { message: 'Scope rejected' } }), { status: 401 });
  await assert.rejects(createSupabaseAuthApi({ getClient: () => client, fetcher }).login(loginRequest), /Scope rejected/);
  assert.deepEqual(calls.signOut, [{ scope: 'local' }]);
});

test('PIN identities stay on server-authoritative PostgreSQL auth', async () => {
  let called = false;
  const api = createSupabaseAuthApi({ getClient: () => { throw new Error('must not initialize Supabase'); }, fetcher: async () => { throw new Error('network must not be called'); }, fallbackApi: fallbackApi({ login: async (request) => { called = true; assert.equal(request.emailOrPin, '123456'); return session as never; } }) });
  assert.deepEqual(await api.login({ ...loginRequest, emailOrPin: '123456' }), session);
  assert.equal(called, true);
});

test('failed server logout does not clear local identity and mask revocation failure', async () => {
  const api = createSupabaseAuthApi({ getClient: () => { throw new Error('must not sign out locally'); }, fetcher: async () => new Response('unavailable', { status: 503 }) });
  await assert.rejects(api.logout('pos-session-token'), /Authentication logout failed/);
});

test('Supabase renewal refreshes the provider token and exchanges it with the existing POS bearer', async () => {
  const { client, calls } = makeClient();
  let requestUrl = '';
  let headers: Headers | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    requestUrl = String(input);
    headers = new Headers(init?.headers);
    return new Response(JSON.stringify(session), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const renewed = await createSupabaseAuthApi({ getClient: () => client, fetcher }).renewSession('pos-session-token');
  assert.deepEqual(renewed, session);
  assert.equal(requestUrl, '/auth/supabase/renew');
  assert.equal(headers?.get('authorization'), 'Bearer pos-session-token');
  assert.equal(headers?.get('x-supabase-authorization'), 'Bearer refreshed-supabase-token');
  assert.equal(calls.refresh, 1);
});

test('Supabase renewal is a no-op for password/PIN sessions without a Supabase identity session', async () => {
  const { client, calls } = makeClient();
  (client.auth as unknown as { getSession: () => Promise<unknown> }).getSession = async () => ({
    data: { session: null }, error: null,
  });
  const api = createSupabaseAuthApi({ getClient: () => client, fetcher: async () => {
    throw new Error('must not call renewal endpoint without Supabase identity');
  } });
  assert.equal(await api.renewSession('pos-session-token'), null);
  assert.equal(calls.refresh, 0);
});

test('Supabase renewal preserves HTTP status so revoked POS sessions fail closed in AuthContext', async () => {
  const { client } = makeClient();
  const api = createSupabaseAuthApi({
    getClient: () => client,
    fetcher: async () => new Response(JSON.stringify({ error: { message: 'Session revoked' } }), { status: 401 }),
  });
  await assert.rejects(api.renewSession('pos-session-token'), (error: unknown) => {
    assert.equal((error as { status?: number }).status, 401);
    assert.match((error as Error).message, /Session revoked/);
    return true;
  });
});
