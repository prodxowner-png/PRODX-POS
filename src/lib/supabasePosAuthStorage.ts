export const POS_SUPABASE_AUTH_STORAGE_KEY = 'prodx-pos-supabase-auth';

export interface SupabaseAuthStorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createInMemorySupabaseAuthStorage(): SupabaseAuthStorageAdapter {
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

/**
 * Isolates Supabase POS auth persistence to the current browser tab via sessionStorage
 * so sibling tabs signed in as different staff members cannot overwrite each other's
 * refresh token or cause cross-user renewal mismatches against this tab's POS bearer.
 * Falls back to tab-local in-memory storage (never shared localStorage) when unavailable.
 */
export function resolvePosSupabaseAuthStorage(
  globalObject: { sessionStorage?: SupabaseAuthStorageAdapter } | undefined =
    typeof window !== 'undefined' ? window : undefined,
): SupabaseAuthStorageAdapter {
  try {
    if (globalObject?.sessionStorage) {
      return globalObject.sessionStorage;
    }
  } catch {
    // Restricted contexts may deny sessionStorage; never fall back to shared localStorage.
  }
  return createInMemorySupabaseAuthStorage();
}

export function createSupabasePosAuthOptions(
  storage: SupabaseAuthStorageAdapter = resolvePosSupabaseAuthStorage(),
) {
  return {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: POS_SUPABASE_AUTH_STORAGE_KEY,
      storage,
    },
  };
}
