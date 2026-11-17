import crypto from 'node:crypto';
import type { SqlQueryExecutor, TransactionalSqlExecutor } from '../db/transaction';
import {
  createCheckoutService,
  CheckoutConflictError,
  CheckoutAuthorizationError,
  CheckoutValidationError
} from './checkout-service';
import type { CheckoutRequest, CheckoutResponse } from '../../src/adapters/types';
import type { CartLineItem, TenderPayment } from '../../src/domain/order';
import {
  canonicalize,
  sha256Hex,
  computeCanonicalPayloadHash,
  buildDeviceSignatureEnvelope,
  verifyDeviceSignature
} from '../../prodx-pos-edge-sync/src/canonical';
import type { QueueSale, OfflineSale } from '../../prodx-pos-edge-sync/src/contracts';

export interface EdgeCheckoutCommand {
  tenant_id: string;
  terminal_id: string;
  idempotency_key: string;
  payload_hash: string;
  sale: OfflineSale;
  edge_received_at: string;
  receipt_id: string;
}

export type EdgeCheckoutOutcome =
  | { kind: 'committed'; order: CheckoutResponse['order']; duplicate: boolean }
  | { kind: 'quarantined'; caseId: string; reason: string };

export class EdgeCheckoutAdapterError extends Error {
  constructor(readonly code: string, message?: string) {
    super(message ?? code);
  }
}

const dbCents = (v: unknown): bigint => {
  const m = /^(\d+)\.(\d{2})$/.exec(String(v));
  if (!m) throw new CheckoutValidationError('Database monetary value is invalid.');
  return BigInt(m[1]) * 100n + BigInt(m[2]);
};

