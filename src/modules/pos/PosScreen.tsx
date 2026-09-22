import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { useBreadcrumb, BreadcrumbLevel } from '../../context/BreadcrumbContext';
import { useSettings } from '../../context/SettingsContext';
import { createCatalogReadApi } from '../../adapters/catalogApiFactory';
import { Product, Category } from '../../domain/catalog';
import { ProductCard } from './ProductCard';
import { CartPanel } from './CartPanel';
import { SearchInput } from '../../components/common/SearchInput';
import { Skeleton } from '../../components/common/Skeleton';
import { EmptyState } from '../../components/common/EmptyState';
import { Drawer } from '../../components/common/Drawer';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { formatMoney } from '../../domain/money';
import { usePosKeyboardWedgeScanner } from '../../hooks/usePosKeyboardWedgeScanner';
import { playScannerSound } from '../../services/soundService';
import { triggerHaptic } from '../../services/hapticService';
import { BarcodeScannerTesterModal } from './BarcodeScannerTesterModal';
import { QuickPayDrawer } from './QuickPayDrawer';
import { PaymentConfirmationModal } from './PaymentConfirmationModal';
import { PosAiAssistantModal } from './PosAiAssistantModal';
import {
  Barcode,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  AlertCircle,
  Radio,
  Zap,
  CheckCircle2,
  Clipboard,
  Layers,
  Bot,
  Keyboard,
} from 'lucide-react';

