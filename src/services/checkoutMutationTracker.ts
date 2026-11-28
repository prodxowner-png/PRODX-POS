type Listener = () => void;

let activeCheckoutCount = 0;
const listeners = new Set<Listener>();

function publish(): void {
  listeners.forEach((listener) => listener());
}

export function getActiveCheckoutMutationCount(): number {
  return activeCheckoutCount;
}

export function subscribeCheckoutMutations(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Tracks the lifetime of an authoritative live checkout request. */
export async function withCheckoutMutation<T>(operation: () => Promise<T>): Promise<T> {
  activeCheckoutCount += 1;
  publish();
  try {
    return await operation();
  } finally {
    activeCheckoutCount = Math.max(0, activeCheckoutCount - 1);
    publish();
  }
}
