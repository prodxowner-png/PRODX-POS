import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticatePasskey, getRegisteredPasskeys, registerPasskey } from '../../src/services/webauthnService.ts';

test('no local demo records are trusted', () => assert.deepEqual(getRegisteredPasskeys(), []));
test('enrollment is disabled until server verification exists', async () => {
 const result = await registerPasskey({ id: 'user-1', email: 'user@example.com', name: 'Test', role: 'admin' });
 assert.equal(result.success, false);
 assert.equal(result.credential, undefined);
});
test('authentication cannot succeed without server verification', async () => {
 const result = await authenticatePasskey({ id: 'user-1', email: 'user@example.com', name: 'Test' });
 assert.equal(result.success, false);
 assert.equal(result.assertion, undefined);
});
