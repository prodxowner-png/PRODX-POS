import assert from 'node:assert/strict';
import test from 'node:test';
import { getCurrentRequestContext, runWithRequestContext } from './request-context-storage.ts';

const context = (organizationId: string, storeId: string) => ({
  requestId: `${organizationId}-request`,
  principal: { userId: `${organizationId}-user`, organizationId, storeId },
});

test('request context survives asynchronous work and is cleared outside its scope', async () => {
  const first = context('org-1', 'store-1');
  assert.equal(getCurrentRequestContext(), undefined);

  await runWithRequestContext(first, async () => {
    assert.deepEqual(getCurrentRequestContext(), first);
    await new Promise((resolve) => setTimeout(resolve, 1));
    assert.deepEqual(getCurrentRequestContext(), first);
  });

  assert.equal(getCurrentRequestContext(), undefined);
});

test('concurrent requests cannot observe each other tenant context', async () => {
  const first = context('org-1', 'store-1');
  const second = context('org-2', 'store-2');

  const [firstSeen, secondSeen] = await Promise.all([
    runWithRequestContext(first, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return getCurrentRequestContext();
    }),
    runWithRequestContext(second, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return getCurrentRequestContext();
    }),
  ]);

  assert.deepEqual(firstSeen, first);
  assert.deepEqual(secondSeen, second);
});
