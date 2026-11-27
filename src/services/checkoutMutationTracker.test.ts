import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getActiveCheckoutMutationCount,
  subscribeCheckoutMutations,
  withCheckoutMutation,
} from './checkoutMutationTracker';

test('tracks overlapping live checkout requests until every request settles', async () => {
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const second = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const notifications: number[] = [];
  const unsubscribe = subscribeCheckoutMutations(() => {
    notifications.push(getActiveCheckoutMutationCount());
  });

  const firstCheckout = withCheckoutMutation(() => first);
  const secondCheckout = withCheckoutMutation(() => second);
  assert.equal(getActiveCheckoutMutationCount(), 2);

  releaseFirst();
  await firstCheckout;
  assert.equal(getActiveCheckoutMutationCount(), 1);

  releaseSecond();
  await secondCheckout;
  assert.equal(getActiveCheckoutMutationCount(), 0);
  assert.deepEqual(notifications, [1, 2, 1, 0]);
  unsubscribe();
});

test('releases the checkout mutation guard when a live checkout rejects', async () => {
  await assert.rejects(
    withCheckoutMutation(async () => { throw new Error('checkout failed'); }),
    /checkout failed/,
  );
  assert.equal(getActiveCheckoutMutationCount(), 0);
});
