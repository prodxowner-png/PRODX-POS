/**
 * PRODX POS - Quick-Pay Drawer for Store Managers
 * 
 * Provides instantaneous single-tap checkout completion from the right-hand slide-over drawer.
 * Supports Cash (with instant change calculation), Card (auto-auth code), and PromptPay QR.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { useOffline } from '../../context/OfflineContext';
import { useReceiptPrinter } from '../../context/ReceiptPrinterContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { useSettings } from '../../context/SettingsContext';
import { Drawer } from '../../components/common/Drawer';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { ReceiptPrintModal } from '../../components/receipt/ReceiptPrintModal';
import { FullTaxInvoiceModal } from '../../components/receipt/FullTaxInvoiceModal';
import { SupervisorAuthModal } from '../../components/auth/SupervisorAuthModal';
import type { User as AuthUser } from '../../domain/auth';
import type { CheckoutRequest } from '../../adapters/types';
import { createProductionSupervisorAuthorizationApi } from '../../adapters/productionSupervisorAuthorizationApi';
import { createProductionDiscountPolicyApi, getLocalDiscountPolicy } from '../../adapters/productionDiscountPolicyApi';
import { hasProductionUrl } from '../../adapters/env';
import { playScannerSound } from '../../services/soundService';
import { triggerHaptic } from '../../services/hapticService';
import { customerDisplayService } from '../../services/customerDisplayChannel';
import { createOrderTransactionApi } from '../../adapters/orderTransactionApiFactory';
import {
  PaymentMethod,
  TenderPayment,
  Order,
} from '../../domain/order';
import {
  createMoney,
  formatMoney,
  subtractMoney,
} from '../../domain/money';
import {
  Zap,
  Banknote,
  CreditCard,
  QrCode,
  CheckCircle2,
  Printer,
  FileText,
  ShieldCheck,
  Lock,
  User,
  ArrowRight,
  Sparkles,
  AlertCircle,
  RotateCcw,
  ShoppingBag,
  Clock,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  KeyRound,
  Check,
  Tag,
} from 'lucide-react';

export interface QuickPayDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenFullPaymentModal?: () => void;
  onOrderCompleted?: (order: Order) => void;
}

export const QuickPayDrawer: React.FC<QuickPayDrawerProps> = ({
  isOpen,
  onClose,
  onOpenFullPaymentModal,
  onOrderCompleted,
}) => {
  const { session, staffUsers, getStaffPin } = useAuth();
  const { config } = useSettings();
  const productionOrderApi = createOrderTransactionApi(session?.token ?? '');
  const { items, totals, customer, clearCart } = useCart();
  const { isOnline, queueOutboxItem } = useOffline();
  const { printerConfig, printReceipt, kickCashDrawer } = useReceiptPrinter();
  const { addToast } = useToast();
  const { language } = useLanguage();

  // Active user manager check
  const isActualManager = useMemo(() => {
    return session?.currentUser?.role === 'manager' || session?.currentUser?.role === 'admin';
  }, [session?.currentUser?.role]);

  // Authorization state: auto-granted if manager/admin, else unlocked via supervisor PIN
  const [isAuthorized, setIsAuthorized] = useState<boolean>(isActualManager);
  const [pinInput, setPinInput] = useState<string>('');
  const [pinError, setPinError] = useState<string | null>(null);

  // Quick-pay state
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingMethod, setProcessingMethod] = useState<PaymentMethod | null>(null);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [showQrPreview, setShowQrPreview] = useState<boolean>(false);
  const [showItemsBreakdown, setShowItemsBreakdown] = useState<boolean>(false);
  const [pendingDiscountCheckout, setPendingDiscountCheckout] = useState<CheckoutRequest | null>(null);
  const [isDiscountSupervisorModalOpen, setIsDiscountSupervisorModalOpen] = useState(false);

  // Cash tender preset (defaults to exact grandTotal in cents)
  const [customCashTenderCents, setCustomCashTenderCents] = useState<number | null>(null);

  // Modals for post-checkout
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState<boolean>(false);
  const [isTaxInvoiceModalOpen, setIsTaxInvoiceModalOpen] = useState<boolean>(false);

  // Reset drawer state when opened/closed
  useEffect(() => {
    if (isOpen) {
      triggerHaptic('medium');
      setIsAuthorized(isActualManager);
      setPinInput('');
      setPinError(null);
      setCompletedOrder(null);
      setPendingDiscountCheckout(null);
      setIsDiscountSupervisorModalOpen(false);
      setIsProcessing(false);
      setProcessingMethod(null);
      setShowQrPreview(false);
      setCustomCashTenderCents(null);
    }
  }, [isOpen, isActualManager]);

  const grandTotalCents = totals.grandTotal.amountInCents;
  const currency = totals.grandTotal.currency;
  const hasItems = items.length > 0;

  // Compute cash presets for Thai Baht / standard currency
  const cashDenominations = useMemo(() => {
    if (grandTotalCents <= 0) return [];
    const presets: Array<{ label: string; amountCents: number; changeCents: number }> = [
      {
        label: language === 'th' ? 'พอดี' : 'Exact',
        amountCents: grandTotalCents,
        changeCents: 0,
      },
    ];

    // Round up to next 100 (10,000 cents)
    const next100 = Math.ceil((grandTotalCents + 1) / 10000) * 10000;
    if (next100 > grandTotalCents) {
      presets.push({
        label: `+${formatMoney(createMoney(next100 - grandTotalCents, currency))}`,
        amountCents: next100,
        changeCents: next100 - grandTotalCents,
      });
    }

    // Round up to next 500 (50,000 cents)
    const next500 = Math.ceil((grandTotalCents + 1) / 50000) * 50000;
    if (next500 > grandTotalCents && !presets.some((p) => p.amountCents === next500)) {
      presets.push({
        label: formatMoney(createMoney(next500, currency)),
        amountCents: next500,
        changeCents: next500 - grandTotalCents,
      });
    }

    // Round up to next 1,000 (100,000 cents)
    const next1000 = Math.ceil((grandTotalCents + 1) / 100000) * 100000;
    if (next1000 > grandTotalCents && !presets.some((p) => p.amountCents === next1000)) {
      presets.push({
        label: formatMoney(createMoney(next1000, currency)),
        amountCents: next1000,
        changeCents: next1000 - grandTotalCents,
      });
    }

    return presets;
  }, [grandTotalCents, currency, language]);

  // Active cash tendered amount
  const effectiveCashTenderCents = customCashTenderCents ?? grandTotalCents;
  const cashChangeDueCents = Math.max(0, effectiveCashTenderCents - grandTotalCents);

  // Handle PIN verification for cashiers
  const handleVerifyPin = () => {
    const trimmed = pinInput.trim();
    if (!trimmed) {
      setPinError(language === 'th' ? 'กรุณากรอกรหัส PIN' : 'Please enter PIN');
      return;
    }

    // Only persisted, role-scoped manager credentials are accepted.
    const isStaffManagerMatch = staffUsers?.some(
      (u) => (u.role === 'manager' || u.role === 'admin') && getStaffPin(u.id) === trimmed
    );

    if (isStaffManagerMatch) {
      triggerHaptic('medium');
      playScannerSound('click');
      setIsAuthorized(true);
      setPinError(null);
      addToast({
        title: language === 'th' ? 'ปลดล็อกสิทธิ์ผู้จัดการสำเร็จ' : 'Manager Access Authorized',
        message:
          language === 'th'
            ? 'เปิดใช้งานระบบ Quick-Pay แล้ว'
            : 'Quick-Pay single-tap checkout authorized.',
        type: 'success',
      });
    } else {
      triggerHaptic('heavy');
      setPinError(
        language === 'th'
          ? 'รหัส PIN ผู้จัดการไม่ถูกต้อง'
          : 'Invalid Manager PIN'
      );
    }
  };

  // Execute single-tap checkout
  const handleExecuteQuickPay = async (method: PaymentMethod, tenderAmountCents?: number, authorizedPayload?: CheckoutRequest) => {
    if (!session || !hasItems || isProcessing || !isAuthorized) return;

    triggerHaptic('heavy');
    playScannerSound('click');
    setIsProcessing(true);
    setProcessingMethod(method);

    const idempotencyKey = authorizedPayload?.idempotencyKey ?? `idemp-quickpay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const finalTenderCents =
      method === 'cash' ? (tenderAmountCents ?? effectiveCashTenderCents) : grandTotalCents;
    const changeCents = Math.max(0, finalTenderCents - grandTotalCents);

    const tenderPayment: TenderPayment = authorizedPayload?.payments[0] ?? {
      id: `tnd-qp-${Date.now()}`,
      method,
      amount: totals.grandTotal,
      tenderedCash: method === 'cash' ? createMoney(finalTenderCents, currency) : undefined,
      changeGiven: method === 'cash' ? createMoney(changeCents, currency) : undefined,
      authCode:
        method === 'card'
          ? `AUTH-QP-${Math.floor(100000 + Math.random() * 900000)}`
          : method === 'qr_digital'
          ? `QR-QP-${Date.now().toString().slice(-6)}`
          : undefined,
      cardLastFour: method === 'card' ? '••••' : undefined,
      terminalReference:
        method === 'card'
          ? config.payments?.terminalId || 'TRM-EDC-01'
          : method === 'qr_digital'
          ? 'PROMPTPAY-CONFIRMED'
          : undefined,
      timestamp: new Date().toISOString(),
    };

    const orderDiscountBps = totals.grossSubtotal.amountInCents > totals.itemDiscounts.amountInCents
      ? Math.round(totals.orderDiscount.amountInCents / (totals.grossSubtotal.amountInCents - totals.itemDiscounts.amountInCents) * 10000)
      : 0;
    const checkoutPayload: CheckoutRequest = authorizedPayload ?? {
      idempotencyKey,
      storeId: session.currentStore.id,
      registerId: session.registerId,
      cashierId: session.currentUser.id,
      customer: customer
        ? {
            id: customer.id,
            name: customer.name,
            phone: customer.phone,
            email: customer.email,
          }
        : undefined,
      items,
      totals,
      orderDiscountBps,
      payments: [tenderPayment],
      notes: `Quick-Pay 1-Tap Checkout by ${session.currentUser.name} (${session.currentUser.role.toUpperCase()})`,
      isOfflineSubmission: !isOnline,
    };

    try {
      const hasDiscount = items.some((item) => item.discountBps > 0) || totals.orderDiscount.amountInCents > 0;
      if (authorizedPayload && !isOnline && hasProductionUrl()) throw new Error('A server-issued discount approval cannot be replayed while offline.');
      if (!authorizedPayload && hasDiscount) {
        if (!isOnline && hasProductionUrl()) throw new Error(language === 'th' ? 'ไม่สามารถใช้ส่วนลดออฟไลน์ได้ เนื่องจากต้องยืนยันสิทธิ์ผู้จัดการกับเซิร์ฟเวอร์' : 'Discounted Quick-Pay requires an online server authorization.');
        const policy = hasProductionUrl() ? await createProductionDiscountPolicyApi(session.token).getPolicy() : getLocalDiscountPolicy();
        const grossCents = totals.grossSubtotal.amountInCents;
        const effectiveDiscountBps = grossCents > 0 ? Math.round((grossCents - totals.grandTotal.amountInCents) / grossCents * 10000) : 0;
        const maxDiscountBps = Math.max(effectiveDiscountBps, orderDiscountBps, ...items.map((item) => item.discountBps), 0);
        if (policy.requireSupervisorApproval && maxDiscountBps > policy.maxDiscountWithoutApprovalBps) {
          setPendingDiscountCheckout(checkoutPayload);
          setIsDiscountSupervisorModalOpen(true);
          setIsProcessing(false);
          setProcessingMethod(null);
          return;
        }
      }
      let finalOrder: Order;

      if (!isOnline) {
        // Queue in offline outbox
        await queueOutboxItem('order_transaction', idempotencyKey, checkoutPayload);

        finalOrder = {
          id: `ord-offline-${Date.now()}`,
          orderNumber: `ORD-OFFLINE-${Date.now().toString().slice(-5)}`,
          idempotencyKey,
          storeId: session.currentStore.id,
          registerId: session.registerId,
          cashierId: session.currentUser.id,
          cashierName: session.currentUser.name,
          customer: customer || undefined,
          items,
          totals,
          payments: [tenderPayment],
          status: 'pending_sync_offline',
          createdAt: new Date().toISOString(),
          notes: checkoutPayload.notes,
        };

        addToast({
          title: language === 'th' ? 'บันทึกคำสั่งซื้อออฟไลน์ (Quick-Pay)' : 'Quick-Pay Saved Offline',
          message:
            language === 'th'
              ? 'บันทึกใน Outbox เรียบร้อยและรอซิงก์เมื่อออนไลน์'
              : 'Saved to local outbox. Will sync automatically when online.',
          type: 'warning',
        });
      } else {
        // Live server checkout
        const response = await productionOrderApi.createOrder(checkoutPayload);
        finalOrder = response.order;

        addToast({
          title: language === 'th' ? 'ชำระเงินด่วนสำเร็จ (Quick-Pay)' : 'Quick-Pay Completed',
          message:
            language === 'th'
              ? `คำสั่งซื้อ #${finalOrder.orderNumber} ยืนยันเรียบร้อยแล้ว`
              : `Order #${finalOrder.orderNumber} committed successfully.`,
          type: 'success',
        });
      }

      // Hardware actions
      if (method === 'cash') {
        kickCashDrawer();
      }

      if (printerConfig.autoPrintOnCheckout) {
        printReceipt(finalOrder);
      }

      // Sound & feedback
      playScannerSound('payment_success');

      // Sync customer display
      customerDisplayService.publish({
        status: 'completed',
        storeName: session.currentStore.name,
        items,
        totals,
        customer: customer || undefined,
        completedOrder: finalOrder,
        lastUpdated: new Date().toISOString(),
      });

      // Dispatch global completion event
      window.dispatchEvent(
        new CustomEvent('prodx:order-completed', { detail: finalOrder })
      );

      // Notify callback & state
      onOrderCompleted?.(finalOrder);
      setCompletedOrder(finalOrder);

      // Clear the active cart
      clearCart();
    } catch (err: any) {
      console.error('[QuickPayDrawer] Failed to complete quick pay:', err);
      addToast({
        title: language === 'th' ? 'ชำระเงินไม่สำเร็จ' : 'Quick-Pay Failed',
        message: err?.message || (language === 'th' ? 'เกิดข้อผิดพลาดในการประมวลผล' : 'Transaction failed.'),
        type: 'error',
      });
    } finally {
      setIsProcessing(false);
      setProcessingMethod(null);
    }
  };

  const handleDiscountSupervisorAuthorized = async (supervisor: AuthUser, _notes?: string, proof?: string) => {
    if (!pendingDiscountCheckout) return;
    if (!hasProductionUrl()) {
      const payload = pendingDiscountCheckout;
      setPendingDiscountCheckout(null);
      setIsDiscountSupervisorModalOpen(false);
      await handleExecuteQuickPay(payload.payments[0].method, payload.payments[0].tenderedCash?.amountInCents, payload);
      return;
    }
    if (!session?.token || !proof || proof.length < 20) return;
    try {
      const grant = await createProductionSupervisorAuthorizationApi(session.token).authorize({
        action: 'discount', checkout: pendingDiscountCheckout,
        supervisorUserId: supervisor.id, supervisorAccessToken: proof,
      });
      const payload = { ...pendingDiscountCheckout, supervisorAuthorizationToken: grant.authorizationToken };
      setPendingDiscountCheckout(null);
      setIsDiscountSupervisorModalOpen(false);
      await handleExecuteQuickPay(payload.payments[0].method, payload.payments[0].tenderedCash?.amountInCents, payload);
    } catch (error) {
      addToast({ title: language === 'th' ? 'อนุมัติส่วนลดไม่สำเร็จ' : 'Discount Approval Failed', message: error instanceof Error ? error.message : String(error), type: 'error' });
    }
  };

  const handleNextSale = () => {
    triggerHaptic('medium');
    playScannerSound('click');
    setCompletedOrder(null);
    onClose();
  };

  return (
    <>
      <Drawer
        id="quickpay-drawer"
        isOpen={isOpen}
        onClose={onClose}
        title={language === 'th' ? 'จ่ายด่วน (Quick-Pay)' : 'Quick-Pay Checkout'}
        description={
          language === 'th'
            ? 'เลือกช่องทางชำระเงินเพื่อปิดการขายด้วยการแตะครั้งเดียวสำหรับผู้จัดการ'
            : 'Single-tap checkout completion for store managers'
        }
        side="right"
        width="w-full sm:max-w-lg"
      >
        <div className="flex flex-col h-full space-y-4">
          {/* ========================================================================= */}
          {/* 1. STATE A: TRANSACTION COMPLETED VIEW                                    */}
          {/* ========================================================================= */}
          {completedOrder ? (
            <div className="flex-1 flex flex-col justify-between py-2 animate-in fade-in zoom-in-95 duration-200">
              <div className="space-y-4">
                {/* Success Banner */}
                <div className="p-4 rounded-2xl bg-emerald-500/10 border-2 border-emerald-500/40 text-center space-y-2 shadow-sm">
                  <div className="mx-auto w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md animate-bounce">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <div>
                    <span className="text-caption font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                      {language === 'th' ? 'บันทึกคำสั่งซื้อสำเร็จ' : 'Transaction Completed'}
                    </span>
                    <h3 className="text-xl font-black font-mono text-text">
                      {completedOrder.orderNumber}
                    </h3>
                  </div>
                  <Badge variant="success" size="sm" className="font-mono font-bold">
                    {completedOrder.payments[0]?.method === 'cash'
                      ? language === 'th'
                        ? '💵 ชำระด้วยเงินสด (Cash)'
                        : '💵 Paid with Cash'
                      : completedOrder.payments[0]?.method === 'card'
                      ? language === 'th'
                        ? '💳 ชำระด้วยบัตร (Card)'
                        : '💳 Paid with Card'
                      : language === 'th'
                      ? '📱 สแกนจ่าย QR (PromptPay)'
                      : '📱 Paid via PromptPay QR'}
                  </Badge>
                </div>

                {/* Financial Summary Card */}
                <div className="p-4 rounded-2xl border border-crisp border-border bg-card/60 space-y-3 shadow-2xs">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-text/70">{language === 'th' ? 'ยอดรวมทั้งสิ้น' : 'Grand Total'}</span>
                    <span className="font-mono font-black text-base text-primary">
                      {formatMoney(completedOrder.totals.grandTotal)}
                    </span>
                  </div>

                  {completedOrder.payments[0]?.tenderedCash && (
                    <div className="flex justify-between items-center text-sm pt-2 border-t border-border/40">
                      <span className="text-text/70">{language === 'th' ? 'รับเงินสดมา' : 'Cash Tendered'}</span>
                      <span className="font-mono font-bold text-text">
                        {formatMoney(completedOrder.payments[0].tenderedCash)}
                      </span>
                    </div>
                  )}

                  {completedOrder.payments[0]?.changeGiven &&
                    completedOrder.payments[0].changeGiven.amountInCents > 0 && (
                      <div className="flex justify-between items-center p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-800 dark:text-emerald-200">
                        <span className="font-bold text-sm">
                          {language === 'th' ? 'เงินทอน (Change Due)' : 'Change Due'}
                        </span>
                        <span className="font-mono font-black text-xl text-emerald-600 dark:text-emerald-400">
                          {formatMoney(completedOrder.payments[0].changeGiven)}
                        </span>
                      </div>
                    )}

                  {completedOrder.customer && (
                    <div className="flex items-center gap-2 pt-2 border-t border-border/40 text-xs text-text/70">
                      <User className="h-3.5 w-3.5 text-primary" />
                      <span>{completedOrder.customer.name}</span>
                      <span className="text-text/40">•</span>
                      <span>{completedOrder.customer.phone}</span>
                    </div>
                  )}
                </div>

                {/* Fast Receipt Actions */}
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-crisp border-border font-bold text-xs"
                    leftIcon={<Printer className="h-3.5 w-3.5" />}
                    onClick={() => {
                      triggerHaptic('tap');
                      setIsReceiptModalOpen(true);
                    }}
                  >
                    {language === 'th' ? 'พิมพ์ใบเสร็จ' : 'Print Receipt'}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-crisp border-border font-bold text-xs"
                    leftIcon={<FileText className="h-3.5 w-3.5" />}
                    onClick={() => {
                      triggerHaptic('tap');
                      setIsTaxInvoiceModalOpen(true);
                    }}
                  >
                    {language === 'th' ? 'ใบกำกับภาษี' : 'Full Tax Invoice'}
                  </Button>
                </div>
              </div>

              {/* Bottom Next Sale Button */}
              <div className="pt-4 border-t border-crisp border-border">
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  className="w-full font-bold shadow-md theme-btn-radius active-scale"
                  leftIcon={<Sparkles className="h-4 w-4" />}
                  onClick={handleNextSale}
                >
                  {language === 'th' ? 'เริ่มการขายถัดไป (Next Sale)' : 'Start Next Sale'}
                </Button>
              </div>
            </div>
          ) : !hasItems ? (
            /* ========================================================================= */
            /* 2. STATE B: EMPTY CART                                                    */
            /* ========================================================================= */
            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 space-y-3 my-auto">
              <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center text-text/40 border border-border/60">
                <ShoppingBag className="h-7 w-7" />
              </div>
              <h4 className="text-base font-bold text-text">
                {language === 'th' ? 'ไม่มีสินค้าในตะกร้า' : 'No Items in Cart'}
              </h4>
              <p className="text-xs text-text/60 max-w-xs leading-relaxed">
                {language === 'th'
                  ? 'กรุณาเลือกหรือสแกนสินค้าเข้าสู่ตะกร้าก่อนใช้งาน Quick-Pay'
                  : 'Add or scan items to your cart before utilizing Quick-Pay.'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                className="mt-2 font-bold text-xs border-crisp border-border"
              >
                {language === 'th' ? 'กลับไปที่แคตตาล็อก' : 'Return to Catalog'}
              </Button>
            </div>
          ) : (
            /* ========================================================================= */
            /* 3. STATE C: ACTIVE QUICK-PAY WORKFLOW                                     */
            /* ========================================================================= */
            <div className="flex-1 flex flex-col justify-between space-y-4 overflow-y-auto custom-scrollbar pr-1">
              <div className="space-y-4">
                {/* Manager Authority / Security Pill */}
                {isAuthorized ? (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: 0.05 }}
                    className="p-2.5 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-between text-xs shadow-2xs"
                  >
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded-md bg-primary text-white shrink-0">
                        <ShieldCheck className="h-3.5 w-3.5" />
                      </div>
                      <div>
                        <span className="font-black text-text block">
                          {language === 'th' ? 'สิทธิ์ผู้จัดการ (Manager Quick-Pay)' : 'Manager Quick-Pay Mode'}
                        </span>
                        <span className="text-[10px] text-text/70">
                          {session?.currentUser?.name} ({session?.currentUser?.role?.toUpperCase()})
                        </span>
                      </div>
                    </div>
                    <Badge variant="success" size="xs" dot>
                      {language === 'th' ? 'อนุมัติแล้ว' : 'Authorized'}
                    </Badge>
                  </motion.div>
                ) : (
                  /* Cashier PIN Unlock Card */
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: 0.05 }}
                    className="p-3.5 rounded-xl bg-amber-500/10 border-2 border-amber-500/40 space-y-3"
                  >
                    <div className="flex items-center gap-2">
                      <div className="p-1 rounded-md bg-amber-500 text-white shrink-0">
                        <Lock className="h-4 w-4" />
                      </div>
                      <div>
                        <span className="font-bold text-xs text-amber-900 dark:text-amber-200 block">
                          {language === 'th' ? 'ต้องใช้รหัส PIN ผู้จัดการ' : 'Manager Authorization Required'}
                        </span>
                        <span className="text-[10px] text-amber-800/70 dark:text-amber-300/70">
                          {language === 'th'
                            ? 'กรอก PIN ผู้จัดการเพื่อปลดล็อกการชำระเงินด่วน'
                            : 'Enter supervisor PIN to unlock single-tap checkout'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <input
                          type="password"
                          maxLength={6}
                          value={pinInput}
                          onChange={(e) => {
                            setPinInput(e.target.value);
                            setPinError(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleVerifyPin();
                          }}
                          placeholder="••••"
                          className="w-full h-9 px-3 rounded-lg border-crisp border border-border bg-card text-center font-mono text-sm tracking-widest text-text focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={handleVerifyPin}
                        className="h-9 px-4 font-bold text-xs bg-amber-600 hover:bg-amber-500 text-white"
                      >
                        {language === 'th' ? 'ปลดล็อก' : 'Unlock'}
                      </Button>
                    </div>

                    {pinError && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span>{pinError}</span>
                      </p>
                    )}
                  </motion.div>
                )}

                {/* Grand Total Hero Display */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: 0.09 }}
                  className="p-4 rounded-2xl bg-card border-crisp border border-border flex items-center justify-between shadow-2xs"
                >
                  <div>
                    <span className="text-caption font-bold text-text/60 uppercase tracking-wider">
                      {language === 'th' ? 'ยอดที่ต้องชำระ' : 'Amount Due'}
                    </span>
                    <div className="flex items-baseline gap-2 mt-0.5">
                      <span className="text-2xl sm:text-3xl font-black font-mono text-primary">
                        {formatMoney(totals.grandTotal)}
                      </span>
                      <span className="text-xs text-text/60 font-medium">
                        ({totals.totalItemsCount} {language === 'th' ? 'รายการ' : 'items'})
                      </span>
                    </div>
                  </div>

                  {customer ? (
                    <div className="text-right">
                      <Badge variant="primary" size="xs" className="font-bold">
                        {customer.name}
                      </Badge>
                      <span className="text-[10px] text-text/50 font-mono block mt-0.5">
                        {customer.loyaltyPoints} {language === 'th' ? 'แต้ม' : 'pts'}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-text/40 font-medium">
                      {language === 'th' ? 'ลูกค้าทั่วไป' : 'Walk-in Guest'}
                    </span>
                  )}
                </motion.div>

                {/* Collapsible Items Preview */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: 0.13 }}
                  className="border border-crisp border-border/80 rounded-xl overflow-hidden bg-background/50"
                >
                  <button
                    type="button"
                    onClick={() => setShowItemsBreakdown(!showItemsBreakdown)}
                    className="w-full px-3 py-2 flex items-center justify-between text-xs font-bold text-text/70 hover:text-text hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <span className="flex items-center gap-1.5">
                      <ShoppingBag className="h-3.5 w-3.5 text-primary" />
                      <span>
                        {language === 'th' ? 'ดูรายการสินค้าในบิล' : 'View Cart Items'}{' '}
                        ({items.length})
                      </span>
                    </span>
                    {showItemsBreakdown ? (
                      <ChevronUp className="h-3.5 w-3.5 text-text/50" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-text/50" />
                    )}
                  </button>

                  {showItemsBreakdown && (
                    <div className="p-2.5 max-h-36 overflow-y-auto space-y-1.5 border-t border-border/60 bg-card/60 text-xs">
                      {items.map((item) => (
                        <div key={item.lineId} className="flex justify-between items-center text-[11px]">
                          <span className="truncate pr-2 text-text">
                            {item.quantity}x {item.product.name}
                          </span>
                          <span className="font-mono font-bold text-text/80 shrink-0">
                            {formatMoney(item.lineTotal)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </motion.div>

                {/* ===================================================================== */}
                {/* 4. THREE COMMON PAYMENT TYPES (Single-Tap Action Cards)               */}
                {/* ===================================================================== */}
                <div className="space-y-3">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: 0.16 }}
                    className="flex items-center justify-between"
                  >
                    <span className="text-xs font-black uppercase tracking-wider text-text/70 flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                      <span>{language === 'th' ? 'เลือกช่องทางชำระเงินด่วน (แตะครั้งเดียว)' : 'Select Quick-Pay Type (1-Tap)'}</span>
                    </span>
                  </motion.div>

                  {/* 1. CASH (เงินสด) */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: 0.19 }}
                    className="p-3.5 rounded-2xl border-2 border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/60 transition-all space-y-2.5 shadow-2xs group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-emerald-500 text-white shadow-xs">
                          <Banknote className="h-5 w-5" />
                        </div>
                        <div>
                          <span className="font-black text-sm text-text block">
                            {language === 'th' ? 'เงินสด (Cash)' : 'Cash'}
                          </span>
                          <span className="text-[11px] text-text/60">
                            {language === 'th' ? 'ชำระเงินสด เปิดลิ้นชักทันที' : 'Single-tap cash receipt & drawer kick'}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        id="quickpay-btn-cash-exact"
                        disabled={!isAuthorized || isProcessing}
                        onClick={() => handleExecuteQuickPay('cash', effectiveCashTenderCents)}
                        className={`min-h-[44px] px-4 rounded-xl font-black text-xs sm:text-sm flex items-center gap-1.5 transition-all cursor-pointer active-scale shadow-sm ${
                          !isAuthorized || isProcessing
                            ? 'bg-muted text-text/40 cursor-not-allowed'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                      >
                        {isProcessing && processingMethod === 'cash' ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Check className="h-4 w-4" />
                            <span>
                              {language === 'th' ? 'ชำระพอดี' : 'Pay Exact'}
                            </span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Cash Denomination Shortcuts */}
                    <div className="pt-2 border-t border-emerald-500/20">
                      <div className="flex items-center justify-between text-[11px] text-text/60 pb-1.5 font-semibold">
                        <span>{language === 'th' ? 'หรือแตะตามธนบัตรที่รับมา:' : 'Or tap received banknote:'}</span>
                        {cashChangeDueCents > 0 && (
                          <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {language === 'th' ? 'ทอน: ' : 'Change: '}
                            {formatMoney(createMoney(cashChangeDueCents, currency))}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-4 gap-1.5">
                        {cashDenominations.map((denom, idx) => (
                          <button
                            key={idx}
                            type="button"
                            disabled={!isAuthorized || isProcessing}
                            onClick={() => {
                              setCustomCashTenderCents(denom.amountCents);
                              handleExecuteQuickPay('cash', denom.amountCents);
                            }}
                            className={`min-h-[38px] py-1.5 px-1 rounded-lg border text-xs font-mono font-bold flex flex-col items-center justify-center transition-all cursor-pointer active-scale ${
                              effectiveCashTenderCents === denom.amountCents
                                ? 'bg-emerald-500 text-white border-emerald-600 shadow-xs'
                                : 'bg-card border-border hover:border-emerald-500 hover:bg-emerald-500/10 text-text'
                            }`}
                          >
                            <span className="truncate">{denom.label}</span>
                            {denom.changeCents > 0 && (
                              <span className="text-[9px] opacity-80 font-normal">
                                {language === 'th' ? 'ทอน ' : 'chg '}
                                {denom.changeCents / 100}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>

                  {/* 2. CARD (บัตรเครดิต/เดบิต) */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: 0.22 }}
                    className="p-3.5 rounded-2xl border-2 border-purple-500/30 bg-purple-500/5 hover:border-purple-500/60 transition-all flex items-center justify-between shadow-2xs group"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-xl bg-purple-600 text-white shadow-xs">
                        <CreditCard className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="font-black text-sm text-text block">
                          {language === 'th' ? 'บัตรเครดิต / เดบิต' : 'Credit / Debit Card'}
                        </span>
                        <span className="text-[11px] text-text/60">
                          {language === 'th' ? 'อนุมัติผ่าน EDC อัตโนมัติ' : 'Auto Auth-Code (EDC / Verifone)'}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      id="quickpay-btn-card"
                      disabled={!isAuthorized || isProcessing}
                      onClick={() => handleExecuteQuickPay('card')}
                      className={`min-h-[44px] px-4 rounded-xl font-black text-xs sm:text-sm flex items-center gap-1.5 transition-all cursor-pointer active-scale shadow-sm ${
                        !isAuthorized || isProcessing
                          ? 'bg-muted text-text/40 cursor-not-allowed'
                          : 'bg-purple-600 hover:bg-purple-500 text-white'
                      }`}
                    >
                      {isProcessing && processingMethod === 'card' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Zap className="h-4 w-4 fill-current" />
                          <span>{language === 'th' ? 'ชำระผ่านบัตร' : 'Tap Card'}</span>
                        </>
                      )}
                    </button>
                  </motion.div>

                  {/* 3. QR / PROMPTPAY (สแกนจ่าย QR) */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: 0.25 }}
                    className="p-3.5 rounded-2xl border-2 border-blue-500/30 bg-blue-500/5 hover:border-blue-500/60 transition-all space-y-2.5 shadow-2xs group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-blue-600 text-white shadow-xs">
                          <QrCode className="h-5 w-5" />
                        </div>
                        <div>
                          <span className="font-black text-sm text-text block">
                            {language === 'th' ? 'พร้อมเพย์ QR Code' : 'PromptPay QR'}
                          </span>
                          <span className="text-[11px] text-text/60">
                            {language === 'th' ? 'สแกนจ่ายดิจิทัลพร้อมบันทึก' : 'Instant digital QR confirmation'}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setShowQrPreview(!showQrPreview)}
                          title={language === 'th' ? 'แสดง QR บนจอ' : 'Show QR on screen'}
                          className="min-h-[44px] px-2.5 rounded-xl border border-blue-500/40 bg-card hover:bg-blue-500/10 text-blue-600 dark:text-blue-400 font-bold text-xs transition-colors cursor-pointer"
                        >
                          {showQrPreview ? (language === 'th' ? 'ซ่อน QR' : 'Hide QR') : (language === 'th' ? 'ดู QR' : 'Show QR')}
                        </button>

                        <button
                          type="button"
                          id="quickpay-btn-qr"
                          disabled={!isAuthorized || isProcessing}
                          onClick={() => handleExecuteQuickPay('qr_digital')}
                          className={`min-h-[44px] px-4 rounded-xl font-black text-xs sm:text-sm flex items-center gap-1.5 transition-all cursor-pointer active-scale shadow-sm ${
                            !isAuthorized || isProcessing
                              ? 'bg-muted text-text/40 cursor-not-allowed'
                              : 'bg-blue-600 hover:bg-blue-500 text-white'
                          }`}
                        >
                          {isProcessing && processingMethod === 'qr_digital' ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Check className="h-4 w-4" />
                              <span>{language === 'th' ? 'ยืนยัน QR' : 'Confirm QR'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Expandable PromptPay QR Image Preview */}
                    {showQrPreview && (
                      <div className="p-3 rounded-xl bg-white text-center space-y-2 border border-blue-200 shadow-xs animate-in fade-in duration-200">
                        <div className="flex justify-center">
                          <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=00020101021229370016A000000677010111011300${config.payments?.promptPayId || '0812345678'}5802TH5303764540${(grandTotalCents / 100).toFixed(2)}6304`}
                            alt="PromptPay QR Code"
                            referrerPolicy="no-referrer"
                            className="w-40 h-40 object-contain rounded-lg border border-slate-200 shadow-2xs"
                          />
                        </div>
                        <div className="text-slate-800 font-bold text-xs">
                          {language === 'th' ? 'ยอดชำระ: ' : 'Total: '}
                          <span className="font-mono text-blue-600 font-black">
                            {formatMoney(totals.grandTotal)}
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500">
                          {language === 'th' ? 'ลูกค้าสแกนเสร็จ แตะ "ยืนยัน QR" ด้านบน' : 'Customer scans, then tap "Confirm QR"'}
                        </p>
                      </div>
                    )}
                  </motion.div>
                </div>
              </div>

              {/* Bottom Fallback to Full Payment Modal */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, delay: 0.28 }}
                className="pt-3 border-t border-crisp border-border space-y-2"
              >
                <button
                  type="button"
                  onClick={() => {
                    playScannerSound('click');
                    onClose();
                    onOpenFullPaymentModal?.();
                  }}
                  className="w-full min-h-[40px] px-3 py-2 rounded-xl border border-border/80 hover:border-primary/50 bg-background text-text/70 hover:text-text text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer group active-scale"
                >
                  <ExternalLink className="h-3.5 w-3.5 text-primary group-hover:translate-x-0.5 transition-transform" />
                  <span>
                    {language === 'th'
                      ? 'ต้องการแบ่งชำระ / เงินมัดจำ / เพิ่มเติม? เปิดหน้าต่างเต็ม'
                      : 'Need Split Payment, Deposits, or Full Invoice? Open Full Modal'}
                  </span>
                </button>
              </motion.div>
            </div>
          )}
        </div>
      </Drawer>

      {isDiscountSupervisorModalOpen && pendingDiscountCheckout && (
        <SupervisorAuthModal
          isOpen={isDiscountSupervisorModalOpen}
          onClose={() => { setIsDiscountSupervisorModalOpen(false); setPendingDiscountCheckout(null); }}
          title={language === 'th' ? 'อนุมัติส่วนลดรายการขาย' : 'Authorize Checkout Discount'}
          actionDescription={language === 'th' ? 'ส่วนลดเกินวงเงินที่กำหนด กรุณาให้ผู้จัดการยืนยันรหัสผ่านบัญชี POS Auth' : 'Discount exceeds the store policy threshold. A manager must reauthenticate with their POS Auth account.'}
          requiredRole="manager"
          onAuthorized={handleDiscountSupervisorAuthorized}
        />
      )}

      {/* Auxiliary Modals for Post-Checkout */}
      {completedOrder && (
        <>
          <ReceiptPrintModal
            isOpen={isReceiptModalOpen}
            onClose={() => setIsReceiptModalOpen(false)}
            order={completedOrder}
          />

          <FullTaxInvoiceModal
            isOpen={isTaxInvoiceModalOpen}
            onClose={() => setIsTaxInvoiceModalOpen(false)}
            order={completedOrder}
          />
        </>
      )}
    </>
  );
};
