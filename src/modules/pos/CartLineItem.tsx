import React, { useState } from 'react';
import { CartLineItem as CartLineItemType } from '../../domain/order';
import { formatMoney, createMoney } from '../../domain/money';
import { useLanguage } from '../../context/LanguageContext';
import { triggerHaptic } from '../../services/hapticService';
import { Minus, Plus, Trash2, Tag, ChevronDown, Edit2, Sparkles, RotateCcw, Percent, Barcode, Zap } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { VirtualNumpad } from '../../components/common/VirtualNumpad';
import { useCart } from '../../context/CartContext';

export interface CartLineItemProps {
  item: CartLineItemType;
  onUpdateQuantity: (lineId: string, delta: number) => void;
  onRequestDiscount: () => void;
  onRemove: (lineId: string) => void;
  isRecentlyScanned?: boolean;
}

export const CartLineItem = React.memo<CartLineItemProps>(({
  item,
  onUpdateQuantity,
  onRequestDiscount,
  onRemove,
  isRecentlyScanned: isRecentlyScannedProp,
}) => {
  const { t, language } = useLanguage();
  const { setItemQuantity, setItemPrice, lastScannedLineId } = useCart();
  const isRecentlyScanned = isRecentlyScannedProp ?? (lastScannedLineId === item.lineId);
  const [numpadMode, setNumpadMode] = useState<'quantity' | 'price' | null>(null);

  // Detect price changes from catalog price and item-level discounts
  const catalogPriceCents = item.product.price.amountInCents;
  const currentPriceCents = item.unitPrice.amountInCents;
  const hasPriceChange = currentPriceCents !== catalogPriceCents;
  const priceDiffCents = currentPriceCents - catalogPriceCents;
  const hasDiscount = item.discountBps > 0;
  const hasPriceOrDiscountApplied = hasPriceChange || hasDiscount;

  // Swipe-to-delete touch gesture state
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [touchStartX, setTouchStartX] = useState(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
    setIsSwiping(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - touchStartX;
    if (diff < 0) {
      setOffsetX(Math.max(-110, diff));
    } else {
      setOffsetX(0);
    }
  };

  const handleTouchEnd = () => {
    setIsSwiping(false);
    if (offsetX < -70) {
      triggerHaptic('medium');
      onRemove(item.lineId);
    } else {
      setOffsetX(0);
    }
  };

  const handleNumpadConfirm = (value: string) => {
    const numValue = parseFloat(value) || 0;
    if (numpadMode === 'quantity') {
      setItemQuantity(item.lineId, Math.floor(numValue));
    } else if (numpadMode === 'price') {
      setItemPrice(item.lineId, createMoney(Math.floor(numValue * 100), item.unitPrice.currency));
    }
    setNumpadMode(null);
  };

  return (
    <div className="relative overflow-hidden rounded-xl">
      {/* Swipe Delete Action Reveal Background */}
      <div className="absolute inset-y-0 right-0 w-28 bg-rose-600 rounded-xl flex items-center justify-end pr-4 text-white font-bold text-xs gap-1.5 z-0 shadow-inner">
        <Trash2 className="h-4 w-4" />
        <span>{language === 'th' ? 'ลบรายการ' : 'Delete'}</span>
      </div>

      {/* Main Draggable / Swipable Item Card with Theme Primary Highlighting & Scan Flash */}
      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => {
          // If not swiping and offset is negligible, open the context-aware discount modal
          if (!isSwiping && Math.abs(offsetX) < 5) {
            onRequestDiscount();
          }
        }}
        title={language === 'th' ? 'แตะที่รายการเพื่อจัดการส่วนลด' : 'Click line item to apply discounts'}
        style={{ transform: `translateX(${offsetX}px)` }}
        className={`relative z-10 p-3 sm:p-3.5 rounded-xl border-crisp transition-all duration-200 ease-out select-none space-y-3 cursor-pointer group hover:border-primary/50 hover:shadow-xs ${
          isRecentlyScanned
            ? 'animate-scan-flash border-emerald-500/90 dark:border-emerald-400 ring-2 ring-emerald-500/60 dark:ring-emerald-400/70 bg-card shadow-md'
            : hasPriceOrDiscountApplied
            ? 'border-primary/50 dark:border-primary/45 bg-card ring-1 ring-primary/30 dark:ring-primary/25 shadow-xs'
            : 'border border-border bg-card shadow-2xs'
        }`}
      >
        {/* Left Vertical Indicator Strip */}
        {isRecentlyScanned ? (
          <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-emerald-500 rounded-l-xl animate-pulse" />
        ) : hasPriceOrDiscountApplied ? (
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary rounded-l-xl" />
        ) : null}

        {/* Soft Theme Primary or Emerald Scan Flash Wash Background Tint */}
        {isRecentlyScanned ? (
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 via-emerald-500/10 to-transparent rounded-xl pointer-events-none" />
        ) : hasPriceOrDiscountApplied ? (
          <div className="absolute inset-0 bg-primary/[0.03] rounded-xl pointer-events-none" />
        ) : null}

        {/* Top Info Header */}
        <div className="relative flex items-start justify-between gap-2 pl-0.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-xs font-bold text-text leading-tight line-clamp-2 group-hover:text-primary transition-colors ${isRecentlyScanned ? 'drop-shadow-[0_0_8px_rgba(16,185,129,0.3)]' : ''}`}>
                {item.product.name}
              </span>

              {/* Just Scanned Flash Pill Badge */}
              {isRecentlyScanned && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-black tracking-tight bg-emerald-500 text-white shadow-xs animate-bounce-short"
                  title={language === 'th' ? 'เพิ่มรายการจากการสแกนบาร์โค้ด' : 'Added via Barcode Scanner'}
                >
                  <Barcode className="h-3 w-3 animate-pulse" />
                  <span>{language === 'th' ? 'สแกนสำเร็จ +1' : 'Scanned +1'}</span>
                </span>
              )}

              {/* Visual Indicator Badges using Theme's Primary Color */}
              {hasDiscount && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold tracking-tight bg-primary text-white shadow-2xs"
                  title={`${language === 'th' ? 'ส่วนลดรายการ' : 'Line Discount'}: ${item.discountBps / 100}%`}
                >
                  <Tag className="h-2.5 w-2.5" />
                  <span>-{item.discountBps / 100}% {language === 'th' ? 'ลด' : 'OFF'}</span>
                </span>
              )}

              {hasPriceChange && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold tracking-tight bg-primary/15 text-primary border border-primary/30"
                  title={`${language === 'th' ? 'ราคาแคตตาล็อก' : 'Catalog Price'}: ${formatMoney(item.product.price)}`}
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  <span>
                    {priceDiffCents < 0
                      ? (language === 'th' ? 'ปรับลดราคา' : 'Price Reduced')
                      : (language === 'th' ? 'ปรับราคาพิเศษ' : 'Custom Price')}
                  </span>
                </span>
              )}
            </div>

            {/* Unit Price Row & Edit Trigger */}
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setNumpadMode('price');
                }}
                className={`text-[11px] font-mono flex items-center gap-1 transition-colors cursor-pointer rounded px-1 -ml-1 py-0.5 ${
                  hasPriceChange
                    ? 'text-primary font-bold bg-primary/10 hover:bg-primary/20'
                    : 'text-text/70 hover:text-primary'
                }`}
                title={language === 'th' ? 'แตะเพื่อแก้ไขราคาต่อชิ้น' : 'Click to override unit price'}
              >
                {hasPriceChange && (
                  <span className="line-through text-text/40 text-[10px] mr-0.5">
                    {formatMoney(item.product.price)}
                  </span>
                )}
                <span className={hasPriceChange ? 'text-primary font-bold' : ''}>
                  {formatMoney(item.unitPrice)}
                </span>
                <span className="text-[10px] font-sans text-text/60">
                  {language === 'th' ? '/ ชิ้น' : 'each'}
                </span>
                <Edit2 className="h-2.5 w-2.5 opacity-60 ml-0.5" />
              </button>

              {/* Instant Reset Button if Price Was Modified */}
              {hasPriceChange && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setItemPrice(item.lineId, item.product.price);
                  }}
                  className="text-[10px] text-text/50 hover:text-primary flex items-center gap-0.5 cursor-pointer underline hover:no-underline"
                  title={language === 'th' ? 'คืนค่าราคามาตรฐานเดิม' : 'Reset to catalog price'}
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                  <span>{language === 'th' ? 'คืนราคาเดิม' : 'Reset'}</span>
                </button>
              )}
            </div>
          </div>

          {/* Line Total Calculation */}
          <div className="text-right shrink-0">
            <div
              className={`text-xs font-mono font-bold ${
                hasPriceOrDiscountApplied ? 'text-primary font-extrabold' : 'text-text'
              }`}
            >
              {formatMoney(item.lineTotal)}
            </div>
            {hasPriceOrDiscountApplied && (
              <div className="flex items-center justify-end gap-1 text-[10px] font-mono">
                <span className="line-through text-text/40">
                  {formatMoney(createMoney(catalogPriceCents * item.quantity, item.product.price.currency))}
                </span>
                {hasDiscount && (
                  <span className="text-primary font-bold">
                    -{item.discountBps / 100}%
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Controls & Quantity adjustment */}
        <div className="relative flex items-center justify-between pt-2.5 border-t border-border border-crisp pl-0.5">
          {/* Discount Toggle Button with Theme Primary Indicator */}
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic('tap');
                onRequestDiscount();
              }}
              className={`min-h-[40px] flex items-center gap-1.5 text-xs px-3 py-1.5 theme-btn-radius active-scale border-crisp border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                item.discountBps > 0
                  ? 'border-primary bg-primary text-white font-bold shadow-xs'
                  : 'border-border bg-transparent text-text/70 hover:text-text hover:border-primary/50'
              }`}
            >
              <Tag className="h-3.5 w-3.5" />
              <span>
                {item.discountBps > 0 ? (
                  <span className="font-mono">-{item.discountBps / 100}%</span>
                ) : (
                  t.pos.discount
                )}
              </span>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Quantity Controls and Trash */}
          <div className="flex items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic('tap');
                onUpdateQuantity(item.lineId, -1);
              }}
              className="min-h-[44px] min-w-[44px] h-11 w-11 theme-btn-radius active-scale border-crisp border border-border bg-card text-text flex items-center justify-center hover:bg-background cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Decrease quantity"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic('tap');
                setNumpadMode('quantity');
              }}
              className="min-h-[44px] min-w-[36px] h-11 px-2 flex items-center justify-center font-mono text-sm font-bold text-text hover:bg-background theme-btn-radius active-scale transition-colors cursor-pointer"
            >
              {item.quantity}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic('tap');
                onUpdateQuantity(item.lineId, 1);
              }}
              className="min-h-[44px] min-w-[44px] h-11 w-11 theme-btn-radius active-scale border-crisp border border-border bg-card text-text flex items-center justify-center hover:bg-background cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="Increase quantity"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerHaptic('medium');
                onRemove(item.lineId);
              }}
              className="min-h-[44px] min-w-[44px] h-11 w-11 ml-0.5 theme-btn-radius border border-transparent text-text/50 hover:border-rose-200 dark:hover:border-rose-900 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 flex items-center justify-center cursor-pointer transition-colors active-scale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              aria-label="Remove item from cart"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Quantity or Price Override Modal */}
        <Modal
          isOpen={numpadMode !== null}
          onClose={() => setNumpadMode(null)}
          title={
            numpadMode === 'price'
              ? language === 'th'
                ? 'แก้ไขราคาต่อชิ้น'
                : 'Override Unit Price'
              : language === 'th'
              ? 'แก้ไขจำนวน'
              : 'Enter Quantity'
          }
        >
          <div className="p-4 sm:p-6 flex flex-col items-center">
            <div className="w-full max-w-sm space-y-3">
              {numpadMode === 'price' && (
                <>
                  <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-between text-xs text-primary font-medium">
                    <span>{language === 'th' ? 'ราคามาตรฐานในระบบ:' : 'Standard Catalog Price:'}</span>
                    <span className="font-mono font-bold">{formatMoney(item.product.price)}</span>
                  </div>
                  <VirtualNumpad
                    allowDecimal
                    initialValue={(item.unitPrice.amountInCents / 100).toString()}
                    onConfirm={handleNumpadConfirm}
                    onCancel={() => setNumpadMode(null)}
                  />
                  {hasPriceChange && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs font-bold border-border hover:border-primary/50 text-text/70 hover:text-primary theme-btn-radius active-scale"
                      onClick={() => {
                        setItemPrice(item.lineId, item.product.price);
                        setNumpadMode(null);
                      }}
                      leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                    >
                      {language === 'th' ? 'คืนค่าราคามาตรฐานเดิม' : 'Restore Default Catalog Price'}
                    </Button>
                  )}
                </>
              )}
              {numpadMode === 'quantity' && (
                <VirtualNumpad
                  allowDecimal={false}
                  initialValue={item.quantity.toString()}
                  onConfirm={handleNumpadConfirm}
                  onCancel={() => setNumpadMode(null)}
                />
              )}
            </div>
          </div>
        </Modal>
      </div>
    </div>
  );
});
