import { Client } from "pg";
import type { QueueSale, SaleLine } from "./contracts";
import { verifySalePrices } from "./catalog-crypto";
import { catalogSigningKey } from "./secrets";
import { canonicalize, sha256Hex, assertSaleShape } from "./canonical";

class PermanentDataError extends Error {}

interface WriteCteResult {
  claimed: number;
  inserted_sales: number;
  completed_idempotency: number;
  last_committed_seq_no: string | number | null;
  last_hlc_physical_ms: string | number | null;
  last_hlc_logical: number | null;
  prior_payload_hash: string | null;
  prior_status: string | null;
  prior_sale_id: string | null;
  prior_sequence_sale_id: string | null;
}

function moneyFromLines(lines: SaleLine[]): number {
  let total = 0;
  for (const line of lines) {
    const lineBase = line.quantity * line.unit_price_minor;
    const tax = Math.round((lineBase * line.tax_bps) / 10000);
    total += lineBase + tax;
    if (!Number.isSafeInteger(total)) throw new PermanentDataError("AMOUNT_OVERFLOW");
  }
  return total;
}

function lineTaxMinor(line: SaleLine): number {
  const tax = Math.round((line.quantity * line.unit_price_minor * line.tax_bps) / 10000);
  if (!Number.isSafeInteger(tax)) throw new PermanentDataError("TAX_AMOUNT_OVERFLOW");
  return tax;
}

/**
 * One writeable-CTE statement is the complete PostgreSQL transaction for a new sale.
 * PostgreSQL executes a single statement in one implicit transaction, so the CTE
 * either commits all ledger effects or none. The idempotency row is inserted as
 * COMMITTED in that statement; there is no intermediate PROCESSING write followed
 * by a second mutation of the same row. The transaction-local RLS context is set
 * by the first MATERIALIZED CTE and cannot leak to another statement.
 *
 * A same-snapshot duplicate lookup resolves ordinary replays in this same statement.
 * If a concurrent conflicting insert committed after the statement snapshot, the
 * caller receives a retryable result; the next Queue delivery sees the committed row.
 */
