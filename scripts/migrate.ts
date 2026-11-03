import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import pg from 'pg';
import { resolveConfiguredDatabaseUrl } from '../server/db/postgres';
import { isNonTransactionalMigration, recoverInvalidConcurrentIndex } from '../server/db/migration-runner-utils';

const { Pool } = pg;
const migrationDir = path.resolve(process.cwd(), 'db/migrations');
const migrationFiles = (await readdir(migrationDir))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort((a, b) => a.localeCompare(b));

if (migrationFiles.length === 0) throw new Error('No database migrations found.');

const databaseUrl = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
if (!databaseUrl) throw new Error('DATABASE_URL is required for database migrations.');

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();
let transactionStarted = false;

try {
  await client.query(`
    CREATE TABLE IF NOT EXISTS prodx_schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Hold a session-level lock because non-transactional migrations must run outside BEGIN.
  await client.query("SELECT pg_advisory_lock(hashtextextended('prodx-pos:migrations', 0))");
  await client.query('BEGIN');
  transactionStarted = true;

  for (const file of migrationFiles) {
    const version = file.slice(0, -'.sql'.length);
    const result = await client.query(
      'SELECT 1 FROM prodx_schema_migrations WHERE version = $1 LIMIT 1',
      [version],
    );

    if (result.rowCount === 1) continue;

    const sql = await readFile(path.join(migrationDir, file), 'utf8');
    if (!sql.trim()) throw new Error(`Migration ${version} is empty.`);

    console.log(`Applying migration ${version}`);
    const nonTransactional = isNonTransactionalMigration(sql);
    if (nonTransactional) {
      // Commit earlier transactional migrations before executing statements such as
      // CREATE INDEX CONCURRENTLY, which PostgreSQL rejects inside a transaction.
      if (transactionStarted) {
        await client.query('COMMIT');
        transactionStarted = false;
      }

      // Recover an INVALID index left behind by an interrupted CREATE INDEX CONCURRENTLY.
      await recoverInvalidConcurrentIndex(sql, async (query, parameters) => {
        const result = await client.query(query, parameters ? [...parameters] : undefined);
        return { rowCount: result.rowCount };
      });

      await client.query(sql);
      await client.query('BEGIN');
      transactionStarted = true;
      await client.query(
        'INSERT INTO prodx_schema_migrations(version) VALUES ($1) ON CONFLICT (version) DO NOTHING',
        [version],
      );
    } else {
      await client.query(sql);
    }

    const recorded = await client.query(
      'SELECT 1 FROM prodx_schema_migrations WHERE version = $1 LIMIT 1',
      [version],
    );
    if (recorded.rowCount !== 1) {
      throw new Error(`Migration ${version} completed without recording its version.`);
    }
  }

  // Reconcile Supabase's default public-schema grants after every migration run.
  // This keeps future PRODX objects private even when a migration creates new tables/functions.
  await client.query(`
    DO $security$
    DECLARE
      object_name text;
      object_signature text;
      role_name text;
    BEGIN
      FOR object_name IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND left(c.relname, 6) = 'prodx_'
      LOOP
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', object_name);
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', object_name, role_name);
          END IF;
        END LOOP;
      END LOOP;

      FOR object_name IN
        SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'S' AND left(c.relname, 6) = 'prodx_'
      LOOP
        EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM PUBLIC', object_name);
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE ALL PRIVILEGES ON SEQUENCE public.%I FROM %I', object_name, role_name);
          END IF;
        END LOOP;
      END LOOP;

      FOR object_signature IN
        SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND left(p.proname, 6) = 'prodx_'
      LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', object_signature);
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM %I', object_signature, role_name);
          END IF;
        END LOOP;
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO prodx_app', object_signature);
      END LOOP;

      REVOKE ALL PRIVILEGES ON TABLE public.prodx_schema_migrations, public.prodx_migration_lock, public.prodx_auth_login_throttles FROM prodx_app;
      ALTER TABLE public.prodx_schema_migrations ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.prodx_migration_lock ENABLE ROW LEVEL SECURITY;
    END
    $security$
  `);
  await client.query('COMMIT');
  console.log(`Database migrations verified: ${migrationFiles.length} migration files.`);
} catch (error) {
  if (transactionStarted) await client.query('ROLLBACK');
  throw error;
} finally {
  try {
    await client.query("SELECT pg_advisory_unlock(hashtextextended('prodx-pos:migrations', 0))");
  } finally {
    client.release();
    await pool.end();
  }
}
