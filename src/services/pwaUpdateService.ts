import { registerSW } from 'virtual:pwa-register';
import {
  createPwaUpdateController,
  type PwaUpdateSnapshot,
} from './pwaUpdateController';

export type { PwaUpdateSnapshot };

const controller = createPwaUpdateController({
  registerSW: (options) => registerSW(options),
  reload: () => window.location.reload(),
});

export function subscribePwaUpdate(listener: () => void): () => void {
  return controller.subscribe(listener);
}

export function getPwaUpdateSnapshot(): PwaUpdateSnapshot {
  return controller.getSnapshot();
}

/** Register once in prompt mode. A waiting worker is never activated automatically. */
export function startPwaUpdateService(): void {
  controller.start();
}

/** Send SKIP_WAITING only after the UI has rechecked every operational safety gate. */
export async function applyPwaUpdate(): Promise<void> {
  return controller.applyUpdate();
}
