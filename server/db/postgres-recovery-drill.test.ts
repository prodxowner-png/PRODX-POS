import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { Pool } from 'pg';

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

const EXPECTED_3_FORCE_RLS_TABLES = [
  'prodx_discount_policies',
  'prodx_payment_webhook_events',
  'prodx_supervisor_authorizations',
] as const;

const EXPECTED_5_IMMUTABLE_TRIGGERS = [
  'prodx_audit_log_immutable_guard',
  'prodx_payment_webhook_events_no_delete_guard',
  'prodx_refund_immutable_guard',
  'prodx_security_audit_events_immutable_guard',
  'prodx_void_immutable_guard',
] as const;

const workflowPath = join(process.cwd(), '.github/workflows/postgres-recovery-drill.yml');
const scriptPath = join(process.cwd(), 'scripts/verify-postgres-backup-restore.sh');
const runbookPath = join(process.cwd(), 'docs/operations/postgres-backup-recovery.md');

test('postgres-recovery-drill.yml verifies RLS across all 37 tenant-sensitive tables, FORCE RLS across all 3 required tables, and all 5 immutable triggers', () => {
  const workflow = readFileSync(workflowPath, 'utf8');

  assert.equal(EXPECTED_37_TENANT_SENSITIVE_RLS_TABLES.length, 37);
  for (const tableName of EXPECTED_37_TENANT_SENSITIVE_RLS_TABLES) {
    const escaped = tableName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = workflow.match(new RegExp(`'${escaped}'`, 'g')) ?? [];
    assert.ok(
      occurrences.length >= 2,
      `Expected ${tableName} in both scalar rls_enabled_count and DO-block missing_rls_count in postgres-recovery-drill.yml (found ${occurrences.length})`,
    );
  }

  for (const forceRlsTable of EXPECTED_3_FORCE_RLS_TABLES) {
    const escaped = forceRlsTable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = workflow.match(new RegExp(`'${escaped}'`, 'g')) ?? [];
    assert.ok(
      occurrences.length >= 4,
      `Expected ${forceRlsTable} in RLS and FORCE RLS checks in postgres-recovery-drill.yml (found ${occurrences.length})`,
    );
  }

  for (const triggerName of EXPECTED_5_IMMUTABLE_TRIGGERS) {
    const escaped = triggerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = workflow.match(new RegExp(`'${escaped}'`, 'g')) ?? [];
    assert.ok(
      occurrences.length >= 2,
      `Expected ${triggerName} in scalar immutable_trigger_count and DO-block missing_trigger_count in postgres-recovery-drill.yml`,
    );
  }

  assert.match(workflow, /left\(c\.relname,\s*6\)\s*=\s*'prodx_'\s*AND\s*NOT\s*c\.relrowsecurity/i);
  assert.match(workflow, /"rlsExpectedCoreTableCount":\s*37/);
  assert.match(workflow, /"unprotectedProdxTableCount":\s*0/);
  assert.match(workflow, /"forceRlsExpectedTableCount":\s*3/);
  assert.match(workflow, /"immutableTriggerExpectedCount":\s*5/);
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

test('verify-postgres-backup-restore.sh and runbook cover all 37 RLS tables, 3 FORCE RLS tables, and 5 append-only triggers', () => {
  const script = readFileSync(scriptPath, 'utf8');
  const runbook = readFileSync(runbookPath, 'utf8');

  for (const tableName of EXPECTED_37_TENANT_SENSITIVE_RLS_TABLES) {
    assert.ok(
      script.includes(`'${tableName}'`),
      `Expected scripts/verify-postgres-backup-restore.sh to verify RLS on ${tableName}`,
    );
  }

  for (const forceRlsTable of EXPECTED_3_FORCE_RLS_TABLES) {
    assert.ok(
      script.includes(forceRlsTable) && runbook.includes(forceRlsTable),
      `Expected script and runbook to reference FORCE RLS table ${forceRlsTable}`,
    );
  }

  for (const triggerName of EXPECTED_5_IMMUTABLE_TRIGGERS) {
    assert.ok(
      script.includes(triggerName) && runbook.includes(triggerName),
      `Expected script and runbook to reference immutable trigger ${triggerName}`,
    );
  }
});

const databaseUrl = process.env.DATABASE_URL;
const shouldRunPgIntegration = Boolean(databaseUrl) && process.env.NODE_ENV !== 'production';

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
    execFileSync('which', ['pg_dump'], { stdio: 'ignore' });
    execFileSync('which', ['pg_restore'], { stdio: 'ignore' });
    execFileSync('which', ['psql'], { stdio: 'ignore' });
    return undefined;
  } catch {
    // Host postgresql-client not installed; auto-detect Docker container publishing the database port.
  }
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
  return undefined;
}

