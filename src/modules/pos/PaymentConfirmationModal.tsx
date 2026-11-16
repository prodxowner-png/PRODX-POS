/**
 * PRODX POS - Unified Payment Confirmation Modal
 * Modern grid layout with explicit separation of:
 * 1. Payment Methods & Tender Entry (Left Column)
 * 2. Total Summary & Order Context (Right Column)
 * 3. Dual-Action Buttons (Confirm / Cancel) with zero button crowding and clear hierarchy
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { useOffline } from '../../context/OfflineContext';
import { useReceiptPrinter } from '../../context/ReceiptPrinterContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { useSettings } from '../../context/SettingsContext';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { ReceiptPrintModal } from '../../components/receipt/ReceiptPrintModal';
import { FullTaxInvoiceModal } from '../../components/receipt/FullTaxInvoiceModal';
import { SupervisorAuthModal } from '../../components/auth/SupervisorAuthModal';
import type { User as AuthUser } from '../../domain/auth';
import { QuickCashCalculator } from './QuickCashCalculator';
import { playScannerSound } from '../../services/soundService';
import { triggerHaptic } from '../../services/hapticService';
import { customerDisplayService } from '../../services/customerDisplayChannel';
import {
  PaymentMethod,
  TenderPayment,
  Order,
  CartLineItem,
  CartTotals,
  Customer,
} from '../../domain/order';
import {
  Money,
  createMoney,
  addMoney,
  subtractMoney,
  formatMoney,
} from '../../domain/money';
import { createOrderTransactionApi } from '../../adapters/orderTransactionApiFactory';
import type { CheckoutRequest } from '../../adapters/types';
import { createProductionSupervisorAuthorizationApi } from '../../adapters/productionSupervisorAuthorizationApi';
import { createProductionDiscountPolicyApi, getLocalDiscountPolicy } from '../../adapters/productionDiscountPolicyApi';
import { hasProductionUrl } from '../../adapters/env';
import {
  Banknote,
  CreditCard,
  QrCode,
  CheckCircle2,
  Printer,
  RotateCcw,
  WifiOff,
  Receipt,
  Eye,
  Split,
  Plus,
  Trash2,
  Check,
  FileText,
  X,
  User,
  Zap,
  CheckCheck,
  AlertTriangle,
  Smartphone,
  CreditCard as CardIcon,
  Sparkles,
  ChevronDown,
  ChevronUp,
  ShoppingBag,
  ShieldCheck,
  ArrowRight,
  Clock,
  CornerDownLeft,
  Building2,
} from 'lucide-react';

export interface PaymentConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOrderCompleted?: (order: Order) => void;
  /** Optional custom order items if used outside standard cart */
  customItems?: CartLineItem[];
  /** Optional custom totals if used outside standard cart */
  customTotals?: CartTotals;
  /** Optional custom customer if used outside standard cart */
  customCustomer?: Customer | null;
  /** Optional custom note */
  customNotes?: string;
  /** Title override */
  title?: string;
}

interface PaymentTabOption {
  id: PaymentMethod;
  label: { th: string; en: string };
  sublabel: { th: string; en: string };
  icon: React.ElementType;
  hotkey: string;
  themeColor: 'emerald' | 'purple' | 'blue';
  activeClass: string;
  activeRing: string;
  activeBadgeBg: string;
  iconColor: string;
}

const PAYMENT_METHOD_TABS: PaymentTabOption[] = [
  {
    id: 'cash',
    label: { th: 'เงินสด', en: 'Cash' },
    sublabel: { th: 'ธนบัตร & เหรียญ', en: 'Cash & Change' },
    icon: Banknote,
    hotkey: '1',
    themeColor: 'emerald',
    activeClass:
      'bg-emerald-500/10 border-emerald-500 text-emerald-900 dark:text-emerald-200 font-bold shadow-md shadow-emerald-500/10',
    activeRing: 'ring-2 ring-emerald-500/60 ring-offset-2 ring-offset-card',
    activeBadgeBg: 'bg-emerald-600 text-white',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    id: 'qr_digital',
    label: { th: 'พร้อมเพย์ QR', en: 'PromptPay QR' },
    sublabel: { th: 'สแกนจ่ายผ่านแอป', en: 'Thai QR Payment' },
    icon: QrCode,
    hotkey: '2',
    themeColor: 'purple',
    activeClass:
      'bg-purple-500/10 border-purple-500 text-purple-900 dark:text-purple-200 font-bold shadow-md shadow-purple-500/10',
    activeRing: 'ring-2 ring-purple-500/60 ring-offset-2 ring-offset-card',
    activeBadgeBg: 'bg-purple-600 text-white',
    iconColor: 'text-purple-600 dark:text-purple-400',
  },
  {
    id: 'card',
    label: { th: 'บัตรเครดิต / EDC', en: 'Credit / Debit' },
    sublabel: { th: 'เครื่องรูดบัตร EDC', en: 'EMV Terminal' },
    icon: CreditCard,
    hotkey: '3',
    themeColor: 'blue',
    activeClass:
      'bg-blue-500/10 border-blue-500 text-blue-900 dark:text-blue-200 font-bold shadow-md shadow-blue-500/10',
    activeRing: 'ring-2 ring-blue-500/60 ring-offset-2 ring-offset-card',
    activeBadgeBg: 'bg-blue-600 text-white',
    iconColor: 'text-blue-600 dark:text-blue-400',
  },
];

