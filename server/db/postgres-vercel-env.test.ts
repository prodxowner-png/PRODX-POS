import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConfiguredDatabaseUrl, resolveProductionDatabaseUrl } from './postgres';

const withEnvironment = async (
  values: Record<string, string | undefined>,
  run: () => Promise<void>,
) => {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};

test('Vercel production uses the broker when NODE_ENV is unset', async () => {
  await withEnvironment({
    VERCEL: '1',
    VERCEL_ENV: 'production',
    NODE_ENV: undefined,
    DATABASE_URL: 'postgresql://legacy.example/prodx',
    VERCEL_OIDC_TOKEN: undefined,
    PRODX_DB_BROKER_URL: 'https://broker.example/prodx-db',
  }, async () => {
    await assert.rejects(
      resolveProductionDatabaseUrl(),
      /Vercel OIDC token is required/,
    );
  });
});

test('Vercel preview does not use the production broker when NODE_ENV is production', async () => {
  await withEnvironment({
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://preview.example/prodx',
    VERCEL_OIDC_TOKEN: undefined,
    PRODX_DB_BROKER_URL: 'https://broker.example/prodx-db',
  }, async () => {
    assert.equal(await resolveProductionDatabaseUrl(), 'postgresql://preview.example/prodx');
  });
});

test('Vercel runtime never falls back to localhost when DATABASE_URL is missing', async () => {
  await withEnvironment({
    VERCEL: '1',
    VERCEL_ENV: 'preview',
    NODE_ENV: undefined,
    DATABASE_URL: undefined,
  }, async () => {
    assert.equal(resolveConfiguredDatabaseUrl(), undefined);
  });
});
