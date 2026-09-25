import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { useBreadcrumb, BreadcrumbLevel } from '../../context/BreadcrumbContext';
import { createCatalogApi } from '../../adapters/productionCatalogApiFactory';
import { Product, InventoryLedgerEntry, StockMovementReason, Category } from '../../domain/catalog';
import { formatMoney, createMoney } from '../../domain/money';
import { Card, CardHeader, CardBody } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { SearchInput } from '../../components/common/SearchInput';
import { Tabs } from '../../components/common/Tabs';
import {
  Boxes,
  PlusCircle,
  AlertTriangle,
  History,
  LayoutGrid,
  List,
  CheckCircle2,
  XCircle,
  DollarSign,
  Layers,
  ArrowDownRight,
  ArrowUpRight,
  TrendingUp,
  SlidersHorizontal,
  Tag,
  PackageCheck,
  PackageX,
  Package,
  QrCode,
  Barcode,
  Printer,
  Sparkles,
  RefreshCw,
  UploadCloud,
  FileSpreadsheet,
  ClipboardList,
} from 'lucide-react';
import { ShelfLabelPrintModal } from '../../components/inventory/ShelfLabelPrintModal';
import { BulkInventoryUploadModal } from '../../components/inventory/BulkInventoryUploadModal';
import { LowStockThresholdModal } from '../../components/inventory/LowStockThresholdModal';
import { InventoryAiOptimizationModal } from './InventoryAiOptimizationModal';
import { InventoryBarcodeLookupModal } from './InventoryBarcodeLookupModal';
import { RestockNeededReportModal } from './RestockNeededReportModal';
import { BulkImportResult } from '../../domain/catalog';
import { generateInventoryCsv, downloadCsvFile } from '../../utils/csvExport';
import { useBarcodeScanner } from '../../hooks/useBarcodeScanner';
import { playScannerSound } from '../../services/soundService';

