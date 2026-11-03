import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionPostgresPool, normalizeApprovedPoolerConnectionString } from './postgres';

const ROOT_CA = '-----BEGIN CERTIFICATE-----\ntest-only-root-ca\n-----END CERTIFICATE-----';
const APPROVED_DATABASE_URL =
  'postgresql://prodx_app.wcyqyiewbzpmrekoljfw:test-only-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require';

const withEnvironment = async (run: () => Promise<void>) => {
  const names = ['VERCEL', 'VERCEL_ENV', 'NODE_ENV', 'DATABASE_URL', 'VERCEL_OIDC_TOKEN',
    'PRODX_DB_BROKER_URL', 'SUPABASE_DB_CA_CERT'] as const;
  const previous = new Map<string, string | undefined>();
  for (const name of names) {
    previous.set(name, process.env[name]);
    delete process.env[name];
  }
  Object.assign(process.env, {
    VERCEL: '1',
    VERCEL_ENV: 'production',
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://legacy.example/prodx',
    PRODX_DB_BROKER_URL: 'https://broker.example/prodx-db',
    SUPABASE_DB_CA_CERT: ROOT_CA,
  });
  try {
    await run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};

test('approved production pooler URL removes SSL query options before explicit CA TLS is applied', () => {
  const normalized = new URL(normalizeApprovedPoolerConnectionString(
    'postgresql://prodx_app.wcyqyiewbzpmrekoljfw:test-only-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&ssl=false&sslrootcert=%2Ftmp%2Fwrong-ca.pem&sslcert=%2Ftmp%2Fclient.crt&sslkey=%2Ftmp%2Fclient.key',
  ));
  for (const key of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
    assert.equal(normalized.searchParams.has(key), false, `expected ${key} to be removed`);
  }
  assert.equal(normalized.hostname, 'aws-0-ap-southeast-1.pooler.supabase.com');
  assert.equal(normalized.username, 'prodx_app.wcyqyiewbzpmrekoljfw');
});

test('production PostgreSQL pool uses explicit Supabase root CA and keeps certificate validation enabled', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ databaseUrl: APPROVED_DATABASE_URL }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  try {
    await withEnvironment(async () => {
      const pool = await createProductionPostgresPool({}, 'request-oidc-token');
      try {
        const options = pool as unknown as {
          options: { connectionString: string; ssl: { ca: string; rejectUnauthorized: boolean } };
        };
        assert.equal(options.options.ssl.ca, ROOT_CA);
        assert.equal(options.options.ssl.rejectUnauthorized, true);
        assert.equal(new URL(options.options.connectionString).searchParams.has('sslmode'), false);
      } finally {
        await pool.end();
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('production pool fails closed if the trusted root CA is missing', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ databaseUrl: APPROVED_DATABASE_URL }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
  try {
    await withEnvironment(async () => {
      delete process.env.SUPABASE_DB_CA_CERT;
      await assert.rejects(
        createProductionPostgresPool({}, 'request-oidc-token'),
        /SUPABASE_DB_CA_CERT must contain the trusted Supabase PostgreSQL root CA certificate/,
      );
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
