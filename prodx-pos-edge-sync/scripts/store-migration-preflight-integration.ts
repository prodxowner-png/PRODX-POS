import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { assertDisposableCiDatabaseUrl } from "./test-database-guard.js";

const adminUrl = assertDisposableCiDatabaseUrl(
  process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
  "store-migration-preflight-integration.ts",
);
const databaseName = `prodx_pos_store_migration_preflight_${randomUUID().replace(/-/g, "")}_ci`;
const targetUrl = new URL(adminUrl);
targetUrl.pathname = `/${databaseName}`;
const admin = new Client({ connectionString: adminUrl });
let databaseCreated = false;
let database: Client | null = null;

try {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  database = new Client({ connectionString: targetUrl.toString() });
  await database.connect();

  const baseMigration = await readFile(new URL("../migrations/001_pos_ledger.sql", import.meta.url), "utf8");
  const storeMigration = await readFile(new URL("../migrations/002_store_scoped_inventory.sql", import.meta.url), "utf8");
  await database.query(baseMigration);

  const tenantId = randomUUID();
  const productId = randomUUID();
  await database.query(
    `INSERT INTO products(id,tenant_id,sku,name,unit_price_minor,tax_bps)
     VALUES($1,$2,$3,'Legacy inventory preflight fixture',100,0)`,
    [productId, tenantId, `PREFLIGHT-${productId.slice(0, 8)}`],
  );
  await database.query(
    `INSERT INTO inventory_balances(tenant_id,product_id,quantity) VALUES($1,$2,4)`,
    [tenantId, productId],
  );

  let expectedFailure = false;
  try {
    await database.query(storeMigration);
  } catch (error) {
    expectedFailure = error instanceof Error && error.message.includes("STORE_MIGRATION_BLOCKED: legacy_store_mapping_required");
    if (!expectedFailure) throw error;
  }
  if (!expectedFailure) throw new Error("STORE_MIGRATION_ACCEPTED_UNMAPPED_LEGACY_INVENTORY");
  await database.query("ROLLBACK");

  const rollbackState = await database.query<{ stores_table: boolean; balance_store_column_count: number }>(
    `SELECT to_regclass('public.pos_stores') IS NOT NULL AS stores_table,
            (SELECT COUNT(*)::int FROM information_schema.columns
              WHERE table_schema='public' AND table_name='inventory_balances' AND column_name='store_id') AS balance_store_column_count`,
  );
  if (rollbackState.rows[0]?.stores_table || rollbackState.rows[0]?.balance_store_column_count !== 0) {
    throw new Error("STORE_MIGRATION_PREFLIGHT_DID_NOT_ROLL_BACK_ALL_DDL");
  }

  // Stage an explicit, trusted two-Store mapping from an external source of truth.
  // The old schema could hold only one balance per tenant/product, so split that
  // aggregate into Store rows only after the mapping has been supplied.
  const storeA = randomUUID();
  const storeB = randomUUID();
  await database.query(`
    CREATE TABLE pos_stores (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      name text NOT NULL,
      is_default boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id,id),
      UNIQUE (tenant_id,name)
    );
    ALTER TABLE terminal_devices ADD COLUMN store_id uuid;
    ALTER TABLE terminal_sync_state ADD COLUMN store_id uuid;
    ALTER TABLE sales ADD COLUMN store_id uuid;
    ALTER TABLE sale_lines ADD COLUMN store_id uuid;
    ALTER TABLE inventory_ledger ADD COLUMN store_id uuid;
    ALTER TABLE inventory_balances ADD COLUMN store_id uuid;
  `);
  await database.query(
    `INSERT INTO pos_stores(id,tenant_id,name,is_default)
     VALUES($1,$3,'Mapped Store A',true),($2,$3,'Mapped Store B',false)`,
    [storeA, storeB, tenantId],
  );
  await database.query(
    `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,$4,3,'OPENING_BALANCE'),($1,$5,$3,$6,2,'OPENING_BALANCE')`,
    [tenantId, storeA, productId, randomUUID(), storeB, randomUUID()],
  );
  await database.query(
    `INSERT INTO inventory_balances(tenant_id,product_id,quantity)
     VALUES($1,$2,5)
     ON CONFLICT (tenant_id,product_id) DO UPDATE SET quantity=EXCLUDED.quantity`,
    [tenantId, productId],
  );
  await database.query(
    `UPDATE inventory_balances SET store_id=$3,quantity=3 WHERE tenant_id=$1 AND product_id=$2`,
    [tenantId, productId, storeA],
  );
  await database.query("ALTER TABLE inventory_balances DROP CONSTRAINT inventory_balances_pkey");
  await database.query("ALTER TABLE inventory_balances ADD PRIMARY KEY (tenant_id,store_id,product_id)");
  await database.query(
    `INSERT INTO inventory_balances(tenant_id,store_id,product_id,quantity) VALUES($1,$2,$3,2)`,
    [tenantId, storeB, productId],
  );

  const cleanTenantId = randomUUID();
  const cleanProductId = randomUUID();
  await database.query(
    `INSERT INTO products(id,tenant_id,sku,name,unit_price_minor,tax_bps)
     VALUES($1,$2,$3,'Clean tenant Store bootstrap fixture',100,0)`,
    [cleanProductId, cleanTenantId, `CLEAN-${cleanProductId.slice(0, 8)}`],
  );

  await database.query(storeMigration);
  const mappedBalances = await database.query<{ name: string; quantity: number }>(
    `SELECT s.name,b.quantity::int AS quantity
       FROM inventory_balances b JOIN pos_stores s
         ON s.tenant_id=b.tenant_id AND s.id=b.store_id
      WHERE b.tenant_id=$1 AND b.product_id=$2
      ORDER BY s.name`,
    [tenantId, productId],
  );
  if (mappedBalances.rowCount !== 2 || mappedBalances.rows[0]?.quantity !== 3 || mappedBalances.rows[1]?.quantity !== 2) {
    throw new Error("STORE_MIGRATION_EXPLICIT_STORE_BALANCE_MAPPING_ASSERTION_FAILED");
  }
  const cleanStoreState = await database.query<{ is_default: boolean; allow_negative_stock: boolean }>(
    `SELECT s.is_default, cfg.allow_negative_stock
       FROM pos_stores s JOIN store_inventory_settings cfg
         ON cfg.tenant_id=s.tenant_id AND cfg.store_id=s.id
      WHERE s.tenant_id=$1`,
    [cleanTenantId],
  );
  if (cleanStoreState.rowCount !== 1 || cleanStoreState.rows[0]?.is_default !== true || cleanStoreState.rows[0]?.allow_negative_stock !== false) {
    throw new Error("STORE_MIGRATION_CLEAN_TENANT_DEFAULT_POLICY_ASSERTION_FAILED");
  }
  const rlsState = await database.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `SELECT c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('pos_stores','store_inventory_settings')`,
  );
  if (rlsState.rowCount !== 2 || rlsState.rows.some((row) => !row.relrowsecurity || !row.relforcerowsecurity)) {
    throw new Error("STORE_MIGRATION_RLS_FORCE_ASSERTION_FAILED");
  }
  console.log(JSON.stringify({
    result: "PASS",
    legacy_preflight: "unmapped inventory rejected",
    rollback: "all migration DDL and data changes rolled back",
    explicit_store_mapping: "legacy stock preserved as 3 and 2 units in two mapped Stores",
    clean_tenant: "Default Store created",
    default_backorder_policy: false,
    rls: "enabled and forced on both Store tables",
  }, null, 2));
} finally {
  if (database) await database.end().catch(() => undefined);
  if (databaseCreated) await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => undefined);
  await admin.end().catch(() => undefined);
}
