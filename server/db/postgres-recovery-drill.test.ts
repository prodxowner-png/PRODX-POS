import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';
import { assertDisposableTestDatabaseUrl } from './test-database-guard';

const EXPECTED_36_TENANT_SENSITIVE_RLS_TABLES = [
  'prodx_audit_log',
  'prodx_cash_movements',
  'prodx_catalog_import_operations',
  'prodx_catalog_pricing_operations',
  'prodx_categories',
  'prodx_devices',
  'prodx_discount_policies',
  'prodx_inventory_adjustments',
  'prodx_inventory_ledger',
  'prodx_order_items',
  'prodx_orders',
  'prodx_organizations',
  'prodx_payment_attempts',
  'prodx_payments',
  'prodx_products',
  'prodx_refund_items',
  'prodx_refunds',
  'prodx_registers',
  'prodx_role_permissions',
  'prodx_roles',
  'prodx_security_audit_events',
  'prodx_sessions',
  'prodx_shift_operations',
  'prodx_shifts',
  'prodx_store_memberships',
  'prodx_stores',
  'prodx_supervisor_authorizations',
  'prodx_tasks',
  'prodx_timeclock_auth_attempts',
  'prodx_timeclock_credentials',
  'prodx_timeclock_operations',
  'prodx_timeclock_records',
  'prodx_user_credentials',
  'prodx_user_roles',
  'prodx_users',
  'prodx_voids',
] as const;

const EXPECTED_37_TENANT_SENSITIVE_RLS_TABLES = [
  'prodx_audit_log',
  'prodx_cash_movements',
  'prodx_catalog_import_operations',
  'prodx_catalog_pricing_operations',
  'prodx_categories',
  'prodx_devices',
  'prodx_discount_policies',
  'prodx_inventory_adjustments',
  'prodx_inventory_ledger',
  'prodx_order_items',
  'prodx_orders',
  'prodx_organizations',
  'prodx_payment_attempts',
  'prodx_payment_webhook_events',
  'prodx_payments',
  'prodx_products',
  'prodx_refund_items',
  'prodx_refunds',
  'prodx_registers',
  'prodx_role_permissions',
  'prodx_roles',
  'prodx_security_audit_events',
  'prodx_sessions',
  'prodx_shift_operations',
  'prodx_shifts',
  'prodx_store_memberships',
  'prodx_stores',
  'prodx_supervisor_authorizations',
  'prodx_tasks',
  'prodx_timeclock_auth_attempts',
  'prodx_timeclock_credentials',
  'prodx_timeclock_operations',
  'prodx_timeclock_records',
  'prodx_user_credentials',
  'prodx_user_roles',
  'prodx_users',
  'prodx_voids',
] as const;

const EXPECTED_1_FORCE_RLS_TABLES = ['prodx_discount_policies'] as const;
const EXPECTED_2_FORCE_RLS_TABLES = [
  ...EXPECTED_1_FORCE_RLS_TABLES,
  'prodx_payment_webhook_events',
] as const;

const EXPECTED_4_IMMUTABLE_TRIGGERS = [
  'prodx_audit_log_immutable_guard',
  'prodx_refund_immutable_guard',
  'prodx_security_audit_events_immutable_guard',
  'prodx_void_immutable_guard',
] as const;
const EXPECTED_5_IMMUTABLE_TRIGGERS = [
  ...EXPECTED_4_IMMUTABLE_TRIGGERS,
  'prodx_payment_webhook_events_no_delete_guard',
] as const;

const workflowPath = join(process.cwd(), '.github/workflows/postgres-recovery-drill.yml');
const scriptPath = join(process.cwd(), 'scripts/verify-postgres-backup-restore.sh');
const runbookPath = join(process.cwd(), 'docs/operations/postgres-backup-recovery.md');

