import React, { useState, useEffect } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { useSound } from '../../context/SoundContext';
import { triggerHaptic } from '../../services/hapticService';
import { Money, createMoney, formatMoney } from '../../domain/money';
import { Coins, Banknote, RotateCcw, Trash2, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';

interface QuickCashCalculatorProps {
  totalDueCents: number;
  currency: string;
  tenderedCents: number;
  onTenderedChange: (amountCents: number) => void;
}

interface Denomination {
  value: number; // in cents
  label: string;
  type: 'bill' | 'coin';
  colorClass: string;
  darkColorClass: string;
}

export const QuickCashCalculator: React.FC<QuickCashCalculatorProps> = ({
  totalDueCents,
  currency,
  tenderedCents,
  onTenderedChange,
}) => {
  const { language } = useLanguage();
  const { playClick } = useSound();
  const [isExpanded, setIsExpanded] = useState(true);
  const [accumulatedBills, setAccumulatedBills] = useState<{ [cents: number]: number }>({});

  const isTHB = currency.toUpperCase() === 'THB';
  const getSymbol = (curr: string) => {
    switch (curr.toUpperCase()) {
      case 'THB': return '฿';
      case 'USD': return '$';
      case 'AUD': return 'A$';
      case 'EUR': return '€';
      case 'GBP': return '£';
      case 'JPY': return '¥';
      default: return curr.toUpperCase() + ' ';
    }
  };
  const sym = getSymbol(currency);

  // Define denominations based on currency
  const denominations: Denomination[] = isTHB
    ? [
        { value: 100000, label: '฿1,000', type: 'bill', colorClass: 'bg-background border-border text-text', darkColorClass: 'dark:bg-background/40 dark:border-border dark:text-text/60' },
        { value: 50000, label: '฿500', type: 'bill', colorClass: 'bg-purple-50 border-purple-200 text-purple-700', darkColorClass: 'dark:bg-purple-950/20 dark:border-purple-900/40 dark:text-purple-300' },
        { value: 10000, label: '฿100', type: 'bill', colorClass: 'bg-rose-50 border-rose-200 text-rose-700', darkColorClass: 'dark:bg-rose-950/20 dark:border-rose-900/40 dark:text-rose-300' },
        { value: 5000, label: '฿50', type: 'bill', colorClass: 'bg-emerald-50 border-emerald-200 text-emerald-700', darkColorClass: 'dark:bg-emerald-950/20 dark:border-emerald-900/40 dark:text-emerald-300' },
        { value: 2000, label: '฿20', type: 'bill', colorClass: 'bg-green-50 border-green-200 text-green-700', darkColorClass: 'dark:bg-green-950/20 dark:border-green-900/40 dark:text-green-300' },
        { value: 1000, label: '฿10', type: 'coin', colorClass: 'bg-amber-50 border-amber-200 text-amber-700', darkColorClass: 'dark:bg-amber-950/20 dark:border-amber-900/40 dark:text-amber-300' },
        { value: 500, label: '฿5', type: 'coin', colorClass: 'bg-background border-border text-text/70', darkColorClass: 'dark:bg-background dark:border-border dark:text-text/50' },
        { value: 100, label: '฿1', type: 'coin', colorClass: 'bg-background border-border text-text/70', darkColorClass: 'dark:bg-background dark:border-border dark:text-text/50' },
      ]
    : [
        { value: 10000, label: `${sym}100`, type: 'bill', colorClass: 'bg-teal-50 border-teal-200 text-teal-700', darkColorClass: 'dark:bg-teal-950/20 dark:border-teal-900/40 dark:text-teal-300' },
        { value: 5000, label: `${sym}50`, type: 'bill', colorClass: 'bg-background border-border text-text', darkColorClass: 'dark:bg-background/40 dark:border-border dark:text-text/60' },
        { value: 2000, label: `${sym}20`, type: 'bill', colorClass: 'bg-green-50 border-green-200 text-green-700', darkColorClass: 'dark:bg-green-950/20 dark:border-green-900/40 dark:text-green-300' },
        { value: 1000, label: `${sym}10`, type: 'bill', colorClass: 'bg-amber-50 border-amber-200 text-amber-700', darkColorClass: 'dark:bg-amber-950/20 dark:border-amber-900/40 dark:text-amber-300' },
        { value: 500, label: `${sym}5`, type: 'bill', colorClass: 'bg-purple-50 border-purple-200 text-purple-700', darkColorClass: 'dark:bg-purple-950/20 dark:border-purple-900/40 dark:text-purple-300' },
        { value: 100, label: `${sym}1`, type: 'bill', colorClass: 'bg-background border-border text-text/70', darkColorClass: 'dark:bg-background dark:border-border dark:text-text/50' },
        { value: 25, label: '25¢', type: 'coin', colorClass: 'bg-background border-border text-text/70', darkColorClass: 'dark:bg-background dark:border-border dark:text-text/50' },
        { value: 10, label: '10¢', type: 'coin', colorClass: 'bg-background border-border text-text/70', darkColorClass: 'dark:bg-background dark:border-border dark:text-text/50' },
      ];

  // Set default initial accumulated map based on tendered amount
  useEffect(() => {
    if (tenderedCents === totalDueCents) {
      setAccumulatedBills({});
    }
  }, [totalDueCents]);

  const handleAddDenomination = (denom: Denomination) => {
    triggerHaptic('numpad');
    playClick();
    
    const currentCount = accumulatedBills[denom.value] || 0;
    const nextMap = { ...accumulatedBills, [denom.value]: currentCount + 1 };
    
    // Calculate new total
    const newTotal = Object.entries(nextMap).reduce(
      (sum, [val, count]) => sum + parseInt(val) * count,
      0
    );
    
    setAccumulatedBills(nextMap);
    onTenderedChange(newTotal);
  };

  const handleClearAccumulated = () => {
    triggerHaptic('tap');
    playClick();
    setAccumulatedBills({});
    onTenderedChange(totalDueCents);
  };

  const handleSetExact = () => {
    triggerHaptic('medium');
    playClick();
    setAccumulatedBills({});
    onTenderedChange(totalDueCents);
  };

  // Pre-calculated change-given suggestions
  const calculateChangeShortcuts = () => {
    if (totalDueCents <= 0) return [];
    
    const baseVal = Math.ceil(totalDueCents / 100) * 100;
    const shortcuts = new Set<number>();
    
    // Exact change
    shortcuts.add(totalDueCents);
    
    // Round major currency units
    shortcuts.add(baseVal);
    
    if (isTHB) {
      // 20, 50, 100, 500, 1000 bills
      [2000, 5000, 10000, 50000, 100000].forEach(preset => {
        if (preset >= totalDueCents) shortcuts.add(preset);
      });
    } else {
      // 1, 5, 10, 20, 50, 100 bills
      [100, 500, 1000, 2000, 5000, 10000].forEach(preset => {
        if (preset >= totalDueCents) shortcuts.add(preset);
      });
    }

    return Array.from(shortcuts)
      .sort((a, b) => a - b)
      .slice(0, 5); // Limit to 5 suggestions
  };

  const changeCents = tenderedCents - totalDueCents;

  // Change breakdown recommendation algorithm
  const getChangeBreakdown = (): { denomination: Denomination; count: number }[] => {
    if (changeCents <= 0) return [];
    let remaining = changeCents;
    const breakdown: { denomination: Denomination; count: number }[] = [];

    // Sort denominations descending to run greedy subtraction
    const sortedDenoms = [...denominations].sort((a, b) => b.value - a.value);

    for (const denom of sortedDenoms) {
      if (remaining >= denom.value) {
        const count = Math.floor(remaining / denom.value);
        breakdown.push({ denomination: denom, count });
        remaining %= denom.value;
      }
    }

    return breakdown;
  };

  const changeBreakdown = getChangeBreakdown();

  return (
    <div className="rounded-lg border-crisp border border-border bg-card overflow-hidden shadow-2xs">
      {/* Header */}
      <button
        type="button"
        aria-expanded={isExpanded}
        aria-controls="quick-cash-calculator-panel"
        onClick={() => {
          playClick();
          setIsExpanded(!isExpanded);
        }}
        className="w-full min-h-[44px] flex items-center justify-between px-3.5 py-2.5 bg-card border-b border-border border-crisp text-xs font-bold text-text cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta active-scale"
      >
        <span className="flex items-center gap-1.5">
          <Banknote className="h-4 w-4 text-brand-text-accent" />
          <span>
            {language === 'th' ? 'เครื่องคำนวณเงินทอนด่วน (Quick Cash)' : 'Quick Cash Calculator'}
          </span>
        </span>
        <div className="flex items-center gap-2">
          {Object.keys(accumulatedBills).length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-primary text-[10px] text-primary-foreground font-bold uppercase shadow-2xs tabular-nums">
              {language === 'th' ? 'มีเงินสะสม' : 'Stacked'}
            </span>
          )}
          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </button>

      {/* Expanded panel */}
      {isExpanded && (
        <div id="quick-cash-calculator-panel" className="p-3.5 space-y-3.5">
          {/* Quick Total Bills Input Tray */}
          <div>
            <div className="text-[10px] font-bold text-brand-text-secondary uppercase tracking-wider mb-2 flex justify-between items-center">
              <span>{language === 'th' ? 'รับเงินสดมา (แตะเพื่อเพิ่มจำนวน)' : 'Cash Received Tray (Tap to accumulate)'}</span>
              {Object.keys(accumulatedBills).length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAccumulated}
                  className="text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 transition-colors flex items-center gap-1 normal-case cursor-pointer font-bold text-[10px] active-scale"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>{language === 'th' ? 'ล้างถาด' : 'Reset tray'}</span>
                </button>
              )}
            </div>

            {/* Bills & Coins Grid */}
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {denominations.map((denom) => {
                const count = accumulatedBills[denom.value] || 0;
                return (
                  <button
                    key={denom.value}
                    type="button"
                    onClick={() => handleAddDenomination(denom)}
                    className={`relative min-h-[48px] p-2 theme-btn-radius active-scale border-crisp border flex flex-col items-center justify-center transition-all cursor-pointer select-none shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta ${denom.colorClass} ${denom.darkColorClass} ${
                      count > 0 ? 'ring-2 ring-primary border-primary font-bold' : 'hover:scale-[0.98]'
                    }`}
                  >
                    <span className="text-xs font-mono font-bold tabular-nums">{denom.label}</span>
                    <span className="text-[10px] text-brand-text-secondary mt-0.5 font-sans font-medium">
                      {denom.type === 'bill' ? (language === 'th' ? 'ธนบัตร' : 'Bill') : (language === 'th' ? 'เหรียญ' : 'Coin')}
                    </span>
                    {count > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground font-mono tabular-nums text-[10px] font-bold h-4.5 min-w-[18px] px-1 rounded-full flex items-center justify-center border border-border shadow-2xs">
                        x{count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quick Preset Buttons */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-bold text-brand-text-secondary uppercase tracking-wider">
              {language === 'th' ? 'ทางลัดจำนวนเงินที่จ่ายบ่อย' : 'Fast Pay Shortcuts'}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSetExact}
                className="min-h-[44px] px-3 py-1.5 text-xs theme-btn-radius active-scale border-crisp border border-border text-text hover:bg-background transition font-bold tabular-nums cursor-pointer bg-card shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
              >
                {language === 'th' ? 'พอดีเป๊ะ' : 'Exact'} (<span className="font-mono tabular-nums">{formatMoney(createMoney(totalDueCents, currency))}</span>)
              </button>
              {calculateChangeShortcuts().map((cents) => {
                if (cents === totalDueCents) return null; // exact handled above
                return (
                  <button
                    key={cents}
                    type="button"
                    onClick={() => {
                      playClick();
                      setAccumulatedBills({});
                      onTenderedChange(cents);
                    }}
                    className={`min-h-[44px] px-3 py-1.5 text-xs theme-btn-radius active-scale border-crisp border font-mono font-bold tabular-nums transition cursor-pointer shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta ${
                      tenderedCents === cents
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-border bg-card text-text hover:bg-background'
                    }`}
                  >
                    {formatMoney(createMoney(cents, currency))}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Change Recommendation */}
          {changeCents > 0 && (
            <div className="p-3 rounded-lg border-crisp border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-1.5 shadow-2xs">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <span>{language === 'th' ? 'คำแนะนำการทอนเงิน (Change Breakdown)' : 'Recommended Change Mix'}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {changeBreakdown.map(({ denomination, count }) => (
                  <div
                    key={denomination.value}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border-crisp border border-emerald-200 dark:border-emerald-800 bg-card text-xs font-bold text-emerald-800 dark:text-emerald-300 shadow-2xs"
                  >
                    <span className="font-mono">{denomination.label}</span>
                    <span className="text-emerald-500 font-sans font-medium">×</span>
                    <span className="font-mono bg-emerald-600 text-white rounded px-1 min-w-[16px] text-center">
                      {count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
