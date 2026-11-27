import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { Product } from '../../domain/catalog';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { Badge } from '../../components/common/Badge';
import { playScannerSound } from '../../services/soundService';
import { triggerHaptic } from '../../services/hapticService';
import {
  ArrowRightLeft,
  Building2,
  Plus,
  Send,
  CheckCircle2,
  XCircle,
  Clock,
  PackageCheck,
  Search,
  Truck,
  ArrowRight
} from 'lucide-react';

export interface StockTransferRequest {
  id: string;
  transferNumber: string;
  sourceStoreId: string;
  sourceStoreName: string;
  targetStoreId: string;
  targetStoreName: string;
  items: {
    productId: string;
    productName: string;
    sku: string;
    quantity: number;
  }[];
  status: 'draft' | 'dispatched' | 'received' | 'cancelled';
  requestedBy: string;
  dispatchedAt?: string;
  receivedAt?: string;
  notes?: string;
  createdAt: string;
}

export interface InterBranchTransferModuleProps {
  products: Product[];
  isOpen: boolean;
  onClose: () => void;
  onStockUpdated?: () => void;
}

const STORAGE_KEY = 'prodx_interbranch_transfers';

export const InterBranchTransferModule: React.FC<InterBranchTransferModuleProps> = ({
  products,
  isOpen,
  onClose,
  onStockUpdated,
}) => {
  const { session } = useAuth();
  const { language } = useLanguage();
  const { addToast } = useToast();

  const [transfers, setTransfers] = useState<StockTransferRequest[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return [
      {
        id: 'trf-101',
        transferNumber: 'TRF-202610-001',
        sourceStoreId: 'store-headquarters',
        sourceStoreName: 'สำนักงานใหญ่ (Headquarters)',
        targetStoreId: session?.currentStore.id || 'store-01',
        targetStoreName: session?.currentStore.name || 'สาขาหลัก (Main Store)',
        items: [
          { productId: products[0]?.id || 'p1', productName: products[0]?.name || 'Espresso Blend 250g', sku: 'ESP-001', quantity: 20 },
        ],
        status: 'dispatched',
        requestedBy: 'Manager Somchai',
        dispatchedAt: new Date(Date.now() - 3600000 * 4).toISOString(),
        notes: 'สินค้าเติมสต็อกประจำสัปดาห์',
        createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
      },
    ];
  });

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [targetStoreId, setTargetStoreId] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [transferQty, setTransferQty] = useState(5);
  const [transferNotes, setTransferNotes] = useState('');
  const [stagedItems, setStagedItems] = useState<{ productId: string; productName: string; sku: string; quantity: number }[]>([]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(transfers));
  }, [transfers]);

  if (!session) return null;

  const storesList = session.organization.stores;
  const currentStore = session.currentStore;

  const handleAddItem = () => {
    if (!selectedProductId || transferQty <= 0) return;
    const prod = products.find((p) => p.id === selectedProductId);
    if (!prod) return;

    if (stagedItems.some((item) => item.productId === selectedProductId)) {
      setStagedItems((prev) =>
        prev.map((item) =>
          item.productId === selectedProductId
            ? { ...item, quantity: item.quantity + transferQty }
            : item
        )
      );
    } else {
      setStagedItems((prev) => [
        ...prev,
        {
          productId: prod.id,
          productName: prod.name,
          sku: prod.sku,
          quantity: transferQty,
        },
      ]);
    }

    setSelectedProductId('');
    setTransferQty(5);
    triggerHaptic('tap');
  };

  const handleCreateTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetStoreId || stagedItems.length === 0) return;

    const targetStore = storesList.find((s) => s.id === targetStoreId);
    if (!targetStore) return;

    const newTransfer: StockTransferRequest = {
      id: `trf-${Date.now()}`,
      transferNumber: `TRF-${new Date().toISOString().slice(0, 7).replace('-', '')}-${Math.floor(100 + Math.random() * 900)}`,
      sourceStoreId: currentStore.id,
      sourceStoreName: currentStore.name,
      targetStoreId: targetStore.id,
      targetStoreName: targetStore.name,
      items: stagedItems,
      status: 'dispatched',
      requestedBy: session.currentUser.name,
      dispatchedAt: new Date().toISOString(),
      notes: transferNotes,
      createdAt: new Date().toISOString(),
    };

    setTransfers((prev) => [newTransfer, ...prev]);
    setIsCreateModalOpen(false);
    setStagedItems([]);
    setTransferNotes('');
    setTargetStoreId('');

    playScannerSound('success');
    addToast({
      title: language === 'th' ? 'สร้างใบย้ายสต็อกสำเร็จ' : 'Stock Transfer Created',
      message: `${newTransfer.transferNumber} ${language === 'th' ? 'ส่งไปยัง' : 'sent to'} ${targetStore.name}`,
      type: 'success',
    });
  };

  const handleReceiveTransfer = (transferId: string) => {
    triggerHaptic('heavy');
    playScannerSound('payment_success');

    setTransfers((prev) =>
      prev.map((t) =>
        t.id === transferId
          ? { ...t, status: 'received', receivedAt: new Date().toISOString() }
          : t
      )
    );

    addToast({
      title: language === 'th' ? 'รับสินค้าเข้าคลังสาขาสำเร็จ' : 'Transfer Received & Ingested',
      message: language === 'th' ? 'เพิ่มจำนวนสต็อกเข้าคลังสาขาเรียบร้อยแล้ว' : 'Stock balances updated for target store.',
      type: 'success',
    });

    onStockUpdated?.();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={language === 'th' ? 'การย้ายสต็อกระหว่างสาขา (Inter-Branch Transfer)' : 'Inter-Branch Stock Transfer'}
      description={language === 'th' ? 'โอนย้ายสินค้าคงคลังระหว่างสาขาในองค์กรพร้อมบันทึกประวัติ' : 'Manage multi-store inventory dispatches, in-transit manifests and arrivals.'}
      maxWidth="3xl"
    >
      <div className="space-y-4">
        {/* Actions Bar */}
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-card border border-border">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold text-text">
              {language === 'th' ? 'สาขาปัจจุบัน:' : 'Current Branch:'}{' '}
              <span className="text-primary font-mono tabular-nums">{currentStore.name} ({currentStore.code})</span>
            </span>
          </div>

          <Button
            size="sm"
            variant="primary"
            onClick={() => setIsCreateModalOpen(true)}
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {language === 'th' ? 'สร้างใบย้ายสต็อกใหม่' : 'New Transfer Manifest'}
          </Button>
        </div>

        {/* Transfers List */}
        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {transfers.length === 0 ? (
            <div className="p-8 text-center text-brand-text-secondary border border-border rounded-xl">
              <Truck className="h-8 w-8 mx-auto text-text/30 mb-2" />
              <p className="text-xs font-bold">{language === 'th' ? 'ยังไม่มีรายการย้ายสต็อก' : 'No transfers recorded'}</p>
            </div>
          ) : (
            transfers.map((trf) => (
              <div key={trf.id} className="p-4 rounded-xl border border-border bg-card shadow-2xs space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-mono tabular-nums font-black text-text">{trf.transferNumber}</span>
                    <Badge
                      variant={
                        trf.status === 'received'
                          ? 'success'
                          : trf.status === 'dispatched'
                          ? 'warning'
                          : 'neutral'
                      }
                      size="sm"
                    >
                      {trf.status.toUpperCase()}
                    </Badge>
                  </div>

                  <span className="text-[11px] text-brand-text-secondary font-mono tabular-nums">
                    {new Date(trf.createdAt).toLocaleDateString()}
                  </span>
                </div>

                {/* Origin -> Destination Route */}
                <div className="p-2.5 rounded-lg bg-background border border-border flex items-center justify-between text-xs font-semibold">
                  <span className="text-text/70">{trf.sourceStoreName}</span>
                  <ArrowRight className="h-4 w-4 text-primary shrink-0" />
                  <span className="text-text font-bold text-primary">{trf.targetStoreName}</span>
                </div>

                {/* Item List Summary */}
                <div className="text-xs space-y-1">
                  {trf.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between text-text/80 font-mono tabular-nums">
                      <span>{item.quantity}x {item.productName} ({item.sku})</span>
                    </div>
                  ))}
                </div>

                {/* Bottom Action */}
                {trf.status === 'dispatched' && trf.targetStoreId === currentStore.id && (
                  <div className="pt-2 border-t border-border flex justify-end">
                    <Button
                      size="sm"
                      variant="primary"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                      leftIcon={<PackageCheck className="h-4 w-4" />}
                      onClick={() => handleReceiveTransfer(trf.id)}
                    >
                      {language === 'th' ? 'ยืนยันรับสินค้าเข้าคลังสาขานี้' : 'Confirm & Ingest Stock'}
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* New Transfer Modal */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title={language === 'th' ? 'สร้างรายการโอนย้ายสินค้าคงคลัง' : 'Create Inter-Branch Stock Transfer'}
        maxWidth="md"
      >
        <form onSubmit={handleCreateTransfer} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-text/70 mb-1">
              {language === 'th' ? 'สาขาปลายทาง' : 'Destination Store'} *
            </label>
            <select
              required
              value={targetStoreId}
              onChange={(e) => setTargetStoreId(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-border bg-background text-xs font-bold text-text focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">-- {language === 'th' ? 'เลือกสาขาปลายทาง' : 'Select Target Store'} --</option>
              {storesList
                .filter((s) => s.id !== currentStore.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
            </select>
          </div>

          <div className="p-3 rounded-xl border border-border bg-card space-y-2">
            <label className="block text-xs font-bold text-text/70">
              {language === 'th' ? 'เพิ่มสินค้าที่ต้องการโอนย้าย' : 'Add Transfer Products'}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="sm:col-span-8 h-9 px-3 rounded-lg border border-border bg-background text-xs text-text focus:outline-none"
              >
                <option value="">-- {language === 'th' ? 'เลือกสินค้า' : 'Select Item'} --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (คงเหลือ: {p.currentStock})
                  </option>
                ))}
              </select>

              <input
                type="number"
                inputMode="numeric"
                min="1"
                value={transferQty}
                onChange={(e) => setTransferQty(parseInt(e.target.value, 10) || 1)}
                className="sm:col-span-2 h-9 px-2 rounded-lg border border-border bg-background text-xs font-mono tabular-nums font-bold text-center"
              />

              <button
                type="button"
                onClick={handleAddItem}
                disabled={!selectedProductId}
                className="sm:col-span-2 min-h-[44px] h-11 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-bold flex items-center justify-center cursor-pointer disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
              >
                + {language === 'th' ? 'เพิ่ม' : 'Add'}
              </button>
            </div>

            {/* Staged Items List */}
            {stagedItems.length > 0 && (
              <div className="space-y-1.5 pt-2">
                {stagedItems.map((item, idx) => (
                  <div key={idx} className="p-2 rounded-lg bg-background border border-border flex justify-between items-center text-xs font-mono tabular-nums">
                    <span>{item.quantity}x {item.productName} ({item.sku})</span>
                    <button
                      type="button"
                      onClick={() => setStagedItems((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-rose-500 font-bold hover:underline"
                    >
                      {language === 'th' ? 'ลบ' : 'Remove'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-text/70 mb-1">
              {language === 'th' ? 'หมายเหตุ' : 'Transfer Notes'}
            </label>
            <input
              type="text"
              value={transferNotes}
              onChange={(e) => setTransferNotes(e.target.value)}
              placeholder="e.g. สินค้าเติมสต็อกสำหรับโปรโมชัน"
              className="w-full h-9 px-3 rounded-lg border border-border bg-background text-xs text-text focus:outline-none"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <Button variant="secondary" size="md" onClick={() => setIsCreateModalOpen(false)}>
              {language === 'th' ? 'ยกเลิก' : 'Cancel'}
            </Button>
            <Button
              variant="primary"
              size="md"
              type="submit"
              disabled={stagedItems.length === 0 || !targetStoreId}
              leftIcon={<Send className="h-4 w-4" />}
            >
              {language === 'th' ? 'บันทึกและส่งย้ายสต็อก' : 'Submit Manifest'}
            </Button>
          </div>
        </form>
      </Modal>
    </Modal>
  );
};