const COMMIT_SALE_CTE = `
WITH
 tenant_ctx AS MATERIALIZED (
   SELECT set_config('app.current_tenant_id', $1::uuid::text, true) AS tenant_id
 ),
 checkpoint_lock AS MATERIALIZED (
   SELECT last_committed_seq_no,last_hlc_physical_ms,last_hlc_logical
     FROM terminal_sync_state
    WHERE tenant_id=$1 AND terminal_id=$2
      AND EXISTS (SELECT 1 FROM tenant_ctx)
    FOR UPDATE
 ),
 checkpoint_state AS MATERIALIZED (
   SELECT
     COALESCE((SELECT last_committed_seq_no FROM checkpoint_lock),0)::bigint AS last_committed_seq_no,
     COALESCE((SELECT last_hlc_physical_ms FROM checkpoint_lock),0)::bigint AS last_hlc_physical_ms,
     COALESCE((SELECT last_hlc_logical FROM checkpoint_lock),0)::integer AS last_hlc_logical
     FROM tenant_ctx
 ),
 checkpoint_guard AS MATERIALIZED (
   SELECT last_committed_seq_no,last_hlc_physical_ms,last_hlc_logical
     FROM checkpoint_state
    WHERE last_committed_seq_no + 1 = $7::bigint
      AND ($11::bigint,$12::integer) >=
          (last_hlc_physical_ms,last_hlc_logical)
 ),
 idempotency_claim AS (
   INSERT INTO pos_idempotency
     (tenant_id,terminal_id,idempotency_key,receipt_id,payload_hash,sale_id,status,created_at,committed_at)
   SELECT $1,$2,$3,$4,$5,$6,'COMMITTED',now(),now()
     FROM tenant_ctx
     CROSS JOIN checkpoint_guard
   ON CONFLICT (tenant_id,idempotency_key) DO NOTHING
   RETURNING tenant_id,terminal_id,idempotency_key
 ),
 prior_idempotency AS MATERIALIZED (
   SELECT payload_hash,status,sale_id
     FROM pos_idempotency
    WHERE tenant_id=$1 AND idempotency_key=$3
      AND NOT EXISTS (SELECT 1 FROM idempotency_claim)
 ),
 prior_sequence_sale AS MATERIALIZED (
   SELECT sale_id
     FROM sales
    WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=$7
 ),
 sales_insert AS (
   INSERT INTO sales
     (sale_id,tenant_id,terminal_id,store_id,terminal_seq_no,currency,total_minor,catalog_version,
      hlc_physical_ms,hlc_logical,client_recorded_at,edge_received_at,committed_at)
   SELECT $6,$1,$2,$17,$7,$8,$9,$10,$11,$12,$13,$14,now()
     FROM idempotency_claim
     CROSS JOIN checkpoint_guard
   RETURNING sale_id
 ),
 input_lines AS MATERIALIZED (
   SELECT *
     FROM jsonb_to_recordset($15::jsonb) AS line(
       product_id uuid,
       quantity integer,
       unit_price_minor bigint,
       tax_bps integer,
       tax_minor bigint,
       signed_unit_price_minor bigint
     )
 ),
 sale_lines_insert AS (
   INSERT INTO sale_lines
     (tenant_id,store_id,sale_id,product_id,quantity,unit_price_minor,tax_bps,tax_minor,
      catalog_version,signed_unit_price_minor,signed_price_verified)
   SELECT $1,$17,s.sale_id,l.product_id,l.quantity,l.unit_price_minor,l.tax_bps,l.tax_minor,
          $10,l.signed_unit_price_minor,true
     FROM sales_insert s
     CROSS JOIN input_lines l
   RETURNING 1 AS inserted
 ),
 inventory_totals AS MATERIALIZED (
   SELECT product_id,SUM(quantity)::bigint AS quantity
     FROM input_lines
    WHERE EXISTS (SELECT 1 FROM sale_lines_insert)
    GROUP BY product_id
 ),
 inventory_insert AS (
   INSERT INTO inventory_ledger
     (tenant_id,store_id,product_id,sale_id,terminal_id,reference_id,quantity_delta,reason,created_at)
   SELECT $1,$17,i.product_id,$6,$2,$6,(-i.quantity)::integer,'POS_SALE',now()
     FROM inventory_totals i
   RETURNING 1 AS inserted
 ),
 audit_insert AS (
   INSERT INTO audit_logs
     (tenant_id,actor_type,actor_id,action,entity_type,entity_id,
      payload_hash,catalog_version,metadata,created_at)
   SELECT $1,'POS_TERMINAL',$2,'POS_SALE_COMMITTED','SALE',$6,$5,$10,$16::jsonb,now()
     FROM sales_insert
    WHERE EXISTS (SELECT 1 FROM inventory_insert)
   RETURNING 1 AS inserted
 ),
 checkpoint_update AS (
   INSERT INTO terminal_sync_state
     (tenant_id,terminal_id,last_committed_seq_no,last_hlc_physical_ms,last_hlc_logical,updated_at)
   SELECT $1,$2,$7,$11,$12,now()
     FROM audit_insert
   ON CONFLICT (tenant_id,terminal_id) DO UPDATE
     SET last_committed_seq_no=EXCLUDED.last_committed_seq_no,
         last_hlc_physical_ms=EXCLUDED.last_hlc_physical_ms,
         last_hlc_logical=EXCLUDED.last_hlc_logical,
         updated_at=now()
   RETURNING last_committed_seq_no,last_hlc_physical_ms,last_hlc_logical
 )
SELECT
  (SELECT COUNT(*)::integer FROM idempotency_claim) AS claimed,
  (SELECT COUNT(*)::integer FROM sales_insert) AS inserted_sales,
  CASE WHEN (SELECT COUNT(*) FROM checkpoint_update)=1
       THEN (SELECT COUNT(*)::integer FROM idempotency_claim)
       ELSE 0 END AS completed_idempotency,
  (SELECT last_committed_seq_no FROM checkpoint_state LIMIT 1) AS last_committed_seq_no,
  (SELECT last_hlc_physical_ms FROM checkpoint_state LIMIT 1) AS last_hlc_physical_ms,
  (SELECT last_hlc_logical FROM checkpoint_state LIMIT 1) AS last_hlc_logical,
  (SELECT payload_hash FROM prior_idempotency LIMIT 1) AS prior_payload_hash,
  (SELECT status FROM prior_idempotency LIMIT 1) AS prior_status,
  (SELECT sale_id FROM prior_idempotency LIMIT 1) AS prior_sale_id,
  (SELECT sale_id FROM prior_sequence_sale LIMIT 1) AS prior_sequence_sale_id
`;

