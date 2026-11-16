import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDisposableTestDatabaseUrl } from './test-database-guard';

test('test-database-guard accepts valid local loopback PostgreSQL URLs', () => {
  const localUrls = [
    'postgresql://prodx:prodx@127.0.0.1:5432/prodx_test',
    'postgresql://postgres@localhost:5432/prodx_pos',
    'postgres://postgres@[::1]:5432/prodx_test',
    'postgresql://postgres@postgres:5432/prodx_test',
  ];
  for (const url of localUrls) {
    assert.equal(
      assertDisposableTestDatabaseUrl(url, 'test-suite', { NODE_ENV: 'test' }),
      url,
    );
  }
});

test('test-database-guard rejects empty or blank DATABASE_URL', () => {
  assert.throws(
    () => assertDisposableTestDatabaseUrl('', 'test-suite'),
    /DATABASE_URL must be provided/,
  );
  assert.throws(
    () => assertDisposableTestDatabaseUrl(undefined, 'test-suite'),
    /DATABASE_URL must be provided/,
  );
});

test('test-database-guard rejects production runtime environments', () => {
  const url = 'postgresql://prodx:prodx@127.0.0.1:5432/prodx_test';
  assert.throws(
    () => assertDisposableTestDatabaseUrl(url, 'test-suite', { NODE_ENV: 'production' }),
    /must never execute against a production runtime environment/,
  );
  assert.throws(
    () => assertDisposableTestDatabaseUrl(url, 'test-suite', { VERCEL: '1', VERCEL_ENV: 'production' }),
    /must never execute against a production runtime environment/,
  );
});

test('test-database-guard rejects production Supabase pooler target', () => {
  const prodSupabaseUrl =
    'postgresql://prodx_app.wcyqyiewbzpmrekoljfw:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require';
  assert.throws(
    () => assertDisposableTestDatabaseUrl(prodSupabaseUrl, 'test-suite', { NODE_ENV: 'test' }),
    /must never target the production Supabase database/,
  );
});

test('test-database-guard rejects remote/cloud database hostnames', () => {
  const remoteHosts = [
    'postgresql://user:pass@db.example.com:5432/prodx_test',
    'postgresql://user:pass@aws-0-ap-southeast-1.pooler.supabase.com:5432/prodx_test',
    'postgresql://user:pass@ep-cool-fog.us-east-2.aws.neon.tech/neondb',
    'postgresql://user:pass@mydb.postgres.database.azure.com/prodx_test',
  ];
  for (const url of remoteHosts) {
    assert.throws(
      () => assertDisposableTestDatabaseUrl(url, 'test-suite', { NODE_ENV: 'test' }),
      /must target a disposable local PostgreSQL host/,
    );
  }
});

test('test-database-guard rejects query parameters that override host or port', () => {
  const overrides = [
    'postgresql://prodx:prodx@127.0.0.1:5432/prodx_test?host=remote.evil.com',
    'postgresql://prodx:prodx@127.0.0.1:5432/prodx_test?port=9999',
    'postgresql://prodx:prodx@127.0.0.1:5432/prodx_test?HOST=remote.evil.com',
  ];
  for (const url of overrides) {
    assert.throws(
      () => assertDisposableTestDatabaseUrl(url, 'test-suite', { NODE_ENV: 'test' }),
      /must not override the database host or port through query parameters/,
    );
  }
});

test('test-database-guard rejects non-postgres protocols', () => {
  const badProtocols = [
    'mysql://root@127.0.0.1:3306/test',
    'https://localhost:5432/test',
    'http://127.0.0.1:5432/test',
  ];
  for (const url of badProtocols) {
    assert.throws(
      () => assertDisposableTestDatabaseUrl(url, 'test-suite', { NODE_ENV: 'test' }),
      /must use postgres:\/\/ or postgresql:\/\/ protocol/,
    );
  }
});

test('test-database-guard rejects missing database name or production-named databases', () => {
  assert.throws(
    () => assertDisposableTestDatabaseUrl('postgresql://127.0.0.1:5432/', 'test-suite', { NODE_ENV: 'test' }),
    /must specify a database name/,
  );
  assert.throws(
    () => assertDisposableTestDatabaseUrl('postgresql://127.0.0.1:5432/production', 'test-suite', { NODE_ENV: 'test' }),
    /must never target a database named "production"/,
  );
  assert.throws(
    () => assertDisposableTestDatabaseUrl('postgresql://127.0.0.1:5432/prod', 'test-suite', { NODE_ENV: 'test' }),
    /must never target a database named "prod"/,
  );
});
