type BootstrapIntegrationEnvironment = {
  PRODX_RUN_BOOTSTRAP_POSTGRES_INTEGRATION?: string;
  PRODX_BOOTSTRAP_TEST_DATABASE_URL?: string;
  DATABASE_URL?: string;
};

type DatabaseTarget = {
  protocol: string;
  hostname: string;
  port: string;
  database: string;
};

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

const parsePostgresTarget = (rawUrl: string, variableName: string): DatabaseTarget => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(variableName + ' must be a valid PostgreSQL connection URL.');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(variableName + ' must use the postgres:// or postgresql:// protocol.');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\\/+/, ''));
  if (!database) {
    throw new Error(variableName + ' must include a database name.');
  }

  return {
    // postgres:// and postgresql:// are aliases for the same PostgreSQL target.
    protocol: 'postgresql:',
    hostname: parsed.hostname.toLowerCase(),
    port: parsed.port || '5432',
    database,
  };
};

/**
 * Resolve the isolated bootstrap integration database without the application's
 * local DATABASE_URL fallback. Refuse any target that could overlap shared data.
 */
export const resolveBootstrapIntegrationDatabaseUrl = (
  env: BootstrapIntegrationEnvironment = process.env,
): string | null => {
  if (env.PRODX_RUN_BOOTSTRAP_POSTGRES_INTEGRATION !== '1') return null;

  const rawDedicatedUrl = env.PRODX_BOOTSTRAP_TEST_DATABASE_URL?.trim();
  if (!rawDedicatedUrl) {
    throw new Error(
      'PRODX_BOOTSTRAP_TEST_DATABASE_URL must be explicitly set when the bootstrap PostgreSQL integration gate is enabled.',
    );
  }

  const dedicatedTarget = parsePostgresTarget(
    rawDedicatedUrl,
    'PRODX_BOOTSTRAP_TEST_DATABASE_URL',
  );

  if (!LOOPBACK_HOSTNAMES.has(dedicatedTarget.hostname)) {
    throw new Error(
      'PRODX_BOOTSTRAP_TEST_DATABASE_URL must point to a loopback PostgreSQL host (localhost, 127.0.0.1, or ::1).',
    );
  }

  if (dedicatedTarget.database !== 'prodx_bootstrap_test') {
    throw new Error(
      'PRODX_BOOTSTRAP_TEST_DATABASE_URL must target the dedicated prodx_bootstrap_test database.',
    );
  }

  const sharedUrl = env.DATABASE_URL?.trim();
  if (sharedUrl) {
    const sharedTarget = parsePostgresTarget(sharedUrl, 'DATABASE_URL');
    if (
      dedicatedTarget.protocol === sharedTarget.protocol &&
      dedicatedTarget.hostname === sharedTarget.hostname &&
      dedicatedTarget.port === sharedTarget.port &&
      dedicatedTarget.database === sharedTarget.database
    ) {
      throw new Error(
        'PRODX_BOOTSTRAP_TEST_DATABASE_URL must not target the same database as DATABASE_URL.',
      );
    }
  }

  return rawDedicatedUrl;
};
