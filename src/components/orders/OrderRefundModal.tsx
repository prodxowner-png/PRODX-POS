import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Order, CartLineItem } from '../../domain/order';
import { Money, createMoney, formatMoney, addMoney, subtractMoney } from '../../domain/money';
import { User } from '../../domain/auth';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { useReceiptPrinter } from '../../context/ReceiptPrinterContext';
import { createRefundApi } from '../../adapters/refundApiFactory';
import { createProductionSupervisorAuthorizationApi } from '../../adapters/productionSupervisorAuthorizationApi';
import { SupervisorAuthModal } from '../auth/SupervisorAuthModal';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import {
  RotateCcw,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  Banknote,
  CreditCard,
  QrCode,
  PackageCheck,
  Zap,
  Boxes,
  Minus,
  Plus,
  RefreshCw,
  Receipt,
  UserCheck,
  Lock,
} from 'lucide-react';
import { triggerHaptic } from '../../services/hapticService';

export interface OrderRefundModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order;
  onRefundCompleted: (refundedOrder: Order) => void;
}

type RefundMode = 'full' | 'itemized' | 'custom_amount';

interface ItemReturnState {
  lineId: string;
  productId: string;
  productName: string;
  sku: string;
  originalQty: number;
  returnQty: number;
  isSelected: boolean;
  unitPriceCents: number;
  currentStock: number;
}