test('postgres-recovery-drill.yml verifies RLS across all 36 migration-backed tenant-sensitive tables, FORCE RLS across the one baseline required table, and all 4 immutable triggers', () => {
  const workflow = readFileSync(workflowPath, 'utf8');
  const script = readFileSync(scriptPath, 'utf8');

  assert.equal(EXPECTED_36_TENANT_SENSITIVE_RLS_TABLES.length, 36);
  for (const tableName of EXPECTED_36_TENANT_SENSITIVE_RLS_TABLES) {
    const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = workflow.match(new RegExp(`'${escaped}'`, 'g')) ?? [];
    assert.ok(
      occurrences.length >= 1,
      `Expected ${tableName} in the migration-backed RLS table list in postgres-recovery-drill.yml (found ${occurrences.length})`,
    );
  }

  for (const forceRlsTable of EXPECTED_1_FORCE_RLS_TABLES) {
    const escaped = forceRlsTable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = workflow.match(new RegExp(`'${escaped}'`, 'g')) ?? [];
    assert.ok(
      occurrences.length >= 2,
      `Expected ${forceRlsTable} in the RLS and FORCE RLS table lists in postgres-recovery-drill.yml (found ${occurrences.length})`,
    );
  }

  assert.match(script, /rel\.oid\s*=\s*t\.tgrelid/i);
  assert.match(script, /rel\.relname\s*=\s*expected\.relname/i);

  for (const triggerName of EXPECTED_4_IMMUTABLE_TRIGGERS) {
    const escaped = triggerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = workflow.match(new RegExp(`'${escaped}'`, 'g')) ?? [];
    assert.ok(
      occurrences.length >= 1,
      `Expected ${triggerName} in the table-bound immutable trigger list in postgres-recovery-drill.yml`,
    );
  }

  assert.match(workflow, /left\(c\.relname,\s*6\)\s*=\s*'prodx_'\s*AND\s*NOT\s*c\.relrowsecurity/i);
  assert.match(workflow, /rel\.oid\s*=\s*t\.tgrelid/i);
  assert.match(workflow, /rel\.relname\s*=\s*expected\.relname/i);
  assert.match(workflow, /version = '0065_payment_webhook_inbox_and_discount_force_rls'/);
  assert.match(workflow, /'prodx_payment_webhook_events_no_delete_guard','prodx_payment_webhook_events'/);
  assert.match(workflow, /"rlsExpectedCoreTableCount":\s*\$\{rls_expected_count\}/);
  assert.match(workflow, /"unprotectedProdxTableCount":\s*0/);
  assert.match(workflow, /"forceRlsExpectedTableCount":\s*\$\{force_rls_expected_count\}/);
  assert.match(workflow, /"immutableTriggerExpectedCount":\s*\$\{immutable_trigger_expected_count\}/);
});

test('postgres-recovery-drill.yml deletes raw database dump in always() cleanup and uploads only sanitized JSON report', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  assert.match(
    workflow,
    /- name: Delete local database dump artifact[\s\S]*?if:\s*always\(\)[\s\S]*?rm -f artifacts\/prodx-production\.dump/,
  );

  const uploadSplit = workflow.split('uses: actions/upload-artifact');
  assert.equal(uploadSplit.length, 2, 'Expected exactly one actions/upload-artifact step');
  assert.match(uploadSplit[1], /path:\s*artifacts\/recovery-drill-report\.json/);
  assert.doesNotMatch(uploadSplit[1], /prodx-production\.dump/);
});

test('verify-postgres-backup-restore.sh and runbook cover all 36 migration-backed RLS tables, 1 FORCE RLS table, and 4 append-only triggers', () => {
  const script = readFileSync(scriptPath, 'utf8');
  const runbook = readFileSync(runbookPath, 'utf8');

  for (const tableName of EXPECTED_36_TENANT_SENSITIVE_RLS_TABLES) {
    assert.ok(
      script.includes(`'${tableName}'`),
      `Expected scripts/verify-postgres-backup-restore.sh to verify RLS on ${tableName}`,
    );
  }

  for (const forceRlsTable of EXPECTED_1_FORCE_RLS_TABLES) {
    assert.ok(
      script.includes(forceRlsTable) && runbook.includes(forceRlsTable),
      `Expected script and runbook to reference FORCE RLS table ${forceRlsTable}`,
    );
  }

  for (const triggerName of EXPECTED_4_IMMUTABLE_TRIGGERS) {
    assert.ok(
      script.includes(triggerName) && runbook.includes(triggerName),
      `Expected script and runbook to reference immutable trigger ${triggerName}`,
    );
  }
});

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPgIntegration = process.env.PRODX_DR_TEST_PG17 === '1';
if (shouldRunPgIntegration) {
  assertDisposableTestDatabaseUrl(databaseUrl, 'PostgreSQL 17 backup/restore integration test');
}

