import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertDisposableTestDatabaseUrl, resolveDisposableTestDatabaseUrl } from './test-database-guard';

test('test-database-guard accepts valid local loopback PostgreSQL URLs', () => {
  const localUrls = [
    'postgresql://prodx:prodx@127.0.0.1:5432/prodx_test',
    'postgresql://prodx:prodx@localhost:5432/prodx_bootstrap_test',
    'postgresql://prodx:prodx@127.0.0.1:5432/prodx_migration_runner_test',
    'postgresql://postgres@[::1]:5432/prodx_pos_ci',
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

test('test-database-guard rejects missing database name, runtime databases, and production-like names', () => {
  assert.throws(
    () => assertDisposableTestDatabaseUrl('postgresql://127.0.0.1:5432/', 'test-suite', { NODE_ENV: 'test' }),
    /must specify a database name/,
  );
  assert.throws(
    () => assertDisposableTestDatabaseUrl('postgresql://127.0.0.1:5432/production', 'test-suite', { NODE_ENV: 'test' }),
    /must target an explicitly named disposable PRODX test database/,
  );
  assert.throws(
    () => assertDisposableTestDatabaseUrl('postgresql://127.0.0.1:5432/prod', 'test-suite', { NODE_ENV: 'test' }),
    /must target an explicitly named disposable PRODX test database/,
  );
});

test('test-database-guard rejects the local POS runtime database even on loopback', () => {
  assert.throws(
    () => assertDisposableTestDatabaseUrl('postgresql://postgres@127.0.0.1:5432/prodx_pos', 'test-suite', { NODE_ENV: 'test' }),
    /must target an explicitly named disposable PRODX test database/,
  );
  assert.throws(
    () => assertDisposableTestDatabaseUrl('postgresql://prodx@127.0.0.1:5432/prodx_production_test', 'test-suite', { NODE_ENV: 'test' }),
    /must target an explicitly named disposable PRODX test database/,
  );
});

test('resolveDisposableTestDatabaseUrl never falls back when DATABASE_URL is absent', () => {
  assert.equal(resolveDisposableTestDatabaseUrl(undefined, 'test-suite', { NODE_ENV: 'test' }), undefined);
  assert.throws(
    () => resolveDisposableTestDatabaseUrl('', 'test-suite', { NODE_ENV: 'test' }),
    /DATABASE_URL must be provided/,
  );
  assert.equal(
    resolveDisposableTestDatabaseUrl('postgresql://prodx:prodx@127.0.0.1:5432/prodx_test', 'test-suite', { NODE_ENV: 'test' }),
    'postgresql://prodx:prodx@127.0.0.1:5432/prodx_test',
  );
});

test('every server test that creates a PostgreSQL pool validates an explicit disposable database URL', () => {
  const serverRoot = fileURLToPath(new URL('../', import.meta.url));
  const collectTestFiles = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTestFiles(entryPath);
      return entry.isFile() && entry.name.endsWith('.test.ts') ? [entryPath] : [];
    });

  const unguardedFiles = collectTestFiles(serverRoot).filter((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const createsPostgresPool = /\b(?:new\s+Pool|createPostgresPool)\s*\(/.test(source);
    const validatesTestDatabase = /\b(?:resolveDisposableTestDatabaseUrl|assertDisposableTestDatabaseUrl)\s*\(/.test(source);
    return createsPostgresPool && !validatesTestDatabase;
  }).map((filePath) => path.relative(serverRoot, filePath));

  assert.deepEqual(unguardedFiles, [], 'PostgreSQL test connections must be guarded by the disposable test database validator');
});
