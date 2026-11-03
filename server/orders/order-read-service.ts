import type { SqlQueryExecutor } from '../db/transaction';
import type { Order } from '../../src/domain/order';

type OrderRow = Record<string, any>;

const money = (value: unknown, currency: string) => {
  const text = String(value).trim();
  const match = text.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('Invalid monetary value returned by database.');
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('Monetary value exceeds safe client representation.');
  return { amountInCents: cents, currency };
};

const toOrder = (row: OrderRow, items: OrderRow[], payments: OrderRow[]): Order => ({
  id: row.id,
  orderNumber: row.order_number,
  idempotencyKey: row.idempotency_key,
  storeId: row.store_id,
  registerId: row.register_id,
  cashierId: row.cashier_id,
  cashierName: row.cashier_name ?? '',
  items: items.map((item) => ({
    lineId: item.id,
    product: {
      id: item.product_id,
      storeId: row.store_id,
      sku: item.sku,
      barcode: item.barcode,
      name: item.name,
      categoryId: item.category_id,
      price: money(item.product_price_amount, item.currency),
      costPrice: money(item.cost_price_amount, item.currency),
      taxRateBps: item.tax_rate_bps,
      currentStock: item.current_stock,
      reorderPoint: item.reorder_point,
      unitOfMeasure: item.unit_of_measure,
    },
    quantity: item.quantity,
    unitPrice: money(item.unit_price_amount, item.currency),
    discountBps: item.item_discount_bps,
    lineSubtotal: money(item.line_subtotal_amount, item.currency),
    lineTax: money(item.line_tax_amount, item.currency),
    lineTotal: money(item.line_total_amount, item.currency),
  })),
  totals: {
    grossSubtotal: money(row.gross_subtotal_amount, row.currency),
    itemDiscounts: money(row.item_discounts_amount, row.currency),
    orderDiscount: money(row.order_discount_amount, row.currency),
    netSubtotal: money(row.net_subtotal_amount, row.currency),
    totalTax: money(row.total_tax_amount, row.currency),
    grandTotal: money(row.grand_total_amount, row.currency),
    totalItemsCount: row.total_items_count,
  },
  payments: payments.map((payment) => ({
    id: payment.id,
    method: payment.method,
    amount: money(payment.amount, payment.currency),
    tenderedCash: payment.tendered_cash === null ? undefined : money(payment.tendered_cash, payment.currency),
    changeGiven: payment.change_given === null ? undefined : money(payment.change_given, payment.currency),
    authCode: payment.auth_code ?? undefined,
    cardLastFour: payment.card_last_four ?? undefined,
    terminalReference: payment.terminal_reference ?? undefined,
    timestamp: new Date(payment.created_at).toISOString(),
  })),
  status: row.status,
  serverCommittedAt: new Date(row.server_committed_at).toISOString(),
  createdAt: new Date(row.created_at).toISOString(),
  notes: row.notes ?? undefined,
});

export const createOrderReadService = (db: SqlQueryExecutor) => ({
  async getOrders(
    organizationId: string,
    storeId: string,
    limit = 50,
    registerId?: string,
  ): Promise<readonly Order[]> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 200);
    const conditions = ['o.organization_id = $1', 'o.store_id = $2'];
    const params: (string | number)[] = [organizationId, storeId];

    if (registerId && registerId.trim()) {
      params.push(registerId.trim());
      conditions.push(`o.register_id = $${params.length}`);
    }

    params.push(safeLimit);
    const limitPlaceholder = `$${params.length}`;

    const orders = (
      await db.query<OrderRow>(
        `SELECT o.*, u.display_name AS cashier_name
         FROM prodx_orders o
         JOIN prodx_users u ON u.id = o.cashier_id AND u.organization_id = o.organization_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY o.created_at DESC, o.id DESC
         LIMIT ${limitPlaceholder}`,
        params,
      )
    ).rows;

    if (orders.length === 0) return [];
    const ids = orders.map((o) => o.id);

    const itemRows = (
      await db.query<OrderRow>(
        `SELECT oi.*, p.sku, p.barcode, p.name, p.category_id, p.price_amount::text AS product_price_amount,
                p.cost_price_amount::text, p.tax_rate_bps, p.current_stock, p.reorder_point, p.unit_of_measure
         FROM prodx_order_items oi
         JOIN prodx_products p ON p.id = oi.product_id AND p.store_id = oi.store_id
         WHERE oi.organization_id = $1 AND oi.store_id = $2 AND oi.order_id = ANY($3::uuid[])
         ORDER BY oi.order_id, oi.id`,
        [organizationId, storeId, ids],
      )
    ).rows;

    const paymentRows = (
      await db.query<OrderRow>(
        `SELECT id, order_id, method, amount::text, tendered_cash::text, change_given::text, auth_code,
                card_last_four, terminal_reference, currency, created_at
         FROM prodx_payments
         WHERE organization_id = $1 AND store_id = $2 AND order_id = ANY($3::uuid[])
         ORDER BY order_id, created_at, id`,
        [organizationId, storeId, ids],
      )
    ).rows;

    const itemsByOrder = new Map<string, OrderRow[]>();
    for (const item of itemRows) {
      const list = itemsByOrder.get(item.order_id) ?? [];
      list.push(item);
      itemsByOrder.set(item.order_id, list);
    }

    const paymentsByOrder = new Map<string, OrderRow[]>();
    for (const payment of paymentRows) {
      const list = paymentsByOrder.get(payment.order_id) ?? [];
      list.push(payment);
      paymentsByOrder.set(payment.order_id, list);
    }

    return orders.map((order) =>
      toOrder(order, itemsByOrder.get(order.id) ?? [], paymentsByOrder.get(order.id) ?? []),
    );
  },
});
