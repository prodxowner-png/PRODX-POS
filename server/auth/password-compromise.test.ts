import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPasswordCompromise, PasswordCompromiseCheckUnavailable } from './password-compromise';

test('HIBP screening uses only the first five SHA-1 characters and matches suffix locally', async () => {
  let requested = '';
  const result = await checkPasswordCompromise('password', {
    fetchImpl: async (input, init) => {
      requested = String(input);
      assert.equal(init?.headers && (init.headers as Record<string,string>)['user-agent'], 'PRODX-POS/1.0 password-security');
      return new Response('1E4C9B93F3F0682250B6CF8331B7EE68FD8:10\n', { status: 200 });
    },
  });
  assert.equal(requested, 'https://api.pwnedpasswords.com/range/5BAA6');
  assert.deepEqual(result, { compromised: true, count: 10 });
});

test('HIBP screening returns safe when the complete hash suffix is absent', async () => {
  const result = await checkPasswordCompromise('password', {
    fetchImpl: async () => new Response('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:10\n', { status: 200 }),
  });
  assert.deepEqual(result, { compromised: false, count: 0 });
});

test('HIBP screening fails closed when the service is unavailable', async () => {
  await assert.rejects(
    () => checkPasswordCompromise('password', {
      fetchImpl: async () => new Response('', { status: 503 }),
    }),
    PasswordCompromiseCheckUnavailable,
  );
});

test('HIBP screening fails closed when the request exceeds its timeout', async () => {
  await assert.rejects(
    () => checkPasswordCompromise('password', {
      timeoutMs: 5,
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
    }),
    PasswordCompromiseCheckUnavailable,
  );
});