export const OrderRefundModal: React.FC<OrderRefundModalProps> = ({
  isOpen,
  onClose,
  order,
  onRefundCompleted,
}) => {
  const { session, can } = useAuth();
  const { addToast } = useToast();
  const { language, t } = useLanguage();
  const { kickCashDrawer } = useReceiptPrinter();

  // Mode: Full Order Quick Refund vs Itemized Return vs Custom Goodwill Credit
  const [refundMode, setRefundMode] = useState<RefundMode>('full');

  // Refund Reason
  const [refundReason, setRefundReason] = useState('Customer Return / Defective');
  const [customReasonNote, setCustomReasonNote] = useState('');

  // Refund Tender Method
  const [refundMethod, setRefundMethod] = useState<'cash' | 'card' | 'qr_digital'>(
    order.payments[0]?.method || 'cash'
  );

  // Auto-Restock Inventory Toggle
  const [restockItems, setRestockItems] = useState(true);

  // Custom refund amount in cents
  const [customAmountCents, setCustomAmountCents] = useState<number>(
    order.totals.grandTotal.amountInCents
  );

  // Itemized return states
  const [itemReturns, setItemReturns] = useState<ItemReturnState[]>(() => {
    return order.items.map((item) => ({
      lineId: item.lineId,
      productId: item.product.id,
      productName: item.product.name,
      sku: item.product.sku,
      originalQty: item.quantity,
      returnQty: item.quantity,
      isSelected: true,
      unitPriceCents: Math.round(item.lineTotal.amountInCents / item.quantity),
      currentStock: item.product.currentStock,
    }));
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [isSupervisorModalOpen, setIsSupervisorModalOpen] = useState(false);
  const refundIdempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    refundIdempotencyKeyRef.current = null;
  }, [isOpen, order.id]);

  // Reasons list
  const reasons = useMemo(() => [
    {
      id: 'Customer Return / Defective',
      label: language === 'th' ? 'สินค้าชำรุด / มีตำหนิ' : 'Defective Product / Damaged',
    },
    {
      id: 'Customer Changed Mind',
      label: language === 'th' ? 'ลูกค้าเปลี่ยนใจ / คืนสินค้า' : 'Customer Changed Mind',
    },
    {
      id: 'Wrong Item Ordered',
      label: language === 'th' ? 'สั่งซื้อผิดรายการ' : 'Wrong Item Ordered',
    },
    {
      id: 'Billing / Cashier Error',
      label: language === 'th' ? 'คิดเงินผิด / ข้อผิดพลาดแคชเชียร์' : 'Billing / Cashier Error',
    },
    {
      id: 'Manager Discretion / Goodwill',
      label: language === 'th' ? 'กรณีพิเศษจากผู้จัดการ' : 'Manager Discretion / Goodwill',
    },
  ], [language]);

  // Handle item toggle
  const toggleItemSelection = (lineId: string) => {
    setItemReturns((prev) =>
      prev.map((it) => (it.lineId === lineId ? { ...it, isSelected: !it.isSelected } : it))
    );
  };

  // Handle return quantity change
  const updateItemReturnQty = (lineId: string, delta: number) => {
    setItemReturns((prev) =>
      prev.map((it) => {
        if (it.lineId === lineId) {
          const nextQty = Math.max(1, Math.min(it.originalQty, it.returnQty + delta));
          return { ...it, returnQty: nextQty, isSelected: true };
        }
        return it;
      })
    );
  };

  // Calculate calculated refund amount based on mode
  const effectiveRefundAmount: Money = useMemo(() => {
    if (refundMode === 'full') {
      return order.totals.grandTotal;
    }
    if (refundMode === 'custom_amount') {
      const clamped = Math.max(0, Math.min(order.totals.grandTotal.amountInCents, customAmountCents));
      return createMoney(clamped, order.totals.grandTotal.currency);
    }
    // Itemized mode
    const totalCents = itemReturns
      .filter((it) => it.isSelected)
      .reduce((sum, it) => sum + it.returnQty * it.unitPriceCents, 0);
    const clampedCents = Math.min(order.totals.grandTotal.amountInCents, totalCents);
    return createMoney(clampedCents, order.totals.grandTotal.currency);
  }, [refundMode, order.totals.grandTotal, customAmountCents, itemReturns]);

  // Items to restock
  const itemsToRestockPayload = useMemo(() => {
    if (!restockItems) return [];
    if (refundMode === 'full') {
      return order.items.map((i) => ({ productId: i.product.id, quantity: i.quantity }));
    }
    if (refundMode === 'itemized') {
      return itemReturns
        .filter((it) => it.isSelected && it.returnQty > 0)
        .map((it) => ({ productId: it.productId, quantity: it.returnQty }));
    }
    // Custom amount: no physical item return unless full
    return [];
  }, [restockItems, refundMode, order.items, itemReturns]);

  const totalRestockedUnits = useMemo(() => {
    return itemsToRestockPayload.reduce((sum, item) => sum + item.quantity, 0);
  }, [itemsToRestockPayload]);

  const isCurrentUserManager = useMemo(() => {
    if (!session) return false;
    const role = session.currentUser.role;
    return role === 'manager' || role === 'admin' || can('pos:refund');
  }, [session, can]);

  const handleInitiateRefund = () => {
    if (effectiveRefundAmount.amountInCents <= 0) {
      addToast({
        title: language === 'th' ? 'จำนวนเงินไม่ถูกต้อง' : 'Invalid Amount',
        message: language === 'th' ? 'กรุณาระบุยอดเงินคืนที่มากกว่า 0' : 'Refund amount must be greater than zero.',
        type: 'warning',
      });
      return;
    }

    if (refundMode === 'itemized' && itemsToRestockPayload.length === 0 && restockItems) {
      addToast({
        title: language === 'th' ? 'กรุณาเลือกรายการสินค้า' : 'No Items Selected',
        message: language === 'th' ? 'กรุณาเลือกอย่างน้อย 1 รายการเพื่อคืนสินค้า' : 'Please select at least one item to return.',
        type: 'warning',
      });
      return;
    }

    // Every production refund must obtain a fresh, server-issued supervisor grant.
    // The local PIN remains the explicit development-only mock authorization path.
    if (import.meta.env.DEV && isCurrentUserManager && session?.currentUser) {
      void executeRefundProcess(session.currentUser);
    } else {
      setIsSupervisorModalOpen(true);
    }
  };

  const handleSupervisorAuthorized = async (supervisor: User, _notes?: string, secret?: string) => {
    setIsSupervisorModalOpen(false);
    await executeRefundProcess(supervisor, secret);
  };

  const executeRefundProcess = async (authorizedUser: User, supervisorSecret?: string) => {
    if (!session) return;
    setIsProcessing(true);

    try {
      const finalReason = customReasonNote ? `${refundReason} (${customReasonNote})` : refundReason;
      const refundApi = createRefundApi(session.token);
      const idempotencyKey =
        refundIdempotencyKeyRef.current ??
        (refundIdempotencyKeyRef.current = globalThis.crypto.randomUUID());
      let refunded: Order;
      let approvalName = authorizedUser.name;

      if (refundApi.mode === 'mock') {
        refunded = await refundApi.refundOrder(
          session.currentStore.id,
          order.id,
          effectiveRefundAmount,
          finalReason,
          refundMethod,
          restockItems,
          authorizedUser.id,
          authorizedUser.name,
          itemsToRestockPayload
        );
      } else {
        if (!supervisorSecret?.trim()) {
          throw new Error(language === 'th'
            ? 'ต้องยืนยันรหัสผ่านผู้อนุมัติผ่านเซิร์ฟเวอร์ก่อนคืนเงิน'
            : 'A supervisor secret is required for server authorization.');
        }
        const authorization = await createProductionSupervisorAuthorizationApi(session.token).authorize({
          action: 'refund',
          orderId: order.id,
          supervisorUsername: authorizedUser.email,
          supervisorSecret,
        });
        const result = await refundApi.refund({
          orderId: order.id,
          refundAmount: effectiveRefundAmount,
          reason: finalReason,
          refundMethod,
          itemsToRestock: restockItems ? itemsToRestockPayload : [],
          idempotencyKey,
          supervisorAuthorizationToken: authorization.authorizationToken,
        });
        refunded = {
          ...order,
          status: result.status,
          notes: order.notes
            ? `${order.notes} | [REFUND ${result.idempotencyCached ? 'REPLAY' : 'COMMITTED'}] ${finalReason}`
            : `[REFUND ${result.idempotencyCached ? 'REPLAY' : 'COMMITTED'}] ${finalReason}`,
        };
        approvalName = 'server-authorized principal';
      }

      // Trigger cash drawer kick if cash refund
      if (refundMethod === 'cash') {
        try {
          await kickCashDrawer();
        } catch {
          // non-blocking
        }
      }

      triggerHaptic('success');

      addToast({
        title: language === 'th' ? '⚡ คืนเงินและปรับปรุงสต็อกสำเร็จ' : '⚡ Quick Refund Processed',
        message:
          language === 'th'
            ? `คืนเงินคำสั่งซื้อ #${order.orderNumber} ยอด ${formatMoney(effectiveRefundAmount)} (ปรับสต็อก +${totalRestockedUnits} ชิ้น อนุมัติโดย ${approvalName})`
            : `Refunded ${formatMoney(effectiveRefundAmount)} for order #${order.orderNumber}. Restocked +${totalRestockedUnits} units (Approved by ${approvalName}).`,
        type: 'success',
      });

      onRefundCompleted(refunded);
      onClose();
    } catch (err: any) {
      addToast({
        title: language === 'th' ? 'การคืนเงินล้มเหลว' : 'Refund Failed',
        message: err?.message || 'Error processing refund transaction.',
        type: 'error',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={
          language === 'th'
            ? `⚡ คืนเงินด่วน (Quick Refund): #${order.orderNumber}`
            : `⚡ Quick Refund & Return: #${order.orderNumber}`
        }
        description={
          language === 'th'
            ? 'ทำรายการคืนเงิน คืนสินค้ากลับเข้าสต็อก และบันทึกบัญชีอัตโนมัติ (สิทธิ์ผู้จัดการ)'
            : 'Process immediate refund, automatically replenish inventory, and log audit ledger.'
        }
        maxWidth="lg"
      >
        <div className="space-y-4 select-none max-h-[75vh] overflow-y-auto pr-1 no-scrollbar">
          {/* Manager Authorization Banner */}
          <div className="p-3 rounded-xl border border-border bg-card flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div
                className={`p-2 rounded-lg ${
                  isCurrentUserManager
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                }`}
              >
                {isCurrentUserManager ? <ShieldCheck className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
              </div>
              <div>
                <div className="text-xs font-bold text-text flex items-center gap-1.5">
                  <span>
                    {isCurrentUserManager
                      ? language === 'th'
                        ? 'สิทธิ์ผู้จัดการพร้อมใช้งาน (Manager Ready)'
                        : 'Manager Authorization Active'
                      : language === 'th'
                      ? 'ต้องใช้รหัส PIN ผู้จัดการ (Manager PIN Required)'
                      : 'Supervisor / Manager Authorization Required'}
                  </span>
                  {isCurrentUserManager && (
                    <Badge variant="success" size="sm">
                      {session?.currentUser.role.toUpperCase()}
                    </Badge>
                  )}
                </div>
                <div className="text-[11px] text-text/60">
                  {isCurrentUserManager
                    ? language === 'th'
                      ? `ดำเนินการในนามผู้จัดการ: ${session?.currentUser.name}`
                      : `Authenticated as: ${session?.currentUser.name}`
                    : language === 'th'
                    ? 'ระบบจะเรียกถามรหัส PIN ผู้จัดการก่อนยืนยันรายการ'
                    : 'A supervisor PIN prompt will appear upon confirmation.'}
                </div>
              </div>
            </div>

            <div className="text-right">
              <div className="text-[11px] text-text/50">{language === 'th' ? 'ยอดเดิมของบิล' : 'Original Total'}</div>
              <div className="text-sm font-bold font-mono text-text">
                {formatMoney(order.totals.grandTotal)}
              </div>
            </div>
          </div>

          {/* Refund Mode Selection Tabs */}
          <div>
            <label className="text-xs font-bold text-text/80 block mb-1.5">
              {language === 'th' ? 'รูปแบบการคืนเงิน (Refund Mode):' : 'Refund Mode:'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setRefundMode('full')}
                className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all flex flex-col gap-1 ${
                  refundMode === 'full'
                    ? 'border-primary bg-primary/10 text-primary font-bold ring-1 ring-primary'
                    : 'border-border hover:bg-background text-text/70'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <Zap className="h-3.5 w-3.5" />
                  <span>{language === 'th' ? 'คืนเงินทั้งบิล' : 'Full Refund'}</span>
                </div>
                <div className="text-[10px] opacity-75">
                  {language === 'th' ? 'คืนทุกรายการ 100%' : '100% Items & Total'}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRefundMode('itemized')}
                className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all flex flex-col gap-1 ${
                  refundMode === 'itemized'
                    ? 'border-primary bg-primary/10 text-primary font-bold ring-1 ring-primary'
                    : 'border-border hover:bg-background text-text/70'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <Boxes className="h-3.5 w-3.5" />
                  <span>{language === 'th' ? 'คืนรายชิ้น' : 'Itemized'}</span>
                </div>
                <div className="text-[10px] opacity-75">
                  {language === 'th' ? 'เลือกจำนวนตามต้องการ' : 'Select items & units'}
                </div>
              </button>

              <button
                type="button"
                onClick={() => setRefundMode('custom_amount')}
                className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all flex flex-col gap-1 ${
                  refundMode === 'custom_amount'
                    ? 'border-primary bg-primary/10 text-primary font-bold ring-1 ring-primary'
                    : 'border-border hover:bg-background text-text/70'
                }`}
              >
                <div className="flex items-center gap-1.5 text-xs font-bold">
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>{language === 'th' ? 'ระบุยอดเอง' : 'Goodwill / Custom'}</span>
                </div>
                <div className="text-[10px] opacity-75">
                  {language === 'th' ? 'ส่วนลดชดเชยพิเศษ' : 'Custom credit amount'}
                </div>
              </button>
            </div>
          </div>

          {/* Itemized Selection Table (When Mode is Itemized) */}
          {refundMode === 'itemized' && (
            <div className="p-3 rounded-xl border border-border bg-background/50 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-bold text-text">
                <span>{language === 'th' ? 'เลือกสินค้าที่ลูกค้านำมาคืน:' : 'Select Items to Return:'}</span>
                <span className="text-text/60">
                  {itemReturns.filter((i) => i.isSelected).length} / {itemReturns.length}{' '}
                  {language === 'th' ? 'รายการที่เลือก' : 'selected'}
                </span>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {itemReturns.map((it) => (
                  <div
                    key={it.lineId}
                    onClick={() => toggleItemSelection(it.lineId)}
                    className={`p-2 rounded-lg border text-xs flex items-center justify-between transition-all cursor-pointer ${
                      it.isSelected
                        ? 'border-primary/50 bg-primary/5 text-text'
                        : 'border-border bg-card text-text/50 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={it.isSelected}
                        onChange={() => {}} // Handled by container onClick
                        className="h-4 w-4 rounded accent-primary cursor-pointer shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="font-bold truncate text-text">{it.productName}</div>
                        <div className="text-[10px] text-text/60 font-mono">
                          {it.sku} · {formatMoney(createMoney(it.unitPriceCents, order.totals.grandTotal.currency))}/ชิ้น
                        </div>
                      </div>
                    </div>

                    {/* Quantity Stepper */}
                    <div
                      className="flex items-center gap-1.5 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => updateItemReturnQty(it.lineId, -1)}
                        disabled={it.returnQty <= 1}
                        className="h-6 w-6 rounded bg-card border border-border flex items-center justify-center hover:bg-background disabled:opacity-30 cursor-pointer"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-8 text-center font-mono font-bold text-xs">
                        {it.returnQty}/{it.originalQty}
                      </span>
                      <button
                        type="button"
                        onClick={() => updateItemReturnQty(it.lineId, 1)}
                        disabled={it.returnQty >= it.originalQty}
                        className="h-6 w-6 rounded bg-card border border-border flex items-center justify-center hover:bg-background disabled:opacity-30 cursor-pointer"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Custom Amount Input (When Mode is Custom) */}
          {refundMode === 'custom_amount' && (
            <div className="p-3.5 rounded-xl border border-border bg-card space-y-2">
              <label className="text-xs font-bold text-text block">
                {language === 'th' ? 'ระบุจำนวนเงินคืน (THB):' : 'Specify Refund Amount:'}
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={(order.totals.grandTotal.amountInCents / 100).toFixed(2)}
                  value={(customAmountCents / 100).toFixed(2)}
                  onChange={(e) => {
                    const parsed = parseFloat(e.target.value) || 0;
                    setCustomAmountCents(Math.round(parsed * 100));
                  }}
                  className="w-full h-10 px-3 font-mono font-bold text-base rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div className="text-[11px] text-text/60">
                {language === 'th'
                  ? `สูงสุดไม่เกินยอดบิล: ${formatMoney(order.totals.grandTotal)}`
                  : `Maximum allowable: ${formatMoney(order.totals.grandTotal)}`}
              </div>
            </div>
          )}

          {/* Effective Refund Total Highlight Box */}
          <div className="p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold text-rose-800 dark:text-rose-300">
                {language === 'th' ? 'ยอดเงินที่ต้องคืนลูกค้า (Total Refund):' : 'Total Refund to Customer:'}
              </div>
              <div className="text-2xl font-black font-mono text-rose-600 dark:text-rose-400">
                {formatMoney(effectiveRefundAmount)}
              </div>
            </div>
            <div className="text-right">
              <Badge variant="warning" size="sm">
                {refundMode === 'full'
                  ? language === 'th'
                    ? 'คืนเต็มจำนวน'
                    : 'Full 100%'
                  : refundMode === 'itemized'
                  ? `${itemsToRestockPayload.length} ${language === 'th' ? 'รายการ' : 'items'}`
                  : language === 'th'
                  ? 'ส่วนลดชดเชย'
                  : 'Goodwill'}
              </Badge>
              {restockItems && totalRestockedUnits > 0 && (
                <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-bold mt-1 flex items-center justify-end gap-1">
                  <PackageCheck className="h-3 w-3" />
                  <span>+{totalRestockedUnits} {language === 'th' ? 'ชิ้นเข้าสต็อก' : 'units restock'}</span>
                </div>
              )}
            </div>
          </div>

          {/* Automatic Inventory Restock Control & Preview */}
          <div className="p-3.5 rounded-xl border border-border bg-card space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PackageCheck className="h-4 w-4 text-emerald-500" />
                <div>
                  <div className="text-xs font-bold text-text">
                    {language === 'th' ? 'ปรับปรุงสต็อกสินค้าอัตโนมัติ (Auto-Restock Inventory)' : 'Auto-Restock Inventory'}
                  </div>
                  <div className="text-[11px] text-text/60">
                    {language === 'th'
                      ? 'บันทึกสต็อกกลับเข้าคลังและลงบัญชี Inventory Ledger ทันที'
                      : 'Replenishes store stock balance and creates audit ledger entries.'}
                  </div>
                </div>
              </div>
              <input
                type="checkbox"
                checked={restockItems}
                onChange={(e) => setRestockItems(e.target.checked)}
                className="h-4 w-4 rounded accent-primary cursor-pointer"
              />
            </div>

            {/* Restock Preview Table if items exist */}
            {restockItems && itemsToRestockPayload.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border/60 text-xs space-y-1">
                <div className="text-[11px] font-bold text-text/70 mb-1">
                  {language === 'th' ? 'รายการที่จะปรับเพิ่มเข้าสต็อก:' : 'Inventory Restock Breakdown:'}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {itemsToRestockPayload.map((it) => {
                    const itemMatch = order.items.find((oi) => oi.product.id === it.productId);
                    const currentStock = itemMatch?.product.currentStock ?? 0;
                    return (
                      <div
                        key={it.productId}
                        className="p-1.5 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-[11px] flex items-center justify-between"
                      >
                        <span className="font-semibold text-text truncate max-w-[140px]">
                          {itemMatch?.product.name || it.productId}
                        </span>
                        <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold shrink-0">
                          {currentStock} ➔ {currentStock + it.quantity} (+{it.quantity})
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Refund Tender Method */}
          <div>
            <label className="text-xs font-bold text-text/80 block mb-1.5">
              {language === 'th' ? 'ช่องทางการจ่ายเงินคืน (Refund Tender):' : 'Refund Tender Method:'}
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setRefundMethod('cash')}
                className={`p-2.5 rounded-xl border text-center cursor-pointer transition-all flex flex-col items-center gap-1 ${
                  refundMethod === 'cash'
                    ? 'border-primary bg-primary/10 text-primary font-bold ring-1 ring-primary'
                    : 'border-border hover:bg-background text-text/70'
                }`}
              >
                <Banknote className="h-4 w-4" />
                <span className="text-xs">{language === 'th' ? 'เงินสด (เปิดลิ้นชัก)' : 'Cash (Drawer)'}</span>
              </button>

              <button
                type="button"
                onClick={() => setRefundMethod('card')}
                className={`p-2.5 rounded-xl border text-center cursor-pointer transition-all flex flex-col items-center gap-1 ${
                  refundMethod === 'card'
                    ? 'border-primary bg-primary/10 text-primary font-bold ring-1 ring-primary'
                    : 'border-border hover:bg-background text-text/70'
                }`}
              >
                <CreditCard className="h-4 w-4" />
                <span className="text-xs">{language === 'th' ? 'คืนบัตรเครดิต' : 'Card Reversal'}</span>
              </button>

              <button
                type="button"
                onClick={() => setRefundMethod('qr_digital')}
                className={`p-2.5 rounded-xl border text-center cursor-pointer transition-all flex flex-col items-center gap-1 ${
                  refundMethod === 'qr_digital'
                    ? 'border-primary bg-primary/10 text-primary font-bold ring-1 ring-primary'
                    : 'border-border hover:bg-background text-text/70'
                }`}
              >
                <QrCode className="h-4 w-4" />
                <span className="text-xs">{language === 'th' ? 'พร้อมเพย์ / โอน' : 'PromptPay / QR'}</span>
              </button>
            </div>
          </div>

          {/* Refund Reasons */}
          <div>
            <label className="text-xs font-bold text-text/80 block mb-1.5">
              {language === 'th' ? 'เหตุผลการคืนเงิน / คืนสินค้า:' : 'Refund Reason:'}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {reasons.map((r) => {
                const isSelected = refundReason === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRefundReason(r.id)}
                    className={`p-2 rounded-xl border text-left text-xs cursor-pointer transition-all flex items-center justify-between ${
                      isSelected
                        ? 'border-rose-500 bg-rose-500/10 text-rose-900 dark:text-rose-200 font-bold ring-1 ring-rose-500'
                        : 'border-border hover:bg-background text-text/80'
                    }`}
                  >
                    <span>{r.label}</span>
                    {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-rose-500 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* Custom note */}
            <input
              type="text"
              placeholder={language === 'th' ? 'หมายเหตุเพิ่มเติม (ถ้ามี)...' : 'Additional refund note (optional)...'}
              value={customReasonNote}
              onChange={(e) => setCustomReasonNote(e.target.value)}
              className="w-full mt-2 h-8 px-3 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Cash Drawer notice if cash */}
          {refundMethod === 'cash' && (
            <div className="p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs flex items-center gap-2">
              <Banknote className="h-4 w-4 shrink-0 text-amber-500" />
              <span>
                {language === 'th'
                  ? 'ระบบจะส่งคำสั่งเปิดลิ้นชักเก็บเงิน (Cash Drawer Kick) และบันทึกยอดเงินออกในกะปัจจุบัน'
                  : 'System will kick cash drawer and record cash refund deduction in the current shift.'}
              </span>
            </div>
          )}

          {/* Footer Action Buttons */}
          <div className="pt-3 border-t border-border flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={isProcessing}>
              {language === 'th' ? 'ยกเลิก' : 'Cancel'}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleInitiateRefund}
              isLoading={isProcessing}
              leftIcon={<RotateCcw className="h-4 w-4" />}
            >
              {isCurrentUserManager
                ? language === 'th'
                  ? `ยืนยันคืนเงิน ${formatMoney(effectiveRefundAmount)}`
                  : `Confirm Refund ${formatMoney(effectiveRefundAmount)}`
                : language === 'th'
                ? 'ขออนุมัติผู้จัดการเพื่อคืนเงิน'
                : 'Request Manager Authorization'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Supervisor Auth Modal Trigger for Cashiers */}
      {isSupervisorModalOpen && (
        <SupervisorAuthModal
          isOpen={isSupervisorModalOpen}
          onClose={() => setIsSupervisorModalOpen(false)}
          title={language === 'th' ? 'อนุมัติการคืนเงิน (Manager PIN)' : 'Authorize Refund (Manager PIN)'}
          actionDescription={`${
            language === 'th' ? 'อนุมัติคืนเงินคำสั่งซื้อ' : 'Refund Authorization for Order'
          } #${order.orderNumber} (${formatMoney(effectiveRefundAmount)})`}
          requiredRole="manager"
          onAuthorized={handleSupervisorAuthorized}
        />
      )}
    </>
  );
};