export const PaymentConfirmationModal: React.FC<PaymentConfirmationModalProps> = ({
  isOpen,
  onClose,
  onOrderCompleted,
  customItems,
  customTotals,
  customCustomer,
  customNotes,
  title,
}) => {
  const { session } = useAuth();
  const { config } = useSettings();
  const productionOrderApi = createOrderTransactionApi(session?.token ?? '');
  const cart = useCart();
  const { isOnline, queueOutboxItem } = useOffline();
  const {
    activeTemplate,
    printerConfig,
    printReceipt,
    kickCashDrawer,
    isPrinting,
  } = useReceiptPrinter();
  const { addToast } = useToast();
  const { t, language } = useLanguage();

  // Effective data sources (cart context or props override)
  const items = customItems || cart.items;
  const totals = customTotals || cart.totals;
  const customer = customCustomer !== undefined ? customCustomer : cart.customer;
  const notes = customNotes !== undefined ? customNotes : cart.notes;
  const stagedPayments = cart.stagedPayments;
  const totalTenderedAmount = cart.totalTenderedAmount;
  const remainingBalanceDue = cart.remainingBalanceDue;
  const changeDue = cart.changeDue;
  const isFullyTendered = cart.isFullyTendered;
  const addPaymentTender = cart.addPaymentTender;
  const removePaymentTender = cart.removePaymentTender;
  const clearPaymentTenders = cart.clearPaymentTenders;
  const clearCart = cart.clearCart;

  // Local state
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [singleCashTenderedCents, setSingleCashTenderedCents] = useState<number>(
    totals.grandTotal.amountInCents
  );
  const [splitTenderAmountCents, setSplitTenderAmountCents] = useState<number>(
    totals.grandTotal.amountInCents
  );
  const [splitCashGivenCents, setSplitCashGivenCents] = useState<number>(
    totals.grandTotal.amountInCents
  );
  const [isProcessing, setIsProcessing] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [isFullTaxModalOpen, setIsFullTaxModalOpen] = useState(false);
  const [isItemListExpanded, setIsItemListExpanded] = useState(false);
  const [cardAuthReference, setCardAuthReference] = useState('');
  const [orderRemarkNote, setOrderRemarkNote] = useState(notes || '');
  const [pendingDiscountCheckout, setPendingDiscountCheckout] = useState<CheckoutRequest | null>(null);
  const [isDiscountSupervisorModalOpen, setIsDiscountSupervisorModalOpen] = useState(false);

  const grandTotal = totals.grandTotal;
  const currency = grandTotal.currency;

  // Broadcast payment state to Customer-Facing Display
  useEffect(() => {
    if (!isOpen || !session) return;

    if (completedOrder) {
      customerDisplayService.publish({
        status: 'completed',
        storeName: session.currentStore.name,
        items,
        totals,
        customer: customer || undefined,
        completedOrder,
        lastUpdated: new Date().toISOString(),
      });
    } else {
      customerDisplayService.publish({
        status:
          method === 'qr_digital'
            ? 'payment_promptpay'
            : method === 'cash'
            ? 'payment_cash'
            : 'payment_card',
        storeName: session.currentStore.name,
        items,
        totals,
        customer: customer || undefined,
        activePayment: {
          method,
          amountDueCents: totals.grandTotal.amountInCents,
          currency: totals.grandTotal.currency,
          tenderedCents: method === 'cash' ? singleCashTenderedCents : undefined,
          changeCents:
            method === 'cash'
              ? Math.max(0, singleCashTenderedCents - totals.grandTotal.amountInCents)
              : undefined,
        },
        lastUpdated: new Date().toISOString(),
      });
    }
  }, [
    isOpen,
    method,
    singleCashTenderedCents,
    completedOrder,
    totals,
    items,
    customer,
    session?.currentStore?.name,
  ]);

  // Sync default amounts when modal opens or grandTotal changes
  useEffect(() => {
    if (isOpen) {
      setSingleCashTenderedCents(totals.grandTotal.amountInCents);
      setSplitTenderAmountCents(
        remainingBalanceDue.amountInCents > 0
          ? remainingBalanceDue.amountInCents
          : totals.grandTotal.amountInCents
      );
      setSplitCashGivenCents(
        remainingBalanceDue.amountInCents > 0
          ? remainingBalanceDue.amountInCents
          : totals.grandTotal.amountInCents
      );
      setOrderRemarkNote(notes || '');
    }
  }, [isOpen, totals.grandTotal.amountInCents, notes]);

  // Keep split input updated with remaining balance when staging changes
  useEffect(() => {
    if (remainingBalanceDue.amountInCents > 0) {
      setSplitTenderAmountCents(remainingBalanceDue.amountInCents);
      setSplitCashGivenCents(remainingBalanceDue.amountInCents);
    }
  }, [remainingBalanceDue.amountInCents]);

  // Keyboard Shortcuts: [1] Cash, [2] QR, [3] Card, [Esc] Close
  useEffect(() => {
    if (!isOpen || completedOrder) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl?.tagName === 'INPUT' || activeEl?.tagName === 'TEXTAREA';

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (!isInput) {
        if (e.key === '1' || e.key === 'F1') {
          e.preventDefault();
          playScannerSound('click');
          setMethod('cash');
        } else if (e.key === '2' || e.key === 'F2') {
          e.preventDefault();
          playScannerSound('click');
          setMethod('qr_digital');
        } else if (e.key === '3' || e.key === 'F3') {
          e.preventDefault();
          playScannerSound('click');
          setMethod('card');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, completedOrder, onClose]);

  if (!session) return null;

  // Single-tender mode calculations
  const singleCashTenderedMoney = createMoney(singleCashTenderedCents, currency);
  const singleChangeDueMoney =
    singleCashTenderedCents >= grandTotal.amountInCents
      ? subtractMoney(singleCashTenderedMoney, grandTotal)
      : createMoney(0, currency);

  const isCashInsufficient =
    method === 'cash' && singleCashTenderedCents < grandTotal.amountInCents;
  const isSingleTenderSufficient = method !== 'cash' || !isCashInsufficient;

  const handleAddSplitTender = () => {
    if (splitTenderAmountCents <= 0) return;

    const appliedAmountCents = Math.min(
      splitTenderAmountCents,
      remainingBalanceDue.amountInCents
    );
    const appliedMoney = createMoney(appliedAmountCents, currency);

    if (method === 'cash') {
      const cashGivenCents = Math.max(splitCashGivenCents, appliedAmountCents);
      const cashGivenMoney = createMoney(cashGivenCents, currency);
      const changeGivenCents = cashGivenCents - appliedAmountCents;
      const changeGivenMoney = createMoney(changeGivenCents, currency);

      addPaymentTender({
        method: 'cash',
        amount: appliedMoney,
        tenderedCash: cashGivenMoney,
        changeGiven: changeGivenCents > 0 ? changeGivenMoney : undefined,
      });
    } else if (method === 'card') {
      addPaymentTender({
        method: 'card',
        amount: appliedMoney,
        authCode:
          cardAuthReference || `AUTH-${Math.floor(100000 + Math.random() * 900000)}`,
        cardLastFour: '••••',
        terminalReference: config.payments?.terminalId || 'TRM-EDC-01',
      });
      setCardAuthReference('');
    } else {
      addPaymentTender({
        method: 'qr_digital',
        amount: appliedMoney,
        authCode: `QR-${Date.now().toString().slice(-6)}`,
        terminalReference: 'PROMPTPAY-CONFIRMED',
      });
    }

    addToast({
      title: language === 'th' ? 'บันทึกช่องทางชำระแล้ว' : 'Tender Added',
      message: `${method.toUpperCase()} ${formatMoney(appliedMoney)} ${
        language === 'th'
          ? 'ถูกเพิ่มในรายการชำระ'
          : 'added to split payment'
      }`,
      type: 'info',
    });
  };

  const handleConfirmPayment = async (authorizedPayload?: CheckoutRequest) => {
    let finalPayments: TenderPayment[] = authorizedPayload ? [...authorizedPayload.payments] : [];

    if (authorizedPayload) {
      // Reuse the exact command and idempotency key approved by the supervisor.
    } else if (isSplitMode || stagedPayments.length > 0) {
      if (!isFullyTendered || stagedPayments.length === 0 || isProcessing) return;
      finalPayments = [...stagedPayments];
    } else {
      if (!isSingleTenderSufficient || isProcessing) return;
      const singleTender: TenderPayment = {
        id: `tnd-${Date.now()}`,
        method,
        amount: grandTotal,
        tenderedCash: method === 'cash' ? singleCashTenderedMoney : undefined,
        changeGiven: method === 'cash' ? singleChangeDueMoney : undefined,
        authCode:
          method === 'card'
            ? cardAuthReference || `AUTH-${Math.floor(100000 + Math.random() * 900000)}`
            : method === 'qr_digital'
            ? `QR-${Date.now().toString().slice(-6)}`
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
      finalPayments = [singleTender];
    }

    setIsProcessing(true);
    const idempotencyKey = authorizedPayload?.idempotencyKey ?? `idemp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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
      payments: finalPayments,
      notes: orderRemarkNote || notes,
      isOfflineSubmission: !isOnline,
    };

    try {
      const hasDiscount = items.some((item) => item.discountBps > 0) || totals.orderDiscount.amountInCents > 0;
      if (authorizedPayload && !isOnline && hasProductionUrl()) throw new Error('A server-issued discount approval cannot be replayed while offline.');
      if (!authorizedPayload && hasDiscount) {
        if (!isOnline && hasProductionUrl()) throw new Error(language === 'th' ? 'ไม่สามารถใช้ส่วนลดออฟไลน์ได้ เนื่องจากต้องยืนยันสิทธิ์ผู้จัดการกับเซิร์ฟเวอร์' : 'Discounted checkout requires an online server authorization.');
        const policy = hasProductionUrl() ? await createProductionDiscountPolicyApi(session.token).getPolicy() : getLocalDiscountPolicy();
        const grossCents = totals.grossSubtotal.amountInCents;
        const effectiveDiscountBps = grossCents > 0 ? Math.round((grossCents - totals.grandTotal.amountInCents) / grossCents * 10000) : 0;
        const maxDiscountBps = Math.max(effectiveDiscountBps, orderDiscountBps, ...items.map((item) => item.discountBps), 0);
        if (policy.requireSupervisorApproval && maxDiscountBps > policy.maxDiscountWithoutApprovalBps) {
          setPendingDiscountCheckout(checkoutPayload);
          setIsDiscountSupervisorModalOpen(true);
          setIsProcessing(false);
          return;
        }
      }
      if (!isOnline) {
        // Queue in offline outbox
        await queueOutboxItem('order_transaction', idempotencyKey, checkoutPayload);

        const localOfflineOrder: Order = {
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
          payments: finalPayments,
          status: 'pending_sync_offline',
          createdAt: new Date().toISOString(),
          notes: orderRemarkNote || notes,
        };

        setCompletedOrder(localOfflineOrder);
        onOrderCompleted?.(localOfflineOrder);
        clearPaymentTenders();
        playScannerSound('payment_success');

        window.dispatchEvent(
          new CustomEvent('prodx:order-completed', { detail: localOfflineOrder })
        );

        if (finalPayments.some((p) => p.method === 'cash')) {
          kickCashDrawer();
        }

        if (printerConfig.autoPrintOnCheckout) {
          printReceipt(localOfflineOrder).then((printRes) => {
            if (printRes.success) {
              addToast({
                title:
                  language === 'th'
                    ? 'พิมพ์ใบเสร็จอัตโนมัติสำเร็จ'
                    : 'Auto-Print Success',
                message:
                  language === 'th'
                    ? `พิมพ์ใบเสร็จ #${localOfflineOrder.orderNumber} เรียบร้อยแล้ว`
                    : `Receipt #${localOfflineOrder.orderNumber} auto-printed successfully.`,
                type: 'success',
              });
            }
          });
        }
        addToast({
          title:
            language === 'th'
              ? 'บันทึกคำสั่งซื้อออฟไลน์แล้ว'
              : 'Offline Order Queued',
          message:
            language === 'th'
              ? 'บันทึกใน Outbox รอซิงก์ขึ้นเซิร์ฟเวอร์'
              : 'Saved to local outbox. Will sync automatically when online.',
          type: 'warning',
        });
      } else {
        // Live server checkout
        const response = await productionOrderApi.createOrder(checkoutPayload);
        setCompletedOrder(response.order);
        onOrderCompleted?.(response.order);
        clearPaymentTenders();
        playScannerSound('payment_success');

        window.dispatchEvent(
          new CustomEvent('prodx:order-completed', { detail: response.order })
        );

        if (finalPayments.some((p) => p.method === 'cash')) {
          kickCashDrawer();
        }

        if (printerConfig.autoPrintOnCheckout) {
          printReceipt(response.order).then((printRes) => {
            if (printRes.success) {
              addToast({
                title:
                  language === 'th'
                    ? 'พิมพ์ใบเสร็จอัตโนมัติสำเร็จ'
                    : 'Auto-Print Success',
                message:
                  language === 'th'
                    ? `พิมพ์ใบเสร็จ #${response.order.orderNumber} เรียบร้อยแล้ว`
                    : `Receipt #${response.order.orderNumber} auto-printed successfully.`,
                type: 'success',
              });
            }
          });
        }
        addToast({
          title:
            language === 'th'
              ? 'ชำระเงินและบันทึกข้อมูลสำเร็จ'
              : 'Payment Authorized & Committed',
          message:
            language === 'th'
              ? `คำสั่งซื้อ #${response.order.orderNumber} ยืนยันจากเซิร์ฟเวอร์เรียบร้อย`
              : `Order #${response.order.orderNumber} confirmed by server.`,
          type: 'success',
        });
      }
    } catch (err: any) {
      addToast({
        title: language === 'th' ? 'การชำระเงินล้มเหลว' : 'Payment Failed',
        message:
          err?.message ||
          (language === 'th'
            ? 'เกิดข้อผิดพลาดในการอนุมัติรายการ'
            : 'Transaction authorization error.'),
        type: 'error',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDiscountSupervisorAuthorized = async (supervisor: AuthUser, _notes?: string, proof?: string) => {
    if (!pendingDiscountCheckout) return;
    if (!hasProductionUrl()) {
      const payload = pendingDiscountCheckout;
      setPendingDiscountCheckout(null);
      setIsDiscountSupervisorModalOpen(false);
      await handleConfirmPayment(payload);
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
      await handleConfirmPayment(payload);
    } catch (error) {
      addToast({ title: language === 'th' ? 'อนุมัติส่วนลดไม่สำเร็จ' : 'Discount Approval Failed', message: error instanceof Error ? error.message : String(error), type: 'error' });
    }
  };

  const handleNextSale = () => {
    triggerHaptic('medium');
    setCompletedOrder(null);
    clearCart();
    setIsSplitMode(false);
    onClose();
  };

  const handlePrintReceiptDirect = () => {
    triggerHaptic('tap');
    if (completedOrder) {
      printReceipt(completedOrder);
    }
  };

  const isConfirmDisabled =
    isProcessing ||
    (isSplitMode ? !isFullyTendered : !isSingleTenderSufficient);

  // --------------------------------------------------------------------------
  // DUAL-ACTION FOOTER BUTTONS: EXPLICIT CONFIRM & CANCEL WITH HIGH HIERARCHY
  // --------------------------------------------------------------------------
  const dualActionFooter = (
    <div className="w-full pt-1">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 w-full">
        {/* Secondary Dual Action: Cancel / Back */}
        <button
          type="button"
          onClick={() => {
            triggerHaptic('tap');
            onClose();
          }}
          disabled={isProcessing}
          className="min-h-[48px] h-12 w-full px-4 rounded-xl border border-border bg-card hover:bg-background text-text/80 hover:text-text font-bold text-xs sm:text-sm flex items-center justify-center gap-2.5 transition-all theme-btn-radius active-scale cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/30"
        >
          <X className="h-4.5 w-4.5 shrink-0 text-text/50 group-hover:text-rose-500" />
          <span className="truncate">
            {language === 'th' ? 'ยกเลิกการชำระเงิน' : 'Cancel Payment'}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-background border border-border text-text/50 shrink-0">
            Esc
          </span>
        </button>

        {/* Primary Dual Action: Confirm & Finalize Payment */}
        <button
          type="button"
          onClick={() => {
            triggerHaptic('heavy');
            handleConfirmPayment();
          }}
          disabled={isConfirmDisabled}
          className={`min-h-[48px] h-12 w-full px-4 rounded-xl font-bold text-xs sm:text-sm flex items-center justify-between gap-3 transition-all theme-btn-radius active-scale shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
            isConfirmDisabled
              ? 'bg-border/60 text-text/40 border border-border/50 cursor-not-allowed opacity-60'
              : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white cursor-pointer ring-2 ring-emerald-600/30 hover:shadow-emerald-600/25 shadow-md'
          }`}
        >
          <div className="flex items-center gap-2 truncate">
            {isProcessing ? (
              <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
            ) : (
              <CheckCircle2 className="h-5 w-5 shrink-0" />
            )}
            <span className="truncate">
              {isProcessing
                ? language === 'th'
                  ? 'กำลังประมวลผล...'
                  : 'Processing Payment...'
                : isSplitMode
                ? language === 'th'
                  ? 'ยืนยันการแบ่งชำระเงิน'
                  : 'Confirm Split Payment'
                : method === 'cash'
                ? language === 'th'
                  ? 'ยืนยันรับเงินสด & ปิดการขาย'
                  : 'Confirm Cash & Complete'
                : language === 'th'
                ? 'ยืนยันอนุมัติชำระเงิน'
                : 'Authorize & Complete'}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono font-black text-xs sm:text-sm bg-white/20 px-2 py-0.5 rounded-md text-white shadow-2xs">
              {formatMoney(grandTotal)}
            </span>
            <span className="hidden sm:inline px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-white/15 text-white">
              <CornerDownLeft className="h-3 w-3 inline" />
            </span>
          </div>
        </button>
      </div>
    </div>
  );

  return (
    <>
      <Modal
        isOpen={isOpen}
        fullScreenOnMobile={true}
        onClose={completedOrder ? handleNextSale : onClose}
        title={
          title ||
          (completedOrder
            ? language === 'th'
              ? 'ใบเสร็จรับเงิน & ยืนยันคำสั่งซื้อ'
              : 'Receipt & Transaction Confirmation'
            : language === 'th'
            ? 'ยืนยันและประมวลผลการชำระเงิน (Payment Confirmation)'
            : 'Payment Confirmation & Settlement')
        }
        description={
          completedOrder
            ? `${language === 'th' ? 'สถานะรายการ' : 'Transaction status'}: ${completedOrder.status.replace('_', ' ').toUpperCase()}`
            : `${language === 'th' ? 'เลือกช่องทางชำระเงิน ตรวจสอบยอดสุทธิ และยืนยันรายการ' : 'Select payment tender, verify totals, and authorize transaction.'}`
        }
        maxWidth="4xl"
        footer={completedOrder ? undefined : dualActionFooter}
      >
        {completedOrder ? (
          /* ========================================================= */
          /* SUCCESS CONFIRMATION & RECEIPT POST-SETTLEMENT VIEW       */
          /* ========================================================= */
          <div className="space-y-4 max-w-2xl mx-auto py-2">
            <div
              className={`p-5 rounded-2xl border text-center shadow-xs ${
                completedOrder.status === 'server_confirmed'
                  ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-100'
                  : 'border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100'
              }`}
            >
              <div className="flex justify-center mb-2.5">
                {completedOrder.status === 'server_confirmed' ? (
                  <div className="h-14 w-14 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center shadow-sm">
                    <CheckCircle2 className="h-9 w-9 text-emerald-600 dark:text-emerald-400" />
                  </div>
                ) : (
                  <div className="h-14 w-14 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
                    <WifiOff className="h-9 w-9 text-amber-600 dark:text-amber-400 animate-pulse" />
                  </div>
                )}
              </div>
              <h4 className="text-lg font-bold">
                {completedOrder.status === 'server_confirmed'
                  ? language === 'th'
                    ? 'ชำระเงินสำเร็จ & บันทึกรายการขายเรียบร้อย'
                    : 'Payment Authorized & Server-Committed'
                  : language === 'th'
                  ? 'บันทึกบิลออฟไลน์ใน Outbox รอซิงก์'
                  : 'Offline Ticket Queued in Outbox'}
              </h4>
              <p className="text-xs mt-1 text-text/70 font-mono">
                {t.orders.orderNumber}: <span className="font-bold text-text">{completedOrder.orderNumber}</span>
              </p>
            </div>

            {/* Thermal Printer Status Ribbon */}
            <div className="p-3.5 rounded-xl bg-card border border-border flex items-center justify-between text-xs shadow-2xs">
              <div className="flex items-center gap-2">
                <Printer className="h-4 w-4 text-primary" />
                <span className="font-semibold text-text">
                  {activeTemplate.name} ({activeTemplate.paperWidth})
                </span>
                {printerConfig.quickPrint && (
                  <Badge variant="success" size="sm" className="font-mono text-[10px]">
                    ⚡ {language === 'th' ? 'พิมพ์ด่วน (Quick Print)' : 'Quick Print'}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {printerConfig.quickPrint ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('tap');
                        handlePrintReceiptDirect();
                      }}
                      className="text-primary font-bold hover:underline flex items-center gap-1 cursor-pointer active-scale"
                    >
                      <Zap className="h-3.5 w-3.5 text-amber-500" />
                      <span>{language === 'th' ? 'พิมพ์ตรงทันที' : 'Print Direct'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsReceiptModalOpen(true)}
                      title={language === 'th' ? 'ดูตัวอย่างใบเสร็จ' : 'Preview receipt layout'}
                      className="text-text/50 hover:text-text p-1 hover:bg-background rounded border border-border/50 text-[11px] flex items-center gap-1 cursor-pointer"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      <span>{language === 'th' ? 'ดูตัวอย่าง' : 'Preview'}</span>
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsReceiptModalOpen(true)}
                    className="text-primary font-bold hover:underline flex items-center gap-1 cursor-pointer active-scale"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    <span>{language === 'th' ? 'ดูตัวอย่าง / ปรับแต่งใบเสร็จ' : 'Preview / Customize'}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Receipt Breakdown Card */}
            <div className="p-4 rounded-xl border border-border bg-card font-mono text-xs space-y-2.5 shadow-2xs">
              <div className="flex justify-between text-text/70 border-b border-border pb-2 font-sans font-medium text-xs">
                <span>{activeTemplate.branding.storeName || session.currentStore.name}</span>
                <span>{new Date(completedOrder.createdAt).toLocaleTimeString()}</span>
              </div>

              <div className="space-y-1.5 py-1 text-text">
                {completedOrder.items.map((i) => (
                  <div key={i.lineId} className="flex justify-between items-center text-xs">
                    <span className="truncate max-w-[280px] font-sans font-medium">
                      {i.quantity}x {i.product.name}
                    </span>
                    <span className="font-mono font-bold">{formatMoney(i.lineTotal)}</span>
                  </div>
                ))}

                <div className="pt-2 border-t border-border space-y-1 text-xs">
                  <div className="flex justify-between font-bold text-text">
                    <span className="font-sans">{t.checkout.totalDue}:</span>
                    <span className="font-mono text-sm">{formatMoney(completedOrder.totals.grandTotal)}</span>
                  </div>

                  {completedOrder.payments.map((p, idx) => (
                    <div key={idx} className="flex justify-between text-text/60 text-[11px]">
                      <span className="font-sans capitalize">
                        {p.method === 'cash' ? 'Cash' : p.method === 'qr_digital' ? 'PromptPay QR' : 'Card'}:
                      </span>
                      <span>{formatMoney(p.amount)}</span>
                    </div>
                  ))}

                  {completedOrder.payments.some((p) => p.changeGiven && p.changeGiven.amountInCents > 0) && (
                    <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-bold pt-1.5 border-t border-border font-sans text-xs">
                      <span>{t.checkout.changeDue}</span>
                      <span className="font-mono text-sm">
                        {formatMoney(
                          createMoney(
                            completedOrder.payments.reduce(
                              (acc, p) => acc + (p.changeGiven?.amountInCents || 0),
                              0
                            ),
                            currency
                          )
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Symmetrical Action Button Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2">
              <Button
                variant="outline"
                size="md"
                className="w-full text-xs rounded-xl border-border theme-btn-radius active-scale"
                leftIcon={<FileText className="h-4 w-4 text-primary" />}
                onClick={() => setIsFullTaxModalOpen(true)}
              >
                {language === 'th' ? 'ใบกำกับภาษีเต็มรูป' : 'Full Tax Invoice'}
              </Button>
              <Button
                variant="outline"
                size="md"
                className="w-full text-xs rounded-xl border-border theme-btn-radius active-scale"
                leftIcon={printerConfig.quickPrint ? <Zap className="h-4 w-4 text-amber-500" /> : <Printer className="h-4 w-4 text-emerald-600" />}
                onClick={handlePrintReceiptDirect}
                isLoading={isPrinting}
              >
                {printerConfig.quickPrint
                  ? (language === 'th' ? 'พิมพ์สลิปด่วน' : 'Quick Print Slip')
                  : (language === 'th' ? 'พิมพ์สลิปซ้ำ' : 'Print Slip')}
              </Button>
              <Button
                variant="primary"
                size="md"
                className="w-full text-xs rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold theme-btn-radius active-scale shadow-sm"
                leftIcon={<RotateCcw className="h-4 w-4" />}
                onClick={handleNextSale}
              >
                {t.checkout.newSale}
              </Button>
            </div>
          </div>
        ) : (
          /* ========================================================= */
          /* UNIFIED 2-COLUMN MODERN GRID LAYOUT                       */
          /* ========================================================= */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* ======================================================= */}
            {/* LEFT PILLAR: PAYMENT METHODS & TENDER ENTRY (COL 7)     */}
            {/* ======================================================= */}
            <div className="lg:col-span-7 space-y-4">
              {/* 1. Tender Mode Selector (Single vs Split) */}
              <div className="flex items-center p-1 bg-background rounded-xl border border-border shadow-2xs">
                <button
                  type="button"
                  onClick={() => {
                    playScannerSound('click');
                    setIsSplitMode(false);
                  }}
                  className={`flex-1 min-h-[40px] py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 theme-btn-radius active-scale ${
                    !isSplitMode
                      ? 'bg-card text-text border border-border shadow-xs'
                      : 'text-text/60 hover:text-text transparent border border-transparent'
                  }`}
                >
                  <Banknote className="h-3.5 w-3.5" />
                  <span>{language === 'th' ? 'ชำระเต็มจำนวน' : 'Single Tender'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    playScannerSound('click');
                    setIsSplitMode(true);
                  }}
                  className={`flex-1 min-h-[40px] py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 theme-btn-radius active-scale ${
                    isSplitMode
                      ? 'bg-primary text-white border border-primary shadow-xs'
                      : 'text-text/60 hover:text-text transparent border border-transparent'
                  }`}
                >
                  <Split className="h-3.5 w-3.5" />
                  <span>{language === 'th' ? 'แบ่งชำระหลายช่องทาง' : 'Split Multi-Tender'}</span>
                  {stagedPayments.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/25 text-white font-mono font-bold">
                      {stagedPayments.length}
                    </span>
                  )}
                </button>
              </div>

              {/* 2. Payment Method Selector Cards (Single Mode) */}
              {!isSplitMode && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-text/70 px-0.5">
                    <span className="flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5 text-primary" />
                      <span>
                        {language === 'th'
                          ? 'เลือกช่องทางชำระเงิน (ปุ่มลัด 1, 2, 3)'
                          : 'Select Payment Method (Keys: 1, 2, 3)'}
                      </span>
                    </span>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                    {PAYMENT_METHOD_TABS.map((tab) => {
                      const isActive = method === tab.id;
                      const IconComp = tab.icon;

                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => {
                            playScannerSound('click');
                            setMethod(tab.id);
                          }}
                          className={`relative min-h-[72px] sm:min-h-[78px] p-2.5 sm:p-3 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer select-none theme-btn-radius active-scale focus-visible:outline-none ${
                            isActive
                              ? `${tab.activeClass} ${tab.activeRing}`
                              : 'border-border bg-card text-text/70 hover:bg-background hover:border-text/30 hover:text-text'
                          }`}
                        >
                          {/* Hotkey Tag Badge */}
                          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-background/80 border border-border text-text/60">
                            {tab.hotkey}
                          </span>

                          {/* Floating Active Checkmark Indicator */}
                          {isActive && (
                            <span
                              className={`absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full ${tab.activeBadgeBg} flex items-center justify-center shadow-xs animate-in zoom-in-75 duration-150`}
                            >
                              <Check className="h-3 w-3 stroke-[3]" />
                            </span>
                          )}

                          {/* Icon */}
                          <div
                            className={`p-1.5 rounded-lg ${
                              isActive ? 'bg-background/80 shadow-2xs' : 'bg-transparent'
                            }`}
                          >
                            <IconComp
                              className={`h-5 w-5 sm:h-5.5 sm:w-5.5 ${
                                isActive ? tab.iconColor : 'text-text/70'
                              }`}
                            />
                          </div>

                          {/* Label & Sublabel */}
                          <span className="text-xs font-bold leading-tight text-center">
                            {language === 'th' ? tab.label.th : tab.label.en}
                          </span>
                          <span className="text-[10px] text-text/50 hidden sm:block leading-none">
                            {language === 'th' ? tab.sublabel.th : tab.sublabel.en}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 3. Interactive Payment Method Forms */}
              {!isSplitMode && (
                <div className="space-y-3.5">
                  {/* 3.1 CASH PAYMENT FLOW */}
                  {method === 'cash' && (
                    <div className="space-y-3">
                      {/* Received Amount Input */}
                      <div className="p-3.5 rounded-xl bg-card border border-border space-y-2.5 shadow-2xs">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-text/70 flex items-center gap-1.5">
                            <Banknote className="h-4 w-4 text-emerald-600" />
                            <span>
                              {t.checkout.tenderedAmount} ({grandTotal.currency})
                            </span>
                          </label>
                          <button
                            type="button"
                            onClick={() => {
                              playScannerSound('click');
                              setSingleCashTenderedCents(grandTotal.amountInCents);
                            }}
                            className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer active-scale"
                          >
                            <CheckCheck className="h-3.5 w-3.5" />
                            <span>{language === 'th' ? 'รับมาพอดี (Exact)' : 'Exact Amount'}</span>
                          </button>
                        </div>

                        <div className="relative">
                          <input
                            type="number"
                            step="0.01"
                            value={(singleCashTenderedCents / 100).toFixed(2)}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => {
                              const parsed = parseFloat(e.target.value);
                              setSingleCashTenderedCents(
                                isNaN(parsed) ? 0 : Math.round(parsed * 100)
                              );
                            }}
                            className={`w-full min-h-[52px] h-13 rounded-xl border bg-card text-2xl sm:text-3xl font-black font-mono px-4 py-2 text-text focus:outline-none focus:ring-2 transition-all shadow-2xs ${
                              isCashInsufficient
                                ? 'border-amber-400 focus:ring-amber-500 text-amber-900 dark:text-amber-200'
                                : 'border-border focus:ring-primary'
                            }`}
                          />
                        </div>

                        {/* Cash Insufficient Warning */}
                        {isCashInsufficient && (
                          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs font-semibold flex items-center gap-1.5">
                            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                            <span>
                              {language === 'th'
                                ? `ยอดเงินยังขาดอีก ${formatMoney(
                                    subtractMoney(grandTotal, singleCashTenderedMoney)
                                  )}`
                                : `Insufficient by ${formatMoney(
                                    subtractMoney(grandTotal, singleCashTenderedMoney)
                                  )}`}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Change Due Highlight Box */}
                      <div
                        className={`p-3.5 rounded-xl border flex items-center justify-between shadow-2xs transition-colors ${
                          singleChangeDueMoney.amountInCents > 0
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-100'
                            : 'bg-card border-border text-text'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={`p-2 rounded-lg ${
                              singleChangeDueMoney.amountInCents > 0
                                ? 'bg-emerald-600 text-white'
                                : 'bg-background border border-border text-text/60'
                            }`}
                          >
                            <Sparkles className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-[11px] font-bold uppercase tracking-wider text-text/60 font-sans">
                              {t.checkout.changeDue}
                            </div>
                            <div className="text-xs text-text/50">
                              {singleChangeDueMoney.amountInCents > 0
                                ? language === 'th'
                                  ? 'เงินทอนที่ต้องคืนลูกค้า'
                                  : 'Return change to customer'
                                : language === 'th'
                                ? 'ไม่มีเงินทอน (พอดี)'
                                : 'Exact tender, zero change'}
                            </div>
                          </div>
                        </div>

                        <div className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                          {formatMoney(singleChangeDueMoney)}
                        </div>
                      </div>

                      {/* Quick Cash Banknotes & Coins Tray */}
                      <QuickCashCalculator
                        totalDueCents={grandTotal.amountInCents}
                        currency={grandTotal.currency}
                        tenderedCents={singleCashTenderedCents}
                        onTenderedChange={(cents) => setSingleCashTenderedCents(cents)}
                      />
                    </div>
                  )}

                  {/* 3.2 PROMPTPAY QR PAYMENT FLOW */}
                  {method === 'qr_digital' && (
                    <div className="p-4 rounded-xl border border-purple-500/30 bg-card text-center space-y-3.5 shadow-2xs">
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-100 dark:bg-purple-950/50 border border-purple-300 dark:border-purple-800 text-purple-800 dark:text-purple-200 text-xs font-bold">
                        <QrCode className="h-3.5 w-3.5 text-purple-600" />
                        <span>
                          {language === 'th'
                            ? 'พร้อมเพย์ QR Code ชำระเงิน'
                            : 'PromptPay / Thai QR Payment'}
                        </span>
                      </div>

                      {/* Dynamic QR Display Graphic */}
                      <div className="p-4 max-w-[210px] mx-auto bg-white rounded-2xl border-2 border-purple-600/30 shadow-md space-y-2">
                        <div className="aspect-square bg-slate-900 rounded-xl flex flex-col items-center justify-center p-3 text-white">
                          <QrCode className="h-28 w-28 text-white" />
                          <span className="text-[9px] font-mono tracking-wider mt-1 text-slate-300">
                            THAI QR • PROMPTPAY
                          </span>
                        </div>
                        <div className="text-slate-800 font-mono font-black text-sm">
                          {formatMoney(grandTotal)}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-sm font-bold text-text">
                          {language === 'th'
                            ? 'สแกน QR Code ด้วยแอปธนาคารใดก็ได้'
                            : 'Scan QR Code with any Mobile Banking App'}
                        </div>
                        <div className="text-xs text-text/60">
                          {language === 'th' ? 'ยอดชำระถูกล็อกไว้อัตโนมัติ' : 'Amount locked'}:{' '}
                          <span className="font-mono font-bold text-text">
                            {formatMoney(grandTotal)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 3.3 CREDIT / DEBIT CARD FLOW */}
                  {method === 'card' && (
                    <div className="p-4 rounded-xl border border-blue-500/30 bg-card text-center space-y-3.5 shadow-2xs">
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-950/50 border border-blue-300 dark:border-blue-800 text-blue-800 dark:text-blue-200 text-xs font-bold">
                        <CardIcon className="h-3.5 w-3.5 text-blue-600" />
                        <span>
                          {language === 'th'
                            ? 'เครื่องรูดบัตร EDC: TRM-VERIFONE-01'
                            : 'Card Terminal: TRM-VERIFONE-01'}
                        </span>
                      </div>

                      {/* Card Illustration */}
                      <div className="p-4 max-w-[280px] mx-auto rounded-2xl bg-gradient-to-r from-blue-700 to-indigo-900 text-white shadow-md text-left space-y-3">
                        <div className="flex justify-between items-center">
                          <div className="h-7 w-9 rounded bg-amber-400/80 border border-amber-300 flex items-center justify-center">
                            <div className="h-4 w-6 border border-amber-600/40 rounded-sm" />
                          </div>
                          <span className="text-xs font-bold tracking-widest uppercase">
                            PRODX PAY
                          </span>
                        </div>
                        <div className="font-mono text-sm tracking-widest">
                          •••• •••• •••• 4242
                        </div>
                        <div className="flex justify-between items-end text-[10px]">
                          <div>
                            <div className="opacity-60 text-[8px]">CARDHOLDER</div>
                            <div className="font-bold">
                              {customer ? customer.name.toUpperCase() : 'VALUED CUSTOMER'}
                            </div>
                          </div>
                          <div className="font-mono font-bold">12/28</div>
                        </div>
                      </div>

                      <div className="space-y-2 max-w-sm mx-auto">
                        <div className="text-xs text-text/70">
                          {language === 'th'
                            ? 'พร้อมรับบัตร Visa, Mastercard, JCB, UnionPay (แตะ, เสียบ หรือรูด)'
                            : 'Ready for Visa, Mastercard, JCB, and UnionPay (Tap, Dip, or Swipe).'}
                        </div>

                        {/* Optional Terminal Auth Trace Override */}
                        <div className="text-left pt-1">
                          <label className="text-[11px] font-semibold text-text/60">
                            {language === 'th'
                              ? 'รหัสอนุมัติจากสลิป EDC (Approval Code - ทางเลือก):'
                              : 'Approval Code / Trace No (Optional):'}
                          </label>
                          <input
                            type="text"
                            value={cardAuthReference}
                            onChange={(e) => setCardAuthReference(e.target.value)}
                            placeholder="e.g. AUTH-849201"
                            className="w-full mt-1 px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-text focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 4. Split Multi-Tender Entry Flow */}
              {isSplitMode && (
                <div className="space-y-3.5">
                  {/* Staged Payments List */}
                  {stagedPayments.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold text-text/70">
                        <span>
                          {language === 'th'
                            ? 'รายการชำระเงินที่บันทึกแล้ว:'
                            : 'Staged Payment Tenders:'}
                        </span>
                        <button
                          type="button"
                          onClick={clearPaymentTenders}
                          className="text-rose-500 hover:text-rose-600 text-[11px] font-bold hover:underline cursor-pointer active-scale"
                        >
                          {language === 'th' ? 'ล้างทั้งหมด' : 'Clear All'}
                        </button>
                      </div>

                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {stagedPayments.map((p, idx) => (
                          <div
                            key={p.id || idx}
                            className="p-2.5 rounded-xl border border-border bg-card flex items-center justify-between text-xs shadow-2xs"
                          >
                            <div className="flex items-center gap-2">
                              <Badge
                                variant={
                                  p.method === 'cash'
                                    ? 'success'
                                    : p.method === 'qr_digital'
                                    ? 'primary'
                                    : 'neutral'
                                }
                                size="sm"
                                className="font-mono uppercase font-bold text-[10px]"
                              >
                                {p.method}
                              </Badge>
                              <span className="font-mono font-bold text-text">
                                {formatMoney(p.amount)}
                              </span>
                              {p.tenderedCash && (
                                <span className="text-[10px] text-text/50">
                                  (Recv: {formatMoney(p.tenderedCash)})
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => removePaymentTender(p.id)}
                              className="p-1 text-text/40 hover:text-rose-500 rounded-md transition-colors cursor-pointer"
                              title="Remove tender"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Add New Split Tender Subform */}
                  {remainingBalanceDue.amountInCents > 0 ? (
                    <div className="p-3.5 rounded-xl border border-primary/30 bg-card space-y-3 shadow-2xs">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-text flex items-center gap-1.5">
                          <Plus className="h-3.5 w-3.5 text-primary" />
                          <span>
                            {language === 'th'
                              ? 'เพิ่มยอดชำระในก้อนนี้'
                              : 'Add Next Split Tender'}
                          </span>
                        </span>
                        <span className="text-[11px] font-mono font-bold text-amber-600 dark:text-amber-400">
                          {language === 'th' ? 'คงเหลือ' : 'Due'}:{' '}
                          {formatMoney(remainingBalanceDue)}
                        </span>
                      </div>

                      {/* Method Selector Pills */}
                      <div className="grid grid-cols-3 gap-2">
                        {PAYMENT_METHOD_TABS.map((tab) => {
                          const isSel = method === tab.id;
                          return (
                            <button
                              key={tab.id}
                              type="button"
                              onClick={() => setMethod(tab.id)}
                              className={`py-2 px-2 rounded-lg border text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                                isSel
                                  ? `${tab.activeClass} ring-1 ring-primary`
                                  : 'border-border bg-background text-text/70 hover:text-text'
                              }`}
                            >
                              <tab.icon className="h-3.5 w-3.5" />
                              <span>{tab.label.en}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* Amount to Apply Input */}
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-semibold text-text/70">
                          {language === 'th'
                            ? 'จำนวนเงินที่ชำระด้วยช่องทางนี้:'
                            : 'Amount to charge with this tender:'}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={(splitTenderAmountCents / 100).toFixed(2)}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const parsed = parseFloat(e.target.value);
                            setSplitTenderAmountCents(
                              isNaN(parsed) ? 0 : Math.round(parsed * 100)
                            );
                          }}
                          className="w-full h-10 px-3 rounded-lg border border-border bg-background text-base font-bold font-mono text-text focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>

                      {/* If Cash in split mode, ask for cash given */}
                      {method === 'cash' && (
                        <div className="space-y-1.5">
                          <label className="text-[11px] font-semibold text-text/70">
                            {language === 'th'
                              ? 'รับเงินสดมา (Cash Received):'
                              : 'Cash tendered by customer:'}
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            value={(splitCashGivenCents / 100).toFixed(2)}
                            onFocus={(e) => e.target.select()}
                            onChange={(e) => {
                              const parsed = parseFloat(e.target.value);
                              setSplitCashGivenCents(
                                isNaN(parsed) ? 0 : Math.round(parsed * 100)
                              );
                            }}
                            className="w-full h-10 px-3 rounded-lg border border-border bg-background text-base font-bold font-mono text-text focus:outline-none focus:ring-2 focus:ring-primary"
                          />
                        </div>
                      )}

                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={handleAddSplitTender}
                        className="w-full rounded-lg font-bold text-xs h-9"
                        leftIcon={<Plus className="h-3.5 w-3.5" />}
                      >
                        {language === 'th' ? 'เพิ่มการชำระนี้' : 'Record This Tender'}
                      </Button>
                    </div>
                  ) : (
                    <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-800 dark:text-emerald-200 text-xs font-bold text-center flex items-center justify-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>
                        {language === 'th'
                          ? 'ชำระเงินครบเต็มจำนวนแล้ว พร้อมบันทึกคำสั่งซื้อ'
                          : 'Payment fully tendered! Ready to complete order.'}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Order Remark / Cashier Note */}
              <div className="p-3 rounded-xl border border-border bg-card/60 space-y-1.5 shadow-2xs">
                <label className="text-[11px] font-bold text-text/70 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-primary" />
                    <span>{language === 'th' ? 'บันทึกช่วยจำ / หมายเหตุ (Order Note)' : 'Transaction Remark / Note'}</span>
                  </span>
                  <span className="text-[10px] text-text/40 font-normal">
                    {language === 'th' ? 'แสดงบนใบเสร็จ' : 'Printed on slip'}
                  </span>
                </label>
                <input
                  type="text"
                  value={orderRemarkNote}
                  onChange={(e) => setOrderRemarkNote(e.target.value)}
                  placeholder={
                    language === 'th'
                      ? 'เช่น ขอรับใบเสร็จ, ส่งของโต๊ะ 4, ลูกค้าประจำ...'
                      : 'e.g. Table delivery, loyalty promo ref...'
                  }
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-text focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            {/* ======================================================= */}
            {/* RIGHT PILLAR: TOTAL SUMMARY & ORDER CONTEXT (COL 5)     */}
            {/* ======================================================= */}
            <div className="lg:col-span-5 space-y-4">
              {/* Order & Cashier Context Card */}
              <div className="p-3.5 rounded-xl border border-border bg-card space-y-2.5 shadow-2xs">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-text/50" />
                    <span className="font-bold text-text truncate max-w-[150px]">
                      {session.currentStore.name}
                    </span>
                  </div>
                  <Badge variant="neutral" size="sm" className="font-mono text-[9px]">
                    {session.registerId}
                  </Badge>
                </div>

                {/* Customer Pill */}
                <div className="p-2.5 rounded-lg bg-background border border-border flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="p-1 rounded-md bg-primary/10 text-primary">
                      <User className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="font-bold text-text truncate max-w-[140px]">
                        {customer ? customer.name : language === 'th' ? 'ลูกค้าทั่วไป (Walk-in)' : 'Walk-in Customer'}
                      </div>
                      {customer && (
                        <div className="text-[10px] text-text/50 font-mono">
                          {customer.phone || customer.email || 'Member'}
                        </div>
                      )}
                    </div>
                  </div>

                  {customer?.loyaltyPoints !== undefined && (
                    <Badge variant="primary" size="sm" className="font-mono text-[9px] font-bold">
                      {customer.loyaltyPoints} pts
                    </Badge>
                  )}
                </div>
              </div>

              {/* Items Mini-Preview / Count Accordion */}
              <div className="p-3.5 rounded-xl border border-border bg-card space-y-2 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setIsItemListExpanded(!isItemListExpanded)}
                  className="w-full flex items-center justify-between text-xs font-bold text-text cursor-pointer hover:text-primary transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <ShoppingBag className="h-3.5 w-3.5 text-primary" />
                    <span>
                      {language === 'th' ? 'รายการสินค้า' : 'Cart Items'} ({items.length})
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-text/50">
                    <span>{isItemListExpanded ? (language === 'th' ? 'ซ่อน' : 'Hide') : (language === 'th' ? 'ดูรายการ' : 'View')}</span>
                    {isItemListExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </div>
                </button>

                {isItemListExpanded && (
                  <div className="pt-2 border-t border-border/80 space-y-1.5 max-h-44 overflow-y-auto pr-1">
                    {items.map((item) => (
                      <div
                        key={item.lineId}
                        className="flex items-center justify-between text-xs py-0.5"
                      >
                        <div className="truncate max-w-[160px] text-text">
                          <span className="font-bold font-mono mr-1.5 text-text/60">
                            {item.quantity}x
                          </span>
                          <span>{item.product.name}</span>
                        </div>
                        <span className="font-mono font-semibold text-text/80">
                          {formatMoney(item.lineTotal)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Comprehensive Financial Summary Card */}
              <div className="p-4 rounded-xl border border-primary/20 bg-card space-y-3 shadow-xs">
                <div className="text-[11px] font-bold text-text/60 uppercase tracking-wider flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5 text-primary" />
                  <span>{language === 'th' ? 'สรุปยอดเงินทั้งสิ้น' : 'Financial Summary'}</span>
                </div>

                {/* Subtotal, Discounts, VAT breakdown */}
                <div className="space-y-1.5 text-xs text-text/70 border-b border-border pb-3">
                  <div className="flex justify-between">
                    <span>{language === 'th' ? 'ยอดรวมสินค้า (Subtotal):' : 'Gross Subtotal:'}</span>
                    <span className="font-mono font-medium">{formatMoney(totals.grossSubtotal)}</span>
                  </div>

                  {addMoney(totals.itemDiscounts, totals.orderDiscount).amountInCents > 0 && (
                    <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-semibold">
                      <span>{language === 'th' ? 'ส่วนลดรวม (Discount):' : 'Total Discount:'}</span>
                      <span className="font-mono">-{formatMoney(addMoney(totals.itemDiscounts, totals.orderDiscount))}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-[11px] text-text/50">
                    <span>{language === 'th' ? 'ภาษีมูลค่าเพิ่ม VAT 7% (รวมในราคา):' : 'VAT 7% (Inclusive):'}</span>
                    <span className="font-mono">{formatMoney(totals.totalTax)}</span>
                  </div>
                </div>

                {/* Prominent Grand Total Display */}
                <div className="pt-1">
                  <div className="text-[11px] font-bold text-text/50 uppercase tracking-wider">
                    {t.checkout.totalDue}
                  </div>
                  <div className="text-3xl sm:text-4xl font-black font-mono text-primary tracking-tight mt-0.5">
                    {formatMoney(grandTotal)}
                  </div>
                </div>

                {/* Split Mode Telemetry Live Grid */}
                {isSplitMode && (
                  <div className="pt-3 border-t border-border grid grid-cols-3 gap-2 text-center text-xs font-mono">
                    <div className="p-2 rounded-lg bg-background border border-border shadow-2xs">
                      <div className="text-[9px] text-text/60 font-sans font-semibold uppercase">
                        {language === 'th' ? 'จ่ายแล้ว' : 'Tendered'}
                      </div>
                      <div className="font-bold text-text mt-0.5">
                        {formatMoney(totalTenderedAmount)}
                      </div>
                    </div>
                    <div
                      className={`p-2 rounded-lg border shadow-2xs ${
                        remainingBalanceDue.amountInCents === 0
                          ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                          : 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      <div className="text-[9px] font-sans font-semibold uppercase">
                        {language === 'th' ? 'คงเหลือ' : 'Due'}
                      </div>
                      <div className="font-black mt-0.5">
                        {formatMoney(remainingBalanceDue)}
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-background border border-border shadow-2xs">
                      <div className="text-[9px] text-text/60 font-sans font-semibold uppercase">
                        {t.checkout.changeDue}
                      </div>
                      <div className="font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                        {formatMoney(changeDue)}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Offline / Online Status Badge */}
              <div className="flex items-center justify-between text-[11px] text-text/50 px-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      isOnline ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
                    }`}
                  />
                  <span>
                    {isOnline
                      ? language === 'th'
                        ? 'เชื่อมต่อเซิร์ฟเวอร์เรียลไทม์'
                        : 'Real-time Server Active'
                      : language === 'th'
                      ? 'โหมดออฟไลน์ (บันทึกใน Outbox)'
                      : 'Offline Mode (Queues in Outbox)'}
                  </span>
                </div>
                <span className="font-mono text-[10px]">
                  {items.length} {language === 'th' ? 'ชิ้น' : 'items'}
                </span>
              </div>
            </div>
          </div>
        )}
      </Modal>

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

      {/* Submodals for Receipt Preview & Full Tax Invoice */}
      {completedOrder && (
        <>
          <ReceiptPrintModal
            isOpen={isReceiptModalOpen}
            onClose={() => setIsReceiptModalOpen(false)}
            order={completedOrder}
          />

          <FullTaxInvoiceModal
            isOpen={isFullTaxModalOpen}
            onClose={() => setIsFullTaxModalOpen(false)}
            order={completedOrder}
          />
        </>
      )}
    </>
  );
};
