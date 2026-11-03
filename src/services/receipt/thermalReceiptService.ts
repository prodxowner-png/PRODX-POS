/**
 * PRODX POS - Thermal Receipt Formatting & Hardware Transmission Service
 * 
 * Formats order transaction data into customizable thermal receipts, generates
 * binary ESC/POS command streams, and handles multi-channel printer transmission
 * (System Print, WebUSB, WebSerial, Bluetooth, and TCP/Raw Network).
 */

import { Order, CartLineItem } from '../../domain/order';
import { formatMoney } from '../../domain/money';
import { ReceiptTemplate, ReceiptPaperWidth, PrinterConnectionType } from '../../domain/receipt';
import { EscPosBuilder } from './escposBuilder';

export interface FormattedReceiptResult {
  readonly text: string;
  readonly escposBytes: Uint8Array;
  readonly hexDump: string;
  readonly html: string;
}

export class ThermalReceiptService {
  /**
   * Formats an order with the designated receipt template into text, ESC/POS bytes, and HTML.
   */
  public static formatReceipt(order: Order, template: ReceiptTemplate): FormattedReceiptResult {
    const text = this.formatAsText(order, template);
    const escposBytes = this.formatAsEscPos(order, template);
    const hexDump = this.bytesToHex(escposBytes);
    const html = this.formatAsHtml(order, template);

    return {
      text,
      escposBytes,
      hexDump,
      html,
    };
  }

