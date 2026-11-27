import React, { useState, useMemo } from 'react';
import { Product, Category, InventoryLedgerEntry } from '../../domain/catalog';
import { formatMoney, createMoney } from '../../domain/money';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { SearchInput } from '../../components/common/SearchInput';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { createCatalogApi } from '../../adapters/catalogApiFactory';
import {
  AlertTriangle,
  FileSpreadsheet,
  FileText,
  Printer,
  Sparkles,
  Layers,
  DollarSign,
  PackageCheck,
  PackageX,
  RefreshCw,
  SlidersHorizontal,
  ArrowUpDown,
  Filter,
  CheckCircle2,
  Check,
  Download,
  Boxes,
  TrendingUp,
  ShoppingCart,
} from 'lucide-react';
import {
  generateRestockNeededCsv,
  downloadCsvFile,
  RestockReportItemData,
} from '../../utils/csvExport';
import { playScannerSound } from '../../services/soundService';
import { DraftPurchaseOrderModal } from './DraftPurchaseOrderModal';

export interface RestockNeededReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: readonly Product[];
  categories: readonly Category[];
  ledgerEntries: readonly InventoryLedgerEntry[];
  lowStockThreshold: number;
  onOpenThresholdModal: () => void;
  onRestockCompleted?: () => void;
}

