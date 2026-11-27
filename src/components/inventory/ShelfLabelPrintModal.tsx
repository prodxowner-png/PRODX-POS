import React, { useState } from 'react';
import { Product } from '../../domain/catalog';
import { formatMoney } from '../../domain/money';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, QrCode, CheckSquare, Square, Tag, Layers } from 'lucide-react';
import { CurrencyDisplay } from '../common/CurrencyDisplay';

interface ShelfLabelPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: readonly Product[];
  preSelectedProductIds?: readonly string[];
}

export const ShelfLabelPrintModal: React.FC<ShelfLabelPrintModalProps> = ({
  isOpen,
  onClose,
  products,
  preSelectedProductIds = [],
}) => {
  const { language } = useLanguage();
  const { session } = useAuth();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    if (preSelectedProductIds.length > 0) {
      return new Set(preSelectedProductIds);
    }
    // Default select all up to 20
    return new Set(products.slice(0, 12).map((p) => p.id));
  });

  const [labelSize, setLabelSize] = useState<'standard' | 'compact' | 'large'>('standard');
  const [includeStoreName, setIncludeStoreName] = useState(true);

  if (!isOpen) return null;

  const toggleSelectAll = () => {
    if (selectedIds.size === products.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(products.map((p) => p.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const selectedProducts = products.filter((p) => selectedIds.has(p.id));

  const handlePrint = () => {
    window.print();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={language === 'th' ? 'พิมพ์ป้ายราคา & QR Code ชั้นวางสินค้า' : 'Shelf Tags & QR Code Generator'}
      description={
        language === 'th'
          ? 'สร้างและพิมพ์ป้ายราคาพร้อม QR Code เอกลักษณ์ตาม SKU สำหรับติดหน้าชั้นวางสินค้า'
          : 'Generate and print QR code shelf tags based on product SKU for retail merchandising.'
      }
      maxWidth="2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-xs text-text/60 font-medium">
            {language === 'th' ? `เลือกแล้ว: ${selectedIds.size} รายการ` : `Selected: ${selectedIds.size} items`}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={onClose}>
              {language === 'th' ? 'ปิด' : 'Cancel'}
            </Button>
            <Button
              variant="primary"
              onClick={handlePrint}
              disabled={selectedIds.size === 0}
              leftIcon={<Printer className="h-4 w-4" />}
            >
              {language === 'th' ? 'พิมพ์ป้ายสินค้า' : 'Print Shelf Tags'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Controls Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-2xl bg-background/50 dark:bg-white/5 border border-border border-crisp">
          <div>
            <label className="block text-xs font-bold text-text/80 mb-1.5">
              {language === 'th' ? 'ขนาดป้ายราคา (Label Size)' : 'Label Template Size'}
            </label>
            <select
              value={labelSize}
              onChange={(e) => setLabelSize(e.target.value as any)}
              className="w-full h-9 px-3 rounded-xl border border-border border-crisp bg-card text-xs font-semibold text-text focus:outline-none"
            >
              <option value="standard">{language === 'th' ? 'มาตรฐาน (Standard 80x50mm)' : 'Standard (80x50mm)'}</option>
              <option value="compact">{language === 'th' ? 'ขนาดเล็ก (Compact Shelf Tag)' : 'Compact Shelf Tag'}</option>
              <option value="large">{language === 'th' ? 'ขนาดใหญ่ (Promo Card)' : 'Large Promo Tag'}</option>
            </select>
          </div>

          <div className="flex flex-col justify-between">
            <label className="block text-xs font-bold text-text/80 mb-1.5">
              {language === 'th' ? 'การตั้งค่าการแสดงผล' : 'Display Options'}
            </label>
            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={includeStoreName}
                onChange={(e) => setIncludeStoreName(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary h-4 w-4"
              />
              <span className="text-xs text-text/80 font-medium">
                {language === 'th' ? 'แสดงชื่อร้านค้า/สาขาบนป้าย' : 'Include Store & Branch Header'}
              </span>
            </label>
          </div>
        </div>

        {/* Item Selection Header */}
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wider text-text/60">
            {language === 'th' ? 'เลือกสินค้าสำหรับพิมพ์ป้าย' : 'Select Products to Tag'}
          </div>
          <button
            type="button"
            onClick={toggleSelectAll}
            className="text-xs font-semibold text-primary dark:text-orange-400 hover:underline cursor-pointer flex items-center gap-1"
          >
            {selectedIds.size === products.length ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            <span>{selectedIds.size === products.length ? (language === 'th' ? 'ยกเลิกเลือกทั้งหมด' : 'Deselect All') : (language === 'th' ? 'เลือกทั้งหมด' : 'Select All')}</span>
          </button>
        </div>

        {/* Product Selection List (Compact checkboxes) */}
        <div className="max-h-48 overflow-y-auto rounded-xl border border-border border-crisp divide-y divide-zinc-100 dark:divide-white/5">
          {products.map((p) => {
            const isSelected = selectedIds.has(p.id);
            return (
              <div
                key={p.id}
                onClick={() => toggleSelect(p.id)}
                className={`px-4 py-2.5 flex items-center justify-between text-xs cursor-pointer transition-colors ${
                  isSelected ? 'bg-primary/5 dark:bg-primary/10' : 'hover:bg-background/50 dark:hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`text-primary dark:text-orange-400 shrink-0`}>
                    {isSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-brand-text-secondary" />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-bold text-text truncate">{p.name}</div>
                    <div className="text-[11px] font-mono tabular-nums text-text/60">SKU: {p.sku}</div>
                  </div>
                </div>
                <div className="font-mono tabular-nums font-bold text-text shrink-0">
                  <CurrencyDisplay money={p.price} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Printable Preview Area */}
        <div>
          <div className="text-xs font-bold uppercase tracking-wider text-text/60 mb-2">
            {language === 'th' ? `ตัวอย่างป้ายที่จะพิมพ์ (${selectedProducts.length} ป้าย)` : `Print Preview (${selectedProducts.length} tags)`}
          </div>

          <div className="p-4 rounded-2xl bg-background dark:bg-black/40 border border-border border-crisp max-h-96 overflow-y-auto">
            {selectedProducts.length === 0 ? (
              <div className="py-12 text-center text-xs text-brand-text-secondary">
                {language === 'th' ? 'กรุณาเลือกสินค้าอย่างน้อย 1 รายการเพื่อดูตัวอย่างป้าย' : 'Select at least one product to preview shelf tags.'}
              </div>
            ) : (
              <div id="printable-shelf-tags" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {selectedProducts.map((p) => (
                  <div
                    key={p.id}
                    className={`bg-white text-zinc-900 rounded-xl border-2 border-border p-4 shadow-sm flex flex-col justify-between relative overflow-hidden ${
                      labelSize === 'compact' ? 'max-w-xs' : labelSize === 'large' ? 'min-h-[220px]' : 'min-h-[180px]'
                    }`}
                  >
                    {/* Header: Store & Category */}
                    {includeStoreName && (
                      <div className="flex items-center justify-between border-b border-border pb-1.5 mb-2 text-[10px] font-bold text-text/70 uppercase tracking-wide">
                        <span>{session?.currentStore.name || 'PRODX POS'}</span>
                        <span className="bg-background px-1.5 py-0.5 rounded text-[9px] font-mono tabular-nums">{p.sku}</span>
                      </div>
                    )}

                    {/* Main Content: QR Code & Product Info */}
                    <div className="flex items-center gap-3 my-1">
                      <div className="bg-white p-1 rounded border border-border shrink-0">
                        <QRCodeSVG
                          value={`PRODX-SKU:${p.sku}|ID:${p.id}|NAME:${encodeURIComponent(p.name)}|PRICE:${formatMoney(p.price)}`}
                          size={labelSize === 'compact' ? 56 : labelSize === 'large' ? 80 : 64}
                          level="M"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="font-extrabold text-xs sm:text-sm text-zinc-900 leading-tight line-clamp-2">
                          {p.name}
                        </h4>
                        <div className="text-[10px] text-text/60 mt-0.5 capitalize">
                          {p.unitOfMeasure || 'Unit'}
                        </div>
                      </div>
                    </div>

                    {/* Footer: Price & Barcode representation */}
                    <div className="flex items-end justify-between pt-2 border-t border-dashed border-border mt-2">
                      <div className="font-mono tabular-nums text-[9px] text-brand-text-secondary tracking-widest">
                        ||| | | |||| || |||
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] text-brand-text-secondary uppercase font-bold">Price / ราคา</div>
                        <div className="text-base sm:text-lg font-black font-mono tabular-nums text-primary">
                          <CurrencyDisplay money={p.price} />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};
