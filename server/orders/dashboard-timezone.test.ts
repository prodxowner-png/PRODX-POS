import assert from 'node:assert/strict';
import test from 'node:test';
import { getStoreDateParts, getStoreDayBounds, storeWallTimeToUtc } from '../../src/modules/dashboard/utils/storeTime';
import { calculateMonthOverMonthMetrics } from '../../src/modules/dashboard/utils/momAnalytics';
import type { Order } from '../../src/domain/order';

test('store date parts and day boundaries follow the store timezone', () => {
  const instant = new Date('2026-11-20T16:30:00.000Z');
  const parts = getStoreDateParts(instant, 'Asia/Bangkok');
  assert.deepEqual([parts.year, parts.month, parts.day], [2026, 11, 20]);
  const bounds = getStoreDayBounds(new Date(2026, 10, 20), 'Asia/Kathmandu');
  assert.equal(bounds.start.toISOString(), '2026-11-19T18:15:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-11-20T18:14:59.999Z');
});

test('store wall time conversion handles daylight-saving offsets', () => {
  assert.equal(storeWallTimeToUtc({ year: 2026, month: 3, day: 8, hour: 1, minute: 30 }, 'America/New_York').toISOString(), '2026-03-08T06:30:00.000Z');
  assert.equal(storeWallTimeToUtc({ year: 2026, month: 3, day: 8, hour: 3, minute: 30 }, 'America/New_York').toISOString(), '2026-03-08T07:30:00.000Z');
});

test('MoM attributes orders to the store calendar month, not the browser calendar month', () => {
  const order = {
    id: 'timezone-order',
    storeId: 'store-1',
    status: 'server_confirmed',
    createdAt: '2026-11-30T18:00:00.000Z',
    totals: { grandTotal: { amountInCents: 1234, currency: 'THB' } },
    refundedAmount: { amountInCents: 0, currency: 'THB' },
  } as unknown as Order;
  const result = calculateMonthOverMonthMetrics(
    [order],
    'store-1',
    'en',
    'actual',
    new Date('2026-12-01T01:00:00.000Z'),
    'Asia/Bangkok',
  );
  assert.equal(result.metrics.currentMonthOrders, 1);
  assert.equal(result.metrics.currentMonthSales, 12.34);
  assert.equal(result.metrics.priorMonthOrders, 0);
});
