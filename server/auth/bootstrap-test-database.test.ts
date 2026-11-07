import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBootstrapIntegrationDatabaseUrl } from './bootstrap-test-database';

const validEnvironment = () => ({
  PRODX_RUN_BOOTSTRAP_POSTGRES_INTEGRATION: '1',
  PRODX_BOOTSTRAP_TEST_DATABASE_URL:
    'postgresql://prodx:prodx@127.0.0.1:5432/prodx_bootstrap_test',
  DATABASE_URL: 'postgresql://prodx:prodx@127.0.0.1:5432/prodx_test',
});

test('bootstrap database guard is inactive when the integration gate is disabled', () => {
  assert.equal(resolveBootstrapIntegrationDatabaseUrl({}), null);
});

test('bootstrap database guard requires an explicit dedicated URL when enabled', () => {
  assert.throws(
    () => resolveBootstrapIntegrationDatabaseUrl({
      PRODX_RUN_BOOTSTRAP_POSTGRES_INTEGRATION: '1',
    }),
    /PRODX_BOOTSTRAP_TEST_DATABASE_URL must be explicitly set/,
  );
});

test('bootstrap database guard rejects malformed and non-PostgreSQL URLs', () => {
  const malformed = validEnvironment();
  malformed.PRODX_BOOTSTRAP_TEST_DATABASE_URL = 'not-a-database-url';
  assert.throws(
    () => resolveBootstrapIntegrationDatabaseUrl(malformed),
    /valid PostgreSQL connection URL/,
  );

  const wrongProtocol = validEnvironment();
  wrongProtocol.PRODX_BOOTSTRAP_TEST_DATABASE_URL = 'https://127.0.0.1/prodx_bootstrap_test';
  assert.throws(
    () => resolveBootstrapIntegrationDatabaseUrl(wrongProtocol),
    /must use the postgres:\/\/ or postgresql:\/\//,
  );
});

test('bootstrap database guard rejects non-loopback hosts', () => {
  const env = validEnvironment();
  env.PRODX_BOOTSTRAP_TEST_DATABASE_URL =
    'postgresql://prodx:prodx@postgres.internal:5432/prodx_bootstrap_test';
  assert.throws(
    () => resolveBootstrapIntegrationDatabaseUrl(env),
    /loopback PostgreSQL host/,
  );
});

test('bootstrap database guard requires the dedicated database name', () => {
  const env = validEnvironment();
  env.PRODX_BOOTSTRAP_TEST_DATABASE_URL =
    'postgresql://prodx:prodx@127.0.0.1:5432/prodx_test';
  assert.throws(
    () => resolveBootstrapIntegrationDatabaseUrl(env),
    /dedicated prodx_bootstrap_test database/,
  );
});

test('bootstrap database guard rejects the shared database even with different credentials or URL alias', () => {
  const env = validEnvironment();
  env.PRODX_BOOTSTRAP_TEST_DATABASE_URL =
    'postgres://bootstrap:other-password@127.0.0.1:5432/prodx_test?sslmode=disable';
  assert.throws(
    () => resolveBootstrapIntegrationDatabaseUrl(env),
    /must not target the same database as DATABASE_URL/,
  );
});

test('bootstrap database guard accepts a distinct loopback bootstrap database', () => {
  const env = validEnvironment();
  assert.equal(
    resolveBootstrapIntegrationDatabaseUrl(env),
    env.PRODX_BOOTSTRAP_TEST_DATABASE_URL,
  );
});
