import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IAuthApi } from './types';
import {
  UNCONFIGURED_AUTH_PROVIDER_ERROR,
  authApi,
  createUnconfiguredAuthApi,
  resolveAuthApi,
} from './authApiFactory';
import {
  AUTH_SESSION_STORAGE_KEY,
  readPersistedSession,
  restoreVerifiedSession,
  writePersistedSession,
  type SessionStorageLike,
} from '../context/authSessionStorage';

function createStubAuthApi(label: string): IAuthApi {
  return {
    async login() {
      throw new Error(`stub:${label}:login`);
    },
    async logout() {
      throw new Error(`stub:${label}:logout`);
    },
    async renewSession() {
      throw new Error(`stub:${label}:renewSession`);
    },
    async verifySession() {
      throw new Error(`stub:${label}:verifySession`);
    },
    async getStores() {
      throw new Error(`stub:${label}:getStores`);
    },
    async forgotPin() {
      throw new Error(`stub:${label}:forgotPin`);
    },
  };
}

function createMemoryStorage(): SessionStorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

test('authApiFactory does not emit a top-level throw that triggers Rollup/Terser dead-code elimination', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'adapters', 'authApiFactory.ts'), 'utf8');
  assert.equal(
    /^\s*if\s*\(!import\.meta\.env\.DEV[\s\S]{0,120}throw new Error/m.test(source),
    false,
    'authApiFactory must not throw at module top-level in non-DEV builds',
  );
  assert.match(source, /createUnconfiguredAuthApi/);
  assert.match(source, /import\.meta\.env\.DEV\s*\?\s*createDevelopmentMockAuthApi\(\)/);
});

// 1. Missing provider in production (fails closed)
test('missing provider in production resolves to fail-closed unconfigured auth API', async () => {
  const supabaseStub = createStubAuthApi('supabase');
  const productionStub = createStubAuthApi('production');
  const mockStub = createStubAuthApi('mock');

  for (const provider of [undefined, '', '   ', 'unknown', 'mock', 'dev']) {
    const resolved = resolveAuthApi(
      { isDev: false, provider },
      { developmentMockApi: mockStub, supabaseApi: supabaseStub, productionApi: productionStub },
    );
    assert.notEqual(resolved, supabaseStub);
    assert.notEqual(resolved, productionStub);
    assert.notEqual(resolved, mockStub);
    await assert.rejects(
      resolved.verifySession('stale-token'),
      { message: UNCONFIGURED_AUTH_PROVIDER_ERROR },
    );
  }
});

// 2. Explicit 'supabase' provider
test('explicit supabase provider resolves to Supabase auth API (case- and whitespace-insensitive)', () => {
  const supabaseStub = createStubAuthApi('supabase');
  const productionStub = createStubAuthApi('production');
  const mockStub = createStubAuthApi('mock');

  const resolvedExact = resolveAuthApi(
    { isDev: false, provider: 'supabase' },
    { developmentMockApi: mockStub, supabaseApi: supabaseStub, productionApi: productionStub },
  );
  const resolvedTrimmed = resolveAuthApi(
    { isDev: false, provider: '  SUPABASE  ' },
    { developmentMockApi: mockStub, supabaseApi: supabaseStub, productionApi: productionStub },
  );

  assert.equal(resolvedExact, supabaseStub);
  assert.equal(resolvedTrimmed, supabaseStub);
});

// 3. Explicit 'production' provider
test('explicit production provider resolves to Production auth API (case- and whitespace-insensitive)', () => {
  const supabaseStub = createStubAuthApi('supabase');
  const productionStub = createStubAuthApi('production');
  const mockStub = createStubAuthApi('mock');

  const resolvedExact = resolveAuthApi(
    { isDev: false, provider: 'production' },
    { developmentMockApi: mockStub, supabaseApi: supabaseStub, productionApi: productionStub },
  );
  const resolvedTrimmed = resolveAuthApi(
    { isDev: false, provider: '  PRODUCTION  ' },
    { developmentMockApi: mockStub, supabaseApi: supabaseStub, productionApi: productionStub },
  );

  assert.equal(resolvedExact, productionStub);
  assert.equal(resolvedTrimmed, productionStub);
});