export const PosScreen: React.FC = () => {
  const { session } = useAuth();
  const catalogApi = useMemo(() => session ? createCatalogReadApi(session.token) : null, [session]);
  const { addItem, totals, items, clearCart } = useCart();
  const { addToast } = useToast();
  const { t, language } = useLanguage();
  const { setSubLevels } = useBreadcrumb();

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('cat-all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [barcodeInput, setBarcodeInput] = useState<string>('');
  const [isMobileCartOpen, setIsMobileCartOpen] = useState<boolean>(false);
  const [mobileTab, setMobileTab] = useState<'catalog' | 'cart'>('catalog');
  const [isScannerModalOpen, setIsScannerModalOpen] = useState<boolean>(false);
  const [lastRecognizedProduct, setLastRecognizedProduct] = useState<Product | null>(null);
  const [isQuickPayOpen, setIsQuickPayOpen] = useState<boolean>(false);
  const [isFullPaymentModalOpen, setIsFullPaymentModalOpen] = useState<boolean>(false);
  const [isAiModalOpen, setIsAiModalOpen] = useState<boolean>(false);

  // Listen for external or cart-triggered quick-pay requests
  useEffect(() => {
    const handleOpenQuickPay = () => setIsQuickPayOpen(true);
    window.addEventListener('prodx:open-quickpay', handleOpenQuickPay);
    return () => window.removeEventListener('prodx:open-quickpay', handleOpenQuickPay);
  }, []);

  // Sync breadcrumbs with POS navigation depth
  useEffect(() => {
    const activeCategoryObj = categories.find((c) => c.id === selectedCategory);
    const levels: BreadcrumbLevel[] = [];

    if (searchQuery.trim()) {
      levels.push({
        id: 'pos-search',
        label: { th: `ค้นหา: "${searchQuery}"`, en: `Search: "${searchQuery}"` },
        onClick: () => setSearchQuery(''),
      });
    } else if (selectedCategory !== 'cat-all' && activeCategoryObj) {
      levels.push({
        id: 'pos-category',
        label: activeCategoryObj.name,
        onClick: () => setSelectedCategory('cat-all'),
      });
    } else {
      levels.push({
        id: 'pos-all',
        label: { th: 'สินค้าทั้งหมด', en: 'All Items' },
        onClick: () => {
          setSelectedCategory('cat-all');
          setSearchQuery('');
        },
      });
    }

    if (items.length > 0) {
      levels.push({
        id: 'pos-cart',
        label: { th: 'ตะกร้าสินค้า', en: 'Active Cart' },
        badge: items.length,
        onClick: () => setIsMobileCartOpen(true),
      });
    }

    setSubLevels(levels);
  }, [selectedCategory, categories, searchQuery, items.length, setSubLevels]);

  // Automatically switch back to Catalog view and close mobile cart drawers if the cart becomes empty (e.g. after clearCart or new sale)
  useEffect(() => {
    if (items.length === 0) {
      if (mobileTab === 'cart') {
        setMobileTab('catalog');
      }
      if (isMobileCartOpen) {
        setIsMobileCartOpen(false);
      }
    }
  }, [items.length, mobileTab, isMobileCartOpen]);

  const [isBulkAddModalOpen, setIsBulkAddModalOpen] = useState<boolean>(false);
  const [bulkBarcodeInput, setBulkBarcodeInput] = useState<string>('');
  const [isBulkAdding, setIsBulkAdding] = useState<boolean>(false);
  const [focusedProductIndex, setFocusedProductIndex] = useState<number>(-1);

  // Connection monitoring and enabling state
  const [isWindowFocused, setIsWindowFocused] = useState<boolean>(true);
  const [isScannerEnabled, setIsScannerEnabled] = useState<boolean>(true);
  const { config, updateConfig } = useSettings();
  const isKeyboardNavEnabled = config.hardware?.keyboardFocusCapture ?? true;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const handleFocus = () => setIsWindowFocused(true);
    const handleBlur = () => setIsWindowFocused(false);

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Load catalog function
  const loadCatalog = useCallback(async () => {
    if (!session) return;
    setIsLoading(true);
    try {
      const [cats, prods] = await Promise.all([
        catalogApi!.getCategories(),
        catalogApi!.getProducts(),
      ]);
      setCategories([...cats]);
      setProducts([...prods]);
    } catch (err) {
      console.error('[PosScreen] Failed to load catalog:', err);
      addToast({
        title: language === 'th' ? 'เกิดข้อผิดพลาดในการโหลดแคตตาล็อก' : 'Catalog Load Error',
        message: language === 'th' ? 'ไม่สามารถเชื่อมต่อข้อมูลสินค้าจากเซิร์ฟเวอร์ได้' : 'Unable to fetch store catalog from API adapter.',
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  }, [session, addToast, language]);

  // Load catalog on store change
  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  // Listen for completed transactions to trigger a full catalog state refresh (e.g. stock levels sync)
  useEffect(() => {
    const handleOrderCompleted = () => {
      loadCatalog();
    };
    window.addEventListener('prodx:order-completed', handleOrderCompleted);
    return () => {
      window.removeEventListener('prodx:order-completed', handleOrderCompleted);
    };
  }, [loadCatalog]);

  // Global Keyboard Wedge Barcode Scanner Hook for the POS module
  const {
    lastScannedBarcode,
    lastScannedProduct,
    lastScannedAt,
    scanCount,
    isScanning,
    isFlashActive,
    activeIndicator,
    simulateScan,
    clearLastScan,
  } = usePosKeyboardWedgeScanner({
    products,
    enabled: isScannerEnabled && !isLoading,
    maxIntervalMs: 50,
    minLength: 3,
    terminatorKeys: ['Enter', 'NumpadEnter', 'Tab'],
    captureInInputs: true,
    preventDefault: true,
    filterValidSkus: true,
    onItemAdded: (prod) => {
      setLastRecognizedProduct(prod);
    },
  });

  // Handle manual form barcode submission
  const handleBarcodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!barcodeInput.trim()) return;
    simulateScan(barcodeInput.trim());
    setBarcodeInput('');
  };

  const handleBulkAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkBarcodeInput.trim() || !session) return;

    setIsBulkAdding(true);
    const codes = bulkBarcodeInput
      .split(/[\s,;\n]+/)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (codes.length === 0) {
      setIsBulkAdding(false);
      return;
    }

    const addedList: Product[] = [];
    const notFoundList: string[] = [];
    const outOfStockList: Product[] = [];

    for (const code of codes) {
      let prod = products.find(
        (p) =>
          p.barcode.toLowerCase() === code.toLowerCase() ||
          p.sku.toLowerCase() === code.toLowerCase()
      );

      if (!prod) {
        try {
          const remoteProd = await catalogApi!.getProductByBarcode(code);
          if (remoteProd) {
            prod = remoteProd;
          }
        } catch (err) {
          console.error('[BulkAdd] Error loading barcode:', code, err);
        }
      }

      if (prod) {
        if (prod.currentStock <= 0) {
          outOfStockList.push(prod);
        } else {
          addItem(prod, 1, { isBarcodeScan: true });
          addedList.push(prod);
        }
      } else {
        notFoundList.push(code);
      }
    }

    setIsBulkAdding(false);
    setIsBulkAddModalOpen(false);
    setBulkBarcodeInput('');

    if (addedList.length > 0) {
      playScannerSound('success');
      
      let msg = language === 'th'
        ? `เพิ่มสินค้าสำเร็จ ${addedList.length} รายการ`
        : `Successfully added ${addedList.length} items to the cart.`;

      if (outOfStockList.length > 0) {
        msg += language === 'th'
          ? ` (สินค้าหมด ${outOfStockList.length} รายการ)`
          : ` (${outOfStockList.length} items out of stock)`;
      }

      if (notFoundList.length > 0) {
        msg += language === 'th'
          ? ` (ไม่พบ ${notFoundList.length} รายการ: ${notFoundList.slice(0, 3).join(', ')}${notFoundList.length > 3 ? '...' : ''})`
          : ` (${notFoundList.length} not found: ${notFoundList.slice(0, 3).join(', ')}${notFoundList.length > 3 ? '...' : ''})`;
      }

      addToast({
        title: language === 'th' ? 'นำเข้ารหัสบาร์โค้ดแบบกลุ่มสำเร็จ' : 'Bulk Import Complete',
        message: msg,
        type: notFoundList.length > 0 || outOfStockList.length > 0 ? 'warning' : 'success',
      });
    } else {
      playScannerSound('error');
      addToast({
        title: language === 'th' ? 'การนำเข้ารหัสแบบกลุ่มล้มเหลว' : 'Bulk Import Failed',
        message: language === 'th'
          ? `ไม่พบสินค้าหรือสินค้าหมดสต็อกสำหรับบาร์โค้ดที่ระบุ (${codes.length} รหัส)`
          : `No valid or in-stock products found for the provided barcodes (${codes.length} codes).`,
        type: 'error',
      });
    }
  };

  // Filter products by selected category and search string
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesCategory =
        selectedCategory === 'cat-all' || p.categoryId === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.barcode.includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [products, selectedCategory, searchQuery]);

  // Reset focus when filtered products change
  useEffect(() => {
    setFocusedProductIndex(-1);
  }, [filteredProducts]);

  // Keyboard navigation for product grid
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if a modal is open or keyboard nav is disabled
      if (isBulkAddModalOpen || isScannerModalOpen || isMobileCartOpen || !isKeyboardNavEnabled) return;

      const activeTag = document.activeElement?.tagName;
      const isInputFocused = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';

      if (isInputFocused) {
        if (e.key === 'ArrowDown' && document.activeElement?.id === 'pos-search-input') {
          e.preventDefault();
          (document.activeElement as HTMLElement).blur();
          setFocusedProductIndex(0);
          setTimeout(() => {
            document.getElementById(`product-card-0`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 0);
        }
        return;
      }

      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
        
        if (focusedProductIndex === -1) {
          setFocusedProductIndex(0);
          return;
        }

        setFocusedProductIndex((prev) => {
          let next = prev;
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            next = Math.min(prev + 1, filteredProducts.length - 1);
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            next = Math.max(prev - 1, 0);
          }
          
          if (next !== prev) {
            // Give React a tick to update state, then scroll (or just scroll immediately based on the ID we predict)
            setTimeout(() => {
              document.getElementById(`product-card-${next}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 0);
          }
          return next;
        });
      } else if (e.key === 'Enter') {
        if (focusedProductIndex >= 0 && focusedProductIndex < filteredProducts.length) {
          e.preventDefault();
          const prod = filteredProducts[focusedProductIndex];
          if (prod.currentStock > 0) {
            playScannerSound('click');
            addItem(prod, 1);
          }
        }
      } else if (e.key === 'Escape') {
        setFocusedProductIndex(-1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredProducts, focusedProductIndex, addItem, isBulkAddModalOpen, isScannerModalOpen, isMobileCartOpen, isKeyboardNavEnabled]);

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full overflow-hidden bg-background">
      {/* Left Workspace: Top 40% (Controls & Filters) + Body 60% (Catalog & Summary) */}
      <div
        className={`flex-1 flex flex-col h-full min-h-0 min-w-0 overflow-hidden bg-background ${
          mobileTab === 'cart' ? 'hidden lg:flex' : 'flex'
        }`}
      >
        {/* ========================================================================= */}
        {/* TOP SECTION (40% Proportion on Mobile/Tablet, Compact Toolbar on Desktop) */}
        {/* ========================================================================= */}
        <div className="h-[40%] sm:h-[38%] min-h-[220px] max-h-[320px] lg:h-auto flex flex-col shrink-0 border-b border-crisp border-border bg-card shadow-2xs z-20 overflow-hidden">
          {/* Mobile Tab Switcher */}
          <div className="lg:hidden px-3 pt-2.5 pb-2 bg-card border-b border-border/60 flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setMobileTab('catalog')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                mobileTab === 'catalog'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-background text-text/70 hover:text-text border border-border'
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>{language === 'th' ? 'รายการสินค้า (Catalog)' : 'Products'}</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('cart')}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 relative ${
                mobileTab === 'cart'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-background text-text/70 hover:text-text border border-border'
              }`}
            >
              <ShoppingCart className="h-3.5 w-3.5" />
              <span>{language === 'th' ? 'ตะกร้า (Cart)' : 'Cart'}</span>
              {totals.totalItemsCount > 0 && (
                <span className="bg-rose-500 text-white text-[10px] font-black h-4 min-w-[16px] px-1 rounded-full flex items-center justify-center shadow-xs">
                  {totals.totalItemsCount}
                </span>
              )}
            </button>
          </div>

          {/* Unified Search & Barcode Quick Actions Row */}
          <div className="p-2.5 sm:p-3 pb-2 flex flex-col gap-2 shrink-0 overflow-hidden">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <SearchInput
                  id="pos-search-input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onClear={() => setSearchQuery('')}
                  placeholder={t.pos.searchPlaceholder}
                />
              </div>

              {/* AI Cashier Assistant Button */}
              <button
                type="button"
                id="pos-header-ai-assistant-btn"
                onClick={() => {
                  playScannerSound('click');
                  setIsAiModalOpen(true);
                }}
                title={language === 'th' ? 'ผู้ช่วย AI แคชเชียร์ (แนะนำสินค้า & อัพเซลล์)' : 'AI Cashier Assistant & Upselling'}
                className="h-10 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-all shrink-0 active:scale-95 shadow-2xs flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="h-4 w-4 text-yellow-300 animate-pulse" />
                <span className="hidden sm:inline font-bold whitespace-nowrap">
                  {language === 'th' ? 'AI ผู้ช่วย' : 'AI Assistant'}
                </span>
              </button>

              {/* Quick-Pay Action Trigger for Store Managers */}
              <button
                type="button"
                id="pos-header-quickpay-btn"
                disabled={totals.totalItemsCount === 0}
                onClick={() => {
                  if (totals.totalItemsCount === 0) return;
                  playScannerSound('click');
                  triggerHaptic('medium');
                  setIsQuickPayOpen(true);
                }}
                title={language === 'th' ? 'ชำระด่วนสำหรับผู้จัดการ (แตะครั้งเดียว)' : 'Manager Quick-Pay (1-Tap Checkout)'}
                className={`h-10 px-3 rounded-lg border-crisp border flex items-center gap-1.5 font-bold text-xs transition-all shrink-0 active:scale-95 shadow-2xs ${
                  totals.totalItemsCount > 0
                    ? 'bg-amber-500 hover:bg-amber-400 text-black border-amber-400/90 ring-1 ring-amber-400/40 cursor-pointer'
                    : 'bg-card text-text/30 border-border/40 cursor-not-allowed opacity-50'
                }`}
              >
                <Zap className="h-4 w-4 fill-current text-black" />
                <span className="hidden md:inline font-black whitespace-nowrap">
                  {language === 'th' ? 'จ่ายด่วน' : 'Quick-Pay'}
                </span>
                {totals.totalItemsCount > 0 && (
                  <span className="text-[10px] font-mono font-black px-1.5 py-0.5 rounded bg-black/15 text-black">
                    {formatMoney(totals.grandTotal)}
                  </span>
                )}
              </button>

              {/* Bulk Barcode Import Trigger */}
              <button
                type="button"
                onClick={() => {
                  playScannerSound('click');
                  setIsBulkAddModalOpen(true);
                }}
                title={language === 'th' ? 'นำเข้าบาร์โค้ดแบบกลุ่ม' : 'Bulk Barcode Import'}
                className="h-10 min-w-[40px] px-2.5 rounded-lg bg-card hover:bg-background border-crisp border border-border text-text/70 hover:text-text transition-colors cursor-pointer flex items-center justify-center shrink-0 active:scale-95 shadow-2xs"
              >
                <Clipboard className="h-4 w-4" />
              </button>

              {/* Keyboard Nav Toggle */}
              <button
                type="button"
                onClick={() => {
                  playScannerSound('click');
                  updateConfig({ hardware: { ...config.hardware, keyboardFocusCapture: !isKeyboardNavEnabled } });
                }}
                title={language === 'th' ? 'สลับเปิด-ปิดระบบควบคุมด้วยคีย์บอร์ด' : 'Toggle Keyboard Navigation'}
                className={`h-10 min-w-[40px] px-2.5 rounded-lg border-crisp border transition-colors cursor-pointer flex items-center justify-center shrink-0 active:scale-95 shadow-2xs ${
                  isKeyboardNavEnabled 
                    ? 'bg-primary/10 border-primary/30 text-primary' 
                    : 'bg-card hover:bg-background border-border text-text/40 hover:text-text/70'
                }`}
              >
                <Keyboard className="h-4 w-4" />
              </button>

              {/* Hardware Scanner Status & Simulator Launcher */}
              <div className="flex items-center gap-1 bg-card border-crisp border border-border rounded-lg px-2 h-10 shrink-0 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setIsScannerModalOpen(true)}
                  title={language === 'th' ? 'เครื่องสแกนบาร์โค้ดฮาร์ดแวร์ & ตัวจำลอง' : 'Hardware Barcode Scanner & Simulator'}
                  className="py-1 hover:bg-background text-text/70 hover:text-text flex items-center gap-1.5 text-xs font-semibold cursor-pointer rounded-lg transition-all"
                >
                  <div className="relative flex items-center justify-center">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        !isScannerEnabled
                          ? 'bg-border dark:bg-background'
                          : !isWindowFocused
                          ? 'bg-amber-500 animate-pulse'
                          : isScanning
                          ? 'bg-primary animate-ping'
                          : 'bg-emerald-500'
                      }`}
                    />
                  </div>

                  <div className="hidden sm:flex flex-col text-left justify-center">
                    <span className="text-[8px] text-text/50 uppercase font-bold tracking-wider leading-none">
                      {language === 'th' ? 'สแกนเนอร์' : 'HID'}
                    </span>
                    <span className="text-[9px] font-bold text-text leading-tight">
                      {!isScannerEnabled ? (
                        <span className="text-text/50">{language === 'th' ? 'ปิด' : 'Off'}</span>
                      ) : !isWindowFocused ? (
                        <span className="text-amber-500">{language === 'th' ? 'ไม่โฟกัส' : 'Unfocused'}</span>
                      ) : (
                        <span className="text-emerald-500">{language === 'th' ? 'พร้อม' : 'Ready'}</span>
                      )}
                    </span>
                  </div>
                </button>

                <div className="h-3.5 w-px bg-border border-crisp mx-0.5" />

                <button
                  type="button"
                  onClick={() => {
                    playScannerSound('click');
                    setIsScannerEnabled(!isScannerEnabled);
                    addToast({
                      title: language === 'th' ? 'อัปเดตสแกนเนอร์ฮาร์ดแวร์' : 'Scanner Config Updated',
                      message: !isScannerEnabled
                        ? language === 'th'
                          ? 'เปิดใช้งานการดักฟังคีย์บอร์ดแล้ว'
                          : 'Keyboard wedge listener active.'
                        : language === 'th'
                        ? 'ปิดใช้งานเครื่องสแกนชั่วคราวแล้ว'
                        : 'Wedge listener paused to bypass keyboard interrupts.',
                      type: 'info',
                    });
                  }}
                  title={
                    isScannerEnabled
                      ? language === 'th'
                        ? 'คลิกเพื่อหยุดสแกนชั่วคราว'
                        : 'Pause scanner listener'
                      : language === 'th'
                      ? 'คลิกเพื่อเปิดสแกนเนอร์'
                      : 'Activate scanner listener'
                  }
                  className="p-1 flex items-center justify-center text-text/50 hover:text-text transition-colors cursor-pointer rounded hover:bg-background"
                >
                  <div
                    className={`w-6 h-3.5 rounded-full p-0.5 transition-colors duration-200 ease-in-out ${
                      isScannerEnabled ? 'bg-emerald-500' : 'bg-border dark:bg-background'
                    }`}
                  >
                    <div
                      className={`w-2.5 h-2.5 rounded-full bg-white shadow-xs transform duration-200 ease-in-out ${
                        isScannerEnabled ? 'translate-x-2.5' : 'translate-x-0'
                      }`}
                    />
                  </div>
                </button>
              </div>
            </div>

            {/* Direct Barcode Quick Scan Input Row */}
            <form onSubmit={handleBarcodeSubmit} className="flex items-center gap-2 w-full">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder={language === 'th' ? 'สแกน / กรอกรหัสบาร์โค้ดสินค้า...' : 'Scan / Enter Product Barcode...'}
                  className="w-full h-9 rounded-lg border-crisp border border-border bg-card text-xs pl-8 pr-3 py-1 font-mono text-text placeholder-text/40 focus:outline-none focus:ring-2 focus:ring-primary transition-colors"
                />
                <Barcode className="h-3.5 w-3.5 text-text/40 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
              <button
                type="submit"
                disabled={!barcodeInput.trim()}
                className="h-9 px-3.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-bold tracking-wide disabled:opacity-40 cursor-pointer transition-all shrink-0 flex items-center justify-center shadow-2xs active:scale-95"
              >
                {language === 'th' ? 'สแกน' : 'Scan'}
              </button>
            </form>
          </div>

          {/* Categories Carousel Pill Bar (Anchored at base of Top 40%) */}
          <div className="px-2.5 sm:px-3 py-2 border-t border-border/70 bg-card/90 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0 mt-auto">
            {categories.map((cat) => {
              const isSelected = selectedCategory === cat.id;
              const categoryLabel = cat.id === 'cat-all' ? t.pos.allCategories : cat.name;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    playScannerSound('click');
                    setSelectedCategory(cat.id);
                  }}
                  className={`h-8 flex items-center gap-1.5 px-3 rounded-lg text-xs font-bold whitespace-nowrap transition-all cursor-pointer shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    isSelected
                      ? 'bg-primary text-white border-crisp border border-primary'
                      : 'bg-card text-text/70 border-crisp border border-border hover:text-text hover:bg-background active:scale-95'
                  }`}
                >
                  {cat.color && (
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color }}
                    />
                  )}
                  <span>{categoryLabel}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* BODY + BOTTOM SECTION (60% Proportion on Mobile, Full Height on Desktop) */}
        {/* ========================================================================= */}
        <div className="flex-1 h-[60%] sm:h-[62%] lg:h-full min-h-0 flex flex-col relative bg-background overflow-hidden">
          {/* Product Catalog Grid Scroll Area */}
          <div className="flex-1 overflow-y-auto p-2.5 sm:p-3.5 lg:p-4 pb-24 lg:pb-4 no-scrollbar">
            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="rounded-lg border-crisp border border-border bg-card p-3 space-y-2 shadow-2xs"
                  >
                    <Skeleton className="h-3 w-14" />
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                    <div className="pt-2 border-t border-crisp border-border flex justify-between items-center">
                      <Skeleton className="h-4 w-12" />
                      <Skeleton className="h-6 w-6 rounded-lg" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredProducts.length === 0 ? (
              <EmptyState
                icon={<Search className="h-6 w-6 text-text/40" />}
                title={language === 'th' ? 'ไม่พบสินค้า' : 'No Products Found'}
                description={
                  searchQuery
                    ? language === 'th'
                      ? `ไม่มีสินค้าตรงกับคำค้นหา "${searchQuery}"`
                      : `No items match the search query "${searchQuery}".`
                    : language === 'th'
                    ? 'ไม่มีสินค้าในหมวดหมู่นี้'
                    : 'No products found in this category.'
                }
                actionLabel={language === 'th' ? 'ล้างตัวกรอง' : 'Clear Filter'}
                onAction={() => {
                  setSearchQuery('');
                  setSelectedCategory('cat-all');
                }}
                className="my-8 max-w-md mx-auto"
              />
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5 sm:gap-3 content-start">
                {filteredProducts.map((product, index) => (
                  <ProductCard
                    key={product.id}
                    id={`product-card-${index}`}
                    product={product}
                    isFocused={index === focusedProductIndex}
                    onAddToCart={(p) => {
                      playScannerSound('click');
                      addItem(p, 1);
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Bottom Floating Quick Cart Summary Bar */}
          <AnimatePresence>
            {totals.totalItemsCount > 0 && (
              <motion.div
                initial={{ y: 120, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 120, opacity: 0 }}
                className="lg:hidden absolute bottom-3 left-3 right-3 p-2.5 border border-crisp border-primary/20 bg-card/95 backdrop-blur-md flex items-center justify-between shadow-xl rounded-xl z-40 gap-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-text/70 font-semibold truncate">
                    {t.pos.cartTitle} (<span className="font-mono">{totals.totalItemsCount}</span> {t.pos.itemCount})
                  </div>
                  <div className="text-base font-black font-mono text-primary truncate">
                    {formatMoney(totals.grandTotal)}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Quick-Pay CTA on Mobile */}
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('medium');
                      playScannerSound('click');
                      setIsQuickPayOpen(true);
                    }}
                    className="min-h-[42px] h-10 flex items-center gap-1 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-black text-xs shadow-2xs cursor-pointer transition-colors active:scale-95 border border-amber-400"
                  >
                    <Zap className="h-4 w-4 fill-current text-black" />
                    <span>{language === 'th' ? 'จ่ายด่วน' : 'Quick-Pay'}</span>
                  </button>

                  {/* Open Cart Drawer CTA */}
                  <button
                    type="button"
                    onClick={() => setIsMobileCartOpen(true)}
                    className="min-h-[42px] h-10 flex items-center gap-1.5 px-3 rounded-lg bg-primary hover:bg-primary/90 text-white font-bold text-xs shadow-2xs cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 active:scale-95"
                  >
                    <ShoppingCart className="h-4 w-4" />
                    <span className="hidden sm:inline">{t.pos.checkoutBtn}</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Right Side Workspace: Cart Panel (40% width on Desktop) / Mobile Cart View */}
      <div
        className={`w-full lg:w-[40%] xl:w-[38%] h-full min-h-0 shrink-0 border-l border-crisp border-border bg-card ${
          mobileTab === 'cart' ? 'flex flex-col flex-1 lg:flex-initial' : 'hidden lg:block'
        }`}
      >
        <CartPanel onOpenQuickPay={() => setIsQuickPayOpen(true)} />
      </div>

      {/* Mobile Cart Drawer */}
      <Drawer
        isOpen={isMobileCartOpen}
        onClose={() => setIsMobileCartOpen(false)}
        title={t.pos.cartTitle}
        side="right"
        width="w-full sm:max-w-md"
        noPadding={true}
      >
        <div className="h-full flex flex-col">
          <CartPanel
            onOpenQuickPay={() => {
              setIsMobileCartOpen(false);
              setIsQuickPayOpen(true);
            }}
          />
        </div>
      </Drawer>

      {/* Quick-Pay Slide-Over Drawer for Managers */}
      <QuickPayDrawer
        isOpen={isQuickPayOpen}
        onClose={() => setIsQuickPayOpen(false)}
        onOpenFullPaymentModal={() => {
          setIsQuickPayOpen(false);
          setIsFullPaymentModalOpen(true);
        }}
      />

      {/* Full Payment Modal fallback for split/complex payment */}
      <PaymentConfirmationModal
        isOpen={isFullPaymentModalOpen}
        onClose={() => setIsFullPaymentModalOpen(false)}
      />

      {/* Barcode Scanner Simulator & Testing Modal */}
      <BarcodeScannerTesterModal
        isOpen={isScannerModalOpen}
        onClose={() => setIsScannerModalOpen(false)}
        products={products}
        onSimulateScan={(code) => {
          simulateScan(code);
        }}
        lastScannedBarcode={lastScannedBarcode}
        lastScannedAt={lastScannedAt}
        scanCount={scanCount}
      />

      {/* Bulk Add Barcodes Modal */}
      <Modal
        isOpen={isBulkAddModalOpen}
        onClose={() => {
          if (!isBulkAdding) {
            setIsBulkAddModalOpen(false);
            setBulkBarcodeInput('');
          }
        }}
        title={language === 'th' ? 'วางบาร์โค้ดแบบกลุ่ม (Bulk Barcode Import)' : 'Bulk Barcode Import'}
      >
        <form onSubmit={handleBulkAdd} className="space-y-4">
          <div className="space-y-1.5 text-left">
            <label className="text-xs font-bold text-text/70 uppercase tracking-wider">
              {language === 'th' ? 'รายการรหัสบาร์โค้ด' : 'Barcode Entries List'}
            </label>
            <textarea
              rows={6}
              value={bulkBarcodeInput}
              onChange={(e) => setBulkBarcodeInput(e.target.value)}
              disabled={isBulkAdding}
              placeholder={
                language === 'th'
                  ? "วางรหัสบาร์โค้ดคั่นด้วยเครื่องหมายจุลภาค (,), บรรทัดใหม่ หรือเว้นวรรค\ne.g. 8851014111223\n8851014111445\n8852024111333"
                  : "Paste barcodes separated by commas (,), spaces, semicolons (;), or newlines\ne.g. 8851014111223, 8851014111445, 8852024111333"
              }
              className="w-full rounded-lg border-crisp border border-border bg-card p-4 text-xs font-mono text-text placeholder-text/40 focus:outline-none focus:ring-2 focus:ring-primary transition-colors resize-none leading-relaxed"
            />
            <p className="text-[10px] text-text/50 leading-normal">
              {language === 'th'
                ? 'ระบบจะจับคู่กับฐานข้อมูลและเพิ่มสินค้าเข้าตะกร้าโดยอัตโนมัติเฉพาะรายการที่มีสต็อกคงเหลือ'
                : 'Matches entries against store catalog and automatically stages them with 1 unit in your cart.'}
            </p>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-crisp border-border">
            <Button
              type="button"
              variant="secondary"
              disabled={isBulkAdding}
              onClick={() => {
                playScannerSound('click');
                setIsBulkAddModalOpen(false);
                setBulkBarcodeInput('');
              }}
              className="text-xs font-bold rounded-lg border-crisp border-border"
            >
              {language === 'th' ? 'ยกเลิก' : 'Cancel'}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isBulkAdding || !bulkBarcodeInput.trim()}
              isLoading={isBulkAdding}
              leftIcon={<Layers className="h-3.5 w-3.5" />}
              className="text-xs font-bold rounded-lg"
            >
              {language === 'th' ? 'นำเข้าและเพิ่มลงรถเข็น' : 'Import & Stage items'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* POS AI Cashier Assistant Modal */}
      <PosAiAssistantModal
        isOpen={isAiModalOpen}
        onClose={() => setIsAiModalOpen(false)}
        products={products}
        onAddProductToCart={(prod) => {
          addItem(prod, 1);
          setIsAiModalOpen(false);
        }}
      />

      {/* Barcode Scan Visual Feedback Overlays */}
      <AnimatePresence>
        {isFlashActive && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 pointer-events-none z-[9999] border-[6px] border-emerald-500/40 dark:border-emerald-400/40 bg-emerald-500/[0.015]"
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {activeIndicator && (
          <motion.div
            key={activeIndicator.id}
            initial={{ opacity: 0, y: -40, scale: 0.9, x: '-50%' }}
            animate={{ opacity: 1, y: 0, scale: 1, x: '-50%' }}
            exit={{ opacity: 0, y: -20, scale: 0.95, x: '-50%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 24 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 z-[10000] bg-card text-text shadow-2xl border-crisp border border-border rounded-lg px-4 py-3 flex items-center gap-3 backdrop-blur-md w-full max-w-xs sm:max-w-sm"
          >
            <div className="h-8 w-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
              <CheckCircle2 className="h-5 w-5 animate-bounce" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-bold truncate text-text leading-tight">{activeIndicator.name}</div>
              <div className="text-[9px] text-text/50 font-mono flex items-center gap-1.5 mt-0.5">
                <Barcode className="h-3.5 w-3.5 opacity-60 shrink-0 text-primary" />
                <span className="truncate">{activeIndicator.barcode}</span>
                <span className="h-1 w-1 rounded-full bg-border shrink-0" />
                <span className="text-emerald-400 font-bold shrink-0">{activeIndicator.price}</span>
              </div>
            </div>
            <div className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 font-mono font-black text-xs px-2 py-0.5 rounded-lg shrink-0">
              +1
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

