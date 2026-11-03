import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createPostgresPool, resolveConfiguredDatabaseUrl } from './db/postgres';

const workspaceRoot = process.cwd();

test('Architecture Gate 1: Authoritative financial modules contain zero IEEE-754 floating-point money conversions', () => {
  const authoritativeFinancialFiles = [
    'server/shift/shift-service.ts',
    'server/http/catalog-pricing-route.ts',
    'server/http/catalog-import-route.ts',
    'server/transactions/checkout-service.ts',
    'server/transactions/refund-service.ts',
    'server/transactions/void-service.ts',
    'src/domain/money.ts',
    'src/domain/order.ts',
    'src/domain/taxInvoice.ts',
  ];

  const forbiddenPatterns = [
    /parseFloat\s*\(/,
    /Math\.round\s*\(\s*Number\s*\(/,
    /amountInCents\s*\/\s*100\b/,
    /cents\s*\([^)]*\)\s*\/\s*100\b/,
  ];

  for (const relativePath of authoritativeFinancialFiles) {
    const fullPath = path.join(workspaceRoot, relativePath);
    const content = fs.readFileSync(fullPath, 'utf8');
    for (const pattern of forbiddenPatterns) {
      assert.equal(
        pattern.test(content),
        false,
        `Forbidden floating-point money pattern ${pattern} found in ${relativePath}`,
      );
    }
  }
});

test('Architecture Gate 2: Production POS, Shift, Orders, Inventory, and Returns modules do not import mockAdapter directly', () => {
  const productionFiles = [
    'src/modules/returns/ReturnsAuthorizationModule.tsx',
    'src/modules/inventory/InventoryScreen.tsx',
    'src/modules/shift/ShiftScreen.tsx',
    'src/modules/orders/OrdersScreen.tsx',
    'src/components/orders/OrderRefundModal.tsx',
  ];

  for (const relativePath of productionFiles) {
    const fullPath = path.join(workspaceRoot, relativePath);
    const content = fs.readFileSync(fullPath, 'utf8');
    assert.equal(
      content.includes('mockAdapter'),
      false,
      `Unauthorized direct mockAdapter import found in ${relativePath}`,
    );
  }
});

test('Security Gate 3: Refund and Returns UI modules contain zero hardcoded supervisor PINs', () => {
  const files = [
    'src/modules/returns/ReturnsAuthorizationModule.tsx',
    'src/components/orders/OrderRefundModal.tsx',
  ];

  for (const relativePath of files) {
    const fullPath = path.join(workspaceRoot, relativePath);
    const content = fs.readFileSync(fullPath, 'utf8');
    assert.equal(
      /\['1234',\s*'9999'/.test(content),
      false,
      `Hardcoded supervisor PIN array found in ${relativePath}`,
    );
  }
});

test('Database & Security Gate 4: PostgreSQL append-only audit trigger, RLS, and least-privilege prodx_app role are enforced', async (t) => {
  const databaseUrl = resolveConfiguredDatabaseUrl(process.env.DATABASE_URL);
  if (!databaseUrl) {
    t.skip('DATABASE_URL not configured');
    return;
  }

  const pool = createPostgresPool({ connectionString: databaseUrl, max: 2 });
  t.after(async () => {
    await pool.end();
  });

  try {
    // 1. Verify append-only trigger on prodx_audit_log
    const triggerRes = await pool.query<{ tgname: string; tgenabled: string }>(
      `SELECT tgname, tgenabled
         FROM pg_trigger
        WHERE tgname = 'prodx_audit_log_immutable_guard'
          AND NOT tgisinternal`,
    );
    assert.equal(triggerRes.rows.length, 1, 'prodx_audit_log_immutable_guard trigger must exist');
    assert.equal(triggerRes.rows[0].tgenabled, 'O', 'prodx_audit_log_immutable_guard trigger must be enabled');

    // 2. Verify Row-Level Security (RLS) is enabled on core tenant tables
    const rlsTables = [
      'prodx_orders',
      'prodx_order_items',
      'prodx_payments',
      'prodx_refunds',
      'prodx_voids',
      'prodx_shifts',
      'prodx_cash_movements',
      'prodx_inventory_ledger',
      'prodx_audit_log',
    ];
    const rlsRes = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity
         FROM pg_class
        WHERE relname = ANY($1::text[])`,
      [rlsTables],
    );
    assert.equal(rlsRes.rows.length, rlsTables.length);
    for (const row of rlsRes.rows) {
      assert.equal(row.relrowsecurity, true, `RLS must be enabled on ${row.relname}`);
    }

    // 3. Verify least-privilege prodx_app role flags
    const roleRes = await pool.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>(
      `SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
         FROM pg_roles
        WHERE rolname = 'prodx_app'`,
    );
    assert.equal(roleRes.rows.length, 1, 'prodx_app role must exist');
    assert.equal(roleRes.rows[0].rolsuper, false, 'prodx_app must not be superuser');
    assert.equal(roleRes.rows[0].rolbypassrls, false, 'prodx_app must not bypass RLS');
    assert.equal(roleRes.rows[0].rolcreatedb, false, 'prodx_app must not have CREATEDB');
    assert.equal(roleRes.rows[0].rolcreaterole, false, 'prodx_app must not have CREATEROLE');
  } catch (err: any) {
    if (err?.code === 'ECONNREFUSED' || err?.message?.includes('ECONNREFUSED')) {
      t.skip('PostgreSQL database not running locally (running in Firestore mode)');
      return;
    }
    throw err;
  }
});

test('Security Gate 5: RLS enablement migration must not alter tables owned by other applications', () => {
  const migration = fs.readFileSync(
    path.join(workspaceRoot, 'db/migrations/0034_security_enable_rls_all_tables.sql'),
    'utf8',
  );
  assert.match(migration, /c\.relname\s+LIKE\s+'prodx\\_%'\s+ESCAPE\s+'\\'/);
  assert.doesNotMatch(
    migration,
    /WHERE\s+n\.nspname\s*=\s*'public'\s+AND\s+c\.relkind\s*=\s*'r'\s+AND\s+c\.relname\s+NOT\s+IN/i,
    'RLS migration must not enable RLS indiscriminately on every public table',
  );
});


test('Security Gate 6: runtime-role migration never installs unconditional policies or grants every public table', () => {
  const migration = fs.readFileSync(
    path.join(workspaceRoot, 'db/migrations/0033_security_prodx_app_role.sql'),
    'utf8',
  );
  assert.match(migration, /c\.relname\s+LIKE\s+'prodx\\_%'\s+ESCAPE\s+'\\'/);
  assert.match(migration, /CREATE\s+ROLE\s+prodx_app\s+WITH\s+LOGIN\s+NOINHERIT/i);
  assert.match(migration, /FROM\s+pg_roles[\s\S]*?rolsuper[\s\S]*?rolbypassrls/i);
  assert.doesNotMatch(migration, /ALTER\s+ROLE\s+prodx_app/i, 'hosted Supabase migrations must not require superuser-only role attribute changes');
  assert.doesNotMatch(
    migration,
    /ON\s+ALL\s+TABLES\s+IN\s+SCHEMA\s+public\s+TO\s+prodx_app/i,
    'runtime role must not receive blanket privileges on every public table',
  );
  assert.doesNotMatch(
    migration,
    /CREATE\s+POLICY[\s\S]*?USING\s*\(\s*true\s*\)[\s\S]*?WITH\s+CHECK\s*\(\s*true\s*\)/i,
    'role bootstrap must not install unconditional row access policies',
  );
});

test('Security Gate 7: tenant RLS classification and sequence grants are scoped to PRODX-owned objects', () => {
  const migration = fs.readFileSync(
    path.join(workspaceRoot, 'db/migrations/0036_security_tenant_store_rls.sql'),
    'utf8',
  );
  assert.match(migration, /c\.relname\s+LIKE\s+'prodx\\_%'\s+ESCAPE\s+'\\'/);
  assert.match(migration, /GRANT\s+USAGE,\s*SELECT\s+ON\s+SEQUENCE\s+public\.%I\s+TO\s+prodx_app/);
  assert.doesNotMatch(
    migration,
    /CREATE\s+POLICY[^;]*USING\s*\(\s*true\s*\)|CREATE\s+POLICY[^;]*WITH\s+CHECK\s*\(\s*true\s*\)/i,
    'tenant RLS migration must not create unconditional policies',
  );
  assert.match(
    migration,
    /CREATE\s+POLICY\s+prodx_app_global_permissions_read[\s\S]*?USING\s*\(permission_key IS NOT NULL AND length\(btrim\(permission_key\)\) > 0\)/i,
    'global permission catalog must use an explicit nonblank-key predicate',
  );
  const permissionSchema = fs.readFileSync(
    path.join(workspaceRoot, 'db/migrations/0004_m1_2_rbac.sql'),
    'utf8',
  );
  const permissionTable = permissionSchema.match(/CREATE TABLE IF NOT EXISTS prodx_permissions \([\s\S]*?\);/i)?.[0];
  assert.ok(permissionTable, 'canonical global permission table schema must be present');
  assert.doesNotMatch(permissionTable, /\b(organization_id|store_id)\b/i);
  assert.match(permissionTable, /permission_key TEXT NOT NULL/i);
  assert.match(permissionTable, /CHECK \(length\(btrim\(permission_key\)\) > 0\)/i);
});

test('Security Gate 8: legacy policy cleanup removes only the named prodx_app policy and foreign grants', () => {
  const migration = fs.readFileSync(
    path.join(workspaceRoot, 'db/migrations/0037_security_remove_legacy_runtime_access.sql'),
    'utf8',
  );
  assert.match(migration, /DROP\s+POLICY\s+IF\s+EXISTS\s+prodx_app_global_permissions_read\s+ON\s+public\.prodx_permissions/i);
  assert.match(migration, /CREATE\s+POLICY\s+prodx_app_global_permissions_read[\s\S]*?USING\s*\(permission_key IS NOT NULL AND length\(btrim\(permission_key\)\) > 0\)/i);
  assert.doesNotMatch(migration, /CREATE\s+POLICY\s+prodx_app_global_permissions_read[^;]*USING\s*\(\s*true\s*\)/i);
  assert.match(migration, /polname\s*=\s*'prodx_app_runtime_access'/);
  assert.match(migration, /polroles\s*=\s*ARRAY\[app_role_oid\]/);
  assert.match(migration, /c\.relkind\s+IN\s+\('r',\s*'p',\s*'v',\s*'m',\s*'f'\)/);
  assert.match(migration, /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE\s+public\.%I\s+FROM\s+prodx_app/);
  assert.match(
    migration,
    /AND\s+left\(c\.relname,\s*6\)\s*<>\s*'prodx_'/,
    'foreign-object cleanup must be scoped to non-PRODX public objects',
  );
  assert.match(
    migration,
    /REVOKE\s+USAGE\s*,\s*SELECT\s+ON\s+ALL\s+SEQUENCES\s+IN\s+SCHEMA\s+public\s+FROM\s+prodx_app/i,
    'legacy sequence grants must be removed before PRODX sequence grants are restored',
  );
  assert.match(
    migration,
    /AND\s+left\(c\.relname,\s*6\)\s*=\s*'prodx_'/,
    'sequence access must be restored only for PRODX-owned sequences',
  );
  assert.match(
    migration,
    /ALTER\s+DEFAULT\s+PRIVILEGES\s+IN\s+SCHEMA\s+public\s+REVOKE\s+USAGE,\s*SELECT\s+ON\s+SEQUENCES\s+FROM\s+prodx_app/i,
    'legacy default sequence grants must be removed for the migration owner',
  );
  assert.match(
    migration,
    /Do not automatically DISABLE RLS on non-PRODX tables[\s\S]*?prior relrowsecurity value/i,
    'legacy repair must not blindly disable another application\'s RLS when its prior state is unknown',
  );
  assert.doesNotMatch(
    migration,
    /ALTER\s+TABLE\s+public\.%I\s+DISABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    'foreign-table RLS must not be disabled without owner-approved prior-state evidence',
  );
});

test('Security Gate 9: PRODX public tables and RPC functions are backend-only', () => {
  const migration = fs.readFileSync(
    path.join(workspaceRoot, 'db/migrations/0038_security_restrict_public_api_roles.sql'),
    'utf8',
  );
  assert.match(migration, /left\(c\.relname,\s*6\)\s*=\s*'prodx_'/);
  assert.match(migration, /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE\s+public\.%I\s+FROM\s+PUBLIC/i);
  assert.match(migration, /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+%s\s+FROM\s+PUBLIC/i);
  assert.match(migration, /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+%s\s+TO\s+prodx_app/i);
  assert.match(migration, /ALTER\s+TABLE\s+public\.prodx_schema_migrations\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  assert.match(migration, /ALTER\s+TABLE\s+public\.prodx_migration_lock\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);

  const runner = fs.readFileSync(path.join(workspaceRoot, 'scripts/migrate.ts'), 'utf8');
  assert.match(runner, /REVOKE\s+ALL\s+PRIVILEGES\s+ON\s+TABLE\s+public\.%I\s+FROM\s+PUBLIC/i);
  assert.match(runner, /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+%s\s+FROM\s+PUBLIC/i);
});
