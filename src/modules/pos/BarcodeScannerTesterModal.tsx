import React, { useState } from 'react';
import { Modal } from '../../components/common/Modal';
import { Product } from '../../domain/catalog';
import { formatMoney } from '../../domain/money';
import { useLanguage } from '../../context/LanguageContext';
import {
  Barcode,
  Zap,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Keyboard,
  Radio,
  ArrowRight,
} from 'lucide-react';

export interface BarcodeScannerTesterModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  onSimulateScan: (barcode: string) => void;
  lastScannedBarcode: string | null;
  lastScannedAt: Date | null;
  scanCount: number;
}

export const BarcodeScannerTesterModal: React.FC<BarcodeScannerTesterModalProps> = ({
  isOpen,
  onClose,
  products,
  onSimulateScan,
  lastScannedBarcode,
  lastScannedAt,
  scanCount,
}) => {
  const { language } = useLanguage();
  const [manualCode, setManualCode] = useState('');

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
      title={language === 'th' ? 'เครื่องสแกนบาร์โค้ดฮาร์ดแวร์ & ตัวจำลอง' : 'Hardware Barcode Scanner & Simulator'}
      description={language === 'th' ? 'ทดสอบการตรวจจับฮาร์ดแวร์สแกนเนอร์ USB/Bluetooth และจำลองการยิงบาร์โค้ด' : 'Test USB/Bluetooth hardware scanner listener and simulate scan triggers.'}
      maxWidth="lg"
    >
      <div className="space-y-4">
        {/* Hardware Status Banner */}
        <div className="rounded-lg border-crisp border border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-500/10 p-3.5 flex items-start gap-3 shadow-2xs">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <Radio className="h-4 w-4 animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-xs font-semibold text-text">
                {language === 'th' ? 'ระบบดักจับฮาร์ดแวร์สแกนเนอร์ทำงานอยู่ (HID Wedge)' : 'Hardware Scanner Active (HID Wedge Listener)'}
              </h4>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                LIVE
              </span>
            </div>
            <p className="mt-1 text-xs text-text/70 leading-relaxed">
              {language === 'th'
                ? 'คุณสามารถใช้เครื่องสแกนบาร์โค้ด USB หรือ Bluetooth ยิงบาร์โค้ดได้ทันทีจากทุกตำแหน่งในหน้าจอ ระบบจะค้นหาสินค้าและเพิ่มลงตะกร้าอัตโนมัติพร้อมเสียงบี๊บแจ้งเตือน'
                : 'Plug in any standard USB or Bluetooth barcode scanner. Point and scan barcode labels anywhere on the POS screen to automatically look up products and add to cart with instant audio feedback.'}
            </p>
          </div>
        </div>

        {/* Scan Status Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-lg border-crisp border border-border bg-card p-3 shadow-2xs">
            <span className="text-[10px] font-semibold uppercase text-text/50 tracking-wider">
              {language === 'th' ? 'จำนวนครั้งที่สแกน' : 'Total Scans'}
            </span>
            <div className="mt-1 text-base font-bold font-mono text-text">
              {scanCount} {language === 'th' ? 'ครั้ง' : 'scans'}
            </div>
          </div>

          <div className="rounded-lg border-crisp border border-border bg-card p-3 shadow-2xs">
            <span className="text-[10px] font-semibold uppercase text-text/50 tracking-wider">
              {language === 'th' ? 'บาร์โค้ดล่าสุด' : 'Last Barcode'}
            </span>
            <div className="mt-1 text-sm font-semibold font-mono text-primary truncate">
              {lastScannedBarcode || (language === 'th' ? 'ยังไม่มีการสแกน' : 'None yet')}
            </div>
          </div>

          <div className="rounded-lg border-crisp border border-border bg-card p-3 shadow-2xs">
            <span className="text-[10px] font-semibold uppercase text-text/50 tracking-wider">
              {language === 'th' ? 'เวลาที่สแกนล่าสุด' : 'Last Scan Time'}
            </span>
            <div className="mt-1 text-xs font-medium text-text/70">
              {lastScannedAt
                ? lastScannedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : '—'}
            </div>
          </div>
        </div>

        {/* Test Manual Trigger Input */}
        <div>
          <label htmlFor="manual-barcode-input" className="block text-xs font-semibold text-text/70 mb-1.5 cursor-pointer">
            {language === 'th' ? 'ทดสอบยิงบาร์โค้ดด้วยตนเอง' : 'Manual Scan Simulator'}
          </label>
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <div className="relative flex-1">
              <input
                id="manual-barcode-input"
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder={language === 'th' ? 'กรอกบาร์โค้ด เช่น 890123450001' : 'e.g. 890123450001 or BEV-ESP-01'}
                className="w-full min-h-[44px] rounded-lg border-crisp border border-border bg-card text-base sm:text-xs font-mono pl-9 pr-3 text-text placeholder-text/40 focus:outline-none focus:ring-2 focus:ring-primary shadow-2xs"
              />
              <Barcode className="h-4 w-4 text-text/50 absolute left-3 top-1/2 -translate-y-1/2" />
            </div>
            <button
              type="submit"
              disabled={!manualCode.trim()}
              className="min-h-[44px] px-4 rounded-lg bg-primary hover:opacity-90 active:scale-[0.98] text-primary-foreground text-xs font-semibold transition-all disabled:opacity-40 cursor-pointer flex items-center gap-1.5 shrink-0 shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
            >
              <Zap className="h-3.5 w-3.5" />
              <span>{language === 'th' ? 'จำลองการสแกน' : 'Simulate Scan'}</span>
            </button>
          </form>
        </div>

        {/* Quick 1-Click Catalog Barcode & SKU Presets */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-text/70">
              {language === 'th' ? 'คลิกจำลองการสแกนด้วย Barcode หรือ SKU' : '1-Click Catalog Barcode & SKU Test Presets'}
            </span>
            <span className="text-[11px] text-text/50">
              <span className="font-mono">{products.length}</span> {language === 'th' ? 'รายการ' : 'items'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
            {products.map((p) => {
              const isOutOfStock = p.currentStock <= 0;
              return (
                <div
                  key={p.id}
                  className="p-2.5 rounded-lg border-crisp border border-border bg-card hover:border-primary hover:bg-primary/5 transition-all text-left shadow-2xs group"
                >
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-text truncate group-hover:text-primary">
                        {p.name}
                      </div>
                      <div className="text-[10px] text-text/60 mt-0.5 font-mono">
                        {formatMoney(p.price)}
                      </div>
                    </div>
                    {isOutOfStock ? (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 shrink-0">
                        {language === 'th' ? 'หมด' : 'Out'}
                      </span>
                    ) : (
                      <span className="text-[9px] font-mono font-medium px-1.5 py-0.5 rounded-full bg-border text-text/70 shrink-0">
                        {p.currentStock}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border/50">
                    <button
                      type="button"
                      onClick={() => onSimulateScan(p.barcode)}
                      className="flex-1 py-1 px-2 rounded bg-background hover:bg-primary/10 hover:text-primary border border-border/60 text-[10px] font-mono font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                      title={language === 'th' ? 'สแกนด้วยบาร์โค้ด' : 'Scan via Barcode'}
                    >
                      <Barcode className="h-3 w-3" />
                      <span className="truncate">{p.barcode}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onSimulateScan(p.sku)}
                      className="py-1 px-2 rounded bg-background hover:bg-primary/10 hover:text-primary border border-border/60 text-[10px] font-mono font-semibold flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                      title={language === 'th' ? 'สแกนด้วย SKU' : 'Scan via SKU'}
                    >
                      <Zap className="h-3 w-3 text-amber-500" />
                      <span>{p.sku}</span>
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Invalid SKU/Barcode Test Case */}
            <button
              type="button"
              onClick={() => onSimulateScan('999999999999')}
              className="p-2.5 rounded-lg border-crisp border border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10 transition-all text-left cursor-pointer group shadow-2xs flex items-center justify-between col-span-1 sm:col-span-2"
            >
              <div>
                <div className="text-xs font-semibold text-rose-700 dark:text-rose-400">
                  {language === 'th' ? 'ทดสอบ: บาร์โค้ดหรือ SKU ที่ไม่มีในระบบ' : 'Test: Unregistered Barcode / Invalid SKU'}
                </div>
                <div className="font-mono text-[10px] text-rose-500/80 mt-0.5">
                  SKU-UNKNOWN-999 (999999999999)
                </div>
              </div>
              <AlertCircle className="h-4 w-4 text-rose-500 shrink-0" />
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
