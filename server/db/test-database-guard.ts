import { classifyProductionDatabaseTarget } from './postgres.ts';

const DISPOSABLE_TEST_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  'postgres',
  'localhost.localdomain',
]);

const FORBIDDEN_TARGET_QUERY_PARAMETERS = new Set(['host', 'port']);
const SAFE_TEST_DATABASE_NAME = /^prodx_(?:[a-z0-9]+_)*(?:test|tests|ci|integration)$/i;
const FORBIDDEN_DATABASE_NAME_SEGMENTS = new Set(['prod', 'production', 'staging', 'live']);

export type TestDatabaseEnvironment = {
  NODE_ENV?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
  DATABASE_URL?: string;
};

/**
 * Validates that a database URL points to an isolated, disposable local or container test database.
 * Explicitly rejects production targets, remote database endpoints, cloud poolers, and production runtime environments.
 */
export const assertDisposableTestDatabaseUrl = (
  rawUrl: string | undefined,
  contextName = 'Integration test',
  env: TestDatabaseEnvironment = process.env,
): string => {
  if (!rawUrl || !rawUrl.trim()) {
    throw new Error(`${contextName}: DATABASE_URL must be provided.`);
  }

  const trimmed = rawUrl.trim();

  // 1. Prevent running integration tests when environment indicates production
  if (
    env.NODE_ENV === 'production' ||
    (env.VERCEL === '1' && env.VERCEL_ENV === 'production')
  ) {
    throw new Error(
      `${contextName}: Integration tests must never execute against a production runtime environment.`,
    );
  }

  // 2. Reject known production Supabase broker targets
  if (classifyProductionDatabaseTarget(trimmed) === 'supabase_session_pooler') {
    throw new Error(
      `${contextName}: Integration tests must never target the production Supabase database.`,
    );
  }

  // 3. Parse URL and validate protocol
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${contextName}: DATABASE_URL must be a valid PostgreSQL connection URL.`);
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(
      `${contextName}: DATABASE_URL must use postgres:// or postgresql:// protocol.`,
    );
  }

  // 4. Forbid query parameters that hijack host/port
  for (const key of parsed.searchParams.keys()) {
    if (FORBIDDEN_TARGET_QUERY_PARAMETERS.has(key.toLowerCase())) {
      throw new Error(
        `${contextName}: DATABASE_URL must not override the database host or port through query parameters.`,
      );
    }
  }

  // 5. Hostname check: must be a disposable test host (loopback or local container)
  const hostname = parsed.hostname.toLowerCase();
  if (!DISPOSABLE_TEST_HOSTNAMES.has(hostname)) {
    throw new Error(
      `${contextName}: Integration tests must target a disposable local PostgreSQL host (localhost, 127.0.0.1, ::1, or postgres container), received: "${hostname}".`,
    );
  }

  // 6. Database path check: must have a non-empty database name
  const databasePath = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname;
  const database = decodeURIComponent(databasePath);
  if (!database) {
    throw new Error(`${contextName}: DATABASE_URL must specify a database name.`);
  }

  // 7. Forbid production-like database names
  const lowerDb = database.toLowerCase();
  if (lowerDb.split('_').some((segment) => FORBIDDEN_DATABASE_NAME_SEGMENTS.has(segment)) || !SAFE_TEST_DATABASE_NAME.test(lowerDb)) {
    throw new Error(
      `${contextName}: DATABASE_URL must target an explicitly named disposable PRODX test database ending in _test, _tests, _ci, or _integration; received: "${database}".`,
    );
  }

  return trimmed;
};

/** Resolve only an explicitly configured disposable test database. Never use the local runtime fallback. */
export const resolveDisposableTestDatabaseUrl = (
  rawUrl: string | undefined,
  contextName = 'Integration test',
  env: TestDatabaseEnvironment = process.env,
): string | undefined => {
  if (rawUrl === undefined) return undefined;
  return assertDisposableTestDatabaseUrl(rawUrl, contextName, env);
};