function replaceDatabaseName(connectionString: string, dbName: string): string {
  const parsed = new URL(connectionString);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

function detectDockerContainerForDatabase(connectionString: string): string | undefined {
  if (process.env.PG_DOCKER_CONTAINER) {
    return process.env.PG_DOCKER_CONTAINER;
  }
  try {
    const parsed = new URL(connectionString);
    const hostPort = parsed.port || '5432';
    const output = execFileSync('docker', ['ps', '--format', '{{.Names}}\t{{.Ports}}'], {
      encoding: 'utf8',
    });
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [name, ports = ''] = trimmed.split('\t');
      if (ports.includes(`:${hostPort}->5432/tcp`)) {
        return name;
      }
    }
  } catch {
    // Docker not available or not running; fall back to host postgresql-client binaries.
  }
  return undefined;
}

test('dedicated PostgreSQL 17 workflow runs the guarded recovery drill on a PG17 service', () => {
  const workflow = readFileSync(join(process.cwd(), '.github/workflows/postgres-recovery-drill-pg17.yml'), 'utf8');
  assert.match(workflow, /image:\s*postgres:17/);
  assert.match(workflow, /uses: actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /uses: actions\/setup-node@[0-9a-f]{40}/);
  assert.doesNotMatch(workflow, /uses: actions\/(?:checkout|setup-node)@v[0-9]+/);
  assert.match(workflow, /PRODX_DR_TEST_PG17:\s*["']1["']/);
  assert.match(workflow, /DATABASE_URL:.*prodx_drill_test/);
  assert.match(workflow, /POSTGRES_HOST_AUTH_METHOD:\s*trust/);
  assert.doesNotMatch(workflow, /POSTGRES_PASSWORD/);
  assert.match(workflow, /node --import tsx --test --test-concurrency=1 server\/db\/postgres-recovery-drill\.test\.ts/);
});

test('PostgreSQL recovery integration is opt-in, rejects non-disposable DATABASE_URLs, and pins server version 17', () => {
  const source = readFileSync(join(process.cwd(), 'server/db/postgres-recovery-drill.test.ts'), 'utf8');
  assert.match(source, /PRODX_DR_TEST_PG17 === '1'/);
  assert.match(source, /assertDisposableTestDatabaseUrl\(databaseUrl/);
  assert.match(source, /SHOW server_version_num/);
  assert.match(source, /execFileSync\(process\.execPath, \[\s*'--import', 'tsx', 'scripts\/migrate\.ts'/);
  assert.match(source, /assert\.equal\(serverMajor, 17/);
  assert.doesNotMatch(source, /CREATE TABLE IF NOT EXISTS public\.prodx_payment_webhook_events/);
});

test(
  'PostgreSQL backup/restore drill verifies all 36 RLS tables, the baseline FORCE RLS table, and produces a sanitized report with zero dump contents or PII',
  { skip: !shouldRunPgIntegration, timeout: 120_000 },
  async () => {
    const baseDatabaseUrl = databaseUrl!;
    const suffix = `${process.pid}_${Date.now()}`;
    const sourceDbName = `prodx_dr_src_${suffix}`;
    const targetDbName = `prodx_dr_tgt_${suffix}`;
    const sourceUrl = replaceDatabaseName(baseDatabaseUrl, sourceDbName);
    const targetUrl = replaceDatabaseName(baseDatabaseUrl, targetDbName);

    const scratchBase =
      process.env.TMPDIR && existsSync(process.env.TMPDIR) ? process.env.TMPDIR : '/var/tmp';
    const tempDir = mkdtempSync(join(scratchBase, 'prodx-dr-test-'));
    const reportPath = join(tempDir, 'recovery-drill-report.json');

    const adminPool = new Pool({ connectionString: baseDatabaseUrl, max: 1 });
    try {
      const version = await adminPool.query<{ server_version_num: string }>('SHOW server_version_num');
      const serverMajor = Math.floor(Number(version.rows[0]?.server_version_num) / 10000);
      assert.equal(serverMajor, 17, 'PostgreSQL recovery/restore integration must run against PostgreSQL 17');
      await adminPool.query(`CREATE DATABASE "${sourceDbName}"`);
      await adminPool.query(`CREATE DATABASE "${targetDbName}"`);

      // Apply repository migrations to sourceDbName
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: sourceUrl },
        stdio: 'pipe',
      });

      const sourcePool = new Pool({ connectionString: sourceUrl, max: 1 });
      let has0062 = false;
      try {
        const migrationResult = await sourcePool.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM public.prodx_schema_migrations
           WHERE version = '0065_payment_webhook_inbox_and_discount_force_rls'`,
        );
        has0062 = Number(migrationResult.rows[0]?.count ?? 0) === 1;
        // Seed synthetic PII, secrets, financial transactions, inventory ledger, and supervisor authorization rows
        const orgId = '11111111-1111-4111-8111-111111111111';
        const storeId = '22222222-2222-4222-8222-222222222222';
        const userId = '33333333-3333-4333-8333-333333333333';
        const deviceId = '77777777-7777-4777-8777-777777777777';
        const sessionId = '88888888-8888-4888-8888-888888888888';
        const categoryId = '99999999-9999-4999-8999-999999999999';
        const productId = '44444444-4444-4444-8444-444444444444';
        const registerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        const shiftId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        const orderId = '55555555-5555-4555-8555-555555555555';
        const orderItemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        const paymentId = '66666666-6666-4666-8666-666666666666';
        const initialRefId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

        await sourcePool.query(
          `INSERT INTO public.prodx_organizations (id, code, name)
           VALUES ($1, 'DR-TEST-ORG', 'DR Test Organization')`,
          [orgId],
        );
        await sourcePool.query(
          `INSERT INTO public.prodx_stores (id, organization_id, code, name, business_timezone, currency, active)
           VALUES ($1, $2, 'DR-01', 'DR Test Store', 'Asia/Bangkok', 'THB', true)`,
          [storeId, orgId],
        );
        await sourcePool.query(
          `INSERT INTO public.prodx_users (id, organization_id, username, display_name, status)
           VALUES ($1, $2, 'pii-customer-secret@example.com', 'Somchai SecretPII', 'active')`,
          [userId, orgId],
        );
        await sourcePool.query(
          `INSERT INTO public.prodx_user_credentials (user_id, credential_type, secret_hash)
           VALUES ($1, 'password', '$2b$12$secretHashValueDoNotLeak9999999999999999999999')`,
          [userId],
        );
        await sourcePool.query(
          `INSERT INTO public.prodx_store_memberships (organization_id, store_id, user_id, active)
           VALUES ($1, $2, $3, true)`,
          [orgId, storeId, userId],
        );
        await sourcePool.query(
          `INSERT INTO public.prodx_devices (id, organization_id, store_id, device_key, name, status)
           VALUES ($1, $2, $3, 'DEV-DR-01', 'DR POS Terminal 1', 'active')`,
          [deviceId, orgId, storeId],
        );
        await sourcePool.query(
          `INSERT INTO public.prodx_sessions (id, organization_id, user_id, device_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4, 'tok_secret_session_hash_999', CURRENT_TIMESTAMP + INTERVAL '1 hour')`,
          [sessionId, orgId, userId, deviceId],
        );
        await sourcePool.query(
          `INSERT INTO public.prodx_categories (id, organization_id, store_id, name, slug)
           VALUES ($1, $2, $3, 'DR Beverages', 'dr-beverages')`,
          [categoryId, orgId, storeId],
        );
        await sourcePool.query(
          `INSERT INTO public.prodx_products (
             id, organization_id, store_id, category_id, sku, barcode, name,
             price_amount, cost_price_amount, currency, tax_rate_bps, current_stock, reorder_point, unit_of_measure, active
           )
           VALUES ($1, $2, $3, $4, 'SKU-DR-1', '8850000999991', 'DR Verifiable Product', 625.00, 300.00, 'THB', 0, 23, 5, 'unit', true)`,
          [productId, orgId, storeId, categoryId],
        );
        await sourcePool.query(
          `INSERT INTO public.prodx_registers (id, organization_id, store_id, code, name, status)
           VALUES ($1, $2, $3, 'REG-DR-1', 'DR Main Register', 'active')`,
          [registerId, orgId, storeId],
        );
        await sourcePool.query(
          `INSERT INTO public.prodx_shifts (id, organization_id, store_id, register_id, cashier_id, status, opening_float_amount, currency)
           VALUES ($1, $2, $3, $4, $5, 'open', 1000.00, 'THB')`,
          [shiftId, orgId, storeId, registerId, userId],
        );
        await sourcePool.query(
          `INSERT INTO public.prodx_inventory_ledger (
             id, organization_id, store_id, product_id, quantity_delta, resulting_stock, reason, reference_id, performed_by_user_id
           )
           VALUES
             (gen_random_uuid(), $1, $2, $3, 25, 25, 'purchase_received', $4, $5),
             (gen_random_uuid(), $1, $2, $3, -2, 23, 'sale_deduction', $6, $5)`,
          [orgId, storeId, productId, initialRefId, userId, orderId],
        );
        await sourcePool.query('BEGIN');
        try {
          await sourcePool.query(
            `INSERT INTO public.prodx_orders (
               id, organization_id, store_id, register_id, cashier_id, shift_id,
               order_number, idempotency_key, status,
               gross_subtotal_amount, item_discounts_amount, order_discount_amount,
               net_subtotal_amount, total_tax_amount, grand_total_amount,
               currency, total_items_count
             )
             VALUES (
               $1, $2, $3, $4, $5, $6,
               'ORD-DR-001', 'idem-dr-order-1', 'server_confirmed',
               1250.00, 0.00, 0.00,
               1250.00, 0.00, 1250.00,
               'THB', 2
             )`,
            [orderId, orgId, storeId, registerId, userId, shiftId],
          );
          await sourcePool.query(
            `INSERT INTO public.prodx_order_items (
               id, organization_id, store_id, order_id, product_id,
               quantity, unit_price_amount, item_discount_bps,
               line_subtotal_amount, line_tax_amount, line_total_amount, currency
             )
             VALUES ($1, $2, $3, $4, $5, 2, 625.00, 0, 1250.00, 0.00, 1250.00, 'THB')`,
            [orderItemId, orgId, storeId, orderId, productId],
          );
          await sourcePool.query(
            `INSERT INTO public.prodx_payments (
               id, organization_id, store_id, order_id, method, amount, currency,
               status, provider, provider_reference, captured_at
             )
             VALUES ($1, $2, $3, $4, 'qr_digital', 1250.00, 'THB', 'captured', 'stripe', 'pi_secret_provider_ref_123', CURRENT_TIMESTAMP)`,
            [paymentId, orgId, storeId, orderId],
          );
          await sourcePool.query('COMMIT');
        } catch (err) {
          await sourcePool.query('ROLLBACK');
          throw err;
        }
        if (has0062) {
          await sourcePool.query(
            `INSERT INTO public.prodx_payment_webhook_events (
               provider, provider_event_id, event_type, payload_sha256,
               organization_id, store_id, payment_id, provider_reference, status
             )
             VALUES (
               'stripe', 'evt_secret_webhook_777', 'payment_intent.succeeded',
               'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
               $1, $2, $3, 'pi_secret_provider_ref_123', 'processed'
             )`,
            [orgId, storeId, paymentId],
          );
        }
        await sourcePool.query(
          `INSERT INTO public.prodx_discount_policies (
             organization_id, store_id, require_supervisor_approval, max_discount_without_approval_bps, updated_by_user_id
           )
           VALUES ($1, $2, true, 1000, $3)
           ON CONFLICT (organization_id, store_id) DO UPDATE
           SET require_supervisor_approval = EXCLUDED.require_supervisor_approval,
               max_discount_without_approval_bps = EXCLUDED.max_discount_without_approval_bps,
               updated_by_user_id = EXCLUDED.updated_by_user_id`,
          [orgId, storeId, userId],
        );
        await sourcePool.query(
          `INSERT INTO public.prodx_supervisor_authorizations (
             id, organization_id, store_id, requester_user_id, requester_session_id, supervisor_user_id,
             action_key, order_id, authorization_hash, expires_at
           )
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $3, 'refund', $5, 'grant_secret_hash_888', CURRENT_TIMESTAMP + INTERVAL '10 minutes')`,
          [orgId, storeId, userId, sessionId, orderId],
        );
        await sourcePool.query(
          `INSERT INTO public.prodx_security_audit_events (id, organization_id, user_id, event_type, metadata)
           VALUES (gen_random_uuid(), $1, $2, 'dr_pii_probe', '{"phone":"+66819998877","token":"tok_secret_session_hash_999"}'::jsonb)`,
          [orgId, userId],
        );
        await sourcePool.query(
          `INSERT INTO public.prodx_audit_log (id, organization_id, store_id, register_id, user_id, action, severity, details)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'order_completed', 'info', '{"customerPhone":"+66819998877"}'::jsonb)`,
          [orgId, storeId, registerId, userId],
        );
      } finally {
        await sourcePool.end();
      }

      const dockerContainer = detectDockerContainerForDatabase(baseDatabaseUrl);
      const args = [
        scriptPath,
        '--source',
        sourceUrl,
        '--target',
        targetUrl,
        '--report',
        reportPath,
      ];
      if (dockerContainer) {
        args.push('--docker-container', dockerContainer);
      }

      execFileSync('bash', args, {
        cwd: process.cwd(),
        env: { ...process.env, TMPDIR: tempDir },
        stdio: 'pipe',
      });

      assert.ok(existsSync(reportPath), 'Expected sanitized recovery-drill-report.json to be written');
      const rawReport = readFileSync(reportPath, 'utf8');
      const report = JSON.parse(rawReport) as {
        status: string;
        verifiedAt: string;
        mode: string;
        dump: { durationMs: number; bytes: number };
        restore: { durationMs: number };
        verification: {
          unprotectedProdxTableCount: number;
          rlsEnabledCoreTableCount: number;
          rlsExpectedCoreTableCount: number;
          rlsVerifiedTables: string[];
          forceRlsEnabledTableCount: number;
          forceRlsExpectedTableCount: number;
          forceRlsVerifiedTables: string[];
          immutableTriggerCount: number;
          immutableTriggerExpectedCount: number;
          rowCounts: Record<string, number>;
          reconciliation: {
            inventoryLedgerDeltaSum: number;
            inventoryLedgerMismatchCount: number;
            ordersGrandTotalAmount: string;
            paymentsAmountSum: string;
          };
        };
      };

      assert.deepEqual(
        Object.keys(report).sort(),
        ['dump', 'mode', 'restore', 'status', 'verification', 'verifiedAt'],
        'Report must contain only allowlisted top-level metadata keys',
      );
      assert.equal(report.status, 'PASS');
      assert.ok(report.dump.bytes > 0);
      assert.equal(report.verification.unprotectedProdxTableCount, 0);
      const expectedRlsTables = has0062
        ? EXPECTED_37_TENANT_SENSITIVE_RLS_TABLES
        : EXPECTED_36_TENANT_SENSITIVE_RLS_TABLES;
      const expectedForceRlsTables = has0062 ? EXPECTED_2_FORCE_RLS_TABLES : EXPECTED_1_FORCE_RLS_TABLES;
      const expectedImmutableTriggers = has0062 ? EXPECTED_5_IMMUTABLE_TRIGGERS : EXPECTED_4_IMMUTABLE_TRIGGERS;
      assert.equal(report.verification.rlsEnabledCoreTableCount, expectedRlsTables.length);
      assert.equal(report.verification.rlsExpectedCoreTableCount, expectedRlsTables.length);
      assert.deepEqual(report.verification.rlsVerifiedTables, [...expectedRlsTables]);
      assert.equal(report.verification.forceRlsEnabledTableCount, expectedForceRlsTables.length);
      assert.equal(report.verification.forceRlsExpectedTableCount, expectedForceRlsTables.length);
      assert.deepEqual(report.verification.forceRlsVerifiedTables, [...expectedForceRlsTables]);
      assert.equal(report.verification.immutableTriggerCount, expectedImmutableTriggers.length);
      assert.equal(report.verification.immutableTriggerExpectedCount, expectedImmutableTriggers.length);
      assert.equal(report.verification.rowCounts.prodx_supervisor_authorizations, 1);
      assert.equal(report.verification.rowCounts.prodx_discount_policies, 1);
      if (has0062) assert.equal(report.verification.rowCounts.prodx_payment_webhook_events, 1);
      assert.equal(report.verification.reconciliation.inventoryLedgerDeltaSum, 23);
      assert.equal(report.verification.reconciliation.inventoryLedgerMismatchCount, 0);
      assert.equal(report.verification.reconciliation.ordersGrandTotalAmount, '1250.00');
      assert.equal(report.verification.reconciliation.paymentsAmountSum, '1250.00');

      // Sanitized artifact assertions: zero dump contents, SQL statements, credentials, or seeded PII/secrets
      const forbiddenTokens = [
        'PostgreSQL database dump',
        'COPY public.',
        'INSERT INTO',
        'CREATE TABLE',
        'ALTER TABLE',
        'postgresql://',
        'postgres://',
        'pii-customer-secret@example.com',
        'Somchai SecretPII',
        '+66819998877',
        '$2b$12$secretHashValueDoNotLeak',
        'tok_secret_session_hash_999',
        'grant_secret_hash_888',
        'pi_secret_provider_ref_123',
      ];
      for (const token of forbiddenTokens) {
        assert.equal(
          rawReport.includes(token),
          false,
          `Sanitized DR report must never leak dump content or PII token: ${token}`,
        );
      }

      // Negative regression check: if FORCE RLS is removed from prodx_discount_policies, the drill must fail
      const tamperPool = new Pool({ connectionString: sourceUrl, max: 1 });
      try {
        await tamperPool.query(
          'ALTER TABLE public.prodx_discount_policies NO FORCE ROW LEVEL SECURITY',
        );
      } finally {
        await tamperPool.end();
      }

      assert.throws(
        () => {
          execFileSync('bash', args, {
            cwd: process.cwd(),
            env: { ...process.env, TMPDIR: tempDir },
            stdio: 'pipe',
          });
        },
        new RegExp(`Expected ${expectedForceRlsTables.length} ${expectedForceRlsTables.length === 1 ? 'table' : 'tables'} with FORCE ROW LEVEL SECURITY enabled after restore`),
        'Drill script must fail if FORCE ROW LEVEL SECURITY is missing on prodx_discount_policies',
      );
    } finally {
      await adminPool
        .query(`DROP DATABASE IF EXISTS "${sourceDbName}" WITH (FORCE)`)
        .catch(() => {});
      await adminPool
        .query(`DROP DATABASE IF EXISTS "${targetDbName}" WITH (FORCE)`)
        .catch(() => {});
      await adminPool.end();
      rmSync(tempDir, { recursive: true, force: true });
    }
  },
);
