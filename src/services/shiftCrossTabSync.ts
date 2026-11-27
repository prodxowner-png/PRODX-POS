const SHIFT_SYNC_CHANNEL = 'prodx-pos-shift-sync';
const SHIFT_SYNC_STORAGE_KEY = 'prodx_pos_shift_sync_event';

export interface ShiftSyncMessage {
  readonly senderId: string;
  readonly scopeKey: string | null;
  readonly timestamp: number;
}

const instanceSenderId =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}`;

export function parseShiftSyncMessage(raw: unknown): ShiftSyncMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<ShiftSyncMessage>;
  if (typeof candidate.senderId !== 'string' || typeof candidate.timestamp !== 'number') {
    return null;
  }
  if (candidate.scopeKey !== null && typeof candidate.scopeKey !== 'string') {
    return null;
  }
  return {
    senderId: candidate.senderId,
    scopeKey: candidate.scopeKey ?? null,
    timestamp: candidate.timestamp,
  };
}

/**
 * Broadcasts authoritative shift mutations (open/close/cash movement) to sibling tabs
 * so stale shift-closed snapshots are invalidated before PWA updates can activate.
 */
export function notifyShiftStateChanged(scopeKey: string | null): void {
  const payload: ShiftSyncMessage = {
    senderId: instanceSenderId,
    scopeKey,
    timestamp: Date.now(),
  };

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(SHIFT_SYNC_CHANNEL);
      channel.postMessage(payload);
      channel.close();
    } catch {
      // Fall through to localStorage broadcast.
    }
  }

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(SHIFT_SYNC_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage may be unavailable in restricted/private contexts.
    }
  }
}

export function subscribeShiftStateChanged(
  onShiftChanged: (scopeKey: string | null) => void,
): () => void {
  const cleanups: Array<() => void> = [];

  const handlePayload = (raw: unknown) => {
    const parsed = parseShiftSyncMessage(raw);
    if (!parsed || parsed.senderId === instanceSenderId) return;
    onShiftChanged(parsed.scopeKey);
  };

  if (typeof BroadcastChannel !== 'undefined') {
    try {
      const channel = new BroadcastChannel(SHIFT_SYNC_CHANNEL);
      const onMessage = (event: MessageEvent) => handlePayload(event.data);
      channel.addEventListener('message', onMessage);
      cleanups.push(() => {
        channel.removeEventListener('message', onMessage);
        channel.close();
      });
    } catch {
      // BroadcastChannel unsupported or blocked.
    }
  }

  if (typeof window !== 'undefined') {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== SHIFT_SYNC_STORAGE_KEY || !event.newValue) return;
      try {
        handlePayload(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed external storage writes.
      }
    };
    window.addEventListener('storage', onStorage);
    cleanups.push(() => window.removeEventListener('storage', onStorage));
  }

  return () => {
    cleanups.forEach((cleanup) => cleanup());
  };
}
