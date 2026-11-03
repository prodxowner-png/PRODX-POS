import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMoney,
  fromDecimal,
  parseDecimalToCents,
  parseDecimalToBps,
  centsToDecimalString,
  addMoney,
  subtractMoney,
  multiplyMoney,
  calculateBasisPoints,
  applyPercentageAdjustment,
  formatMoney,
} from './money';
import { calculateLineItem, computeCartTotals } from './order';
import { formatThaiBahtText } from './taxInvoice';
import type { Product } from './catalog';

const sampleProduct: Product = {
  id: 'prod-1',
  storeId: 'store-1',
  sku: 'SKU-1999',
  barcode: '8850000019991',
  name: 'Classic Espresso Beans',
  categoryId: 'cat-1',
  price: createMoney(1999, 'THB'),
  costPrice: createMoney(800, 'THB'),
  taxRateBps: 700,
  currentStock: 50,
  reorderPoint: 10,
  unitOfMeasure: 'bag',
};

test('parseDecimalToCents and fromDecimal eliminate IEEE-754 floating-point drift', () => {
  // In IEEE-754: 19.99 * 100 === 1998.9999999999998, 1.15 * 100 === 114.99999999999999
  assert.equal(parseDecimalToCents('19.99'), 1999);
  assert.equal(parseDecimalToCents('1.15'), 115);
  assert.equal(parseDecimalToCents('29.95'), 2995);
  assert.equal(parseDecimalToCents('1250.75'), 125075);
  assert.equal(fromDecimal('19.99', 'THB').amountInCents, 1999);
  assert.equal(parseDecimalToBps('7.55'), 755);
  assert.equal(centsToDecimalString(1999), '19.99');
  assert.equal(centsToDecimalString(5), '0.05');
  assert.equal(formatMoney(createMoney(125075, 'THB')), '฿1,250.75');
});

test('calculateLineItem and computeCartTotals preserve exact BigInt financial invariants', () => {
  const line1 = calculateLineItem(sampleProduct, 3, 500); // 3 * 1999 = 5997, 5% disc = 300, lineTotal = 5697
  assert.equal(line1.lineTotal.amountInCents, 5697);
  // Tax inclusive 7%: (5697 * 700 + 5350) / 10700 = 373
  assert.equal(line1.lineTax.amountInCents, 373);
  assert.equal(line1.lineSubtotal.amountInCents + line1.lineTax.amountInCents, line1.lineTotal.amountInCents);

  const totals = computeCartTotals([line1], 1000, 'THB'); // 10% order discount
  assert.equal(totals.grossSubtotal.amountInCents, 5997);
  assert.equal(totals.itemDiscounts.amountInCents, 300);
  assert.equal(totals.orderDiscount.amountInCents, 570);
  assert.equal(totals.grandTotal.amountInCents, 5127);
  assert.equal(
    totals.netSubtotal.amountInCents + totals.totalTax.amountInCents,
    totals.grandTotal.amountInCents,
    'netSubtotal + totalTax must equal grandTotal exactly',
  );
});

test('applyPercentageAdjustment and Thai Baht text conversion operate without floating-point errors', () => {
  const base = createMoney(10000, 'THB');
  const increased = applyPercentageAdjustment(base, 7.55, 'increase', 'exact_cents');
  assert.equal(increased.amountInCents, 10755);

  const decreased = applyPercentageAdjustment(base, 12.25, 'decrease', 'exact_cents');
  assert.equal(decreased.amountInCents, 8775);

  assert.equal(formatThaiBahtText(125075), 'หนึ่งพันสองร้อยห้าสิบบาทเจ็ดสิบห้าสตางค์');
  assert.equal(formatThaiBahtText(50000), 'ห้าร้อยบาทถ้วน');
});