export const RestockNeededReportModal: React.FC<RestockNeededReportModalProps> = ({
  isOpen,
  onClose,
  products,
  categories,
  ledgerEntries,
  lowStockThreshold,
  onOpenThresholdModal,
  onRestockCompleted,
}) => {
  const { language } = useLanguage();
  const { addToast } = useToast();
  const { session, can } = useAuth();
  const inventoryAdjustmentApi = useMemo(() => createCatalogApi(session?.token ?? ''), [session?.token]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [urgencyFilter, setUrgencyFilter] = useState<'all' | 'critical' | 'low_stock' | 'velocity_risk'>('all');
  const [sortBy, setSortBy] = useState<'urgency' | 'stock_asc' | 'deficit_desc' | 'cost_desc' | 'name'>('urgency');
  const [customQuantities, setCustomQuantities] = useState<Record<string, number>>({});
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [isExecutingRestock, setIsExecutingRestock] = useState(false);
  const [isPrintPreview, setIsPrintPreview] = useState(false);
  const [isDraftPoModalOpen, setIsDraftPoModalOpen] = useState(false);

  const categoryMap = useMemo(() => {
    return new Map(categories.map((c) => [c.id, c.name]));
  }, [categories]);

  // Calculate Average Daily Sales Velocity (ADSV) for each product
  const productVelocityMap = useMemo(() => {
    const map = new Map<string, { adsv: number; daysRemaining: number; totalSold: number; riskLevel: 'critical' | 'high' | 'medium' | 'healthy' }>();
    
    for (const product of products) {
      const productSales = ledgerEntries.filter(
        (e) => e.productId === product.id && e.reason === 'sale_deduction'
      );
      const totalSold = productSales.reduce((acc, e) => acc + Math.abs(e.quantityDelta), 0);
      
      let adsv = 0;
      if (productSales.length > 0) {
        const timestamps = productSales.map((e) => new Date(e.timestamp).getTime());
        const minTime = Math.min(...timestamps);
        const maxTime = Math.max(...timestamps, Date.now());
        const diffDays = Math.max(1, (maxTime - minTime) / (1000 * 60 * 60 * 24));
        adsv = totalSold / diffDays;
      }
      
      if (adsv === 0) {
        if (product.currentStock <= product.reorderPoint) {
          adsv = Math.max(0.5, product.reorderPoint / 4);
        } else {
          adsv = 0.3;
        }
      }

      const daysRemaining = adsv > 0 ? product.currentStock / adsv : 999;

      let riskLevel: 'critical' | 'high' | 'medium' | 'healthy' = 'healthy';
      if (product.currentStock <= 0 || daysRemaining <= 2) {
        riskLevel = 'critical';
      } else if (product.currentStock <= product.reorderPoint || daysRemaining <= 7) {
        riskLevel = 'high';
      } else if (daysRemaining <= 14) {
        riskLevel = 'medium';
      }

      map.set(product.id, {
        adsv: Number(adsv.toFixed(1)),
        daysRemaining: Number(daysRemaining.toFixed(1)),
        totalSold,
        riskLevel,
      });
    }
    return map;
  }, [products, ledgerEntries]);

  // Identify all items that require restocking
  const restockItems = useMemo(() => {
    const items = products
      .map((p) => {
        const vInfo = productVelocityMap.get(p.id) || { adsv: 0, daysRemaining: 999, totalSold: 0, riskLevel: 'healthy' };
        
        const isOutOfStock = p.currentStock <= 0;
        const isBelowThreshold = p.currentStock > 0 && p.currentStock <= lowStockThreshold;
        const isVelocityAlert = vInfo.riskLevel === 'critical' || vInfo.riskLevel === 'high';
        
        const needsRestock = isOutOfStock || isBelowThreshold || isVelocityAlert;
        if (!needsRestock) return null;

        let urgency: 'critical' | 'low_stock' | 'velocity_risk' = 'low_stock';
        if (isOutOfStock) {
          urgency = 'critical';
        } else if (isVelocityAlert) {
          urgency = 'velocity_risk';
        }

        // Calculation: Target inventory = 14 days of coverage based on ADSV, with minimum of 15 units
        const targetDays = 14;
        const currentInv = Math.max(0, p.currentStock);
        const forecastNeeds = Math.ceil(vInfo.adsv * targetDays);
        const targetStock = Math.max(p.reorderPoint * 2, forecastNeeds, lowStockThreshold + 10);
        const deficit = Math.max(0, targetStock - currentInv);
        const smartSuggestedQty = Math.max(10, deficit);

        const activeQty = customQuantities[p.id] !== undefined ? customQuantities[p.id] : smartSuggestedQty;
        const unitCostCents = p.costPrice?.amountInCents || 0;
        const totalLineCostCents = unitCostCents * activeQty;

        return {
          product: p,
          categoryName: categoryMap.get(p.categoryId) || p.categoryId,
          vInfo,
          urgency,
          isOutOfStock,
          isBelowThreshold,
          isVelocityAlert,
          targetStock,
          deficit,
          smartSuggestedQty,
          activeQty,
          unitCostCents,
          totalLineCostCents,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return items;
  }, [products, lowStockThreshold, productVelocityMap, categoryMap, customQuantities]);

  // Initialize all restock items as selected when modal opens
  React.useEffect(() => {
    if (isOpen) {
      setSelectedProductIds(restockItems.map((it) => it.product.id));
    }
  }, [isOpen, restockItems.length]);

  // Filter and sort items
  const filteredItems = useMemo(() => {
    return restockItems
      .filter((item) => {
        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchSku = item.product.sku.toLowerCase().includes(q);
          const matchBarcode = item.product.barcode.toLowerCase().includes(q);
          const matchName = item.product.name.toLowerCase().includes(q);
          const matchCat = item.categoryName.toLowerCase().includes(q);
          if (!matchSku && !matchBarcode && !matchName && !matchCat) return false;
        }

        // Category filter
        if (selectedCategory !== 'all' && item.product.categoryId !== selectedCategory) {
          return false;
        }

        // Urgency filter
        if (urgencyFilter !== 'all') {
          if (urgencyFilter === 'critical' && item.urgency !== 'critical') return false;
          if (urgencyFilter === 'low_stock' && item.urgency !== 'low_stock') return false;
          if (urgencyFilter === 'velocity_risk' && item.urgency !== 'velocity_risk') return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'urgency') {
          const urgencyOrder = { critical: 0, velocity_risk: 1, low_stock: 2 };
          return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
        }
        if (sortBy === 'stock_asc') {
          return a.product.currentStock - b.product.currentStock;
        }
        if (sortBy === 'deficit_desc') {
          return b.deficit - a.deficit;
        }
        if (sortBy === 'cost_desc') {
          return b.totalLineCostCents - a.totalLineCostCents;
        }
        if (sortBy === 'name') {
          return a.product.name.localeCompare(b.product.name);
        }
        return 0;
      });
  }, [restockItems, searchQuery, selectedCategory, urgencyFilter, sortBy]);

  // Report Summary Statistics
  const reportStats = useMemo(() => {
    const totalFlaggedCount = restockItems.length;
    const criticalOutOfStockCount = restockItems.filter((i) => i.isOutOfStock).length;
    const lowStockCount = restockItems.filter((i) => i.isBelowThreshold).length;
    const velocityRiskCount = restockItems.filter((i) => i.isVelocityAlert).length;

    const selectedItems = restockItems.filter((i) => selectedProductIds.includes(i.product.id));
    const totalSuggestedUnits = selectedItems.reduce((acc, i) => acc + i.activeQty, 0);
    const totalEstimatedCostCents = selectedItems.reduce((acc, i) => acc + i.totalLineCostCents, 0);
    const currency = session?.currentStore.currency || 'THB';

    return {
      totalFlaggedCount,
      criticalOutOfStockCount,
      lowStockCount,
      velocityRiskCount,
      selectedCount: selectedItems.length,
      totalSuggestedUnits,
      totalEstimatedCost: createMoney(totalEstimatedCostCents, currency),
    };
  }, [restockItems, selectedProductIds, session]);

  // Export to CSV handler
  const handleExportCsv = () => {
    const selectedList = restockItems.filter((i) => selectedProductIds.includes(i.product.id));
    if (selectedList.length === 0) {
      addToast({
        title: language === 'th' ? 'ไม่มีรายการที่เลือก' : 'No items selected',
        message: language === 'th' ? 'กรุณาเลือกอย่างน้อย 1 รายการเพื่อส่งออก' : 'Please select at least 1 item to export.',
        type: 'warning',
      });
      return;
    }

    const reportData: RestockReportItemData[] = selectedList.map((item) => ({
      sku: item.product.sku,
      barcode: item.product.barcode,
      name: item.product.name,
      category: item.categoryName,
      currentStock: item.product.currentStock,
      threshold: lowStockThreshold,
      reorderPoint: item.product.reorderPoint,
      deficit: item.deficit,
      suggestedOrderQty: item.activeQty,
      unit: item.product.unitOfMeasure,
      costPriceCents: item.unitCostCents,
      totalCostCents: item.totalLineCostCents,
      urgency: item.urgency,
    }));

    const storeName = session?.currentStore.name || 'Store';
    const csvContent = generateRestockNeededCsv(reportData, storeName, lowStockThreshold);
    const filename = `Restock_Needed_Report_${new Date().toISOString().slice(0, 10)}.csv`;
    
    downloadCsvFile(filename, csvContent);
    playScannerSound('success');

    addToast({
      title: language === 'th' ? 'ส่งออกรายงานสำเร็จ' : 'Export Succeeded',
      message: `${filename} (${selectedList.length} ${language === 'th' ? 'รายการ' : 'items'})`,
      type: 'success',
    });
  };

  // Browser Print trigger
  const handlePrintReport = () => {
    window.print();
  };

  // Execute Direct Restock Replenishment
  const handleExecuteBulkRestock = async () => {
    if (!session || selectedProductIds.length === 0) return;
    setIsExecutingRestock(true);
    playScannerSound('click');

    try {
      const selectedList = restockItems.filter((i) => selectedProductIds.includes(i.product.id));
      let successCount = 0;

      for (const item of selectedList) {
        if (item.activeQty <= 0) continue;

        await inventoryAdjustmentApi.adjustStock(
          session.currentStore.id,
          item.product.id,
          item.activeQty,
          'purchase_received',
          session.currentUser.id,
          language === 'th'
            ? `รับสินค้าเข้าตามรายงาน Restock Needed Report (เกณฑ์ <= ${lowStockThreshold})`
            : `Replenished via Restock Needed Report (threshold <= ${lowStockThreshold})`
        );
        successCount++;
      }

      playScannerSound('success');
      addToast({
        title: language === 'th' ? 'ดำเนินการเติมสต็อกสำเร็จ' : 'Restock Executed',
        message: language === 'th'
          ? `อัปเดตและรับสินค้าเข้าคลังจำนวน ${successCount} รายการเรียบร้อยแล้ว`
          : `Successfully replenished and adjusted stock balances for ${successCount} items.`,
        type: 'success',
      });

      if (onRestockCompleted) {
        onRestockCompleted();
      }
      onClose();
    } catch (err: any) {
      playScannerSound('error');
      addToast({
        title: language === 'th' ? 'เกิดข้อผิดพลาดในการเติมสต็อก' : 'Restock Failed',
        message: err?.message || 'Failed to complete stock adjustment.',
        type: 'error',
      });
    } finally {
      setIsExecutingRestock(false);
    }
  };

  // Stepper handlers
  const handleQuantityChange = (productId: string, val: number) => {
    setCustomQuantities((prev) => ({
      ...prev,
      [productId]: Math.max(0, val),
    }));
  };

  // Bulk Generate Purchase Order handler & computed items
  const itemsForDraftPo = useMemo(() => {
    const list = selectedProductIds.length > 0
      ? restockItems.filter((i) => selectedProductIds.includes(i.product.id))
      : restockItems;

    return list.map((item) => ({
      product: item.product,
      categoryName: item.categoryName,
      suggestedQty: item.activeQty,
      urgency: item.urgency,
    }));
  }, [restockItems, selectedProductIds]);

  const handleBulkGeneratePurchaseOrder = () => {
    if (restockItems.length === 0) {
      addToast({
        title: language === 'th' ? 'ไม่มีรายการสินค้าที่ต้องสั่งซื้อ' : 'No Restock Items',
        message: language === 'th' ? 'ระดับสต็อกสินค้าทุกรายการอยู่ในเกณฑ์ปกติ' : 'All items are currently above alert thresholds.',
        type: 'info',
      });
      return;
    }
    playScannerSound('click');
    setIsDraftPoModalOpen(true);
  };

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={language === 'th' ? 'รายงานสินค้าที่ต้องสั่งเติมสต็อก (Restock Needed Report)' : 'Restock Needed Procurement Report'}
      description={
        language === 'th'
          ? `รายงานสรุปสินค้าที่หมดสต็อกหรือต่ำกว่าเกณฑ์เตือน (≤ ${lowStockThreshold} ชิ้น) พร้อมคำนวณจำนวนสั่งซื้อและงบประมาณจัดซื้อ`
          : `Comprehensive restock procurement report for items below threshold (≤ ${lowStockThreshold} units) with suggested quantities and capital estimation.`
      }
      maxWidth="2xl"
      footer={
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 w-full">
          <div className="flex items-center gap-2 text-xs text-text/60">
            <span>{language === 'th' ? 'เลือก:' : 'Selected:'}</span>
            <span className="font-mono tabular-nums font-black text-primary">
              {reportStats.selectedCount} / {reportStats.totalFlaggedCount} {language === 'th' ? 'รายการ' : 'items'}
            </span>
            <span className="mx-1 text-border">|</span>
            <span>{language === 'th' ? 'งบประมาณรวม:' : 'Total Cost:'}</span>
            <span className="font-mono tabular-nums font-black text-emerald-600 dark:text-emerald-400 text-sm">
              {formatMoney(reportStats.totalEstimatedCost)}
            </span>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handlePrintReport}
              leftIcon={<Printer className="h-4 w-4" />}
              className="text-xs cursor-pointer"
            >
              {language === 'th' ? 'พิมพ์ใบสั่งซื้อ' : 'Print Sheet'}
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleExportCsv}
              leftIcon={<Download className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
              className="text-xs font-bold cursor-pointer"
            >
              {language === 'th' ? 'ส่งออก CSV' : 'Export CSV'}
            </Button>

            <Button
              id="btn-bulk-generate-po-footer"
              type="button"
              variant="primary"
              size="sm"
              onClick={handleBulkGeneratePurchaseOrder}
              disabled={restockItems.length === 0}
              leftIcon={<FileText className="h-4 w-4 text-white" />}
              className="text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta shadow-xs cursor-pointer"
            >
              {language === 'th'
                ? `สร้างใบสั่งซื้อรวม (${itemsForDraftPo.length} รายการ)`
                : `Bulk Generate Purchase Order (${itemsForDraftPo.length})`}
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleExecuteBulkRestock}
              disabled={isExecutingRestock || reportStats.selectedCount === 0}
              isLoading={isExecutingRestock}
              leftIcon={<Check className="h-4 w-4 text-amber-500" />}
              className="text-xs font-bold border-amber-500/40 text-amber-900 dark:text-amber-200 hover:bg-amber-500/10 cursor-pointer"
            >
              {language === 'th'
                ? `รับเข้าคลังทันที (${reportStats.selectedCount})`
                : `Direct Replenish (${reportStats.selectedCount})`}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5 text-left">
        {/* 1. Executive Summary Metric Banner Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Card 1: Total Flagged Items */}
          <div className="p-3.5 rounded-2xl bg-card border border-border border-crisp shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-bold text-text/60 uppercase tracking-wider">
              <span>{language === 'th' ? 'สินค้าที่ต้องเติม' : 'Flagged Items'}</span>
              <div className="p-1 rounded-lg bg-amber-500/10 text-amber-500">
                <AlertTriangle className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-xl font-black font-mono tabular-nums tracking-tight text-amber-500 mt-1">
              {reportStats.totalFlaggedCount} <span className="text-xs font-sans font-medium text-brand-text-secondary">SKUs</span>
            </div>
            <div className="text-[10px] text-brand-text-secondary mt-0.5 flex items-center gap-1">
              <span>{language === 'th' ? `เกณฑ์เตือน: ≤ ${lowStockThreshold} ชิ้น` : `Threshold: ≤ ${lowStockThreshold}`}</span>
            </div>
          </div>

          {/* Card 2: Critical Out of Stock */}
          <div className="p-3.5 rounded-2xl bg-card border border-border border-crisp shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-bold text-text/60 uppercase tracking-wider">
              <span>{language === 'th' ? 'หมดสต็อกทันที' : 'Zero Stock'}</span>
              <div className="p-1 rounded-lg bg-rose-500/10 text-rose-500">
                <PackageX className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-xl font-black font-mono tabular-nums tracking-tight text-rose-500 mt-1">
              {reportStats.criticalOutOfStockCount} <span className="text-xs font-sans font-medium text-brand-text-secondary">items</span>
            </div>
            <div className="text-[10px] text-rose-600 dark:text-rose-400 font-semibold mt-0.5">
              {language === 'th' ? 'วิกฤติเสียโอกาสขาย' : 'Immediate risk'}
            </div>
          </div>

          {/* Card 3: Suggested Order Units */}
          <div className="p-3.5 rounded-2xl bg-card border border-border border-crisp shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-bold text-text/60 uppercase tracking-wider">
              <span>{language === 'th' ? 'จำนวนสั่งซื้อแนะนำ' : 'Target Units'}</span>
              <div className="p-1 rounded-lg bg-primary/10 text-primary">
                <Boxes className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-xl font-black font-mono tabular-nums tracking-tight text-primary mt-1">
              {reportStats.totalSuggestedUnits} <span className="text-xs font-sans font-medium text-brand-text-secondary">units</span>
            </div>
            <div className="text-[10px] text-brand-text-secondary mt-0.5">
              {language === 'th' ? 'คุ้มครอง 14 วัน' : '14-day safety buffer'}
            </div>
          </div>

          {/* Card 4: Estimated Procurement Cost */}
          <div className="p-3.5 rounded-2xl bg-card border border-border border-crisp shadow-2xs">
            <div className="flex items-center justify-between text-[11px] font-bold text-text/60 uppercase tracking-wider">
              <span>{language === 'th' ? 'งบประมาณสั่งซื้อ' : 'Capital Needed'}</span>
              <div className="p-1 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <DollarSign className="h-3.5 w-3.5" />
              </div>
            </div>
            <div className="text-lg font-black font-mono tabular-nums tracking-tight text-emerald-600 dark:text-emerald-400 mt-1 truncate">
              {formatMoney(reportStats.totalEstimatedCost)}
            </div>
            <div className="text-[10px] text-brand-text-secondary mt-0.5 truncate">
              {language === 'th' ? 'คำนวณจากราคาทุนส่ง' : 'Based on unit cost'}
            </div>
          </div>
        </div>

        {/* 2. Filter, Search & Config Toolbar */}
        <div className="p-3.5 rounded-2xl bg-muted/40 border border-border border-crisp flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 flex-wrap sm:flex-nowrap">
            <div className="flex-1 min-w-[180px]">
              <SearchInput
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onClear={() => setSearchQuery('')}
                placeholder={language === 'th' ? 'ค้นหาชื่อสินค้า, SKU หรือบาร์โค้ด...' : 'Search product, SKU, barcode...'}
              />
            </div>

            {/* Category Dropdown */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="h-9 px-3 rounded-xl border border-border bg-card text-xs font-medium text-text focus:outline-none focus:border-primary shrink-0"
            >
              <option value="all">{language === 'th' ? 'ทุกหมวดหมู่' : 'All Categories'}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>

            {/* Urgency Filter */}
            <select
              value={urgencyFilter}
              onChange={(e) => setUrgencyFilter(e.target.value as any)}
              className="h-9 px-3 rounded-xl border border-border bg-card text-xs font-medium text-text focus:outline-none focus:border-primary shrink-0"
            >
              <option value="all">{language === 'th' ? 'ทุกระดับความเร่งด่วน' : 'All Urgency Levels'}</option>
              <option value="critical">{language === 'th' ? 'หมดสต็อกทันที (0 ชิ้น)' : 'Critical (Out of Stock)'}</option>
              <option value="low_stock">{language === 'th' ? 'สต็อกต่ำ (≤ เกณฑ์เตือน)' : 'Low Stock Alert'}</option>
              <option value="velocity_risk">{language === 'th' ? 'ขายหมดไว (ADSV Risk)' : 'Velocity Risk'}</option>
            </select>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end md:self-auto flex-wrap sm:flex-nowrap">
            {/* Sort Select */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="h-9 px-2.5 rounded-xl border border-border bg-card text-xs font-medium text-text focus:outline-none focus:border-primary"
            >
              <option value="urgency">{language === 'th' ? 'เรียงตาม: ความเร่งด่วน' : 'Sort: Urgency'}</option>
              <option value="stock_asc">{language === 'th' ? 'เรียงตาม: สต็อกน้อยสุด' : 'Sort: Lowest Stock'}</option>
              <option value="deficit_desc">{language === 'th' ? 'เรียงตาม: จำนวนขาดมากสุด' : 'Sort: Highest Deficit'}</option>
              <option value="cost_desc">{language === 'th' ? 'เรียงตาม: มูลค่าจัดซื้อสูงสุด' : 'Sort: Highest Cost'}</option>
              <option value="name">{language === 'th' ? 'เรียงตาม: ชื่อสินค้า' : 'Sort: Name'}</option>
            </select>

            {/* Quick Threshold Trigger */}
            <button
              type="button"
              onClick={onOpenThresholdModal}
              className="h-9 px-3 rounded-xl bg-card hover:bg-muted border border-border border-crisp text-xs font-bold text-text/80 hover:text-text flex items-center gap-1.5 transition-colors cursor-pointer"
              title={language === 'th' ? 'ปรับเปลี่ยนเกณฑ์เตือนสต็อก' : 'Configure low stock alert threshold'}
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-amber-500" />
              <span>≤ {lowStockThreshold}</span>
            </button>

            {/* Primary Action Button in Toolbar */}
            <Button
              id="btn-bulk-generate-po-toolbar"
              type="button"
              variant="primary"
              size="sm"
              onClick={handleBulkGeneratePurchaseOrder}
              disabled={restockItems.length === 0}
              leftIcon={<FileText className="h-3.5 w-3.5" />}
              className="min-h-[44px] h-11 text-xs font-bold bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta"
            >
              {language === 'th' ? 'สร้างใบสั่งซื้อรวม' : 'Bulk Generate PO'}
            </Button>
          </div>
        </div>

        {/* 3. Itemized Restock Table */}
        <div className="rounded-2xl border border-border border-crisp overflow-hidden bg-card">
          <div className="overflow-x-auto max-h-96 no-scrollbar">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 bg-background/95 backdrop-blur-xs border-b border-border border-crisp z-10">
                <tr className="text-text/60 font-semibold">
                  <th className="py-3 px-4 w-10">
                    <input
                      type="checkbox"
                      checked={filteredItems.length > 0 && selectedProductIds.length === filteredItems.length}
                      onChange={() => {
                        if (selectedProductIds.length === filteredItems.length) {
                          setSelectedProductIds([]);
                        } else {
                          setSelectedProductIds(filteredItems.map((i) => i.product.id));
                        }
                      }}
                      className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                    />
                  </th>
                  <th className="py-3 px-3">{language === 'th' ? 'สินค้า / รหัส SKU' : 'Product & SKU'}</th>
                  <th className="py-3 px-3 text-center">{language === 'th' ? 'สถานะความเร่งด่วน' : 'Urgency Status'}</th>
                  <th className="py-3 px-3 text-center">{language === 'th' ? 'คงเหลือ' : 'Current Stock'}</th>
                  <th className="py-3 px-3 text-center">{language === 'th' ? 'ยอดขาย/วัน (ADSV)' : 'Daily Velocity'}</th>
                  <th className="py-3 px-3 text-right">{language === 'th' ? 'ราคาทุนส่ง' : 'Unit Cost'}</th>
                  <th className="py-3 px-4 text-center w-40">{language === 'th' ? 'จำนวนสั่งซื้อแนะนำ' : 'Suggested Order'}</th>
                  <th className="py-3 px-4 text-right">{language === 'th' ? 'งบจัดซื้อรวม' : 'Line Total'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-brand-text-secondary">
                      <div className="flex flex-col items-center justify-center space-y-2">
                        <PackageCheck className="h-8 w-8 text-emerald-500/60" />
                        <div className="font-bold text-text">
                          {language === 'th' ? 'ไม่พบรายการที่ต้องสั่งเติมตามเงื่อนไข' : 'No items match restock criteria'}
                        </div>
                        <p className="text-[11px] text-brand-text-secondary">
                          {language === 'th'
                            ? `ระดับสินค้าทุกรายการสูงกว่าเกณฑ์ที่กำหนด (≤ ${lowStockThreshold} ชิ้น)`
                            : 'All item inventory levels are above active alert thresholds.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => {
                    const isSelected = selectedProductIds.includes(item.product.id);
                    const currency = session?.currentStore.currency || 'THB';

                    return (
                      <tr
                        key={item.product.id}
                        className={`hover:bg-muted/50 transition-colors ${
                          isSelected ? 'bg-amber-500/5 dark:bg-amber-500/2' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setSelectedProductIds((prev) =>
                                prev.includes(item.product.id)
                                  ? prev.filter((id) => id !== item.product.id)
                                  : [...prev, item.product.id]
                              );
                            }}
                            className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                          />
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-bold text-text">{item.product.name}</div>
                          <div className="text-[10px] text-brand-text-secondary font-mono tabular-nums flex items-center gap-2 mt-0.5">
                            <span>SKU: {item.product.sku}</span>
                            <span>•</span>
                            <span className="text-primary font-medium">{item.categoryName}</span>
                          </div>
                        </td>

                        <td className="py-3 px-3 text-center">
                          {item.urgency === 'critical' ? (
                            <Badge variant="danger" size="sm" dot>
                              {language === 'th' ? 'หมดสต็อก (0)' : 'Out of Stock'}
                            </Badge>
                          ) : item.urgency === 'velocity_risk' ? (
                            <Badge variant="warning" size="sm" dot>
                              {language === 'th' ? 'ขายหมดไว' : 'Velocity Alert'}
                            </Badge>
                          ) : (
                            <Badge variant="warning" size="sm" dot>
                              {language === 'th' ? `สต็อกต่ำ (≤${lowStockThreshold})` : 'Low Stock'}
                            </Badge>
                          )}
                        </td>

                        <td className="py-3 px-3 text-center font-mono tabular-nums">
                          <span
                            className={`font-black text-xs ${
                              item.product.currentStock <= 0
                                ? 'text-rose-500'
                                : item.product.currentStock <= lowStockThreshold
                                ? 'text-amber-500'
                                : 'text-text'
                            }`}
                          >
                            {item.product.currentStock} {item.product.unitOfMeasure}
                          </span>
                        </td>

                        <td className="py-3 px-3 text-center font-mono tabular-nums text-[11px] text-text/70">
                          {item.vInfo.adsv} / {language === 'th' ? 'วัน' : 'day'}
                        </td>

                        <td className="py-3 px-3 text-right font-mono tabular-nums text-text/80 text-[11px]">
                          {formatMoney(createMoney(item.unitCostCents, currency))}
                        </td>

                        <td className="py-3 px-4 text-center">
                          <div className="inline-flex items-center gap-1 bg-background border border-border border-crisp rounded-xl p-0.5 h-8">
                            <button
                              type="button"
                              onClick={() => handleQuantityChange(item.product.id, item.activeQty - 5)}
                              className="px-2 h-full text-text/60 hover:text-text hover:bg-muted rounded-lg font-black text-xs cursor-pointer"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              inputMode="numeric"
                              min="0"
                              value={item.activeQty}
                              onChange={(e) => {
                                const val = parseInt(e.target.value, 10);
                                handleQuantityChange(item.product.id, isNaN(val) ? 0 : val);
                              }}
                              className="w-12 text-center font-mono tabular-nums font-black text-xs text-primary bg-transparent border-none p-0 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleQuantityChange(item.product.id, item.activeQty + 5)}
                              className="px-2 h-full text-text/60 hover:text-text hover:bg-muted rounded-lg font-black text-xs cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </td>

                        <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-xs text-emerald-600 dark:text-emerald-400">
                          {formatMoney(createMoney(item.totalLineCostCents, currency))}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>

    {/* Dedicated Draft Purchase Order Review Modal */}
    <DraftPurchaseOrderModal
      isOpen={isDraftPoModalOpen}
      onClose={() => setIsDraftPoModalOpen(false)}
      initialItems={itemsForDraftPo}
      availableProducts={products}
      categories={categories}
      lowStockThreshold={lowStockThreshold}
      onPoSubmittedOrReceived={() => {
        if (onRestockCompleted) {
          onRestockCompleted();
        }
      }}
    />
    </>
  );
};
