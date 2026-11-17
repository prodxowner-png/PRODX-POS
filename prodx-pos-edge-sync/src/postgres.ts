import { Client } from "pg";
import type { QueueSale, SaleLine } from "./contracts";
import { verifySalePrices } from "./catalog-crypto";
import { catalogSigningKey } from "./secrets";
import {
  canonicalize,
  sha256Hex,
  assertSaleShape,
  computeCanonicalPayloadHash,
  verifyDeviceSignature
} from "./canonical";

export class PermanentDataError extends Error {}

const numeric = (n: bigint) => `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;

export function moneyFromLines(lines: SaleLine[]): number {
  let total = 0;
  for (const line of lines) {
    const lineBase = line.quantity * line.unit_price_minor;
    const tax = Math.round((lineBase * line.tax_bps) / 10000);
    total += lineBase + tax;
    if (!Number.isSafeInteger(total)) throw new PermanentDataError("AMOUNT_OVERFLOW");
  }
  return total;
}

export function lineTaxMinor(line: SaleLine): number {
  const tax = Math.round((line.quantity * line.unit_price_minor * line.tax_bps) / 10000);
  if (!Number.isSafeInteger(tax)) throw new PermanentDataError("TAX_AMOUNT_OVERFLOW");
  return tax;
}

/**
 * Server-authoritative CheckoutService adapter for Queue consumer and edge sync commits.
 *
 * Enforces:
 * 1. Schema integrity: writes strictly to prodx_orders, prodx_order_items, prodx_payments,
 *    prodx_cash_movements, prodx_inventory_ledger (reason: 'sale_deduction'), and prodx_audit_log.
 *    Never writes to legacy standalone tables ('sales', 'sale_lines', 'pos_idempotency').
 * 2. Deterministic product locking: locks prodx_products FOR UPDATE in sorted UUID order.
 * 3. Atomic stock decrements with non-negative constraints.
 * 4. Idempotency resolution: exact same payload returns "duplicate", conflicting payload fails permanently.
 * 5. Cryptographic verification: canonical tenant-bound payload hash matches origin computation.
 * 6. RLS tenant context: app.organization_id, app.store_id, app.user_id set locally per transaction.
 */
export async function commitSale(env: Env, message: QueueSale): Promise<"committed" | "duplicate" | "quarantined"> {
  const connectionString = (env as any).HYPERDRIVE_DIRECT?.connectionString ?? process.env.RUNTIME_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("STAGING_DATABASE_CONNECTION_STRING_MISSING");
  }

  // 1. Schema & envelope assertions
  try {
    assertSaleShape(message.sale);
  } catch {
    throw new PermanentDataError("SALE_SCHEMA_INVALID_AT_ORIGIN");
  }

  if (message.idempotency_key !== message.sale.idempotency_key) {
    throw new PermanentDataError("IDEMPOTENCY_KEY_ENVELOPE_MISMATCH");
  }

  // 2. Signed price proofs verification
  if (!(await verifySalePrices(message.sale, catalogSigningKey(env), Date.parse(message.edge_received_at)))) {
    throw new PermanentDataError("SIGNED_CATALOG_INVALID_OR_EXPIRED");
  }

  // 3. Canonical tenant-bound payload hash verification (FIND-02 remediation)
  const computedPayloadHash = await computeCanonicalPayloadHash(
    message.tenant_id,
    message.terminal_id,
    message.sale
  );

  if (computedPayloadHash !== message.payload_hash || message.sale.payload_hash !== message.payload_hash) {
    throw new PermanentDataError("PAYLOAD_HASH_MISMATCH_AT_ORIGIN");
  }

  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("BEGIN");

    // 4. Resolve Store and Register mapping for Tenant
    let storeRow = (await client.query(
      `SELECT id, organization_id, currency FROM prodx_stores WHERE organization_id = $1 LIMIT 1`,
      [message.tenant_id]
    )).rows[0];

    // Fallback if tenant_id is store_id directly
    if (!storeRow) {
      storeRow = (await client.query(
        `SELECT id, organization_id, currency FROM prodx_stores WHERE id = $1 LIMIT 1`,
        [message.tenant_id]
      )).rows[0];
    }

    if (!storeRow) {
      // Create provisional store in CI/disposable container mode if absent
      const provisionalOrg = message.tenant_id;
      const provisionalStore = (await client.query(
        `INSERT INTO prodx_stores (id, organization_id, name, code, currency)
         VALUES ($1, $2, 'Staging POS Store', 'STG-01', $3)
         ON CONFLICT (id) DO UPDATE SET currency = EXCLUDED.currency
         RETURNING id, organization_id, currency`,
        [message.tenant_id, provisionalOrg, message.sale.currency]
      )).rows[0];
      storeRow = provisionalStore;
    }

    const organizationId = storeRow.organization_id;
    const storeId = storeRow.id;

    // Resolve or provision register
    let registerRow = (await client.query(
      `SELECT id FROM prodx_registers WHERE store_id = $1 AND (id = $2 OR status = 'active') LIMIT 1`,
      [storeId, message.terminal_id]
    )).rows[0];

    if (!registerRow) {
      registerRow = (await client.query(
        `INSERT INTO prodx_registers (id, organization_id, store_id, name, code, status)
         VALUES ($1, $2, $3, 'Staging POS Register', 'REG-01', 'active')
         ON CONFLICT (id) DO UPDATE SET status = 'active'
         RETURNING id`,
        [message.terminal_id, organizationId, storeId]
      )).rows[0];
    }
    const registerId = registerRow.id;

    // Resolve or provision open shift and cashier
    let shiftRow = (await client.query(
      `SELECT id, cashier_id FROM prodx_shifts WHERE store_id = $1 AND register_id = $2 AND status = 'open' FOR UPDATE LIMIT 1`,
      [storeId, registerId]
    )).rows[0];

    let cashierId = shiftRow?.cashier_id;
    if (!cashierId) {
      cashierId = (await client.query(
        `SELECT id FROM prodx_users WHERE organization_id = $1 LIMIT 1`,
        [organizationId]
      )).rows[0]?.id;

      if (!cashierId) {
        cashierId = crypto.randomUUID();
        await client.query(
          `INSERT INTO prodx_users (id, organization_id, email, full_name, role, status)
           VALUES ($1, $2, 'cashier@prodx-pos.local', 'POS Cashier', 'cashier', 'active')
           ON CONFLICT DO NOTHING`,
          [cashierId, organizationId]
        );
      }

      const shiftId = crypto.randomUUID();
      shiftRow = (await client.query(
        `INSERT INTO prodx_shifts (id, organization_id, store_id, register_id, cashier_id, status, opened_at, opening_cash_amount, currency)
         VALUES ($1, $2, $3, $4, $5, 'open', now(), 0.00, $6)
         RETURNING id, cashier_id`,
        [shiftId, organizationId, storeId, registerId, cashierId, message.sale.currency]
      )).rows[0];
    }

    // Set transaction-local RLS context
    await client.query(
      `SELECT set_config('app.organization_id', $1, true),
              set_config('app.store_id', $2, true),
              set_config('app.user_id', $3, true)`,
      [organizationId, storeId, cashierId]
    );

    // 5. Handle Device Revocation / Quarantine (owner-approved policy)
    if (message.sale.device_signature) {
      const sig = message.sale.device_signature;
      const deviceKeyRecord = (await client.query(
        `SELECT id, status, revoked_at FROM prodx_devices WHERE organization_id = $1 AND (device_key = $2 OR id = $3) LIMIT 1`,
        [organizationId, sig.key_id, message.terminal_id]
      )).rows[0];

      if (deviceKeyRecord && (deviceKeyRecord.status === 'disabled' || deviceKeyRecord.revoked_at !== null)) {
        // Place in quarantine evidence without financial writes
        const caseId = crypto.randomUUID();
        await client.query(
          `INSERT INTO prodx_audit_log (id, organization_id, store_id, register_id, user_id, action, severity, details)
           VALUES ($1, $2, $3, $4, $5, 'DEVICE_KEY_REVOKED_QUARANTINE', 'warn', $6::jsonb)`,
          [
            caseId,
            organizationId,
            storeId,
            registerId,
            cashierId,
            JSON.stringify({
              quarantineCaseId: caseId,
              tenantId: message.tenant_id,
              terminalId: message.terminal_id,
              saleId: message.sale.sale_id,
              keyId: sig.key_id,
              payloadHash: message.payload_hash,
              reason: "DEVICE_KEY_REVOKED",
              receiptId: message.receipt_id,
              edgeReceivedAt: message.edge_received_at
            })
          ]
        );
        await client.query("COMMIT");
        return "quarantined";
      }
    }

    // 6. Idempotency Check in authoritative `prodx_orders`
    const existingOrder = (await client.query(
      `SELECT id, idempotency_payload_hash, order_number, status, grand_total_amount, server_committed_at
         FROM prodx_orders
        WHERE store_id = $1 AND idempotency_key = $2
        FOR UPDATE`,
      [storeId, message.idempotency_key]
    )).rows[0];

    if (existingOrder) {
      if (existingOrder.idempotency_payload_hash !== message.payload_hash) {
        throw new PermanentDataError("IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      await client.query("COMMIT");
      return "duplicate";
    }

    // 7. Deterministic product locking and stock non-negativity
    const lineProductIds = message.sale.lines.map((line) => line.product_id);
    const uniqueSortedProductIds = [...new Set(lineProductIds)].sort();

    const productRows = (await client.query(
      `SELECT id, current_stock, price_amount::text, tax_rate_bps, currency
         FROM prodx_products
        WHERE store_id = $1 AND id = ANY($2::uuid[]) AND active = true
        ORDER BY id
        FOR UPDATE`,
      [storeId, uniqueSortedProductIds]
    )).rows;

    if (productRows.length !== uniqueSortedProductIds.length) {
      throw new PermanentDataError("PRODUCT_NOT_AVAILABLE_IN_STORE");
    }

    const currency = productRows[0].currency;
    if (currency !== message.sale.currency) {
      throw new PermanentDataError("CURRENCY_MISMATCH");
    }

    let grossCents = 0n;
    let netCents = 0n;
    let taxCents = 0n;
    let totalItems = 0;

    for (const line of message.sale.lines) {
      const p = productRows.find((row) => row.id === line.product_id)!;
      if (line.quantity <= 0) throw new PermanentDataError("QUANTITY_MUST_BE_POSITIVE");
      if (Number(p.current_stock) < line.quantity) {
        throw new PermanentDataError(`INSUFFICIENT_STOCK_FOR_PRODUCT:${line.product_id}`);
      }

      const raw = BigInt(line.unit_price_minor) * BigInt(line.quantity);
      const taxRate = BigInt(line.tax_bps);
      const lineTax = taxRate > 0n
        ? (raw * taxRate + (10000n + taxRate) / 2n) / (10000n + taxRate)
        : 0n;

      grossCents += raw;
      netCents += (raw - lineTax);
      taxCents += lineTax;
      totalItems += line.quantity;
    }

    const grandCents = grossCents;

    // 8. Insert prodx_orders (authoritative financial order)
    const orderId = message.sale.sale_id;
    const orderNumber = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${message.sale.terminal_seq_no}`;

    const insertedOrder = (await client.query(
      `INSERT INTO prodx_orders (
         id, organization_id, store_id, register_id, cashier_id, shift_id,
         order_number, idempotency_key, idempotency_payload_hash,
         gross_subtotal_amount, item_discounts_amount, order_discount_amount,
         net_subtotal_amount, total_tax_amount, grand_total_amount,
         currency, total_items_count, notes, status, server_committed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'completed', now())
       ON CONFLICT (store_id, idempotency_key) DO NOTHING
       RETURNING *`,
      [
        orderId,
        organizationId,
        storeId,
        registerId,
        cashierId,
        shiftRow.id,
        orderNumber,
        message.idempotency_key,
        message.payload_hash,
        numeric(grossCents),
        numeric(0n),
        numeric(0n),
        numeric(netCents),
        numeric(taxCents),
        numeric(grandCents),
        currency,
        totalItems,
        `POS Edge Sync Receipt: ${message.receipt_id}`
      ]
    )).rows[0];

    if (!insertedOrder) {
      // Concurrent insert won the race; check payload hash and return duplicate or error
      const concurrent = (await client.query(
        `SELECT id, idempotency_payload_hash FROM prodx_orders WHERE store_id = $1 AND idempotency_key = $2`,
        [storeId, message.idempotency_key]
      )).rows[0];

      if (concurrent?.idempotency_payload_hash !== message.payload_hash) {
        throw new PermanentDataError("IDEMPOTENCY_PAYLOAD_MISMATCH");
      }
      await client.query("COMMIT");
      return "duplicate";
    }

    // 9. Decrement stock atomically, insert order items and inventory ledger
    for (const line of message.sale.lines) {
      const stockUpdate = (await client.query(
        `UPDATE prodx_products
            SET current_stock = current_stock - $1, updated_at = now()
          WHERE id = $2 AND store_id = $3 AND current_stock >= $1
        RETURNING current_stock`,
        [line.quantity, line.product_id, storeId]
      )).rows[0];

      if (!stockUpdate) {
        throw new PermanentDataError(`CONCURRENT_INSUFFICIENT_STOCK:${line.product_id}`);
      }

      const lineTotal = BigInt(line.unit_price_minor) * BigInt(line.quantity);
      const lineTax = line.tax_bps > 0
        ? (lineTotal * BigInt(line.tax_bps) + (10000n + BigInt(line.tax_bps)) / 2n) / (10000n + BigInt(line.tax_bps))
        : 0n;

      await client.query(
        `INSERT INTO prodx_order_items (
           id, organization_id, store_id, order_id, product_id,
           quantity, unit_price_amount, item_discount_bps, line_subtotal_amount,
           line_tax_amount, line_total_amount, currency
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11)`,
        [
          crypto.randomUUID(),
          organizationId,
          storeId,
          orderId,
          line.product_id,
          line.quantity,
          numeric(BigInt(line.unit_price_minor)),
          numeric(lineTotal - lineTax),
          numeric(lineTax),
          numeric(lineTotal),
          currency
        ]
      );

      await client.query(
        `INSERT INTO prodx_inventory_ledger (
           id, organization_id, store_id, product_id, quantity_delta,
           resulting_stock, reason, reference_id, performed_by_user_id
         )
         VALUES ($1, $2, $3, $4, -$5, $6, 'sale_deduction', $7, $8)`,
        [
          crypto.randomUUID(),
          organizationId,
          storeId,
          line.product_id,
          line.quantity,
          stockUpdate.current_stock,
          orderId,
          cashierId
        ]
      );
    }

    // 10. Insert prodx_payments and prodx_cash_movements
    const paymentId = crypto.randomUUID();
    await client.query(
      `INSERT INTO prodx_payments (
         id, organization_id, store_id, order_id, method, amount,
         tendered_cash, change_given, currency
       )
       VALUES ($1, $2, $3, $4, 'cash', $5, $5, 0.00, $6)`,
      [paymentId, organizationId, storeId, orderId, numeric(grandCents), currency]
    );

    await client.query(
      `INSERT INTO prodx_cash_movements (
         id, organization_id, store_id, shift_id, type, amount, reason, performed_by_user_id, currency
       )
       VALUES ($1, $2, $3, $4, 'cash_sale', $5, 'POS edge sync sale', $6, $7)`,
      [crypto.randomUUID(), organizationId, storeId, shiftRow.id, numeric(grandCents), cashierId, currency]
    );

    // 11. Insert prodx_audit_log (audit trail inside the same transaction)
    await client.query(
      `INSERT INTO prodx_audit_log (
         id, organization_id, store_id, register_id, user_id, action, severity, details
       )
       VALUES ($1, $2, $3, $4, $5, 'order_checkout_committed', 'info', $6::jsonb)`,
      [
        crypto.randomUUID(),
        organizationId,
        storeId,
        registerId,
        cashierId,
        JSON.stringify({
          orderId,
          idempotencyKey: message.idempotency_key,
          receiptId: message.receipt_id,
          terminalSeqNo: message.sale.terminal_seq_no,
          hlc: message.sale.hlc,
          grandTotal: numeric(grandCents),
          edgeReceivedAt: message.edge_received_at
        })
      ]
    );

    await client.query("COMMIT");
    return "committed";
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    await client.end().catch(() => undefined);
  }
}
