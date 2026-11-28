import assert from 'node:assert/strict';
import test from 'node:test';
import {
  POS_SUPABASE_AUTH_STORAGE_KEY,
  createInMemorySupabaseAuthStorage,
  createSupabasePosAuthOptions,
  resolvePosSupabaseAuthStorage,
} from './supabasePosAuthStorage';

test('resolvePosSupabaseAuthStorage selects tab-isolated sessionStorage when available', () => {
  const tabAStorage = createInMemorySupabaseAuthStorage();
  const tabBStorage = createInMemorySupabaseAuthStorage();

  const resolvedA = resolvePosSupabaseAuthStorage({ sessionStorage: tabAStorage });
  const resolvedB = resolvePosSupabaseAuthStorage({ sessionStorage: tabBStorage });

  resolvedA.setItem(POS_SUPABASE_AUTH_STORAGE_KEY, 'alice-refresh-session');
  resolvedB.setItem(POS_SUPABASE_AUTH_STORAGE_KEY, 'bob-refresh-session');

  assert.equal(resolvedA.getItem(POS_SUPABASE_AUTH_STORAGE_KEY), 'alice-refresh-session');
  assert.equal(resolvedB.getItem(POS_SUPABASE_AUTH_STORAGE_KEY), 'bob-refresh-session');
});

test('resolvePosSupabaseAuthStorage falls back to isolated in-memory storage when sessionStorage is unavailable or throws', () => {
  const deniedWindow = {
    get sessionStorage(): never {
      throw new Error('SecurityError: sessionStorage disabled');
    },
  };
  const fallbackA = resolvePosSupabaseAuthStorage(deniedWindow);
  const fallbackB = resolvePosSupabaseAuthStorage(undefined);

  fallbackA.setItem(POS_SUPABASE_AUTH_STORAGE_KEY, 'tab-a-token');
  assert.equal(fallbackA.getItem(POS_SUPABASE_AUTH_STORAGE_KEY), 'tab-a-token');
  assert.equal(fallbackB.getItem(POS_SUPABASE_AUTH_STORAGE_KEY), null);
});

test('createSupabasePosAuthOptions binds Supabase client persistence to explicit per-tab storage', () => {
  const tabStorage = createInMemorySupabaseAuthStorage();
  const options = createSupabasePosAuthOptions(tabStorage);

  assert.equal(options.auth.persistSession, true);
  assert.equal(options.auth.autoRefreshToken, true);
  assert.equal(options.auth.detectSessionInUrl, false);
  assert.equal(options.auth.storageKey, POS_SUPABASE_AUTH_STORAGE_KEY);
  assert.equal(options.auth.storage, tabStorage);
});