export const createEdgeCheckoutAdapter = (db: TransactionalSqlExecutor) => {
  const checkoutService = createCheckoutService(db);

  return {
    async processEdgeSale(
      command: EdgeCheckoutCommand,
      deviceKeyResolver?: (keyId: string, tenantId: string, terminalId: string) => Promise<{
        publicKeyJwk?: JsonWebKey;
        active: boolean;
        revoked: boolean;
      } | null>
    ): Promise<EdgeCheckoutOutcome> {
      // 1. Envelope and idempotency assertions
      if (!command.idempotency_key || !command.sale || !command.sale.idempotency_key) {
        throw new EdgeCheckoutAdapterError('IDEMPOTENCY_KEY_MISSING');
      }
      if (command.idempotency_key !== command.sale.idempotency_key) {
        throw new EdgeCheckoutAdapterError('IDEMPOTENCY_KEY_ENVELOPE_MISMATCH');
      }

      // 2. Canonical tenant-bound payload hash verification (FIND-02 origin check)
      const computedHash = await computeCanonicalPayloadHash(
        command.tenant_id,
        command.terminal_id,
        command.sale
      );

      if (computedHash !== command.payload_hash || command.sale.payload_hash !== command.payload_hash) {
        throw new EdgeCheckoutAdapterError('PAYLOAD_HASH_MISMATCH_AT_ORIGIN');
      }

      // 3. Asymmetric device signature & Quarantine disposition policy (PR #376 / RFC #359)
      if (command.sale.device_signature) {
        const sig = command.sale.device_signature;
        let keyInfo = deviceKeyResolver
          ? await deviceKeyResolver(sig.key_id, command.tenant_id, command.terminal_id)
          : null;

        if (!keyInfo) {
          // Check database prodx_devices for key status
          const deviceRow = (await db.query<{ id: string; status: string; revoked_at: string | null }>(
            `SELECT id, status, revoked_at FROM prodx_devices WHERE organization_id = $1 AND (device_key = $2 OR id = $3) LIMIT 1`,
            [command.tenant_id, sig.key_id, command.terminal_id]
          )).rows[0];

          if (deviceRow) {
            keyInfo = {
              active: deviceRow.status === 'active',
              revoked: deviceRow.revoked_at !== null || deviceRow.status === 'disabled'
            };
          }
        }

        // Owner-approved policy: Revoked key upload routes to Quarantine without financial writes
        if (keyInfo?.revoked) {
          const caseId = crypto.randomUUID();
          await db.transaction(async (tx) => {
            await tx.query(
              `INSERT INTO prodx_audit_log (id, organization_id, store_id, register_id, user_id, action, severity, details)
               VALUES ($1, $2, $3, $4, $5, 'DEVICE_KEY_REVOKED_QUARANTINE', 'warn', $6::jsonb)`,
              [
                caseId,
                command.tenant_id,
                command.tenant_id,
                command.terminal_id,
                command.terminal_id,
                JSON.stringify({
                  quarantineCaseId: caseId,
                  tenantId: command.tenant_id,
                  terminalId: command.terminal_id,
                  saleId: command.sale.sale_id,
                  keyId: sig.key_id,
                  payloadHash: command.payload_hash,
                  reason: 'DEVICE_KEY_REVOKED',
                  clientRecordedAt: command.sale.client_recorded_at,
                  edgeReceivedAt: command.edge_received_at
                })
              ]
            );
          });
          return { kind: 'quarantined', caseId, reason: 'DEVICE_KEY_REVOKED' };
        }

        // Verify cryptographic signature if public key is available
        if (keyInfo?.publicKeyJwk) {
          const envelope = buildDeviceSignatureEnvelope({
            key_id: sig.key_id,
            tenant_id: command.tenant_id,
            terminal_id: command.terminal_id,
            sale_id: command.sale.sale_id,
            terminal_seq_no: command.sale.terminal_seq_no,
            payload_hash: command.payload_hash,
            issued_at: sig.issued_at,
            nonce: sig.nonce
          });
          const sigVerification = await verifyDeviceSignature(envelope, sig.signature, keyInfo.publicKeyJwk);
          if (!sigVerification.valid) {
            throw new EdgeCheckoutAdapterError(
              sigVerification.reason ?? 'DEVICE_SIGNATURE_INVALID'
            );
          }
        }
      }

      // 4. Resolve Store, Register and Shift within tenant
      const store = (await db.query<{ id: string; organization_id: string; currency: string }>(
        `SELECT id, organization_id, currency FROM prodx_stores WHERE organization_id = $1 OR id = $1 LIMIT 1`,
        [command.tenant_id]
      )).rows[0];

      if (!store) {
        throw new EdgeCheckoutAdapterError('TENANT_STORE_NOT_FOUND');
      }

      const register = (await db.query<{ id: string }>(
        `SELECT id FROM prodx_registers WHERE store_id = $1 AND (id = $2 OR status = 'active') LIMIT 1`,
        [store.id, command.terminal_id]
      )).rows[0];

      if (!register) {
        throw new EdgeCheckoutAdapterError('REGISTER_NOT_FOUND');
      }

      const shift = (await db.query<{ id: string; cashier_id: string }>(
        `SELECT id, cashier_id FROM prodx_shifts WHERE store_id = $1 AND register_id = $2 AND status = 'open' LIMIT 1`,
        [store.id, register.id]
      )).rows[0];

      if (!shift) {
        throw new EdgeCheckoutAdapterError('ACTIVE_SHIFT_NOT_FOUND');
      }

      // 5. Look up products and calculate exact amounts
      const productIds = command.sale.lines.map((l) => l.product_id);
      const uniqueSortedIds = [...new Set(productIds)].sort();
      const productRows = (await db.query<{
        id: string;
        store_id: string;
        sku: string;
        name: string;
        price_amount: string;
        tax_rate_bps: number;
        current_stock: number;
        currency: string;
      }>(
        `SELECT id, store_id, sku, name, price_amount::text, tax_rate_bps, current_stock, currency
           FROM prodx_products
          WHERE store_id = $1 AND id = ANY($2::uuid[]) AND active = true
          ORDER BY id`,
        [store.id, uniqueSortedIds]
      )).rows;

      if (productRows.length !== uniqueSortedIds.length) {
        throw new EdgeCheckoutAdapterError('PRODUCT_NOT_AVAILABLE_IN_STORE');
      }

      let gross = 0n;
      let net = 0n;
      let tax = 0n;
      let totalItemsCount = 0;

      const cartItems: CartLineItem[] = [];

      for (const line of command.sale.lines) {
        const p = productRows.find((row) => row.id === line.product_id)!;
        const unitMinor = BigInt(line.unit_price_minor);
        const raw = unitMinor * BigInt(line.quantity);
        const taxRate = BigInt(p.tax_rate_bps);
        const lt = taxRate > 0n
          ? (raw * taxRate + (10000n + taxRate) / 2n) / (10000n + taxRate)
          : 0n;

        gross += raw;
        net += (raw - lt);
        tax += lt;
        totalItemsCount += line.quantity;

        const lineIdx = cartItems.length;
        const lineSeed = `${command.idempotency_key}:line:${lineIdx}:${line.product_id}`;
        const lineH = crypto.createHash('sha256').update(lineSeed).digest('hex');
        const deterministicLineId = `${lineH.slice(0, 8)}-${lineH.slice(8, 12)}-4${lineH.slice(13, 16)}-8${lineH.slice(17, 20)}-${lineH.slice(20, 32)}`;

        cartItems.push({
          lineId: deterministicLineId,
          product: {
            id: p.id,
            storeId: store.id,
            sku: p.sku,
            barcode: p.sku,
            name: p.name,
            categoryId: 'cat-default',
            price: { amountInCents: Number(unitMinor), currency: command.sale.currency },
            costPrice: { amountInCents: 0, currency: command.sale.currency },
            taxRateBps: p.tax_rate_bps,
            currentStock: p.current_stock,
            reorderPoint: 0,
            unitOfMeasure: 'unit'
          },
          quantity: line.quantity,
          unitPrice: { amountInCents: Number(unitMinor), currency: command.sale.currency },
          discountBps: 0,
          lineSubtotal: { amountInCents: Number(raw - lt), currency: command.sale.currency },
          lineTax: { amountInCents: Number(lt), currency: command.sale.currency },
          lineTotal: { amountInCents: Number(raw), currency: command.sale.currency }
        });
      }

      const grandTotal = gross;
      const currency = command.sale.currency;

      function deterministicUuid(seed: string): string {
        const h = crypto.createHash('sha256').update(seed).digest('hex');
        return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
      }

      const payments: TenderPayment[] = (command.sale.payments && command.sale.payments.length > 0)
        ? command.sale.payments.map((p, idx) => ({
            id: p.id || deterministicUuid(`${command.idempotency_key}:payment:${idx}`),
            method: (p.method === 'qr' ? 'qr_digital' : p.method) as TenderPayment['method'],
            amount: { amountInCents: p.amount_minor, currency },
            tenderedCash: p.tendered_cash_minor != null ? { amountInCents: p.tendered_cash_minor, currency } : undefined,
            changeGiven: p.change_given_minor != null ? { amountInCents: p.change_given_minor, currency } : undefined,
            authCode: p.auth_code,
            cardLastFour: p.card_last_four,
            terminalReference: p.terminal_reference,
            timestamp: command.sale.client_recorded_at
          }))
        : [{
            id: deterministicUuid(`${command.idempotency_key}:payment:0`),
            method: 'cash' as TenderPayment['method'],
            amount: { amountInCents: Number(grandTotal), currency },
            tenderedCash: { amountInCents: Number(grandTotal), currency },
            changeGiven: { amountInCents: 0, currency },
            timestamp: command.sale.client_recorded_at
          }];

      // 6. Build CheckoutRequest
      const checkoutRequest: CheckoutRequest = {
        idempotencyKey: command.idempotency_key,
        storeId: store.id,
        registerId: register.id,
        cashierId: shift.cashier_id,
        items: cartItems,
        totals: {
          grossSubtotal: { amountInCents: Number(gross), currency },
          itemDiscounts: { amountInCents: 0, currency },
          orderDiscount: { amountInCents: 0, currency },
          netSubtotal: { amountInCents: Number(net), currency },
          totalTax: { amountInCents: Number(tax), currency },
          grandTotal: { amountInCents: Number(grandTotal), currency },
          totalItemsCount
        },
        orderDiscountBps: 0,
        payments,
        isOfflineSubmission: true
      };

      // 7. Invoke server-authoritative CheckoutService
      const checkoutResponse = await checkoutService.checkout(checkoutRequest, {
        organizationId: store.organization_id,
        storeId: store.id,
        userId: shift.cashier_id,
        sessionId: 'edge-sync-session'
      });

      return {
        kind: 'committed',
        order: checkoutResponse.order,
        duplicate: checkoutResponse.idempotencyCached ?? false
      };
    }
  };
};
