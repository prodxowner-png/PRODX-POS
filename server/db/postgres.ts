import { existsSync } from 'node:fs';
import { Pool, type PoolConfig, type QueryResultRow } from 'pg';
import type { SqlExecutor } from '../auth/postgres-repository.ts';

const LOCAL_POSTGRES_SOCKET = '/tmp/pgrun/.s.PGSQL.5432';
const LOCAL_FALLBACK_DATABASE_URL = 'postgresql://postgres@127.0.0.1:5432/prodx_pos';

const isProductionRuntime = (): boolean =>
  process.env.NODE_ENV === 'production' ||
  (process.env.VERCEL === '1' && process.env.VERCEL_ENV === 'production');

const shouldResolveProductionDatabaseUrl = (): boolean =>
  process.env.VERCEL === '1' && (
    process.env.VERCEL_ENV === 'production' ||
    (process.env.VERCEL_ENV === undefined && process.env.NODE_ENV === 'production')
  );

export const resolveConfiguredDatabaseUrl = (
  rawUrl: string | undefined = process.env.DATABASE_URL,
): string | undefined => {
  const trimmed = rawUrl?.trim();
  if (!trimmed || trimmed === 'postgresql://...' || trimmed === 'postgres://...') {
    if (process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'production') {
      return LOCAL_FALLBACK_DATABASE_URL;
    }
    return undefined;
  }
  return trimmed;
};

export type ProductionDatabaseTarget = 'supabase_session_pooler' | 'other' | 'invalid';

export const classifyProductionDatabaseTarget = (databaseUrl?: string): ProductionDatabaseTarget => {
  if (!databaseUrl) return 'invalid';
  try {
    const parsed = new URL(databaseUrl);
    const username = decodeURIComponent(parsed.username);
    if (
      parsed.hostname === 'aws-0-ap-southeast-1.pooler.supabase.com' &&
      parsed.port === '5432' &&
      parsed.pathname === '/postgres' &&
      username === 'prodx_app.wcyqyiewbzpmrekoljfw' &&
      parsed.searchParams.get('sslmode') !== 'disable'
    ) return 'supabase_session_pooler';
    return 'other';
  } catch {
    return 'invalid';
  }
};

/**
 * Node-postgres lets connection-string SSL options override the explicit SSL object.
 * Remove those query parameters only after the broker URL has passed the approved-target
 * check, then configure TLS with the separately supplied trusted root CA.
 */
export const normalizeApprovedPoolerConnectionString = (databaseUrl: string): string => {
  const parsed = new URL(databaseUrl);
  for (const key of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
    parsed.searchParams.delete(key);
  }
  return parsed.toString();
};

export const resolveProductionDatabaseUrl = async (
  vercelOidcToken?: string,
): Promise<string | undefined> => {
  if (!shouldResolveProductionDatabaseUrl()) {
    return resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
  }

  const oidcToken = vercelOidcToken ?? process.env.VERCEL_OIDC_TOKEN;
  if (!oidcToken) {
    throw new Error('Vercel OIDC token is required to resolve the production PostgreSQL connection.');
  }

  // Require an explicitly approved endpoint; never silently target a retired project.
  const brokerUrl = process.env.PRODX_DB_BROKER_URL?.trim();
  if (!brokerUrl) {
    throw new Error('PRODX_DB_BROKER_URL is required to resolve the production PostgreSQL connection.');
  }
  const response = await fetch(brokerUrl, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${oidcToken}`,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Production database broker rejected the request with HTTP ${response.status}.`);
  }

  const payload = await response.json() as { databaseUrl?: unknown };
  if (typeof payload.databaseUrl !== 'string' || payload.databaseUrl.length === 0) {
    throw new Error('Production database broker returned no database URL.');
  }
  if (classifyProductionDatabaseTarget(payload.databaseUrl) !== 'supabase_session_pooler') {
    throw new Error('Production database broker returned an unapproved database target.');
  }

  return payload.databaseUrl;
};

export const createPostgresPool = (config: PoolConfig = {}): Pool => {
  const connectionString = resolveConfiguredDatabaseUrl(config.connectionString ?? process.env.DATABASE_URL);
  if (!connectionString) {
    console.warn('DATABASE_URL is missing or unconfigured. PostgreSQL pool created in mock/degraded mode.');
    // Return a dummy pool that fails safely on query
    return {
      query: () => Promise.reject(new Error('PostgreSQL is not configured (DATABASE_URL is missing).')),
      on: () => {},
      end: () => Promise.resolve(),
      connect: () => Promise.reject(new Error('PostgreSQL is not configured.')),
    } as unknown as Pool;
  }

  return new Pool({
    ...config,
    connectionString,
    max: config.max ?? (process.env.VERCEL ? 1 : 10),
    ssl: config.ssl ?? (isProductionRuntime() ? { rejectUnauthorized: true } : undefined),
  });
};

export const createProductionPostgresPool = async (
  config: PoolConfig = {},
  vercelOidcToken?: string,
): Promise<Pool> => {
  // Production must always resolve the approved database through the authenticated broker.
  // Caller-supplied PoolConfig.connectionString must never bypass this trust boundary.
  const isVercelProduction = shouldResolveProductionDatabaseUrl();
  const resolvedUrl = isVercelProduction
    ? await resolveProductionDatabaseUrl(vercelOidcToken)
    : config.connectionString ?? await resolveProductionDatabaseUrl(vercelOidcToken);

  let connectionString = resolvedUrl;
  let ssl = config.ssl;

  if (isVercelProduction) {
    if (classifyProductionDatabaseTarget(resolvedUrl) !== 'supabase_session_pooler') {
      throw new Error('Production database broker returned an unapproved database target.');
    }

    const ca = process.env.SUPABASE_DB_CA_CERT?.trim();
    if (!ca || !ca.includes('-----BEGIN CERTIFICATE-----') || !ca.includes('-----END CERTIFICATE-----')) {
      throw new Error('SUPABASE_DB_CA_CERT must contain the trusted Supabase PostgreSQL root CA certificate.');
    }

    // Explicit CA + strict hostname/chain validation. Never fall back to rejectUnauthorized:false.
    // Strip URL SSL parameters because pg-connection-string otherwise overrides this SSL object.
    connectionString = normalizeApprovedPoolerConnectionString(resolvedUrl!);
    ssl = { ca, rejectUnauthorized: true };
    console.info('PRODX production database target selected', {
      target: 'supabase_session_pooler',
      tls: 'verified_root_ca',
    });
  }

  return createPostgresPool({ ...config, connectionString, ssl });
};

export const asSqlExecutor = (pool: Pick<Pool, 'query'>): SqlExecutor => ({
  async query<T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) {
    const result = await pool.query<T & QueryResultRow>(sql, [...parameters]);
    return result.rows;
  },
});
