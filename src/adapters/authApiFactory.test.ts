import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

test('authApiFactory does not emit a top-level throw that triggers Rollup/Terser dead-code elimination', () => {
  const source = readFileSync(join(process.cwd(), 'src', 'adapters', 'authApiFactory.ts'), 'utf8');
  assert.equal(
    /^\s*if\s*\(!import\.meta\.env\.DEV[\s\S]{0,120}throw new Error/m.test(source),
    false,
    'authApiFactory must not throw at module top-level in non-DEV builds',
  );
  assert.match(source, /createUnconfiguredAuthApi/);
});

test('authApi fails closed on every IAuthApi method when unconfigured outside DEV', async () => {
  const { authApi } = await import('./authApiFactory');

  await assert.rejects(
    authApi.login({
      organizationSlug: 'demo',
      storeCode: 'STORE-01',
      registerId: 'POS-01',
      emailOrPin: '123456',
      passwordOrPin: '123456',
    }),
    /Authentication provider must be explicitly configured for non-development builds/,
  );
  await assert.rejects(
    authApi.logout('token'),
    /Authentication provider must be explicitly configured for non-development builds/,
  );
  await assert.rejects(
    authApi.verifySession('token'),
    /Authentication provider must be explicitly configured for non-development builds/,
  );
  await assert.rejects(
    authApi.getStores('demo', 'token'),
    /Authentication provider must be explicitly configured for non-development builds/,
  );
  await assert.rejects(
    authApi.forgotPin('demo', 'STORE-01', '123456', 'POS-01'),
    /Authentication provider must be explicitly configured for non-development builds/,
  );
});
