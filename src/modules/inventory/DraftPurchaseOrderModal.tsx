import React, { useState, useMemo, useEffect } from 'react';
import { Product } from '../../domain/catalog';
import { formatMoney, createMoney } from '../../domain/money';
import {
  PurchaseOrder,
  PurchaseOrderLineItem,
  SupplierInfo,
  DEFAULT_SUPPLIERS,
  PurchaseOrderStatus,
} from '../../domain/purchaseOrder';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { SearchInput } from '../../components/common/SearchInput';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { createCatalogApi } from '../../adapters/catalogApiFactory';
import {
  FileText,
  Printer,
  Download,
  Copy,
  CheckCircle2,
  AlertTriangle,
  PackageCheck,
  Truck,
  Building2,
  Calendar,
  CreditCard,
  Trash2,
  Plus,
  Send,
  Save,
  Boxes,
  DollarSign,
  Layers,
  Sparkles,
  Receipt,
  User,
  ExternalLink,
} from 'lucide-react';
import { generatePurchaseOrderCsv, downloadCsvFile } from '../../utils/csvExport';
import { playScannerSound } from '../../services/soundService';

export interface DraftPurchaseOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialItems: ReadonlyArray<{
    product: Product;
    categoryName: string;
    suggestedQty: number;
    urgency: 'critical' | 'low_stock' | 'velocity_risk';
  }>;
  availableProducts: readonly Product[];
  categories: readonly { id: string; name: string }[];
  lowStockThreshold: number;
  onPoSubmittedOrReceived?: () => void;
}

