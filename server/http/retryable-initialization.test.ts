import assert from 'node:assert/strict';
import test from 'node:test';
import { createRetryableInitialization } from './retryable-initialization.ts';

test('retries initialization after a rejected startup attempt', async () => {
  let attempts = 0;
  const initialize = createRetryableInitialization(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary broker failure');
    return { ready: true };
  });

  await assert.rejects(initialize(), /temporary broker failure/);
  assert.deepEqual(await initialize(), { ready: true });
  assert.equal(attempts, 2);
});

test('shares concurrent initialization and caches a successful result', async () => {
  let attempts = 0;
  let release: (value: string) => void = () => {};
  const pending = new Promise<string>((resolve) => {
    release = resolve;
  });
  const initialize = createRetryableInitialization(async () => {
    attempts += 1;
    return pending;
  });

  const first = initialize();
  const second = initialize();
  await Promise.resolve();
  assert.equal(attempts, 1);

  release('ready');
  assert.deepEqual(await Promise.all([first, second]), ['ready', 'ready']);
  assert.equal(await initialize(), 'ready');
  assert.equal(attempts, 1);
});
