import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { useLanguage } from '../../context/LanguageContext';
import { formatMoney, createMoney } from '../../domain/money';
import { CartLineItem } from '../../domain/order';
import {
  Percent,
  Banknote,
  Tag,
  Sparkles,
  RotateCcw,
  X,
  Check,
  Package,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { playScannerSound } from '../../services/soundService';

export interface DiscountModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: 'cart' | 'item';
  targetName: string;
  currentDiscountBps: number;
  basePriceCents: number;
  currency: string;
  item?: CartLineItem;
  cartItemCount?: number;
  onApply: (bps: number, applyToAll?: boolean) => void;
}

export const DiscountModal: React.FC<DiscountModalProps> = ({
  isOpen,
  onClose,
  targetType,
  targetName,
  currentDiscountBps,
  basePriceCents,
  currency,
  item,
  cartItemCount,
  onApply,
}) => {
  const { language } = useLanguage();
  const [mode, setMode] = useState<'percentage' | 'fixed'>('percentage');
  const [percentageInput, setPercentageInput] = useState<string>('');
  const [fixedInput, setFixedInput] = useState<string>('');
  const [applyToAll, setApplyToAll] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Quick select percentage presets - explicitly includes 5%, 10%, 20%
  const percentagePresets = [5, 10, 15, 20, 25, 50];

  // Initialize input state when modal opens
  useEffect(() => {
    if (isOpen) {
      setApplyToAll(false);
      if (currentDiscountBps > 0) {
        // Pre-fill with existing discount values
        const pct = currentDiscountBps / 100;
        setPercentageInput(pct % 1 === 0 ? pct.toString() : pct.toFixed(2));
        const fixed = (basePriceCents * (currentDiscountBps / 10000)) / 100;
        setFixedInput(fixed % 1 === 0 ? fixed.toString() : fixed.toFixed(2));
      } else {
        setPercentageInput('');
        setFixedInput('');
      }
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [isOpen, currentDiscountBps, basePriceCents]);

  // Context-aware absolute currency presets based on line item total
  const absolutePresets = useMemo(() => {
    const baseAmount = basePriceCents / 100;
    if (baseAmount <= 0) return [];

    // Contextual percentage-derived amounts (5%, 10%, 20%)
    const pct5 = Math.round(baseAmount * 0.05 * 100) / 100;
    const pct10 = Math.round(baseAmount * 0.10 * 100) / 100;
    const pct20 = Math.round(baseAmount * 0.20 * 100) / 100;

    const list: { label: string; value: number; tag?: string }[] = [];

    // Add percentage equivalent presets
    if (pct5 > 0 && pct5 < baseAmount) {
      list.push({ label: `${pct5}`, value: pct5, tag: '5%' });
    }
    if (pct10 > 0 && pct10 < baseAmount) {
      list.push({ label: `${pct10}`, value: pct10, tag: '10%' });
    }
    if (pct20 > 0 && pct20 < baseAmount) {
      list.push({ label: `${pct20}`, value: pct20, tag: '20%' });
    }

    // Common standard round denominations
    const roundValues = currency === 'THB'
      ? [10, 20, 50, 100, 200, 500]
      : [1, 2, 5, 10, 20, 50];

    for (const val of roundValues) {
      if (val < baseAmount && !list.some((item) => item.value === val)) {
        list.push({ label: `${val}`, value: val });
      }
    }

    return list.slice(0, 6);
  }, [basePriceCents, currency]);

  // Calculate live preview values
  const { previewAmountCents, previewPct, finalPriceCents } = useMemo(() => {
    let discountCents = 0;
    let pct = 0;

    if (mode === 'percentage') {
      const parsedPct = parseFloat(percentageInput) || 0;
      pct = Math.min(Math.max(parsedPct, 0), 100);
      discountCents = Math.round((basePriceCents * pct) / 100);
    } else {
      const fixedVal = parseFloat(fixedInput) || 0;
      discountCents = Math.min(Math.round(Math.max(fixedVal, 0) * 100), basePriceCents);
      pct = basePriceCents > 0 ? (discountCents / basePriceCents) * 100 : 0;
    }

    const finalCents = Math.max(0, basePriceCents - discountCents);
    return {
      previewAmountCents: discountCents,
      previewPct: pct,
      finalPriceCents: finalCents,
    };
  }, [mode, percentageInput, fixedInput, basePriceCents]);

  // Apply discount to the line item
  const handleApply = () => {
    let bpsToApply = 0;

    if (mode === 'percentage') {
      const pct = parseFloat(percentageInput);
      if (!isNaN(pct) && pct > 0 && pct <= 100) {
        bpsToApply = Math.round(pct * 100);
      }
    } else {
      const fixedValue = parseFloat(fixedInput);
      if (!isNaN(fixedValue) && fixedValue > 0 && basePriceCents > 0) {
        const fixedCents = Math.round(fixedValue * 100);
        const bps = (fixedCents / basePriceCents) * 10000;
        bpsToApply = Math.min(Math.round(bps), 10000);
      }
    }

    playScannerSound('click');
    onApply(bpsToApply, applyToAll);
    onClose();
  };

  // Remove existing discount
  const handleClear = () => {
    playScannerSound('click');
    onApply(0, applyToAll);
    onClose();
  };

  // Handle preset clicks
  const selectPercentagePreset = (pct: number) => {
    playScannerSound('click');
    setPercentageInput(pct.toString());
    // Also sync the fixed amount representation
    const fixed = (basePriceCents * (pct / 100)) / 100;
    setFixedInput(fixed % 1 === 0 ? fixed.toString() : fixed.toFixed(2));
    inputRef.current?.focus();
  };

  const selectAbsolutePreset = (val: number) => {
    playScannerSound('click');
    setFixedInput(val.toString());
    // Also sync the percentage representation
    if (basePriceCents > 0) {
      const pct = (val / (basePriceCents / 100)) * 100;
      setPercentageInput(pct % 1 === 0 ? pct.toString() : pct.toFixed(1));
    }
    inputRef.current?.focus();
  };

  // Currency symbol
  const currencySymbol = currency === 'THB' ? '฿' : '$';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        language === 'th'
          ? targetType === 'item'
            ? 'กำหนดส่วนลดรายการสินค้า'
            : 'กำหนดส่วนลดท้ายบิล'
          : targetType === 'item'
          ? 'Apply Line Item Discount'
          : 'Apply Ticket Discount'
      }
      description={
        language === 'th'
          ? 'เลือกส่วนลดแบบเปอร์เซ็นต์หรือยอดเงินคงที่ พร้อมปุ่มเลือกด่วน'
          : 'Choose percentage or fixed amount discount with quick presets'
      }
      maxWidth="md"
      footer={
        <div className="flex items-center gap-2.5 w-full">
          {currentDiscountBps > 0 && (
            <Button
              id="btn-discount-remove"
              variant="outline"
              className="text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/60 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-xs font-bold shrink-0 theme-btn-radius active-scale"
              onClick={handleClear}
              leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            >
              {language === 'th'
                ? applyToAll
                  ? 'ล้างทุกรายการ'
                  : 'ล้างส่วนลด'
                : applyToAll
                ? 'Remove All'
                : 'Remove Discount'}
            </Button>
          )}
          <Button
            id="btn-discount-cancel"
            variant="ghost"
            className="flex-1 text-text/70 hover:text-text text-xs font-bold theme-btn-radius"
            onClick={onClose}
          >
            {language === 'th' ? 'ยกเลิก' : 'Cancel'}
          </Button>
          <Button
            id="btn-discount-apply"
            variant="primary"
            className="flex-1 text-xs font-bold theme-btn-radius shadow-sm active-scale"
            onClick={handleApply}
            leftIcon={<Check className="h-4 w-4" />}
          >
            {language === 'th'
              ? applyToAll
                ? `ใช้กับทุกรายการ${cartItemCount ? ` (${cartItemCount})` : ''}`
                : 'ใช้ส่วนลด'
              : applyToAll
              ? `Apply to All${cartItemCount ? ` (${cartItemCount})` : ''}`
              : 'Apply Discount'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* ========================================================================= */}
        {/* CONTEXT HEADER: Displays Item Details, Quantity, Catalog & Unit Price     */}
        {/* ========================================================================= */}
        <div className="p-3 sm:p-3.5 rounded-xl border border-border bg-card shadow-2xs space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0 flex-1">
              {item?.product.imageUrl ? (
                <img
                  src={item.product.imageUrl}
                  alt={item.product.name}
                  className="h-11 w-11 rounded-lg object-cover border border-border shrink-0"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-11 w-11 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0">
                  {targetType === 'item' ? (
                    <Package className="h-5 w-5" />
                  ) : (
                    <Tag className="h-5 w-5" />
                  )}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-xs sm:text-sm font-bold text-text leading-tight truncate">
                    {targetName}
                  </span>
                  {item?.product.categoryId && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-background border border-border text-text/60">
                      {item.product.categoryId}
                    </span>
                  )}
                  {item && item.discountBps > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary text-primary-foreground">
                      -{item.discountBps / 100}% {language === 'th' ? 'เดิม' : 'Current'}
                    </span>
                  )}
                </div>

                {/* SKU & Price Subtitle */}
                <div className="flex items-center gap-2 mt-1 text-xs text-text/70 flex-wrap font-mono">
                  {item && (
                    <>
                      <span className="inline-flex items-center gap-1 font-bold text-text">
                        <Layers className="h-3 w-3 text-primary" />
                        {item.quantity} {item.product.unitOfMeasure || (language === 'th' ? 'ชิ้น' : 'pcs')}
                      </span>
                      <span>×</span>
                      <span className="font-semibold text-text">
                        {formatMoney(item.unitPrice)}
                      </span>
                      {item.unitPrice.amountInCents !== item.product.price.amountInCents && (
                        <span className="line-through text-text/40 text-[10px]">
                          ({formatMoney(item.product.price)})
                        </span>
                      )}
                    </>
                  )}
                  {targetType === 'cart' && (
                    <span>
                      {language === 'th' ? 'ยอดรวมก่อนส่วนลดท้ายบิล' : 'Eligible Cart Subtotal'}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Base Subtotal */}
            <div className="text-right shrink-0">
              <span className="text-[10px] uppercase font-bold text-brand-text-secondary block">
                {language === 'th' ? 'ยอดก่อนลด' : 'Base Total'}
              </span>
              <span className="text-xs sm:text-sm font-mono font-bold tabular-nums text-text">
                {formatMoney(createMoney(basePriceCents, currency))}
              </span>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* MODE SWITCHER: Percentage vs Absolute Currency Amount                     */}
        {/* ========================================================================= */}
        <div
          role="tablist"
          aria-label={language === 'th' ? 'รูปแบบส่วนลด' : 'Discount calculation mode'}
          className="flex bg-card p-1 rounded-xl border border-border shadow-2xs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'percentage'}
            onClick={() => {
              setMode('percentage');
              inputRef.current?.focus();
            }}
            className={`flex-1 min-h-[44px] flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer theme-btn-radius active-scale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta ${
              mode === 'percentage'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-text/70 hover:text-text hover:bg-background/50'
            }`}
          >
            <Percent className="h-4 w-4" />
            <span>{language === 'th' ? 'ส่วนลดเปอร์เซ็นต์ (%)' : 'Percentage (%)'}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'fixed'}
            onClick={() => {
              setMode('fixed');
              inputRef.current?.focus();
            }}
            className={`flex-1 min-h-[44px] flex items-center justify-center gap-2 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer theme-btn-radius active-scale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta ${
              mode === 'fixed'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-text/70 hover:text-text hover:bg-background/50'
            }`}
          >
            <Banknote className="h-4 w-4" />
            <span>
              {language === 'th'
                ? `จำนวนเงินคงที่ (${currencySymbol})`
                : `Fixed Amount (${currencySymbol})`}
            </span>
          </button>
        </div>

        {/* ========================================================================= */}
        {/* DISCOUNT INPUT & QUICK PRESET BUTTONS                                     */}
        {/* ========================================================================= */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-text/70">
            <label htmlFor="discount-value-input" className="cursor-pointer">
              {mode === 'percentage'
                ? language === 'th'
                  ? 'ระบุเปอร์เซ็นต์ส่วนลด (0 - 100%)'
                  : 'Enter discount percentage (0 - 100%)'
                : language === 'th'
                ? `ระบุจำนวนเงินที่ต้องการลด (${currencySymbol})`
                : `Enter discount amount (${currencySymbol})`}
            </label>
            {previewPct > 0 && (
              <span className="font-mono tabular-nums text-primary font-bold">
                {mode === 'percentage'
                  ? `≈ ${formatMoney(createMoney(previewAmountCents, currency))}`
                  : `≈ ${previewPct.toFixed(1)}%`}
              </span>
            )}
          </div>

          <div className="relative">
            {mode === 'fixed' && (
              <div className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono font-bold text-brand-text-secondary text-sm">
                {currencySymbol}
              </div>
            )}
            <input
              id="discount-value-input"
              ref={inputRef}
              type="number"
              inputMode="decimal"
              min="0"
              max={mode === 'percentage' ? '100' : (basePriceCents / 100).toString()}
              step="any"
              value={mode === 'percentage' ? percentageInput : fixedInput}
              onChange={(e) => {
                if (mode === 'percentage') setPercentageInput(e.target.value);
                else setFixedInput(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleApply();
              }}
              className={`w-full min-h-[46px] text-base font-mono font-bold tabular-nums bg-card border border-border rounded-xl px-3.5 py-2 text-text focus:outline-none focus:ring-2 focus:ring-primary shadow-2xs transition-colors ${
                mode === 'fixed' ? 'pl-9 pr-10' : 'pr-12 pl-3.5'
              }`}
              placeholder="0"
            />
            {mode === 'percentage' && (
              <div className="absolute right-10 top-1/2 -translate-y-1/2 font-bold text-brand-text-secondary text-sm">
                %
              </div>
            )}
            {(percentageInput || fixedInput) && (
              <button
                type="button"
                onClick={() => {
                  setPercentageInput('');
                  setFixedInput('');
                  inputRef.current?.focus();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md hover:bg-background text-brand-text-secondary hover:text-text flex items-center justify-center transition-colors cursor-pointer"
                title="Clear input"
                aria-label={language === 'th' ? 'ล้างค่าส่วนลด' : 'Clear discount input'}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Quick-Select Presets: 5%, 10%, 15%, 20%, 25%, 50% */}
          {mode === 'percentage' && (
            <div className="space-y-1 pt-1">
              <span className="text-[11px] font-semibold text-brand-text-secondary">
                {language === 'th' ? 'ปุ่มเลือกด่วน (Quick Presets):' : 'Quick Presets:'}
              </span>
              <div className="grid grid-cols-6 gap-1.5">
                {percentagePresets.map((pct) => {
                  const isActive = parseFloat(percentageInput) === pct;
                  return (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => selectPercentagePreset(pct)}
                      className={`min-h-[44px] py-1.5 px-1 rounded-lg border text-xs font-mono font-bold tabular-nums transition-all cursor-pointer shadow-2xs active-scale theme-btn-radius flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta ${
                        isActive
                          ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                          : 'bg-card border-border hover:border-primary/50 text-text hover:bg-background'
                      }`}
                    >
                      {pct}%
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick-Select Presets for Absolute Amount Mode */}
          {mode === 'fixed' && (
            <div className="space-y-1 pt-1">
              <span className="text-[11px] font-semibold text-brand-text-secondary">
                {language === 'th' ? 'ยอดส่วนลดแนะนำ (Quick Presets):' : 'Suggested Amount Presets:'}
              </span>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {absolutePresets.map((preset) => {
                  const isActive = parseFloat(fixedInput) === preset.value;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => selectAbsolutePreset(preset.value)}
                      className={`min-h-[44px] py-1.5 px-1 rounded-lg border text-xs font-mono font-bold tabular-nums transition-all cursor-pointer shadow-2xs active-scale theme-btn-radius flex flex-col items-center justify-center leading-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta ${
                        isActive
                          ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                          : 'bg-card border-border hover:border-primary/50 text-text hover:bg-background'
                      }`}
                    >
                      <span>
                        {currencySymbol}{preset.label}
                      </span>
                      {preset.tag && (
                        <span className={`text-[10px] ${isActive ? 'text-primary-foreground/85' : 'text-primary'}`}>
                          ({preset.tag})
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* APPLY TO ALL ITEMS IN CART TOGGLE / CHECKBOX                              */}
        {/* ========================================================================= */}
        {targetType === 'item' && (
          <div
            id="apply-to-all-container"
            onClick={() => {
              playScannerSound('click');
              setApplyToAll((prev) => !prev);
            }}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                playScannerSound('click');
                setApplyToAll((prev) => !prev);
              }
            }}
            role="switch"
            aria-checked={applyToAll}
            tabIndex={0}
            className={`p-3 rounded-xl border transition-all cursor-pointer select-none flex items-center justify-between gap-3 shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              applyToAll
                ? 'bg-primary/10 border-primary/50 dark:border-primary/40 ring-1 ring-primary/30'
                : 'bg-card border-border hover:border-text/30 hover:bg-background/60'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {/* Toggle Switch Pill */}
              <div
                className={`w-10 h-6 rounded-full p-0.5 transition-colors duration-200 ease-in-out shrink-0 relative flex items-center ${
                  applyToAll ? 'bg-primary' : 'bg-border'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white shadow-xs transform transition-transform duration-200 ease-in-out flex items-center justify-center ${
                    applyToAll ? 'translate-x-4' : 'translate-x-0'
                  }`}
                >
                  {applyToAll && <Check className="h-3 w-3 text-primary stroke-[3]" />}
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-text leading-tight">
                    {language === 'th' ? 'ใช้กับทุกรายการในตะกร้า' : 'Apply to all items in cart'}
                  </span>
                  {cartItemCount !== undefined && cartItemCount > 0 && (
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${
                        applyToAll
                          ? 'bg-primary text-primary-foreground shadow-2xs'
                          : 'bg-background border border-border text-text/60'
                      }`}
                    >
                      {cartItemCount} {language === 'th' ? 'รายการ' : 'items'}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-text/60 leading-tight mt-0.5">
                  {language === 'th'
                    ? applyToAll
                      ? mode === 'percentage'
                        ? `จะปรับส่วนลด ${percentageInput || 0}% ให้กับสินค้าทั้ง ${cartItemCount || 'ทุก'} รายการในตะกร้าพร้อมกัน`
                        : `จะนำอัตราส่วนลด ${previewPct.toFixed(1)}% ไปใช้กับสินค้าทั้ง ${cartItemCount || 'ทุก'} รายการในตะกร้า`
                      : 'เปิดตัวเลือกนี้เพื่อปรับใช้ส่วนลดเดียวกันนี้กับทุกรายการสินค้าในคำสั่งซื้อ'
                    : applyToAll
                    ? mode === 'percentage'
                      ? `Will apply ${percentageInput || 0}% discount to all ${cartItemCount || ''} items in the cart`
                      : `Will apply this ${previewPct.toFixed(1)}% discount rate to all ${cartItemCount || ''} items in the cart`
                    : 'Toggle to apply this same discount to all items currently in the cart'}
                </p>
              </div>
            </div>

            {/* Checkbox badge on the right */}
            <div
              className={`h-5 px-2 rounded-md text-[10px] font-bold flex items-center gap-1 shrink-0 transition-colors ${
                applyToAll
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'bg-background border border-border text-text/40'
              }`}
            >
              {applyToAll ? (
                <>
                  <Check className="h-3 w-3 stroke-[3]" />
                  <span>{language === 'th' ? 'เปิดอยู่' : 'ON'}</span>
                </>
              ) : (
                <span>{language === 'th' ? 'ปิดอยู่' : 'OFF'}</span>
              )}
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* LIVE PREVIEW & FINANCIAL COMPARISON CARD                                  */}
        {/* ========================================================================= */}
        <div className="p-3.5 rounded-xl bg-card border border-border shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between text-xs text-text/70">
            <span>{language === 'th' ? 'ราคารวมเดิม' : 'Original Subtotal'}</span>
            <span className="font-mono font-medium">
              {formatMoney(createMoney(basePriceCents, currency))}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs text-primary font-bold">
            <span className="flex items-center gap-1">
              <Tag className="h-3 w-3" />
              <span>{language === 'th' ? 'ส่วนลดที่จะได้รับ' : 'Discount Applied'}</span>
              {previewPct > 0 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-primary/10 border border-primary/20">
                  -{previewPct.toFixed(1)}%
                </span>
              )}
            </span>
            <span className="font-mono">
              -{formatMoney(createMoney(previewAmountCents, currency))}
            </span>
          </div>

          {/* Unit price impact preview if item has quantity > 1 */}
          {item && item.quantity > 1 && previewAmountCents > 0 && (
            <div className="flex items-center justify-between text-[11px] text-text/60 border-t border-border/40 pt-1.5 font-mono">
              <span>{language === 'th' ? 'ราคาเฉลี่ยต่อชิ้นหลังลด' : 'Effective Unit Price'}</span>
              <div className="flex items-center gap-1.5">
                <span className="line-through text-text/40">{formatMoney(item.unitPrice)}</span>
                <ArrowRight className="h-2.5 w-2.5 text-text/40" />
                <span className="text-primary font-bold">
                  {formatMoney(createMoney(Math.round(finalPriceCents / item.quantity), currency))} / {language === 'th' ? 'ชิ้น' : 'pc'}
                </span>
              </div>
            </div>
          )}

          <div className="pt-2 border-t border-border flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-text block">
                {language === 'th' ? 'ราคาสุทธิหลังหักส่วนลด' : 'Final Price After Discount'}
              </span>
              {previewAmountCents > 0 && (
                <span className="text-[10px] text-primary font-bold flex items-center gap-1 mt-0.5">
                  <Sparkles className="h-2.5 w-2.5" />
                  <span>
                    {language === 'th'
                      ? `ประหยัด ${formatMoney(createMoney(previewAmountCents, currency))}`
                      : `Save ${formatMoney(createMoney(previewAmountCents, currency))}`}
                  </span>
                </span>
              )}
            </div>
            <span className="text-base sm:text-lg font-mono font-black text-text">
              {formatMoney(createMoney(finalPriceCents, currency))}
            </span>
          </div>

          {applyToAll && cartItemCount !== undefined && cartItemCount > 1 && (
            <div className="pt-2 border-t border-border/50 flex items-center justify-between text-[11px] text-primary font-bold">
              <span className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                <span>
                  {language === 'th'
                    ? `มีผลกับสินค้าทั้งหมด ${cartItemCount} รายการในตะกร้า`
                    : `Will apply to all ${cartItemCount} items in cart`}
                </span>
              </span>
              <span className="font-mono text-[10px] bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                {previewPct.toFixed(1)}% / {language === 'th' ? 'รายการ' : 'item'}
              </span>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