export const InventoryScreen: React.FC = () => {
  const { session, can } = useAuth();
  const catalogApi = session ? createCatalogApi(session.token) : null;
  const { addToast } = useToast();
  const { t, language } = useLanguage();
  const { setSubLevels } = useBreadcrumb();

  const [products, setProducts] = useState<Product[]>([]);
  const adjustmentOperationKeyRef = useRef<string | null>(null);
  const [categories, setCategories] = useState<readonly Category[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<readonly InventoryLedgerEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedStockFilter, setSelectedStockFilter] = useState<'all' | 'in_stock' | 'low_stock' | 'out_of_stock' | 'velocity_risk'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [activeTab, setActiveTab] = useState<'catalog' | 'ledger' | 'restock'>('catalog');
  const [isShelfLabelModalOpen, setIsShelfLabelModalOpen] = useState(false);
  const [isBulkUploadModalOpen, setIsBulkUploadModalOpen] = useState(false);
  const [isAiOptimizationModalOpen, setIsAiOptimizationModalOpen] = useState(false);
  const [isBarcodeLookupModalOpen, setIsBarcodeLookupModalOpen] = useState(false);
  const [isRestockReportModalOpen, setIsRestockReportModalOpen] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string>('');
  const [scannedProduct, setScannedProduct] = useState<Product | null>(null);
  const [isScannerEnabled, setIsScannerEnabled] = useState<boolean>(true);

  // Centralized Barcode Scanner Lookup Handler for Inventory
  const handleInventoryBarcodeScan = (barcode: string) => {
    const cleanCode = barcode.trim();
    if (!cleanCode) return;

    setLastScannedBarcode(cleanCode);

    // Look for matching product by barcode or SKU
    const found = products.find(
      (p) =>
        p.barcode.toLowerCase() === cleanCode.toLowerCase() ||
        p.sku.toLowerCase() === cleanCode.toLowerCase()
    );

    if (found) {
      playScannerSound('success');
      setScannedProduct(found);
      setIsBarcodeLookupModalOpen(true);
      addToast({
        title: language === 'th' ? 'สแกนตรวจสอบสต็อกสำเร็จ' : 'Inventory Barcode Scanned',
        message: `${found.name} (คงเหลือ: ${found.currentStock} ${found.unitOfMeasure})`,
        type: 'info',
      });
    } else {
      playScannerSound('error');
      setScannedProduct(null);
      setIsBarcodeLookupModalOpen(true);
      addToast({
        title: language === 'th' ? 'ไม่พบบาร์โค้ดในระบบคลัง' : 'Barcode Not in Inventory',
        message: language === 'th' ? `ไม่พบสินค้าตรงกับบาร์โค้ด "${cleanCode}"` : `No item matching barcode "${cleanCode}"`,
        type: 'warning',
      });
    }
  };

  // Synchronize Inventory navigation depth with global breadcrumbs
  useEffect(() => {
    const levels: BreadcrumbLevel[] = [];

    let tabLabel = { th: 'รายการสินค้า', en: 'Catalog' };
    if (activeTab === 'ledger') {
      tabLabel = { th: 'ประวัติความเคลื่อนไหว', en: 'Stock Ledger' };
    } else if (activeTab === 'restock') {
      tabLabel = { th: 'เติมสต็อกสมาร์ท', en: 'Smart Restock' };
    }

    levels.push({
      id: 'inv-tab',
      label: tabLabel,
      onClick: () => {
        setActiveTab('catalog');
        setSelectedCategory('all');
        setSelectedStockFilter('all');
        setSearchQuery('');
      },
    });

    if (searchQuery.trim()) {
      levels.push({
        id: 'inv-search',
        label: { th: `ค้นหา: "${searchQuery}"`, en: `Search: "${searchQuery}"` },
        onClick: () => setSearchQuery(''),
      });
    } else if (selectedCategory !== 'all') {
      const catObj = categories.find((c) => c.id === selectedCategory);
      if (catObj) {
        levels.push({
          id: 'inv-cat',
          label: catObj.name,
          onClick: () => setSelectedCategory('all'),
        });
      }
    } else if (selectedStockFilter !== 'all') {
      let filterName = { th: 'กรองสถานะสต็อก', en: 'Stock Filter' };
      if (selectedStockFilter === 'low_stock') filterName = { th: 'เตือนสินค้าใกล้หมด', en: 'Low Stock Alerts' };
      if (selectedStockFilter === 'out_of_stock') filterName = { th: 'สินค้าหมดคลัง', en: 'Out of Stock' };
      if (selectedStockFilter === 'in_stock') filterName = { th: 'พร้อมขาย', en: 'In Stock' };
      if (selectedStockFilter === 'velocity_risk') filterName = { th: 'เสี่ยงขายหมดไว', en: 'Velocity Risk' };

      levels.push({
        id: 'inv-filter',
        label: filterName,
        onClick: () => setSelectedStockFilter('all'),
      });
    }

    setSubLevels(levels);
  }, [activeTab, selectedCategory, selectedStockFilter, searchQuery, categories, setSubLevels]);

  const handleBulkImportComplete = async (result: BulkImportResult) => {
    if (session) {
      const [freshProducts, freshCategories, freshLedger] = await Promise.all([
        catalogApi!.getProducts(session.currentStore.id),
        catalogApi!.getCategories(session.currentStore.id),
        catalogApi!.getInventoryLedger(session.currentStore.id),
      ]);
      setProducts([...freshProducts]);
      setCategories([...freshCategories]);
      setLedgerEntries([...freshLedger]);
    }
  };

  // Smart Restock States
  const [selectedRestockIds, setSelectedRestockIds] = useState<string[]>([]);
  const [restockQuantities, setRestockQuantities] = useState<Record<string, number>>({});
  const [isSubmittingRestock, setIsSubmittingRestock] = useState<boolean>(false);

  const [lowStockThreshold, setLowStockThreshold] = useState<number>(() => {
    const cached = localStorage.getItem('prodx_low_stock_threshold');
    return cached ? parseInt(cached, 10) : 15;
  });

  const [isHighlightLowStockActive, setIsHighlightLowStockActive] = useState<boolean>(() => {
    const cached = localStorage.getItem('prodx_highlight_low_stock');
    return cached !== null ? cached === 'true' : true;
  });

  const [isThresholdModalOpen, setIsThresholdModalOpen] = useState<boolean>(false);

  const handleThresholdChange = (val: number) => {
    const clamped = Math.max(0, val);
    setLowStockThreshold(clamped);
    localStorage.setItem('prodx_low_stock_threshold', clamped.toString());
    addToast({
      title: language === 'th' ? 'ปรับเกณฑ์แจ้งเตือนสต็อกต่ำแล้ว' : 'Low Stock Threshold Updated',
      message:
        language === 'th'
          ? `อัปเดตเกณฑ์แจ้งเตือนสต็อกต่ำเป็น ≤ ${clamped} ชิ้นแล้ว`
          : `Updated low stock alert threshold to ≤ ${clamped} units`,
      type: 'info',
    });
  };

  const handleToggleHighlightLowStock = () => {
    const next = !isHighlightLowStockActive;
    setIsHighlightLowStockActive(next);
    localStorage.setItem('prodx_highlight_low_stock', String(next));
    addToast({
      title: language === 'th' ? 'การแจ้งเตือนสต็อกต่ำ' : 'Low Stock Highlighting',
      message: next
        ? (language === 'th' ? 'เปิดการไฮไลต์และป้ายเตือนสต็อกต่ำแล้ว' : 'Low stock warning badges enabled')
        : (language === 'th' ? 'ปิดการไฮไลต์และป้ายเตือนสต็อกต่ำแล้ว' : 'Low stock warning badges disabled'),
      type: 'info',
    });
  };

  // Stock Adjustment State
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [adjustQuantity, setAdjustQuantity] = useState<number>(10);
  const [adjustReason, setAdjustReason] = useState<StockMovementReason>('purchase_received');
  const [adjustNotes, setAdjustNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Bulk Edit States & Handlers
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [isBulkAdjustModalOpen, setIsBulkAdjustModalOpen] = useState(false);
  const [isBulkPricingModalOpen, setIsBulkPricingModalOpen] = useState(false);
  const [bulkPricingStep, setBulkPricingStep] = useState<'configure' | 'summary'>('configure');
  const [bulkQuantityDelta, setBulkQuantityDelta] = useState<number>(10);
  const [bulkAdjustReason, setBulkAdjustReason] = useState<StockMovementReason>('purchase_received');
  const [bulkAdjustNotes, setBulkAdjustNotes] = useState('');
  const [bulkPriceChangeType, setBulkPriceChangeType] = useState<'set_amount' | 'percent_markup' | 'percent_discount'>('percent_markup');
  const [bulkPriceValue, setBulkPriceValue] = useState<number>(10);

  const affectedProductsForPricing = React.useMemo(() => {
    return selectedProductIds
      .map((id) => products.find((p) => p.id === id))
      .filter(Boolean) as Product[];
  }, [selectedProductIds, products]);

  const pricingSummaryReport = React.useMemo(() => {
    let totalOldCents = 0;
    let totalNewCents = 0;
    let totalPercentageShift = 0;

    const itemResults = affectedProductsForPricing.map((prod) => {
      const oldCents = prod.price.amountInCents;
      totalOldCents += oldCents;

      let newCents = oldCents;
      if (bulkPriceChangeType === 'set_amount') {
        newCents = Math.round(bulkPriceValue * 100);
      } else if (bulkPriceChangeType === 'percent_markup') {
        newCents = Math.round(oldCents * (1 + bulkPriceValue / 100));
      } else if (bulkPriceChangeType === 'percent_discount') {
        newCents = Math.round(oldCents * (1 - bulkPriceValue / 100));
      }
      newCents = Math.max(0, newCents);
      totalNewCents += newCents;

      const deltaCents = newCents - oldCents;
      const pctShift = oldCents > 0 ? (deltaCents / oldCents) * 100 : 0;
      totalPercentageShift += pctShift;

      return {
        product: prod,
        oldCents,
        newCents,
        deltaCents,
        pctShift,
      };
    });

    const count = affectedProductsForPricing.length;
    const avgPctShift = count > 0 ? totalPercentageShift / count : 0;
    const avgDeltaCents = count > 0 ? Math.round((totalNewCents - totalOldCents) / count) : 0;
    const currency = affectedProductsForPricing[0]?.price.currency || 'THB';

    return {
      count,
      totalOldCents,
      totalNewCents,
      totalDeltaCents: totalNewCents - totalOldCents,
      avgPctShift,
      avgDeltaCents,
      currency,
      itemResults,
    };
  }, [affectedProductsForPricing, bulkPriceChangeType, bulkPriceValue]);

  // Hardware Scanner Hook for Inventory Screen
  const { isScanning: isHardwareScanning, simulateScan: simulateInventoryScan } = useBarcodeScanner({
    enabled: isScannerEnabled && !isAdjustModalOpen && !isBulkAdjustModalOpen && !isBulkUploadModalOpen && !isShelfLabelModalOpen,
    onScan: (barcode) => {
      handleInventoryBarcodeScan(barcode);
    },
  });

  const handleToggleSelectAll = () => {
    if (selectedProductIds.length === filteredProducts.length) {
      setSelectedProductIds([]);
    } else {
      setSelectedProductIds(filteredProducts.map((p) => p.id));
    }
  };

  const handleConfirmBulkAdjustment = async () => {
    if (!session || selectedProductIds.length === 0) return;
    setIsSubmitting(true);
    adjustmentOperationKeyRef.current ??= crypto.randomUUID();
    try {
      const entries = await catalogApi!.bulkAdjustStock(
        session.currentStore.id,
        selectedProductIds,
        bulkQuantityDelta,
        bulkAdjustReason,
        session.currentUser.id,
        bulkAdjustNotes,
        adjustmentOperationKeyRef.current
      );

      setProducts((prev) =>
        prev.map((p) => {
          const entry = entries.find((e) => e.productId === p.id);
          return entry ? { ...p, currentStock: entry.resultingStock } : p;
        })
      );
      setLedgerEntries((prev) => [...entries, ...prev]);

      addToast({
        title: language === 'th' ? 'ปรับปรุงสต็อกแบบกลุ่มสำเร็จ' : 'Bulk Stock Updated',
        message: language === 'th'
          ? `อัปเดตสำเร็จ ${selectedProductIds.length} รายการ`
          : `Successfully updated stock for ${selectedProductIds.length} items.`,
        type: 'success',
      });
      setIsBulkAdjustModalOpen(false);
      setSelectedProductIds([]);
      adjustmentOperationKeyRef.current = null;
    } catch (err: any) {
      addToast({
        title: language === 'th' ? 'ปรับปรุงสต็อกไม่สำเร็จ' : 'Bulk Adjustment Failed',
        message: err?.message || 'Unable to complete bulk adjustment.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmBulkPricing = async () => {
    if (!session || selectedProductIds.length === 0) return;
    setIsSubmitting(true);
    try {
      const updatedProds = await catalogApi!.bulkUpdatePricing(
        session.currentStore.id,
        selectedProductIds,
        bulkPriceChangeType,
        bulkPriceValue,
        session.currentUser.id
      );

      setProducts((prev) =>
        prev.map((p) => {
          const updated = updatedProds.find((u) => u.id === p.id);
          return updated ? updated : p;
        })
      );

      addToast({
        title: language === 'th' ? 'ปรับราคาแบบกลุ่มสำเร็จ' : 'Bulk Pricing Updated',
        message: language === 'th'
          ? `อัปเดตราคาสำเร็จ ${selectedProductIds.length} รายการ`
          : `Successfully updated pricing for ${selectedProductIds.length} items.`,
        type: 'success',
      });
      setIsBulkPricingModalOpen(false);
      setBulkPricingStep('configure');
      setSelectedProductIds([]);
    } catch (err: any) {
      addToast({
        title: language === 'th' ? 'ปรับราคาไม่สำเร็จ' : 'Bulk Pricing Failed',
        message: err?.message || 'Unable to update bulk pricing.',
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const reloadInventoryData = React.useCallback(async () => {
    if (!session) return;
    try {
      const [prods, cats, ledger] = await Promise.all([
        catalogApi!.getProducts(session.currentStore.id),
        catalogApi!.getCategories(session.currentStore.id),
        catalogApi!.getInventoryLedger(session.currentStore.id),
      ]);
      setProducts([...prods]);
      setCategories(cats);
      setLedgerEntries(ledger);
    } catch (err) {
      console.error('[InventoryScreen] Error:', err);
    }
  }, [session]);

  useEffect(() => {
    reloadInventoryData();

    const handleInventoryEvent = () => {
      reloadInventoryData();
    };

    window.addEventListener('prodx:inventory-updated', handleInventoryEvent);
    window.addEventListener('prodx:order-completed', handleInventoryEvent);
    return () => {
      window.removeEventListener('prodx:inventory-updated', handleInventoryEvent);
      window.removeEventListener('prodx:order-completed', handleInventoryEvent);
    };
  }, [session, reloadInventoryData]);

  // Inventory KPI Metrics
  const inventoryMetrics = React.useMemo(() => {
    const totalSKUs = products.length;
    const inStockCount = products.filter((p) => p.currentStock > lowStockThreshold).length;
    const lowStockCount = products.filter((p) => p.currentStock <= lowStockThreshold && p.currentStock > 0).length;
    const outOfStockCount = products.filter((p) => p.currentStock <= 0).length;

    let totalRetailValueCents = 0;
    let totalCostValueCents = 0;
    const currency = session?.currentStore.currency || 'THB';

    for (const p of products) {
      if (p.currentStock > 0) {
        totalRetailValueCents += p.price.amountInCents * p.currentStock;
        totalCostValueCents += p.costPrice.amountInCents * p.currentStock;
      }
    }

    return {
      totalSKUs,
      inStockCount,
      lowStockCount,
      outOfStockCount,
      totalRetailValue: createMoney(totalRetailValueCents, currency),
      totalCostValue: createMoney(totalCostValueCents, currency),
    };
  }, [products, session, lowStockThreshold]);

  // Average Daily Sales Velocity & Stockout Risk Forecasting
  const productVelocityMap = React.useMemo(() => {
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

  const velocityRiskCount = React.useMemo(() => {
    let count = 0;
    for (const [_, info] of productVelocityMap.entries()) {
      if (info.riskLevel === 'critical' || info.riskLevel === 'high') {
        count++;
      }
    }
    return count;
  }, [productVelocityMap]);

  // Smart Restock Suggestions & Recommendations Memo
  const restockSuggestions = React.useMemo(() => {
    return products
      .map((p) => {
        const vInfo = productVelocityMap.get(p.id) || { adsv: 0, daysRemaining: 999, totalSold: 0, riskLevel: 'healthy' };
        
        // Product needs reordering if:
        // 1. Stock falls below or is equal to the custom user lowStockThreshold
        // 2. Product is completely out of stock
        // 3. Predicted stockout velocity risk is critical or high
        const isNearOrBelowSafety = p.currentStock <= lowStockThreshold;
        const isOutOfStock = p.currentStock <= 0;
        const isVelocityAlert = vInfo.riskLevel === 'critical' || vInfo.riskLevel === 'high';
        
        const needsRestock = isNearOrBelowSafety || isOutOfStock || isVelocityAlert;
        
        // Smart recommendation formula: target enough stock to cover sales for the next 14 days,
        // using the calculated Average Daily Sales Velocity (ADSV), with a safe floor of 15 units.
        const targetDays = 14;
        const currentInv = Math.max(0, p.currentStock);
        const forecastNeeds = Math.ceil(vInfo.adsv * targetDays);
        const smartRecommendedQty = Math.max(15, forecastNeeds - currentInv);

        return {
          product: p,
          vInfo,
          needsRestock,
          smartRecommendedQty,
          isNearOrBelowSafety,
          isOutOfStock,
          isVelocityAlert,
        };
      })
      .filter((item) => item.needsRestock);
  }, [products, productVelocityMap, lowStockThreshold]);

  const handleExecuteRestock = async () => {
    if (!session || selectedRestockIds.length === 0) return;
    setIsSubmittingRestock(true);
    try {
      const updatedProductsList = [...products];
      const newLedgerEntries = [...ledgerEntries];

      for (const id of selectedRestockIds) {
        const item = restockSuggestions.find((s) => s.product.id === id);
        if (!item) continue;

        const qty = restockQuantities[id] !== undefined ? restockQuantities[id] : item.smartRecommendedQty;
        if (qty <= 0) continue;

        // Perform stock adjustment
        const updated = await catalogApi!.adjustStock(
          session.currentStore.id,
          id,
          qty,
          'purchase_received',
          session.currentUser.id,
          language === 'th' ? 'การแนะนำสั่งสินค้าคงคลังอัจฉริยะ (Smart Restock)' : 'Executed smart restock replenishment'
        );

        // Update local list
        const pIdx = updatedProductsList.findIndex((p) => p.id === id);
        if (pIdx !== -1) {
          updatedProductsList[pIdx] = {
            ...updatedProductsList[pIdx],
            currentStock: updatedProductsList[pIdx].currentStock + qty,
          };
        }

        // Add to historical ledger logs
        newLedgerEntries.unshift({
          id: `led-restock-${Date.now()}-${id}`,
          storeId: session.currentStore.id,
          productId: id,
          quantityDelta: qty,
          resultingStock: updatedProductsList[pIdx]?.currentStock || qty,
          reason: 'purchase_received',
          referenceId: `RST-${Date.now().toString().slice(-6)}`,
          timestamp: new Date().toISOString(),
          performedByUserId: session.currentUser.id,
          notes: language === 'th' ? 'นำเข้าจากระบบสั่งซื้ออัจฉริยะ' : 'Smart Restock replenishment execution',
        });
      }

      setProducts(updatedProductsList);
      setLedgerEntries(newLedgerEntries);

      addToast({
        title: language === 'th' ? 'เติมสินค้าคงคลังสำเร็จ' : 'Replenished Successfully',
        message: language === 'th'
          ? `อัปเดตและรับสินค้าเข้าคลังสำเร็จ ${selectedRestockIds.length} รายการ`
          : `Successfully executed smart restock and updated balances for ${selectedRestockIds.length} items.`,
        type: 'success',
      });

      setSelectedRestockIds([]);
      setRestockQuantities({});
      setActiveTab('catalog');
    } catch (err: any) {
      addToast({
        title: language === 'th' ? 'การแนะนำสั่งสินค้าล้มเหลว' : 'Restock Failed',
        message: err?.message || 'Failed to complete Smart Restock process.',
        type: 'error',
      });
    } finally {
      setIsSubmittingRestock(false);
    }
  };

  const handleOpenAdjust = (prod: Product) => {
    if (!can('inventory:adjust')) {
      addToast({
        title: language === 'th' ? 'ไม่มีสิทธิ์ในการดำเนินการ' : 'Permission Denied',
        message:
          language === 'th'
            ? 'ต้องมีสิทธิ์ "inventory:adjust" เพื่อปรับปรุงสต็อกสินค้า'
            : 'Role requires "inventory:adjust" permission to modify stock.',
        type: 'warning',
      });
      return;
    }
    setSelectedProduct(prod);
    setAdjustQuantity(5);
    setAdjustReason('purchase_received');
    setAdjustNotes('');
    setIsAdjustModalOpen(true);
  };

  const handleConfirmAdjustment = async () => {
    if (!selectedProduct || !session) return;
    setIsSubmitting(true);
    try {
      const entry = await catalogApi!.adjustStock(
        session.currentStore.id,
        selectedProduct.id,
        adjustQuantity,
        adjustReason,
        session.currentUser.id,
        adjustNotes
      );

      // Update local state
      setProducts((prev) =>
        prev.map((p) =>
          p.id === selectedProduct.id ? { ...p, currentStock: entry.resultingStock } : p
        )
      );
      setLedgerEntries((prev) => [entry, ...prev]);

      addToast({
        title: language === 'th' ? 'บันทึกการปรับปรุงสต็อกสำเร็จ' : 'Stock Movement Recorded',
        message: `${selectedProduct.name}: ${adjustQuantity >= 0 ? `+${adjustQuantity}` : adjustQuantity}`,
        type: 'success',
      });
      setIsAdjustModalOpen(false);
    } catch (err: any) {
      addToast({
        title: language === 'th' ? 'ปรับปรุงสต็อกไม่สำเร็จ' : 'Stock Adjustment Failed',
        message: err?.message || (language === 'th' ? 'ไม่สามารถอัปเดตสต็อกได้' : 'Unable to update inventory ledger.'),
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExportInventoryCsv = () => {
    const csvContent = generateInventoryCsv(products, categories);
    const dateStr = new Date().toISOString().split('T')[0];
    downloadCsvFile(`PRODX_Inventory_Export_${dateStr}`, csvContent);
    addToast({
      title: language === 'th' ? 'ส่งออกสต็อกสินค้าสำเร็จ' : 'Inventory Exported',
      message:
        language === 'th'
          ? `ส่งออกข้อมูลสินค้า ${products.length} รายการเป็นไฟล์ CSV เรียบร้อยแล้ว`
          : `Exported ${products.length} inventory items to CSV file.`,
      type: 'success',
    });
  };

  const filteredProducts = products.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      p.barcode.includes(q);

    const matchesCategory =
      selectedCategory === 'all' || p.categoryId === selectedCategory;

    let matchesStock = true;
    const velocityInfo = productVelocityMap.get(p.id);
    if (selectedStockFilter === 'in_stock') {
      matchesStock = p.currentStock > lowStockThreshold;
    } else if (selectedStockFilter === 'low_stock') {
      matchesStock = p.currentStock <= lowStockThreshold && p.currentStock > 0;
    } else if (selectedStockFilter === 'out_of_stock') {
      matchesStock = p.currentStock <= 0;
    } else if (selectedStockFilter === 'velocity_risk') {
      matchesStock = Boolean(velocityInfo && (velocityInfo.riskLevel === 'critical' || velocityInfo.riskLevel === 'high'));
    }

    return matchesSearch && matchesCategory && matchesStock;
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 bg-background text-text no-scrollbar">
      {/* 1. Header & Navigation Tabs */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between pb-4 sm:pb-6 border-b border-border/50">
        <div className="min-w-0 flex-1">
          <h1 className="text-heading-1 text-text">
            {t.inventory.title}
          </h1>
          <p className="text-caption text-text/70 mt-0.5">
            {t.inventory.subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 shrink-0">
          <Button
            id="btn-restock-needed-report-trigger"
            variant="secondary"
            size="sm"
            onClick={() => setIsRestockReportModalOpen(true)}
            leftIcon={<ClipboardList className="h-4 w-4 text-amber-500" />}
            className={`font-bold relative cursor-pointer ${
              inventoryMetrics.lowStockCount + inventoryMetrics.outOfStockCount > 0
                ? 'border-amber-400 bg-amber-500/10 text-amber-900 dark:text-amber-200 hover:bg-amber-500/20'
                : ''
            }`}
          >
            <span>{language === 'th' ? 'รายงานสินค้าต้องสั่งเติม' : 'Restock Needed Report'}</span>
            {inventoryMetrics.lowStockCount + inventoryMetrics.outOfStockCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] font-mono font-black bg-amber-500 text-white shadow-2xs">
                {inventoryMetrics.lowStockCount + inventoryMetrics.outOfStockCount}
              </span>
            )}
          </Button>

          <Button
            id="btn-inventory-ai-optimization-trigger"
            variant="primary"
            size="sm"
            onClick={() => setIsAiOptimizationModalOpen(true)}
            leftIcon={<Sparkles className="h-4 w-4 text-yellow-300 animate-pulse" />}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
          >
            {language === 'th' ? 'KKU AI วางแผนสต็อก' : 'AI Stock Optimizer'}
          </Button>

          <Button
            id="btn-export-inventory-csv"
            variant="secondary"
            size="sm"
            onClick={handleExportInventoryCsv}
            leftIcon={<FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
          >
            {language === 'th' ? 'ส่งออก CSV' : 'Export CSV'}
          </Button>

          <Button
            id="btn-bulk-upload-modal-trigger"
            variant="secondary"
            size="sm"
            onClick={() => setIsBulkUploadModalOpen(true)}
            leftIcon={<UploadCloud className="h-4 w-4 text-primary" />}
          >
            {language === 'th' ? 'นำเข้า/อัปเดตสต็อก (Bulk CSV)' : 'Bulk Import (CSV)'}
          </Button>

          <Button
            id="btn-shelf-label-modal-trigger"
            variant="secondary"
            size="sm"
            onClick={() => setIsShelfLabelModalOpen(true)}
            leftIcon={<QrCode className="h-4 w-4 text-primary" />}
          >
            {language === 'th' ? 'พิมพ์ป้าย QR ชั้นวาง' : 'Shelf QR Tags'}
          </Button>

          <Tabs
            tabs={[
              {
                id: 'catalog',
                label: language === 'th' ? 'แคตตาล็อกสินค้า' : 'Stock Catalog',
                icon: <Boxes className="h-4 w-4" />,
              },
              {
                id: 'ledger',
                label: language === 'th' ? 'ประวัติความเคลื่อนไหว' : 'Audit Ledger',
                icon: <History className="h-4 w-4" />,
              },
              {
                id: 'restock',
                label: language === 'th' ? 'แนะนำสั่งสินค้าอัจฉริยะ' : 'Smart Restock',
                icon: <Sparkles className="h-4 w-4 text-amber-500 animate-pulse" />,
              },
            ]}
            activeTab={activeTab}
            onChange={(tab) => setActiveTab(tab as 'catalog' | 'ledger' | 'restock')}
          />
        </div>
      </div>

      {/* 2. Responsive Inventory KPI Grid (1-col on mobile, 2-col on sm, 3-col on md, 5-col on lg/xl/2xl) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {/* Metric 1: Total SKUs */}
        <div className="p-4 rounded-2xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{language === 'th' ? 'รายการสินค้าทั้งหมด' : 'Total Catalog'}</span>
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Layers className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tracking-tight text-text">
            {inventoryMetrics.totalSKUs} <span className="text-xs font-sans font-medium text-text/60">SKUs</span>
          </div>
          <div className="mt-2 text-[11px] text-text/60">
            {language === 'th' ? 'ควบคุมสต็อกทุกสาขา' : 'Active active variants'}
          </div>
        </div>

        {/* Metric 2: In-Stock Good Standing */}
        <div className="p-4 rounded-2xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{language === 'th' ? 'สินค้าพร้อมขาย' : 'In Stock'}</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <PackageCheck className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tracking-tight text-emerald-600 dark:text-emerald-400">
            {inventoryMetrics.inStockCount}
          </div>
          <div className="mt-2 text-[11px] text-text/60">
            {language === 'th' ? 'ระดับสต็อกปกติ' : 'Above reorder threshold'}
          </div>
        </div>

        {/* Metric 3: Low Stock Warning */}
        <div
          id="inventory-kpi-low-stock"
          onClick={() => setSelectedStockFilter(selectedStockFilter === 'low_stock' ? 'all' : 'low_stock')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer shadow-2xs flex flex-col justify-between group ${
            selectedStockFilter === 'low_stock'
              ? 'border-amber-500 bg-amber-500/10 ring-2 ring-amber-400/40'
              : 'border-border border-crisp bg-card hover:border-amber-400/60'
          }`}
          title={language === 'th' ? 'คลิกเพื่อกรองเฉพาะสินค้าสต็อกต่ำ' : 'Click to filter low stock items'}
        >
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span className="group-hover:text-amber-600 dark:group-hover:text-amber-400 transition-colors font-bold">
              {t.inventory.lowStock}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsThresholdModalOpen(true);
                }}
                className="p-1 rounded-lg text-text/40 hover:text-amber-600 hover:bg-amber-500/10 transition-colors cursor-pointer"
                title={language === 'th' ? 'ตั้งค่าเกณฑ์แจ้งเตือนสต็อกต่ำ' : 'Configure Alert Threshold'}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
              <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                <AlertTriangle className="h-4 w-4" />
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between">
            <div className="text-2xl font-black font-mono tracking-tight text-amber-500">
              {inventoryMetrics.lowStockCount}
            </div>
            <span className="text-[10.5px] font-bold font-mono px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60">
              ≤ {lowStockThreshold} {language === 'th' ? 'ชิ้น' : 'units'}
            </span>
          </div>
          <div className="mt-2 text-[11px] text-text/60 flex items-center justify-between">
            <span>{language === 'th' ? 'ถึงจุดเตือนสั่งซื้อ' : 'Needs replenishment'}</span>
            <span className="text-amber-600 dark:text-amber-400 font-semibold group-hover:underline">
              {selectedStockFilter === 'low_stock'
                ? (language === 'th' ? 'กำลังกรอง' : 'Filtering')
                : (language === 'th' ? 'คลิกเพื่อกรอง' : 'Click to view')}
            </span>
          </div>
        </div>

        {/* Metric 4: Out of Stock Warning */}
        <div className="p-4 rounded-2xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{t.inventory.outOfStock}</span>
            <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500">
              <PackageX className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tracking-tight text-rose-500">
            {inventoryMetrics.outOfStockCount}
          </div>
          <div className="mt-2 text-[11px] text-text/60">
            {language === 'th' ? 'สินค้าหมดสต็อก' : 'Zero inventory balance'}
          </div>
        </div>

        {/* Metric 5: Total Inventory Valuation */}
        <div className="p-4 rounded-2xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between sm:col-span-2 md:col-span-3 lg:col-span-1">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{language === 'th' ? 'มูลค่าสินค้าคงคลัง' : 'Asset Valuation'}</span>
            <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-500">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tracking-tight text-text">
            {formatMoney(inventoryMetrics.totalRetailValue)}
          </div>
          <div className="mt-2 text-[11px] text-text/60 flex items-center justify-between">
            <span>{language === 'th' ? 'ต้นทุนรวม:' : 'Total Cost:'}</span>
            <span className="font-mono font-bold text-text/80">
              {formatMoney(inventoryMetrics.totalCostValue)}
            </span>
          </div>
        </div>
      </div>

      {activeTab === 'catalog' ? (
        <div className="space-y-4">
          {/* Low Stock Alert Threshold Customization & Highlighting Controls */}
          <div className="p-4 rounded-2xl bg-card border border-border border-crisp flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 shrink-0">
                <SlidersHorizontal className="h-4 w-4" />
              </div>
              <div className="text-left">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-bold text-sm text-text">
                    {language === 'th' ? 'กำหนดเกณฑ์แจ้งเตือนสต็อกต่ำ' : 'Configurable Low Stock Alert Threshold'}
                  </h4>
                  {inventoryMetrics.lowStockCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedStockFilter(selectedStockFilter === 'low_stock' ? 'all' : 'low_stock')}
                      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700/60 hover:bg-amber-200/80 dark:hover:bg-amber-800/60 transition-colors cursor-pointer shadow-2xs"
                      title={language === 'th' ? 'คลิกเพื่อกรองเฉพาะสินค้าสต็อกต่ำ' : 'Click to filter low stock items'}
                    >
                      <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>{inventoryMetrics.lowStockCount} {language === 'th' ? 'รายการแตะเกณฑ์เตือน' : 'items at threshold'}</span>
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-text/60 mt-0.5 leading-relaxed">
                  {language === 'th'
                    ? `สินค้าใดที่มีสต็อกคงเหลือ ≤ ${lowStockThreshold} ชิ้น จะถูกทำเครื่องหมายและไฮไลต์ด้วยป้ายเตือนสต็อกต่ำสีส้มเด่นชัด`
                    : `Any item with stock ≤ ${lowStockThreshold} units is visually flagged with a warning badge and amber color indicator.`}
                </p>
                {/* Preset Chips */}
                <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                  <span className="text-[10.5px] font-semibold text-text/50 mr-1">
                    {language === 'th' ? 'ทางลัด:' : 'Presets:'}
                  </span>
                  {[5, 10, 15, 20, 25, 30, 50].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleThresholdChange(preset)}
                      className={`px-2 py-0.5 rounded-lg text-[10.5px] font-mono font-bold transition-all cursor-pointer ${
                        lowStockThreshold === preset
                          ? 'bg-amber-500 text-white shadow-2xs'
                          : 'bg-muted hover:bg-amber-500/10 text-text/70 hover:text-amber-600 border border-border border-crisp'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Threshold Adjuster & Visual Warning Badge Toggle */}
            <div className="flex items-center gap-3 flex-wrap shrink-0 self-end lg:self-auto">
              {/* Highlight Toggle Button */}
              <button
                type="button"
                onClick={handleToggleHighlightLowStock}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
                  isHighlightLowStockActive
                    ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-600 shadow-2xs'
                    : 'bg-muted border-border border-crisp text-text/70 hover:text-text'
                }`}
                title={language === 'th' ? 'เปิด/ปิดการไฮไลต์และป้ายเตือนสต็อกต่ำ' : 'Toggle visual warning badge and highlight'}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                <span>
                  {isHighlightLowStockActive
                    ? (language === 'th' ? 'เปิดไฮไลต์เตือนสต็อกต่ำ' : 'Warning Badges ON')
                    : (language === 'th' ? 'ปิดไฮไลต์เตือนสต็อกต่ำ' : 'Warning Badges OFF')}
                </span>
              </button>

              <div className="flex items-center gap-2">
                <span className="text-xs text-text/60 font-medium">{language === 'th' ? 'เกณฑ์แจ้งเตือน:' : 'Alert at:'}</span>
                <div className="flex items-center gap-1 bg-background border border-border border-crisp rounded-xl p-1 h-9">
                  <button
                    type="button"
                    onClick={() => handleThresholdChange(Math.max(0, lowStockThreshold - 5))}
                    className="px-2.5 h-full text-text/60 hover:text-primary hover:bg-muted transition-all font-black rounded-lg cursor-pointer text-xs"
                    title="-5 units"
                  >
                    -5
                  </button>
                  <input
                    type="number"
                    min="0"
                    max="5000"
                    value={lowStockThreshold}
                    onChange={(e) => {
                      const parsed = parseInt(e.target.value, 10);
                      handleThresholdChange(isNaN(parsed) ? 0 : parsed);
                    }}
                    className="w-12 text-center font-mono font-black text-xs text-primary bg-transparent border-none focus:outline-none focus:ring-0 p-0"
                  />
                  <button
                    type="button"
                    onClick={() => handleThresholdChange(lowStockThreshold + 5)}
                    className="px-2.5 h-full text-text/60 hover:text-primary hover:bg-muted transition-all font-black rounded-lg cursor-pointer text-xs"
                    title="+5 units"
                  >
                    +5
                  </button>
                </div>
                <span className="text-xs text-text/60 font-semibold">{language === 'th' ? 'ชิ้น' : 'units'}</span>

                <button
                  type="button"
                  onClick={() => setIsThresholdModalOpen(true)}
                  className="p-2 rounded-xl bg-muted hover:bg-amber-500/10 text-text/60 hover:text-amber-600 transition-colors border border-border border-crisp cursor-pointer"
                  title={language === 'th' ? 'เปิดหน้าต่างตั้งค่าละเอียด' : 'Open advanced threshold settings'}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Dedicated Low Stock Alert Hero Banner */}
          {inventoryMetrics.lowStockCount > 0 && (
            <div
              id="low-stock-alert-hero-banner"
              className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-amber-500/5 dark:from-amber-950/40 dark:via-amber-950/20 dark:to-card border-2 border-amber-400 dark:border-amber-600/70 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-950 dark:text-amber-100 shadow-sm shadow-amber-500/5"
            >
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500 text-white shrink-0 shadow-xs ring-4 ring-amber-500/20">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-500 text-white shadow-2xs">
                      {language === 'th' ? 'สัญญาณเตือนสต็อกต่ำ' : 'Low Stock Warning'}
                    </span>
                    <h4 className="font-black text-sm text-amber-950 dark:text-amber-100">
                      {language === 'th'
                        ? `พบสินค้าสต็อกต่ำแตะเกณฑ์เตือน ${inventoryMetrics.lowStockCount} รายการ (≤ ${lowStockThreshold} ชิ้น)`
                        : `Low Stock Alert: ${inventoryMetrics.lowStockCount} items below threshold (≤ ${lowStockThreshold} units)`}
                    </h4>
                  </div>
                  <p className="text-[11.5px] text-text/70 mt-1 leading-relaxed">
                    {language === 'th'
                      ? `สินค้าเหล่านี้มีปริมาณคงเหลือน้อยกว่าเกณฑ์ที่กำหนด จึงได้รับการติดป้ายเตือนสีส้มเด่นชัดเพื่อแจ้งเตือนให้ทำการสั่งซื้อหรือเติมสินค้า`
                      : `Items flagged with warning badges and amber color indicators require replenishment to prevent operational stockouts.`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto flex-wrap">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setIsRestockReportModalOpen(true)}
                  className="text-xs bg-amber-600 hover:bg-amber-700 text-white font-bold shrink-0 cursor-pointer shadow-xs border-amber-700 flex items-center gap-1.5"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  <span>{language === 'th' ? 'สร้างรายงานสั่งเติมสินค้า' : 'Generate Restock Report'}</span>
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setIsThresholdModalOpen(true)}
                  className="text-xs bg-card hover:bg-muted text-text/80 border-border border-crisp font-semibold shrink-0 cursor-pointer flex items-center gap-1.5"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5 text-amber-500" />
                  <span>{language === 'th' ? 'ปรับเกณฑ์เตือน' : 'Set Threshold'}</span>
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedStockFilter(selectedStockFilter === 'low_stock' ? 'all' : 'low_stock')}
                  className="text-xs font-bold shrink-0 cursor-pointer bg-card/60 flex items-center gap-1.5"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  <span>
                    {selectedStockFilter === 'low_stock'
                      ? (language === 'th' ? 'แสดงสินค้าทั้งหมด' : 'Show All Items')
                      : (language === 'th' ? `กรอง ${inventoryMetrics.lowStockCount} รายการสต็อกต่ำ` : `Filter ${inventoryMetrics.lowStockCount} Low Stock`)}
                  </span>
                </Button>
              </div>
            </div>
          )}

          {/* Velocity Stockout Alert Banner */}
          {velocityRiskCount > 0 && (
            <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 dark:border-amber-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-500 text-white shrink-0">
                  <TrendingUp className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="font-bold text-sm">
                    {language === 'th' ? `แจ้งเตือนความเสี่ยงสต็อกหมดตามยอดขาย (${velocityRiskCount} รายการ)` : `Velocity Stockout Forecast Alert (${velocityRiskCount} items at risk)`}
                  </h4>
                  <p className="text-[11px] opacity-90 mt-0.5">
                    {language === 'th'
                      ? 'รายการสินค้าเหล่านี้มีแนวโน้มจะหมดสต็อกภายใน 7 วัน คำนวณจากอัตราความเร็วในการขายเฉลี่ย (ADSV)'
                      : 'Items below are projected to run out within 7 days based on average daily sales velocity (ADSV).'}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSelectedStockFilter('velocity_risk')}
                className="text-xs bg-amber-500/20 hover:bg-amber-500/30 text-amber-900 dark:text-amber-200 border-amber-500/30 font-bold shrink-0 cursor-pointer"
              >
                {language === 'th' ? 'ดูกรองรายการเสี่ยง' : 'View Velocity Risks'}
              </Button>
            </div>
          )}

          {/* 3. Search, Filter Bar & View Switcher */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="flex-1 flex items-center gap-2">
              <div className="flex-1">
                <SearchInput
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onClear={() => setSearchQuery('')}
                  placeholder={t.inventory.searchPlaceholder}
                />
              </div>

              {/* Hardware Barcode Scanner Quick Lookup Button */}
              <button
                type="button"
                id="btn-inventory-barcode-lookup-trigger"
                onClick={() => {
                  playScannerSound('click');
                  setIsBarcodeLookupModalOpen(true);
                }}
                title={language === 'th' ? 'ตรวจสอบระดับสต็อกด้วยเครื่องสแกนบาร์โค้ด' : 'Hardware Barcode Stock Lookup'}
                className="h-10 px-3 rounded-xl border border-border border-crisp bg-card hover:bg-muted text-text/80 hover:text-primary transition-all flex items-center gap-2 text-xs font-bold shrink-0 cursor-pointer shadow-2xs"
              >
                <div className="relative flex items-center justify-center">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      isHardwareScanning
                        ? 'bg-primary animate-ping'
                        : isScannerEnabled
                        ? 'bg-emerald-500'
                        : 'bg-muted'
                    }`}
                  />
                </div>
                <Barcode className="h-4 w-4 text-primary" />
                <span className="hidden sm:inline">
                  {language === 'th' ? 'ยิงเช็คสต็อก' : 'Scan & Lookup'}
                </span>
              </button>
            </div>

            {/* Stock Status Filter Buttons */}
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
              <button
                type="button"
                onClick={() => setSelectedStockFilter('all')}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  selectedStockFilter === 'all'
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-card border border-border border-crisp text-text/70 hover:text-text'
                }`}
              >
                {language === 'th' ? 'ทั้งหมด' : 'All Stock'} ({products.length})
              </button>

              <button
                type="button"
                onClick={() => setSelectedStockFilter('in_stock')}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  selectedStockFilter === 'in_stock'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'bg-card border border-border border-crisp text-text/70 hover:text-text'
                }`}
              >
                {t.inventory.inStock} ({inventoryMetrics.inStockCount})
              </button>

              <button
                type="button"
                onClick={() => setSelectedStockFilter('low_stock')}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  selectedStockFilter === 'low_stock'
                    ? 'bg-amber-500 text-white shadow-2xs'
                    : 'bg-card border border-border border-crisp text-text/70 hover:text-text'
                }`}
              >
                {t.inventory.lowStock} ({inventoryMetrics.lowStockCount})
              </button>

              <button
                type="button"
                onClick={() => setSelectedStockFilter('out_of_stock')}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  selectedStockFilter === 'out_of_stock'
                    ? 'bg-rose-600 text-white shadow-2xs'
                    : 'bg-card border border-border border-crisp text-text/70 hover:text-text'
                }`}
              >
                {t.inventory.outOfStock} ({inventoryMetrics.outOfStockCount})
              </button>

              <button
                type="button"
                onClick={() => setSelectedStockFilter('velocity_risk')}
                className={`px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                  selectedStockFilter === 'velocity_risk'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'bg-card border border-border border-crisp text-amber-600 dark:text-amber-400 hover:text-text'
                }`}
              >
                <TrendingUp className="h-3.5 w-3.5" />
                <span>{language === 'th' ? '⚡ เสี่ยงสต็อกหมด' : '⚡ Velocity Risk'} ({velocityRiskCount})</span>
              </button>
            </div>

            {/* View Mode Toggle: Grid Card vs Data Table */}
            <div className="flex items-center gap-1 p-1 bg-card rounded-xl border border-border border-crisp shrink-0 self-end md:self-auto">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-primary text-white shadow-2xs'
                    : 'text-text/60 hover:text-text'
                }`}
                title="Grid View"
              >
                <LayoutGrid className="h-4 w-4" />
                <span className="hidden sm:inline">{language === 'th' ? 'การ์ด' : 'Grid'}</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-primary text-white shadow-2xs'
                    : 'text-text/60 hover:text-text'
                }`}
                title="Table View"
              >
                <List className="h-4 w-4" />
                <span className="hidden sm:inline">{language === 'th' ? 'ตาราง' : 'Table'}</span>
              </button>
            </div>
          </div>

          {/* Category Filter Pills (Responsive Wrap) */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                selectedCategory === 'all'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-card/80 border border-border border-crisp text-text/70 hover:bg-background'
              }`}
            >
              {language === 'th' ? 'ทุกหมวดหมู่' : 'All Categories'}
            </button>

            {categories.map((cat) => {
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                    isSelected
                      ? 'bg-primary text-white shadow-2xs'
                      : 'bg-card/80 border border-border border-crisp text-text/70 hover:bg-background'
                  }`}
                >
                  {cat.color && (
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                  )}
                  <span>{cat.name}</span>
                </button>
              );
            })}
          </div>

          {/* Select-All & Bulk Action Toolbar */}
          <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-card border border-border border-crisp text-xs shadow-2xs">
            <label className="flex items-center gap-2 cursor-pointer font-semibold text-text/80">
              <input
                type="checkbox"
                checked={selectedProductIds.length > 0 && selectedProductIds.length === filteredProducts.length}
                onChange={handleToggleSelectAll}
                className="rounded border-border text-primary focus:ring-primary h-4 w-4"
              />
              <span>
                {language === 'th' ? 'เลือกทั้งหมดในหน้านี้' : 'Select all on this view'} ({filteredProducts.length})
              </span>
            </label>

            {selectedProductIds.length > 0 && (
              <div className="flex items-center gap-2 animate-in fade-in duration-150">
                <span className="font-bold text-primary">
                  {selectedProductIds.length} {language === 'th' ? 'รายการที่เลือก' : 'selected'}
                </span>

                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setIsBulkAdjustModalOpen(true)}
                  leftIcon={<PlusCircle className="h-3.5 w-3.5" />}
                  className="text-xs"
                >
                  {language === 'th' ? 'ปรับสต็อกแบบกลุ่ม' : 'Bulk Adjust'}
                </Button>

                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setBulkPricingStep('configure');
                    setIsBulkPricingModalOpen(true);
                  }}
                  leftIcon={<DollarSign className="h-3.5 w-3.5" />}
                  className="text-xs"
                >
                  {language === 'th' ? 'ปรับราคาแบบกลุ่ม' : 'Bulk Pricing'}
                </Button>

                <button
                  type="button"
                  onClick={() => setSelectedProductIds([])}
                  className="text-xs text-text/60 hover:text-text underline px-1 cursor-pointer"
                >
                  {language === 'th' ? 'ยกเลิก' : 'Clear'}
                </button>
              </div>
            )}
          </div>

          {/* 4. RESPONSIVE PRODUCT SYSTEM */}
          {filteredProducts.length === 0 ? (
            <div className="p-12 text-center text-text/40 text-sm bg-card rounded-2xl border border-border border-crisp space-y-2">
              <Package className="h-8 w-8 mx-auto text-text/60 dark:text-text/70" />
              <div className="font-bold text-text/80">
                {language === 'th' ? 'ไม่พบสินค้าที่ตรงกับเงื่อนไข' : 'No products found'}
              </div>
              <p className="text-xs text-text/50">
                {language === 'th' ? 'ลองค้นหาด้วยคำอื่น หรือเลือกหมวดหมู่อื่น' : 'Try adjusting your search filters or categories.'}
              </p>
              <div className="pt-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => setIsBulkUploadModalOpen(true)}
                  leftIcon={<UploadCloud className="h-4 w-4" />}
                >
                  {language === 'th' ? 'นำเข้าสินค้าจากไฟล์ CSV/JSON' : 'Upload Catalog via CSV/JSON'}
                </Button>
              </div>
            </div>
          ) : viewMode === 'grid' ? (
            /* ================================================================ */
            /* RESPONSIVE GRID CARDS VIEW                                       */
            /* Breakpoints: 1 col (xs) -> 2 cols (sm) -> 2 cols (md) ->         */
            /*              3 cols (lg) -> 4 cols (xl) -> 5 cols (2xl)          */
            /* ================================================================ */
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 lg:gap-5">
              {filteredProducts.map((p) => {
                const isLow = p.currentStock <= lowStockThreshold && p.currentStock > 0;
                const isOutOfStock = p.currentStock <= 0;
                const isHighlighted = isHighlightLowStockActive && isLow;
                const marginPercent = Math.round(
                  ((p.price.amountInCents - p.costPrice.amountInCents) / p.price.amountInCents) * 100
                );

                // Stock progress ratio against 2x reorder point
                const maxStockGauge = Math.max(p.reorderPoint * 3, 50);
                const stockPercent = Math.min(100, Math.round((p.currentStock / maxStockGauge) * 100));

                return (
                  <div
                    key={p.id}
                    className={`p-4 rounded-2xl border transition-all group relative flex flex-col justify-between ${
                      isHighlighted
                        ? 'border-2 border-amber-500 bg-gradient-to-b from-amber-500/15 via-amber-500/5 to-card dark:from-amber-950/35 dark:via-card dark:to-card shadow-sm shadow-amber-500/15 ring-2 ring-amber-400/40 dark:ring-amber-500/30'
                        : isOutOfStock
                        ? 'border-rose-200 dark:border-rose-900/30 bg-card shadow-2xs hover:border-rose-300 dark:hover:border-rose-800'
                        : 'border-border border-crisp bg-card shadow-2xs hover:border-primary/40'
                    }`}
                  >
                    <div>
                      {/* Top Bar: SKU, Barcode, Status Badge */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedProductIds.includes(p.id)}
                            onChange={(e) => {
                              e.stopPropagation();
                              setSelectedProductIds((prev) =>
                                prev.includes(p.id) ? prev.filter((i) => i !== p.id) : [...prev, p.id]
                              );
                            }}
                            className="rounded border-border text-primary focus:ring-primary h-4 w-4 shrink-0 cursor-pointer"
                          />
                          <div className="min-w-0">
                            <div className="text-[10.5px] font-mono text-text/40 font-bold uppercase truncate">
                              {p.sku}
                            </div>
                            <div className="text-[9.5px] font-mono text-text/60 truncate">
                              {p.barcode}
                            </div>
                          </div>
                        </div>

                        {isOutOfStock ? (
                          <Badge variant="danger" size="sm" dot>
                            {t.pos.outOfStock}
                          </Badge>
                        ) : isLow ? (
                          <Badge
                            variant="warning"
                            size="sm"
                            className="bg-amber-500 text-white dark:bg-amber-500 dark:text-white border-amber-600 font-black shadow-2xs px-2 py-0.5"
                          >
                            <AlertTriangle className="h-3 w-3 inline mr-1 text-white shrink-0" />
                            <span>{t.inventory.lowStockAlert} (≤{lowStockThreshold})</span>
                          </Badge>
                        ) : (
                          <Badge variant="success" size="sm" dot>
                            {t.pos.inStock}
                          </Badge>
                        )}
                      </div>

                      {/* Product Title & Description */}
                      <div className="mt-2.5">
                        <h3 className="text-sm font-bold text-text group-hover:text-primary transition-colors line-clamp-1">
                          {p.name}
                        </h3>
                        <p className="text-[11px] text-text/60 line-clamp-2 mt-0.5 leading-relaxed min-h-[32px]">
                          {p.description || (language === 'th' ? 'ไม่มีรายละเอียดเพิ่มเติม' : 'Standard catalog SKU')}
                        </p>
                      </div>

                      {/* Visual Warning Alert Callout Banner for Low-Stock Items */}
                      {isHighlighted && (
                        <div className="mt-2.5 px-3 py-2 rounded-xl bg-amber-500/15 dark:bg-amber-500/25 border-2 border-amber-400 dark:border-amber-500/50 flex items-center justify-between text-xs text-amber-900 dark:text-amber-100 shadow-2xs">
                          <div className="flex items-center gap-2 font-bold text-[11px] min-w-0">
                            <div className="p-1 rounded-md bg-amber-500 text-white shrink-0 shadow-2xs">
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0">
                              <span className="truncate block font-black text-amber-900 dark:text-amber-200">
                                {language === 'th' ? 'เตือนสต็อกต่ำ' : 'Low Stock Alert'}
                              </span>
                              <span className="text-[10px] text-amber-800/80 dark:text-amber-300/80 block">
                                {language === 'th'
                                  ? `เหลือเพียง ${p.currentStock} ${p.unitOfMeasure}`
                                  : `Only ${p.currentStock} ${p.unitOfMeasure} left`}
                              </span>
                            </div>
                          </div>
                          <span className="text-[10px] font-mono font-black px-2 py-0.5 rounded-md bg-amber-500 text-white shrink-0 ml-1 shadow-2xs">
                            ≤ {lowStockThreshold}
                          </span>
                        </div>
                      )}

                      {/* Stock Progress Meter */}
                      <div className="mt-3 pt-2.5 border-t border-border border-crisp space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-text/60 text-[11px]">
                            {t.inventory.stockStatus}
                          </span>
                          <span className={`font-mono font-bold text-sm ${
                            isOutOfStock
                              ? 'text-rose-500'
                              : isLow
                              ? 'text-amber-600 dark:text-amber-400 font-black flex items-center gap-1'
                              : 'text-text'
                          }`}>
                            {isLow && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                            <span>{p.currentStock}</span> <span className="text-xs font-sans font-normal text-text/60">{p.unitOfMeasure}</span>
                          </span>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isOutOfStock
                                ? 'bg-rose-500'
                                : isLow
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.max(6, stockPercent)}%` }}
                          />
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-text/60 pt-0.5">
                          <span>{t.inventory.minAlert}: <strong className="font-mono">{p.reorderPoint}</strong></span>
                          <span>Margin: <strong className="font-mono text-emerald-600 dark:text-emerald-400">+{marginPercent}%</strong></span>
                        </div>

                        {/* Average Daily Sales Velocity & Stockout Forecast */}
                        {(() => {
                          const vInfo = productVelocityMap.get(p.id);
                          if (!vInfo) return null;
                          return (
                            <div className="mt-2 p-2 rounded-xl bg-background border border-border border-crisp flex items-center justify-between text-[10px]">
                              <div className="flex items-center gap-1 text-text/60">
                                <TrendingUp className="h-3 w-3 text-primary" />
                                <span>{language === 'th' ? 'ขาย/วัน:' : 'Velocity:'} <strong className="font-mono text-text">{vInfo.adsv}/d</strong></span>
                              </div>
                              <div className={`font-mono font-bold ${
                                vInfo.riskLevel === 'critical' ? 'text-rose-500' : vInfo.riskLevel === 'high' ? 'text-amber-500' : 'text-text/70'
                              }`}>
                                {vInfo.daysRemaining > 300 ? 'Stable' : (language === 'th' ? `หมดใน ${vInfo.daysRemaining} วัน` : `~${vInfo.daysRemaining}d left`)}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>

                    {/* Bottom Pricing & Adjust Action Button */}
                    <div className="mt-3.5 pt-3 border-t border-border border-crisp flex items-center justify-between gap-2">
                      <div>
                        <div className="text-[10px] text-text/60">{t.inventory.retailPrice}</div>
                        <div className="text-sm font-bold font-mono text-primary">
                          {formatMoney(p.price)}
                        </div>
                      </div>

                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleOpenAdjust(p)}
                        leftIcon={<PlusCircle className="h-3.5 w-3.5 text-primary" />}
                        className="text-xs"
                      >
                        {t.inventory.adjustStock}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ================================================================ */
            /* RESPONSIVE TABLE VIEW                                            */
            /* ================================================================ */
            <Card>
              <div className="w-full overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-border border-crisp text-text/60 bg-background font-medium">
                      <th className="py-3.5 px-5">
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={selectedProductIds.length > 0 && selectedProductIds.length === filteredProducts.length}
                            onChange={handleToggleSelectAll}
                            className="rounded border-border text-primary focus:ring-primary h-4 w-4"
                          />
                          <span>{t.inventory.sku} / Barcode</span>
                        </div>
                      </th>
                      <th className="py-3.5 px-4">{t.inventory.productName}</th>
                      <th className="py-3.5 px-4">{t.inventory.retailPrice}</th>
                      <th className="py-3.5 px-4">{t.inventory.costPrice}</th>
                      <th className="py-3.5 px-4">{t.inventory.margin}</th>
                      <th className="py-3.5 px-4">{t.inventory.stockStatus}</th>
                      <th className="py-3.5 px-4">{t.inventory.minAlert}</th>
                      <th className="py-3.5 px-4">{language === 'th' ? 'ความเร็วขาย / คาดการณ์' : 'Velocity & Horizon'}</th>
                      <th className="py-3.5 px-5 text-right">{language === 'th' ? 'จัดการ' : 'Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredProducts.map((p) => {
                      const isLow = p.currentStock <= lowStockThreshold && p.currentStock > 0;
                      const isOutOfStock = p.currentStock <= 0;
                      const isHighlighted = isHighlightLowStockActive && isLow;
                      const marginPercent = Math.round(
                        ((p.price.amountInCents - p.costPrice.amountInCents) / p.price.amountInCents) * 100
                      );

                      return (
                        <tr
                          key={p.id}
                          className={`transition-colors ${
                            isHighlighted
                              ? 'bg-amber-500/10 dark:bg-amber-950/40 hover:bg-amber-500/15 dark:hover:bg-amber-900/50 border-l-4 border-l-amber-500 shadow-2xs'
                              : selectedProductIds.includes(p.id)
                              ? 'bg-primary/10 hover:bg-muted'
                              : 'hover:bg-muted'
                          }`}
                        >
                          <td className="py-3.5 px-5 font-mono">
                            <div className="flex items-center gap-2.5">
                              <input
                                type="checkbox"
                                checked={selectedProductIds.includes(p.id)}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setSelectedProductIds((prev) =>
                                    prev.includes(p.id) ? prev.filter((i) => i !== p.id) : [...prev, p.id]
                                  );
                                }}
                                className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                              />
                              <div>
                                <div className="font-bold text-text">{p.sku}</div>
                                <div className="text-[10px] text-text/60">{p.barcode}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-semibold text-text">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span>{p.name}</span>
                              {isHighlighted && (
                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-black bg-amber-500 text-white shrink-0 shadow-2xs">
                                  <AlertTriangle className="h-3 w-3 text-white shrink-0" />
                                  <span>{t.inventory.lowStockAlert} (≤{lowStockThreshold})</span>
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] text-text/60 line-clamp-1">{p.description}</div>
                          </td>
                          <td className="py-3.5 px-4 font-mono font-bold text-text">
                            {formatMoney(p.price)}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-text/60">
                            {formatMoney(p.costPrice)}
                          </td>
                          <td className="py-3.5 px-4 font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                            +{marginPercent}%
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="flex items-center gap-2">
                              <span className={`font-mono font-bold text-sm ${
                                isOutOfStock ? 'text-rose-500' : isLow ? 'text-amber-600 dark:text-amber-400 font-black flex items-center gap-1' : 'text-text'
                              }`}>
                                {isLow && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
                                <span>{p.currentStock} {p.unitOfMeasure}</span>
                              </span>
                              {isOutOfStock ? (
                                <Badge variant="danger" size="sm" dot>
                                  {t.pos.outOfStock}
                                </Badge>
                              ) : isLow ? (
                                <Badge
                                  variant="warning"
                                  size="sm"
                                  className="bg-amber-500 text-white font-bold border-amber-600 shadow-2xs px-2 py-0.5"
                                >
                                  <AlertTriangle className="h-3 w-3 text-white inline mr-1 shrink-0" />
                                  <span>{t.inventory.lowStockAlert}</span>
                                </Badge>
                              ) : null}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 font-mono text-text/60">
                            {p.reorderPoint}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-[11px]">
                            {(() => {
                              const vInfo = productVelocityMap.get(p.id);
                              if (!vInfo) return '-';
                              return (
                                <div>
                                  <div className="text-text font-bold">{vInfo.adsv} units/d</div>
                                  <div className={`text-[10px] ${
                                    vInfo.riskLevel === 'critical' ? 'text-rose-500 font-bold' : vInfo.riskLevel === 'high' ? 'text-amber-500 font-bold' : 'text-text/60'
                                  }`}>
                                    {vInfo.daysRemaining > 300 ? 'Stable' : (language === 'th' ? `หมดใน ${vInfo.daysRemaining} วัน` : `~${vInfo.daysRemaining}d left`)}
                                  </div>
                                </div>
                              );
                            })()}
                          </td>
                          <td className="py-3.5 px-5 text-right">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleOpenAdjust(p)}
                              leftIcon={<PlusCircle className="h-3.5 w-3.5" />}
                            >
                              {t.inventory.adjustStock}
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      ) : activeTab === 'ledger' ? (
        /* ================================================================ */
        /* LEDGER ENTRIES VIEW (AUDIT TRAIL)                                */
        /* ================================================================ */
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between w-full">
              <h3 className="text-sm sm:text-base font-bold text-text flex items-center gap-2">
                <History className="h-4 w-4 text-primary" />
                <span>{language === 'th' ? 'ประวัติการเคลื่อนไหวสต็อกสินค้า (Stock Ledger)' : 'Auditable Inventory Movements Log'}</span>
              </h3>
              <p className="text-xs text-text/60 mt-0.5">
                {language === 'th'
                  ? 'ตรวจสอบย้อนกลับทุกการรับเข้า จ่ายออก ปรับสต็อก และตัดชำรุดแบบเรียลไทม์'
                  : 'Traceable reasons for all additions, deductions, sales, and reconciliations.'}
              </p>
            </div>
          </CardHeader>

          {/* Mobile Ledger: Responsive Card Grid */}
          <div className="lg:hidden p-3.5 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {ledgerEntries.length === 0 ? (
              <div className="col-span-full py-8 text-center text-text/50 text-xs">
                {language === 'th' ? 'ยังไม่มีประวัติการเคลื่อนไหวสต็อก' : 'No stock movements recorded yet.'}
              </div>
            ) : (
              ledgerEntries.map((entry) => {
                const prod = products.find((p) => p.id === entry.productId);
                const isPositive = entry.quantityDelta > 0;
                return (
                  <div
                    key={entry.id}
                    className="p-3.5 rounded-2xl border border-border border-crisp bg-card shadow-2xs space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-text">
                        {prod ? prod.name : entry.productId}
                      </span>
                      <span
                        className={`font-mono font-bold ${
                          isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {isPositive ? `+${entry.quantityDelta}` : entry.quantityDelta}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-text/60">
                      <span className="font-mono text-[10px]">{entry.reason.replace(/_/g, ' ')}</span>
                      <span className="font-mono text-[10px]">{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-border dark:border-white/5 text-[10.5px]">
                      <span className="text-text/50">Ref: {entry.referenceId}</span>
                      <span className="font-mono font-bold text-text/80">
                        {language === 'th' ? 'คงเหลือ:' : 'Result:'} {entry.resultingStock}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table View */}
          <div className="hidden lg:block w-full overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border border-crisp text-text/60 bg-background font-medium">
                  <th className="py-3.5 px-5">{t.audit.timestamp}</th>
                  <th className="py-3.5 px-4">{language === 'th' ? 'สินค้า' : 'Product'}</th>
                  <th className="py-3.5 px-4">{language === 'th' ? 'ประเภทการเคลื่อนไหว' : 'Movement Reason'}</th>
                  <th className="py-3.5 px-4">{language === 'th' ? 'เลขอ้างอิง' : 'Reference #'}</th>
                  <th className="py-3.5 px-4">{language === 'th' ? 'จำนวนที่ปรับ' : 'Qty Delta'}</th>
                  <th className="py-3.5 px-5 text-right">{language === 'th' ? 'ยอดคงเหลือใหม่' : 'Resulting Stock'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200/80 dark:divide-white/5 font-mono">
                {ledgerEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-text/40">
                      {language === 'th' ? 'ยังไม่มีประวัติการเคลื่อนไหวสต็อก' : 'No stock movements recorded yet.'}
                    </td>
                  </tr>
                ) : (
                  ledgerEntries.map((entry) => {
                    const prod = products.find((p) => p.id === entry.productId);
                    const isPositive = entry.quantityDelta > 0;
                    return (
                      <tr key={entry.id} className="hover:bg-background/50 dark:hover:bg-white/5 transition-colors">
                        <td className="py-3.5 px-5 text-text/60">
                          {new Date(entry.timestamp).toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 font-sans font-bold text-text dark:text-text">
                          {prod ? prod.name : entry.productId}
                        </td>
                        <td className="py-3.5 px-4 uppercase text-[10px] text-text/70 font-semibold">
                          <span className="px-2 py-0.5 rounded bg-background dark:bg-white/10">
                            {entry.reason.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-text/60">
                          {entry.referenceId}
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`font-bold inline-flex items-center gap-1 ${
                              isPositive
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {isPositive ? (
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            ) : (
                              <ArrowDownRight className="h-3.5 w-3.5" />
                            )}
                            {isPositive ? `+${entry.quantityDelta}` : entry.quantityDelta}
                          </span>
                        </td>
                        <td className="py-3.5 px-5 text-right font-bold text-text">
                          {entry.resultingStock}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* ================================================================ */
        /* SMART RESTOCK VIEW                                               */
        /* ================================================================ */
        <div className="space-y-4">
          {/* Smart Restock Header Stats Panel */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Stat 1: At Stockout Risk */}
            <div className="p-4 rounded-2xl border border-border border-crisp bg-card shadow-2xs">
              <div className="text-[10px] font-bold text-text/40 uppercase tracking-wider">
                {language === 'th' ? 'สินค้าที่อยู่ในเกณฑ์สต็อกต่ำ' : 'Items Near or Below Safety'}
              </div>
              <div className="text-2xl font-black font-mono tracking-tight text-amber-500 mt-1">
                {restockSuggestions.filter(s => s.isNearOrBelowSafety).length} <span className="text-xs font-sans font-medium text-text/50">SKUs</span>
              </div>
              <p className="text-[10px] text-text/50 mt-1">
                {language === 'th' ? 'ระดับสต็อกน้อยกว่าหรือเท่ากับเกณฑ์ปลอดภัยของคุณ' : 'Stock level is less than or equal to safety alert levels.'}
              </p>
            </div>

            {/* Stat 2: Total Suggested Replenishment Units */}
            <div className="p-4 rounded-2xl border border-border border-crisp bg-card shadow-2xs">
              <div className="text-[10px] font-bold text-text/40 uppercase tracking-wider">
                {language === 'th' ? 'รวมหน่วยสั่งซื้อที่แนะนำ' : 'Recommended Total Units'}
              </div>
              <div className="text-2xl font-black font-mono tracking-tight text-emerald-500 mt-1">
                {restockSuggestions.reduce((acc, s) => {
                  const qty = restockQuantities[s.product.id] !== undefined ? restockQuantities[s.product.id] : s.smartRecommendedQty;
                  return acc + qty;
                }, 0)} <span className="text-xs font-sans font-medium text-text/50">units</span>
              </div>
              <p className="text-[10px] text-text/50 mt-1">
                {language === 'th' ? 'คำนวณตามความเร็วการขายเฉลี่ย (ADSV) เป็นเวลา 14 วัน' : 'Sized mathematically to cover active sales trends for the next 14 days.'}
              </p>
            </div>

            {/* Stat 3: Estimated Procurement Cost */}
            <div className="p-4 rounded-2xl border border-border border-crisp bg-card shadow-2xs">
              <div className="text-[10px] font-bold text-text/40 uppercase tracking-wider">
                {language === 'th' ? 'มูลค่าจัดซื้อที่คาดการณ์' : 'Estimated Cost Capital'}
              </div>
              <div className="text-2xl font-black font-mono tracking-tight text-primary mt-1">
                {(() => {
                  const totalCostCents = restockSuggestions.reduce((acc, s) => {
                    const qty = restockQuantities[s.product.id] !== undefined ? restockQuantities[s.product.id] : s.smartRecommendedQty;
                    return acc + (s.product.costPrice.amountInCents * qty);
                  }, 0);
                  const currency = session?.currentStore.currency || 'THB';
                  return formatMoney(createMoney(totalCostCents, currency));
                })()}
              </div>
              <p className="text-[10px] text-text/50 mt-1">
                {language === 'th' ? 'คำนวณจากต้นทุนราคาส่งของรายการที่เลือก' : 'Estimated procurement cost required for restock selection.'}
              </p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between w-full">
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-text flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-500 animate-pulse" />
                    <span>{language === 'th' ? 'รายการเติมสต็อกแนะนำอัจฉริยะ' : 'Smart Restock Replenishment Suggestions'}</span>
                  </h3>
                  <p className="text-xs text-text/60 mt-0.5">
                    {language === 'th'
                      ? 'คำนวณจากประวัติการขายและความเร็วเฉลี่ย (ADSV) เพื่อเติมสต็อกให้เพียงพอสำหรับ 14 วันถัดไป'
                      : 'AI restock engine suggests items that are out of stock, near safety levels, or have accelerated sales velocity.'}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsRestockReportModalOpen(true)}
                    leftIcon={<FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
                    className="text-xs font-bold cursor-pointer"
                  >
                    {language === 'th' ? 'เปิดรายงาน Restock Report' : 'Open Restock Report'}
                  </Button>

                  {selectedRestockIds.length > 0 && (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={isSubmittingRestock}
                      isLoading={isSubmittingRestock}
                      onClick={handleExecuteRestock}
                      leftIcon={<RefreshCw className="h-4 w-4" />}
                    >
                      {language === 'th'
                        ? `อนุมัติการเติมสต็อก (${selectedRestockIds.length} รายการ)`
                        : `Approve Restock for ${selectedRestockIds.length} items`}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>

            {/* Mobile View: Restock Card List */}
            <div className="lg:hidden p-3.5 sm:p-4 space-y-3">
              {restockSuggestions.length === 0 ? (
                <div className="py-12 text-center text-text/50 text-xs">
                  {language === 'th'
                    ? 'ยินดีด้วย! ระดับสต็อกทั้งหมดของคุณอยู่ในระดับปลอดภัยและมีความเสี่ยงต่ำ'
                    : 'Congratulations! All your catalog stock levels are within healthy and safe limits.'}
                </div>
              ) : (
                restockSuggestions.map((item) => {
                  const p = item.product;
                  const isSelected = selectedRestockIds.includes(p.id);
                  const qty = restockQuantities[p.id] !== undefined ? restockQuantities[p.id] : item.smartRecommendedQty;

                  return (
                    <div
                      key={p.id}
                      className={`p-3.5 rounded-2xl border transition-all space-y-3 bg-card ${
                        isSelected
                          ? 'border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/2'
                          : 'border-border border-crisp'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {
                              setSelectedRestockIds((prev) =>
                                prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                              );
                            }}
                            className="rounded border-border text-primary focus:ring-primary h-4.5 w-4.5 cursor-pointer shrink-0"
                          />
                          <div>
                            <div className="font-bold text-text text-xs">{p.name}</div>
                            <div className="text-[10px] text-text/60 font-mono mt-0.5">{p.sku}</div>
                          </div>
                        </div>

                        {p.currentStock <= 0 ? (
                          <Badge variant="danger" size="sm">
                            {language === 'th' ? 'หมดคลัง' : 'Out of Stock'}
                          </Badge>
                        ) : (
                          <Badge variant="warning" size="sm">
                            {language === 'th' ? `เหลือ ${p.currentStock}` : `${p.currentStock} left`}
                          </Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[10px] bg-card p-2.5 rounded-xl border border-border border-crisp">
                        <div>
                          <span className="text-text/50">{language === 'th' ? 'ยอดขายประวัติ:' : 'Total Sold:'}</span>
                          <span className="font-mono font-bold text-text/80 ml-1">
                            {item.vInfo.totalSold} units
                          </span>
                        </div>
                        <div>
                          <span className="text-text/50">{language === 'th' ? 'ความเร็ว ADSV:' : 'Velocity:'}</span>
                          <span className="font-mono font-bold text-text/80 ml-1">
                            {item.vInfo.adsv}/day
                          </span>
                        </div>
                        <div className="col-span-2 pt-1 border-t border-border border-crisp mt-1 flex items-center justify-between">
                          <span className="text-text/50 font-semibold">{language === 'th' ? 'ความเร่งด่วน:' : 'Alert Status:'}</span>
                          <span className={`font-bold ${
                            item.isOutOfStock ? 'text-rose-500' : 'text-amber-500'
                          }`}>
                            {item.isOutOfStock
                              ? (language === 'th' ? 'หมดสต็อกทันที' : 'Stockout Alert')
                              : (language === 'th' ? 'สต็อกต่ำกว่าเกณฑ์ภัย' : 'Below Safe Threshold')}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-3 pt-1">
                        <span className="text-[10px] font-bold text-text/60">
                          {language === 'th' ? 'จำนวนสั่งซื้อที่แนะนำ:' : 'Order Quantity:'}
                        </span>
                        <div className="flex items-center gap-1.5 bg-card border border-border border-crisp rounded-xl px-1.5 py-1">
                          <button
                            type="button"
                            onClick={() => {
                              const nextVal = Math.max(0, qty - 5);
                              setRestockQuantities((prev) => ({ ...prev, [p.id]: nextVal }));
                            }}
                            className="w-6 h-6 rounded-lg bg-background text-text/60 hover:text-text flex items-center justify-center text-xs font-black cursor-pointer"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="0"
                            value={qty}
                            onChange={(e) => {
                              const val = parseInt(e.target.value, 10);
                              setRestockQuantities((prev) => ({ ...prev, [p.id]: isNaN(val) ? 0 : val }));
                            }}
                            className="w-10 text-center font-mono font-bold text-xs text-primary bg-transparent border-none p-0 focus:outline-none focus:ring-0"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const nextVal = qty + 5;
                              setRestockQuantities((prev) => ({ ...prev, [p.id]: nextVal }));
                            }}
                            className="w-6 h-6 rounded-lg bg-background text-text/60 hover:text-text flex items-center justify-center text-xs font-black cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop View: Restock Table */}
            <div className="hidden lg:block w-full overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border border-crisp text-text/60 bg-background font-medium">
                    <th className="py-3.5 px-5 w-12">
                      <input
                        type="checkbox"
                        checked={restockSuggestions.length > 0 && selectedRestockIds.length === restockSuggestions.length}
                        onChange={() => {
                          if (selectedRestockIds.length === restockSuggestions.length) {
                            setSelectedRestockIds([]);
                          } else {
                            setSelectedRestockIds(restockSuggestions.map((s) => s.product.id));
                          }
                        }}
                        className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                      />
                    </th>
                    <th className="py-3.5 px-4">{language === 'th' ? 'รหัส / รายละเอียดสินค้า' : 'SKU & Product Details'}</th>
                    <th className="py-3.5 px-4 text-center">{language === 'th' ? 'ระดับสต็อกปัจจุบัน' : 'Current Stock'}</th>
                    <th className="py-3.5 px-4 text-center">{language === 'th' ? 'ยอดขายรวม (ประวัติ)' : 'Total Historical Sales'}</th>
                    <th className="py-3.5 px-4 text-center">{language === 'th' ? 'ความเร็วการขาย (ADSV)' : 'Sales Velocity (ADSV)'}</th>
                    <th className="py-3.5 px-4 text-center">{language === 'th' ? 'เกณฑ์ปลอดภัยคงเหลือ' : 'Safety Alert Status'}</th>
                    <th className="py-3.5 px-5 text-right w-44">{language === 'th' ? 'จำนวนสั่งซื้อแนะนำ' : 'Smart Suggest Quantity'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {restockSuggestions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-text/40 text-xs">
                        {language === 'th'
                          ? 'ยินดีด้วย! ระดับสต็อกทั้งหมดของคุณอยู่ในระดับปลอดภัยและมีความเสี่ยงต่ำ'
                          : 'Congratulations! All your catalog stock levels are within healthy and safe limits.'}
                      </td>
                    </tr>
                  ) : (
                    restockSuggestions.map((item) => {
                      const p = item.product;
                      const isSelected = selectedRestockIds.includes(p.id);
                      const qty = restockQuantities[p.id] !== undefined ? restockQuantities[p.id] : item.smartRecommendedQty;

                      return (
                        <tr
                          key={p.id}
                          className={`hover:bg-muted transition-colors ${
                            isSelected ? 'bg-amber-500/5 dark:bg-amber-500/2' : ''
                          }`}
                        >
                          <td className="py-3.5 px-5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                setSelectedRestockIds((prev) =>
                                  prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                                );
                              }}
                              className="rounded border-border text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                            />
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-text">{p.name}</div>
                            <div className="text-[10px] text-text/60 font-mono mt-0.5">SKU: {p.sku} | Barcode: {p.barcode}</div>
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span className={`font-mono font-bold text-xs ${
                              p.currentStock <= 0 ? 'text-rose-500' : 'text-amber-500'
                            }`}>
                              {p.currentStock} {p.unitOfMeasure}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono font-semibold text-text/80">
                            {item.vInfo.totalSold} {p.unitOfMeasure}
                          </td>
                          <td className="py-3.5 px-4 text-center font-mono font-semibold text-text/80">
                            {item.vInfo.adsv} {p.unitOfMeasure}/day
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            {item.isOutOfStock ? (
                              <Badge variant="danger" size="sm" dot>
                                {language === 'th' ? 'หมดคลัง' : 'Out of Stock'}
                              </Badge>
                            ) : (
                              <Badge variant="warning" size="sm" dot>
                                {language === 'th' ? 'ต่ำกว่าเกณฑ์ภัย' : 'Below Safety'}
                              </Badge>
                            )}
                          </td>
                          <td className="py-3.5 px-5 text-right">
                            <div className="inline-flex items-center gap-1.5 bg-background border border-border border-crisp rounded-xl p-1 h-9">
                              <button
                                type="button"
                                onClick={() => {
                                  const nextVal = Math.max(0, qty - 5);
                                  setRestockQuantities((prev) => ({ ...prev, [p.id]: nextVal }));
                                }}
                                className="px-2 h-full text-text/60 hover:text-primary hover:bg-muted transition-all font-bold rounded-lg cursor-pointer text-xs"
                              >
                                -5
                              </button>
                              <input
                                type="number"
                                min="0"
                                value={qty}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  setRestockQuantities((prev) => ({ ...prev, [p.id]: isNaN(val) ? 0 : val }));
                                }}
                                className="w-11 text-center font-mono font-bold text-xs text-primary bg-transparent border-none focus:outline-none focus:ring-0 p-0"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const nextVal = qty + 5;
                                  setRestockQuantities((prev) => ({ ...prev, [p.id]: nextVal }));
                                }}
                                className="px-2 h-full text-text/60 hover:text-primary hover:bg-muted transition-all font-bold rounded-lg cursor-pointer text-xs"
                              >
                                +5
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* 6. Bulk Stock Adjustment Modal */}
      <Modal
        isOpen={isBulkAdjustModalOpen}
        onClose={() => setIsBulkAdjustModalOpen(false)}
        title={language === 'th' ? `ปรับปรุงสต็อกแบบกลุ่ม (${selectedProductIds.length} รายการ)` : `Bulk Stock Adjustment (${selectedProductIds.length} items)`}
        maxWidth="md"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setIsBulkAdjustModalOpen(false)}
              disabled={isSubmitting}
            >
              {t.common.cancel}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleConfirmBulkAdjustment}
              isLoading={isSubmitting}
            >
              {t.common.confirm}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-primary/10 border border-primary/30 text-xs text-text">
            {language === 'th'
              ? `การเปลี่ยนแปลงนี้จะถูกนำไปใช้กับสินค้า ${selectedProductIds.length} รายการที่เลือกไว้ในคลังสินค้าพร้อมบันทึกประวัติ Ledger ในครั้งเดียว`
              : `This adjustment will be applied to all ${selectedProductIds.length} selected products simultaneously with audit ledger tracking.`}
          </div>

          <div>
            <label className="block text-xs font-bold text-text/80 mb-1.5">
              {language === 'th' ? 'สาเหตุการปรับปรุงสต็อก' : 'Adjustment Reason'}
            </label>
            <select
              value={bulkAdjustReason}
              onChange={(e) => setBulkAdjustReason(e.target.value as StockMovementReason)}
              className="w-full py-2.5 px-3 rounded-xl border border-border border-crisp bg-card text-xs font-semibold text-text focus:outline-none focus:border-primary"
            >
              <option value="purchase_received">{language === 'th' ? 'รับสินค้าเข้าจากการสั่งซื้อ (Purchase Received)' : 'Purchase Received'}</option>
              <option value="audit_count_adjustment">{language === 'th' ? 'ปรับตามการตรวจนับจริง (Audit Count)' : 'Audit Count Adjustment'}</option>
              <option value="transfer_in">{language === 'th' ? 'โอนเข้าจากสาขาอื่น (Transfer In)' : 'Transfer In'}</option>
              <option value="damaged_write_off">{language === 'th' ? 'ตัดชำรุด / เสียหาย / หมดอายุ (Damaged Write-off)' : 'Damaged / Expired Write-off'}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-bold text-text/80 mb-1.5">
              {language === 'th' ? 'จำนวนที่ต้องการปรับเพิ่ม/ลด (Quantity Delta)' : 'Quantity Delta (+ or -)'}
            </label>
            <input
              type="number"
              value={bulkQuantityDelta}
              onChange={(e) => setBulkQuantityDelta(parseInt(e.target.value, 10) || 0)}
              className="w-full py-2.5 px-3 rounded-xl border border-border border-crisp bg-card text-sm font-mono font-bold text-text focus:outline-none focus:border-primary"
            />
            <div className="flex items-center gap-1.5 mt-2 overflow-x-auto no-scrollbar">
              {[5, 10, 25, 50, 100, -5, -10].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setBulkQuantityDelta(amt)}
                  className="px-2.5 py-1 rounded-lg bg-muted hover:bg-primary/20 hover:text-primary text-xs font-mono font-bold text-text/80 transition-colors cursor-pointer"
                >
                  {amt > 0 ? `+${amt}` : amt}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-text/80 mb-1.5">
              {language === 'th' ? 'หมายเหตุกลุ่ม (Bulk Notes)' : 'Batch Reference Notes'}
            </label>
            <textarea
              value={bulkAdjustNotes}
              onChange={(e) => setBulkAdjustNotes(e.target.value)}
              placeholder={language === 'th' ? 'เช่น ตรวจนับสต็อกประจำสัปดาห์' : 'e.g. Weekly stock audit batch update'}
              rows={2}
              className="w-full p-2.5 rounded-xl border border-border border-crisp bg-card text-xs text-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      </Modal>

      {/* 7. Bulk Pricing Update Modal with Summary Report Confirmation */}
      <Modal
        isOpen={isBulkPricingModalOpen}
        onClose={() => {
          setIsBulkPricingModalOpen(false);
          setBulkPricingStep('configure');
        }}
        title={
          bulkPricingStep === 'configure'
            ? (language === 'th' ? `ปรับราคาขายแบบกลุ่ม (${selectedProductIds.length} รายการ)` : `Bulk Pricing Update (${selectedProductIds.length} items)`)
            : (language === 'th' ? 'รายงานสรุปการปรับราคาแบบกลุ่ม (Summary Report)' : 'Batch Price Update Summary Report')
        }
        maxWidth={bulkPricingStep === 'summary' ? '2xl' : 'md'}
        footer={
          <div className="flex items-center justify-between gap-2 w-full">
            {bulkPricingStep === 'summary' ? (
              <Button
                variant="secondary"
                size="md"
                onClick={() => setBulkPricingStep('configure')}
                disabled={isSubmitting}
              >
                {language === 'th' ? '← ย้อนกลับเพื่อแก้ไข' : '← Back to Edit'}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  setIsBulkPricingModalOpen(false);
                  setBulkPricingStep('configure');
                }}
                disabled={isSubmitting}
              >
                {t.common.cancel}
              </Button>
            )}

            {bulkPricingStep === 'configure' ? (
              <Button
                variant="primary"
                size="md"
                onClick={() => setBulkPricingStep('summary')}
                disabled={selectedProductIds.length === 0}
              >
                {language === 'th' ? 'ดูรายงานสรุป (Review Summary) →' : 'Review Summary Report →'}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="md"
                onClick={handleConfirmBulkPricing}
                isLoading={isSubmitting}
                leftIcon={<CheckCircle2 className="h-4 w-4" />}
              >
                {language === 'th' ? 'ยืนยันและคอมมิตการเปลี่ยนแปลง (Commit Changes)' : 'Commit Changes & Apply'}
              </Button>
            )}
          </div>
        }
      >
        {bulkPricingStep === 'configure' ? (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/30 text-xs text-purple-900 dark:text-purple-200">
              {language === 'th'
                ? `อัปเดตราคาขายปลีกสำหรับสินค้า ${selectedProductIds.length} รายการที่เลือกไว้ทันทีในครั้งเดียว`
                : `Update retail pricing for all ${selectedProductIds.length} selected products in a single atomic transaction.`}
            </div>

            <div>
              <label className="block text-xs font-bold text-text/80 mb-1.5">
                {language === 'th' ? 'ประเภทการปรับราคา' : 'Pricing Adjustment Type'}
              </label>
              <select
                value={bulkPriceChangeType}
                onChange={(e) => setBulkPriceChangeType(e.target.value as any)}
                className="w-full py-2.5 px-3 rounded-xl border border-border border-crisp bg-card text-xs font-semibold text-text focus:outline-none focus:border-primary"
              >
                <option value="percent_markup">{language === 'th' ? 'ปรับเพิ่มขึ้นตามเปอร์เซ็นต์ (%) Markup' : 'Percentage Markup (+%)'}</option>
                <option value="percent_discount">{language === 'th' ? 'ปรับลดลงตามเปอร์เซ็นต์ (%) Discount' : 'Percentage Markdown (-%)'}</option>
                <option value="set_amount">{language === 'th' ? 'กำหนดราคาขายเท่ากันทุกรายการ (Fixed Price)' : 'Set Fixed Exact Price'}</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-text/80 mb-1.5">
                {bulkPriceChangeType === 'set_amount'
                  ? (language === 'th' ? 'กำหนดราคาขาย ($)' : 'Exact Price Amount ($)')
                  : (language === 'th' ? 'อัตราเปอร์เซ็นต์ (%)' : 'Percentage Value (%)')}
              </label>
              <input
                type="number"
                step="0.01"
                value={bulkPriceValue}
                onChange={(e) => setBulkPriceValue(parseFloat(e.target.value) || 0)}
                className="w-full py-2.5 px-3 rounded-xl border border-border border-crisp bg-card text-sm font-mono font-bold text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Top Summary Metric Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Card 1: Affected Items Count */}
              <div className="p-3.5 rounded-2xl bg-card border border-border/80 shadow-2xs space-y-1">
                <div className="text-[11px] font-semibold text-text/60">
                  {language === 'th' ? 'สินค้าที่ได้รับผลกระทบ' : 'Affected Items'}
                </div>
                <div className="text-xl font-bold font-mono text-text flex items-baseline gap-1.5">
                  <span>{pricingSummaryReport.count}</span>
                  <span className="text-xs text-text/50 font-normal">{language === 'th' ? 'รายการ' : 'SKUs'}</span>
                </div>
              </div>

              {/* Card 2: Projected Average Price Shift */}
              <div className="p-3.5 rounded-2xl bg-card border border-border/80 shadow-2xs space-y-1">
                <div className="text-[11px] font-semibold text-text/60">
                  {language === 'th' ? 'การเปลี่ยนแปลงราคาเฉลี่ย' : 'Projected Avg Shift'}
                </div>
                <div className={`text-lg font-bold font-mono flex items-baseline gap-1.5 ${
                  pricingSummaryReport.avgPctShift > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : pricingSummaryReport.avgPctShift < 0
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-text'
                }`}>
                  <span>
                    {pricingSummaryReport.avgPctShift > 0 ? '+' : ''}
                    {pricingSummaryReport.avgPctShift.toFixed(1)}%
                  </span>
                  <span className="text-xs font-mono font-medium opacity-80">
                    ({pricingSummaryReport.avgDeltaCents >= 0 ? '+' : ''}{formatMoney(createMoney(pricingSummaryReport.avgDeltaCents, pricingSummaryReport.currency))})
                  </span>
                </div>
              </div>

              {/* Card 3: Total Portfolio Valuation */}
              <div className="p-3.5 rounded-2xl bg-card border border-border/80 shadow-2xs space-y-1">
                <div className="text-[11px] font-semibold text-text/60">
                  {language === 'th' ? 'มูลค่ารวมก่อน / หลัง' : 'Total Value (Old ➔ New)'}
                </div>
                <div className="text-xs font-mono font-bold text-text flex items-center gap-1 truncate">
                  <span>{formatMoney(createMoney(pricingSummaryReport.totalOldCents, pricingSummaryReport.currency))}</span>
                  <span className="text-text/40">➔</span>
                  <span className="text-primary">{formatMoney(createMoney(pricingSummaryReport.totalNewCents, pricingSummaryReport.currency))}</span>
                </div>
              </div>
            </div>

            {/* Affected Items Preview Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-text/80">
                <span>{language === 'th' ? 'ตัวอย่างรายการที่จะได้รับการปรับราคา' : 'Affected Items Preview'}</span>
                <span className="text-[11px] text-text/50 font-normal">
                  {language === 'th' ? `แสดงทั้งหมด ${pricingSummaryReport.itemResults.length} รายการ` : `Showing all ${pricingSummaryReport.itemResults.length} items`}
                </span>
              </div>

              <div className="max-h-64 overflow-y-auto rounded-xl border border-border/80 bg-background/50 divide-y divide-border/60">
                {pricingSummaryReport.itemResults.map((res) => {
                  const isUp = res.deltaCents > 0;
                  const isDown = res.deltaCents < 0;
                  return (
                    <div key={res.product.id} className="p-2.5 flex items-center justify-between text-xs hover:bg-card/80 transition-colors">
                      <div className="min-w-0 pr-3">
                        <div className="font-bold text-text truncate">{res.product.name}</div>
                        <div className="font-mono text-[10px] text-text/50">SKU: {res.product.sku}</div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-right">
                        <div>
                          <div className="font-mono text-text/60 line-through text-[11px]">
                            {formatMoney(res.product.price)}
                          </div>
                          <div className="font-mono font-bold text-primary text-xs">
                            {formatMoney(createMoney(res.newCents, res.product.price.currency))}
                          </div>
                        </div>
                        <div className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono shrink-0 ${
                          isUp
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                            : isDown
                            ? 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20'
                            : 'bg-muted text-text/70'
                        }`}>
                          {isUp ? '+' : ''}{res.pctShift.toFixed(1)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-[11px] text-blue-900 dark:text-blue-200 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div>
                {language === 'th'
                  ? 'ตรวจสอบความถูกต้องของรายงานสรุปด้านบนแล้วกดปุ่ม "ยืนยันและคอมมิตการเปลี่ยนแปลง" เพื่อบันทึกราคาใหม่ลงในระบบพร้อมบันทึก Audit Ledger ทันที'
                  : 'Review the summary metrics above and click "Commit Changes & Apply" to atomically update pricing and record audit logs.'}
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* 5. Stock Adjustment Modal */}
      {selectedProduct && (
        <Modal
          isOpen={isAdjustModalOpen}
          onClose={() => setIsAdjustModalOpen(false)}
          title={`${t.inventory.adjustStock}: ${selectedProduct.name}`}
          maxWidth="md"
          footer={
            <div className="flex items-center justify-end gap-2 w-full">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setIsAdjustModalOpen(false)}
                disabled={isSubmitting}
              >
                {t.common.cancel}
              </Button>
              <Button
                variant="primary"
                size="md"
                onClick={handleConfirmAdjustment}
                isLoading={isSubmitting}
              >
                {t.common.confirm}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Current Stock vs Resulting Stock Banner */}
            <div className="p-4 rounded-2xl bg-background border border-border border-crisp flex items-center justify-between text-xs">
              <div>
                <span className="text-text/50 block text-[11px]">{language === 'th' ? 'ยอดคงเหลือปัจจุบัน' : 'Current Stock'}</span>
                <span className="font-mono font-bold text-base text-text">
                  {selectedProduct.currentStock} {selectedProduct.unitOfMeasure}
                </span>
              </div>
              <div className="text-center px-2">
                <span className="text-text/50 text-xs">➔</span>
              </div>
              <div className="text-right">
                <span className="text-text/50 block text-[11px]">{language === 'th' ? 'ยอดคงเหลือใหม่' : 'Resulting Stock'}</span>
                <span className="font-mono font-bold text-base text-primary">
                  {Math.max(0, selectedProduct.currentStock + adjustQuantity)} {selectedProduct.unitOfMeasure}
                </span>
              </div>
            </div>

            {/* Reason Selector */}
            <div>
              <label className="block text-xs font-bold text-text/80 mb-1.5">
                {language === 'th' ? 'สาเหตุการปรับปรุงสต็อก' : 'Adjustment Reason'}
              </label>
              <select
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value as StockMovementReason)}
                className="w-full py-2.5 px-3 rounded-xl border border-border border-crisp bg-card text-xs font-semibold text-text focus:outline-none focus:border-primary"
              >
                <option value="purchase_received">{language === 'th' ? 'รับสินค้าเข้าจากการสั่งซื้อ (Purchase Received)' : 'Purchase Received'}</option>
                <option value="audit_count_adjustment">{language === 'th' ? 'ปรับตามการตรวจนับจริง (Audit Count)' : 'Audit Count Adjustment'}</option>
                <option value="transfer_in">{language === 'th' ? 'โอนเข้าจากสาขาอื่น (Transfer In)' : 'Transfer In'}</option>
                <option value="transfer_out">{language === 'th' ? 'โอนออกไปสาขาอื่น (Transfer Out)' : 'Transfer Out'}</option>
                <option value="damaged_write_off">{language === 'th' ? 'ตัดชำรุด / เสียหาย / หมดอายุ (Damaged Write-off)' : 'Damaged / Expired Write-off'}</option>
              </select>
            </div>

            {/* Quantity Delta Input & Quick Preset Steppers */}
            <div>
              <label className="block text-xs font-bold text-text/80 mb-1.5">
                {language === 'th' ? 'จำนวนที่ต้องการปรับ (บวกเพิ่ม หรือ ลบลด)' : 'Quantity Delta (+ or -)'}
              </label>
              <input
                type="number"
                value={adjustQuantity}
                onChange={(e) => setAdjustQuantity(parseInt(e.target.value, 10) || 0)}
                className="w-full py-2.5 px-3 rounded-xl border border-border border-crisp bg-card text-sm font-mono font-bold text-text focus:outline-none focus:border-primary"
              />

              {/* Quick Preset Buttons */}
              <div className="flex items-center gap-1.5 mt-2 overflow-x-auto no-scrollbar">
                {[1, 5, 10, 25, 50, -1, -5].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setAdjustQuantity((prev) => prev + amt)}
                    className="px-2.5 py-1 rounded-lg bg-muted hover:bg-primary/20 hover:text-primary text-xs font-mono font-bold text-text/80 transition-colors cursor-pointer"
                  >
                    {amt > 0 ? `+${amt}` : amt}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-bold text-text/80 mb-1.5">
                {language === 'th' ? 'บันทึกหมายเหตุเพิ่มเติม' : 'Audit Notes & References'}
              </label>
              <textarea
                value={adjustNotes}
                onChange={(e) => setAdjustNotes(e.target.value)}
                placeholder={language === 'th' ? 'เช่น ใบส่งของเลขอ้างอิง PO-2026-0903' : 'e.g. Supplier PO reference or reason for variance'}
                rows={2}
                className="w-full p-2.5 rounded-xl border border-border border-crisp bg-card text-xs text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        </Modal>
      )}

      {/* 6. Shelf Label & QR Code Generator Modal */}
      <ShelfLabelPrintModal
        isOpen={isShelfLabelModalOpen}
        onClose={() => setIsShelfLabelModalOpen(false)}
        products={products}
      />

      {/* 7. Enterprise Bulk Inventory CSV/JSON Upload Modal */}
      <BulkInventoryUploadModal
        isOpen={isBulkUploadModalOpen}
        onClose={() => setIsBulkUploadModalOpen(false)}
        existingProducts={products}
        categories={categories}
        onImportComplete={handleBulkImportComplete}
      />

      {/* 8. Configurable Low Stock Alert Threshold Modal */}
      <LowStockThresholdModal
        isOpen={isThresholdModalOpen}
        onClose={() => setIsThresholdModalOpen(false)}
        threshold={lowStockThreshold}
        onSaveThreshold={handleThresholdChange}
        isHighlightActive={isHighlightLowStockActive}
        onToggleHighlight={handleToggleHighlightLowStock}
        products={products}
        language={language}
        onOpenRestockReport={() => setIsRestockReportModalOpen(true)}
      />

      {/* 8.1 Proactive Restock Needed Report Modal */}
      <RestockNeededReportModal
        isOpen={isRestockReportModalOpen}
        onClose={() => setIsRestockReportModalOpen(false)}
        products={products}
        categories={categories}
        ledgerEntries={ledgerEntries}
        lowStockThreshold={lowStockThreshold}
        onOpenThresholdModal={() => setIsThresholdModalOpen(true)}
        onRestockCompleted={reloadInventoryData}
      />

      {/* 9. AI Inventory Optimization & Replenishment Modal */}
      <InventoryAiOptimizationModal
        isOpen={isAiOptimizationModalOpen}
        onClose={() => setIsAiOptimizationModalOpen(false)}
        products={products}
        categories={categories}
      />

      {/* 10. Hardware Barcode Scanner Stock Lookup Modal */}
      <InventoryBarcodeLookupModal
        isOpen={isBarcodeLookupModalOpen}
        onClose={() => setIsBarcodeLookupModalOpen(false)}
        product={scannedProduct}
        scannedCode={lastScannedBarcode}
        category={categories.find((c) => c.id === scannedProduct?.categoryId)}
        lowStockThreshold={lowStockThreshold}
        onAdjustStock={handleOpenAdjust}
        onSimulateScan={handleInventoryBarcodeScan}
        products={products}
      />
    </div>
  );
};
