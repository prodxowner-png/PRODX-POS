import React, { useState } from 'react';
import { motion } from 'motion/react';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { useToast } from '../../context/ToastContext';
import { useSound } from '../../context/SoundContext';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { ProdxReceiptLogo } from '../common/ProdxLogo';
import { formatMoney, createMoney } from '../../domain/money';
import { Mail, Printer, CheckCircle2, Copy, FileText, Sparkles, Send, Receipt, QrCode, ExternalLink, Coins, ShieldCheck, FileJson, Check } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface CartReceiptPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CartReceiptPreviewModal: React.FC<CartReceiptPreviewModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { session } = useAuth();
  const { customLogo } = useTheme();
  const {
    items,
    totals,
    customer,
    orderDiscountBps,
    secondaryTotals,
    activeSecondaryCurrency,
  } = useCart();
  const { language, t } = useLanguage();
  const { addToast } = useToast();
  const { playClick, playSuccess } = useSound();

  if (!session) return null;

  const currentStore = session.currentStore;
  const cashierName = session.currentUser.name;
  const todayStr = new Date().toLocaleString(language === 'th' ? 'th-TH' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const [emailInput, setEmailInput] = useState(customer?.email || '');
  const [isSending, setIsSending] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [includeLoyalty, setIncludeLoyalty] = useState(true);

  // QR Generation States & Memo Calculations
  const [qrMode, setQrMode] = useState<'url' | 'loyalty' | 'schema'>('url');
  const [isQrCopied, setIsQrCopied] = useState(false);

  const ticketId = React.useMemo(() => {
    return `PREVIEW-${Math.floor(1000 + Math.random() * 9000)}`;
  }, [isOpen]);

  const qrValue = React.useMemo(() => {
    if (qrMode === 'url') {
      const serializedItems = items.map(it => {
        const cleanName = encodeURIComponent(it.product.name.replace(/[:|]/g, ''));
        const itemTotalFormatted = formatMoney(it.lineTotal);
        return `${cleanName}:${it.quantity}:${itemTotalFormatted}`;
      }).join('|');

      const validationUrl = new URL(window.location.origin);
      validationUrl.searchParams.set('validate_receipt', 'true');
      validationUrl.searchParams.set('ticket', ticketId);
      validationUrl.searchParams.set('store', currentStore.name);
      validationUrl.searchParams.set('total', formatMoney(totals.grandTotal));
      validationUrl.searchParams.set('cashier', cashierName);
      validationUrl.searchParams.set('date', todayStr);
      if (customer && includeLoyalty) {
        validationUrl.searchParams.set('customer', customer.name);
        validationUrl.searchParams.set('points', Math.floor(totals.grandTotal.amountInCents / 100).toString());
      }
      if (serializedItems) {
        validationUrl.searchParams.set('items', serializedItems);
      }
      return validationUrl.toString();
    } else if (qrMode === 'loyalty') {
      if (!includeLoyalty) {
        return JSON.stringify({
          type: "loyalty_credit",
          status: "EXCLUDED_BY_OPERATOR",
          note: language === 'th' ? "ข้อมูลคะแนนสะสมถูกปิดใช้งาน" : "Loyalty point details excluded by operator."
        }, null, 2);
      }
      return JSON.stringify({
        type: "loyalty_credit",
        ticketId: ticketId,
        customerName: customer?.name || "Guest Profile",
        customerPhone: customer?.phone || "N/A",
        store: currentStore.name,
        grandTotal: formatMoney(totals.grandTotal),
        pointsEarned: Math.floor(totals.grandTotal.amountInCents / 100),
        timestamp: new Date().toISOString()
      }, null, 2);
    } else {
      return JSON.stringify({
        v: "1.0",
        id: ticketId,
        store: currentStore.name,
        itemsCount: items.length,
        total: formatMoney(totals.grandTotal),
        tax: formatMoney(totals.totalTax),
        cashier: cashierName,
        date: todayStr
      }, null, 2);
    }
  }, [qrMode, items, totals, customer, currentStore, cashierName, todayStr, ticketId, includeLoyalty, language]);

  const handleCopyQrPayload = () => {
    playClick();
    navigator.clipboard.writeText(qrValue);
    setIsQrCopied(true);
    addToast({
      title: language === 'th' ? 'คัดลอกข้อมูลคิวอาร์แล้ว' : 'QR Payload Copied',
      message: language === 'th' ? 'คัดลอกรหัสข้อมูลคิวอาร์ไปยังคลิปบอร์ดแล้ว' : 'The encoded QR string has been copied to your clipboard.',
      type: 'info',
    });
    setTimeout(() => setIsQrCopied(false), 2000);
  };

  const handleCopyText = () => {
    playClick();
    // Build a text representation of the receipt
    let text = `=== ${currentStore.name} ===\n`;
    text += `${currentStore.address || '123 POS Road, Bangkok'}\n`;
    text += `Tel: ${currentStore.phone || '02-123-4567'}\n`;
    text += `--------------------------------\n`;
    text += `Ticket ID: ${ticketId}\n`;
    text += `Date: ${todayStr}\n`;
    text += `Cashier: ${cashierName}\n`;
    text += `Type: DRAFT RECEIPT ESTIMATE\n`;
    text += `--------------------------------\n`;
    items.forEach((item) => {
      text += `${item.product.name}\n`;
      text += `  ${item.quantity} x ${formatMoney(item.product.price)} = ${formatMoney(item.lineTotal)}\n`;
    });
    text += `--------------------------------\n`;
    text += `Subtotal: ${formatMoney(totals.netSubtotal)}\n`;
    if (totals.orderDiscount.amountInCents > 0) {
      text += `Discount: -${formatMoney(totals.orderDiscount)}\n`;
    }
    text += `Tax (VAT Included): ${formatMoney(totals.totalTax)}\n`;
    text += `TOTAL DUE: ${formatMoney(totals.grandTotal)}\n`;
    if (secondaryTotals && activeSecondaryCurrency) {
      text += `CONVERSION (${activeSecondaryCurrency}): ${formatMoney(secondaryTotals.grandTotal)}\n`;
    }
    
    if (customer && includeLoyalty) {
      text += `--------------------------------\n`;
      text += `LOYALTY MEMBER\n`;
      text += `Name: ${customer.name}\n`;
      if (customer.phone) {
        text += `Phone: ${customer.phone}\n`;
      }
      text += `Projected Points: +${Math.floor(totals.grandTotal.amountInCents / 100)} pts\n`;
    }

    text += `================================\n`;
    text += `Thank you for shopping with us!\n`;

    navigator.clipboard.writeText(text);
    setIsCopied(true);
    addToast({
      title: language === 'th' ? 'คัดลอกไปยังคลิปบอร์ดแล้ว' : 'Copied to Clipboard',
      message: language === 'th' ? 'ข้อมูลใบเสร็จแบบข้อความดิบถูกคัดลอกแล้ว' : 'Plain text receipt copied successfully.',
      type: 'info',
    });
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleSendEmail = () => {
    if (!emailInput.trim()) {
      addToast({
        title: language === 'th' ? 'กรุณาระบุอีเมล' : 'Missing Email Address',
        message: language === 'th' ? 'โปรดป้อนอีเมลผู้รับที่ถูกต้อง' : 'Please enter a valid recipient email address.',
        type: 'warning',
      });
      return;
    }

    playClick();
    setIsSending(true);

    // Simulate sending network request
    setTimeout(() => {
      setIsSending(false);
      playSuccess();
      addToast({
        title: language === 'th' ? 'ส่งอีเมลสำเร็จ' : 'Digital Receipt Sent',
        message: language === 'th' 
          ? `ส่งใบเสร็จดิจิทัลไปยัง ${emailInput} เรียบร้อยแล้ว` 
          : `Digital receipt draft has been successfully sent to ${emailInput}.`,
        type: 'success',
      });
    }, 1200);
  };

  const handlePrintDraft = () => {
    playClick();
    window.print();
    addToast({
      title: language === 'th' ? 'ส่งคำสั่งพิมพ์ดราฟต์' : 'Draft Print Triggered',
      message: language === 'th' ? 'เรียกใช้งานหน้าต่างพิมพ์ของเบราว์เซอร์แล้ว' : 'System printing dialog initiated for receipt draft.',
      type: 'info',
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={language === 'th' ? 'ดูตัวอย่างใบเสร็จดิจิทัล' : 'Digital Receipt Preview'}
      description={language === 'th' ? 'ตรวจสอบสลิปจำลองจากตระกร้าสินค้าปัจจุบันก่อนพิมพ์จริง' : 'Inspect thermal ticket simulation and dispatch digital copies directly.'}
      maxWidth="md"
      footer={
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 w-full">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyText}
            leftIcon={<Copy className="h-4 w-4" />}
          >
            {isCopied ? (language === 'th' ? 'คัดลอกแล้ว!' : 'Copied!') : (language === 'th' ? 'คัดลอกข้อความดิบ' : 'Copy Text')}
          </Button>
          <div className="flex items-center gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={onClose}>
              {language === 'th' ? 'ปิด' : 'Close'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handlePrintDraft}
              leftIcon={<Printer className="h-4 w-4" />}
            >
              {language === 'th' ? 'พิมพ์ใบร่าง (Draft)' : 'Print Draft'}
            </Button>
          </div>
        </div>
      }
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', duration: 0.45, bounce: 0.12 }}
        className="grid grid-cols-1 md:grid-cols-12 gap-5"
      >
        {/* Left Side: Scrollable Thermal Paper Mockup with Canvas Stage */}
        <div className="md:col-span-7 flex flex-col items-center justify-center bg-background/40 p-6 sm:p-8 rounded-lg border border-border border-crisp relative overflow-hidden min-h-[450px]">
          {/* Professional Blueprint Dot-Grid Pattern */}
          <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] dark:bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-75 pointer-events-none" />
          
          {/* Mode Badge & Simulation Anchor */}
          <div className="absolute top-3 left-4 flex items-center gap-1.5 text-[9px] text-text/40 font-semibold uppercase tracking-wider select-none pointer-events-none">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            <span>{language === 'th' ? 'หน้าจอพรีวิวกระดาษจำลอง' : 'Thermal Simulator Canvas'}</span>
          </div>

          {/* Elevated Receipt Thermal Ticket */}
          <div className="w-full max-w-sm bg-white text-slate-900 p-6 font-mono text-[11px] leading-relaxed shadow-lg border border-slate-200 rounded-lg relative overflow-hidden select-none z-10">
            {/* Top Header Accent Line */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-primary" />

            {/* Simulated Receipt Header */}
            <div className="text-center space-y-1 mb-4 pt-2 flex flex-col items-center">
              <ProdxReceiptLogo
                customLogoUrl={customLogo}
                paperWidth="80mm"
                className="mb-2"
              />
              <div className="font-sans font-black text-sm tracking-wide text-zinc-900">{currentStore.name}</div>
              <div className="text-[10px] text-text/60">{currentStore.address || '123 POS Road, Bangkok'}</div>
              <div className="text-[10px] text-text/60">Tel: {currentStore.phone || '02-123-4567'}</div>
              <div className="text-[10px] text-text/60">Tax ID: {(currentStore as any).taxId || '0105561000123'}</div>
              <div className="inline-block px-2 py-0.5 mt-2 bg-primary/10 text-primary font-sans font-bold text-[9px] rounded uppercase tracking-wider animate-pulse">
                {language === 'th' ? 'ใบร่างจำลองก่อนขาย' : 'DRAFT ESTIMATE'}
              </div>
            </div>

            {/* Divider */}
            <div className="border-b border-dashed border-border my-2" />

            {/* Ticket Info */}
            <div className="space-y-0.5 text-[10px] text-text/70">
              <div className="flex justify-between">
                <span>Date:</span>
                <span className="font-bold">{todayStr}</span>
              </div>
              <div className="flex justify-between">
                <span>Cashier:</span>
                <span className="font-bold">{cashierName}</span>
              </div>
              <div className="flex justify-between">
                <span>Ticket ID:</span>
                <span className="font-bold">{ticketId}</span>
              </div>
            </div>

            {/* Divider */}
            <div className="border-b border-dashed border-border my-2" />

            {/* Items Column Header */}
            <div className="flex justify-between font-bold text-text text-[10px] mb-1">
              <span className="w-1/2">ITEM DESCRIPTION</span>
              <span className="w-1/6 text-center">QTY</span>
              <span className="w-1/3 text-right">TOTAL</span>
            </div>

            {/* Items Rows */}
            <div className="space-y-2 py-1 max-h-56 overflow-y-auto">
              {items.length === 0 ? (
                <div className="text-center text-text/50 py-4 italic">
                  {language === 'th' ? 'ไม่มีสินค้าในตะกร้า' : 'No items in cart'}
                </div>
              ) : (
                items.map((item) => {
                  const itemDiscountCents = Number((BigInt(item.unitPrice.amountInCents) * BigInt(item.quantity) * BigInt(item.discountBps) + 5000n) / 10000n);
                  const itemDiscountMoney = createMoney(itemDiscountCents, item.unitPrice.currency);
                  return (
                    <div key={item.product.id} className="space-y-0.5">
                      <div className="flex justify-between text-text font-bold">
                        <span className="w-1/2 truncate">{item.product.name}</span>
                        <span className="w-1/6 text-center">{item.quantity}</span>
                        <span className="w-1/3 text-right">{formatMoney(item.lineTotal)}</span>
                      </div>
                      <div className="flex justify-between text-[10px] text-text/60 pl-2">
                        <span>@ {formatMoney(item.product.price)}</span>
                        {item.discountBps > 0 && (
                          <span className="text-rose-600">-{formatMoney(itemDiscountMoney)}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Divider */}
            <div className="border-b border-dashed border-border my-2" />

            {/* Totals Section */}
            <div className="space-y-1 text-zinc-700">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>{formatMoney(totals.netSubtotal)}</span>
              </div>
              {totals.orderDiscount.amountInCents > 0 && (
                <div className="flex justify-between text-rose-600">
                  <span>Ticket Discount ({orderDiscountBps / 100}%):</span>
                  <span>-{formatMoney(totals.orderDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between text-[10px] text-text/60">
                <span>Tax (VAT Included):</span>
                <span>{formatMoney(totals.totalTax)}</span>
              </div>
              
              <div className="border-t border-dotted border-border my-1 pt-1" />
              
              <div className="flex justify-between text-zinc-900 font-bold text-sm">
                <span>TOTAL DUE:</span>
                <span>{formatMoney(totals.grandTotal)}</span>
              </div>

              {secondaryTotals && (
                <div className="flex justify-between text-text/60 font-bold text-[9px] mt-1 pt-1 border-t border-dotted border-border">
                  <span>CONV. ({activeSecondaryCurrency}):</span>
                  <span>{formatMoney(secondaryTotals.grandTotal)}</span>
                </div>
              )}
            </div>

            {/* Customer Section */}
            {customer && includeLoyalty && (
              <>
                <div className="border-b border-dashed border-border my-2" />
                <div className="space-y-0.5 text-[10px] text-text/70 bg-background/50 p-2 rounded">
                  <div className="font-bold text-text uppercase text-[9px] mb-0.5">LOYALTY MEMBER</div>
                  <div className="flex justify-between">
                    <span>Name:</span>
                    <span>{customer.name}</span>
                  </div>
                  {customer.phone && (
                    <div className="flex justify-between">
                      <span>Phone:</span>
                      <span>{customer.phone}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-emerald-700 font-bold">
                    <span>Projected Points:</span>
                    <span>+{Math.floor(totals.grandTotal.amountInCents / 100)} pts</span>
                  </div>
                </div>
              </>
            )}

            {/* Footer Notice */}
            <div className="border-b border-dashed border-border my-3" />
            <div className="text-center space-y-1 text-[9px] text-text/60 uppercase tracking-wider">
              <div>Thank you for shopping with us!</div>
              <div>Powered by PRODX POS</div>
              <div className="font-sans font-bold text-[8px] bg-background py-1 rounded text-text/70 mt-2">
                * THIS IS A PRE-CHECKOUT COPY *
              </div>
            </div>

            {/* Bottom Paper Tears Effect */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-border border-t border-dashed border-border" />
          </div>
        </div>

        {/* Right Side: Fast Digital Sharing & QR Code Utility panels */}
        <div className="md:col-span-5 flex flex-col space-y-4">
          
          {/* Receipt Customization Options */}
          <div className="p-4 rounded-lg border border-border border-crisp bg-card space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
              <Receipt className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>{language === 'th' ? 'การตั้งค่าพิมพ์ใบเสร็จ' : 'Receipt Configuration'}</span>
            </div>
            
            <div className="flex items-center justify-between py-1 bg-card border border-border border-crisp rounded-md p-2.5">
              <div className="space-y-0.5 pr-2">
                <div className="text-xs font-semibold text-text/80">
                  {language === 'th' ? 'แสดงข้อมูลคะแนนสะสม' : 'Loyalty Points Summary'}
                </div>
                <p className="text-[10px] text-text/60 leading-tight">
                  {language === 'th'
                    ? 'เปิด/ปิด รายละเอียดแต้มและชื่อสมาชิกร่วมในใบเสร็จ'
                    : 'Include customer name & loyalty ledger summaries on ticket and QR.'}
                </p>
              </div>
              <button
                type="button"
                id="toggle-loyalty-pts"
                onClick={() => {
                  playClick();
                  setIncludeLoyalty(prev => !prev);
                }}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  includeLoyalty ? 'bg-primary' : 'bg-slate-300 dark:bg-background'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs ring-0 transition duration-200 ease-in-out ${
                    includeLoyalty ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="p-4 rounded-lg border border-border border-crisp bg-card space-y-3.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
              <Mail className="h-4 w-4 text-primary" />
              <span>{language === 'th' ? 'ส่งใบเสร็จดิจิทัลแบบรวดเร็ว' : 'Fast Digital Dispatch'}</span>
            </div>
            
            <p className="text-[11px] text-text/60 leading-relaxed">
              {language === 'th'
                ? 'ป้อนอีเมลของลูกค้าเพื่อส่งบิลจำลอง/ใบแจ้งหนี้แบบสรุปเข้าสู่อีเมลของลูกค้าโดยตรงทันที'
                : 'Directly dispatch this dynamic pre-checkout receipt summary to the customer\'s email inbox.'}
            </p>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-semibold text-text/60 uppercase">
                {language === 'th' ? 'อีเมลลูกค้า' : 'Customer Email'}
              </label>
              <div className="flex gap-1.5">
                <input
                  type="email"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  placeholder="customer@example.com"
                  className="flex-1 h-9 rounded-md border border-border border-crisp bg-card px-3 py-1.5 text-xs text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary font-sans"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSendEmail}
                  isLoading={isSending}
                  leftIcon={<Send className="h-3.5 w-3.5" />}
                  className="shrink-0"
                >
                  {language === 'th' ? 'ส่ง' : 'Send'}
                </Button>
              </div>
            </div>
          </div>

          {/* Smart QR Code Generation Utility */}
          <div className="p-4 rounded-lg border border-border border-crisp bg-card space-y-3.5 flex-1 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
                  <QrCode className="h-4 w-4 text-primary" />
                  <span>{language === 'th' ? 'คิวอาร์โค้ดใบเสร็จดิจิทัล' : 'Smart Digital Receipt QR'}</span>
                </div>
                <Badge variant="primary" size="sm" className="font-sans text-[9px] font-semibold">
                  {language === 'th' ? 'ระบบอัตโนมัติ' : 'REALTIME'}
                </Badge>
              </div>

              <p className="text-[11px] text-text/60 leading-relaxed">
                {language === 'th'
                  ? 'สร้างคิวอาร์สำหรับลูกค้าสแกนตรวจสอบความถูกต้องสะสมแต้ม หรือเซฟข้อมูลดิจิทัลเข้ามือถือได้ทันที'
                  : 'Instantly generate customer-scannable QR codes for self-validation, loyalty accrual, or expense schema.'}
              </p>

              {/* Segmented Mode Selector */}
              <div className="grid grid-cols-3 gap-1 bg-background/70 dark:bg-slate-800 p-1 rounded-md text-[10px] font-semibold border border-border border-crisp">
                <button
                  type="button"
                  onClick={() => { playClick(); setQrMode('url'); }}
                  className={`py-1.5 rounded-sm text-center transition-all cursor-pointer ${
                    qrMode === 'url'
                      ? 'bg-white dark:bg-background text-primary shadow-xs font-semibold'
                      : 'text-text/70 hover:text-slate-900'
                  }`}
                >
                  {language === 'th' ? 'ลิงก์เช็ก' : 'Validation URL'}
                </button>
                <button
                  type="button"
                  onClick={() => { playClick(); setQrMode('loyalty'); }}
                  className={`py-1.5 rounded-sm text-center transition-all cursor-pointer ${
                    qrMode === 'loyalty'
                      ? 'bg-white dark:bg-background text-primary shadow-xs font-semibold'
                      : 'text-text/70 hover:text-slate-900'
                  }`}
                >
                  {language === 'th' ? 'คะแนนสะสม' : 'Loyalty Points'}
                </button>
                <button
                  type="button"
                  onClick={() => { playClick(); setQrMode('schema'); }}
                  className={`py-1.5 rounded-sm text-center transition-all cursor-pointer ${
                    qrMode === 'schema'
                      ? 'bg-white dark:bg-background text-primary shadow-xs font-semibold'
                      : 'text-text/70 hover:text-slate-900'
                  }`}
                >
                  {language === 'th' ? 'โครงสร้าง' : 'JSON Schema'}
                </button>
              </div>
            </div>

            {/* QR Code Container and Side Controls */}
            <div className="flex items-center gap-4 py-2 bg-card/50 border border-border border-crisp rounded-lg p-3">
              {/* White Background Wrapper for QR Code Scanner Friendly */}
              <div className="p-2.5 bg-white rounded-md border border-slate-200 shrink-0 flex items-center justify-center shadow-xs transition-transform duration-150 hover:scale-105">
                <QRCodeSVG
                  value={qrValue}
                  size={95}
                  bgColor="#ffffff"
                  fgColor="#0f172a"
                  level="M"
                  includeMargin={false}
                />
              </div>

              {/* QR Mode Action Details */}
              <div className="flex-1 space-y-2 text-[10px] text-text/60 leading-normal">
                {qrMode === 'url' && (
                  <>
                    <div className="font-semibold text-text/80 flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                      <span>{language === 'th' ? 'ลิงก์ตรวจสอบสิทธิ์มือถือ' : 'Customer Validation Link'}</span>
                    </div>
                    <p className="text-[10px]">
                      {language === 'th'
                        ? 'สแกนเพื่อเปิดหน้าประเมินความพึงพอใจร้านค้า และแสดงรายละเอียดสลิปจริง'
                        : 'Mobile-friendly secure landing page for digital checkout audit and feedback submission.'}
                    </p>
                  </>
                )}
                {qrMode === 'loyalty' && (
                  <>
                    <div className="font-semibold text-text/80 flex items-center gap-1">
                      <Coins className="h-3.5 w-3.5 text-amber-500" />
                      <span>{language === 'th' ? 'โครงสร้างคะแนนสะสม' : 'Loyalty Update Stream'}</span>
                    </div>
                    <p className="text-[10px]">
                      {customer 
                        ? (language === 'th' ? `สะสมคะแนนเข้าบัญชีคุณ ${customer.name}` : `Syncs transaction credits directly to loyalty profile of ${customer.name}.`)
                        : (language === 'th' ? 'ไม่มีสมาชิกร่วมรายการ กรุณาผูกบัญชีในหน้าร้านค้า' : 'No loyalty member attached. Scan maps to active Guest account.')}
                    </p>
                  </>
                )}
                {qrMode === 'schema' && (
                  <>
                    <div className="font-semibold text-text/80 flex items-center gap-1">
                      <FileJson className="h-3.5 w-3.5 text-blue-500" />
                      <span>{language === 'th' ? 'โครงสร้าง JSON ดิจิทัล' : 'Structured Invoice Schema'}</span>
                    </div>
                    <p className="text-[10px]">
                      {language === 'th'
                        ? 'โครงสร้างข้อมูลดิบสำหรับระบบบัญชี ERP หรือสแกนเคลมค่าใช้จ่ายบริษัท'
                        : 'Raw offline JSON object for corporate accounting, receipt capture, or ledger sync.'}
                    </p>
                  </>
                )}

                {/* QR Utility Buttons */}
                <div className="flex items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={handleCopyQrPayload}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 dark:bg-background hover:bg-background dark:hover:bg-slate-600 text-text/80 font-semibold text-[9px] transition-colors cursor-pointer"
                  >
                    {isQrCopied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    <span>{isQrCopied ? (language === 'th' ? 'คัดลอกแล้ว' : 'Copied!') : (language === 'th' ? 'คัดลอกรหัส' : 'Copy Raw')}</span>
                  </button>

                  {qrMode === 'url' && (
                    <a
                      href={qrValue}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => playClick()}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 font-semibold text-[9px] transition-colors cursor-pointer"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>{language === 'th' ? 'ลองทดสอบ' : 'Open Portal'}</span>
                    </a>
                  )}
                </div>
              </div>
            </div>

            {/* Collapsible raw data inspector (Anti-Slop Craftsmanship) */}
            <details className="group border border-border border-crisp rounded-md bg-slate-100/60 dark:bg-slate-800/40 text-[9px] select-text">
              <summary className="px-2.5 py-1.5 font-semibold text-text/60 cursor-pointer flex justify-between items-center outline-none list-none group-open:border-b group-open:border-slate-200 dark:group-open:border-slate-700">
                <span>{language === 'th' ? 'ดูข้อมูลรหัสคิวอาร์ที่เข้ารหัส' : 'Inspect Encoded QR Payload'}</span>
                <span className="transition-transform group-open:rotate-180">▼</span>
              </summary>
              <div className="p-2 font-mono break-all text-text/70 bg-white/60 dark:bg-slate-900/60 max-h-20 overflow-y-auto">
                {qrValue}
              </div>
            </details>
          </div>
        </div>
      </motion.div>
    </Modal>
  );
};

export { ThermalReceiptSlideOver } from './ThermalReceiptSlideOver';
