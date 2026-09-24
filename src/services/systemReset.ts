[Reading 43 lines from start (total: 43 lines, 0 remaining)]

import { clearAllCachedData } from '../lib/indexedDb';

/**
 * Clears client-side cache and browser storage. Production state is server-authoritative;
 * this utility must never reset or mutate an in-memory mock repository.
 */
export async function clearEntireSystemCache(reloadWindow = false): Promise<void> {
  try {
    await clearAllCachedData();

    if (typeof window !== 'undefined' && window.localStorage) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('prodx_') || key.startsWith('PRODX_') || key.includes('pos_') || key.includes('theme'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
    }

    if (typeof window !== 'undefined' && window.sessionStorage) {
      sessionStorage.clear();
    }

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        const bc = new BroadcastChannel('prodx_pos_system_events');
        bc.postMessage({ type: 'SYSTEM_CACHE_CLEARED', timestamp: Date.now() });
        bc.close();
      } catch {
        // ignore
      }
    }

    if (reloadWindow && typeof window !== 'undefined') {
      window.location.reload();
    }
  } catch (error) {
    console.error('[SystemReset] Error clearing system cache:', error);
    throw error;
  }
}

[executed on device: cs-66110132733-default (42795147-9ac6-4409-8625-90b0742cdd82)]