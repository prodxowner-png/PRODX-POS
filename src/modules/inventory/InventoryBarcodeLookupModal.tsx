import React, { useState } from 'react';
import { Modal } from '../../components/common/Modal';
import { Product, Category } from '../../domain/catalog';
import { formatMoney } from '../../domain/money';
import { useLanguage } from '../../context/LanguageContext';
import {
  Barcode,
  Search,
  Package,
  CheckCircle2,
  AlertTriangle,
  Radio,
  Sparkles,
  ArrowRight,
  Layers,
  Tag,
  Sliders,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '../../components/common/Button';

export interface InventoryBarcodeLookupModalProps {
  isOpen: boolean;
  onClose: () => void;
  product: Product | null;
  scannedCode: string;
  category?: Category;
  lowStockThreshold: number;
  onAdjustStock: (product: Product) => void;
  onSimulateScan: (barcode: string) => void;
  products: Product[];
}

export const InventoryBarcodeLookupModal: React.FC<InventoryBarcodeLookupModalProps> = ({
  isOpen,
  onClose,
  product,
  scannedCode,
  category,
  lowStockThreshold,
  onAdjustStock,
  onSimulateScan,
  products,
}) => {
  const { language } = useLanguage();
  const isThai = language === 'th';
  const [manualCode, setManualCode] = useState('');

  const isLowStock = product ? product.currentStock > 0 && product.currentStock <= lowStockThreshold : false;
  const isOutOfStock = product ? product.currentStock <= 0 : false;

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    onSimulateScan(manualCode.trim());
    setManualCode('');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isThai ? 'ตรวจสอบสต็อกผ่านบาร์โค้ด (Barcode Stock Lookup)' : 'Barcode Stock Level Lookup'}
      maxWidth="lg"
    >
      <div className="space-y-4">
        {/* Scanner Hardware Status Header */}
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-500/10 p-3.5 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <Radio className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                {isThai ? 'ระบบดักฟังเครื่องสแกนเนอร์ฮาร์ดแวร์ทำงาน (Hardware Wedge Active)' : 'Hardware Barcode Scanner Listener Active'}
              </div>
              <div className="text-[11px] text-text/60 font-mono tabular-nums">
                {scannedCode ? `${isThai ? 'บาร์โค้ดล่าสุด:' : 'Last Scanned:'} ${scannedCode}` : (isThai ? 'พร้อมรับสัญญาณการยิงบาร์โค้ดได้ทันที' : 'Ready to capture incoming barcode scans')}
              </div>
            </div>
          </div>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
            {isThai ? 'พร้อมยิง' : 'Ready'}
          </span>
        </div>

        {/* Scanned Product Information Card */}
        {product ? (
          <div className="rounded-2xl border border-border border-crisp bg-card p-4 space-y-4 shadow-2xs">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-md bg-muted text-[10px] font-mono tabular-nums font-bold text-text/70">
                    SKU: {product.sku}
                  </span>
                  {category && (
                    <span className="px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-bold">
                      {category.name}
                    </span>
                  )}
                </div>
                <h3 className="text-base font-bold text-text">{product.name}</h3>
                <div className="flex items-center gap-1 text-xs text-text/60 font-mono tabular-nums">
                  <Barcode className="h-3.5 w-3.5 text-brand-text-secondary" />
                  <span>{product.barcode}</span>
                </div>
              </div>

              {/* Stock Status Badge */}
              <div className="text-right">
                {isOutOfStock ? (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                    {isThai ? 'หมดสต็อก (0)' : 'Out of Stock (0)'}
                  </span>
                ) : isLowStock ? (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                    {isThai ? `สต็อกต่ำ (≤${lowStockThreshold})` : `Low Stock (≤${lowStockThreshold})`}
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    {isThai ? 'สต็อกปกติ' : 'In Stock'}
                  </span>
                )}
              </div>
            </div>

            {/* Quick Metrics Grid */}
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/50">
              <div className="p-2.5 rounded-xl bg-muted/60 text-center">
                <span className="text-[10px] text-brand-text-secondary font-bold uppercase tracking-wider block">
                  {isThai ? 'สต็อกคงเหลือ' : 'Current Stock'}
                </span>
                <span className={`text-lg font-black font-mono tabular-nums ${isOutOfStock ? 'text-rose-600' : isLowStock ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {product.currentStock} <span className="text-xs font-normal text-text/60">{product.unitOfMeasure}</span>
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-muted/60 text-center">
                <span className="text-[10px] text-brand-text-secondary font-bold uppercase tracking-wider block">
                  {isThai ? 'ราคาขายหน้าร้าน' : 'Retail Price'}
                </span>
                <span className="text-lg font-black font-mono tabular-nums text-text">
                  {formatMoney(product.price)}
                </span>
              </div>

              <div className="p-2.5 rounded-xl bg-muted/60 text-center">
                <span className="text-[10px] text-brand-text-secondary font-bold uppercase tracking-wider block">
                  {isThai ? 'ราคาทุน' : 'Cost Price'}
                </span>
                <span className="text-lg font-black font-mono tabular-nums text-text/80">
                  {formatMoney(product.costPrice)}
                </span>
              </div>
            </div>

            {/* Action Buttons for this product */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onAdjustStock(product);
                  onClose();
                }}
                leftIcon={<SlidersHorizontal className="h-4 w-4" />}
                className="w-full sm:w-auto"
              >
                {isThai ? 'ปรับปรุงยอดสต็อกสินค้านี้' : 'Adjust Stock Level'}
              </Button>
            </div>
          </div>
        ) : scannedCode ? (
          <div className="p-6 rounded-2xl border border-dashed border-amber-400 bg-amber-500/5 text-center space-y-2">
            <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto" />
            <h4 className="text-sm font-bold text-text">
              {isThai ? `ไม่พบสินค้าที่ตรงกับบาร์โค้ด "${scannedCode}"` : `No item found for barcode "${scannedCode}"`}
            </h4>
            <p className="text-xs text-text/60">
              {isThai ? 'กรุณาตรวจสอบว่าลงทะเบียนบาร์โค้ดหรือ SKU นี้ในระบบแล้วหรือไม่' : 'Please check if this barcode or SKU is properly registered in your catalog.'}
            </p>
          </div>
        ) : (
          <div className="p-6 rounded-2xl border border-dashed border-border bg-muted/30 text-center space-y-2">
            <Barcode className="h-10 w-10 text-text/30 mx-auto" />
            <h4 className="text-sm font-bold text-text">
              {isThai ? 'ยิงบาร์โค้ดด้วยเครื่องสแกนฮาร์ดแวร์เพื่อดูระดับสต็อก' : 'Scan any product barcode with hardware scanner'}
            </h4>
            <p className="text-xs text-text/60">
              {isThai ? 'ระบบจะดักจับบาร์โค้ดและดึงข้อมูลสต็อกปัจจุบัน ราคาทุน และสถานะสินค้าขึ้นมาแสดงทันที' : 'The system will instantly look up current stock quantity, cost, and reorder status.'}
            </p>
          </div>
        )}

        {/* Quick Testing / Sample Barcodes */}
        <div className="space-y-2 pt-2 border-t border-border">
          <label className="text-xs font-bold text-text/70 block">
            {isThai ? 'ทดสอบยิงบาร์โค้ดจำลอง (Sample Barcodes):' : 'Test / Simulated Barcodes:'}
          </label>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1">
            {products.slice(0, 8).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSimulateScan(p.barcode)}
                className="px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-primary/10 hover:border-primary/40 text-left transition-colors text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <Barcode className="h-3 w-3 text-primary" />
                <span className="font-medium text-text truncate max-w-[120px]">{p.name}</span>
                <span className="font-mono tabular-nums text-[10px] text-brand-text-secondary">({p.currentStock})</span>
              </button>
            ))}
          </div>

          <form onSubmit={handleManualSubmit} className="flex gap-2 pt-2">
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder={isThai ? 'หรือพิมพ์บาร์โค้ด/SKU เพื่อทดสอบ...' : 'Or enter barcode/SKU to simulate scan...'}
              className="flex-1 px-3 py-2 text-xs rounded-xl border border-border bg-background text-text focus:outline-none focus:border-primary font-mono tabular-nums"
            />
            <Button size="sm" variant="secondary" type="submit">
              {isThai ? 'ค้นหา' : 'Lookup'}
            </Button>
          </form>
        </div>
      </div>
    </Modal>
  );
};
