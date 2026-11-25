export interface PersistedSession {
  readonly token: string;
}

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const AUTH_SESSION_STORAGE_KEY = 'prodx_pos_session';

export function readPersistedSession(storage: SessionStorageLike): PersistedSession | null {
  const raw = storage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
    return token ? { token } : null;
  } catch {
    return null;
  }
}

export function writePersistedSession(storage: SessionStorageLike, token: string): void {
  const normalizedToken = token.trim();
  if (!normalizedToken) throw new Error('Authentication session token is required.');
  storage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify({ token: normalizedToken }));
}

export function clearPersistedSession(storage: SessionStorageLike): void {
  storage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

export async function restoreVerifiedSession<TSession>(
  verifySession: (token: string) => Promise<TSession | null>,
  sessionStorage: SessionStorageLike,
  localStorage?: Pick<SessionStorageLike, 'removeItem'>,
  onError?: (error: unknown) => void,
): Promise<TSession | null> {
  try {
    localStorage?.removeItem(AUTH_SESSION_STORAGE_KEY);
    const persisted = readPersistedSession(sessionStorage);
    if (!persisted) {
      clearPersistedSession(sessionStorage);
      return null;
    }
    const verified = await verifySession(persisted.token);
    if (!verified) {
      clearPersistedSession(sessionStorage);
      return null;
    }
    return verified;
  } catch (err) {
    onError?.(err);
    try {
      clearPersistedSession(sessionStorage);
      localStorage?.removeItem(AUTH_SESSION_STORAGE_KEY);
    } catch {
      // Fail closed even if storage cleanup throws.
    }
    return null;
  }
}