// 4. Development mock isolation (isDev: true vs isDev: false)
test('development mock adapter is selected only when isDev is true and never when isDev is false', async () => {
  const supabaseStub = createStubAuthApi('supabase');
  const productionStub = createStubAuthApi('production');
  const mockStub = createStubAuthApi('mock');

  const devResolved = resolveAuthApi(
    { isDev: true, provider: undefined },
    { developmentMockApi: mockStub, supabaseApi: supabaseStub, productionApi: productionStub },
  );
  assert.equal(devResolved, mockStub);

  // Even if someone passes provider: 'developmentMockAuthApi' or 'mock' with isDev: false,
  // mock must NEVER be returned.
  const prodWithMockName = resolveAuthApi(
    { isDev: false, provider: 'developmentMockAuthApi' },
    { developmentMockApi: mockStub, supabaseApi: supabaseStub, productionApi: productionStub },
  );
  assert.notEqual(prodWithMockName, mockStub);
  await assert.rejects(
    prodWithMockName.login({
      organizationSlug: 'demo',
      storeCode: 'STORE-01',
      registerId: 'POS-01',
      emailOrPin: '123456',
      passwordOrPin: '123456',
    }),
    { message: UNCONFIGURED_AUTH_PROVIDER_ERROR },
  );
});


// Explicit invalid API routing must fail closed without throwing during module evaluation.
test('invalid explicit production API base URL resolves to fail-closed auth', async () => {
  const productionStub = createStubAuthApi('production');
  const resolved = resolveAuthApi(
    { isDev: false, provider: 'production', apiBaseUrl: '//attacker.example' },
    { productionApi: productionStub },
  );
  assert.notEqual(resolved, productionStub);
  await assert.rejects(resolved.verifySession('token'), { message: UNCONFIGURED_AUTH_PROVIDER_ERROR });
});

// 5. Runtime calls with unconfigured provider (all 6 IAuthApi methods reject)
test('authApi fails closed on every IAuthApi method when unconfigured outside DEV', async () => {
  const errorPattern = { message: UNCONFIGURED_AUTH_PROVIDER_ERROR };

  for (const api of [authApi, createUnconfiguredAuthApi()]) {
    await assert.rejects(
      api.login({
        organizationSlug: 'demo',
        storeCode: 'STORE-01',
        registerId: 'POS-01',
        emailOrPin: '123456',
        passwordOrPin: '123456',
      }),
      errorPattern,
    );
    await assert.rejects(api.logout('token'), errorPattern);
    await assert.rejects(api.renewSession('token'), errorPattern);
    await assert.rejects(api.verifySession('token'), errorPattern);
    await assert.rejects(api.getStores('demo', 'token'), errorPattern);
    await assert.rejects(api.forgotPin('demo', 'STORE-01', '123456', 'POS-01'), errorPattern);
  }
});

test('persisted POS session keeps only the validated auth provider needed for safe renewal routing', () => {
  const storage = createMemoryStorage();
  writePersistedSession(storage, 'pos-pin-token', 'pin');
  assert.deepEqual(readPersistedSession(storage), { token: 'pos-pin-token', authProvider: 'pin' });

  storage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify({ token: 'pos-legacy-token', authProvider: 'admin' }));
  assert.deepEqual(readPersistedSession(storage), { token: 'pos-legacy-token' });

  storage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify({ token: 'pos-pre-metadata-token' }));
  assert.deepEqual(readPersistedSession(storage), { token: 'pos-pre-metadata-token' });
});

// 6. Session initialization failure clears persisted session/storage and creates no bypass
test('session initialization failure clears persisted session storage and returns null without auth bypass', async () => {
  const sessionStore = createMemoryStorage();
  const localStore = createMemoryStorage();

  writePersistedSession(sessionStore, 'persisted-jwt-token');
  localStore.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify({ token: 'legacy-token' }));

  const capturedErrors: unknown[] = [];
  const unconfigured = createUnconfiguredAuthApi();

  const restoredOnThrow = await restoreVerifiedSession(
    (token) => unconfigured.verifySession(token),
    sessionStore,
    localStore,
    (err) => capturedErrors.push(err),
  );

  assert.equal(restoredOnThrow, null);
  assert.equal(sessionStore.getItem(AUTH_SESSION_STORAGE_KEY), null);
  assert.equal(localStore.getItem(AUTH_SESSION_STORAGE_KEY), null);
  assert.equal(capturedErrors.length, 1);

  // Also verify null response from verifySession (expired/revoked token) clears persisted session
  writePersistedSession(sessionStore, 'expired-jwt-token');
  const restoredOnNull = await restoreVerifiedSession(
    async () => null,
    sessionStore,
    localStore,
  );
  assert.equal(restoredOnNull, null);
  assert.equal(sessionStore.getItem(AUTH_SESSION_STORAGE_KEY), null);
});
