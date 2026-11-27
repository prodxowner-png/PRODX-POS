import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getActiveInventoryMutationCount,
  subscribeInventoryMutations,
  withInventoryMutation,
} from './inventoryMutationTracker';

test('tracks overlapping inventory writes until every request settles', async () => {
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const notifications: number[] = [];
  const unsubscribe = subscribeInventoryMutations(() => {
    notifications.push(getActiveInventoryMutationCount());
  });

  const firstWrite = withInventoryMutation(() => first);
  const secondWrite = withInventoryMutation(() => second);
  assert.equal(getActiveInventoryMutationCount(), 2);

  releaseFirst();
  await firstWrite;
  assert.equal(getActiveInventoryMutationCount(), 1);

  releaseSecond();
  await secondWrite;
  assert.equal(getActiveInventoryMutationCount(), 0);
  assert.deepEqual(notifications, [1, 2, 1, 0]);
  unsubscribe();
});

test('releases the mutation guard when an inventory write rejects', async () => {
  await assert.rejects(
    withInventoryMutation(async () => { throw new Error('write failed'); }),
    /write failed/,
  );
  assert.equal(getActiveInventoryMutationCount(), 0);
});
