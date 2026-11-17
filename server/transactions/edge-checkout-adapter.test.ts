import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createEdgeCheckoutAdapter,
  EdgeCheckoutAdapterError,
  type EdgeCheckoutCommand
} from './edge-checkout-adapter';
import {
  canonicalize,
  sha256Hex,
  computeCanonicalPayloadHash,
  buildDeviceSignatureEnvelope
} from '../../prodx-pos-edge-sync/src/canonical';
import type { OfflineSale } from '../../prodx-pos-edge-sync/src/contracts';
import type { TransactionalSqlExecutor, SqlQueryExecutor } from '../db/transaction';

// Test fixtures
const orgId = '11111111-1111-4111-8111-111111111111';
const storeId = '22222222-2222-4222-8222-222222222222';
const terminalId = '33333333-3333-4333-8333-333333333333';
const registerId = '44444444-4444-4444-8444-444444444444';
const cashierId = '55555555-5555-4555-8555-555555555555';
const shiftId = '66666666-6666-4666-8666-666666666666';
const productId = '77777777-7777-4777-8777-777777777777';

const testJwk: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY',
  y: 'T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU',
  ext: true
};

const validLowSSignature = 'rX3QpYTa3eqzDf9TiDl6dsqnmGs8EZ7mhoEqGwkVEesmTHkG18Z5ZQU7E8a0FD9s3qEBx8j4-LGluBqIsKMssA';
const highSSignature = 'jvdQLc1de2oZHE9OVuYgoxgMNxVEkIVSx4I0-xMg3r2bqR6snpvWGxcG1OSxTZ7Nnmrn03ggHFB3t4gnTYHa9w';

function createMockDb(): {
  db: TransactionalSqlExecutor;
  orders: any[];
  items: any[];
  inventoryLedger: any[];
  auditLogs: any[];
  products: any[];
} {
  const products = [
    {
      id: productId,
      store_id: storeId,
      sku: 'SKU-001',
      name: 'Coffee',
      price_amount: '12.50',
      cost_price_amount: '5.00',
      tax_rate_bps: 0,
      current_stock: 100,
      reorder_point: 10,
      unit_of_measure: 'unit',
      currency: 'THB',
      active: true
    }
  ];
  const orders: any[] = [];
  const items: any[] = [];
  const inventoryLedger: any[] = [];
  const auditLogs: any[] = [];

  const executor: SqlQueryExecutor = {
    async query<T extends Record<string, any>>(sql: string, params: readonly unknown[] = []): Promise<{ rows: T[] }> {
      // Inserts
      if (sql.includes('INSERT INTO prodx_orders')) {
        const order = {
          id: params[0],
          organization_id: orgId,
          store_id: params[1],
          register_id: params[2],
          cashier_id: params[3],
          shift_id: params[4],
          order_number: params[5],
          idempotency_key: params[6],
          idempotency_payload_hash: params[7],
          gross_subtotal_amount: params[8],
          item_discounts_amount: params[9],
          order_discount_amount: params[10],
          net_subtotal_amount: params[11],
          total_tax_amount: params[12],
          grand_total_amount: params[13],
          currency: params[14],
          total_items_count: params[15],
          notes: params[16],
          status: 'completed',
          server_committed_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        };
        orders.push(order);
        return { rows: [order as unknown as T] };
      }
      if (sql.includes('INSERT INTO prodx_order_items')) {
        items.push({ id: params[0], order_id: params[1], product_id: params[3], quantity: params[4] });
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO prodx_payments')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO prodx_cash_movements')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO prodx_inventory_ledger')) {
        inventoryLedger.push({
          id: params[0],
          product_id: params[3],
          quantity_delta: params[4],
          resulting_stock: params[5],
          reason: 'sale_deduction'
        });
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO prodx_audit_log')) {
        const actionMatch = /'([A-Za-z0-9_]+)'/.exec(sql);
        const action = actionMatch ? actionMatch[1] : (params[5] as string ?? 'unknown');
        auditLogs.push({
          id: params[0],
          action,
          details: params[params.length - 1]
        });
        return { rows: [] };
      }

      // Selects
      if (sql.includes('FROM prodx_orders')) {
        if (sql.includes('idempotency_key')) {
          const store_id = params[0];
          const idempotency_key = params[1];
          const existing = orders.find(o => o.store_id === store_id && o.idempotency_key === idempotency_key);
          return { rows: (existing ? [existing] : []) as unknown as T[] };
        }
        if (sql.includes('WHERE id') || sql.includes('WHERE oi.order_id')) {
          const id = params[0];
          const existing = orders.find(o => o.id === id);
          return { rows: (existing ? [existing] : []) as unknown as T[] };
        }
        return { rows: orders as unknown as T[] };
      }
      if (sql.includes('FROM prodx_stores')) {
        return { rows: [{ id: storeId, organization_id: orgId, currency: 'THB' } as unknown as T] };
      }
      if (sql.includes('FROM prodx_registers')) {
        return { rows: [{ id: registerId } as unknown as T] };
      }
      if (sql.includes('FROM prodx_shifts')) {
        return { rows: [{ id: shiftId, cashier_id: cashierId } as unknown as T] };
      }
      if (sql.includes('UPDATE prodx_products SET current_stock')) {
        const qty = Number(params[0]);
        const pId = params[1];
        const p = products.find(x => x.id === pId);
        if (p && p.current_stock >= qty) {
          p.current_stock -= qty;
          return { rows: [{ current_stock: p.current_stock } as unknown as T] };
        }
        return { rows: [] };
      }
      if (sql.includes('FROM prodx_products')) {
        return { rows: products.filter(p => p.active) as unknown as T[] };
      }
      if (sql.includes('FROM prodx_order_items')) {
        const orderId = params[0];
        const matched = items.filter(i => i.order_id === orderId).map(i => {
          const p = products.find(prod => prod.id === i.product_id)!;
          return {
            ...i,
            sku: p.sku,
            barcode: p.sku,
            name: p.name,
            category_id: 'cat-1',
            unit_price_amount: p.price_amount,
            cost_price_amount: p.cost_price_amount,
            tax_rate_bps: p.tax_rate_bps,
            current_stock: p.current_stock,
            reorder_point: p.reorder_point,
            unit_of_measure: p.unit_of_measure,
            item_discount_bps: 0,
            line_subtotal_amount: p.price_amount,
            line_tax_amount: '0.00',
            line_total_amount: p.price_amount
          };
        });
        return { rows: matched as unknown as T[] };
      }
      if (sql.includes('FROM prodx_payments')) {
        return {
          rows: [{
            id: 'pay-1',
            method: 'cash',
            amount: '12.50',
            tendered_cash: '12.50',
            change_given: '0.00',
            currency: 'THB',
            created_at: new Date().toISOString()
          } as unknown as T]
        };
      }
      if (sql.includes('set_config')) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };

  const db: TransactionalSqlExecutor = {
    ...executor,
    async transaction<T>(work: (tx: SqlQueryExecutor) => Promise<T>): Promise<T> {
      const snapOrders = [...orders];
      const snapItems = [...items];
      const snapLedger = [...inventoryLedger];
      const snapAudit = [...auditLogs];
      const snapProducts = products.map(p => ({ ...p }));
      try {
        return await work(executor);
      } catch (err) {
        orders.length = 0;
        orders.push(...snapOrders);
        items.length = 0;
        items.push(...snapItems);
        inventoryLedger.length = 0;
        inventoryLedger.push(...snapLedger);
        auditLogs.length = 0;
        auditLogs.push(...snapAudit);
        for (let i = 0; i < products.length; i++) {
          Object.assign(products[i], snapProducts[i]);
        }
        throw err;
      }
    }
  };

  return { db, orders, items, inventoryLedger, auditLogs, products };
}

