import { createPostgresAuthenticationRepository, type SqlExecutor } from './postgres-repository.ts';
import { createSessionIssuer, type SessionIssuer } from './session.ts';
import { verifyPassword } from './password.ts';
import { checkPasswordCompromise } from './password-compromise.ts';

/**
 * Application composition boundary for M2 authentication.
 *
 * The concrete PostgreSQL client is owned by the application entrypoint and is
 * adapted to SqlExecutor here. Authentication policy remains independent from
 * the database SDK.
 */
export const createPostgresAuthentication = (
  db: SqlExecutor,
  checkCompromisedPassword = checkPasswordCompromise,
): SessionIssuer => {
  const repository = createPostgresAuthenticationRepository(db);
  return createSessionIssuer(repository, verifyPassword, () => new Date(), checkCompromisedPassword);
};
