type Listener = () => void;

let activeMutationCount = 0;
const listeners = new Set<Listener>();

function publish(): void {
  listeners.forEach((listener) => listener());
}

export function getActiveInventoryMutationCount(): number {
  return activeMutationCount;
}

export function subscribeInventoryMutations(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tracks only the lifetime of an authoritative inventory write request. */
export async function withInventoryMutation<T>(operation: () => Promise<T>): Promise<T> {
  activeMutationCount += 1;
  publish();
  try {
    return await operation();
  } finally {
    activeMutationCount = Math.max(0, activeMutationCount - 1);
    publish();
  }
}
