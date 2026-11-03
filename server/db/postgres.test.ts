import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { classifyProductionDatabaseTarget, createProductionPostgresPool, resolveConfiguredDatabaseUrl, resolveProductionDatabaseUrl } from './postgres';

const APPROVED_DATABASE_URL = 'postgresql://prodx_app.wcyqyiewbzpmrekoljfw:test-only-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require';

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

test('classifies production database targets without returning or logging hostnames', () => {
  assert.equal(classifyProductionDatabaseTarget(APPROVED_DATABASE_URL), 'supabase_session_pooler');
  assert.equal(classifyProductionDatabaseTarget('postgresql://prodx_app.bbxoywnlayduqbrjeixj:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require'), 'other');
  assert.equal(classifyProductionDatabaseTarget('postgresql://prodx_app.wcyqyiewbzpmrekoljfw:secret@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require'), 'other');
  assert.equal(classifyProductionDatabaseTarget('postgresql://user:secret@db.bbxoywnlayduqbrjeixj.supabase.co:5432/postgres'), 'other');
  assert.equal(classifyProductionDatabaseTarget('postgresql://user:secret@db.example.internal:5432/postgres'), 'other');
  assert.equal(classifyProductionDatabaseTarget('not a database URL'), 'invalid');
});

test('runtime source targets only the PRODX-ORG session pooler', async () => {
  const runtimeSource = await readFile(new URL('./postgres.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(runtimeSource, /db\.bbxoywnlayduqbrjeixj\.supabase\.co/);
  assert.match(runtimeSource, /aws-0-ap-southeast-1\.pooler\.supabase\.com/);
  assert.match(runtimeSource, /prodx_app\.wcyqyiewbzpmrekoljfw/);
});

test('resolveProductionDatabaseUrl uses DATABASE_URL outside Vercel production', async () => {
  await withEnvironment(
    { VERCEL: undefined, NODE_ENV: 'test', DATABASE_URL: 'postgresql://local.example/prodx' },
    async () => {
      assert.equal(await resolveProductionDatabaseUrl(), 'postgresql://local.example/prodx');
    },
  );
});

test('resolveProductionDatabaseUrl fails closed when no Vercel runtime token is available', async () => {
  await withEnvironment(
    { VERCEL: '1', NODE_ENV: 'production', DATABASE_URL: 'postgresql://legacy.example/prodx', VERCEL_OIDC_TOKEN: undefined },
    async () => {
      await assert.rejects(
        resolveProductionDatabaseUrl(),
        /Vercel OIDC token is required/,
      );
    },
  );
});

test('resolveProductionDatabaseUrl fails closed when the production broker endpoint is not configured', async () => {
  await withEnvironment(
    {
      VERCEL: '1',
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://legacy.example/prodx',
      VERCEL_OIDC_TOKEN: undefined,
      PRODX_DB_BROKER_URL: undefined,
    },
    async () => {
      await assert.rejects(
        resolveProductionDatabaseUrl('request-oidc-token'),
        /PRODX_DB_BROKER_URL is required/,
      );
    },
  );
});

test('resolveProductionDatabaseUrl uses the Vercel request token instead of DATABASE_URL', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedAuthorization = '';

  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedAuthorization = new Headers(init?.headers).get('authorization') ?? '';
    return new Response(JSON.stringify({ databaseUrl: APPROVED_DATABASE_URL }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await withEnvironment(
      {
        VERCEL: '1',
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://legacy.example/prodx',
        VERCEL_OIDC_TOKEN: undefined,
        PRODX_DB_BROKER_URL: 'https://broker.example/prodx-db',
      },
      async () => {
        assert.equal(
          await resolveProductionDatabaseUrl('request-oidc-token'),
          APPROVED_DATABASE_URL,
        );
        assert.equal(requestedUrl, 'https://broker.example/prodx-db');
        assert.equal(requestedAuthorization, 'Bearer request-oidc-token');
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolveProductionDatabaseUrl falls back to VERCEL_OIDC_TOKEN for local tooling', async () => {
  const originalFetch = globalThis.fetch;
  let requestedAuthorization = '';

  globalThis.fetch = async (_input, init) => {
    requestedAuthorization = new Headers(init?.headers).get('authorization') ?? '';
    return new Response(JSON.stringify({ databaseUrl: APPROVED_DATABASE_URL }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await withEnvironment(
      {
        VERCEL: '1',
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://legacy.example/prodx',
        VERCEL_OIDC_TOKEN: 'environment-oidc-token',
        PRODX_DB_BROKER_URL: 'https://broker.example/prodx-db',
      },
      async () => {
        assert.equal(await resolveProductionDatabaseUrl(), APPROVED_DATABASE_URL);
        assert.equal(requestedAuthorization, 'Bearer environment-oidc-token');
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createProductionPostgresPool cannot bypass the production broker with a caller-supplied connection string', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({ databaseUrl: APPROVED_DATABASE_URL }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await withEnvironment({
      VERCEL: '1',
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://legacy.example/prodx',
      VERCEL_OIDC_TOKEN: undefined,
      PRODX_DB_BROKER_URL: 'https://broker.example/prodx-db',
      SUPABASE_DB_CA_CERT: '-----BEGIN CERTIFICATE-----\\ntest-only-root-ca\\n-----END CERTIFICATE-----',
    }, async () => {
      const pool = await createProductionPostgresPool({
        connectionString: 'postgresql://caller-controlled.example/prodx',
      }, 'request-oidc-token');
      try {
        assert.equal(requestedUrl, 'https://broker.example/prodx-db');
        const options = pool as unknown as {
          options: { connectionString: string; ssl: { ca: string; rejectUnauthorized: boolean } };
        };
        assert.equal(new URL(options.options.connectionString).searchParams.has('sslmode'), false);
        assert.equal(options.options.ssl.ca, '-----BEGIN CERTIFICATE-----\\ntest-only-root-ca\\n-----END CERTIFICATE-----');
        assert.equal(options.options.ssl.rejectUnauthorized, true);
      } finally {
        await pool.end();
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolveProductionDatabaseUrl rejects a broker URL for another project or an unapproved host', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ databaseUrl: 'postgresql://prodx_app.bbxoywnlayduqbrjeixj:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    await withEnvironment({
      VERCEL: '1',
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://legacy.example/prodx',
      VERCEL_OIDC_TOKEN: undefined,
      PRODX_DB_BROKER_URL: 'https://broker.example/prodx-db',
    }, async () => {
      await assert.rejects(resolveProductionDatabaseUrl('request-oidc-token'), /unapproved database target/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolveProductionDatabaseUrl rejects a broker failure', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });

  try {
    await withEnvironment(
      {
        VERCEL: '1',
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://legacy.example/prodx',
        VERCEL_OIDC_TOKEN: undefined,
        PRODX_DB_BROKER_URL: 'https://broker.example/prodx-db',
      },
      async () => {
        await assert.rejects(
          resolveProductionDatabaseUrl('request-oidc-token'),
          /broker rejected the request with HTTP 503/,
        );
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolveConfiguredDatabaseUrl preserves valid URLs and rejects placeholder strings in Vercel production', async () => {
  assert.equal(resolveConfiguredDatabaseUrl('postgresql://local.example/prodx'), 'postgresql://local.example/prodx');
  await withEnvironment(
    { VERCEL: '1', NODE_ENV: 'production' },
    async () => {
      assert.equal(resolveConfiguredDatabaseUrl('postgresql://...'), undefined);
      assert.equal(resolveConfiguredDatabaseUrl('   '), undefined);
    },
  );
});