test(
  'PostgreSQL backup/restore drill verifies all 37 RLS tables, all 3 FORCE RLS tables, and produces a sanitized report with zero dump contents or PII',
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
      await adminPool.query(`CREATE DATABASE "${sourceDbName}"`);
      await adminPool.query(`CREATE DATABASE "${targetDbName}"`);

      // Apply repository migrations to sourceDbName
      execFileSync('npx', ['tsx', 'scripts/migrate.ts'], {
        cwd: process.cwd(),
        env: { ...process.env, DATABASE_URL: sourceUrl },
        stdio: 'pipe',
      });

      const sourcePool = new Pool({ connectionString: sourceUrl, max: 1 });
      try {
        // Ensure 0062 payment webhook inbox table, append-only delete guard, and FORCE RLS on
        // prodx_payment_webhook_events & prodx_supervisor_authorizations are present in the drill source DB.
        await sourcePool.query(`
          CREATE TABLE IF NOT EXISTS public.prodx_payment_webhook_events (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            provider TEXT NOT NULL,
            provider_event_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_sha256 TEXT NOT NULL,
            organization_id UUID REFERENCES public.prodx_organizations(id) ON DELETE RESTRICT,
            store_id UUID,
            payment_id UUID,
            provider_reference TEXT,
            status TEXT NOT NULL DEFAULT 'received',
            failure_reason TEXT,
            received_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            processed_at TIMESTAMPTZ,
            CONSTRAINT prodx_payment_webhook_events_provider_event_unique UNIQUE (provider, provider_event_id)
          );

          CREATE OR REPLACE FUNCTION public.prodx_payment_webhook_events_no_delete()
          RETURNS trigger
          LANGUAGE plpgsql
          AS $trigger$
          BEGIN
            RAISE EXCEPTION 'prodx_payment_webhook_events is append-only; DELETE is not permitted'
              USING ERRCODE = '42501';
          END;
          $trigger$;

          DROP TRIGGER IF EXISTS prodx_payment_webhook_events_no_delete_guard ON public.prodx_payment_webhook_events;
          CREATE TRIGGER prodx_payment_webhook_events_no_delete_guard
            BEFORE DELETE ON public.prodx_payment_webhook_events
            FOR EACH ROW
            EXECUTE FUNCTION public.prodx_payment_webhook_events_no_delete();

          ALTER TABLE public.prodx_payment_webhook_events ENABLE ROW LEVEL SECURITY;
          ALTER TABLE public.prodx_payment_webhook_events FORCE ROW LEVEL SECURITY;
          DROP POLICY IF EXISTS prodx_app_tenant_isolation ON public.prodx_payment_webhook_events;
          CREATE POLICY prodx_app_tenant_isolation ON public.prodx_payment_webhook_events
            FOR ALL TO prodx_app
            USING (
              organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
              AND store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
            )
            WITH CHECK (
              organization_id = NULLIF(current_setting('app.organization_id', true), '')::uuid
              AND store_id = NULLIF(current_setting('app.store_id', true), '')::uuid
            );

          ALTER TABLE public.prodx_supervisor_authorizations ENABLE ROW LEVEL SECURITY;
          ALTER TABLE public.prodx_supervisor_authorizations FORCE ROW LEVEL SECURITY;

          INSERT INTO public.prodx_schema_migrations(version)
          VALUES ('0062_payment_webhook_inbox_and_discount_force_rls')
          ON CONFLICT (version) DO NOTHING;
        `);

        // Seed synthetic PII, secrets, financial transactions, inventory ledger, supervisor auth, and webhook inbox rows
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
        '--require-all-force-rls',
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
      assert.equal(report.verification.rlsEnabledCoreTableCount, 37);
      assert.equal(report.verification.rlsExpectedCoreTableCount, 37);
      assert.deepEqual(
        report.verification.rlsVerifiedTables,
        [...EXPECTED_37_TENANT_SENSITIVE_RLS_TABLES],
      );
      assert.equal(report.verification.forceRlsEnabledTableCount, 3);
      assert.equal(report.verification.forceRlsExpectedTableCount, 3);
      assert.deepEqual(
        report.verification.forceRlsVerifiedTables,
        [...EXPECTED_3_FORCE_RLS_TABLES],
      );
      assert.equal(report.verification.immutableTriggerCount, 5);
      assert.equal(report.verification.immutableTriggerExpectedCount, 5);
      assert.equal(report.verification.rowCounts.prodx_supervisor_authorizations, 1);
      assert.equal(report.verification.rowCounts.prodx_payment_webhook_events, 1);
      assert.equal(report.verification.rowCounts.prodx_discount_policies, 1);
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
        'evt_secret_webhook_777',
        'pi_secret_provider_ref_123',
      ];
      for (const token of forbiddenTokens) {
        assert.equal(
          rawReport.includes(token),
          false,
          `Sanitized DR report must never leak dump content or PII token: ${token}`,
        );
      }

      // Negative regression check: if FORCE RLS is removed from prodx_supervisor_authorizations, the drill must fail
      const tamperPool = new Pool({ connectionString: sourceUrl, max: 1 });
      try {
        await tamperPool.query(
          'ALTER TABLE public.prodx_supervisor_authorizations NO FORCE ROW LEVEL SECURITY',
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
        /Expected 3 tables with FORCE ROW LEVEL SECURITY enabled after restore/,
        'Drill script must fail if FORCE ROW LEVEL SECURITY is missing on prodx_supervisor_authorizations',
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
