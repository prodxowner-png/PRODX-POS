import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADMIN_CREDENTIAL_OVERRIDE_STORAGE_KEY,
  getPersistedAdminCredentialOverride,
  getStoredStaffPasswords,
  savePersistedAdminCredentialOverride,
  SYSTEM_OWNER_ADMIN_EMAIL,
  SYSTEM_OWNER_ADMIN_ID,
  type PersistedAdminCredentialRecord,
} from './auth.ts';

const withLocalStorage = async (run: (storage: Map<string, string>) => void | Promise<void>) => {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  });
  try {
    await run(storage);
  } finally {
    delete (globalThis as typeof globalThis & { window?: unknown }).window;
  }
};

const credential = (overrides: Partial<PersistedAdminCredentialRecord> = {}): PersistedAdminCredentialRecord => ({
  id: SYSTEM_OWNER_ADMIN_ID,
  email: SYSTEM_OWNER_ADMIN_EMAIL,
  passwordHash: 'server-issued-verifier',
  passwordSalt: 'salt-value',
  version: 2,
  updatedAt: 1,
  updatedBy: SYSTEM_OWNER_ADMIN_EMAIL,
  reauthMethod: 'password',
  ...overrides,
});

test('saving a credential override never persists a supplied plaintext password', async () => {
  await withLocalStorage((storage) => {
    savePersistedAdminCredentialOverride(credential({ password: 'must-not-be-stored' }));
    const raw = storage.get(ADMIN_CREDENTIAL_OVERRIDE_STORAGE_KEY);
    assert.ok(raw);
    assert.equal(raw.includes('must-not-be-stored'), false);
    assert.equal('password' in JSON.parse(raw), false);
  });
});

test('legacy plaintext credential override is deleted and never returned', async () => {
  await withLocalStorage((storage) => {
    storage.set(ADMIN_CREDENTIAL_OVERRIDE_STORAGE_KEY, JSON.stringify(credential({ password: 'legacy-secret' })));
    const result = getPersistedAdminCredentialOverride();
    assert.ok(result);
    assert.equal('password' in result, false);
    assert.equal(storage.has(ADMIN_CREDENTIAL_OVERRIDE_STORAGE_KEY), false);
    assert.deepEqual(getStoredStaffPasswords(), {});
  });
});

test('hash-only credential override remains readable without exposing a password field', async () => {
  await withLocalStorage((storage) => {
    storage.set(ADMIN_CREDENTIAL_OVERRIDE_STORAGE_KEY, JSON.stringify(credential()));
    const result = getPersistedAdminCredentialOverride();
    assert.ok(result);
    assert.equal(result.passwordHash, 'server-issued-verifier');
    assert.equal('password' in result, false);
    assert.deepEqual(getStoredStaffPasswords(), {});
  });
});
