export interface PwaUpdateSnapshot {
  readonly updateAvailable: boolean;
  readonly isApplying: boolean;
}

export interface WaitingServiceWorkerLike {
  readonly state: string;
  addEventListener(type: 'statechange', listener: () => void): void;
  removeEventListener(type: 'statechange', listener: () => void): void;
}

export interface ServiceWorkerRegistrationLike {
  readonly waiting: WaitingServiceWorkerLike | null;
  readonly installing?: unknown;
  update(): Promise<unknown>;
}

export interface RegisterSWOptionsLike {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onNeedReload?: () => void;
  onRegisterError?: (error: unknown) => void;
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistrationLike | undefined) => void;
}

export interface PwaUpdateControllerDeps {
  registerSW: (options: RegisterSWOptionsLike) => (reloadPage?: boolean) => Promise<void>;
  reload: () => void;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<{ ok: boolean }>;
  isOnline?: () => boolean;
  setTimeoutFn?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
  activationTimeoutMs?: number;
  logError?: (message: string, error: unknown) => void;
  logWarn?: (message: string, error: unknown) => void;
}

export interface PwaUpdateController {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PwaUpdateSnapshot;
  start(): void;
  applyUpdate(): Promise<void>;
}

export function createPwaUpdateController(deps: PwaUpdateControllerDeps): PwaUpdateController {
  const {
    registerSW,
    reload,
    fetchImpl = (input, init) => fetch(input, init),
    isOnline = () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
    setTimeoutFn = (cb, ms) => setTimeout(cb, ms),
    clearTimeoutFn = (id) => clearTimeout(id),
    activationTimeoutMs = 20_000,
    logError = (message, error) => console.error(message, error),
    logWarn = (message, error) => console.warn(message, error),
  } = deps;

  const listeners = new Set<() => void>();
  let snapshot: PwaUpdateSnapshot = Object.freeze({ updateAvailable: false, isApplying: false });
  let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;
  let serviceWorkerRegistration: ServiceWorkerRegistrationLike | null = null;
  let hasReloaded = false;

  function publish(next: PwaUpdateSnapshot): void {
    snapshot = Object.freeze(next);
    listeners.forEach((listener) => listener());
  }

  function reloadOnce(): void {
    if (hasReloaded) return;
    hasReloaded = true;
    reload();
  }

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot(): PwaUpdateSnapshot {
      return snapshot;
    },

    start(): void {
      if (updateServiceWorker) return;

      updateServiceWorker = registerSW({
        immediate: true,
        onNeedRefresh: () => {
          publish({ updateAvailable: true, isApplying: false });
        },
        onNeedReload: () => {
          // Reload is owned exclusively by applyUpdate() after explicit activation.
          // Never trigger a second reload here or reload when another tab activates a worker.
        },
        onRegisterError: (error) => {
          logError('[PWA] Service worker registration failed:', error);
        },
        onRegisteredSW: (swUrl, registration) => {
          if (!registration) return;
          serviceWorkerRegistration = registration;

          void registration.update().catch((error) => {
            logWarn('[PWA] Background update check failed:', error);
          });

          const refresh = async () => {
            if (!isOnline() || registration.installing) return;

            try {
              const response = await fetchImpl(swUrl, {
                cache: 'no-store',
                headers: { 'cache-control': 'no-cache' },
              });

              if (response.ok) {
                await registration.update();
              }
            } catch {
              // Offline or transient network failure: keep the current service worker.
            }
          };

          void refresh();
        },
      });
    },

    async applyUpdate(): Promise<void> {
      if (!snapshot.updateAvailable || snapshot.isApplying || !updateServiceWorker) {
        throw new Error('No waiting service worker is ready to apply.');
      }

      const waitingWorker = serviceWorkerRegistration?.waiting;
      if (!waitingWorker) {
        throw new Error('The waiting service worker is no longer available. Refresh the update status before retrying.');
      }

      publish({ ...snapshot, isApplying: true });
      try {
        // Activate only the worker explicitly waiting for this registration.
        await updateServiceWorker(false);
        await new Promise<void>((resolve, reject) => {
          let timeoutId: ReturnType<typeof setTimeout> | undefined;
          const cleanup = () => {
            if (timeoutId !== undefined) {
              clearTimeoutFn(timeoutId);
            }
            waitingWorker.removeEventListener('statechange', onStateChange);
          };
          const onStateChange = () => {
            if (waitingWorker.state === 'activated') {
              cleanup();
              resolve();
            } else if (waitingWorker.state === 'redundant') {
              cleanup();
              reject(new Error('The waiting service worker was replaced before activation.'));
            }
          };

          waitingWorker.addEventListener('statechange', onStateChange);
          timeoutId = setTimeoutFn(() => {
            cleanup();
            reject(new Error('Timed out waiting for the new service worker to activate.'));
          }, activationTimeoutMs);
          // Recheck after listener registration to avoid missing a fast state transition.
          onStateChange();
        });

        publish({ updateAvailable: false, isApplying: false });
        // Sole reload path: reload only this tab after explicit waiting-worker activation.
        // clientsClaim remains disabled so other POS tabs are not forcibly taken over.
        reloadOnce();
      } catch (error) {
        publish({ updateAvailable: true, isApplying: false });
        throw error;
      }
    },
  };
}
