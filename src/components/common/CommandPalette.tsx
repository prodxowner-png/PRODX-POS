import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Search,
  X,
  ShoppingCart,
  LayoutGrid,
  ReceiptText,
  Receipt,
  Boxes,
  Banknote,
  Users,
  User,
  ShieldCheck,
  Settings,
  Clock,
  Trash2,
  Sun,
  Moon,
  Wifi,
  WifiOff,
  RefreshCw,
  Globe,
  Shield,
  UserCheck,
  LogOut,
  Package,
  Layers,
  ArrowRight,
  CornerDownLeft,
  Check,
  Star,
  Phone,
  Mail,
  Calendar,
  AlertCircle,
  ExternalLink,
  CloudUpload,
} from 'lucide-react';
import { NavRoute } from '../layout/Sidebar';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { useOffline } from '../../context/OfflineContext';
import { useCart } from '../../context/CartContext';
import { useShift } from '../../context/ShiftContext';
import { useToast } from '../../context/ToastContext';
import { getZIndexClass } from '../../utils/ZIndexManager';
import { Product, Category } from '../../domain/catalog';
import { Customer, Order } from '../../domain/order';
import { formatMoney } from '../../domain/money';
import { createCatalogReadApi } from '../../adapters/catalogApiFactory';
import { createOrderReadApi } from '../../adapters/orderReadApiFactory';
import { customersService } from '../../services/customersService';
import { useRbac } from '../auth/RbacGuard';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  currentRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
  onOpenHoldModal?: () => void;
}

export type PaletteCategory =
  | 'all'
  | 'products'
  | 'customers'
  | 'orders'
  | 'navigation'
  | 'actions';

interface BaseCommandItem {
  id: string;
  category: PaletteCategory;
  keywords: string;
}

interface ProductCommandItem extends BaseCommandItem {
  category: 'products';
  product: Product;
  categoryName?: string;
  categoryColor?: string;
}

interface CustomerCommandItem extends BaseCommandItem {
  category: 'customers';
  customer: Customer;
}

interface OrderCommandItem extends BaseCommandItem {
  category: 'orders';
  order: Order;
}

interface NavCommandItem extends BaseCommandItem {
  category: 'navigation';
  route: NavRoute;
  title: string;
  description: string;
  icon: React.ReactNode;
  shortcut?: string;
  isCurrent: boolean;
}

interface ActionCommandItem extends BaseCommandItem {
  category: 'actions';
  title: string;
  description: string;
  icon: React.ReactNode;
  badge?: string;
  badgeVariant?: 'default' | 'warning' | 'success' | 'danger' | 'info';
  shortcut?: string;
  disabled?: boolean;
  onExecute: () => void;
}