export const DraftPurchaseOrderModal: React.FC<DraftPurchaseOrderModalProps> = ({
  isOpen,
  onClose,
  initialItems,
  availableProducts,
  categories,
  lowStockThreshold,
  onPoSubmittedOrReceived,
}) => {
  const { language } = useLanguage();
  const { addToast } = useToast();
  const { session } = useAuth();
  const inventoryAdjustmentApi = useMemo(() => createCatalogApi(session?.token ?? ''), [session?.token]);

  // PO Identification
  const [poNumber, setPoNumber] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>(DEFAULT_SUPPLIERS[0].id);
  const [customSupplierName, setCustomSupplierName] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Credit 30 Days (Net 30)');
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  });
  const [poNotes, setPoNotes] = useState('');
  const [shippingFee, setShippingFee] = useState<number>(0);
  const [discountAmount, setDiscountAmount] = useState<number>(0);

  // Line Items in Draft PO
  const [lineItems, setLineItems] = useState<
    Array<{
      id: string;
      productId: string;
      productName: string;
      sku: string;
      barcode: string;
      categoryName: string;
      unitOfMeasure: string;
      currentStock: number;
      reorderPoint: number;
      quantity: number;
      unitCostCents: number;
      urgency: 'critical' | 'low_stock' | 'velocity_risk';
    }>
  >([]);

  // Add Product Search in PO
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [poStatus, setPoStatus] = useState<PurchaseOrderStatus>('draft');

  const categoryMap = useMemo(() => {
    return new Map(categories.map((c) => [c.id, c.name]));
  }, [categories]);

  // Generate unique PO Number and initialize items when opened
  useEffect(() => {
    if (isOpen) {
      const dateCode = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      setPoNumber(`PO-${dateCode}-${randomSuffix}`);
      setPoStatus('draft');

      const mapped = initialItems.map((it, idx) => ({
        id: `po-item-${it.product.id}-${idx}`,
        productId: it.product.id,
        productName: it.product.name,
        sku: it.product.sku,
        barcode: it.product.barcode,
        categoryName: it.categoryName || categoryMap.get(it.product.categoryId) || 'General',
        unitOfMeasure: it.product.unitOfMeasure || 'pcs',
        currentStock: it.product.currentStock,
        reorderPoint: it.product.reorderPoint,
        quantity: Math.max(1, it.suggestedQty),
        unitCostCents: it.product.costPrice?.amountInCents || 0,
        urgency: it.urgency,
      }));
      setLineItems(mapped);

      setPoNotes(
        language === 'th'
          ? `ใบสั่งซื้อรวมสินค้าสต็อกต่ำอัตโนมัติ (เกณฑ์เตือน <= ${lowStockThreshold} ชิ้น)`
          : `Automated bulk procurement order for low-stock SKUs (threshold <= ${lowStockThreshold})`
      );
    }
  }, [isOpen, initialItems, categoryMap, language, lowStockThreshold]);

  // Selected Supplier details
  const activeSupplier = useMemo(() => {
    if (selectedSupplierId === 'custom') {
      return {
        id: 'custom',
        name: customSupplierName.trim() || (language === 'th' ? 'ซัพพลายเออร์ทั่วไป (Custom)' : 'Custom Supplier'),
        contactPerson: 'Sales Coordinator',
        email: 'supplier@example.com',
        phone: '+66 2 000 0000',
        paymentTerms,
        leadTimeDays: 2,
      };
    }
    return DEFAULT_SUPPLIERS.find((s) => s.id === selectedSupplierId) || DEFAULT_SUPPLIERS[0];
  }, [selectedSupplierId, customSupplierName, paymentTerms, language]);

  // Handle line item edits
  const handleQuantityChange = (id: string, qty: number) => {
    setLineItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, quantity: Math.max(1, qty) } : item))
    );
  };

  const handleUnitCostChange = (id: string, costCents: number) => {
    setLineItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, unitCostCents: Math.max(0, costCents) } : item))
    );
  };

  const handleRemoveItem = (id: string) => {
    setLineItems((prev) => prev.filter((item) => item.id !== id));
    playScannerSound('click');
  };

  const handleAddProductToPo = (prod: Product) => {
    if (lineItems.some((i) => i.productId === prod.id)) {
      addToast({
        title: language === 'th' ? 'มีสินค้านี้ในใบสั่งซื้อแล้ว' : 'Item already in PO',
        message: prod.name,
        type: 'info',
      });
      return;
    }

    const newItem = {
      id: `po-item-${prod.id}-${Date.now()}`,
      productId: prod.id,
      productName: prod.name,
      sku: prod.sku,
      barcode: prod.barcode,
      categoryName: categoryMap.get(prod.categoryId) || 'General',
      unitOfMeasure: prod.unitOfMeasure || 'pcs',
      currentStock: prod.currentStock,
      reorderPoint: prod.reorderPoint,
      quantity: Math.max(10, prod.reorderPoint * 2),
      unitCostCents: prod.costPrice?.amountInCents || 0,
      urgency: (prod.currentStock <= 0 ? 'critical' : 'low_stock') as 'critical' | 'low_stock',
    };

    setLineItems((prev) => [newItem, ...prev]);
    setIsAddProductOpen(false);
    setProductSearchQuery('');
    playScannerSound('success');
    addToast({
      title: language === 'th' ? 'เพิ่มสินค้าลงใบสั่งซื้อแล้ว' : 'Product Added to PO',
      message: prod.name,
      type: 'success',
    });
  };

  // Financial Computations
  const financialTotals = useMemo(() => {
    const currency = session?.currentStore.currency || 'THB';
    const subtotalCents = lineItems.reduce((acc, it) => acc + it.quantity * it.unitCostCents, 0);
    const taxRateBps = session?.currentStore.defaultTaxRateBps || 700; // 7% VAT
    const taxAmountCents = Math.round((subtotalCents * taxRateBps) / 10000);
    const shippingCents = Math.round(shippingFee * 100);
    const discountCents = Math.round(discountAmount * 100);
    const grandTotalCents = Math.max(0, subtotalCents - discountCents + taxAmountCents + shippingCents);
    const totalUnits = lineItems.reduce((acc, it) => acc + it.quantity, 0);

    return {
      subtotal: createMoney(subtotalCents, currency),
      taxRateBps,
      taxAmount: createMoney(taxAmountCents, currency),
      shipping: createMoney(shippingCents, currency),
      discount: createMoney(discountCents, currency),
      grandTotal: createMoney(grandTotalCents, currency),
      totalUnits,
      subtotalCents,
      grandTotalCents,
    };
  }, [lineItems, session, shippingFee, discountAmount]);

  // Export CSV
  const handleExportCsv = () => {
    if (lineItems.length === 0) return;

    const currency = session?.currentStore.currency || 'THB';
    const itemsData = lineItems.map((it) => ({
      sku: it.sku,
      barcode: it.barcode,
      productName: it.productName,
      categoryName: it.categoryName,
      unitOfMeasure: it.unitOfMeasure,
      currentStock: it.currentStock,
      quantity: it.quantity,
      unitCostFormatted: (it.unitCostCents / 100).toFixed(2),
      lineTotalFormatted: ((it.quantity * it.unitCostCents) / 100).toFixed(2),
      urgency: it.urgency,
    }));

    const storeName = session?.currentStore.name || 'Store';
    const csvString = generatePurchaseOrderCsv(
      poNumber,
      storeName,
      activeSupplier.name,
      new Date().toLocaleDateString(),
      expectedDeliveryDate,
      activeSupplier.paymentTerms || paymentTerms,
      itemsData,
      formatMoney(financialTotals.subtotal),
      formatMoney(financialTotals.taxAmount),
      formatMoney(financialTotals.grandTotal)
    );

    downloadCsvFile(`${poNumber}_${activeSupplier.name.replace(/\s+/g, '_')}.csv`, csvString);
    playScannerSound('success');
    addToast({
      title: language === 'th' ? 'ส่งออก CSV สำเร็จ' : 'PO CSV Exported',
      message: `${poNumber}.csv (${lineItems.length} items)`,
      type: 'success',
    });
  };

  // Copy PO Text for LINE / Email Dispatch
  const handleCopyPoText = () => {
    const store = session?.currentStore;
    const lines = [
      `📦 ใบสั่งซื้อสินค้า (PURCHASE ORDER)`,
      `เลขที่ใบสั่งซื้อ: ${poNumber}`,
      `ร้านค้าผู้สั่งซื้อ: ${store?.name || 'PRODX Store'} (${store?.phone || ''})`,
      `ผู้สั่ง: ${session?.currentUser.name || 'Purchasing Staff'}`,
      `ซัพพลายเออร์: ${activeSupplier.name}`,
      `กำหนดส่งมอบ: ${expectedDeliveryDate}`,
      `เงื่อนไขชำระเงิน: ${activeSupplier.paymentTerms || paymentTerms}`,
      `-----------------------------------------`,
      `รายการสินค้าที่สั่งซื้อ (${lineItems.length} รายการ, รวม ${financialTotals.totalUnits} ชิ้น):`,
      ...lineItems.map(
        (it, idx) =>
          `${idx + 1}. [${it.sku}] ${it.productName} x ${it.quantity} ${it.unitOfMeasure} @ ${formatMoney(
            createMoney(it.unitCostCents, store?.currency || 'THB')
          )} = ${formatMoney(createMoney(it.quantity * it.unitCostCents, store?.currency || 'THB'))}`
      ),
      `-----------------------------------------`,
      `ยอดรวมก่อนภาษี (Subtotal): ${formatMoney(financialTotals.subtotal)}`,
      `ภาษีมูลค่าเพิ่ม 7% (VAT): ${formatMoney(financialTotals.taxAmount)}`,
      `ยอดสุทธิทั้งสิ้น (Grand Total): ${formatMoney(financialTotals.grandTotal)}`,
      poNotes ? `หมายเหตุ: ${poNotes}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    navigator.clipboard.writeText(lines);
    playScannerSound('click');
    addToast({
      title: language === 'th' ? 'คัดลอกข้อความสั่งซื้อสำเร็จ' : 'PO Text Copied',
      message: language === 'th' ? 'คัดลอกสำหรับส่งทาง LINE หรือ Email เรียบร้อย' : 'Ready to paste in LINE or Email.',
      type: 'success',
    });
  };

  // Print Official PO Sheet
  const handlePrintPo = () => {
    window.print();
  };

  // Save as Draft PO
  const handleSaveDraft = () => {
    const draftPo: PurchaseOrder = {
      id: `po-${Date.now()}`,
      poNumber,
      storeId: session?.currentStore.id || 'store-1',
      storeName: session?.currentStore.name || 'Store',
      storeAddress: session?.currentStore.address,
      storePhone: session?.currentStore.phone,
      createdByUserId: session?.currentUser.id || 'usr-1',
      createdByUserName: session?.currentUser.name || 'Admin',
      supplier: activeSupplier,
      status: 'draft',
      items: lineItems.map((it) => ({
        id: it.id,
        productId: it.productId,
        sku: it.sku,
        barcode: it.barcode,
        productName: it.productName,
        categoryName: it.categoryName,
        unitOfMeasure: it.unitOfMeasure,
        currentStock: it.currentStock,
        reorderPoint: it.reorderPoint,
        quantity: it.quantity,
        unitCost: createMoney(it.unitCostCents, session?.currentStore.currency || 'THB'),
        lineTotal: createMoney(it.quantity * it.unitCostCents, session?.currentStore.currency || 'THB'),
        urgency: it.urgency,
      })),
      subtotal: financialTotals.subtotal,
      taxRateBps: financialTotals.taxRateBps,
      taxAmount: financialTotals.taxAmount,
      shippingCost: financialTotals.shipping,
      discountAmount: financialTotals.discount,
      grandTotal: financialTotals.grandTotal,
      createdAt: new Date().toISOString(),
      expectedDeliveryDate,
      notes: poNotes,
      source: 'restock_report_bulk',
    };

    // Save to localStorage list of Purchase Orders
    try {
      const existingKey = 'prodx_purchase_orders_store_' + (session?.currentStore.id || 'default');
      const stored = localStorage.getItem(existingKey);
      const list: PurchaseOrder[] = stored ? JSON.parse(stored) : [];
      localStorage.setItem(existingKey, JSON.stringify([draftPo, ...list]));
    } catch (e) {
      console.error('Failed to cache PO:', e);
    }

    playScannerSound('success');
    addToast({
      title: language === 'th' ? 'บันทึกร่างใบสั่งซื้อแล้ว' : 'Draft PO Saved',
      message: `${poNumber} (${lineItems.length} ${language === 'th' ? 'รายการ' : 'items'})`,
      type: 'success',
    });
    onClose();
  };

  // Approve & Dispatch to Supplier
  const handleApproveAndIssue = async () => {
    setIsSubmitting(true);
    playScannerSound('cash_drawer');

    setTimeout(() => {
      setIsSubmitting(false);
      setPoStatus('issued');

      addToast({
        title: language === 'th' ? 'อนุมัติและออกใบสั่งซื้อสำเร็จ' : 'Purchase Order Issued',
        message: `${poNumber} ${language === 'th' ? 'ส่งไปยัง' : 'issued to'} ${activeSupplier.name}`,
        type: 'success',
      });

      if (onPoSubmittedOrReceived) {
        onPoSubmittedOrReceived();
      }
      onClose();
    }, 600);
  };

  // Direct Goods Receipt (รับเข้าคลังทันทีจาก PO)
  const handleDirectReceiveStock = async () => {
    if (!session || lineItems.length === 0) return;
    setIsSubmitting(true);
    playScannerSound('click');

    try {
      let count = 0;
      for (const item of lineItems) {
        if (item.quantity <= 0) continue;
        await inventoryAdjustmentApi.adjustStock(
          session.currentStore.id,
          item.productId,
          item.quantity,
          'purchase_received',
          session.currentUser.id,
          language === 'th'
            ? `รับสินค้าเข้าคลังตามใบสั่งซื้อ ${poNumber} (ซัพพลายเออร์: ${activeSupplier.name})`
            : `Stock received via Purchase Order ${poNumber} (${activeSupplier.name})`
        );
        count++;
      }

      playScannerSound('success');
      addToast({
        title: language === 'th' ? 'รับสินค้าเข้าคลังสำเร็จ' : 'Stock Received & Adjusted',
        message: language === 'th'
          ? `อัปเดตยอดสต็อก ${count} รายการตามใบสั่งซื้อ ${poNumber} เรียบร้อยแล้ว`
          : `Adjusted inventory for ${count} items based on PO ${poNumber}.`,
        type: 'success',
      });

      if (onPoSubmittedOrReceived) {
        onPoSubmittedOrReceived();
      }
      onClose();
    } catch (err: any) {
      playScannerSound('error');
      addToast({
        title: language === 'th' ? 'เกิดข้อผิดพลาดในการรับสินค้า' : 'Receiving Error',
        message: err?.message || 'Failed to complete receiving.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredCatalogForAdd = useMemo(() => {
    if (!productSearchQuery.trim()) return availableProducts.slice(0, 8);
    const q = productSearchQuery.toLowerCase();
    return availableProducts
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [availableProducts, productSearchQuery]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        language === 'th'
          ? `ตรวจทานร่างใบสั่งซื้อ (Draft Purchase Order ${poNumber})`
          : `Draft Purchase Order Review (${poNumber})`
      }
      description={
        language === 'th'
          ? 'รวบรวมสินค้าสต็อกต่ำทั้งหมดลงในใบสั่งซื้อเดียวเพื่อตรวจทาน แก้ไขจำนวน และส่งให้ซัพพลายเออร์'
          : 'Consolidated draft procurement order for all flagged low-stock inventory ready for review and supplier issue.'
      }
      maxWidth="2xl"
      footer={
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-2 text-xs text-text/60">
            <span>{language === 'th' ? 'รายการรวม:' : 'Total Items:'}</span>
            <span className="font-mono tabular-nums font-black text-primary">
              {lineItems.length} {language === 'th' ? 'รายการ' : 'SKUs'} ({financialTotals.totalUnits}{' '}
              {language === 'th' ? 'หน่วย' : 'units'})
            </span>
            <span className="mx-1 text-border">|</span>
            <span>{language === 'th' ? 'ยอดรวมสุทธิ:' : 'Grand Total:'}</span>
            <span className="font-mono tabular-nums font-black text-emerald-600 dark:text-emerald-400 text-sm">
              {formatMoney(financialTotals.grandTotal)}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyPoText}
              leftIcon={<Copy className="h-4 w-4 text-text/70" />}
              className="text-xs cursor-pointer"
            >
              {language === 'th' ? 'คัดลอกข้อความ (LINE/Chat)' : 'Copy PO Text'}
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleExportCsv}
              leftIcon={<Download className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
              className="text-xs font-bold cursor-pointer"
            >
              {language === 'th' ? 'ส่งออก PO (CSV)' : 'Export CSV'}
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handlePrintPo}
              leftIcon={<Printer className="h-4 w-4 text-primary" />}
              className="text-xs font-bold cursor-pointer"
            >
              {language === 'th' ? 'พิมพ์ใบสั่งซื้อ' : 'Print PO'}
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleSaveDraft}
              leftIcon={<Save className="h-4 w-4 text-amber-500" />}
              className="text-xs font-bold cursor-pointer"
            >
              {language === 'th' ? 'บันทึกเป็นแบบร่าง' : 'Save Draft'}
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleDirectReceiveStock}
              disabled={isSubmitting || lineItems.length === 0}
              isLoading={isSubmitting}
              leftIcon={<PackageCheck className="h-4 w-4" />}
              className="text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700 shadow-xs cursor-pointer"
            >
              {language === 'th' ? 'รับสินค้าเข้าคลังทันที' : 'Receive & Replenish Stock'}
            </Button>

            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleApproveAndIssue}
              disabled={isSubmitting || lineItems.length === 0}
              isLoading={isSubmitting}
              leftIcon={<Send className="h-4 w-4" />}
              className="text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta shadow-xs cursor-pointer"
            >
              {language === 'th' ? 'อนุมัติ & ส่งซัพพลายเออร์' : 'Issue PO to Supplier'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5 text-left">
        {/* 1. Purchase Order Information Card */}
        <div className="p-4 rounded-2xl bg-card border border-border border-crisp shadow-2xs space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {/* Store & Issuer */}
            <div className="space-y-1.5 p-3 rounded-xl bg-muted/40 border border-border/60">
              <div className="flex items-center gap-2 font-bold text-text/70 uppercase tracking-wider text-[10px]">
                <Building2 className="h-3.5 w-3.5 text-primary" />
                <span>{language === 'th' ? 'ข้อมูลร้านค้าผู้สั่งซื้อ' : 'Purchasing Store'}</span>
              </div>
              <div className="font-bold text-text">{session?.currentStore.name}</div>
              <div className="text-[11px] text-text/60">
                {session?.currentStore.address || 'Flagship Store'}
              </div>
              <div className="text-[10px] text-brand-text-secondary font-mono tabular-nums">
                {language === 'th' ? 'ผู้เปิด PO:' : 'Issued by:'} {session?.currentUser.name} (
                {session?.currentUser.role})
              </div>
            </div>

            {/* Supplier Selector */}
            <div className="space-y-1.5 p-3 rounded-xl bg-muted/40 border border-border/60">
              <div className="flex items-center gap-2 font-bold text-text/70 uppercase tracking-wider text-[10px]">
                <Truck className="h-3.5 w-3.5 text-amber-500" />
                <span>{language === 'th' ? 'เลือกซัพพลายเออร์ (Supplier)' : 'Vendor / Supplier'}</span>
              </div>

              <select
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="w-full h-8 px-2 rounded-lg border border-border bg-card text-xs font-bold text-text focus:outline-none focus:border-primary"
              >
                {DEFAULT_SUPPLIERS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.paymentTerms})
                  </option>
                ))}
                <option value="custom">{language === 'th' ? '+ กำหนดซัพพลายเออร์เอง...' : '+ Custom Supplier...'}</option>
              </select>

              {selectedSupplierId === 'custom' ? (
                <input
                  type="text"
                  placeholder={language === 'th' ? 'ระบุชื่อซัพพลายเออร์...' : 'Enter supplier name...'}
                  value={customSupplierName}
                  onChange={(e) => setCustomSupplierName(e.target.value)}
                  className="w-full h-7 px-2 rounded-lg border border-border bg-card text-xs text-text focus:outline-none focus:border-primary"
                />
              ) : (
                <div className="text-[11px] text-text/60">
                  <span>{activeSupplier.contactPerson}</span> • <span>{activeSupplier.phone}</span>
                </div>
              )}
            </div>

            {/* Order Terms & Expected Delivery */}
            <div className="space-y-1.5 p-3 rounded-xl bg-muted/40 border border-border/60">
              <div className="flex items-center gap-2 font-bold text-text/70 uppercase tracking-wider text-[10px]">
                <Calendar className="h-3.5 w-3.5 text-emerald-500" />
                <span>{language === 'th' ? 'กำหนดส่งมอบ & เงื่อนไข' : 'Delivery & Terms'}</span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-text/60 shrink-0">{language === 'th' ? 'ส่งมอบ:' : 'ETA:'}</span>
                <input
                  type="date"
                  value={expectedDeliveryDate}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                  className="h-7 flex-1 px-2 rounded-lg border border-border bg-card text-xs text-text font-mono tabular-nums focus:outline-none focus:border-primary"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-text/60 shrink-0">{language === 'th' ? 'เครดิต:' : 'Terms:'}</span>
                <select
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className="h-7 flex-1 px-2 rounded-lg border border-border bg-card text-[11px] text-text focus:outline-none focus:border-primary"
                >
                  <option value="Credit 30 Days (Net 30)">Credit 30 Days (Net 30)</option>
                  <option value="Credit 15 Days (Net 15)">Credit 15 Days (Net 15)</option>
                  <option value="Credit 45 Days (Net 45)">Credit 45 Days (Net 45)</option>
                  <option value="Cash on Delivery (COD)">Cash on Delivery (COD)</option>
                  <option value="Bank Transfer (Prepaid)">Bank Transfer (Prepaid)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Line Items Table with Quantity and Price Steppers */}
        <div className="rounded-2xl border border-border border-crisp overflow-hidden bg-card">
          <div className="p-3 bg-muted/40 border-b border-border border-crisp flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Boxes className="h-4 w-4 text-primary" />
              <span className="font-bold text-xs text-text">
                {language === 'th' ? 'รายการสินค้าสั่งซื้อ' : 'Purchase Order Line Items'} ({lineItems.length})
              </span>
            </div>

            {/* Add Extra Item Dropdown Button */}
            <div className="relative">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setIsAddProductOpen(!isAddProductOpen)}
                leftIcon={<Plus className="h-3.5 w-3.5 text-primary" />}
                className="h-7 text-xs font-bold cursor-pointer"
              >
                {language === 'th' ? 'เพิ่มสินค้าอื่นลง PO' : 'Add Item'}
              </Button>

              {isAddProductOpen && (
                <div className="absolute right-0 top-9 w-72 p-2 bg-card border border-border shadow-xl rounded-xl z-30 space-y-2">
                  <SearchInput
                    value={productSearchQuery}
                    onChange={(e) => setProductSearchQuery(e.target.value)}
                    onClear={() => setProductSearchQuery('')}
                    placeholder={language === 'th' ? 'ค้นหาชื่อสินค้า...' : 'Search product...'}
                  />
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {filteredCatalogForAdd.map((prod) => (
                      <button
                        key={prod.id}
                        type="button"
                        onClick={() => handleAddProductToPo(prod)}
                        className="w-full text-left p-1.5 rounded-lg hover:bg-muted flex items-center justify-between text-xs cursor-pointer"
                      >
                        <div className="truncate mr-2">
                          <div className="font-bold text-text truncate">{prod.name}</div>
                          <div className="text-[10px] text-brand-text-secondary font-mono tabular-nums">{prod.sku}</div>
                        </div>
                        <span className="font-mono tabular-nums text-primary font-bold text-[11px] shrink-0">
                          {formatMoney(prod.costPrice)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto max-h-80 no-scrollbar">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-background/95 backdrop-blur-xs border-b border-border border-crisp z-10 text-text/60 font-semibold">
                <tr>
                  <th className="py-2.5 px-3">#</th>
                  <th className="py-2.5 px-3">{language === 'th' ? 'สินค้า & SKU' : 'Product & SKU'}</th>
                  <th className="py-2.5 px-2 text-center">{language === 'th' ? 'คงเหลือ' : 'Stock'}</th>
                  <th className="py-2.5 px-3 text-center w-36">{language === 'th' ? 'จำนวนสั่งซื้อ' : 'Order Qty'}</th>
                  <th className="py-2.5 px-3 text-right w-28">{language === 'th' ? 'ราคาทุนต่อหน่วย' : 'Unit Cost'}</th>
                  <th className="py-2.5 px-4 text-right">{language === 'th' ? 'ยอดรวม' : 'Line Total'}</th>
                  <th className="py-2.5 px-2 text-center w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {lineItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-brand-text-secondary">
                      {language === 'th' ? 'ไม่มีรายการสินค้าในใบสั่งซื้อ' : 'No items in this purchase order.'}
                    </td>
                  </tr>
                ) : (
                  lineItems.map((item, index) => {
                    const currency = session?.currentStore.currency || 'THB';
                    const lineCost = createMoney(item.quantity * item.unitCostCents, currency);

                    return (
                      <tr key={item.id} className="hover:bg-muted/40 transition-colors">
                        <td className="py-2.5 px-3 text-brand-text-secondary font-mono tabular-nums text-[11px]">{index + 1}</td>

                        <td className="py-2.5 px-3">
                          <div className="font-bold text-text">{item.productName}</div>
                          <div className="text-[10px] text-brand-text-secondary font-mono tabular-nums flex items-center gap-1.5 mt-0.5">
                            <span>SKU: {item.sku}</span>
                            <span>•</span>
                            <span className="text-primary">{item.categoryName}</span>
                            {item.urgency === 'critical' && (
                              <span className="px-1 py-0.2 rounded text-[9px] font-black bg-rose-500/10 text-rose-500">
                                0 Stock
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-2.5 px-2 text-center font-mono tabular-nums">
                          <span
                            className={`font-bold text-xs ${
                              item.currentStock <= 0 ? 'text-rose-500' : 'text-amber-500'
                            }`}
                          >
                            {item.currentStock}
                          </span>
                        </td>

                        {/* Order Qty with Steppers */}
                        <td className="py-2.5 px-3 text-center">
                          <div className="inline-flex items-center gap-1 bg-background border border-border border-crisp rounded-xl p-0.5 h-8">
                            <button
                              type="button"
                              onClick={() => handleQuantityChange(item.id, item.quantity - 5)}
                              className="px-2 h-full text-text/60 hover:text-text hover:bg-muted rounded-lg font-black text-xs cursor-pointer"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              inputMode="numeric"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                handleQuantityChange(item.id, isNaN(val) ? 1 : val);
                              }}
                              className="w-12 text-center font-mono tabular-nums font-black text-xs text-primary bg-transparent border-none p-0 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleQuantityChange(item.id, item.quantity + 5)}
                              className="px-2 h-full text-text/60 hover:text-text hover:bg-muted rounded-lg font-black text-xs cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </td>

                        {/* Unit Cost Editor */}
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          <div className="inline-flex items-center justify-end">
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.5"
                              value={(item.unitCostCents / 100).toFixed(2)}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                handleUnitCostChange(item.id, isNaN(val) ? 0 : Math.round(val * 100));
                              }}
                              className="w-20 text-right font-mono tabular-nums text-xs text-text bg-background border border-border border-crisp rounded-lg px-2 py-1 focus:outline-none focus:border-primary"
                            />
                          </div>
                        </td>

                        {/* Line Total */}
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-xs text-emerald-600 dark:text-emerald-400">
                          {formatMoney(lineCost)}
                        </td>

                        {/* Remove item */}
                        <td className="py-2.5 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="p-1 rounded-lg text-brand-text-secondary hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title={language === 'th' ? 'ลบรายการนี้' : 'Remove from PO'}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* 3. Bottom Financial Summary & Notes Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Notes & Instructions */}
          <div className="p-3.5 rounded-2xl bg-card border border-border border-crisp space-y-2">
            <span className="text-xs font-bold text-text uppercase tracking-wider">
              {language === 'th' ? 'หมายเหตุ & คำแนะนำการจัดส่ง' : 'Order Notes & Instructions'}
            </span>
            <textarea
              rows={3}
              value={poNotes}
              onChange={(e) => setPoNotes(e.target.value)}
              placeholder={
                language === 'th'
                  ? 'ระบุคำแนะนำเพิ่มเติม เช่น เวลาส่งสินค้า หรือเงื่อนไขใบกำกับภาษี...'
                  : 'Add procurement instructions or delivery notes...'
              }
              className="w-full p-2.5 rounded-xl border border-border bg-background text-xs text-text focus:outline-none focus:border-primary resize-none"
            />
          </div>

          {/* Pricing & Tax Summary */}
          <div className="p-3.5 rounded-2xl bg-card border border-border border-crisp space-y-2 text-xs">
            <div className="flex items-center justify-between text-text/70">
              <span>{language === 'th' ? 'ยอดรวมสินค้า (Subtotal):' : 'Items Subtotal:'}</span>
              <span className="font-mono tabular-nums font-bold text-text">
                {formatMoney(financialTotals.subtotal)}
              </span>
            </div>

            <div className="flex items-center justify-between text-text/70">
              <span>{language === 'th' ? 'ภาษีมูลค่าเพิ่ม (VAT 7%):' : 'Estimated VAT (7%):'}</span>
              <span className="font-mono tabular-nums font-bold text-text">
                {formatMoney(financialTotals.taxAmount)}
              </span>
            </div>

            <div className="flex items-center justify-between text-text/70">
              <span>{language === 'th' ? 'ค่าขนส่ง (Shipping):' : 'Shipping / Freight:'}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={shippingFee}
                onChange={(e) => setShippingFee(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-20 text-right font-mono tabular-nums text-xs text-text bg-background border border-border rounded-lg px-2 py-0.5 focus:outline-none focus:border-primary"
              />
            </div>

            <div className="pt-2 border-t border-border flex items-center justify-between text-sm font-black text-text">
              <span>{language === 'th' ? 'ยอดรวมสุทธิ (Grand Total):' : 'Grand Total:'}</span>
              <span className="font-mono tabular-nums text-base text-emerald-600 dark:text-emerald-400">
                {formatMoney(financialTotals.grandTotal)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