export async function commitSale(env: Env, message: QueueSale): Promise<"committed" | "duplicate"> {
  const client = new Client({ connectionString: env.HYPERDRIVE_DIRECT.connectionString });

  try {
    await client.connect();
    try {
      assertSaleShape(message.sale);
    } catch {
      throw new PermanentDataError("SALE_SCHEMA_INVALID_AT_ORIGIN");
    }
    if (message.idempotency_key !== message.sale.idempotency_key) {
      throw new PermanentDataError("IDEMPOTENCY_KEY_ENVELOPE_MISMATCH");
    }

    // Cryptographic verification remains in the trusted Worker runtime. The
    // CTE persists only values whose catalog proof and canonical payload hash pass.
    if (!(await verifySalePrices(message.sale, catalogSigningKey(env), Date.parse(message.edge_received_at)))) {
      throw new PermanentDataError("SIGNED_CATALOG_INVALID_OR_EXPIRED");
    }
    const { payload_hash: claimedHash, ...hashableSale } = message.sale;
    const computedPayloadHash = await sha256Hex(canonicalize({
      tenant_id: message.tenant_id,
      terminal_id: message.terminal_id,
      sale: hashableSale
    }));
    if (computedPayloadHash !== message.payload_hash || claimedHash !== message.payload_hash) {
      throw new PermanentDataError("PAYLOAD_HASH_MISMATCH_AT_ORIGIN");
    }

    const totalMinor = moneyFromLines(message.sale.lines);
    const lineRecords = message.sale.lines.map((line) => ({
      product_id: line.product_id,
      quantity: line.quantity,
      unit_price_minor: line.unit_price_minor,
      tax_bps: line.tax_bps,
      tax_minor: lineTaxMinor(line),
      signed_unit_price_minor: line.unit_price_minor
    }));
    const auditMetadata = {
      receipt_id: message.receipt_id,
      store_id: message.store_id,
      terminal_seq_no: message.sale.terminal_seq_no,
      hlc: message.sale.hlc,
      catalog_version: message.sale.catalog_version,
      signed_price_verified: true,
      signed_unit_prices: message.sale.lines.map((line) => ({
        product_id: line.product_id,
        signed_unit_price_minor: line.unit_price_minor,
        tax_bps: line.tax_bps
      })),
      signed_price_proofs: message.sale.signed_price_proofs.map((proof) => ({
        product_id: proof.product_id,
        catalog_version: proof.catalog_version,
        issued_at: proof.issued_at,
        expires_at: proof.expires_at,
        signature: proof.signature
      })),
      edge_received_at: message.edge_received_at
    };

    // A single parameterized PostgreSQL statement performs the entire sale
    // transaction (including duplicate resolution), RLS context, idempotency,
    // ledger writes, inventory trigger, immutable audit, and checkpoint advance.
    const result = await client.query(COMMIT_SALE_CTE, [
      message.tenant_id,
      message.terminal_id,
      message.idempotency_key,
      message.receipt_id,
      message.payload_hash,
      message.sale.sale_id,
      message.sale.terminal_seq_no,
      message.sale.currency,
      totalMinor,
      message.sale.catalog_version,
      message.sale.hlc.physical_ms,
      message.sale.hlc.logical,
      message.sale.client_recorded_at,
      message.edge_received_at,
      JSON.stringify(lineRecords),
      JSON.stringify(auditMetadata),
      message.store_id
    ]);

    const row = result.rows[0] as WriteCteResult | undefined;
    if (!row) throw new Error("POSTGRES_CTE_RETURNED_NO_STATUS");

    if (Number(row.claimed) === 0) {
      const existing = row.prior_payload_hash ? {
        payload_hash: row.prior_payload_hash,
        status: row.prior_status,
        sale_id: row.prior_sale_id
      } : undefined;
      if (existing) {
        if (existing.payload_hash !== message.payload_hash || existing.sale_id !== message.sale.sale_id) {
          throw new PermanentDataError("IDEMPOTENCY_PAYLOAD_MISMATCH");
        }
        if (existing.status === "COMMITTED") return "duplicate";
        throw new Error("IDEMPOTENCY_INCOMPLETE_RETRY");
      }
      const lastSequence = Number(row.last_committed_seq_no ?? 0);
      if (message.sale.terminal_seq_no > lastSequence + 1) {
        throw new Error(`TERMINAL_SEQUENCE_GAP:${lastSequence + 1}-${message.sale.terminal_seq_no - 1}`);
      }
      if (message.sale.terminal_seq_no <= lastSequence && row.prior_sequence_sale_id) {
        throw new PermanentDataError("TERMINAL_SEQUENCE_ALREADY_COMMITTED");
      }
      const lastPhysical = Number(row.last_hlc_physical_ms ?? 0);
      const lastLogical = Number(row.last_hlc_logical ?? 0);
      if (message.sale.hlc.physical_ms < lastPhysical ||
          (message.sale.hlc.physical_ms === lastPhysical && message.sale.hlc.logical < lastLogical)) {
        throw new PermanentDataError("ORIGIN_HLC_REGRESSION");
      }
      // A concurrent INSERT ... ON CONFLICT may have committed after this
      // statement snapshot. Retry once to resolve it from a fresh snapshot.
      throw new Error("IDEMPOTENCY_CONFLICT_RETRY");
    }

    if (Number(row.inserted_sales) !== 1 || Number(row.completed_idempotency) !== 1) {
      const lastSequence = Number(row.last_committed_seq_no ?? 0);
      if (message.sale.terminal_seq_no > lastSequence + 1) {
        throw new Error(`TERMINAL_SEQUENCE_GAP:${lastSequence + 1}-${message.sale.terminal_seq_no - 1}`);
      }
      if (message.sale.terminal_seq_no <= lastSequence) {
        throw new PermanentDataError("TERMINAL_SEQUENCE_ALREADY_COMMITTED");
      }
      const lastPhysical = Number(row.last_hlc_physical_ms ?? 0);
      const lastLogical = Number(row.last_hlc_logical ?? 0);
      if (message.sale.hlc.physical_ms < lastPhysical ||
          (message.sale.hlc.physical_ms === lastPhysical && message.sale.hlc.logical < lastLogical)) {
        throw new PermanentDataError("ORIGIN_HLC_REGRESSION");
      }
      throw new Error("POSTGRES_CTE_WRITE_CHAIN_INCOMPLETE");
    }

    return "committed";
  } finally {
    await client.end().catch(() => undefined);
  }
}

export { PermanentDataError };
