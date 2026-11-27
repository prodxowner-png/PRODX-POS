import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  CustomerDisplayState,
  customerDisplayService,
} from '../../services/customerDisplayChannel';
import { formatMoney, createMoney } from '../../domain/money';
import { ProdxLogo } from '../../components/common/ProdxLogo';
import {
  ShoppingCart,
  QrCode,
  CreditCard,
  Banknote,
  CheckCircle2,
  Sparkles,
  UserCheck,
  Percent,
  Clock,
  Maximize2,
  Minimize2,
  Store,
  ArrowRight,
  ShieldCheck,
  Tag,
  Coffee,
} from 'lucide-react';

export const CustomerDisplayView: React.FC = () => {
  const [displayState, setDisplayState] = useState<CustomerDisplayState | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const unsubscribe = customerDisplayService.subscribe((state) => {
      setDisplayState(state);
    });

    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const storeName = displayState?.storeName || 'PRODX Flagship Store';
  const items = displayState?.items || [];
  const totals = displayState?.totals || {
    grossSubtotal: createMoney(0),
    itemDiscounts: createMoney(0),
    orderDiscount: createMoney(0),
    netSubtotal: createMoney(0),
    totalTax: createMoney(0),
    grandTotal: createMoney(0),
    totalItemsCount: 0,
  };
  const customer = displayState?.customer;
  const status = displayState?.status || 'idle';
  const activePayment = displayState?.activePayment;
  const completedOrder = displayState?.completedOrder;

  const hasItems = items.length > 0;

  return (
    <div className="min-h-screen w-full bg-background text-text flex flex-col select-none font-sans overflow-hidden">
      {/* Top Banner Header */}
      <header className="h-20 px-6 sm:px-10 border-b border-border border-crisp bg-card flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <ProdxLogo variant="horizontal" size="md" showTagline={false} />
          <div className="h-6 w-[1px] bg-border hidden sm:block" />
          <div className="flex items-center gap-2 text-sm text-text/80">
            <Store className="h-4 w-4 text-primary" />
            <span className="font-semibold">{storeName}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {customer && (
            <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs font-semibold">
              <UserCheck className="h-4 w-4 text-amber-400" />
              <span>{customer.name}</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-[11px] font-bold">
                {customer.loyaltyPoints} แต้ม
              </span>
            </div>
          )}

          <div className="flex items-center gap-2 text-text/70 font-mono tabular-nums text-sm">
            <Clock className="h-4 w-4 text-brand-text-secondary" />
            <span>{currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </div>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="p-2 rounded-lg border border-border bg-card hover:bg-background text-text/80 transition-colors cursor-pointer"
            title="Fullscreen Mode"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Main Dual-Column Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0">
        {/* Left Column: Items Scanned / Welcome Idle Hero */}
        <div className="lg:col-span-7 flex flex-col border-r border-border border-crisp overflow-hidden bg-background">
          {status === 'completed' && completedOrder ? (
            /* Completion Hero Screen */
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-5">
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="w-24 h-24 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400"
              >
                <CheckCircle2 className="h-12 w-12" />
              </motion.div>

              <div className="space-y-2 max-w-md">
                <h2 className="text-3xl font-black text-text">ชำระเงินเรียบร้อยแล้ว</h2>
                <p className="text-text/70 text-sm">
                  ขอบคุณที่ใช้บริการค่ะ / Thank you for shopping with us!
                </p>
                <div className="font-mono tabular-nums text-xs text-brand-text-secondary pt-1">
                  หมายเลขคำสั่งซื้อ: {completedOrder.orderNumber}
                </div>
              </div>

              {completedOrder.customer && (
                <div className="p-4 rounded-lg bg-card border border-border border-crisp max-w-sm w-full flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-amber-400 font-medium">
                    <Sparkles className="h-4 w-4 text-amber-400" />
                    <span>คะแนนสะสมที่ได้รับ</span>
                  </div>
                  <span className="font-bold text-amber-400 font-mono tabular-nums text-sm">
                    +{Math.round(completedOrder.totals.grandTotal.amountInCents / 1000)} แต้ม
                  </span>
                </div>
              )}
            </div>
          ) : hasItems ? (
            /* Scanned Items Feed */
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="p-4 sm:px-6 border-b border-border border-crisp flex items-center justify-between text-xs font-bold text-text/70 uppercase tracking-wider">
                <span>รายการสินค้า (<span className="font-mono tabular-nums">{totals.totalItemsCount}</span> ชิ้น)</span>
                <span>ราคา / ยอดรวม</span>
              </div>

              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3 no-scrollbar">
                <AnimatePresence initial={false}>
                  {items.map((item) => (
                    <motion.div
                      key={item.lineId}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="p-4 rounded-lg bg-card border border-border border-crisp flex items-center justify-between gap-4 shadow-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-bold text-text truncate">
                          {item.product.name}
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-xs text-text/70">
                          <span className="font-mono tabular-nums font-medium">
                            {formatMoney(item.unitPrice)} × {item.quantity} {item.product.unitOfMeasure}
                          </span>
                          {item.discountBps > 0 && (
                            <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 font-mono tabular-nums font-bold text-[10px]">
                              ลด {item.discountBps / 100}%
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-lg font-bold font-mono tabular-nums text-text">
                          {formatMoney(item.lineTotal)}
                        </div>
                        {item.discountBps > 0 && (
                          <div className="text-xs text-brand-text-secondary line-through font-mono tabular-nums">
                            {formatMoney(createMoney(item.unitPrice.amountInCents * item.quantity))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ) : (
            /* Idle Welcome Screen */
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-6">
              <div className="w-20 h-20 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <ShoppingCart className="h-10 w-10" />
              </div>

              <div className="space-y-2 max-w-sm">
                <h3 className="text-2xl font-black text-text">ยินดีต้อนรับสู่ {storeName}</h3>
                <p className="text-text/70 text-sm">
                  กำลังเตรียมการสั่งซื้อ ยิงสแกนสินค้าเพื่อเริ่มคิดเงิน
                </p>
              </div>

              {/* Promotional Cards */}
              <div className="grid grid-cols-2 gap-3 max-w-md w-full pt-4">
                <div className="p-3.5 rounded-lg bg-card border border-border border-crisp text-left space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-400 text-xs font-bold">
                    <Coffee className="h-4 w-4" />
                    <span>Specialty Coffee</span>
                  </div>
                  <div className="text-[11px] text-text/70">คั่วสดใหม่ทุกวัน เมล็ดนำเข้าเกรดพรีเมียม</div>
                </div>

                <div className="p-3.5 rounded-lg bg-card border border-border border-crisp text-left space-y-1">
                  <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-bold">
                    <Tag className="h-4 w-4" />
                    <span>Member Rewards</span>
                  </div>
                  <div className="text-[11px] text-text/70">สะสมแต้มทุก 100 บาท แลกรับส่วนลดทันที</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Financial Summary & Dynamic Payment Screen */}
        <div className="lg:col-span-5 flex flex-col justify-between p-6 sm:p-8 bg-card border-l border-border border-crisp">
          {/* Payment Mode or Totals Breakdown */}
          {activePayment?.method === 'qr_digital' ? (
            /* PromptPay Dynamic QR Payment Screen */
            <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-400 text-xs font-bold uppercase">
                <QrCode className="h-4 w-4" />
                <span>PromptPay QR / Thai QR Payment</span>
              </div>

              <div className="text-sm text-text/70">สแกนจ่ายผ่านแอปธนาคารทุกแห่ง</div>

              {/* Simulated Authentic PromptPay QR Container */}
              <div className="p-4 bg-white rounded-lg shadow-2xl inline-block relative border-4 border-[#003B70]">
                <div className="w-56 h-56 flex flex-col items-center justify-center relative bg-white">
                  {/* PromptPay Header Monogram */}
                  <div className="text-[10px] font-black text-[#003B70] tracking-widest uppercase mb-1">
                    PROMPTPAY
                  </div>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=00020101021229370016A000000677010111011300668123456785802TH5303764540${(totals.grandTotal.amountInCents / 100).toFixed(2)}6304`}
                    alt="PromptPay QR Code"
                    className="w-44 h-44 object-contain rounded-lg"
                  />
                  <div className="text-[9px] font-bold text-text/70 mt-1">
                    บัญชี: {storeName}
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-xs text-text/70">ยอดเงินที่ต้องชำระ (Amount Due)</div>
                <div className="text-3xl font-black font-mono tabular-nums text-primary">
                  {formatMoney(totals.grandTotal)}
                </div>
              </div>
            </div>
          ) : activePayment?.method === 'cash' ? (
            /* Cash Payment Status */
            <div className="flex-1 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-16 h-16 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <Banknote className="h-8 w-8" />
              </div>
              <h4 className="text-xl font-bold text-text">ชำระด้วยเงินสด (Cash)</h4>

              <div className="w-full max-w-xs space-y-2 p-4 rounded-lg bg-card border border-border border-crisp text-sm">
                <div className="flex justify-between text-text/70">
                  <span>รับเงินสดมา</span>
                  <span className="font-mono tabular-nums text-text font-bold">
                    {activePayment.tenderedCents ? formatMoney(createMoney(activePayment.tenderedCents)) : formatMoney(totals.grandTotal)}
                  </span>
                </div>
                {activePayment.changeCents && activePayment.changeCents > 0 ? (
                  <div className="flex justify-between text-amber-400 font-bold text-base pt-2 border-t border-border">
                    <span>เงินทอน</span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(createMoney(activePayment.changeCents))}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            /* Standard Totals Calculation Display */
            <div className="space-y-4">
              <div className="text-xs font-bold text-text/70 uppercase tracking-wider">
                สรุปยอดค่าสินค้า (Order Summary)
              </div>

              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between text-text/70">
                  <span>ยอดรวมสินค้า (<span className="font-mono tabular-nums">{totals.totalItemsCount}</span> ชิ้น)</span>
                  <span className="font-mono tabular-nums text-text font-medium">{formatMoney(totals.grossSubtotal)}</span>
                </div>

                {totals.itemDiscounts.amountInCents > 0 && (
                  <div className="flex justify-between text-rose-400 font-semibold">
                    <span>ส่วนลดรายการ</span>
                    <span className="font-mono tabular-nums">-{formatMoney(totals.itemDiscounts)}</span>
                  </div>
                )}

                {totals.orderDiscount.amountInCents > 0 && (
                  <div className="flex justify-between text-rose-400 font-semibold">
                    <span>ส่วนลดท้ายบิล</span>
                    <span className="font-mono tabular-nums">-{formatMoney(totals.orderDiscount)}</span>
                  </div>
                )}

                <div className="flex justify-between text-text/70">
                  <span>ภาษีมูลค่าเพิ่ม (VAT 7% รวมแล้ว)</span>
                  <span className="font-mono tabular-nums text-text">{formatMoney(totals.totalTax)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Large Grand Total Box */}
          <div className="mt-8 pt-6 border-t border-border border-crisp space-y-2">
            <div className="flex justify-between items-baseline">
              <span className="text-base font-bold text-text uppercase tracking-wide">
                ยอดสุทธิ (Total Due)
              </span>
              <span className="text-4xl sm:text-5xl font-black font-mono tabular-nums text-primary tracking-tight">
                {formatMoney(totals.grandTotal)}
              </span>
            </div>
            <div className="text-[11px] text-brand-text-secondary text-right">
              ราคารวมภาษีมูลค่าเพิ่มแล้ว (All prices include VAT)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
