import React, { useState } from 'react';
import { motion, AnimatePresence, PanInfo } from 'motion/react';
import {
  Layers,
  ShoppingCart,
  CreditCard,
  Banknote,
  ChevronUp,
  ChevronDown,
  Zap,
  Barcode,
  Sparkles,
  CheckCircle2,
  PlusCircle,
  MinusCircle,
  LockOpen,
} from 'lucide-react';
import { useCart } from '../../context/CartContext';
import { useShift } from '../../context/ShiftContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { createMoney, formatMoney } from '../../domain/money';
import { Category } from '../../domain/catalog';
import { CartPanel } from './CartPanel';
import { playScannerSound } from '../../services/soundService';
import { triggerHaptic } from '../../services/hapticService';

export type PosQuickActionTab = 'products' | 'cart' | 'payment' | 'shift';

export interface PosMobileSwipeDrawerProps {
  activeView: 'catalog' | 'cart';
  onChangeView: (view: 'catalog' | 'cart') => void;
  categories: Category[];
  selectedCategory: string;
  onSelectCategory: (categoryId: string) => void;
  onOpenQuickPay: () => void;
  onOpenFullPayment: () => void;
  onOpenScanner: () => void;
  onOpenAiAssistant: () => void;
}

export const PosMobileSwipeDrawer: React.FC<PosMobileSwipeDrawerProps> = ({
  activeView,
  onChangeView,
  categories,
  selectedCategory,
  onSelectCategory,
  onOpenQuickPay,
  onOpenFullPayment,
  onOpenScanner,
  onOpenAiAssistant,
}) => {
  const { totals, items } = useCart();
  const { currentShift, openShift, recordCashMovement, isLoading: isShiftLoading } = useShift();
  const { language, t } = useLanguage();
  const { addToast } = useToast();
  const isThai = language === 'th';

  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<PosQuickActionTab>('products');
  const [cashAmountInput, setCashAmountInput] = useState<string>('2000');
  const [cashReasonInput, setCashReasonInput] = useState<string>('');
  const [isSubmittingShift, setIsSubmittingShift] = useState<boolean>(false);

  const tabOrder: PosQuickActionTab[] = ['products', 'cart', 'payment', 'shift'];

  // Handle vertical swipe on the persistent dock / sheet header
  const handleVerticalDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const swipeThreshold = 35;
    const velocityThreshold = 240;

    if (info.offset.y < -swipeThreshold || info.velocity.y < -velocityThreshold) {
      triggerHaptic('light');
      setIsExpanded(true);
    } else if (info.offset.y > swipeThreshold || info.velocity.y > velocityThreshold) {
      triggerHaptic('light');
      setIsExpanded(false);
    }
  };

  // Handle horizontal swipe inside the expanded drawer to cycle between POS actions
  const handleHorizontalDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const horizontalThreshold = 55;
    if (Math.abs(info.offset.x) < horizontalThreshold) return;

    const currentIndex = tabOrder.indexOf(activeTab);
    if (info.offset.x < -horizontalThreshold && currentIndex < tabOrder.length - 1) {
      triggerHaptic('light');
      const nextTab = tabOrder[currentIndex + 1];
      setActiveTab(nextTab);
    } else if (info.offset.x > horizontalThreshold && currentIndex > 0) {
      triggerHaptic('light');
      const prevTab = tabOrder[currentIndex - 1];
      setActiveTab(prevTab);
    }
  };

  const handleSelectAction = (tab: PosQuickActionTab) => {
    playScannerSound('click');
    triggerHaptic('light');

    if (tab === 'products') {
      setActiveTab('products');
      onChangeView('catalog');
      if (isExpanded && activeTab === 'products') {
        setIsExpanded(false);
      }
      return;
    }

    if (tab === 'cart') {
      setActiveTab('cart');
      setIsExpanded(true);
      return;
    }

    if (tab === 'payment') {
      setActiveTab('payment');
      if (totals.totalItemsCount > 0 && !isExpanded) {
        onOpenQuickPay();
      } else {
        setIsExpanded(true);
      }
      return;
    }

    if (tab === 'shift') {
      setActiveTab('shift');
      setIsExpanded((prev) => (activeTab === 'shift' ? !prev : true));
    }
  };

  const handleQuickOpenShift = async (amountBaht: number) => {
    if (isSubmittingShift) return;
    setIsSubmittingShift(true);
    try {
      const currency = totals.grandTotal.currency;
      await openShift(createMoney(Math.round(amountBaht * 100), currency));
      playScannerSound('success');
    } catch {
      // Error toast is already handled by ShiftContext
    } finally {
      setIsSubmittingShift(false);
    }
  };

  const handleQuickCashMovement = async (type: 'paid_in' | 'paid_out') => {
    const parsed = Number(cashAmountInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      addToast({
        title: isThai ? 'จำนวนเงินไม่ถูกต้อง' : 'Invalid Amount',
        message: isThai ? 'กรุณาระบุจำนวนเงินที่มากกว่า 0' : 'Please enter a valid positive amount.',
        type: 'warning',
      });
      return;
    }
    setIsSubmittingShift(true);
    try {
      const currency = totals.grandTotal.currency;
      await recordCashMovement(
        type,
        createMoney(Math.round(parsed * 100), currency),
        cashReasonInput.trim() ||
          (type === 'paid_in'
            ? isThai
              ? 'เติมเงินทอนเข้าลิ้นชัก'
              : 'POS Drawer Float Top-up'
            : isThai
            ? 'นำเงินสดออกค่าใช้จ่ายหน้าร้าน'
            : 'POS Petty Cash Payout'),
      );
      setCashReasonInput('');
      playScannerSound('success');
      addToast({
        title:
          type === 'paid_in'
            ? isThai
              ? 'บันทึกนำเงินเข้าสำเร็จ'
              : 'Cash Pay-In Recorded'
            : isThai
            ? 'บันทึกนำเงินออกสำเร็จ'
            : 'Cash Pay-Out Recorded',
        message: `฿${parsed.toLocaleString()}`,
        type: 'success',
      });
    } catch {
      // Handled by ShiftContext
    } finally {
      setIsSubmittingShift(false);
    }
  };

  return (
    <>
      {/* Backdrop when swipeable drawer is expanded */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setIsExpanded(false)}
            className="md:landscape:hidden lg:hidden fixed inset-0 bg-black/50 backdrop-blur-xs z-40"
            aria-hidden="true"
          />
        )}
      </AnimatePresence>

      {/* Persistent & Swipeable Bottom POS Navigation Drawer (Mobile / Portrait) */}
      <motion.div
        data-testid="pos-mobile-swipe-drawer"
        aria-label="POS Quick Action Drawer"
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.12}
        onDragEnd={handleVerticalDragEnd}
        className="md:landscape:hidden lg:hidden fixed bottom-0 left-0 right-0 z-50 flex flex-col bg-card/98 backdrop-blur-xl border-t border-border shadow-[0_-10px_30px_rgba(0,0,0,0.18)] rounded-t-2xl select-none touch-pan-x"
      >
        {/* Swipe Handle & Live Order / Shift Summary Strip */}
        <div
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          aria-label={
            isThai
              ? 'ปัดขึ้นหรือแตะเพื่อเปิด/ปิดถาดควบคุม POS ด่วน'
              : 'Swipe up or tap to toggle POS quick action drawer'
          }
          onClick={() => {
            triggerHaptic('light');
            setIsExpanded((prev) => !prev);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsExpanded((prev) => !prev);
            }
          }}
          className="min-h-[44px] px-3.5 pt-2 pb-1.5 flex flex-col items-center justify-center cursor-grab active:cursor-grabbing border-b border-border/60"
        >
          {/* Tactile Pill Handle */}
          <div className="w-10 h-1.5 rounded-full bg-text/20 mb-1.5" />

          <div className="w-full flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shrink-0 whitespace-nowrap ${
                  currentShift
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    currentShift ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'
                  }`}
                />
                {currentShift
                  ? isThai
                    ? 'เปิดกะแล้ว'
                    : 'Shift Open'
                  : isThai
                  ? 'ยังไม่เปิดกะ'
                  : 'Shift Closed'}
              </span>

              <span className="text-[11px] font-semibold text-text/60 truncate">
                {totals.totalItemsCount > 0
                  ? `${totals.totalItemsCount} ${t.pos.itemCount}`
                  : isThai
                  ? 'ปัดขึ้นเพื่อดูตัวเลือกด่วน'
                  : 'Swipe up for quick actions'}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {totals.totalItemsCount > 0 && (
                <span className="font-mono text-xs font-black text-primary whitespace-nowrap">
                  {formatMoney(totals.grandTotal)}
                </span>
              )}
              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-text/50 whitespace-nowrap">
                {isExpanded ? (
                  <>
                    <span>{isThai ? 'ย่อลง' : 'Collapse'}</span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    <span>{isThai ? 'ขยาย' : 'Expand'}</span>
                    <ChevronUp className="h-3.5 w-3.5" />
                  </>
                )}
              </span>
            </div>
          </div>
        </div>

        {/* Expanded Swipeable Content Area */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key="expanded-pos-drawer-body"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: '58dvh', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ type: 'spring', bounce: 0.12, duration: 0.32 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.15}
              onDragEnd={handleHorizontalDragEnd}
              className="overflow-hidden flex flex-col border-b border-border"
            >
              {/* Panel 1: Products & Categories Quick Filter */}
              {activeTab === 'products' && (
                <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-wider text-text/80">
                      {isThai ? 'หมวดหมู่สินค้า & เครื่องมือสแกนด่วน' : 'Product Categories & Quick Tools'}
                    </h4>
                    <span className="text-[10px] font-mono text-text/50">
                      {isThai ? 'ปัดซ้าย/ขวาเพื่อสลับแท็บ' : 'Swipe L/R to switch'}
                    </span>
                  </div>

                  {/* Quick Hardware / AI Tools (44px+ touch targets) */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsExpanded(false);
                        onOpenScanner();
                      }}
                      className="min-h-[46px] px-3 rounded-xl border border-border bg-background hover:border-primary text-xs font-bold text-text flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                    >
                      <Barcode className="h-4 w-4 text-primary shrink-0" />
                      <span className="truncate">
                        {isThai ? 'สแกนบาร์โค้ด' : 'Barcode Scanner'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsExpanded(false);
                        onOpenAiAssistant();
                      }}
                      className="min-h-[46px] px-3 rounded-xl bg-[var(--chart-purple)] text-white text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer whitespace-nowrap shadow-xs"
                    >
                      <Sparkles className="h-4 w-4 text-yellow-300 shrink-0" />
                      <span className="truncate">
                        {isThai ? 'ผู้ช่วย AI แนะนำ' : 'AI Upsell Assist'}
                      </span>
                    </button>
                  </div>

                  {/* Category Grid with 44px+ minimum height */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {categories.map((cat) => {
                      const isSelected = selectedCategory === cat.id;
                      const label = cat.id === 'cat-all' ? t.pos.allCategories : cat.name;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => {
                            playScannerSound('click');
                            onSelectCategory(cat.id);
                            onChangeView('catalog');
                            setIsExpanded(false);
                          }}
                          className={`min-h-[46px] px-3 rounded-xl border text-xs font-bold flex items-center gap-2 transition-all active:scale-95 cursor-pointer whitespace-nowrap ${
                            isSelected
                              ? 'border-primary bg-primary text-white shadow-xs'
                              : 'border-border bg-background text-text/80 hover:border-primary/50'
                          }`}
                        >
                          {cat.color && (
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: cat.color }}
                            />
                          )}
                          <span className="truncate">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Panel 2: Interactive Cart inside Swipeable Drawer */}
              {activeTab === 'cart' && (
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <CartPanel
                    onOpenQuickPay={() => {
                      setIsExpanded(false);
                      onOpenQuickPay();
                    }}
                  />
                </div>
              )}

              {/* Panel 3: Quick Payment & Checkout Actions */}
              {activeTab === 'payment' && (
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div className="rounded-xl border border-border bg-background p-3.5 space-y-2">
                    <div className="flex items-center justify-between text-xs text-text/60">
                      <span>{isThai ? 'จำนวนสินค้าในตะกร้า' : 'Items in Cart'}</span>
                      <span className="font-mono font-bold text-text">
                        {totals.totalItemsCount} {t.pos.itemCount}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs text-text/60">
                      <span>{isThai ? 'ยอดรวมก่อนภาษี (Subtotal)' : 'Subtotal'}</span>
                      <span className="font-mono font-semibold text-text">
                        {formatMoney(totals.netSubtotal)}
                      </span>
                    </div>
                    <div className="pt-2 border-t border-border flex items-center justify-between">
                      <span className="text-xs font-black uppercase tracking-wider text-text">
                        {isThai ? 'ยอดสุทธิที่ต้องชำระ' : 'Grand Total'}
                      </span>
                      <span className="text-xl font-black font-mono text-primary">
                        {formatMoney(totals.grandTotal)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5">
                    <button
                      type="button"
                      disabled={items.length === 0}
                      onClick={() => {
                        setIsExpanded(false);
                        onOpenQuickPay();
                      }}
                      className="min-h-[48px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center gap-2 shadow-md transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                    >
                      <Zap className="h-4 w-4 fill-current shrink-0" />
                      <span className="truncate">
                        {isThai
                          ? 'ชำระเงินด่วน 1-Tap (เงินสด / QR / บัตร)'
                          : '1-Tap Quick-Pay (Cash / QR / Card)'}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={items.length === 0}
                      onClick={() => {
                        setIsExpanded(false);
                        onOpenFullPayment();
                      }}
                      className="min-h-[48px] px-4 rounded-xl bg-primary hover:bg-primary-dark text-white font-black text-xs flex items-center justify-center gap-2 shadow-md transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
                    >
                      <CreditCard className="h-4 w-4 shrink-0" />
                      <span className="truncate">
                        {isThai
                          ? 'หน้าจอชำระเงินเต็มรูปแบบ / แยกจ่าย'
                          : 'Full Checkout & Split Payment'}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Panel 4: Live Shift & Cash Drawer Console */}
              {activeTab === 'shift' && (
                <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
                  {!currentShift ? (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-amber-600 dark:text-amber-400">
                          {isThai
                            ? 'ยังไม่ได้เปิดกะแคชเชียร์ (Shift Closed)'
                            : 'Cashier Shift Currently Closed'}
                        </span>
                        <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">
                          Action Required
                        </span>
                      </div>
                      <p className="text-xs text-text/70 leading-relaxed">
                        {isThai
                          ? 'เลือกจำนวนเงินทอนเริ่มต้นในลิ้นชักเพื่อเปิดกะขายสินค้าได้ทันที'
                          : 'Select an opening cash float preset below to open your register shift immediately.'}
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {[1000, 2000, 5000].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            disabled={isShiftLoading || isSubmittingShift}
                            onClick={() => void handleQuickOpenShift(preset)}
                            className="min-h-[46px] px-2 rounded-xl bg-card border border-border hover:border-primary text-xs font-black font-mono text-text hover:text-primary flex items-center justify-center transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                          >
                            ฿{preset.toLocaleString()}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={isShiftLoading || isSubmittingShift}
                        onClick={() => void handleQuickOpenShift(2000)}
                        className="w-full min-h-[46px] px-4 rounded-xl bg-primary text-white text-xs font-black flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                      >
                        <LockOpen className="h-4 w-4 shrink-0" />
                        <span className="truncate">
                          {isThai
                            ? 'เปิดกะด้วยเงินทอนมาตรฐาน (฿2,000)'
                            : 'Open Shift with Standard Float (฿2,000)'}
                        </span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-black text-text truncate">
                              {isThai ? 'กะแคชเชียร์กำลังทำงาน' : 'Active Register Shift'}
                            </div>
                            <div className="text-[11px] font-mono text-text/60 truncate">
                              {isThai ? 'เงินทอนตั้งต้น:' : 'Opening Float:'}{' '}
                              {formatMoney(currentShift.openingFloat)}
                            </div>
                          </div>
                        </div>
                        <span className="shrink-0 whitespace-nowrap font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-300">
                          ACTIVE
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <input
                          type="number"
                          min="1"
                          value={cashAmountInput}
                          onChange={(e) => setCashAmountInput(e.target.value)}
                          placeholder={isThai ? 'จำนวนเงิน (บาท)' : 'Amount'}
                          className="min-h-[44px] px-3 rounded-xl border border-border bg-background text-xs font-mono font-bold text-text outline-none focus:border-primary"
                        />
                        <input
                          type="text"
                          value={cashReasonInput}
                          onChange={(e) => setCashReasonInput(e.target.value)}
                          placeholder={isThai ? 'หมายเหตุ (เช่น เติมเงินทอน)' : 'Reason / Note'}
                          className="min-h-[44px] px-3 rounded-xl border border-border bg-background text-xs text-text outline-none focus:border-primary"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          disabled={isSubmittingShift}
                          onClick={() => void handleQuickCashMovement('paid_in')}
                          className="min-h-[46px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                        >
                          <PlusCircle className="h-4 w-4 shrink-0" />
                          <span className="truncate">
                            {isThai ? 'นำเงินเข้า (Pay In)' : 'Cash Pay-In'}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={isSubmittingShift}
                          onClick={() => void handleQuickCashMovement('paid_out')}
                          className="min-h-[46px] px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                        >
                          <MinusCircle className="h-4 w-4 shrink-0" />
                          <span className="truncate">
                            {isThai ? 'นำเงินออก (Pay Out)' : 'Cash Pay-Out'}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Persistent 4-Action Touch Bar — Strictly >= 44px height & width per button */}
        <div
          role="tablist"
          aria-label="POS Mobile Quick Actions"
          className="p-2 grid grid-cols-4 gap-1.5 bg-card"
        >
          {/* 1. Products Action Button */}
          <button
            type="button"
            role="tab"
            aria-selected={
              (!isExpanded && activeView === 'catalog') ||
              (isExpanded && activeTab === 'products')
            }
            onClick={() => handleSelectAction('products')}
            className={`min-h-[48px] min-w-[44px] px-2 py-1.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
              (!isExpanded && activeView === 'catalog') ||
              (isExpanded && activeTab === 'products')
                ? 'bg-primary text-white font-black shadow-xs'
                : 'bg-background text-text/75 hover:text-text border border-border/70 font-bold'
            }`}
          >
            <Layers className="h-4 w-4 shrink-0" />
            <span className="text-[11px] leading-none truncate max-w-full">
              {isThai ? 'สินค้า' : 'Products'}
            </span>
          </button>

          {/* 2. Cart Action Button */}
          <button
            type="button"
            role="tab"
            aria-selected={isExpanded && activeTab === 'cart'}
            onClick={() => handleSelectAction('cart')}
            className={`relative min-h-[48px] min-w-[44px] px-2 py-1.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
              isExpanded && activeTab === 'cart'
                ? 'bg-primary text-white font-black shadow-xs'
                : 'bg-background text-text/75 hover:text-text border border-border/70 font-bold'
            }`}
          >
            <div className="relative flex items-center justify-center">
              <ShoppingCart className="h-4 w-4 shrink-0" />
              {totals.totalItemsCount > 0 && (
                <span className="absolute -top-1.5 -right-3 bg-rose-500 text-white text-[9px] font-black h-4 min-w-[16px] px-1 rounded-full flex items-center justify-center shadow-2xs">
                  {totals.totalItemsCount}
                </span>
              )}
            </div>
            <span className="text-[11px] leading-none truncate max-w-full">
              {isThai ? 'ตะกร้า' : 'Cart'}
            </span>
          </button>

          {/* 3. Payment Action Button */}
          <button
            type="button"
            role="tab"
            aria-selected={isExpanded && activeTab === 'payment'}
            onClick={() => handleSelectAction('payment')}
            className={`min-h-[48px] min-w-[44px] px-2 py-1.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
              isExpanded && activeTab === 'payment'
                ? 'bg-amber-500 text-slate-950 font-black shadow-xs'
                : totals.totalItemsCount > 0
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/40 font-black'
                : 'bg-background text-text/75 hover:text-text border border-border/70 font-bold'
            }`}
          >
            <CreditCard className="h-4 w-4 shrink-0" />
            <span className="text-[11px] leading-none truncate max-w-full">
              {isThai ? 'ชำระเงิน' : 'Payment'}
            </span>
          </button>

          {/* 4. Shift Action Button */}
          <button
            type="button"
            role="tab"
            aria-selected={isExpanded && activeTab === 'shift'}
            onClick={() => handleSelectAction('shift')}
            className={`min-h-[48px] min-w-[44px] px-2 py-1.5 rounded-xl flex flex-col items-center justify-center gap-1 transition-all cursor-pointer active:scale-95 whitespace-nowrap ${
              isExpanded && activeTab === 'shift'
                ? 'bg-primary text-white font-black shadow-xs'
                : 'bg-background text-text/75 hover:text-text border border-border/70 font-bold'
            }`}
          >
            <Banknote className="h-4 w-4 shrink-0" />
            <span className="text-[11px] leading-none truncate max-w-full">
              {isThai ? 'กะเงินสด' : 'Shift'}
            </span>
          </button>
        </div>
      </motion.div>
    </>
  );
};
