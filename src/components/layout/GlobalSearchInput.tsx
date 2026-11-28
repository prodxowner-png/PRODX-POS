import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  X,
  Package,
  Users,
  User,
  Settings,
  Building2,
  Palette,
  Printer,
  Receipt,
  ShieldCheck,
  Database,
  CornerDownLeft,
  ArrowRight,
  Plus,
  Check,
  Sparkles,
  ShoppingBag,
  Star,
  Phone,
  Mail,
  Sliders,
  Volume2,
  Layers,
  Tag,
  CreditCard,
  Lock,
} from 'lucide-react';
import { NavRoute } from './Sidebar';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { useCart } from '../../context/CartContext';
import { useToast } from '../../context/ToastContext';
import { Product, Category } from '../../domain/catalog';
import { Customer } from '../../domain/order';
import { formatMoney } from '../../domain/money';
import { createCatalogReadApi } from '../../adapters/catalogApiFactory';
import { customersService } from '../../services/customersService';
import { SettingsTabId } from '../../modules/settings/types';
import { useRbac } from '../auth/RbacGuard';

export interface GlobalSearchInputProps {
  currentRoute?: NavRoute;
  onNavigate?: (route: NavRoute) => void;
  onOpenCommandPalette?: () => void;
}

type SearchCategory = 'all' | 'products' | 'customers' | 'settings';

interface ProductResultItem {
  type: 'product';
  id: string;
  product: Product;
  categoryName?: string;
  categoryColor?: string;
  keywords: string;
}

interface CustomerResultItem {
  type: 'customer';
  id: string;
  customer: Customer;
  keywords: string;
}

interface SettingResultItem {
  type: 'setting';
  id: string;
  tabId: SettingsTabId;
  title: { th: string; en: string };
  description: { th: string; en: string };
  icon: React.ReactNode;
  keywords: string;
}

type SearchResultItem = ProductResultItem | CustomerResultItem | SettingResultItem;