  /**
   * Generates formatted monospace text layout conforming to paper character width (32 for 58mm, 48 for 80mm)
   */
  public static formatAsText(order: Order, template: ReceiptTemplate): string {
    const cols = template.characterColumns || (template.paperWidth === '58mm' ? 32 : 48);
    const divChar = template.layout.dividerStyle || '=';
    const lines: string[] = [];

    const padCenter = (str: string) => {
      if (str.length >= cols) return str.slice(0, cols);
      const totalPad = cols - str.length;
      const leftPad = Math.floor(totalPad / 2);
      return ' '.repeat(leftPad) + str;
    };

    const twoCols = (left: string, right: string) => {
      const available = cols - right.length;
      if (left.length > available - 1) {
        left = left.slice(0, Math.max(0, available - 2)) + ' ';
      }
      const spaces = Math.max(1, cols - left.length - right.length);
      return left + ' '.repeat(spaces) + right;
    };

    const divider = (char = divChar) => char.repeat(cols);

    // 1. Header & Store Branding
    if (template.layout.showStoreHeader && template.branding.storeName) {
      lines.push(padCenter(template.branding.storeName.toUpperCase()));
    }
    if (template.layout.showBranchName && template.branding.branchName) {
      lines.push(padCenter(template.branding.branchName));
    }
    if (template.layout.showTagline && template.branding.tagline) {
      lines.push(padCenter(template.branding.tagline));
    }
    if (template.layout.showTaxId && template.branding.taxId) {
      lines.push(padCenter(template.branding.taxId));
    }
    if (template.layout.showAddress) {
      if (template.branding.addressLine1) lines.push(padCenter(template.branding.addressLine1));
      if (template.branding.addressLine2) lines.push(padCenter(template.branding.addressLine2));
    }
    if (template.layout.showContactInfo) {
      if (template.branding.phone) lines.push(padCenter(template.branding.phone));
      if (template.branding.email) lines.push(padCenter(template.branding.email));
      if (template.branding.website) lines.push(padCenter(template.branding.website));
    }

    lines.push(divider());

    // 2. Transaction Metadata
    lines.push(twoCols(`TICKET #${order.orderNumber}`, order.status.toUpperCase()));
    if (template.layout.showOrderTimestamp) {
      const dateStr = new Date(order.createdAt).toLocaleString();
      lines.push(twoCols('Date/Time:', dateStr));
    }
    if (template.layout.showRegisterId) {
      lines.push(twoCols('Register:', order.registerId));
    }
    if (template.layout.showCashierName) {
      lines.push(twoCols('Cashier:', order.cashierName || order.cashierId));
    }
    if (template.layout.showCustomerInfo && order.customer) {
      lines.push(twoCols('Customer:', order.customer.name));
      if (template.layout.showLoyaltyPoints && order.customer.loyaltyPoints !== undefined) {
        lines.push(twoCols('Loyalty Pts:', `${order.customer.loyaltyPoints} pts (${order.customer.loyaltyTier})`));
      }
    }

    lines.push(divider('-'));

    // 3. Line Items Table Header
    if (cols === 32) {
      lines.push(twoCols('ITEM / QTY', 'AMOUNT'));
    } else {
      lines.push(twoCols('ITEM DESCRIPTION', 'QTY   PRICE   TOTAL'));
    }
    lines.push(divider('-'));

    // 4. Line Items Rows
    for (const item of order.items) {
      const unitStr = formatMoney(item.unitPrice);
      const totalStr = formatMoney(item.lineTotal);

      if (cols === 32) {
        lines.push(twoCols(`${item.quantity}x ${item.product.name}`, totalStr));
        if (template.layout.showItemUnitPrice && item.quantity > 1) {
          lines.push(`  @ ${unitStr}`);
        }
        if (template.layout.showItemSku && item.product.sku) {
          lines.push(`  SKU: ${item.product.sku}`);
        }
        if (template.layout.showItemDiscounts && item.discountBps > 0) {
          lines.push(`  Disc: -${(item.discountBps / 100).toFixed(0)}%`);
        }
      } else {
        const itemHeader = `${item.product.name}`;
        const itemStats = `${item.quantity}  ${unitStr}  ${totalStr}`;
        lines.push(twoCols(itemHeader, itemStats));
        if (template.layout.showItemSku && item.product.sku) {
          lines.push(`  [SKU: ${item.product.sku}]`);
        }
        if (template.layout.showItemDiscounts && item.discountBps > 0) {
          lines.push(`  [Discount: -${(item.discountBps / 100).toFixed(0)}%]`);
        }
      }
    }

    lines.push(divider('-'));

    // 5. Totals & Tax Summary
    lines.push(twoCols('Gross Subtotal:', formatMoney(order.totals.grossSubtotal)));
    if (order.totals.itemDiscounts.amountInCents > 0 || order.totals.orderDiscount.amountInCents > 0) {
      const totalDisc = order.totals.itemDiscounts.amountInCents + order.totals.orderDiscount.amountInCents;
      lines.push(twoCols('Total Savings:', `-${formatMoney({ ...order.totals.grossSubtotal, amountInCents: totalDisc })}`));
    }
    lines.push(twoCols('Net Subtotal:', formatMoney(order.totals.netSubtotal)));

    if (template.layout.showTaxBreakdown) {
      lines.push(twoCols('Tax (VAT 7% / Sales):', formatMoney(order.totals.totalTax)));
    }

    lines.push(divider(divChar));
    lines.push(twoCols('TOTAL DUE:', formatMoney(order.totals.grandTotal)));
    lines.push(divider(divChar));

    // 6. Payment & Change Summary
    if (template.layout.showPaymentBreakdown && order.payments.length > 0) {
      for (const p of order.payments) {
        const methodTitle = p.method.toUpperCase().replace('_', ' ');
        lines.push(twoCols(`PAID (${methodTitle}):`, formatMoney(p.amount)));
        if (p.tenderedCash && template.layout.showChangeGiven) {
          lines.push(twoCols('Cash Tendered:', formatMoney(p.tenderedCash)));
        }
        if (p.changeGiven && template.layout.showChangeGiven) {
          lines.push(twoCols('CHANGE RETURNED:', formatMoney(p.changeGiven)));
        }
        if (p.cardLastFour) {
          lines.push(twoCols('Card Number:', `**** **** **** ${p.cardLastFour}`));
        }
        if (p.authCode) {
          lines.push(twoCols('Auth Code:', p.authCode));
        }
      }
    }

    // 7. Barcode / QR Code Notice
    if (template.layout.showBarcode || template.layout.showQrCode) {
      lines.push(divider('-'));
      if (template.layout.showBarcode) {
        lines.push(padCenter(`* ${order.orderNumber} *`));
      }
      if (template.layout.showQrCode) {
        const qrUrl = `${template.layout.qrCodeUrlPrefix}${order.orderNumber}`;
        lines.push(padCenter('[ E-RECEIPT QR CODE ]'));
        lines.push(padCenter(qrUrl));
      }
    }

    // 8. Custom Footer & Policies
    if (template.layout.showFooterNote && template.layout.footerMessage) {
      lines.push(divider('-'));
      const footerLines = template.layout.footerMessage.split('\n');
      for (const fl of footerLines) {
        lines.push(padCenter(fl));
      }
    }

    if (template.layout.showReturnPolicy && template.layout.returnPolicyText) {
      lines.push('');
      const policyLines = template.layout.returnPolicyText.split('\n');
      for (const pl of policyLines) {
        lines.push(padCenter(pl));
      }
    }

    if (template.layout.showWifiInfo && template.layout.wifiSsid) {
      lines.push('');
      lines.push(padCenter(`Free Wi-Fi: ${template.layout.wifiSsid}`));
      if (template.layout.wifiPassword) {
        lines.push(padCenter(`Password: ${template.layout.wifiPassword}`));
      }
    }

    lines.push(divider(divChar));
    lines.push(padCenter(`IDEMPOTENCY: ${order.idempotencyKey.slice(0, 18)}...`));
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Generates compiled binary ESC/POS byte sequence
   */
  public static formatAsEscPos(order: Order, template: ReceiptTemplate): Uint8Array {
    const builder = new EscPosBuilder();
    const cols = template.characterColumns || (template.paperWidth === '58mm' ? 32 : 48);

    // 1. Initialize & Header Branding
    builder.init();

    if (template.hardware.soundBuzzer) {
      builder.beep(1, 2);
    }

    // Cash Drawer Kick before printing if configured
    if (template.hardware.openCashDrawer) {
      builder.kickDrawer(template.hardware.drawerKickPin, template.hardware.drawerPulseOnMs);
    }

    builder.align('center');

    if (template.layout.showStoreHeader && template.branding.storeName) {
      if (template.hardware.doubleWidthHeader) {
        builder.textSize(2, 2).bold(true);
      } else {
        builder.bold(true);
      }
      builder.textLine(template.branding.storeName);
      builder.textSize(1, 1).bold(false);
    }

    if (template.layout.showBranchName && template.branding.branchName) {
      builder.textLine(template.branding.branchName);
    }
    if (template.layout.showTagline && template.branding.tagline) {
      builder.textLine(template.branding.tagline);
    }
    if (template.layout.showTaxId && template.branding.taxId) {
      builder.textLine(template.branding.taxId);
    }
    if (template.layout.showAddress) {
      if (template.branding.addressLine1) builder.textLine(template.branding.addressLine1);
      if (template.branding.addressLine2) builder.textLine(template.branding.addressLine2);
    }
    if (template.layout.showContactInfo) {
      if (template.branding.phone) builder.textLine(template.branding.phone);
      if (template.branding.email) builder.textLine(template.branding.email);
    }

    builder.divider(template.layout.dividerStyle, cols);

    // 2. Ticket Metadata
    builder.align('left');
    builder.twoColumnRow(`TICKET #${order.orderNumber}`, order.status.toUpperCase(), cols);
    if (template.layout.showOrderTimestamp) {
      builder.twoColumnRow('Date/Time:', new Date(order.createdAt).toLocaleString(), cols);
    }
    if (template.layout.showRegisterId) {
      builder.twoColumnRow('Register:', order.registerId, cols);
    }
    if (template.layout.showCashierName) {
      builder.twoColumnRow('Cashier:', order.cashierName || order.cashierId, cols);
    }
    if (template.layout.showCustomerInfo && order.customer) {
      builder.twoColumnRow('Customer:', order.customer.name, cols);
      if (template.layout.showLoyaltyPoints && order.customer.loyaltyPoints !== undefined) {
        builder.twoColumnRow('Loyalty Pts:', `${order.customer.loyaltyPoints} (${order.customer.loyaltyTier})`, cols);
      }
    }

    builder.divider('-', cols);

    // 3. Line Items
    if (cols === 32) {
      builder.twoColumnRow('ITEM / QTY', 'AMOUNT', cols);
    } else {
      builder.twoColumnRow('ITEM DESCRIPTION', 'QTY   PRICE   TOTAL', cols);
    }
    builder.divider('-', cols);

    for (const item of order.items) {
      const unitStr = formatMoney(item.unitPrice);
      const totalStr = formatMoney(item.lineTotal);

      if (template.hardware.boldItemNames) {
        builder.bold(true);
      }

      if (cols === 32) {
        builder.twoColumnRow(`${item.quantity}x ${item.product.name}`, totalStr, cols);
        builder.bold(false);
        if (template.layout.showItemUnitPrice && item.quantity > 1) {
          builder.textLine(`  @ ${unitStr}`);
        }
        if (template.layout.showItemSku && item.product.sku) {
          builder.textLine(`  SKU: ${item.product.sku}`);
        }
        if (template.layout.showItemDiscounts && item.discountBps > 0) {
          builder.textLine(`  Disc: -${(item.discountBps / 100).toFixed(0)}%`);
        }
      } else {
        const itemHeader = `${item.product.name}`;
        const itemStats = `${item.quantity}  ${unitStr}  ${totalStr}`;
        builder.twoColumnRow(itemHeader, itemStats, cols);
        builder.bold(false);
        if (template.layout.showItemSku && item.product.sku) {
          builder.textLine(`  [SKU: ${item.product.sku}]`);
        }
        if (template.layout.showItemDiscounts && item.discountBps > 0) {
          builder.textLine(`  [Discount: -${(item.discountBps / 100).toFixed(0)}%]`);
        }
      }
    }

    builder.divider('-', cols);

    // 4. Totals
    builder.twoColumnRow('Gross Subtotal:', formatMoney(order.totals.grossSubtotal), cols);
    if (order.totals.itemDiscounts.amountInCents > 0 || order.totals.orderDiscount.amountInCents > 0) {
      const totalDisc = order.totals.itemDiscounts.amountInCents + order.totals.orderDiscount.amountInCents;
      builder.twoColumnRow('Total Savings:', `-${formatMoney({ ...order.totals.grossSubtotal, amountInCents: totalDisc })}`, cols);
    }
    builder.twoColumnRow('Net Subtotal:', formatMoney(order.totals.netSubtotal), cols);

    if (template.layout.showTaxBreakdown) {
      builder.twoColumnRow('Tax (VAT / Sales):', formatMoney(order.totals.totalTax), cols);
    }

    builder.divider(template.layout.dividerStyle, cols);

    if (template.hardware.emphasizeTotals) {
      builder.textSize(1, 2).bold(true);
      builder.twoColumnRow('TOTAL DUE:', formatMoney(order.totals.grandTotal), cols);
      builder.textSize(1, 1).bold(false);
    } else {
      builder.bold(true);
      builder.twoColumnRow('TOTAL DUE:', formatMoney(order.totals.grandTotal), cols);
      builder.bold(false);
    }

    builder.divider(template.layout.dividerStyle, cols);

    // 5. Payment Tender Breakdown
    if (template.layout.showPaymentBreakdown && order.payments.length > 0) {
      for (const p of order.payments) {
        const methodTitle = p.method.toUpperCase().replace('_', ' ');
        builder.twoColumnRow(`PAID (${methodTitle}):`, formatMoney(p.amount), cols);
        if (p.tenderedCash && template.layout.showChangeGiven) {
          builder.twoColumnRow('Cash Tendered:', formatMoney(p.tenderedCash), cols);
        }
        if (p.changeGiven && template.layout.showChangeGiven) {
          builder.bold(true);
          builder.twoColumnRow('CHANGE RETURNED:', formatMoney(p.changeGiven), cols);
          builder.bold(false);
        }
      }
    }

    // 6. Barcode & QR Code
    if (template.layout.showBarcode) {
      builder.feed(1);
      builder.barcode(order.orderNumber, 48, 2);
    }

    if (template.layout.showQrCode) {
      const qrUrl = `${template.layout.qrCodeUrlPrefix}${order.orderNumber}`;
      builder.feed(1);
      builder.qrCode(qrUrl, 5);
    }

    // 7. Footer Messages
    builder.align('center');
    if (template.layout.showFooterNote && template.layout.footerMessage) {
      builder.divider('-', cols);
      for (const fl of template.layout.footerMessage.split('\n')) {
        builder.textLine(fl);
      }
    }

    if (template.layout.showReturnPolicy && template.layout.returnPolicyText) {
      builder.feed(1);
      for (const pl of template.layout.returnPolicyText.split('\n')) {
        builder.textLine(pl);
      }
    }

    if (template.layout.showWifiInfo && template.layout.wifiSsid) {
      builder.feed(1);
      builder.textLine(`Wi-Fi: ${template.layout.wifiSsid} / Pass: ${template.layout.wifiPassword || ''}`);
    }

    builder.divider(template.layout.dividerStyle, cols);
    builder.textLine(`IDEMPOTENCY: ${order.idempotencyKey.slice(0, 18)}...`);

    // 8. Cut paper
    if (template.hardware.autoCutPaper) {
      builder.cut(false, template.hardware.feedLinesBeforeCut);
    } else {
      builder.feed(template.hardware.feedLinesBeforeCut);
    }

    return builder.toUint8Array();
  }

  /**
   * Generates styled HTML document optimized for 58mm / 80mm thermal CSS media printing
   */
  public static formatAsHtml(order: Order, template: ReceiptTemplate): string {
    const is58mm = template.paperWidth === '58mm';
    const paperWidthPx = is58mm ? '58mm' : '80mm';
    const textFormatted = this.formatAsText(order, template);

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Receipt - #${order.orderNumber}</title>
  <style>
    @page {
      size: ${paperWidthPx} auto;
      margin: 0mm;
    }
    @media print {
      body {
        margin: 0;
        padding: 4mm 2mm;
        width: ${paperWidthPx};
        background: #fff;
        color: #000;
        font-family: 'Courier New', Courier, monospace, 'Noto Sans Thai';
        font-size: ${is58mm ? '10px' : '11px'};
        line-height: 1.25;
        -webkit-print-color-adjust: exact;
      }
      .no-print { display: none !important; }
    }
    body {
      margin: 0;
      padding: 12px 8px;
      width: ${paperWidthPx};
      max-width: 100%;
      background: #ffffff;
      color: #111827;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace, 'Noto Sans Thai';
      font-size: ${is58mm ? '11px' : '12px'};
      line-height: 1.35;
      box-sizing: border-box;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .receipt-container {
      width: 100%;
    }
    .header-logo {
      text-align: center;
      font-weight: 900;
      font-size: ${is58mm ? '14px' : '16px'};
      margin-bottom: 6px;
      display: flex;
      justify-content: center;
    }
    .header-logo svg {
      height: ${is58mm ? '36px' : '44px'};
      width: auto;
      max-width: ${is58mm ? '150px' : '185px'};
    }
    .divider {
      border-top: 1px dashed #666;
      margin: 6px 0;
    }
    .double-divider {
      border-top: 2px solid #000;
      margin: 6px 0;
    }
    .row {
      display: flex;
      justify-content: space-between;
    }
    .bold {
      font-weight: 700;
    }
    .center {
      text-align: center;
    }
    .barcode-svg {
      display: block;
      margin: 8px auto;
      max-width: 80%;
      height: 40px;
    }
    .qr-holder {
      text-align: center;
      margin: 8px 0;
    }
  </style>
</head>
<body>
  <div class="receipt-container">
    <div class="header-logo">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 96" fill="none">
        <rect x="6" y="8" width="80" height="80" rx="16" fill="#000000" />
        <rect x="11" y="13" width="70" height="70" rx="12" stroke="#FFFFFF" stroke-width="1.5" stroke-dasharray="3 2" />
        <path d="M26 26 H47 C56.3888 26 64 32.7157 64 41 C64 49.2843 56.3888 56 47 56 H36 V70 H26 V26 Z" fill="#FFFFFF" />
        <path d="M36 35 V47 H46.5 C50.6421 47 54 44.3137 54 41 C54 37.6863 50.6421 35 46.5 35 H36 Z" fill="#000000" />
        <path d="M51 46 L68 70" stroke="#FFFFFF" stroke-width="7.5" stroke-linecap="round" />
        <path d="M68 26 L44 60" stroke="#000000" stroke-width="11" stroke-linecap="round" />
        <path d="M68 26 L44 60" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" />
        <circle cx="68" cy="70" r="4" fill="#FFFFFF" />
        <text x="100" y="46" fill="#000000" font-family="ui-sans-serif, system-ui, -apple-system, sans-serif" font-size="32" font-weight="900" letter-spacing="-1">PRODX</text>
        <rect x="218" y="21" width="66" height="30" rx="6" fill="#000000" />
        <text x="251" y="42" fill="#FFFFFF" font-family="ui-monospace, monospace" font-size="20" font-weight="900" text-anchor="middle" letter-spacing="1">POS</text>
        <line x1="100" y1="58" x2="310" y2="58" stroke="#000000" stroke-width="2" />
        <line x1="100" y1="62" x2="310" y2="62" stroke="#000000" stroke-width="1" stroke-dasharray="4 3" />
        <text x="100" y="77" fill="#000000" font-family="ui-monospace, monospace" font-size="10.5" font-weight="800" letter-spacing="2.2">ENTERPRISE RETAIL TERMINAL</text>
      </svg>
    </div>
    <pre style="margin:0; font-family: inherit; font-size: inherit; white-space: pre-wrap;">${this.escapeHtml(textFormatted)}</pre>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Executes silent or standard browser-level thermal printing via dynamic hidden iframe
   */
  public static async printViaBrowser(
    order: Order,
    template: ReceiptTemplate
  ): Promise<{ success: boolean; message: string }> {
    try {
      const html = this.formatAsHtml(order, template);

      // Create an isolated hidden iframe for printing
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const doc = iframe.contentWindow?.document;
      if (!doc) {
        throw new Error('Unable to access printing context window.');
      }

      doc.open();
      doc.write(html);
      doc.close();

      return new Promise((resolve) => {
        iframe.onload = () => {
          setTimeout(() => {
            try {
              iframe.contentWindow?.focus();
              iframe.contentWindow?.print();
              setTimeout(() => {
                document.body.removeChild(iframe);
                resolve({
                  success: true,
                  message: `Receipt #${order.orderNumber} sent to system printer successfully.`,
                });
              }, 1000);
            } catch (err: any) {
              document.body.removeChild(iframe);
              resolve({
                success: false,
                message: err?.message || 'Print dialog initialization failed.',
              });
            }
          }, 250);
        };
      });
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Print failed.',
      };
    }
  }

  /**
   * Direct Web Serial API Transmission (USB to Serial / RS-232 Thermal Printers)
   */
  public static async sendToWebSerial(
    data: Uint8Array
  ): Promise<{ success: boolean; message: string }> {
    if (!('serial' in navigator)) {
      return {
        success: false,
        message: 'Web Serial API is not supported in this browser. Please use system print driver.',
      };
    }

    try {
      const nav = navigator as any;
      if (!nav.serial) {
        throw new Error('Web Serial API is not available.');
      }
      const port = await nav.serial.requestPort();
      if (!port) {
        throw new Error('No serial port selected.');
      }
      await port.open({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none' });

      if (!port.writable) {
        throw new Error('Serial port writable stream is not available.');
      }

      const writer = port.writable.getWriter();
      await writer.write(data);
      writer.releaseLock();
      await port.close();

      return {
        success: true,
        message: 'Binary ESC/POS payload transmitted over Serial port successfully.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Web Serial transmission error.',
      };
    }
  }

  /**
   * Direct WebUSB API Transmission (Native USB ESC/POS Thermal Printers)
   */
  public static async sendToWebUsb(
    data: Uint8Array
  ): Promise<{ success: boolean; message: string }> {
    if (!('usb' in navigator)) {
      return {
        success: false,
        message: 'WebUSB API is not supported in this browser. Please use system print driver.',
      };
    }

    try {
      const nav = navigator as any;
      if (!nav.usb) {
        throw new Error('WebUSB API is not available.');
      }
      const device = await nav.usb.requestDevice({
        filters: [{ classCode: 7 }], // USB Printer Class
      });

      if (!device) {
        throw new Error('No USB device selected.');
      }

      await device.open();
      if (device.configuration === null) {
        await device.selectConfiguration(1);
      }
      await device.claimInterface(0);

      if (!device.transferOut) {
        throw new Error('USB transferOut is not supported on this device.');
      }

      // Endpoint 1 or 2 Out
      await device.transferOut(1, data);
      await device.close();

      return {
        success: true,
        message: 'Binary ESC/POS payload transmitted over WebUSB successfully.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'WebUSB transmission error.',
      };
    }
  }

  /**
   * Direct Web Bluetooth Transmission (Portable Belt Printers)
   */
  public static async sendToWebBluetooth(
    data: Uint8Array
  ): Promise<{ success: boolean; message: string }> {
    if (!('bluetooth' in navigator)) {
      return {
        success: false,
        message: 'Web Bluetooth is not supported in this browser.',
      };
    }

    try {
      const nav = navigator as any;
      if (!nav.bluetooth) {
        throw new Error('Web Bluetooth API is not available.');
      }
      const device = await nav.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455'],
      });

      if (!device || !device.gatt) {
        throw new Error('No Bluetooth device or GATT server found.');
      }

      const server = await device.gatt.connect();
      if (!server) {
        throw new Error('Failed to connect to GATT server.');
      }

      // Transmit chunks (Bluetooth characteristic buffer is typically 20-512 bytes)
      const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
      if (!service) {
        throw new Error('Primary service not found.');
      }

      const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
      if (!characteristic) {
        throw new Error('Characteristic not found.');
      }

      const chunkSize = 64;
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        if (typeof characteristic.writeValue === 'function') {
          await characteristic.writeValue(chunk);
        } else if (typeof characteristic.writeValueWithResponse === 'function') {
          await characteristic.writeValueWithResponse(chunk);
        }
      }

      if (server.connected) {
        await server.disconnect();
      }

      return {
        success: true,
        message: 'Transmitted to Bluetooth Thermal Printer successfully.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Web Bluetooth transmission failed.',
      };
    }
  }

  /**
   * Downloads raw ESC/POS binary file (.prn / .bin) for testing or hardware spooling
   */
  public static downloadEscPosFile(data: Uint8Array, filename = 'receipt.prn'): void {
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Helper: converts Uint8Array to formatted Hex string
   */
  private static bytesToHex(bytes: Uint8Array): string {
    const hex: string[] = [];
    for (let i = 0; i < bytes.length; i++) {
      hex.push(bytes[i].toString(16).padStart(2, '0').toUpperCase());
    }
    return hex.join(' ');
  }

  /**
   * Helper: sanitizes HTML
   */
  private static escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
