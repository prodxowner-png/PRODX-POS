import test from 'node:test';
import assert from 'node:assert/strict';
import type { Order } from '../src/domain/order';
import { calculateMonthOverMonthMetrics } from '../src/modules/dashboard/utils/momAnalytics';

const NOW = new Date(2026, 10, 20, 12, 0, 0);

function order(input: {
  id: string;
  storeId?: string;
  status?: string;
  date: Date;
  cents: number;
  refundedCents?: number;
}): Order {
  return {
    id: input.id,
    storeId: input.storeId ?? 'store-a',
    status: input.status ?? 'server_confirmed',
    createdAt: input.date.toISOString(),
    totals: { grandTotal: { amountInCents: input.cents } },
    refundedAmount: { amountInCents: input.refundedCents ?? 0, currency: 'THB' },
  } as unknown as Order;
}

test('MoM actual totals include only server-confirmed orders for the selected store', () => {
  const result = calculateMonthOverMonthMetrics([
    order({ id: 'current-confirmed', date: new Date(2026, 10, 5, 12), cents: 10000 }),
    order({ id: 'current-offline', status: 'pending_sync_offline', date: new Date(2026, 10, 5, 13), cents: 90000 }),
    order({ id: 'other-store', storeId: 'store-b', date: new Date(2026, 10, 5, 14), cents: 50000 }),
    order({ id: 'prior-confirmed', date: new Date(2026, 9, 5, 12), cents: 8000 }),
  ], 'store-a', 'en', 'actual', NOW);

  assert.equal(result.metrics.currentMonthSales, 100);
  assert.equal(result.metrics.priorMonthSales, 80);
  assert.equal(result.metrics.currentMonthOrders, 1);
  assert.equal(result.metrics.priorMonthOrders, 1);
  assert.equal(result.metrics.hasComparablePriorPeriod, true);
  assert.equal(result.trendData.find((point) => point.day === 5)?.currentCumulative, 100);
});

test('MoM does not fabricate baseline sales or orders when verified data is absent', () => {
  const result = calculateMonthOverMonthMetrics([], 'store-a', 'en', 'actual', NOW);

  assert.equal(result.metrics.currentMonthSales, 0);
  assert.equal(result.metrics.priorMonthSales, 0);
  assert.equal(result.metrics.currentMonthOrders, 0);
  assert.equal(result.metrics.hasCurrentPeriodData, false);
  assert.equal(result.metrics.hasComparablePriorPeriod, false);
  assert.equal(result.metrics.paceStatus, 'insufficient_data');
  assert.ok(result.trendData.every((point) => point.currentMonthSales === 0));
});

test('MoM actual sales are not double-counted in the cumulative trend', () => {
  const result = calculateMonthOverMonthMetrics([
    order({ id: 'current-one', date: new Date(2026, 10, 2, 12), cents: 12500 }),
    order({ id: 'current-two', date: new Date(2026, 10, 3, 12), cents: 7500 }),
    order({ id: 'prior-one', date: new Date(2026, 9, 2, 12), cents: 10000 }),
  ], 'store-a', 'en', 'actual', NOW);

  assert.equal(result.metrics.currentMonthSales, 200);
  assert.equal(result.trendData.at(-1)?.currentCumulative, 200);
});

test('MoM growth scenario is explicitly marked as simulated and uses verified prior data', () => {
  const result = calculateMonthOverMonthMetrics([
    order({ id: 'prior-one', date: new Date(2026, 9, 2, 12), cents: 10000 }),
    order({ id: 'prior-two', date: new Date(2026, 9, 3, 12), cents: 10000 }),
  ], 'store-a', 'en', 'growth', NOW);

  assert.equal(result.metrics.isSimulation, true);
  assert.equal(result.metrics.currentMonthSales, 229.2);
  assert.ok(result.trendData.some((point) => point.isProjected));
  assert.match(result.metrics.insights[0].title.en, /scenario/i);
});


test('MoM subtracts immutable partial refunds from server-confirmed sales', () => {
  const result = calculateMonthOverMonthMetrics([
    order({ id: 'current-partial-refund', date: new Date(2026, 10, 5, 12), cents: 10000, refundedCents: 2500 }),
    order({ id: 'prior-confirmed', date: new Date(2026, 9, 5, 12), cents: 8000 }),
  ], 'store-a', 'en', 'actual', NOW);

  assert.equal(result.metrics.currentMonthSales, 75);
  assert.equal(result.metrics.priorMonthSales, 80);
  assert.equal(result.trendData.find((point) => point.day === 5)?.currentCumulative, 75);
});
