import React, { useState, useEffect, useMemo } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Product } from '../../domain/catalog';
import {
  AlertTriangle,
  SlidersHorizontal,
  RotateCcw,
  Check,
  Package,
  Eye,
  EyeOff,
  Boxes,
} from 'lucide-react';

interface LowStockThresholdModalProps {
  isOpen: boolean;
  onClose: () => void;
  threshold: number;
  onSaveThreshold: (val: number) => void;
  isHighlightActive: boolean;
  onToggleHighlight: () => void;
  products: readonly Product[];
  language?: string;
  onOpenRestockReport?: () => void;
}

const PRESET_THRESHOLDS = [5, 10, 15, 20, 25, 30, 50];

export const LowStockThresholdModal: React.FC<LowStockThresholdModalProps> = ({
  isOpen,
  onClose,
  threshold,
  onSaveThreshold,
  isHighlightActive,
  onToggleHighlight,
  products,
  language = 'th',
  onOpenRestockReport,
}) => {
  const [tempThreshold, setTempThreshold] = useState<number>(threshold);

  // Sync when modal opens
  useEffect(() => {
    if (isOpen) {
      setTempThreshold(threshold);
    }
  }, [isOpen, threshold]);

  // Real-time calculation of impacted items
  const { lowStockItems, inStockCount, outOfStockCount } = useMemo(() => {
    const low: Product[] = [];
    let inCount = 0;
    let outCount = 0;

    for (const p of products) {
      if (p.currentStock <= 0) {
        outCount++;
      } else if (p.currentStock <= tempThreshold) {
        low.push(p);
      } else {
        inCount++;
      }
    }

    return {
      lowStockItems: low,
      inStockCount: inCount,
      outOfStockCount: outCount,
    };
  }, [products, tempThreshold]);

  const handleApply = () => {
    onSaveThreshold(tempThreshold);
    onClose();
  };

  const handleResetDefault = () => {
    setTempThreshold(15);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={language === 'th' ? 'ตั้งค่าเกณฑ์แจ้งเตือนสต็อกต่ำ (Low Stock Alert)' : 'Configure Low Stock Alert Threshold'}
      description={
        language === 'th'
          ? 'กำหนดจำนวนสินค้าคงเหลือขั้นต่ำเพื่อเปิดสัญญาณเตือนสต็อกต่ำและไฮไลต์ด้วยสีส้มเด่นชัด'
          : 'Define inventory replenishment threshold to flag items with warning badges and prominent color indicators.'
      }
      maxWidth="lg"
      footer={
        <div className="flex items-center justify-between w-full gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={handleResetDefault}
            className="text-xs flex items-center gap-1.5 text-text/70 hover:text-text cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{language === 'th' ? 'รีเซ็ตเป็น 15 ชิ้น' : 'Reset to Default (15)'}</span>
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              className="text-xs cursor-pointer"
            >
              {language === 'th' ? 'ยกเลิก' : 'Cancel'}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleApply}
              className="text-xs font-bold bg-cta hover:bg-cta-hover text-cta-text border-cta/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta cursor-pointer shadow-xs flex items-center gap-1.5"
            >
              <Check className="h-4 w-4" />
              <span>{language === 'th' ? 'บันทึกและใช้งาน' : 'Apply Threshold'}</span>
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5 text-left">
        {/* Active Threshold Control */}
        <div className="p-4 rounded-2xl bg-muted/40 border border-border border-crisp space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5 text-amber-500" />
              <span>{language === 'th' ? 'เกณฑ์แจ้งเตือนสต็อก (Alert Threshold)' : 'Alert Threshold Quantity'}</span>
            </label>
            <span className="font-mono tabular-nums text-xl font-black text-amber-500">
              ≤ {tempThreshold} {language === 'th' ? 'ชิ้น' : 'units'}
            </span>
          </div>

          {/* Stepper + Quick Increment */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTempThreshold((prev) => Math.max(0, prev - 5))}
              className="px-3 py-2 rounded-xl bg-card border border-border border-crisp hover:bg-muted text-xs font-bold text-text cursor-pointer transition-all active:scale-95"
            >
              -5
            </button>
            <button
              type="button"
              onClick={() => setTempThreshold((prev) => Math.max(0, prev - 1))}
              className="px-3 py-2 rounded-xl bg-card border border-border border-crisp hover:bg-muted text-xs font-bold text-text cursor-pointer transition-all active:scale-95"
            >
              -1
            </button>

            <div className="flex-1 relative">
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="5000"
                value={tempThreshold}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setTempThreshold(isNaN(val) ? 0 : Math.max(0, val));
                }}
                className="w-full text-center font-mono tabular-nums font-black text-lg text-primary bg-card border border-border border-crisp rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-brand-text-secondary pointer-events-none">
                {language === 'th' ? 'ชิ้น' : 'units'}
              </span>
            </div>

            <button
              type="button"
              onClick={() => setTempThreshold((prev) => prev + 1)}
              className="px-3 py-2 rounded-xl bg-card border border-border border-crisp hover:bg-muted text-xs font-bold text-text cursor-pointer transition-all active:scale-95"
            >
              +1
            </button>
            <button
              type="button"
              onClick={() => setTempThreshold((prev) => prev + 5)}
              className="px-3 py-2 rounded-xl bg-card border border-border border-crisp hover:bg-muted text-xs font-bold text-text cursor-pointer transition-all active:scale-95"
            >
              +5
            </button>
          </div>

          {/* Quick Presets */}
          <div>
            <div className="text-[11px] font-semibold text-text/60 mb-2">
              {language === 'th' ? 'ค่าลัดที่นิยมใช้:' : 'Quick Presets:'}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {PRESET_THRESHOLDS.map((preset) => {
                const isSelected = tempThreshold === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setTempThreshold(preset)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-warning-subtle text-warning-text border border-warning/30 shadow-xs'
                        : 'bg-card border border-border border-crisp text-text/70 hover:text-text hover:border-amber-400'
                    }`}
                  >
                    {preset} {language === 'th' ? 'ชิ้น' : 'units'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Range Slider */}
          <div className="pt-2">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.min(100, tempThreshold)}
              onChange={(e) => setTempThreshold(parseInt(e.target.value, 10))}
              className="w-full accent-amber-500 cursor-pointer h-2 bg-muted rounded-lg"
            />
            <div className="flex justify-between text-[10px] text-brand-text-secondary font-mono tabular-nums mt-1">
              <span>0</span>
              <span>25</span>
              <span>50</span>
              <span>75</span>
              <span>100+</span>
            </div>
          </div>
        </div>

        {/* Highlighting Toggle Control */}
        <div className="p-4 rounded-2xl bg-card border border-border border-crisp flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl shrink-0 ${isHighlightActive ? 'bg-amber-500/10 text-amber-500' : 'bg-muted text-brand-text-secondary'}`}>
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-text">
                {language === 'th' ? 'เปิดการไฮไลต์และป้ายเตือนสีส้ม' : 'Visual Warning Badges & Color Indicators'}
              </div>
              <p className="text-[11px] text-text/60 mt-0.5">
                {language === 'th'
                  ? 'แสดงกรอบสีส้มเด่นชัดและป้ายเตือนสต็อกต่ำบนการ์ดสินค้าและตาราง'
                  : 'Highlight low-stock items with high-contrast amber borders, glow, and warning badges.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleHighlight}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 shrink-0 ${
              isHighlightActive
                ? 'bg-cta hover:bg-cta-hover text-cta-text border-cta/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta shadow-2xs'
                : 'bg-muted border-border border-crisp text-text/70 hover:text-text'
            }`}
          >
            {isHighlightActive ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            <span>{isHighlightActive ? (language === 'th' ? 'เปิดอยู่ (ON)' : 'Enabled (ON)') : (language === 'th' ? 'ปิดอยู่ (OFF)' : 'Disabled (OFF)')}</span>
          </button>
        </div>

        {/* Live Impact Preview */}
        <div className="p-4 rounded-2xl bg-amber-50/60 dark:bg-amber-950/25 border border-amber-300 dark:border-amber-800/60 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 font-bold text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
              <span>
                {language === 'th'
                  ? `ผลกระทบ: จะมีสินค้าแตะเกณฑ์เตือน ${lowStockItems.length} รายการ`
                  : `Impact Preview: ${lowStockItems.length} items flagged as Low Stock`}
              </span>
            </div>
            <Badge variant={lowStockItems.length > 0 ? 'warning' : 'success'} size="sm">
              {lowStockItems.length > 0
                ? `${lowStockItems.length} ${language === 'th' ? 'รายการเตือน' : 'Alerted'}`
                : language === 'th' ? 'สต็อกพร้อมขายทั้งหมด' : 'All Healthy'}
            </Badge>
          </div>

          {/* Quick breakdown metrics */}
          <div className="grid grid-cols-3 gap-2 pt-1 text-center font-mono tabular-nums">
            <div className="p-2 rounded-xl bg-card border border-border border-crisp">
              <div className="text-[10px] text-text/60 font-sans">{language === 'th' ? 'พร้อมขาย (>เกณฑ์)' : 'In Stock'}</div>
              <div className="text-base font-black text-emerald-600 dark:text-emerald-400 mt-0.5">{inStockCount}</div>
            </div>
            <div className="p-2 rounded-xl bg-amber-100/80 dark:bg-amber-900/40 border border-amber-300 dark:border-amber-700/60">
              <div className="text-[10px] text-amber-800 dark:text-amber-300 font-sans font-bold">{language === 'th' ? 'สต็อกต่ำ (≤เกณฑ์)' : 'Low Stock'}</div>
              <div className="text-base font-black text-amber-600 dark:text-amber-400 mt-0.5">{lowStockItems.length}</div>
            </div>
            <div className="p-2 rounded-xl bg-card border border-border border-crisp">
              <div className="text-[10px] text-text/60 font-sans">{language === 'th' ? 'หมดสต็อก (0)' : 'Out of Stock'}</div>
              <div className="text-base font-black text-rose-500 mt-0.5">{outOfStockCount}</div>
            </div>
          </div>

          {/* Sample Flagged Products Preview */}
          {lowStockItems.length > 0 && (
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-bold text-amber-900 dark:text-amber-200">
                  {language === 'th' ? 'ตัวอย่างสินค้าที่จะติดป้ายเตือนสต็อกต่ำ:' : 'Flagged items sample:'}
                </div>
                {onOpenRestockReport && (
                  <button
                    type="button"
                    onClick={() => {
                      onSaveThreshold(tempThreshold);
                      onClose();
                      onOpenRestockReport();
                    }}
                    className="text-[11px] font-bold text-amber-700 dark:text-amber-300 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <span>{language === 'th' ? 'ดูรายงานต้องสั่งเติมทั้งหมด →' : 'View Full Restock Report →'}</span>
                  </button>
                )}
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                {lowStockItems.slice(0, 5).map((p) => (
                  <div
                    key={p.id}
                    className="p-2 rounded-xl bg-card border border-amber-200 dark:border-amber-900/50 flex items-center justify-between text-xs"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-bold text-text truncate">{p.name}</div>
                      <div className="text-[10px] font-mono tabular-nums text-brand-text-secondary">{p.sku}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono tabular-nums font-black text-amber-600 dark:text-amber-400">
                        {p.currentStock} {p.unitOfMeasure}
                      </span>
                      <div className="text-[9.5px] text-amber-800 dark:text-amber-300 font-bold">
                        ≤ {tempThreshold}
                      </div>
                    </div>
                  </div>
                ))}
                {lowStockItems.length > 5 && (
                  <div className="text-[10.5px] text-center text-brand-text-secondary font-medium pt-1">
                    {language === 'th'
                      ? `และอีก ${lowStockItems.length - 5} รายการ...`
                      : `and ${lowStockItems.length - 5} more items...`}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