describe('CheckoutService Edge Adapter & Integrity Verification (M6.1–M6.5)', () => {
  async function makeCommand(overrides?: Partial<OfflineSale>): Promise<EdgeCheckoutCommand> {
    const sale: OfflineSale = {
      idempotency_key: 'idem-test-cmd-001',
      payload_hash: '',
      sale_id: crypto.randomUUID(),
      terminal_seq_no: 1,
      hlc: { physical_ms: 1730000000000, logical: 0 },
      catalog_version: 7,
      signed_price_proofs: [],
      client_recorded_at: '2026-11-11T10:00:00Z',
      currency: 'THB',
      lines: [{
        product_id: productId,
        quantity: 1,
        unit_price_minor: 1250,
        tax_bps: 0
      }],
      ...overrides
    };

    const payloadHash = await computeCanonicalPayloadHash(orgId, terminalId, sale);
    sale.payload_hash = payloadHash;

    return {
      tenant_id: orgId,
      terminal_id: terminalId,
      idempotency_key: sale.idempotency_key,
      payload_hash: payloadHash,
      sale,
      edge_received_at: new Date().toISOString(),
      receipt_id: crypto.randomUUID()
    };
  }

  it('1. Canonical hash consistency: passes verification when Edge and backend compute identical hash', async () => {
    const { db } = createMockDb();
    const adapter = createEdgeCheckoutAdapter(db);
    const command = await makeCommand();

    const result = await adapter.processEdgeSale(command);
    assert.equal(result.kind, 'committed');
    assert.equal((result as any).duplicate, false);
    assert.ok((result as any).order.id);
  });

  it('2. Payload tampering: rejects sale when price or quantity was tampered', async () => {
    const { db } = createMockDb();
    const adapter = createEdgeCheckoutAdapter(db);
    const command = await makeCommand();

    // Tamper with line quantity after payload hash was computed
    command.sale.lines[0].quantity = 99;

    await assert.rejects(
      async () => await adapter.processEdgeSale(command),
      (err: any) => {
        assert.equal(err.code, 'PAYLOAD_HASH_MISMATCH_AT_ORIGIN');
        return true;
      }
    );
  });

  it('3. Cross-tenant isolation: rejects sale when tenant_id does not match canonical payload binding', async () => {
    const { db } = createMockDb();
    const adapter = createEdgeCheckoutAdapter(db);
    const command = await makeCommand();

    // Attempt to present the sale under a different tenant_id
    command.tenant_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

    await assert.rejects(
      async () => await adapter.processEdgeSale(command),
      (err: any) => {
        assert.equal(err.code, 'PAYLOAD_HASH_MISMATCH_AT_ORIGIN');
        return true;
      }
    );
  });

  it('4. Duplicate delivery: returns original committed order with duplicate: true and 0 side effects', async () => {
    const { db, inventoryLedger, products } = createMockDb();
    const adapter = createEdgeCheckoutAdapter(db);
    const command = await makeCommand();

    // First commit
    const firstResult = await adapter.processEdgeSale(command);
    assert.equal(firstResult.kind, 'committed');
    assert.equal((firstResult as any).duplicate, false);
    assert.equal(inventoryLedger.length, 1);
    assert.equal(products[0].current_stock, 99);

    // Duplicate delivery: exact same idempotency key and payload hash
    const secondResult = await adapter.processEdgeSale(command);
    assert.equal(secondResult.kind, 'committed');
    assert.equal((secondResult as any).duplicate, true);
    assert.equal((secondResult as any).order.id, (firstResult as any).order.id);

    // Invariant: zero extra stock decrement or ledger entry on duplicate
    assert.equal(inventoryLedger.length, 1);
    assert.equal(products[0].current_stock, 99);
  });

  it('5. Idempotency conflict: rejects reuse of idempotency key with different payload', async () => {
    const { db } = createMockDb();
    const adapter = createEdgeCheckoutAdapter(db);
    const command = await makeCommand();

    // Commit initial sale
    await adapter.processEdgeSale(command);

    // Craft conflicting command with same idempotency key but different sale details
    const conflicting = await makeCommand({
      idempotency_key: command.idempotency_key,
      sale_id: crypto.randomUUID(),
      lines: [{ product_id: productId, quantity: 5, unit_price_minor: 1250, tax_bps: 0 }]
    });

    await assert.rejects(
      async () => await adapter.processEdgeSale(conflicting),
      (err: any) => {
        assert.ok(err.message.includes('Idempotency key was already used for a different checkout payload'));
        return true;
      }
    );
  });

  it('6. Revoked device key: owner-approved quarantine policy routes to quarantine without financial writes', async () => {
    const { db, orders, inventoryLedger, auditLogs } = createMockDb();
    const adapter = createEdgeCheckoutAdapter(db);

    const command = await makeCommand({
      device_signature: {
        algorithm: 'ECDSA-P256-SHA256',
        key_id: 'revoked-key-001',
        signature: validLowSSignature,
        issued_at: '2026-11-11T10:00:00Z',
        nonce: 'nonce-1234'
      }
    });

    const result = await adapter.processEdgeSale(command, async () => ({
      publicKeyJwk: testJwk,
      active: false,
      revoked: true
    }));

    // Invariant: must be quarantined
    assert.equal(result.kind, 'quarantined');
    assert.equal((result as any).reason, 'DEVICE_KEY_REVOKED');

    // Invariant: zero financial writes, zero stock deduction
    assert.equal(orders.length, 0);
    assert.equal(inventoryLedger.length, 0);

    // Invariant: immutable audit event recorded
    const quarantineAudit = auditLogs.find(a => a.action === 'DEVICE_KEY_REVOKED_QUARANTINE');
    assert.ok(quarantineAudit);
  });

  it('7. Malformed or high-S device signature: rejected before financial writes', async () => {
    const { db, orders, inventoryLedger } = createMockDb();
    const adapter = createEdgeCheckoutAdapter(db);

    const command = await makeCommand({
      device_signature: {
        algorithm: 'ECDSA-P256-SHA256',
        key_id: 'active-key-001',
        signature: highSSignature, // Non-canonical high-S signature
        issued_at: '2026-11-11T10:00:00Z',
        nonce: 'nonce-high-s'
      }
    });

    await assert.rejects(
      async () => await adapter.processEdgeSale(command, async () => ({
        publicKeyJwk: testJwk,
        active: true,
        revoked: false
      })),
      (err: any) => {
        assert.equal(err.code, 'HIGH_S_SIGNATURE_REJECTED');
        return true;
      }
    );

    // Invariant: zero orders or stock mutations
    assert.equal(orders.length, 0);
    assert.equal(inventoryLedger.length, 0);
  });

  it('8. Insufficient stock: rejects sale without partial order or inventory mutation', async () => {
    const { db, orders, inventoryLedger, products } = createMockDb();
    products[0].current_stock = 0; // Out of stock

    const adapter = createEdgeCheckoutAdapter(db);
    const command = await makeCommand();

    await assert.rejects(
      async () => await adapter.processEdgeSale(command),
      (err: any) => {
        assert.ok(err.message.includes('Insufficient stock'));
        return true;
      }
    );

    assert.equal(orders.length, 0);
    assert.equal(inventoryLedger.length, 0);
    assert.equal(products[0].current_stock, 0);
  });
});