export const GlobalSearchInput: React.FC<GlobalSearchInputProps> = ({
  currentRoute,
  onNavigate,
  onOpenCommandPalette,
}) => {
  const { session } = useAuth();
  const catalogApi = useMemo(() => (session ? createCatalogReadApi(session.token) : null), [session]);
  const { canAccessModule } = useRbac();
  const { language } = useLanguage();
  const { addItem, setCustomer } = useCart();
  const { addToast } = useToast();

  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SearchCategory>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Customer[]>(() => customersService.getCustomers());

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Load products & categories from catalog API
  useEffect(() => {
    if (!session || !catalogApi) return;
    let isMounted = true;
    const loadCatalog = async () => {
      try {
        const [prods, cats] = await Promise.all([
          catalogApi.getProducts(session.currentStore.id),
          catalogApi.getCategories(session.currentStore.id),
        ]);
        if (isMounted) {
          setProducts(prods as Product[]);
          setCategories(cats as Category[]);
        }
      } catch (err) {
        console.error('Failed to load catalog for GlobalSearchInput', err);
      }
    };
    loadCatalog();
    return () => {
      isMounted = false;
    };
  }, [session, catalogApi]);

  // Subscribe to customers updates
  useEffect(() => {
    const unsubscribe = customersService.subscribe(() => {
      setCustomers(customersService.getCustomers());
    });
    return unsubscribe;
  }, []);

  const isMac = useMemo(() => {
    if (typeof navigator === 'undefined') return true;
    return /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent || '');
  }, []);

  const shortcutKeyLabel = isMac ? '⌘K' : 'Ctrl+K';

  // Global Keyboard listener for `/`
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Allow Ctrl+K / Cmd+K to pass through to Command Palette and close inline dropdown
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        setIsOpen(false);
        return;
      }

      // Pressing `/` when not focused on an interactive input opens quick search
      const activeEl = document.activeElement;
      const isInputActive =
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        activeEl?.getAttribute('contenteditable') === 'true';

      if (e.key === '/' && !isInputActive) {
        e.preventDefault();
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
        setIsOpen(true);
      }
    };

    const handleCustomOpen = () => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
      setIsOpen(true);
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('prodx:open-global-search', handleCustomOpen);

    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('prodx:open-global-search', handleCustomOpen);
    };
  }, []);

  // Click outside listener to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Map category lookup
  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    categories.forEach((c) => map.set(c.id, c));
    return map;
  }, [categories]);

  // Predefined Settings Search Registry
  const settingsRegistry = useMemo<SettingResultItem[]>(() => {
    return [
      {
        type: 'setting',
        id: 'set-general',
        tabId: 'general',
        title: {
          th: 'ข้อมูลสาขาและโปรไฟล์ร้าน (Store Profile)',
          en: 'General Store Profile & Identity',
        },
        description: {
          th: 'ชื่อร้านค้า, รหัสสาขา, ที่อยู่, เบอร์โทร, สกุลเงินหลัก, ข้อความหัว-ท้ายใบเสร็จ',
          en: 'Store name, branch code, address, phone, currency, receipt header & footer message',
        },
        icon: <Building2 className="h-4 w-4 text-blue-500" />,
        keywords:
          'general store profile name branch code address phone currency timezone receipt header footer สาขา ข้อมูลร้าน ที่อยู่ เบอร์โทร สกุลเงิน ใบเสร็จ',
      },
      {
        type: 'setting',
        id: 'set-appearance',
        tabId: 'appearance',
        title: {
          th: 'รูปลักษณ์, ธีมระบบ และจอฝั่งลูกค้า (Appearance & CFD)',
          en: 'Appearance, Themes & Customer Display',
        },
        description: {
          th: 'ธีมองค์กร Enterprise Blue / Obsidian, โหมดมืด/สว่าง, โลโก้, ปรับแต่งหน้าจอลูกค้า CFD',
          en: 'Enterprise themes, dark/light mode, logo upload, customer facing display banner',
        },
        icon: <Palette className="h-4 w-4 text-brand-text-accent" />,
        keywords:
          'appearance theme preset enterprise blue deep obsidian dark light mode cfd customer display banner logo รูปลักษณ์ ธีม โหมดมืด สว่าง จอลูกค้า โลโก้ สี',
      },
      {
        type: 'setting',
        id: 'set-hardware',
        tabId: 'hardware',
        title: {
          th: 'อุปกรณ์ต่อพ่วง, เครื่องพิมพ์ และเสียง (Hardware & Audio)',
          en: 'Hardware, Thermal Printer & Sound',
        },
        description: {
          th: 'เครื่องพิมพ์ใบเสร็จความร้อน ESC/POS, ลิ้นชักเก็บเงินอัตโนมัติ, เสียงสแกนเนอร์บาร์โค้ด',
          en: 'Thermal receipt printer, auto cash drawer kick pulse, barcode scan beep & volume',
        },
        icon: <Printer className="h-4 w-4 text-amber-500" />,
        keywords:
          'hardware printer thermal receipt escpos cash drawer pulse beep sound volume barcode scanner อุปกรณ์ เครื่องพิมพ์ ลิ้นชัก เสียง สแกนเนอร์ บาร์โค้ด',
      },
      {
        type: 'setting',
        id: 'set-tax',
        tabId: 'tax_accounting',
        title: {
          th: 'การเงิน, ภาษีมูลค่าเพิ่ม และช่องทางชำระเงิน (Tax & Payment)',
          en: 'Tax & Accounting, VAT & Payment Methods',
        },
        description: {
          th: 'อัตรา VAT 7%, เลขประจำตัวผู้เสียภาษี, ราคารวม/แยกภาษี, เงินสด, บัตรเครดิต, PromptPay QR',
          en: 'VAT 7% rate, tax identification ID, tax inclusive/exclusive, Cash, Card, PromptPay QR',
        },
        icon: <Receipt className="h-4 w-4 text-emerald-500" />,
        keywords:
          'tax accounting vat rate 7% tax id inclusive exclusive payment rails cash card promptpay split การเงิน ภาษี มูลค่าเพิ่ม เลขภาษี ชำระเงิน เงินสด บัตร พร้อมเพย์',
      },
      {
        type: 'setting',
        id: 'set-security',
        tabId: 'security_roles',
        title: {
          th: 'ความปลอดภัย, รหัส PIN และสิทธิ์การใช้งาน (Security & Roles)',
          en: 'Security Policies, PIN Codes & Permissions',
        },
        description: {
          th: 'รหัส PIN พนักงาน, ล็อกหน้าจออัตโนมัติ, การอนุมัติยกเลิกบิล, แก้ไขราคา, สิทธิ์ RBAC',
          en: 'Staff PIN codes, auto-lock timeout, void authorizations, price override, RBAC roles',
        },
        icon: <ShieldCheck className="h-4 w-4 text-brand-text-accent" />,
        keywords:
          'security pin code auto lock timeout void authorization discount price override refund cashier manager admin rbac ความปลอดภัย รหัส พิน ล็อกหน้าจอ ยกเลิกบิล สิทธิ์ ผู้จัดการ',
      },
      {
        type: 'setting',
        id: 'set-sync',
        tabId: 'data_sync',
        title: {
          th: 'การสำรองข้อมูล, คิว Outbox และระบบออฟไลน์ (Offline & Data Sync)',
          en: 'Offline Cache, Outbox Queue & Diagnostics',
        },
        description: {
          th: 'รายการขายรอซิงก์ Outbox, แคชออฟไลน์ IndexedDB, การรีเซ็ตข้อมูลระบบ และตรวจสภาพเครื่อง',
          en: 'Outbox sync queue, IndexedDB local cache, emergency system reset, diagnostic health',
        },
        icon: <Database className="h-4 w-4 text-cyan-500" />,
        keywords:
          'offline sync data outbox queue indexeddb local cache reset clear diagnostics network ซิงก์ ข้อมูล ออฟไลน์ สำรอง ล้างข้อมูล ตรวจสอบ แคช',
      },
    ];
  }, []);

  // Build searchable items
  const allSearchableItems = useMemo<SearchResultItem[]>(() => {
    const list: SearchResultItem[] = [];

    // 1. Products
    products.forEach((p) => {
      const cat = categoryMap.get(p.categoryId);
      list.push({
        type: 'product',
        id: `prod-${p.id}`,
        product: p,
        categoryName: cat?.name || p.categoryId,
        categoryColor: cat?.color,
        keywords: `${p.name} ${p.sku} ${p.barcode} ${cat?.name || ''} ${p.description || ''}`.toLowerCase(),
      });
    });

    // 2. Customers
    customers.forEach((c) => {
      list.push({
        type: 'customer',
        id: `cust-${c.id}`,
        customer: c,
        keywords: `${c.name} ${c.phone} ${c.email} ${c.loyaltyTier} ${c.loyaltyPoints}`.toLowerCase(),
      });
    });

    // 3. Settings (only included if active session has permission for settings)
    if (canAccessModule('settings')) {
      settingsRegistry.forEach((s) => {
        list.push({
          type: 'setting',
          id: s.id,
          tabId: s.tabId,
          title: s.title,
          description: s.description,
          icon: s.icon,
          keywords: `${s.title.th} ${s.title.en} ${s.description.th} ${s.description.en} ${s.keywords}`.toLowerCase(),
        });
      });
    }

    return list;
  }, [products, customers, settingsRegistry, categoryMap, canAccessModule]);

  // Filter items by active tab and search query
  const filteredResults = useMemo(() => {
    let result = allSearchableItems;

    if (activeTab === 'products') {
      result = result.filter((item) => item.type === 'product');
    } else if (activeTab === 'customers') {
      result = result.filter((item) => item.type === 'customer');
    } else if (activeTab === 'settings') {
      result = result.filter((item) => item.type === 'setting');
    }

    const q = query.toLowerCase().trim();
    if (q) {
      const terms = q.split(/\s+/).filter(Boolean);
      result = result.filter((item) => {
        return terms.every((term) => item.keywords.includes(term));
      });
    }

    return result;
  }, [allSearchableItems, activeTab, query]);

  // Reset or clamp selectedIndex when results change
  useEffect(() => {
    setSelectedIndex((prev) => {
      if (filteredResults.length === 0) return 0;
      if (prev >= filteredResults.length) return filteredResults.length - 1;
      return prev < 0 ? 0 : prev;
    });
  }, [filteredResults.length]);

  // Scroll active item into view
  useEffect(() => {
    if (itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex]);

  // Action execution for selected item
  const handleSelectItem = (item: SearchResultItem) => {
    if (item.type === 'product') {
      addItem(item.product, 1);
      addToast({
        type: 'success',
        title:
          language === 'th'
            ? `เพิ่ม ${item.product.name} ลงในตะกร้าแล้ว (${formatMoney(item.product.price)})`
            : `Added ${item.product.name} to cart (${formatMoney(item.product.price)})`,
      });
      if (currentRoute !== 'pos' && onNavigate) {
        onNavigate('pos');
      }
      setIsOpen(false);
      inputRef.current?.blur();
    } else if (item.type === 'customer') {
      setCustomer(item.customer);
      addToast({
        type: 'info',
        title:
          language === 'th'
            ? `เลือกลูกค้า: ${item.customer.name} (${item.customer.loyaltyTier})`
            : `Selected Customer: ${item.customer.name} (${item.customer.loyaltyTier})`,
      });
      if (onNavigate) {
        // If already in POS, keep in POS; otherwise navigate to customers
        if (currentRoute === 'pos') {
          // stay in pos
        } else {
          onNavigate('customers');
        }
      }
      setIsOpen(false);
      inputRef.current?.blur();
    } else if (item.type === 'setting') {
      localStorage.setItem('prodx_pos_settings_tab', item.tabId);
      window.dispatchEvent(
        new CustomEvent('prodx:open-settings-tab', { detail: { tab: item.tabId } })
      );
      if (onNavigate) {
        onNavigate('settings');
      }
      addToast({
        type: 'info',
        title:
          language === 'th'
            ? `เปิดหน้าต่างการตั้งค่า: ${item.title.th}`
            : `Opened Settings: ${item.title.en}`,
      });
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  // Keyboard navigation inside input & list
  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredResults.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
        return;
      }
      setSelectedIndex((prev) =>
        prev <= 0 ? Math.max(0, filteredResults.length - 1) : prev - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && filteredResults[selectedIndex]) {
        handleSelectItem(filteredResults[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  // Group counts for category pills
  const counts = useMemo(() => {
    const q = query.toLowerCase().trim();
    const filterByQ = (items: SearchResultItem[]) => {
      if (!q) return items.length;
      const terms = q.split(/\s+/).filter(Boolean);
      return items.filter((item) => terms.every((term) => item.keywords.includes(term))).length;
    };

    const prodItems = allSearchableItems.filter((i) => i.type === 'product');
    const custItems = allSearchableItems.filter((i) => i.type === 'customer');
    const settItems = allSearchableItems.filter((i) => i.type === 'setting');

    return {
      all: filterByQ(allSearchableItems),
      products: filterByQ(prodItems),
      customers: filterByQ(custItems),
      settings: filterByQ(settItems),
    };
  }, [allSearchableItems, query]);

  // Helper highlighting function for keywords
  const renderHighlighted = (text: string, highlight: string) => {
    if (!highlight.trim()) return text;
    const parts = text.split(new RegExp(`(${highlight.trim()})`, 'gi'));
    return (
      <span>
        {parts.map((part, i) =>
          part.toLowerCase() === highlight.toLowerCase().trim() ? (
            <mark key={i} className="bg-primary/20 text-primary font-bold rounded-xs px-0.5">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-xs md:max-w-md lg:max-w-lg">
      {/* Search Input Bar in TopNav */}
      <div
        className={`relative flex items-center w-full rounded-xl border bg-background/80 transition-all duration-150 ${
          isOpen
            ? 'border-primary ring-2 ring-primary/20 bg-card shadow-md'
            : 'border-border border-crisp hover:bg-background hover:border-text/30'
        }`}
      >
        <div className="pl-3 pr-2 text-brand-text-secondary flex items-center justify-center shrink-0 pointer-events-none">
          <Search className="h-4 w-4" />
        </div>

        <input
          ref={inputRef}
          type="text"
          id="global-top-search-input"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setSelectedIndex(0);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={
            language === 'th'
              ? `ค้นหาสินค้า, ลูกค้า, ตั้งค่า... (${shortcutKeyLabel})`
              : `Search products, customers, settings... (${shortcutKeyLabel})`
          }
          className="w-full py-1.5 md:py-2 text-xs text-text placeholder:text-brand-text-secondary bg-transparent focus:outline-hidden font-medium"
          autoComplete="off"
          spellCheck="false"
        />

        {/* Clear Button / Shortcut indicator */}
        <div className="flex items-center gap-1.5 pr-2.5 shrink-0">
          {query ? (
            <button
              type="button"
              id="global-search-clear-btn"
              onClick={() => {
                setQuery('');
                setSelectedIndex(0);
                inputRef.current?.focus();
              }}
              className="p-1 rounded-md text-brand-text-secondary hover:text-text hover:bg-card transition-colors cursor-pointer"
              title="Clear search (ESC)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <kbd className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono tabular-nums rounded bg-card border border-border border-crisp text-text/60 font-semibold shadow-2xs">
                {shortcutKeyLabel}
              </kbd>
              <kbd className="hidden lg:inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono tabular-nums rounded bg-card border border-border border-crisp text-brand-text-secondary font-semibold">
                /
              </kbd>
            </div>
          )}
        </div>
      </div>

      {/* Dropdown Results Popover */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-card border border-border border-crisp rounded-2xl shadow-2xl z-50 overflow-hidden flex flex-col max-h-[75vh] animate-in fade-in zoom-in-95 duration-100">
          {/* Filter Category Tabs Header */}
          <div className="px-3 py-2 border-b border-border border-crisp bg-background/50 flex items-center gap-1.5 overflow-x-auto shrink-0 no-scrollbar">
            {(
              [
                {
                  id: 'all',
                  label: language === 'th' ? 'ทั้งหมด' : 'All',
                  count: counts.all,
                  icon: <Sparkles className="h-3 w-3" />,
                },
                {
                  id: 'products',
                  label: language === 'th' ? 'สินค้า' : 'Products',
                  count: counts.products,
                  icon: <Package className="h-3 w-3" />,
                },
                {
                  id: 'customers',
                  label: language === 'th' ? 'ลูกค้า' : 'Customers',
                  count: counts.customers,
                  icon: <Users className="h-3 w-3" />,
                },
                {
                  id: 'settings',
                  label: language === 'th' ? 'ตั้งค่า' : 'Settings',
                  count: counts.settings,
                  icon: <Settings className="h-3 w-3" />,
                },
              ] as const
            ).map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setSelectedIndex(0);
                    inputRef.current?.focus();
                  }}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150 active:scale-95 cursor-pointer flex items-center gap-1.5 ${
                    isActive
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'bg-card border border-border border-crisp text-text/70 hover:bg-background hover:text-text'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                  <span
                    className={`text-[10px] font-mono tabular-nums px-1.5 py-0.2 rounded-full ${
                      isActive ? 'bg-white/20 text-white' : 'bg-background text-brand-text-secondary'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Results List */}
          <div
            ref={resultsRef}
            className="flex-1 overflow-y-auto p-2 space-y-1 divide-y divide-transparent no-scrollbar"
          >
            {filteredResults.length === 0 ? (
              <div className="py-10 px-4 text-center">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary mx-auto flex items-center justify-center mb-2.5">
                  <Search className="h-5 w-5" />
                </div>
                <h4 className="text-xs font-bold text-text">
                  {language === 'th' ? 'ไม่พบข้อมูลที่ตรงกับการค้นหา' : 'No matching results found'}
                </h4>
                <p className="text-[11px] text-brand-text-secondary mt-1 max-w-xs mx-auto">
                  {language === 'th'
                    ? 'ลองค้นหาด้วยชื่อสินค้า, รหัส SKU, ชื่อลูกค้า, เบอร์โทร, หรือชื่อการตั้งค่า'
                    : 'Try searching by product name, SKU, customer name, phone number, or setting keyword'}
                </p>
              </div>
            ) : (
              filteredResults.map((item, index) => {
                const isSelected = selectedIndex === index;

                // 1. PRODUCT ROW
                if (item.type === 'product') {
                  const prod = item.product;
                  const catColor = item.categoryColor || 'var(--primary-color)';
                  const isOutOfStock = prod.currentStock <= 0;
                  const isLowStock =
                    prod.currentStock > 0 && prod.currentStock <= prod.reorderPoint;

                  return (
                    <div
                      key={item.id}
                      ref={(el) => {
                        itemRefs.current[index] = el;
                      }}
                      onClick={() => handleSelectItem(item)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`group p-2.5 rounded-xl transition-all duration-150 active:scale-[0.99] cursor-pointer flex items-center justify-between border ${
                        isSelected
                          ? 'bg-primary/10 border-primary/40 shadow-xs'
                          : 'bg-transparent border-transparent hover:bg-background'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-border"
                          style={{ backgroundColor: `${catColor}15`, color: catColor }}
                        >
                          <Package className="h-4 w-4" />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-xs font-bold truncate ${
                                isSelected ? 'text-primary' : 'text-text'
                              }`}
                            >
                              {renderHighlighted(prod.name, query)}
                            </span>
                            <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-background border border-border text-text/60 shrink-0">
                              {prod.sku}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-brand-text-secondary">
                            <span className="truncate">{item.categoryName}</span>
                            <span>·</span>
                            <span
                              className={
                                isOutOfStock
                                  ? 'text-rose-500 font-semibold'
                                  : isLowStock
                                  ? 'text-amber-500 font-semibold'
                                  : 'text-emerald-600 dark:text-emerald-400 font-medium'
                              }
                            >
                              {isOutOfStock
                                ? language === 'th'
                                  ? 'สินค้าหมด'
                                  : 'Out of Stock'
                                : `${prod.currentStock} ${prod.unitOfMeasure}`}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0 ml-2">
                        <span className="text-xs font-mono tabular-nums font-bold text-text">
                          {formatMoney(prod.price)}
                        </span>

                        <div
                          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                            isSelected
                              ? 'bg-primary text-primary-foreground shadow-xs'
                              : 'bg-background border border-border text-text/70 group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary'
                          }`}
                        >
                          <Plus className="h-3 w-3" />
                          <span>{language === 'th' ? 'ใส่ตะกร้า' : 'Add'}</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                // 2. CUSTOMER ROW
                if (item.type === 'customer') {
                  const cust = item.customer;
                  const tierColors: Record<string, string> = {
                    VIP: 'bg-primary/10 text-brand-text-accent border-primary/30',
                    Gold: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30',
                    Silver: 'bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-500/30',
                    Bronze: 'bg-primary/10 text-primary dark:text-orange-400 border-primary/30',
                  };

                  return (
                    <div
                      key={item.id}
                      ref={(el) => {
                        itemRefs.current[index] = el;
                      }}
                      onClick={() => handleSelectItem(item)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`group p-2.5 rounded-xl transition-all duration-150 active:scale-[0.99] cursor-pointer flex items-center justify-between border ${
                        isSelected
                          ? 'bg-primary/10 border-primary/40 shadow-xs'
                          : 'bg-transparent border-transparent hover:bg-background'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0 font-bold text-xs">
                          {cust.name
                            .split(' ')
                            .map((n) => n[0])
                            .join('')
                            .slice(0, 2)}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-xs font-bold truncate ${
                                isSelected ? 'text-primary' : 'text-text'
                              }`}
                            >
                              {renderHighlighted(cust.name, query)}
                            </span>
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                                tierColors[cust.loyaltyTier] ||
                                'bg-background border-border text-text/70'
                              }`}
                            >
                              {cust.loyaltyTier}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-brand-text-secondary">
                            <span className="font-mono tabular-nums flex items-center gap-1">
                              <Phone className="h-2.5 w-2.5 opacity-60" />
                              {renderHighlighted(cust.phone, query)}
                            </span>
                            <span>·</span>
                            <span className="truncate">{renderHighlighted(cust.email, query)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 shrink-0 ml-2">
                        <span className="text-[11px] font-mono tabular-nums font-bold text-primary">
                          {cust.loyaltyPoints} {language === 'th' ? 'แต้ม' : 'pts'}
                        </span>

                        <div
                          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                            isSelected
                              ? 'bg-primary text-primary-foreground shadow-xs'
                              : 'bg-background border border-border text-text/70 group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary'
                          }`}
                        >
                          <span>{language === 'th' ? 'เลือกลูกค้า' : 'Select'}</span>
                          <CornerDownLeft className="h-3 w-3" />
                        </div>
                      </div>
                    </div>
                  );
                }

                // 3. SETTING ROW
                if (item.type === 'setting') {
                  return (
                    <div
                      key={item.id}
                      ref={(el) => {
                        itemRefs.current[index] = el;
                      }}
                      onClick={() => handleSelectItem(item)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={`group p-2.5 rounded-xl transition-all duration-150 active:scale-[0.99] cursor-pointer flex items-center justify-between border ${
                        isSelected
                          ? 'bg-primary/10 border-primary/40 shadow-xs'
                          : 'bg-transparent border-transparent hover:bg-background'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`p-2 rounded-lg shrink-0 border border-border ${
                            isSelected ? 'bg-primary text-primary-foreground' : 'bg-background text-text/70'
                          }`}
                        >
                          {item.icon}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-xs font-bold truncate ${
                                isSelected ? 'text-primary' : 'text-text'
                              }`}
                            >
                              {renderHighlighted(
                                language === 'th' ? item.title.th : item.title.en,
                                query
                              )}
                            </span>
                            <span className="text-[9px] font-mono tabular-nums uppercase px-1.5 py-0.2 rounded bg-background border border-border text-brand-text-secondary shrink-0">
                              {item.tabId}
                            </span>
                          </div>

                          <p className="text-[11px] text-brand-text-secondary truncate mt-0.5">
                            {language === 'th' ? item.description.th : item.description.en}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <div
                          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                            isSelected
                              ? 'bg-primary text-primary-foreground shadow-xs'
                              : 'bg-background border border-border text-text/70 group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary'
                          }`}
                        >
                          <span>{language === 'th' ? 'ไปที่ตั้งค่า' : 'Open'}</span>
                          <ArrowRight className="h-3 w-3" />
                        </div>
                      </div>
                    </div>
                  );
                }

                return null;
              })
            )}
          </div>

          {/* Footer Shortcuts Hint */}
          <div className="px-3 py-2 border-t border-border border-crisp bg-background/50 flex items-center justify-between text-[10px] text-brand-text-secondary shrink-0">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <kbd className="px-1 py-0.2 rounded bg-card border border-border font-mono tabular-nums">↑↓</kbd>
                <span>{language === 'th' ? 'เลื่อน' : 'Navigate'}</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="px-1 py-0.2 rounded bg-card border border-border font-mono tabular-nums">↵</kbd>
                <span>{language === 'th' ? 'เลือก' : 'Select'}</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="px-1 py-0.2 rounded bg-card border border-border font-mono tabular-nums">
                  ESC
                </kbd>
                <span>{language === 'th' ? 'ปิด' : 'Close'}</span>
              </div>
            </div>

            <div className="font-mono tabular-nums opacity-70">
              {filteredResults.length} {language === 'th' ? 'รายการ' : 'matches'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
