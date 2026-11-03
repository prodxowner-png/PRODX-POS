import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  Printer,
  Mail,
  X,
  Copy,
  Check,
  Download,
  Receipt,
  FileText,
  Sparkles,
  Send,
  AlertCircle,
  CheckCircle2,
  Share2,
  ChevronDown,
  Layers,
  ShoppingBag,
  Store,
  Calendar,
  User,
  CreditCard,
  Percent,
  RefreshCw,
} from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { useReceiptPrinter } from '../../context/ReceiptPrinterContext';
import { Order, CartLineItem } from '../../domain/order';
import { formatMoney, createMoney } from '../../domain/money';
import { ReceiptTemplate, ReceiptPaperWidth } from '../../domain/receipt';
import { ThermalReceiptService } from '../../services/receipt/thermalReceiptService';
import { playScannerSound } from '../../services/soundService';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { ProdxReceiptLogo } from '../common/ProdxLogo';
import { getZIndexClass } from '../../utils/ZIndexManager';

export interface ThermalReceiptSlideOverProps {
  isOpen: boolean;
  onClose: () => void;
  orderOverride?: Order | null;
}

export const ThermalReceiptSlideOver: React.FC<ThermalReceiptSlideOverProps> = ({
  isOpen,
  onClose,
  orderOverride,
}) => {
  const { session } = useAuth();
  const { customLogo } = useTheme();
  const { language, t } = useLanguage();
  const { addToast } = useToast();
  const {
    items,
    totals,
    customer,
    orderDiscountBps,
    secondaryTotals,
    activeSecondaryCurrency,
  } = useCart();
  const {
    templates,
    activeTemplate,
    setActiveTemplateId,
    printReceipt,
    isPrinting,
  } = useReceiptPrinter();

  // Slide-over local state
  const [viewMode, setViewMode] = useState<'paper' | 'monospace' | 'structured'>('paper');
  const [paperWidth, setPaperWidth] = useState<ReceiptPaperWidth>(activeTemplate.paperWidth || '80mm');
  const [copied, setCopied] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSentSuccess, setEmailSentSuccess] = useState(false);
  const [isEmailDrawerOpen, setIsEmailDrawerOpen] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState(customer?.email || '');
  const [emailError, setEmailError] = useState<string | null>(null);

  // Sync recipient email when customer changes
  useEffect(() => {
    if (customer?.email) {
      setRecipientEmail(customer.email);
    }
  }, [customer?.email]);

  // Construct deterministic order representation of current cart
  const effectiveOrder: Order = useMemo(() => {
    if (orderOverride) return orderOverride;

    const currentStore = session?.currentStore || {
      id: 'store-01',
      organizationId: 'org-01',
      code: 'MAIN',
      name: 'PRODX Retail Store',
      address: '999/9 Rama I Road, Pathumwan, Bangkok 10330',
      phone: '+66 2 123 4567',
      currency: 'THB',
      timezone: 'Asia/Bangkok',
      defaultTaxRateBps: 700,
    };

    const currentCashier = session?.currentUser || {
      id: 'usr-cashier',
      name: 'POS Staff',
    };

    const registerId = session?.registerId || 'REG-01';
    const nowIso = new Date().toISOString();

    return {
      id: `cart-preview-${Date.now()}`,
      orderNumber: `DRAFT-${Math.floor(1000 + Math.random() * 9000)}`,
      idempotencyKey: `idemp-draft-${Date.now()}`,
      storeId: currentStore.id,
      registerId,
      cashierId: currentCashier.id,
      cashierName: currentCashier.name,
      customer: customer || undefined,
      items,
      totals,
      payments: [
        {
          id: 'pay-draft-1',
          method: 'cash',
          amount: totals.grandTotal,
          timestamp: nowIso,
        },
      ],
      status: 'draft',
      createdAt: nowIso,
    };
  }, [orderOverride, session, customer, items, totals]);

  // Derive template adjusted for selected paper width
  const effectiveTemplate: ReceiptTemplate = useMemo(() => {
    return {
      ...activeTemplate,
      paperWidth,
      characterColumns: paperWidth === '58mm' ? 32 : 48,
    };
  }, [activeTemplate, paperWidth]);

  // Formatted thermal receipt payload
  const formattedReceipt = useMemo(() => {
    return ThermalReceiptService.formatReceipt(effectiveOrder, effectiveTemplate);
  }, [effectiveOrder, effectiveTemplate]);

  // Handle keyboard events (ESC to close, ⌘P to print)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handlePrint();
      }
    };

    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, effectiveOrder, effectiveTemplate]);

  // Reset success feedback when panel opens
  useEffect(() => {
    if (isOpen) {
      setEmailSentSuccess(false);
      setEmailError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  const currentStore = session?.currentStore;
  const cashierName = session?.currentUser.name || 'Staff';
  const hasItems = items.length > 0 || (orderOverride && orderOverride.items.length > 0);
  const formattedDate = new Date().toLocaleString(language === 'th' ? 'th-TH' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const branchName = effectiveTemplate.branding.branchName || currentStore?.code || '00000 (Head Office)';
  const taxId = effectiveTemplate.branding.taxId || '0105558123456';

  // Action: Print Receipt
  const handlePrint = async () => {
    playScannerSound('click');
    try {
      // 1. Send to hardware receipt printer / browser print iframe
      const result = await printReceipt(effectiveOrder, effectiveTemplate);
      
      // Fallback to browser print if hardware connection is browser-based
      if (result.success) {
        addToast({
          title: language === 'th' ? 'ส่งคำสั่งพิมพ์สำเร็จ' : 'Print Dispatched',
          message: language === 'th'
            ? `ส่งสลิป ${effectiveTemplate.paperWidth} ไปยังเครื่องพิมพ์แล้ว`
            : `Thermal receipt job sent to ${effectiveTemplate.paperWidth} spooler.`,
          type: 'success',
        });
      } else {
        // Fallback to direct window printing
        await ThermalReceiptService.printViaBrowser(effectiveOrder, effectiveTemplate);
        addToast({
          title: language === 'th' ? 'เปิดหน้าต่างพิมพ์สลิป' : 'Thermal Print Triggered',
          message: language === 'th'
            ? 'เรียกใช้หน้าต่างพิมพ์ของระบบแล้ว'
            : 'Browser print dialog opened for thermal slip.',
          type: 'info',
        });
      }
    } catch (err) {
      console.error('[ThermalReceiptSlideOver] Print error:', err);
      // Fallback
      window.print();
    }
  };

  // Action: Email Receipt
  const handleSendEmail = (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const trimmed = recipientEmail.trim();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!trimmed || !emailRegex.test(trimmed)) {
      setEmailError(
        language === 'th'
          ? 'กรุณากรอกที่อยู่อีเมลที่ถูกต้อง'
          : 'Please enter a valid email address.'
      );
      return;
    }

    setEmailError(null);
    setIsSendingEmail(true);
    playScannerSound('click');

    // Simulate sending digital receipt via backend mailing service
    setTimeout(() => {
      setIsSendingEmail(false);
      setEmailSentSuccess(true);
      playScannerSound('payment_success');
      addToast({
        title: language === 'th' ? 'ส่งใบเสร็จดิจิทัลสำเร็จ' : 'e-Receipt Dispatched',
        message: language === 'th'
          ? `ส่งสำเนาใบเสร็จไปยัง ${trimmed} เรียบร้อยแล้ว`
          : `Digital receipt successfully emailed to ${trimmed}.`,
        type: 'success',
      });
      setTimeout(() => {
        setIsEmailDrawerOpen(false);
      }, 1500);
    }, 1100);
  };

  // Action: Copy Text
  const handleCopyText = () => {
    playScannerSound('click');
    navigator.clipboard.writeText(formattedReceipt.text);
    setCopied(true);
    addToast({
      title: language === 'th' ? 'คัดลอกข้อความสลิปแล้ว' : 'Receipt Text Copied',
      message: language === 'th'
        ? 'คัดลอกข้อความจัดรูปแบบ ESC/POS ลงคลิปบอร์ดแล้ว'
        : 'Formatted monospace receipt text copied to clipboard.',
      type: 'info',
    });
    setTimeout(() => setCopied(false), 2000);
  };

  // Action: Download .PRN Binary
  const handleDownloadPrn = () => {
    playScannerSound('click');
    ThermalReceiptService.downloadEscPosFile(
      formattedReceipt.escposBytes,
      `thermal_receipt_${effectiveOrder.orderNumber}_${paperWidth}.prn`
    );
    addToast({
      title: language === 'th' ? 'ดาวน์โหลดไฟล์ .PRN สำเร็จ' : 'PRN Binary Downloaded',
      message: language === 'th'
        ? 'บันทึกไฟล์ ESC/POS ไบนารีสำหรับเครื่องพิมพ์ความร้อนแล้ว'
        : 'Saved ESC/POS printer byte stream file.',
      type: 'info',
    });
  };

  return createPortal(
    <div
      id="thermal-receipt-slideover-backdrop"
      className={`fixed inset-0 ${getZIndexClass('modal')} overflow-hidden bg-black/60 dark:bg-black/80 backdrop-blur-xs transition-opacity animate-in fade-in duration-150 select-none`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="fixed inset-y-0 right-0 flex max-w-full pl-0 sm:pl-10">
        <div
          id="thermal-receipt-slideover-panel"
          className="w-full sm:max-w-lg md:max-w-xl bg-card border-l border-crisp border-border flex flex-col h-full shadow-2xl animate-in slide-in-from-right duration-200 text-text"
        >
          {/* ========================================================================= */}
          {/* 1. SLIDE-OVER HEADER: Enterprise Typography & Badges                     */}
          {/* ========================================================================= */}
          <div className="px-5 sm:px-6 py-4 border-b border-crisp border-border shrink-0 bg-card/95 backdrop-blur-md flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2 rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20">
                <Receipt className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-heading-3 text-text truncate">
                    {language === 'th' ? 'ตัวอย่างใบเสร็จความร้อน' : 'Thermal Receipt Preview'}
                  </h2>
                  <Badge variant="primary" size="xs" className="font-mono uppercase font-bold shrink-0">
                    {effectiveOrder.status === 'draft' ? 'DRAFT' : 'FINAL'}
                  </Badge>
                </div>
                <p className="text-caption text-text/60 mt-0.5 truncate">
                  {currentStore?.name || 'PRODX Store'} · {effectiveOrder.registerId} · {effectiveOrder.orderNumber}
                </p>
              </div>
            </div>

            {/* Close Button */}
            <button
              type="button"
              id="thermal-receipt-close-btn"
              onClick={onClose}
              className="p-2 rounded-xl text-text/50 hover:text-text hover:bg-background border border-transparent hover:border-border transition-colors cursor-pointer active:scale-95 shrink-0"
              aria-label={language === 'th' ? 'ปิดหน้าต่าง' : 'Close panel'}
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* ========================================================================= */}
          {/* 2. SECONDARY CONTROLS TOOLBAR: Widths, View Modes & Copy Utilities      */}
          {/* ========================================================================= */}
          <div className="px-5 sm:px-6 py-2.5 border-b border-crisp border-border shrink-0 bg-background/60 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 bg-card/80 p-1 rounded-xl border border-border border-crisp shrink-0">
              <button
                type="button"
                id="thermal-viewmode-paper"
                onClick={() => setViewMode('paper')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  viewMode === 'paper'
                    ? 'bg-primary text-white shadow-2xs font-bold'
                    : 'text-text/70 hover:text-text hover:bg-background'
                }`}
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="text-label-sm">{language === 'th' ? 'กระดาษ' : 'Thermal'}</span>
              </button>
              <button
                type="button"
                id="thermal-viewmode-monospace"
                onClick={() => setViewMode('monospace')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  viewMode === 'monospace'
                    ? 'bg-primary text-white shadow-2xs font-bold'
                    : 'text-text/70 hover:text-text hover:bg-background'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span className="text-label-sm">{language === 'th' ? 'ข้อความ' : 'Monospace'}</span>
              </button>
              <button
                type="button"
                id="thermal-viewmode-structured"
                onClick={() => setViewMode('structured')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  viewMode === 'structured'
                    ? 'bg-primary text-white shadow-2xs font-bold'
                    : 'text-text/70 hover:text-text hover:bg-background'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span className="text-label-sm">{language === 'th' ? 'สรุปตาราง' : 'Summary'}</span>
              </button>
            </div>

            {/* Width Selector & Export Shortcuts */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Paper Width Pills */}
              <div className="flex items-center bg-card p-1 rounded-xl border border-border border-crisp text-xs">
                <button
                  type="button"
                  id="thermal-width-80mm"
                  onClick={() => setPaperWidth('80mm')}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
                    paperWidth === '80mm'
                      ? 'bg-primary/15 text-primary border border-primary/30'
                      : 'text-text/60 hover:text-text'
                  }`}
                  title="Standard 80mm POS Roll (48 Columns)"
                >
                  80mm
                </button>
                <button
                  type="button"
                  id="thermal-width-58mm"
                  onClick={() => setPaperWidth('58mm')}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
                    paperWidth === '58mm'
                      ? 'bg-primary/15 text-primary border border-primary/30'
                      : 'text-text/60 hover:text-text'
                  }`}
                  title="Compact 58mm POS Roll (32 Columns)"
                >
                  58mm
                </button>
              </div>

              {/* Copy Plain Text */}
              <button
                type="button"
                id="thermal-copy-text-btn"
                onClick={handleCopyText}
                title={language === 'th' ? 'คัดลอกข้อความสลิป' : 'Copy Formatted Text'}
                className="p-1.5 rounded-xl border border-border border-crisp bg-card text-text/70 hover:text-text hover:bg-background transition-colors cursor-pointer"
              >
                {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </button>

              {/* Download Binary PRN */}
              <button
                type="button"
                id="thermal-download-prn-btn"
                onClick={handleDownloadPrn}
                title={language === 'th' ? 'ดาวน์โหลดไฟล์ไบนารี .PRN' : 'Download ESC/POS .PRN'}
                className="p-1.5 rounded-xl border border-border border-crisp bg-card text-text/70 hover:text-text hover:bg-background transition-colors cursor-pointer"
              >
                <Download className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 3. EMAIL DISPATCH INLINE EXPANDABLE DRAWER                                 */}
          {/* ========================================================================= */}
          {isEmailDrawerOpen && (
            <div
              id="thermal-email-drawer"
              className="px-5 sm:px-6 py-3.5 bg-primary/5 border-b border-primary/20 animate-in slide-in-from-top-2 duration-150 shrink-0"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-text">
                  <Mail className="h-4 w-4 text-primary" />
                  <span className="text-heading-4">
                    {language === 'th' ? 'ส่งใบเสร็จดิจิทัลทางอีเมล' : 'Send Digital Receipt via Email'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEmailDrawerOpen(false)}
                  className="text-text/40 hover:text-text text-xs p-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <form onSubmit={handleSendEmail} className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="email"
                      id="thermal-recipient-email-input"
                      value={recipientEmail}
                      onChange={(e) => {
                        setRecipientEmail(e.target.value);
                        if (emailError) setEmailError(null);
                      }}
                      placeholder="customer@example.com"
                      className="w-full px-3 py-2 pl-8 rounded-xl border border-border bg-card text-xs font-mono text-text focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                    />
                    <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text/40" />
                  </div>

                  <Button
                    type="submit"
                    id="thermal-send-email-confirm-btn"
                    size="sm"
                    variant="primary"
                    isLoading={isSendingEmail}
                    leftIcon={emailSentSuccess ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
                    className="shrink-0 text-xs font-bold px-4"
                  >
                    {emailSentSuccess
                      ? language === 'th' ? 'ส่งแล้ว!' : 'Sent!'
                      : language === 'th' ? 'ส่งอีเมล' : 'Dispatch'}
                  </Button>
                </div>

                {emailError && (
                  <p className="text-[11px] text-rose-500 font-medium flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    <span>{emailError}</span>
                  </p>
                )}

                {customer && (
                  <p className="text-[11px] text-text/60">
                    {language === 'th'
                      ? `เชื่อมโยงกับสมาชิก: ${customer.name} (${customer.loyaltyTier})`
                      : `Pre-filled from linked customer: ${customer.name} (${customer.loyaltyTier})`}
                  </p>
                )}
              </form>
            </div>
          )}

          {/* ========================================================================= */}
          {/* 4. MAIN SCROLLABLE CONTENT: Thermal Receipt Visualizer / Monospace         */}
          {/* ========================================================================= */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-background/50 flex flex-col items-center custom-scrollbar">
            {!hasItems ? (
              <div className="my-auto flex flex-col items-center text-center p-6 max-w-sm">
                <div className="p-4 rounded-2xl bg-card border border-border border-crisp text-text/30 mb-3 shadow-sm">
                  <ShoppingBag className="h-10 w-10" />
                </div>
                <h3 className="text-heading-3 text-text">
                  {language === 'th' ? 'ไม่มีรายการสินค้าในตะกร้า' : 'Cart is Currently Empty'}
                </h3>
                <p className="text-caption text-text/60 mt-1 leading-relaxed">
                  {language === 'th'
                    ? 'กรุณาเลือกหรือสแกนสินค้าเพื่อสร้างตัวอย่างสลิปความร้อนแบบเรียลไทม์'
                    : 'Add products from the POS catalog or barcode scanner to generate a live transaction receipt.'}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClose}
                  className="mt-4 text-xs font-semibold"
                >
                  {language === 'th' ? 'กลับไปที่หน้าจอขาย' : 'Return to Catalog'}
                </Button>
              </div>
            ) : (
              <>
                {/* 4.1 VIEW MODE: Authentic Thermal Paper Visualizer */}
                {viewMode === 'paper' && (
                  <div className="w-full flex justify-center py-2">
                    <div
                      id="thermal-paper-slip"
                      className={`relative bg-white text-zinc-900 border-x border-zinc-200/80 shadow-2xl transition-all font-mono select-text box-border ${
                        paperWidth === '58mm'
                          ? 'w-[280px] max-w-[280px] p-4 text-[11px]'
                          : 'w-[360px] max-w-[360px] p-5 text-[11.5px]'
                      }`}
                      style={{
                        boxShadow: '0 12px 35px -8px rgba(0, 0, 0, 0.22), 0 2px 6px rgba(0, 0, 0, 0.08)',
                      }}
                    >
                      {/* Top Serrated Jagged Paper Tear Edge */}
                      <div className="absolute -top-2 left-0 right-0 h-2 overflow-hidden flex pointer-events-none">
                        {Array.from({ length: 32 }).map((_, i) => (
                          <div
                            key={i}
                            className="w-3 h-3 bg-white rotate-45 transform origin-bottom-left shrink-0 shadow-2xs"
                          />
                        ))}
                      </div>

                      {/* Store Branding Header */}
                      <div className="text-center space-y-1 mb-3 pt-1">
                        <div className="flex justify-center mb-2">
                          <ProdxReceiptLogo
                            customLogoUrl={customLogo}
                            paperWidth={paperWidth}
                          />
                        </div>

                        <div className="font-extrabold tracking-wider text-sm text-zinc-950 uppercase">
                          {currentStore?.name || 'PRODX POS RETAIL'}
                        </div>

                        {branchName && (
                          <div className="text-[10.5px] text-zinc-600 uppercase font-medium">
                            {language === 'th' ? `สาขา: ${branchName}` : `Branch: ${branchName}`}
                          </div>
                        )}

                        {taxId && (
                          <div className="text-[10px] text-zinc-600 font-mono">
                            {language === 'th' ? 'เลขประจำตัวผู้เสียภาษี: ' : 'TAX ID: '}
                            {taxId}
                          </div>
                        )}

                        {currentStore?.address && (
                          <div className="text-[10px] text-zinc-600 leading-tight px-2">
                            {currentStore.address}
                          </div>
                        )}

                        {currentStore?.phone && (
                          <div className="text-[10px] text-zinc-600 font-mono">
                            TEL: {currentStore.phone}
                          </div>
                        )}

                        <div className="pt-1.5 pb-0.5 font-bold text-xs tracking-wider text-zinc-900 uppercase border-y border-zinc-300 my-2">
                          {language === 'th' ? 'ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ' : 'TAX INVOICE (ABB) / RECEIPT'}
                        </div>
                      </div>

                      {/* Transaction Metadata Grid */}
                      <div className="text-[10.5px] text-zinc-700 space-y-0.5 pb-2 mb-2 border-b border-dashed border-zinc-400">
                        <div className="flex justify-between">
                          <span className="text-zinc-500">{language === 'th' ? 'เลขที่ใบเสร็จ:' : 'Ticket Ref:'}</span>
                          <span className="font-bold text-zinc-900">{effectiveOrder.orderNumber}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">{language === 'th' ? 'วันที่ / เวลา:' : 'Date/Time:'}</span>
                          <span>{formattedDate}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-500">{language === 'th' ? 'จุดขาย / แคชเชียร์:' : 'POS / Cashier:'}</span>
                          <span>{effectiveOrder.registerId} / {cashierName}</span>
                        </div>

                        {customer && (
                          <div className="pt-1 mt-1 border-t border-dotted border-zinc-300">
                            <div className="flex justify-between font-semibold text-zinc-900">
                              <span>{language === 'th' ? 'สมาชิก:' : 'Member:'}</span>
                              <span className="truncate max-w-[170px]">{customer.name}</span>
                            </div>
                            <div className="flex justify-between text-[10px] text-zinc-600">
                              <span>{customer.phone || customer.loyaltyTier}</span>
                              <span>
                                {language === 'th'
                                  ? `คะแนนปัจจุบัน: ${customer.loyaltyPoints} แต้ม`
                                  : `Points: ${customer.loyaltyPoints} pts`}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Line Items Table */}
                      <div className="space-y-2 pb-2 mb-2 border-b border-dashed border-zinc-400">
                        <div className="flex justify-between text-[10px] font-bold text-zinc-800 uppercase tracking-wider pb-0.5 border-b border-zinc-200">
                          <span>{language === 'th' ? 'รายการสินค้า' : 'Description'}</span>
                          <span>{language === 'th' ? 'จำนวนเงิน' : 'Amount'}</span>
                        </div>

                        {effectiveOrder.items.map((item) => {
                          const hasDiscount = item.discountBps > 0;
                          return (
                            <div key={item.lineId} className="text-[11px] leading-tight">
                              <div className="flex justify-between items-start gap-2">
                                <span className="font-semibold text-zinc-900 flex-1 truncate">
                                  {item.product.name}
                                </span>
                                <span className="font-bold text-zinc-950 shrink-0 font-mono">
                                  {formatMoney(item.lineTotal)}
                                </span>
                              </div>
                              <div className="flex justify-between text-[10px] text-zinc-600 pl-2">
                                <span>
                                  {item.quantity} x {formatMoney(item.unitPrice)}
                                  {item.product.sku ? ` (${item.product.sku})` : ''}
                                </span>
                                {hasDiscount && (
                                  <span className="text-zinc-500 font-medium">
                                    (-{(item.discountBps / 100).toFixed(0)}%)
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Financial Totals & VAT Breakdown */}
                      <div className="space-y-1 text-[11px] text-zinc-800 pb-2 mb-2 border-b border-dashed border-zinc-400">
                        <div className="flex justify-between text-zinc-600">
                          <span>{language === 'th' ? 'ยอดรวมสินค้า (Gross):' : 'Gross Subtotal:'}</span>
                          <span className="font-mono">{formatMoney(totals.grossSubtotal)}</span>
                        </div>

                        {totals.itemDiscounts.amountInCents > 0 && (
                          <div className="flex justify-between text-zinc-600">
                            <span>{language === 'th' ? 'ส่วนลดสินค้า:' : 'Item Discounts:'}</span>
                            <span className="font-mono">-{formatMoney(totals.itemDiscounts)}</span>
                          </div>
                        )}

                        {totals.orderDiscount.amountInCents > 0 && (
                          <div className="flex justify-between text-zinc-600">
                            <span>{language === 'th' ? 'ส่วนลดท้ายบิล:' : 'Order Discount:'}</span>
                            <span className="font-mono">-{formatMoney(totals.orderDiscount)}</span>
                          </div>
                        )}

                        <div className="flex justify-between text-zinc-600">
                          <span>{language === 'th' ? 'มูลค่าก่อนภาษี (Tax Base):' : 'Net Taxable Subtotal:'}</span>
                          <span className="font-mono">{formatMoney(totals.netSubtotal)}</span>
                        </div>

                        <div className="flex justify-between text-zinc-600">
                          <span>{language === 'th' ? 'ภาษีมูลค่าเพิ่ม (VAT 7% Inc):' : 'VAT 7% (Included):'}</span>
                          <span className="font-mono">{formatMoney(totals.totalTax)}</span>
                        </div>

                        {/* High-Contrast Grand Total */}
                        <div className="flex justify-between items-baseline pt-1 mt-1 border-t border-zinc-300 font-black text-sm text-zinc-950">
                          <span className="text-label-md tracking-wider">
                            {language === 'th' ? 'ยอดรวมสุทธิ (TOTAL):' : 'TOTAL DUE:'}
                          </span>
                          <span className="text-base sm:text-lg font-mono tracking-tight">
                            {formatMoney(totals.grandTotal)}
                          </span>
                        </div>

                        {/* Dual Currency Conversion If Active */}
                        {secondaryTotals && activeSecondaryCurrency && (
                          <div className="flex justify-between text-[10px] text-zinc-600 font-mono pt-0.5">
                            <span>{language === 'th' ? `เทียบเท่า (${activeSecondaryCurrency}):` : `Approx (${activeSecondaryCurrency}):`}</span>
                            <span className="font-bold">{formatMoney(secondaryTotals.grandTotal)}</span>
                          </div>
                        )}
                      </div>

                      {/* Payment Tender Simulation */}
                      <div className="text-[10.5px] text-zinc-700 space-y-0.5 pb-3 mb-2 border-b border-dashed border-zinc-400">
                        <div className="flex justify-between">
                          <span>{language === 'th' ? 'วิธีการชำระ:' : 'Tender Method:'}</span>
                          <span className="font-bold text-zinc-900">
                            {effectiveOrder.status === 'draft'
                              ? language === 'th' ? 'ประมาณการ (Estimate)' : 'Draft Estimate'
                              : 'Cash / Credit'}
                          </span>
                        </div>
                        <div className="flex justify-between text-zinc-500">
                          <span>{language === 'th' ? 'จำนวนเงินที่รับ:' : 'Amount Tendered:'}</span>
                          <span className="font-mono">{formatMoney(totals.grandTotal)}</span>
                        </div>
                        <div className="flex justify-between text-zinc-500">
                          <span>{language === 'th' ? 'เงินทอน:' : 'Change Given:'}</span>
                          <span className="font-mono">฿0.00</span>
                        </div>
                      </div>

                      {/* QR Code & Barcode Verification */}
                      <div className="flex flex-col items-center justify-center py-2 space-y-1">
                        <div className="p-1.5 bg-white border border-zinc-300 rounded-sm">
                          <QRCodeSVG
                            value={`https://prodx.pos/receipt/${effectiveOrder.orderNumber}?total=${totals.grandTotal.amountInCents}`}
                            size={paperWidth === '58mm' ? 84 : 96}
                            level="M"
                          />
                        </div>
                        <div className="text-[9px] text-zinc-500 tracking-widest uppercase font-mono">
                          SCAN FOR E-TAX & VERIFY
                        </div>
                        <div className="text-[10px] text-zinc-700 font-mono font-bold tracking-wider">
                          *{effectiveOrder.orderNumber}*
                        </div>
                      </div>

                      {/* Store Footer Note */}
                      <div className="text-center pt-2 pb-1 space-y-1 text-[9.5px] text-zinc-500 leading-tight">
                        <p className="font-semibold text-zinc-700">
                          {language === 'th' ? 'ขอบคุณที่ใช้บริการ' : 'THANK YOU FOR SHOPPING WITH US!'}
                        </p>
                        <p>
                          {language === 'th'
                            ? 'สินค้าเปลี่ยนคืนได้ภายใน 7 วันพร้อมใบเสร็จนี้'
                            : 'Goods exchangeable within 7 days with this slip.'}
                        </p>
                        <p className="font-mono text-[8.5px] opacity-75 pt-1">
                          PRODX POS · ENTERPRISE ESC/POS CLOUD
                        </p>
                      </div>

                      {/* Bottom Serrated Jagged Paper Tear Edge */}
                      <div className="absolute -bottom-2 left-0 right-0 h-2 overflow-hidden flex pointer-events-none">
                        {Array.from({ length: 32 }).map((_, i) => (
                          <div
                            key={i}
                            className="w-3 h-3 bg-white rotate-45 transform origin-top-left shrink-0 shadow-2xs"
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 4.2 VIEW MODE: Raw Monospace Text (ESC/POS Character Grid) */}
                {viewMode === 'monospace' && (
                  <div className="w-full h-full flex flex-col">
                    <div className="flex items-center justify-between text-xs text-text/60 mb-2 px-1">
                      <span className="text-label-xs">
                        {language === 'th' ? 'ผังตัวอักษรเครื่องพิมพ์ความร้อน' : 'ESC/POS Character Matrix'} ({effectiveTemplate.characterColumns} cols)
                      </span>
                      <span className="font-mono text-[11px]">
                        {formattedReceipt.escposBytes.length} bytes
                      </span>
                    </div>
                    <div className="flex-1 bg-zinc-950 text-emerald-400 p-4 rounded-2xl font-mono text-xs overflow-x-auto select-text shadow-inner border border-zinc-800">
                      <pre className="whitespace-pre leading-snug font-mono text-[11px] sm:text-xs no-scrollbar">
                        {formattedReceipt.text}
                      </pre>
                    </div>
                  </div>
                )}

                {/* 4.3 VIEW MODE: Structured Breakdown Table */}
                {viewMode === 'structured' && (
                  <div className="w-full space-y-3">
                    {/* Store & Register Card */}
                    <div className="p-4 rounded-2xl bg-card border border-border border-crisp text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-label-sm text-text/60">
                          {language === 'th' ? 'ข้อมูลสาขาและเทอร์มินอล' : 'Store & Terminal'}
                        </span>
                        <Badge variant="primary" size="xs">
                          {effectiveOrder.registerId}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                        <div>
                          <span className="text-text/50 block text-[10px] uppercase">Store</span>
                          <span className="font-bold text-text truncate block">{currentStore?.name}</span>
                        </div>
                        <div>
                          <span className="text-text/50 block text-[10px] uppercase">Cashier</span>
                          <span className="font-bold text-text truncate block">{cashierName}</span>
                        </div>
                        <div>
                          <span className="text-text/50 block text-[10px] uppercase">Date & Time</span>
                          <span className="text-text truncate block">{formattedDate}</span>
                        </div>
                        <div>
                          <span className="text-text/50 block text-[10px] uppercase">Tax ID</span>
                          <span className="text-text truncate block">{taxId}</span>
                        </div>
                      </div>
                    </div>

                    {/* Items List */}
                    <div className="p-4 rounded-2xl bg-card border border-border border-crisp space-y-2">
                      <div className="flex items-center justify-between text-xs pb-1 border-b border-border">
                        <span className="text-label-sm text-text/60">
                          {language === 'th' ? `รายการสินค้า (${items.length})` : `Cart Items (${items.length})`}
                        </span>
                        <span className="text-label-xs text-text/50 font-mono">
                          {totals.totalItemsCount} units
                        </span>
                      </div>
                      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                        {items.map((item) => (
                          <div
                            key={item.lineId}
                            className="p-2 rounded-xl bg-background/60 border border-border/70 flex items-center justify-between text-xs"
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <div className="font-semibold text-text truncate">{item.product.name}</div>
                              <div className="text-[10px] text-text/50 font-mono">
                                {item.quantity} × {formatMoney(item.unitPrice)}
                                {item.discountBps > 0 && ` (-${(item.discountBps / 100).toFixed(0)}%)`}
                              </div>
                            </div>
                            <span className="font-mono font-bold text-text shrink-0">
                              {formatMoney(item.lineTotal)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Financial Summary */}
                    <div className="p-4 rounded-2xl bg-card border border-border border-crisp text-xs space-y-1.5 font-mono">
                      <div className="flex justify-between text-text/70">
                        <span>Subtotal (Gross):</span>
                        <span>{formatMoney(totals.grossSubtotal)}</span>
                      </div>
                      {totals.itemDiscounts.amountInCents > 0 && (
                        <div className="flex justify-between text-rose-500">
                          <span>Item Discounts:</span>
                          <span>-{formatMoney(totals.itemDiscounts)}</span>
                        </div>
                      )}
                      {totals.orderDiscount.amountInCents > 0 && (
                        <div className="flex justify-between text-rose-500">
                          <span>Order Discount:</span>
                          <span>-{formatMoney(totals.orderDiscount)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-text/70">
                        <span>Taxable Net:</span>
                        <span>{formatMoney(totals.netSubtotal)}</span>
                      </div>
                      <div className="flex justify-between text-text/70">
                        <span>VAT 7% Included:</span>
                        <span>{formatMoney(totals.totalTax)}</span>
                      </div>
                      <div className="flex justify-between items-baseline pt-2 border-t border-border font-black text-text text-sm">
                        <span className="text-label-md">GRAND TOTAL:</span>
                        <span className="text-base text-primary font-bold">
                          {formatMoney(totals.grandTotal)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ========================================================================= */}
          {/* 5. SLIDE-OVER FOOTER: Action Buttons ('Print' and 'Email')                */}
          {/* ========================================================================= */}
          <div className="p-4 sm:p-5 border-t border-crisp border-border bg-card shrink-0 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              {/* Email Action Trigger */}
              <Button
                type="button"
                id="thermal-email-action-btn"
                variant="outline"
                size="md"
                disabled={!hasItems}
                onClick={() => {
                  playScannerSound('click');
                  setIsEmailDrawerOpen(!isEmailDrawerOpen);
                }}
                leftIcon={<Mail className="h-4 w-4" />}
                className="flex-1 text-xs sm:text-sm font-semibold min-h-[44px]"
              >
                {language === 'th' ? 'ส่งอีเมล' : 'Email Receipt'}
              </Button>

              {/* Primary Print Action CTA */}
              <Button
                type="button"
                id="thermal-print-action-btn"
                variant="primary"
                size="md"
                disabled={!hasItems || isPrinting}
                isLoading={isPrinting}
                onClick={handlePrint}
                leftIcon={<Printer className="h-4 w-4" />}
                className="flex-1 text-xs sm:text-sm font-bold min-h-[44px] shadow-sm active:scale-98"
              >
                {language === 'th' ? 'พิมพ์สลิป' : 'Print Receipt'}
                <span className="hidden sm:inline-block ml-1 opacity-70 text-[11px] font-mono">
                  (⌘P)
                </span>
              </Button>
            </div>

            {/* Quick Helper Subtext */}
            <div className="flex items-center justify-between text-[11px] text-text/50 px-1">
              <span>
                {language === 'th' ? 'ขนาดกระดาษความร้อน: ' : 'Active Roll: '}
                <strong className="text-text/80 font-mono">{paperWidth}</strong>
              </span>
              <button
                type="button"
                onClick={onClose}
                className="hover:text-text cursor-pointer transition-colors"
              >
                {language === 'th' ? 'ปิดหน้าต่าง' : 'Dismiss Preview'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
