/**
 * PRODX POS - Full Tax Invoice Domain & Thai Revenue Department Standard
 * 
 * Compliant with Thai Revenue Department (กรมสรรพากร) requirements for
 * Full Tax Invoices / Receipts (ใบกำกับภาษีเต็มรูป / ใบเสร็จรับเงิน).
 */

import { Money, createMoney, formatMoney } from './money';
import { Order } from './order';
import { Store } from './auth';

export type BranchType = 'head_office' | 'branch';

export interface TaxInvoiceBuyer {
  name: string; // Company or individual name
  taxId: string; // 13-digit Thai Tax ID
  branchType: BranchType;
  branchNumber?: string; // e.g. '00001'
  address: string;
  phone?: string;
  email?: string;
}

export interface FullTaxInvoice {
  invoiceNumber: string; // e.g. TAX-20260903-0001
  referenceOrderNumber: string;
  issueDate: string; // ISO 8601
  seller: {
    companyName: string;
    taxId: string;
    branchType: BranchType;
    branchNumber?: string;
    address: string;
    phone: string;
  };
  buyer: TaxInvoiceBuyer;
  items: readonly {
    lineNumber: number;
    description: string;
    sku: string;
    quantity: number;
    unitPrice: Money;
    discount: Money;
    amount: Money;
  }[];
  totals: {
    grossSubtotal: Money;
    discountTotal: Money;
    taxableBase: Money; // มูลค่าที่คิดภาษีมูลค่าเพิ่ม (Pre-tax taxable base)
    taxAmount: Money; // ภาษีมูลค่าเพิ่ม 7%
    exemptAmount: Money; // มูลค่ายกเว้นภาษี
    grandTotal: Money; // รวมทั้งสิ้น
  };
  bahtText: string; // Thai monetary text e.g. "หนึ่งพันสองร้อยห้าสิบบาทถ้วน"
  cashierName: string;
  notes?: string;
}

/**
 * Validates a 13-digit Thai Citizen ID or Tax Identification Number checksum.
 */
export function validateThaiTaxId(taxId: string): boolean {
  const cleaned = taxId.replace(/\D/g, '');
  if (cleaned.length !== 13) return false;

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(cleaned[i], 10) * (13 - i);
  }
  const checkDigit = (11 - (sum % 11)) % 10;
  return checkDigit === parseInt(cleaned[12], 10);
}

const THAI_DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const THAI_UNITS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

/**
 * Converts integer number into Thai words.
 */
function convertIntegerToThaiText(num: number): string {
  if (num === 0) return THAI_DIGITS[0];

  let str = num.toString();
  let result = '';
  const len = str.length;

  for (let i = 0; i < len; i++) {
    const digit = parseInt(str[i], 10);
    const pos = len - i - 1;
    const unitPos = pos % 6;

    if (digit !== 0) {
      if (unitPos === 1 && digit === 1 && len > 1) {
        // "สิบ" instead of "หนึ่งสิบ"
        result += 'สิบ';
      } else if (unitPos === 1 && digit === 2) {
        // "ยี่สิบ"
        result += 'ยี่สิบ';
      } else if (unitPos === 0 && digit === 1 && len > 1 && str[i - 1] !== '0') {
        // "เอ็ด"
        result += 'เอ็ด';
      } else {
        result += THAI_DIGITS[digit] + (unitPos > 0 ? THAI_UNITS[unitPos] : '');
      }
    }

    if (pos > 0 && pos % 6 === 0) {
      result += 'ล้าน';
    }
  }

  return result;
}

/**
 * Converts monetary amount into official Thai Baht text format.
 * e.g. 1,250.75 -> "หนึ่งพันสองร้อยห้าสิบบาทเจ็ดสิบห้าสตางค์"
 * e.g. 500.00 -> "ห้าร้อยบาทถ้วน"
 */
export function formatThaiBahtText(cents: number): string {
  if (cents === 0) return 'ศูนย์บาทถ้วน';

  const isNegative = cents < 0;
  const absCents = BigInt(Math.trunc(Math.abs(cents)));
  const baht = Number(absCents / 100n);
  const satang = Number(absCents % 100n);

  let text = isNegative ? 'ลบ' : '';

  if (baht > 0) {
    text += convertIntegerToThaiText(baht) + 'บาท';
  }

  if (satang > 0) {
    text += convertIntegerToThaiText(satang) + 'สตางค์';
  } else {
    text += 'ถ้วน';
  }

  return text;
}

/**
 * Builds a FullTaxInvoice model from an Order and Store details.
 */
export function generateFullTaxInvoice(
  order: Order,
  store: Store,
  buyer: TaxInvoiceBuyer,
  customInvoiceNo?: string
): FullTaxInvoice {
  const dateStr = new Date().toISOString();
  const invoiceNumber =
    customInvoiceNo ||
    `TAX-${dateStr.slice(0, 10).replace(/-/g, '')}-${order.orderNumber.slice(-4)}`;

  const items = order.items.map((it, idx) => ({
    lineNumber: idx + 1,
    description: it.product.name,
    sku: it.product.sku,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    discount: createMoney(
      Number((BigInt(it.unitPrice.amountInCents) * BigInt(it.quantity) * BigInt(it.discountBps) + 5000n) / 10000n),
      it.unitPrice.currency
    ),
    amount: it.lineTotal,
  }));

  const taxableBaseCents = order.totals.netSubtotal.amountInCents;
  const taxAmountCents = order.totals.totalTax.amountInCents;
  const grandTotalCents = order.totals.grandTotal.amountInCents;
  const currency = order.totals.grandTotal.currency;

  return {
    invoiceNumber,
    referenceOrderNumber: order.orderNumber,
    issueDate: dateStr,
    seller: {
      companyName: store.name + ' (PRODX RETAIL CO., LTD.)',
      taxId: '0105565019842', // Standard 13-digit Thai Tax ID
      branchType: 'head_office',
      address: store.address,
      phone: store.phone,
    },
    buyer,
    items,
    totals: {
      grossSubtotal: order.totals.grossSubtotal,
      discountTotal: createMoney(
        order.totals.itemDiscounts.amountInCents + order.totals.orderDiscount.amountInCents,
        currency
      ),
      taxableBase: createMoney(taxableBaseCents, currency),
      taxAmount: createMoney(taxAmountCents, currency),
      exemptAmount: createMoney(0, currency),
      grandTotal: order.totals.grandTotal,
    },
    bahtText: formatThaiBahtText(grandTotalCents),
    cashierName: order.cashierName || 'Cashier',
  };
}
