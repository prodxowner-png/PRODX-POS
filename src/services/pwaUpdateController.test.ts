import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPwaUpdateController,
  type RegisterSWOptionsLike,
  type WaitingServiceWorkerLike,
} from './pwaUpdateController';

function createFakeWaitingWorker(initialState = 'installed') {
  let state = initialState;
  const listeners = new Set<() => void>();
  const worker: WaitingServiceWorkerLike = {
    get state() {
      return state;
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
  };
  return {
    worker,
    transitionTo(nextState: string) {
      state = nextState;
      listeners.forEach((listener) => listener());
    },
  };
}

test('applyUpdate triggers strictly one reload even if onNeedReload fires while applying', async () => {
  let capturedOptions: RegisterSWOptionsLike | null = null;
  let reloadCalls = 0;
  let updateSwCalls = 0;
  const fakeWorker = createFakeWaitingWorker('installed');

  const controller = createPwaUpdateController({
    registerSW: (options) => {
      capturedOptions = options;
      return async (reloadPage) => {
        updateSwCalls += 1;
        assert.equal(reloadPage, false);
        // Simulate vite-plugin-pwa invoking onNeedReload during activation
        capturedOptions?.onNeedReload?.();
        fakeWorker.transitionTo('activated');
      };
    },
    reload: () => {
      reloadCalls += 1;
    },
    fetchImpl: async () => ({ ok: true }),
    isOnline: () => true,
  });

  controller.start();
  assert.ok(capturedOptions);
  capturedOptions!.onRegisteredSW?.('/sw.js', {
    waiting: fakeWorker.worker,
    update: async () => undefined,
  });
  capturedOptions!.onNeedRefresh?.();
  assert.deepEqual(controller.getSnapshot(), { updateAvailable: true, isApplying: false });

  await controller.applyUpdate();

  assert.equal(updateSwCalls, 1);
  assert.equal(reloadCalls, 1);
  assert.deepEqual(controller.getSnapshot(), { updateAvailable: false, isApplying: false });
});

test('onNeedReload never reloads when update was not initiated by this tab', () => {
  let capturedOptions: RegisterSWOptionsLike | null = null;
  let reloadCalls = 0;

  const controller = createPwaUpdateController({
    registerSW: (options) => {
      capturedOptions = options;
      return async () => undefined;
    },
    reload: () => {
      reloadCalls += 1;
    },
    fetchImpl: async () => ({ ok: true }),
    isOnline: () => true,
  });

  controller.start();
  capturedOptions!.onNeedRefresh?.();
  capturedOptions!.onNeedReload?.();

  assert.equal(reloadCalls, 0);
  assert.deepEqual(controller.getSnapshot(), { updateAvailable: true, isApplying: false });
});

test('applyUpdate does not reload and resets applying state when waiting worker becomes redundant', async () => {
  let capturedOptions: RegisterSWOptionsLike | null = null;
  let reloadCalls = 0;
  const fakeWorker = createFakeWaitingWorker('installed');

  const controller = createPwaUpdateController({
    registerSW: (options) => {
      capturedOptions = options;
      return async () => {
        fakeWorker.transitionTo('redundant');
      };
    },
    reload: () => {
      reloadCalls += 1;
    },
    fetchImpl: async () => ({ ok: true }),
    isOnline: () => true,
  });

  controller.start();
  capturedOptions!.onRegisteredSW?.('/sw.js', {
    waiting: fakeWorker.worker,
    update: async () => undefined,
  });
  capturedOptions!.onNeedRefresh?.();

  await assert.rejects(
    () => controller.applyUpdate(),
    /replaced before activation/,
  );

  assert.equal(reloadCalls, 0);
  assert.deepEqual(controller.getSnapshot(), { updateAvailable: true, isApplying: false });
});