type CommandItem =
  | ProductCommandItem
  | CustomerCommandItem
  | OrderCommandItem
  | NavCommandItem
  | ActionCommandItem;

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  currentRoute,
  onNavigate,
  onOpenHoldModal,
}) => {
  const { session, logout, switchDemoRole, can } = useAuth();
  const catalogApi = useMemo(() => (session ? createCatalogReadApi(session.token) : null), [session]);
  const orderReadApi = useMemo(() => (session ? createOrderReadApi(session.token) : null), [session]);
  const { canAccessModule } = useRbac();
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const {
    isOnline,
    isSimulatedOffline,
    toggleSimulatedOffline,
    pendingCount,
    isSyncing,
    triggerSync,
    openSyncActivity,
  } = useOffline();
  const {
    items: cartItems,
    addItem,
    setCustomer,
    holdCurrentCart,
    clearCart,
    heldCarts,
  } = useCart();
  const { currentShift } = useShift();
  const { addToast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<PaletteCategory>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Domain data collections
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Load catalog, customers, and recent orders
  useEffect(() => {
    if (!isOpen || !session || !catalogApi || !orderReadApi) return;
    let isMounted = true;

    const loadData = async () => {
      try {
        const [prods, cats, ords] = await Promise.all([
          catalogApi!.getProducts(session.currentStore.id),
          catalogApi!.getCategories(session.currentStore.id),
          orderReadApi.getOrders(session.currentStore.id, 50, session.registerId),
        ]);
        if (!isMounted) return;
        setProducts(prods as Product[]);
        setCategories(cats as Category[]);
        setOrders(ords as Order[]);
        setCustomers(customersService.getCustomers());
      } catch (err) {
        console.error('Failed to load CommandPalette dataset:', err);
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [isOpen, session, catalogApi, orderReadApi]);

  // Subscribe to customers updates
  useEffect(() => {
    const unsubscribe = customersService.subscribe(() => {
      setCustomers(customersService.getCustomers());
    });
    return unsubscribe;
  }, []);

  // Listen to order completion events to keep recent orders fresh
  useEffect(() => {
    const handleOrderCompleted = () => {
      if (session?.currentStore.id) {
        orderReadApi.getOrders(session.currentStore.id, 50, session.registerId).then((ords) => {
          setOrders(ords as Order[]);
        });
      }
    };
    window.addEventListener('prodx:order-completed', handleOrderCompleted);
    return () => {
      window.removeEventListener('prodx:order-completed', handleOrderCompleted);
    };
  }, [session?.currentStore.id]);

  // Focus input when opened & reset search
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
      setSelectedIndex(0);
      setActiveTab('all');
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen]);

  // Helper category lookup
  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    categories.forEach((c) => map.set(c.id, c));
    return map;
  }, [categories]);

  // Format order date helper
  const formatOrderDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(language === 'th' ? 'th-TH' : 'en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  // Build All Commands List
  const allCommands = useMemo<CommandItem[]>(() => {
    const list: CommandItem[] = [];

    // 1. Products
    products.forEach((p) => {
      const cat = categoryMap.get(p.categoryId);
      list.push({
        id: `prod-${p.id}`,
        category: 'products',
        product: p,
        categoryName: cat?.name || p.categoryId,
        categoryColor: cat?.color,
        keywords: `${p.name} ${p.sku} ${p.barcode} ${cat?.name || ''} ${p.description || ''} product สินค้า`.toLowerCase(),
      });
    });

    // 2. Customers
    customers.forEach((c) => {
      list.push({
        id: `cust-${c.id}`,
        category: 'customers',
        customer: c,
        keywords: `${c.name} ${c.phone} ${c.email} ${c.loyaltyTier} ${c.loyaltyPoints} customer loyalty member สมาชิก ลูกค้า`.toLowerCase(),
      });
    });

    // 3. Recent Orders (Sorted by creation date descending)
    const sortedOrders = [...orders].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    sortedOrders.forEach((o) => {
      const itemNames = o.items.map((i) => i.product.name).join(' ');
      const customerText = o.customer ? `${o.customer.name} ${o.customer.phone}` : 'walk-in';
      list.push({
        id: `ord-${o.id}`,
        category: 'orders',
        order: o,
        keywords: `${o.orderNumber} ${customerText} ${o.cashierName} ${o.status} ${itemNames} ${o.idempotencyKey} order receipt บิล ใบเสร็จ คำสั่งซื้อ`.toLowerCase(),
      });
    });

    // 4. Navigation items
    const navItems: {
      route: NavRoute;
      title: string;
      description: string;
      icon: React.ReactNode;
      shortcut?: string;
      permission?: Parameters<typeof can>[0];
    }[] = [
      {
        route: 'pos',
        title: t.nav.pos,
        description:
          language === 'th'
            ? 'หน้าจอขายหน้าร้าน คิดเงิน ยิงบาร์โค้ด และพักบิล'
            : 'Register terminal, barcode scanning & instant checkout',
        icon: <ShoppingCart className="h-4 w-4" />,
        shortcut: 'F1',
        permission: 'pos:checkout',
      },
      {
        route: 'dashboard',
        title: t.nav.dashboard,
        description:
          language === 'th'
            ? 'สรุปภาพรวมยอดขาย กำไรขั้นต้น และสถิติเชิงลึก'
            : 'Real-time sales telemetry, hourly volume & top products',
        icon: <LayoutGrid className="h-4 w-4" />,
        shortcut: 'F2',
        permission: 'reports:read',
      },
      {
        route: 'orders',
        title: t.nav.orders,
        description:
          language === 'th'
            ? 'ประวัติคำสั่งซื้อ ย้อนดูใบเสร็จ พิมพ์ซ้ำ และตรวจสอบยอด'
            : 'Transaction journal, receipt reprints & audit history',
        icon: <ReceiptText className="h-4 w-4" />,
        shortcut: 'F3',
        permission: 'pos:checkout',
      },
      {
        route: 'inventory',
        title: t.nav.inventory,
        description:
          language === 'th'
            ? 'บัญชีคลังสินค้า ตรวจสอบสต็อก ปรับยอด และจุดสั่งซื้อ'
            : 'Stock ledger on hand, cost valuation & inventory adjust',
        icon: <Boxes className="h-4 w-4" />,
        permission: 'inventory:read',
      },
      {
        route: 'shift',
        title: t.nav.shift,
        description:
          language === 'th'
            ? 'เปิด-ปิดกะทำงาน กระทบยอดเงินสดในลิ้นชัก และออกรายงาน Z-Report'
            : 'Cash drawer reconciliation, pay in/out & Z-Report closures',
        icon: <Banknote className="h-4 w-4" />,
        shortcut: 'F4',
        permission: 'shift:open',
      },
      {
        route: 'customers',
        title: t.nav.customers,
        description:
          language === 'th'
            ? 'ระบบสมาชิก สะสมคะแนน ประวัติการซื้อ และเพิ่มลูกค้า'
            : 'Loyalty member profiles, tier perks & purchase history',
        icon: <Users className="h-4 w-4" />,
        permission: 'customers:read',
      },
      {
        route: 'audit',
        title: t.nav.audit,
        description:
          language === 'th'
            ? 'บันทึกเหตุการณ์ความปลอดภัยและกิจกรรมระบบที่ไม่สามารถแก้ไขได้'
            : 'Cryptographic immutable audit trail for enterprise compliance',
        icon: <ShieldCheck className="h-4 w-4" />,
        permission: 'audit:read',
      },
      {
        route: 'settings',
        title: t.nav.settings,
        description:
          language === 'th'
            ? 'ข้อมูลสาขา สถานะอุปกรณ์ต่อพ่วง และการทดสอบระบบ'
            : 'Store parameters, hardware peripherals & diagnostics',
        icon: <Settings className="h-4 w-4" />,
        permission: 'settings:manage',
      },
    ];

    navItems.forEach((item) => {
      if (!canAccessModule(item.route)) return;
      if (item.permission && !can(item.permission)) return;
      list.push({
        id: `nav-${item.route}`,
        category: 'navigation',
        route: item.route,
        title: item.title,
        description: item.description,
        icon: item.icon,
        shortcut: item.shortcut,
        isCurrent: currentRoute === item.route,
        keywords: `${item.title} ${item.description} ${item.route} ${item.shortcut || ''} screen nav menu`.toLowerCase(),
      });
    });

    // 5. Quick POS Action Items
    const actions: ActionCommandItem[] = [
      {
        id: 'act-hold-cart',
        category: 'actions',
        title: t.commandPalette.actions.holdCartTitle,
        description: t.commandPalette.actions.holdCartDesc,
        icon: <Clock className="h-4 w-4 text-amber-500" />,
        badge: cartItems.length > 0 ? `${cartItems.length} items` : undefined,
        badgeVariant: 'warning',
        disabled: cartItems.length === 0,
        keywords: 'hold park cart save ticket bill พักบิล พักตะกร้า',
        onExecute: () => {
          if (cartItems.length === 0) return;
          holdCurrentCart();
          addToast({
            type: 'success',
            title: t.commandPalette.toast.cartHeld,
          });
        },
      },
      {
        id: 'act-recall-cart',
        category: 'actions',
        title: t.commandPalette.actions.recallCartTitle,
        description: t.commandPalette.actions.recallCartDesc,
        icon: <Layers className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
        badge: heldCarts.length > 0 ? `${heldCarts.length} held` : undefined,
        badgeVariant: 'warning',
        keywords: 'recall park held cart restore list ดึงบิล เรียกคืนบิล',
        onExecute: () => {
          if (onOpenHoldModal) {
            onOpenHoldModal();
          } else {
            onNavigate('pos');
          }
        },
      },
      {
        id: 'act-clear-cart',
        category: 'actions',
        title: t.commandPalette.actions.clearCartTitle,
        description: t.commandPalette.actions.clearCartDesc,
        icon: <Trash2 className="h-4 w-4 text-rose-500" />,
        disabled: cartItems.length === 0,
        keywords: 'clear cart empty remove reset ล้างบิล ลบรายการ',
        onExecute: () => {
          if (cartItems.length === 0) return;
          clearCart();
          addToast({
            type: 'info',
            title: t.commandPalette.toast.cartCleared,
          });
        },
      },
      {
        id: 'act-open-shift',
        category: 'actions',
        title: t.commandPalette.actions.openShiftTitle,
        description: t.commandPalette.actions.openShiftDesc,
        icon: <Banknote className="h-4 w-4 text-emerald-500" />,
        badge: currentShift ? 'Active' : 'Closed',
        badgeVariant: currentShift ? 'success' : 'default',
        keywords: 'shift drawer cash float payin payout zreport เปิดกะ ปิดกะ เงินสด',
        onExecute: () => {
          onNavigate('shift');
        },
      },
      {
        id: 'act-toggle-theme',
        category: 'actions',
        title: t.commandPalette.actions.toggleThemeTitle,
        description: t.commandPalette.actions.toggleThemeDesc,
        icon:
          theme === 'dark' ? (
            <Sun className="h-4 w-4 text-amber-400" />
          ) : (
            <Moon className="h-4 w-4 text-indigo-500" />
          ),
        badge: theme === 'dark' ? 'Dark' : 'Light',
        keywords: 'theme dark light mode appearance สลับธีม โหมดมืด โหมดสว่าง',
        onExecute: () => {
          toggleTheme();
          addToast({
            type: 'info',
            title: t.commandPalette.toast.themeToggled.replace(
              '{theme}',
              theme === 'dark' ? 'Light' : 'Dark'
            ),
          });
        },
      },
      {
        id: 'act-toggle-offline',
        category: 'actions',
        title: t.commandPalette.actions.toggleOfflineTitle,
        description: t.commandPalette.actions.toggleOfflineDesc,
        icon: isSimulatedOffline ? (
          <Wifi className="h-4 w-4 text-emerald-500" />
        ) : (
          <WifiOff className="h-4 w-4 text-amber-500" />
        ),
        badge: isSimulatedOffline ? 'Sim Offline' : 'Online',
        badgeVariant: isSimulatedOffline ? 'warning' : 'success',
        keywords: 'offline online simulate network wifi outbox จำลองออฟไลน์ ออฟไลน์ เน็ตหลุด',
        onExecute: () => {
          toggleSimulatedOffline();
          addToast({
            type: isSimulatedOffline ? 'success' : 'warning',
            title: t.commandPalette.toast.offlineToggled.replace(
              '{status}',
              !isSimulatedOffline ? 'Simulated Offline' : 'Online'
            ),
          });
        },
      },
      {
        id: 'act-sync-outbox',
        category: 'actions',
        title: t.commandPalette.actions.syncOutboxTitle,
        description: t.commandPalette.actions.syncOutboxDesc,
        icon: (
          <RefreshCw
            className={`h-4 w-4 text-emerald-500 ${isSyncing ? 'animate-spin' : ''}`}
          />
        ),
        badge: pendingCount > 0 ? `${pendingCount} pending` : 'Synced',
        badgeVariant: pendingCount > 0 ? 'warning' : 'default',
        disabled: !isOnline || isSyncing,
        keywords: 'sync outbox upload pending queue transaction ซิงก์ ส่งข้อมูล',
        onExecute: () => {
          triggerSync();
          addToast({
            type: 'info',
            title: t.commandPalette.toast.syncTriggered,
          });
        },
      },
      {
        id: 'act-open-sync-activity',
        category: 'actions',
        title: language === 'th' ? 'เปิดดู Sync Activity Panel' : 'Open Sync Activity Panel',
        description:
          language === 'th'
            ? 'ดูประวัติการซิงก์ข้อมูล Local Cache ↔ Cloud DB พร้อมเวลาสำเร็จ/ล้มเหลว'
            : 'Inspect data synchronization history, latency, and success/failure timestamps',
        icon: <CloudUpload className="h-4 w-4 text-primary" />,
        shortcut: 'Alt+S',
        keywords: 'sync activity panel log history telemetry offline cloud timestamp outbox cache ประวัติการซิงก์ ซิงค์ แคช',
        onExecute: () => {
          openSyncActivity();
        },
      },
      {
        id: 'act-switch-lang',
        category: 'actions',
        title: t.commandPalette.actions.switchLangTitle,
        description: t.commandPalette.actions.switchLangDesc,
        icon: <Globe className="h-4 w-4 text-primary" />,
        badge: `${language.toUpperCase()}`,
        keywords: 'language thai english chinese japanese locale translate ภาษา สลับภาษา ไทย อังกฤษ 中文 日本語',
        onExecute: () => {
          const sequence: ('th' | 'en' | 'zh' | 'ja')[] = ['th', 'en', 'zh', 'ja'];
          const nextLang = sequence[(sequence.indexOf(language as any) + 1) % sequence.length];
          setLanguage(nextLang);
        },
      },
      {
        id: 'act-role-admin',
        category: 'actions',
        title: t.commandPalette.actions.roleAdminTitle,
        description: t.commandPalette.actions.roleAdminDesc,
        icon: <Shield className="h-4 w-4 text-primary" />,
        badge: session?.currentUser.role === 'admin' ? 'Active Role' : undefined,
        keywords: 'role rbac admin administrator alex vance สิทธิ์ ผู้ดูแลระบบ แอดมิน',
        onExecute: () => {
          switchDemoRole('admin');
          addToast({
            type: 'success',
            title: t.commandPalette.toast.roleSwitched.replace('{role}', 'Admin (Alex Vance)'),
          });
        },
      },
      {
        id: 'act-role-manager',
        category: 'actions',
        title: t.commandPalette.actions.roleManagerTitle,
        description: t.commandPalette.actions.roleManagerDesc,
        icon: <UserCheck className="h-4 w-4 text-blue-500" />,
        badge: session?.currentUser.role === 'manager' ? 'Active Role' : undefined,
        keywords: 'role rbac manager sarah connor สิทธิ์ ผู้จัดการ',
        onExecute: () => {
          switchDemoRole('manager');
          addToast({
            type: 'success',
            title: t.commandPalette.toast.roleSwitched.replace('{role}', 'Manager (Sarah Connor)'),
          });
        },
      },
      {
        id: 'act-role-cashier',
        category: 'actions',
        title: t.commandPalette.actions.roleCashierTitle,
        description: t.commandPalette.actions.roleCashierDesc,
        icon: <User className="h-4 w-4 text-text/60" />,
        badge: session?.currentUser.role === 'cashier' ? 'Active Role' : undefined,
        keywords: 'role rbac cashier john doe สิทธิ์ พนักงานขาย แคชเชียร์',
        onExecute: () => {
          switchDemoRole('cashier');
          addToast({
            type: 'success',
            title: t.commandPalette.toast.roleSwitched.replace('{role}', 'Cashier (John Doe)'),
          });
        },
      },
      {
        id: 'act-sign-out',
        category: 'actions',
        title: t.commandPalette.actions.signOutTitle,
        description: t.commandPalette.actions.signOutDesc,
        icon: <LogOut className="h-4 w-4 text-rose-500" />,
        keywords: 'logout signout lock terminal exit ออกจากระบบ ล็อกหน้าจอ ปิดเครื่อง',
        onExecute: () => {
          logout();
        },
      },
    ];

    list.push(...actions);

    return list;
  }, [
    products,
    customers,
    orders,
    categoryMap,
    language,
    currentRoute,
    can,
    canAccessModule,
    t,
    cartItems.length,
    heldCarts.length,
    currentShift,
    theme,
    isSimulatedOffline,
    pendingCount,
    isOnline,
    isSyncing,
    session?.currentUser.role,
    holdCurrentCart,
    addToast,
    onOpenHoldModal,
    onNavigate,
    clearCart,
    toggleTheme,
    toggleSimulatedOffline,
    triggerSync,
    setLanguage,
    switchDemoRole,
    logout,
  ]);

  // Filter commands by active category tab & search query
  const filteredCommands = useMemo(() => {
    let result = allCommands;

    if (activeTab !== 'all') {
      result = result.filter((item) => item.category === activeTab);
    }

    const q = searchQuery.toLowerCase().trim();
    if (q) {
      const terms = q.split(/\s+/).filter(Boolean);
      result = result.filter((item) => {
        return terms.every((term) => item.keywords.includes(term));
      });
    }

    return result;
  }, [allCommands, activeTab, searchQuery]);

  // Reset or clamp selectedIndex when filtered list changes
  useEffect(() => {
    setSelectedIndex((prev) => {
      if (filteredCommands.length === 0) return 0;
      if (prev >= filteredCommands.length) return filteredCommands.length - 1;
      return prev < 0 ? 0 : prev;
    });
  }, [filteredCommands.length]);

  // Scroll active item into view
  useEffect(() => {
    if (itemRefs.current[selectedIndex]) {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [selectedIndex]);

  // Execute selected command
  const executeItem = (item: CommandItem, secondaryAction = false) => {
    if (item.category === 'products') {
      const prodItem = item as ProductCommandItem;
      addItem(prodItem.product, 1);
      addToast({
        type: 'success',
        title: t.commandPalette.toast.productAdded
          .replace('{name}', prodItem.product.name)
          .replace('{price}', formatMoney(prodItem.product.price)),
      });
      if (currentRoute !== 'pos') {
        onNavigate('pos');
      }
      onClose();
    } else if (item.category === 'customers') {
      const custItem = item as CustomerCommandItem;
      if (secondaryAction) {
        // Navigate to Customers CRM screen and prefill search
        sessionStorage.setItem('prodx_customer_search', custItem.customer.name);
        window.dispatchEvent(
          new CustomEvent('prodx:search-customer', {
            detail: { search: custItem.customer.name },
          })
        );
        onNavigate('customers');
        onClose();
      } else {
        // Attach customer to active cart in POS
        setCustomer(custItem.customer);
        addToast({
          type: 'success',
          title: t.commandPalette.toast.customerAttached
            .replace('{name}', custItem.customer.name)
            .replace('{tier}', custItem.customer.loyaltyTier),
        });
        if (currentRoute !== 'pos') {
          onNavigate('pos');
        }
        onClose();
      }
    } else if (item.category === 'orders') {
      const ordItem = item as OrderCommandItem;
      // Navigate to Orders and select this order in the master-detail inspector
      sessionStorage.setItem('prodx_selected_order_id', ordItem.order.id);
      window.dispatchEvent(
        new CustomEvent('prodx:select-order', {
          detail: { orderId: ordItem.order.id },
        })
      );
      onNavigate('orders');
      onClose();
    } else if (item.category === 'navigation') {
      const navItem = item as NavCommandItem;
      onNavigate(navItem.route);
      onClose();
    } else if (item.category === 'actions') {
      const actItem = item as ActionCommandItem;
      if (!actItem.disabled) {
        actItem.onExecute();
        onClose();
      }
    }
  };

  // Keyboard navigation inside palette
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filteredCommands.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev <= 0 ? Math.max(0, filteredCommands.length - 1) : prev - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        executeItem(filteredCommands[selectedIndex]);
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const tabs: PaletteCategory[] = [
        'all',
        'products',
        'customers',
        'orders',
        'navigation',
        'actions',
      ];
      const currentIndex = tabs.indexOf(activeTab);
      const nextIndex = e.shiftKey
        ? (currentIndex - 1 + tabs.length) % tabs.length
        : (currentIndex + 1) % tabs.length;
      setActiveTab(tabs[nextIndex]);
      setSelectedIndex(0);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  // Group items by category for clear visual sections
  const groupedSections: {
    title: string;
    category: PaletteCategory;
    items: { item: CommandItem; originalIndex: number }[];
  }[] = [];

  const prodSectionItems: { item: CommandItem; originalIndex: number }[] = [];
  const custSectionItems: { item: CommandItem; originalIndex: number }[] = [];
  const ordSectionItems: { item: CommandItem; originalIndex: number }[] = [];
  const navSectionItems: { item: CommandItem; originalIndex: number }[] = [];
  const actSectionItems: { item: CommandItem; originalIndex: number }[] = [];

  filteredCommands.forEach((item, idx) => {
    if (item.category === 'products') {
      prodSectionItems.push({ item, originalIndex: idx });
    } else if (item.category === 'customers') {
      custSectionItems.push({ item, originalIndex: idx });
    } else if (item.category === 'orders') {
      ordSectionItems.push({ item, originalIndex: idx });
    } else if (item.category === 'navigation') {
      navSectionItems.push({ item, originalIndex: idx });
    } else if (item.category === 'actions') {
      actSectionItems.push({ item, originalIndex: idx });
    }
  });

  if (activeTab === 'all' || activeTab === 'products') {
    if (prodSectionItems.length > 0) {
      groupedSections.push({
        title: t.commandPalette.sectionProducts,
        category: 'products',
        items: prodSectionItems,
      });
    }
  }

  if (activeTab === 'all' || activeTab === 'customers') {
    if (custSectionItems.length > 0) {
      groupedSections.push({
        title: t.commandPalette.sectionCustomers,
        category: 'customers',
        items: custSectionItems,
      });
    }
  }

  if (activeTab === 'all' || activeTab === 'orders') {
    if (ordSectionItems.length > 0) {
      groupedSections.push({
        title: t.commandPalette.sectionOrders,
        category: 'orders',
        items: ordSectionItems,
      });
    }
  }

  if (activeTab === 'all' || activeTab === 'navigation') {
    if (navSectionItems.length > 0) {
      groupedSections.push({
        title: t.commandPalette.sectionNavigation,
        category: 'navigation',
        items: navSectionItems,
      });
    }
  }

  if (activeTab === 'all' || activeTab === 'actions') {
    if (actSectionItems.length > 0) {
      groupedSections.push({
        title: t.commandPalette.sectionActions,
        category: 'actions',
        items: actSectionItems,
      });
    }
  }

  const categoryCounts = {
    all: allCommands.length,
    products: allCommands.filter((c) => c.category === 'products').length,
    customers: allCommands.filter((c) => c.category === 'customers').length,
    orders: allCommands.filter((c) => c.category === 'orders').length,
    navigation: allCommands.filter((c) => c.category === 'navigation').length,
    actions: allCommands.filter((c) => c.category === 'actions').length,
  };

  const getTierBadgeClass = (tier: Customer['loyaltyTier']) => {
    switch (tier) {
      case 'VIP':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30';
      case 'Gold':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30';
      case 'Silver':
        return 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600';
      case 'Bronze':
      default:
        return 'bg-primary/10 text-orange-800 dark:bg-primary/20 dark:text-orange-300 border border-primary/30 dark:border-primary/30';
    }
  };

  const getOrderStatusBadge = (status: Order['status']) => {
    switch (status) {
      case 'server_confirmed':
        return (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/30">
            {language === 'th' ? 'สำเร็จ' : 'Confirmed'}
          </span>
        );
      case 'pending_sync_offline':
        return (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30">
            {language === 'th' ? 'รอซิงก์ออฟไลน์' : 'Offline'}
          </span>
        );
      case 'refunded':
        return (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-500/20 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-500/30">
            {language === 'th' ? 'คืนเงินแล้ว' : 'Refunded'}
          </span>
        );
      case 'voided':
        return (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-500/30">
            {language === 'th' ? 'ยกเลิกแล้ว' : 'Voided'}
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-background text-text/70 border border-border">
            {status}
          </span>
        );
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${getZIndexClass('modal')} flex items-start justify-center pt-8 sm:pt-16 lg:pt-20 px-3 sm:px-4 bg-zinc-950/70 backdrop-blur-sm animate-in fade-in duration-150`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
    >
      <div
        className="w-full max-w-3xl bg-card border border-border border-crisp rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
        onKeyDown={handleKeyDown}
      >
        {/* Search Header */}
        <div className="p-3.5 sm:p-4 border-b border-border border-crisp bg-slate-50/80 dark:bg-slate-900/60 flex items-center gap-3 shrink-0">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20 shrink-0">
            <Search className="h-5 w-5" />
          </div>

          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder={t.commandPalette.searchPlaceholder}
            className="flex-1 bg-transparent text-sm sm:text-base text-text placeholder-text/40 focus:outline-hidden font-medium"
            autoComplete="off"
            spellCheck="false"
          />

          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                inputRef.current?.focus();
              }}
              className="p-1 rounded-md text-text/50 hover:text-text hover:bg-background transition-colors cursor-pointer"
              title="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          <kbd
            onClick={onClose}
            className="hidden sm:inline-flex items-center justify-center px-2 py-1 text-[11px] font-mono rounded-md bg-background/80 dark:bg-slate-800 text-text/70 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors cursor-pointer border border-border/60"
            title="Close (Esc)"
          >
            ESC
          </kbd>
        </div>

        {/* Filter Category Tabs */}
        <div className="px-3 sm:px-4 py-2 border-b border-border border-crisp bg-card flex items-center gap-1.5 overflow-x-auto shrink-0 no-scrollbar">
          {(
            [
              { id: 'all', label: t.commandPalette.filterAll, count: categoryCounts.all },
              { id: 'products', label: t.commandPalette.filterProducts, count: categoryCounts.products },
              { id: 'customers', label: t.commandPalette.filterCustomers, count: categoryCounts.customers },
              { id: 'orders', label: t.commandPalette.filterOrders, count: categoryCounts.orders },
              { id: 'navigation', label: t.commandPalette.filterNavigation, count: categoryCounts.navigation },
              { id: 'actions', label: t.commandPalette.filterActions, count: categoryCounts.actions },
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
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150 active:scale-95 cursor-pointer flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-primary text-white shadow-2xs'
                    : 'bg-background dark:bg-white/5 text-text/70 hover:bg-zinc-200 dark:hover:bg-white/10 hover:text-text'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-background dark:bg-white/10 text-text/60'
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
          ref={listRef}
          className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-4 divide-y divide-transparent"
        >
          {filteredCommands.length === 0 ? (
            <div className="py-14 px-4 text-center">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary mx-auto flex items-center justify-center mb-3">
                <Search className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-bold text-text">
                {t.commandPalette.noResultsTitle}
              </h3>
              <p className="text-xs text-text/60 mt-1 max-w-sm mx-auto">
                {t.commandPalette.noResultsDesc}
              </p>
            </div>
          ) : (
            groupedSections.map((section) => (
              <div key={section.title} className="space-y-1">
                <div className="px-3 py-1 text-[11px] font-bold text-text/50 uppercase tracking-wider flex items-center justify-between">
                  <span>{section.title}</span>
                  <span className="font-mono text-[10px] lowercase opacity-70">
                    {section.items.length} {section.category}
                  </span>
                </div>

                <div className="space-y-1">
                  {section.items.map(({ item, originalIndex }) => {
                    const isSelected = selectedIndex === originalIndex;

                    // 1. Product Item
                    if (item.category === 'products') {
                      const prod = (item as ProductCommandItem).product;
                      const catName = (item as ProductCommandItem).categoryName;
                      const catColor =
                        (item as ProductCommandItem).categoryColor || '#B45309';
                      const isLowStock =
                        prod.currentStock > 0 &&
                        prod.currentStock <= prod.reorderPoint;
                      const isOutOfStock = prod.currentStock <= 0;

                      return (
                        <div
                          key={item.id}
                          ref={(el) => {
                            itemRefs.current[originalIndex] = el;
                          }}
                          onClick={() => executeItem(item)}
                          onMouseEnter={() => setSelectedIndex(originalIndex)}
                          className={`group p-2.5 sm:p-3 rounded-xl transition-all duration-150 active:scale-[0.99] cursor-pointer flex items-center justify-between border ${
                            isSelected
                              ? 'bg-primary/10 border-primary/30 shadow-2xs'
                              : 'bg-transparent border-transparent hover:bg-background/70 dark:hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border border-white/10"
                              style={{
                                backgroundColor: `${catColor}20`,
                                color: catColor,
                              }}
                            >
                              <Package className="h-4 w-4" />
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-xs sm:text-sm font-bold truncate ${
                                    isSelected
                                      ? 'text-primary'
                                      : 'text-text'
                                  }`}
                                >
                                  {prod.name}
                                </span>
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-background dark:bg-white/10 text-text/60 shrink-0">
                                  {prod.sku}
                                </span>
                              </div>

                              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text/60">
                                <span className="truncate">{catName}</span>
                                <span>·</span>
                                <span
                                  className={
                                    isOutOfStock
                                      ? 'text-rose-500 font-semibold'
                                      : isLowStock
                                      ? 'text-amber-500 font-semibold'
                                      : 'text-emerald-600 dark:text-emerald-400'
                                  }
                                >
                                  {isOutOfStock
                                    ? t.pos.outOfStock
                                    : `${prod.currentStock} ${prod.unitOfMeasure}`}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 ml-2">
                            <span className="text-xs sm:text-sm font-mono font-bold text-text">
                              {formatMoney(prod.price)}
                            </span>

                            <div
                              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                                isSelected
                                  ? 'bg-primary text-white shadow-2xs'
                                  : 'bg-background dark:bg-white/10 text-text/70 group-hover:bg-primary/20 group-hover:text-primary'
                              }`}
                            >
                              <span>+ {t.commandPalette.addToCart}</span>
                              <CornerDownLeft className="h-3 w-3" />
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // 2. Customer Item
                    if (item.category === 'customers') {
                      const cust = (item as CustomerCommandItem).customer;
                      return (
                        <div
                          key={item.id}
                          ref={(el) => {
                            itemRefs.current[originalIndex] = el;
                          }}
                          onClick={() => executeItem(item)}
                          onMouseEnter={() => setSelectedIndex(originalIndex)}
                          className={`group p-2.5 sm:p-3 rounded-xl transition-all duration-150 active:scale-[0.99] cursor-pointer flex items-center justify-between border ${
                            isSelected
                              ? 'bg-primary/10 dark:bg-primary/10 border-primary/30 dark:border-primary/30 shadow-2xs'
                              : 'bg-transparent border-transparent hover:bg-background/70 dark:hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                              <Users className="h-4 w-4" />
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-xs sm:text-sm font-bold truncate ${
                                    isSelected
                                      ? 'text-primary'
                                      : 'text-text'
                                  }`}
                                >
                                  {cust.name}
                                </span>
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${getTierBadgeClass(
                                    cust.loyaltyTier
                                  )}`}
                                >
                                  <Star className="h-2.5 w-2.5 fill-current" />
                                  {cust.loyaltyTier}
                                </span>
                              </div>

                              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text/60">
                                <span className="flex items-center gap-1 font-mono">
                                  <Phone className="h-3 w-3 text-text/40" />
                                  {cust.phone}
                                </span>
                                <span>·</span>
                                <span className="font-semibold text-amber-600 dark:text-amber-400">
                                  {cust.loyaltyPoints} pts
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                executeItem(item, true);
                              }}
                              className="hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-text/60 hover:text-text hover:bg-background border border-border/50"
                              title={t.commandPalette.viewCustomerProfile}
                            >
                              <span>{t.commandPalette.viewCustomerProfile}</span>
                              <ExternalLink className="h-3 w-3" />
                            </button>

                            <div
                              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                                isSelected
                                  ? 'bg-primary text-white shadow-2xs'
                                  : 'bg-background dark:bg-white/10 text-text/70 group-hover:bg-primary/20 group-hover:text-primary'
                              }`}
                            >
                              <span>{t.commandPalette.attachCustomer}</span>
                              <CornerDownLeft className="h-3 w-3" />
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // 3. Recent Order Item
                    if (item.category === 'orders') {
                      const ord = (item as OrderCommandItem).order;
                      const customerName = ord.customer?.name || t.commandPalette.walkInCustomer;
                      const itemsCount = ord.items.reduce(
                        (sum, item) => sum + item.quantity,
                        0
                      );
                      const itemsPreview = ord.items
                        .slice(0, 2)
                        .map((i) => `${i.product.name} ×${i.quantity}`)
                        .join(', ');

                      return (
                        <div
                          key={item.id}
                          ref={(el) => {
                            itemRefs.current[originalIndex] = el;
                          }}
                          onClick={() => executeItem(item)}
                          onMouseEnter={() => setSelectedIndex(originalIndex)}
                          className={`group p-2.5 sm:p-3 rounded-xl transition-all duration-150 active:scale-[0.99] cursor-pointer flex items-center justify-between border ${
                            isSelected
                              ? 'bg-primary/10 dark:bg-primary/10 border-primary/30 dark:border-primary/30 shadow-2xs'
                              : 'bg-transparent border-transparent hover:bg-background/70 dark:hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              <Receipt className="h-4 w-4" />
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-xs sm:text-sm font-mono font-bold truncate ${
                                    isSelected
                                      ? 'text-primary dark:text-orange-300'
                                      : 'text-text'
                                  }`}
                                >
                                  {ord.orderNumber}
                                </span>
                                {getOrderStatusBadge(ord.status)}
                              </div>

                              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text/60">
                                <span className="truncate font-medium">{customerName}</span>
                                <span>·</span>
                                <span className="truncate max-w-[140px] sm:max-w-xs text-text/50">
                                  {itemsPreview}
                                  {ord.items.length > 2 ? ' ...' : ''} ({itemsCount})
                                </span>
                                <span>·</span>
                                <span className="font-mono text-text/40 shrink-0">
                                  {formatOrderDate(ord.createdAt)}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 ml-2">
                            <span className="text-xs sm:text-sm font-mono font-bold text-text">
                              {formatMoney(ord.totals.grandTotal)}
                            </span>

                            <div
                              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                                isSelected
                                  ? 'bg-primary text-white shadow-2xs'
                                  : 'bg-background dark:bg-white/10 text-text/70 group-hover:bg-primary/20 group-hover:text-primary'
                              }`}
                            >
                              <span>{t.commandPalette.inspectOrder}</span>
                              <CornerDownLeft className="h-3 w-3" />
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // 4. Navigation Item
                    if (item.category === 'navigation') {
                      const nav = item as NavCommandItem;
                      return (
                        <div
                          key={item.id}
                          ref={(el) => {
                            itemRefs.current[originalIndex] = el;
                          }}
                          onClick={() => executeItem(item)}
                          onMouseEnter={() => setSelectedIndex(originalIndex)}
                          className={`group p-2.5 sm:p-3 rounded-xl transition-all duration-150 active:scale-[0.99] cursor-pointer flex items-center justify-between border ${
                            isSelected
                              ? 'bg-primary/10 dark:bg-primary/10 border-primary/30 dark:border-primary/30 shadow-2xs'
                              : 'bg-transparent border-transparent hover:bg-background/70 dark:hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`p-2 rounded-lg shrink-0 transition-colors ${
                                isSelected
                                  ? 'bg-primary text-white'
                                  : 'bg-background dark:bg-white/10 text-text/70'
                              }`}
                            >
                              {nav.icon}
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-xs sm:text-sm font-bold ${
                                    isSelected
                                      ? 'text-primary dark:text-orange-300'
                                      : 'text-text'
                                  }`}
                                >
                                  {nav.title}
                                </span>
                                {nav.isCurrent && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300">
                                    {t.commandPalette.currentScreen}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-text/60 truncate mt-0.5">
                                {nav.description}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            {nav.shortcut && (
                              <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-background dark:bg-white/10 text-text/60 border border-border border-crisp">
                                {nav.shortcut}
                              </kbd>
                            )}

                            <div
                              className={`p-1.5 rounded-lg transition-all ${
                                isSelected
                                  ? 'text-primary dark:text-orange-400'
                                  : 'text-text/50 group-hover:text-text'
                              }`}
                            >
                              <ArrowRight className="h-4 w-4" />
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // 5. Quick Action Item
                    if (item.category === 'actions') {
                      const act = item as ActionCommandItem;
                      return (
                        <div
                          key={item.id}
                          ref={(el) => {
                            itemRefs.current[originalIndex] = el;
                          }}
                          onClick={() => executeItem(item)}
                          onMouseEnter={() => setSelectedIndex(originalIndex)}
                          className={`group p-2.5 sm:p-3 rounded-xl transition-all duration-150 active:scale-[0.99] cursor-pointer flex items-center justify-between border ${
                            act.disabled ? 'opacity-40 cursor-not-allowed' : ''
                          } ${
                            isSelected
                              ? 'bg-primary/10 dark:bg-primary/10 border-primary/30 dark:border-primary/30 shadow-2xs'
                              : 'bg-transparent border-transparent hover:bg-background/70 dark:hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div
                              className={`p-2 rounded-lg shrink-0 transition-colors ${
                                isSelected
                                  ? 'bg-primary text-white'
                                  : 'bg-background dark:bg-white/10 text-text/80'
                              }`}
                            >
                              {act.icon}
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-xs sm:text-sm font-bold ${
                                    isSelected
                                      ? 'text-primary dark:text-orange-300'
                                      : 'text-text'
                                  }`}
                                >
                                  {act.title}
                                </span>
                                {act.badge && (
                                  <span
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                      act.badgeVariant === 'warning'
                                        ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300'
                                        : act.badgeVariant === 'success'
                                        ? 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300'
                                        : act.badgeVariant === 'danger'
                                        ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-800 dark:text-rose-300'
                                        : 'bg-background dark:bg-white/10 text-text/70'
                                    }`}
                                  >
                                    {act.badge}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-text/60 truncate mt-0.5">
                                {act.description}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 ml-2">
                            <div
                              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all ${
                                isSelected
                                  ? 'bg-primary text-white shadow-2xs'
                                  : 'text-text/50 group-hover:text-text'
                              }`}
                            >
                              <span>{t.commandPalette.execute}</span>
                              <CornerDownLeft className="h-3 w-3" />
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return null;
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer info & keyboard shortcuts helper */}
        <div className="px-4 py-2.5 border-t border-border border-crisp bg-slate-50/80 dark:bg-slate-900/60 flex items-center justify-between text-[11px] text-text/60 shrink-0">
          <div className="flex items-center gap-3 sm:gap-4 overflow-x-auto">
            <div className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-background dark:bg-slate-800 font-mono text-[10px] text-text/80 border border-border/50">
                ↑↓
              </kbd>
              <span>{t.commandPalette.keyboardHints.navigate}</span>
            </div>

            <div className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-background dark:bg-slate-800 font-mono text-[10px] text-text/80 border border-border/50">
                ↵
              </kbd>
              <span>{t.commandPalette.keyboardHints.select}</span>
            </div>

            <div className="hidden sm:flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-background dark:bg-slate-800 font-mono text-[10px] text-text/80 border border-border/50">
                Tab
              </kbd>
              <span>Switch Category</span>
            </div>

            <div className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-background dark:bg-slate-800 font-mono text-[10px] text-text/80 border border-border/50">
                ESC
              </kbd>
              <span>{t.commandPalette.keyboardHints.close}</span>
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 font-mono text-[10px] text-text/50">
            <span className="px-1.5 py-0.5 rounded bg-card border border-border/50 font-bold">
              Ctrl+K
            </span>
            <span>·</span>
            <span>{filteredCommands.length} matches</span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
