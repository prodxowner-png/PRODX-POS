import type { Pool } from 'pg';

type SafeReadinessError = Error & {
  code?: string;
  syscall?: string;
  stage: 'database_query';
};

const toSafeReadinessError = (error: unknown): SafeReadinessError => {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown; syscall?: unknown }
    : {};
  const failure = new Error('PostgreSQL readiness check failed.') as SafeReadinessError;
  failure.stage = 'database_query';

  if (typeof candidate.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(candidate.code)) {
    failure.code = candidate.code;
  }
  if (candidate.syscall === 'getaddrinfo' || candidate.syscall === 'connect' ||
      candidate.syscall === 'read' || candidate.syscall === 'write') {
    failure.syscall = candidate.syscall;
  }

  return failure;
};

/**
 * Probes the already-authenticated production pool rather than inspecting DATABASE_URL.
 * The pool may have been configured by the production broker, so environment-variable
 * presence is not proof of readiness and must not gate this query.
 */
export const assertPostgresReady = async (pool: Pick<Pool, 'query'>): Promise<void> => {
  try {
    const result = await pool.query<{ ok: number }>('SELECT 1 AS ok');
    if (result.rows[0]?.ok !== 1) {
      const error = new Error('PostgreSQL readiness probe returned an unexpected result.') as Error & { code: string };
      error.code = 'READINESS_PROBE_FAILED';
      throw error;
    }
  } catch (error: unknown) {
    throw toSafeReadinessError(error);
  }
};
