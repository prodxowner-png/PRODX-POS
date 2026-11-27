import assert from 'node:assert/strict';
import test from 'node:test';
import { getStoreDateCarrier, getStoreDateParts, getStoreDayBounds, storeWallTimeToUtc } from './storeTime';

test('store calendar date is derived from the configured timezone', () => {
  const instant = new Date('2026-11-20T16:30:00.000Z');
  assert.deepEqual([getStoreDateParts(instant, 'Asia/Bangkok').year, getStoreDateParts(instant, 'Asia/Bangkok').month, getStoreDateParts(instant, 'Asia/Bangkok').day], [2026, 11, 20]);
  const carrier = getStoreDateCarrier(instant, 'Asia/Bangkok');
  assert.deepEqual([carrier.getFullYear(), carrier.getMonth(), carrier.getDate()], [2026, 10, 20]);
});
test('store day bounds use store midnight and support non-hour UTC offsets', () => {
  const bounds = getStoreDayBounds(new Date(2026, 10, 20), 'Asia/Kathmandu');
  assert.equal(bounds.start.toISOString(), '2026-11-19T18:15:00.000Z');
  assert.equal(bounds.end.toISOString(), '2026-11-20T18:14:59.999Z');
});
test('wall-time conversion resolves valid daylight-saving times', () => {
  assert.equal(storeWallTimeToUtc({ year: 2026, month: 3, day: 8, hour: 1, minute: 30 }, 'America/New_York').toISOString(), '2026-03-08T06:30:00.000Z');
  assert.equal(storeWallTimeToUtc({ year: 2026, month: 3, day: 8, hour: 3, minute: 30 }, 'America/New_York').toISOString(), '2026-03-08T07:30:00.000Z');
});
