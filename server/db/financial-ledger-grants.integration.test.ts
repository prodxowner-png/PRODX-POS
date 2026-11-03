import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
const shouldRun = Boolean(databaseUrl) && process.env.NODE_ENV !== 'production';

test('runtime role preserves append-only financial ledger grants', { skip: !shouldRun }, async () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query<{
      cash_select: boolean; cash_insert: boolean; cash_update: boolean; cash_delete: boolean;
      payments_select: boolean; payments_insert: boolean; payments_update: boolean; payments_delete: boolean;
      inventory_select: boolean; inventory_insert: boolean; inventory_update: boolean; inventory_delete: boolean;
      audit_select: boolean; audit_insert: boolean; audit_update: boolean; audit_delete: boolean;
    }>(`
      SELECT
        has_table_privilege('prodx_app', 'public.prodx_cash_movements', 'SELECT') AS cash_select,
        has_table_privilege('prodx_app', 'public.prodx_cash_movements', 'INSERT') AS cash_insert,
        has_table_privilege('prodx_app', 'public.prodx_cash_movements', 'UPDATE') AS cash_update,
        has_table_privilege('prodx_app', 'public.prodx_cash_movements', 'DELETE') AS cash_delete,
        has_table_privilege('prodx_app', 'public.prodx_payments', 'SELECT') AS payments_select,
        has_table_privilege('prodx_app', 'public.prodx_payments', 'INSERT') AS payments_insert,
        has_table_privilege('prodx_app', 'public.prodx_payments', 'UPDATE') AS payments_update,
        has_table_privilege('prodx_app', 'public.prodx_payments', 'DELETE') AS payments_delete,
        has_table_privilege('prodx_app', 'public.prodx_inventory_ledger', 'SELECT') AS inventory_select,
        has_table_privilege('prodx_app', 'public.prodx_inventory_ledger', 'INSERT') AS inventory_insert,
        has_table_privilege('prodx_app', 'public.prodx_inventory_ledger', 'UPDATE') AS inventory_update,
        has_table_privilege('prodx_app', 'public.prodx_inventory_ledger', 'DELETE') AS inventory_delete,
        has_table_privilege('prodx_app', 'public.prodx_audit_log', 'SELECT') AS audit_select,
        has_table_privilege('prodx_app', 'public.prodx_audit_log', 'INSERT') AS audit_insert,
        has_table_privilege('prodx_app', 'public.prodx_audit_log', 'UPDATE') AS audit_update,
        has_table_privilege('prodx_app', 'public.prodx_audit_log', 'DELETE') AS audit_delete
    `);
    assert.deepEqual(result.rows[0], {
      cash_select: true, cash_insert: true, cash_update: false, cash_delete: false,
      payments_select: true, payments_insert: true, payments_update: true, payments_delete: false,
      inventory_select: true, inventory_insert: true, inventory_update: false, inventory_delete: false,
      audit_select: true, audit_insert: true, audit_update: false, audit_delete: false,
    });
  } finally {
    await pool.end();
  }
});
