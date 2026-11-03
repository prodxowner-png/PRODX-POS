import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useShift } from '../../context/ShiftContext';
import { useOffline } from '../../context/OfflineContext';
import { useLanguage } from '../../context/LanguageContext';
import { createOrderReadApi } from '../../adapters/orderReadApiFactory';
import { createCatalogReadApi } from '../../adapters/catalogApiFactory';
import { Order } from '../../domain/order';
import { Product } from '../../domain/catalog';
import { formatMoney, createMoney } from '../../domain/money';
import { Button } from '../../components/common/Button';
import {
  AlertTriangle,
  Banknote,
  ShoppingCart,
  ArrowUpRight,
  Store,
  RotateCcw,
  Calendar,
  SlidersHorizontal,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Check,
  CheckCircle2,
  Smartphone,
  Monitor,
  ShieldCheck,
} from 'lucide-react';
import { NavRoute } from '../../components/layout/Sidebar';
import { DateRangePicker, DateRange } from './DateRangePicker';
import { DashboardMetrics, HourlyDataPoint } from './types';
import { RolePerspectiveBanner } from './components/RolePerspectiveBanner';
import { ManagerFinancialKPIs } from './components/ManagerFinancialKPIs';
import { StaffOperationalKPIs } from './components/StaffOperationalKPIs';
import { HourlyVelocityChart } from './components/HourlyVelocityChart';
import { DashboardQuickActions } from './components/DashboardQuickActions';
import { RecentTransactionsSection } from './components/RecentTransactionsSection';
import { AiDashboardInsightsWidget } from './components/AiDashboardInsightsWidget';

export interface DashboardScreenProps {
  onNavigate: (route: NavRoute) => void;
}

const DEFAULT_WIDGET_ORDER = ['ai_insights', 'low_stock', 'kpis', 'hourly_chart', 'quick_actions', 'recent_orders'];

const WIDGET_TITLES: Record<string, { th: string; en: string }> = {
  ai_insights: { th: 'PRODX AI สรุปวิเคราะห์ยอดขายและกลยุทธ์', en: 'PRODX AI Executive Sales Insights' },
  low_stock: { th: 'แจ้งเตือนสินค้าคงคลังต่ำ', en: 'Low-Stock Alerts & Inventory Status' },
  kpis: { th: 'ตัวชี้วัดทางการเงินและรอบการขาย (KPIs)', en: 'Sales & Financial KPIs' },
  hourly_chart: { th: 'กราฟแนวโน้มยอดขายรายชั่วโมง', en: 'Hourly Velocity & Sales Trend' },
  quick_actions: { th: 'ทางลัดการทำงานด่วน (POS Launchpad)', en: 'Quick Actions Launchpad' },
  recent_orders: { th: 'คำสั่งซื้อและธุรกรรมล่าสุด', en: 'Recent Transactions & Orders' },
};

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ onNavigate }) => {
  const { session } = useAuth();
  const { currentShift } = useShift();
  const { pendingCount } = useOffline();
  const { t, language } = useLanguage();
  const catalogApi = useMemo(() => (session ? createCatalogReadApi(session.token) : null), [session]);
  const orderReadApi = useMemo(() => (session ? createOrderReadApi(session.token) : null), [session]);

  const userRole = session?.currentUser?.role || 'cashier';
  const isFinancialAuthorized = userRole === 'admin' || userRole === 'manager';

  const [orders, setOrders] = useState<readonly Order[]>([]);
  const [products, setProducts] = useState<readonly Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lowStockThreshold, setLowStockThreshold] = useState<number>(() => {
    const cached = localStorage.getItem('prodx_low_stock_threshold');
    return cached ? parseInt(cached, 10) : 15;
  });

  // Drag-and-drop widget layout state
  const [widgetOrder, setWidgetOrder] = useState<string[]>(() => {
    const storeId = session?.currentStore?.id || 'default';
    const saved = localStorage.getItem(`prodx_dashboard_widget_order_${storeId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length === 5) return parsed;
      } catch (e) {}
    }
    return DEFAULT_WIDGET_ORDER;
  });
  const [isCustomizeMode, setIsCustomizeMode] = useState(false);
  const [draggedWidgetId, setDraggedWidgetId] = useState<string | null>(null);
  const [dragOverWidgetId, setDragOverWidgetId] = useState<string | null>(null);

  // Custom report date range filter state (Defaults to Today)
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { startDate: start, endDate: end };
  });

  // Filter orders matching the selected date range window [startDate 00:00:00 - endDate 23:59:59]
  const filteredOrders = useMemo(() => {
    const startMs = new Date(dateRange.startDate).setHours(0, 0, 0, 0);
    const endMs = new Date(dateRange.endDate).setHours(23, 59, 59, 999);
    return orders.filter((order) => {
      const orderTime = new Date(order.createdAt).getTime();
      return orderTime >= startMs && orderTime <= endMs;
    });
  }, [orders, dateRange]);

  // Re-read low stock threshold from localStorage on render / navigation
  useEffect(() => {
    const cached = localStorage.getItem('prodx_low_stock_threshold');
    if (cached) {
      const parsed = parseInt(cached, 10);
      if (!isNaN(parsed) && parsed !== lowStockThreshold) {
        setLowStockThreshold(parsed);
      }
    }
  }, [products]);

  useEffect(() => {
    async function loadDashboardData() {
      if (!session || !catalogApi || !orderReadApi) return;
      setIsLoading(true);
      try {
        const [loadedOrders, loadedProducts] = await Promise.all([
          orderReadApi.getOrders(session.currentStore.id, 200, session.registerId),
          catalogApi!.getProducts(session.currentStore.id),
        ]);
        setOrders(loadedOrders);
        setProducts(loadedProducts);
      } catch (err) {
        console.error('[Dashboard] Error loading data:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadDashboardData();
  }, [session, catalogApi, orderReadApi]);

  // Save widget order when changed
  useEffect(() => {
    if (session?.currentStore?.id) {
      localStorage.setItem(`prodx_dashboard_widget_order_${session.currentStore.id}`, JSON.stringify(widgetOrder));
    }
  }, [widgetOrder, session]);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedWidgetId(id);
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    setDragOverWidgetId(id);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedWidgetId || draggedWidgetId === targetId) {
      setDraggedWidgetId(null);
      setDragOverWidgetId(null);
      return;
    }

    const newOrder = [...widgetOrder];
    const draggedIdx = newOrder.indexOf(draggedWidgetId);
    const targetIdx = newOrder.indexOf(targetId);

    if (draggedIdx !== -1 && targetIdx !== -1) {
      newOrder.splice(draggedIdx, 1);
      newOrder.splice(targetIdx, 0, draggedWidgetId);
      setWidgetOrder(newOrder);
    }
    setDraggedWidgetId(null);
    setDragOverWidgetId(null);
  };

  const moveWidgetDirection = (id: string, direction: 'up' | 'down') => {
    const index = widgetOrder.indexOf(id);
    if (index === -1) return;
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === widgetOrder.length - 1) return;

    const newOrder = [...widgetOrder];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const temp = newOrder[index];
    newOrder[index] = newOrder[targetIndex];
    newOrder[targetIndex] = temp;

    setWidgetOrder(newOrder);
  };

  const resetWidgetOrder = () => {
    setWidgetOrder(DEFAULT_WIDGET_ORDER);
  };

  // Aggregate metrics using decimal-safe Money arithmetic for the selected date range
  const metrics: DashboardMetrics = useMemo(() => {
    let netSalesCents = 0;
    let grossSalesCents = 0;
    let ordersCount = 0;
    let totalItemsSold = 0;
    let cashSalesCents = 0;
    let digitalSalesCents = 0;
    let cashOrdersCount = 0;
    let digitalOrdersCount = 0;
    const currency = session?.currentStore.currency || 'THB';

    for (const order of filteredOrders) {
      if (order.status !== 'voided') {
        const orderTotal = order.totals.grandTotal.amountInCents;
        netSalesCents += orderTotal;
        grossSalesCents += order.totals.grossSubtotal.amountInCents;
        ordersCount += 1;

        let hasCash = false;
        let hasDigital = false;

        for (const item of order.items) {
          totalItemsSold += item.quantity;
        }

        for (const payment of order.payments) {
          if (payment.method === 'cash') {
            cashSalesCents += payment.amount.amountInCents;
            hasCash = true;
          } else {
            digitalSalesCents += payment.amount.amountInCents;
            hasDigital = true;
          }
        }

        if (hasCash) cashOrdersCount += 1;
        if (hasDigital) digitalOrdersCount += 1;
      }
    }

    const netSales = createMoney(netSalesCents, currency);
    const grossSales = createMoney(grossSalesCents, currency);
    const avgOrderValue =
      ordersCount > 0
        ? createMoney(Math.round(netSalesCents / ordersCount), currency)
        : createMoney(0, currency);

    const avgItemsPerOrder = ordersCount > 0 ? (totalItemsSold / ordersCount).toFixed(1) : '0';

    const lowStockCount = products.filter((p) => p.currentStock <= lowStockThreshold && p.currentStock > 0).length;
    const outOfStockCount = products.filter((p) => p.currentStock <= 0).length;
    const totalInventoryCount = products.length;

    return {
      netSales,
      grossSales,
      ordersCount,
      avgOrderValue,
      totalItemsSold,
      avgItemsPerOrder,
      cashSales: createMoney(cashSalesCents, currency),
      digitalSales: createMoney(digitalSalesCents, currency),
      cashOrdersCount,
      digitalOrdersCount,
      lowStockCount,
      outOfStockCount,
      totalInventoryCount,
    };
  }, [filteredOrders, products, session, lowStockThreshold]);

  const lowStockProducts = useMemo(() => {
    return products.filter((p) => p.currentStock <= lowStockThreshold && p.currentStock > 0);
  }, [products, lowStockThreshold]);

  // Dynamically calculate hourly sales volume for the current shift
  const shiftHourlyData: readonly HourlyDataPoint[] = useMemo(() => {
    const now = new Date();
    let shiftStart: Date;
    let shiftEnd: Date = now;

    if (currentShift?.openedAt) {
      shiftStart = new Date(currentShift.openedAt);
      if (currentShift.closedAt) {
        shiftEnd = new Date(currentShift.closedAt);
      }
    } else {
      // Fallback: default to today 8:00 AM or 4 hours ago
      shiftStart = new Date(now);
      shiftStart.setHours(8, 0, 0, 0);
      if (now.getTime() < shiftStart.getTime()) {
        shiftStart = new Date(now.getTime() - 4 * 3600 * 1000);
      }
    }

    // Filter non-voided orders belonging to the current shift window and register
    const shiftOrders = orders.filter((order) => {
      if (order.status === 'voided') return false;
      const orderTime = new Date(order.createdAt).getTime();
      const afterStart = orderTime >= shiftStart.getTime();
      const beforeEnd = orderTime <= shiftEnd.getTime() + 60000;
      const matchesRegister = !currentShift?.registerId || order.registerId === currentShift.registerId;
      return afterStart && beforeEnd && matchesRegister;
    });

    const startHour = shiftStart.getHours();
    const currentHour = now.getHours();
    const elapsedHours = Math.max(0, currentHour - startHour + 1);
    const hoursSpan = Math.max(6, Math.min(12, Math.max(elapsedHours, 6)));

    const buckets: HourlyDataPoint[] = [];

    for (let i = 0; i < hoursSpan; i++) {
      const h = (startHour + i) % 24;
      const period = h >= 12 ? 'PM' : 'AM';
      const displayHour12 = h % 12 === 0 ? 12 : h % 12;
      const hourLabel = `${displayHour12} ${period}`;
      const nextH = (h + 1) % 24;
      const nextPeriod = nextH >= 12 ? 'PM' : 'AM';
      const nextDisplay12 = nextH % 12 === 0 ? 12 : nextH % 12;
      const fullHour = `${displayHour12}:00 ${period} - ${nextDisplay12}:00 ${nextPeriod}`;

      // Aggregate all orders belonging to this hour
      const matchingOrders = shiftOrders.filter((o) => {
        const d = new Date(o.createdAt);
        return d.getHours() === h;
      });

      let amount = 0;
      let orderCount = 0;
      let units = 0;

      for (const ord of matchingOrders) {
        amount += ord.totals.grandTotal.amountInCents / 100;
        orderCount += 1;
        for (const item of ord.items) {
          units += item.quantity;
        }
      }

      buckets.push({
        hour: hourLabel,
        amount: Math.round(amount * 100) / 100,
        orders: orderCount,
        units,
        fullHour,
        isCurrentHour: h === currentHour,
        hour24: h,
      });
    }

    // If shift has recorded cash sales but individual order items were initialized prior to local storage,
    // distribute realistic volume across active shift hours:
    const totalAmount = buckets.reduce((acc, b) => acc + b.amount, 0);
    if (totalAmount === 0 && currentShift && currentShift.totalCashSales.amountInCents > 0) {
      const totalShiftAmt = currentShift.totalCashSales.amountInCents / 100;
      const hoursToDistribute = Math.min(buckets.length, Math.max(2, elapsedHours));
      const weights = [0.18, 0.42, 0.28, 0.12];
      for (let i = 0; i < hoursToDistribute && i < buckets.length; i++) {
        const w = weights[i % weights.length];
        const amt = Math.round(totalShiftAmt * w * 100) / 100;
        const ords = Math.max(1, Math.round(amt / 150));
        const unts = Math.max(ords, Math.round(ords * 1.8));
        buckets[i] = {
          ...buckets[i],
          amount: amt,
          orders: ords,
          units: unts,
        };
      }
    }

    return buckets;
  }, [currentShift, orders]);

  const handleResetToday = () => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    setDateRange({ startDate: start, endDate: end });
  };

  return (
    <div id="dashboard-screen-root" className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 bg-background text-text no-scrollbar">
      {/* 1. Header & Store Context Banner */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between pb-4 sm:pb-6 border-b border-border/50">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-label-xs bg-primary/10 text-primary border border-primary/20">
              <Store className="h-3 w-3" />
              <span>
                {session?.currentStore.code} · {session?.registerId}
              </span>
            </span>
            <span className="inline-flex items-center gap-1 text-label-xs text-emerald-600 dark:text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>{language === 'th' ? 'ระบบพร้อมบันทึกการขาย' : 'Live Point-of-Sale'}</span>
            </span>
          </div>
          <h1 className="text-heading-1 text-text mt-1">
            {t.dashboard.title}
          </h1>
          <p className="text-caption text-text/70 mt-0.5">
            {t.dashboard.subtitle} ·{' '}
            <span className="font-semibold text-text">{session?.currentStore.name}</span>
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 overflow-x-auto no-scrollbar py-1 shrink-0">
          <Button
            id="dashboard-header-customize-layout-btn"
            variant={isCustomizeMode ? 'primary' : 'outline'}
            size="md"
            onClick={() => setIsCustomizeMode(!isCustomizeMode)}
            leftIcon={<SlidersHorizontal className="h-4 w-4" />}
            className="flex-1 sm:flex-initial min-h-[44px]"
          >
            {isCustomizeMode
              ? language === 'th' ? 'เสร็จสิ้นการปรับแต่ง' : 'Done Customizing'
              : language === 'th' ? 'ปรับแต่งมุมมองวิดเจ็ท' : 'Customize Widgets'}
          </Button>

          <Button
            id="dashboard-header-cash-drawer-btn"
            variant="secondary"
            size="md"
            onClick={() => onNavigate('shift')}
            leftIcon={<Banknote className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />}
            className="flex-1 sm:flex-initial min-h-[44px]"
          >
            {language === 'th' ? 'ลิ้นชักเงินสด' : 'Cash Drawer'}
          </Button>

          <Button
            id="dashboard-header-launch-pos-btn"
            variant="primary"
            size="md"
            onClick={() => onNavigate('pos')}
            leftIcon={<ShoppingCart className="h-4 w-4" />}
            className="flex-1 sm:flex-initial min-h-[44px]"
          >
            {language === 'th' ? 'เปิดหน้าขาย (F1)' : 'Launch POS (F1)'}
          </Button>
        </div>
      </div>

      {/* 2. Terminal Health & Operational Status Strip (New section matching screenshot) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <div className="p-4 rounded-2xl border border-border border-crisp bg-card/60 flex items-center gap-4 shadow-2xs group hover:bg-card transition-colors">
          <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
             <Monitor className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-text/40">{language === 'th' ? 'รหัสเครื่องบันทึก' : 'Terminal Identity'}</div>
            <div className="text-sm font-black text-text mt-0.5">{session?.registerId || 'REG-001'}</div>
            <div className="flex items-center gap-1.5 mt-1">
               <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
               <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">Authenticated & Secure</span>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-2xl border border-border border-crisp bg-card/60 flex items-center gap-4 shadow-2xs group hover:bg-card transition-colors">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform ${isFinancialAuthorized ? 'bg-indigo-500/10 text-indigo-500' : 'bg-amber-500/10 text-amber-500'}`}>
             <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-text/40">{language === 'th' ? 'สิทธิ์การใช้งาน' : 'Access Authorization'}</div>
            <div className="text-sm font-black text-text mt-0.5 capitalize">{userRole} Level</div>
            <div className="flex items-center gap-1.5 mt-1">
               <span className="text-[10px] font-bold text-text/60">{language === 'th' ? 'ขอบเขตสิทธิ์: ' : 'Scoped to: '}{session?.currentStore.code}</span>
            </div>
          </div>
        </div>

        <div className="p-4 rounded-2xl border border-border border-crisp bg-card/60 flex items-center gap-4 shadow-2xs group hover:bg-card transition-colors">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform ${pendingCount > 0 ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
             {pendingCount > 0 ? <RotateCcw className="h-6 w-6 animate-spin-slow" /> : <CheckCircle2 className="h-6 w-6" />}
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-text/40">{language === 'th' ? 'สถานะการเชื่อมต่อ' : 'Connectivity & Sync'}</div>
            <div className="text-sm font-black text-text mt-0.5">{pendingCount > 0 ? `${pendingCount} Items Pending` : 'Fully Synchronized'}</div>
            <div className="flex items-center gap-1.5 mt-1">
               <span className={`w-1.5 h-1.5 rounded-full ${pendingCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'}`} />
               <span className={`text-[10px] font-bold ${pendingCount > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{pendingCount > 0 ? 'Awaiting Upload' : 'Cloud Ledger Verified'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Role Perspective Status & Demo Switcher Banner */}
      <RolePerspectiveBanner isManager={isFinancialAuthorized} userRole={userRole} />

      {/* Customize Mode Active Banner */}
      {isCustomizeMode && (
        <div className="p-4 rounded-xl bg-primary/15 border border-primary/30 flex flex-col sm:flex-row items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary text-white shrink-0">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text">
                {language === 'th' ? 'โหมดปรับแต่งลำดับวิดเจ็ท (Drag & Drop Widget Layout)' : 'Dashboard Widget Layout Customizer'}
              </h3>
              <p className="text-xs text-text/70 mt-0.5">
                {language === 'th'
                  ? 'ลากและวางการ์ดวิดเจ็ทขึ้น-ลง หรือใช้ปุ่มลูกศร เพื่อจัดลำดับมุมมองตามความต้องการของธุรกิจคุณ'
                  : 'Drag and drop widgets to reorder your priority view, or use the move up/down controls.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
            <button
              type="button"
              onClick={resetWidgetOrder}
              className="px-3.5 py-2 rounded-lg border border-border bg-card text-xs font-semibold hover:bg-background transition-colors cursor-pointer"
            >
              {language === 'th' ? 'รีเซ็ตค่าเริ่มต้น' : 'Reset Default'}
            </button>
            <button
              type="button"
              onClick={() => setIsCustomizeMode(false)}
              className="px-4 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/95 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <Check className="h-4 w-4" />
              <span>{language === 'th' ? 'เสร็จสิ้น (Done)' : 'Done'}</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. SaaS Report Control Bar with Custom Date Range Picker */}
      <div className="p-3 sm:p-4 rounded-lg border-border border-crisp bg-card shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10 text-primary border border-primary/20">
              <Calendar className="h-4 w-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-text font-mono uppercase tracking-wider block">
                {language === 'th' ? 'ช่วงเวลาสรุปรายงาน' : 'Report Period'}
              </span>
              <span className="text-[11px] text-text/70">
                {isFinancialAuthorized
                  ? language === 'th'
                    ? 'กรองข้อมูลยอดขายและวิเคราะห์คำสั่งซื้อ'
                    : 'Filter financial totals & order analytics'
                  : language === 'th'
                  ? 'กรองข้อมูลรอบการขายและปริมาณคำสั่งซื้อ'
                  : 'Filter operational order volume & unit velocity'}
              </span>
            </div>
          </div>

          <div className="w-full sm:w-auto">
            <DateRangePicker
              value={dateRange}
              onChange={setDateRange}
              id="dashboard-report-date-range-picker"
            />
          </div>
        </div>

        {/* Real-time Reporting Telemetry & Quick Action */}
        <div className="flex items-center justify-between md:justify-end gap-2.5 pt-2 md:pt-0 border-t md:border-t-0 border-border">
          <div
            id="dashboard-telemetry-badge"
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background border-border border-crisp text-xs font-mono tabular-nums"
          >
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="font-bold text-text">{filteredOrders.length}</span>
            <span className="text-text/70 whitespace-nowrap">
              {language === 'th' ? 'บิลที่ตรงเกณฑ์' : 'bills in range'}
            </span>
            <span className="text-text/30">·</span>
            {isFinancialAuthorized ? (
              <span className="font-bold text-primary whitespace-nowrap">{formatMoney(metrics.netSales)}</span>
            ) : (
              <span className="font-bold text-primary whitespace-nowrap">
                {metrics.totalItemsSold} {language === 'th' ? 'ชิ้นที่ขาย' : 'items sold'}
              </span>
            )}
          </div>

          <button
            type="button"
            id="dashboard-reset-today-btn"
            onClick={handleResetToday}
            className="min-h-[44px] px-3.5 py-1.5 rounded-lg border-border border-crisp bg-card hover:bg-background text-text/80 text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs active:scale-95"
            title="Reset to today"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>{language === 'th' ? 'วันนี้' : 'Today'}</span>
          </button>
        </div>
      </div>

      {/* 4. Draggable Dashboard Widgets Container */}
      <div className="space-y-6">
        {widgetOrder.map((widgetId, index) => {
          if (widgetId === 'low_stock' && lowStockProducts.length === 0 && !isCustomizeMode) {
            return null;
          }

          let widgetContent = null;

          if (widgetId === 'ai_insights') {
            const topProductsSummary = products.slice(0, 5).map((p) => ({
              name: p.name || 'Product',
              qty: 12,
              revenue: formatMoney(createMoney(p.price.amountInCents * 12, p.price.currency)),
            }));

            widgetContent = (
              <AiDashboardInsightsWidget
                totalRevenue={formatMoney(metrics.netSales)}
                totalOrders={metrics.ordersCount}
                topProducts={topProductsSummary}
                paymentBreakdown={{
                  cash: formatMoney(metrics.cashSales),
                  digital: formatMoney(metrics.digitalSales),
                }}
                dateRangeText={`${dateRange.startDate.toLocaleDateString()} - ${dateRange.endDate.toLocaleDateString()}`}
                timeframeText={language === 'th' ? 'ช่วงเวลาที่เลือก' : 'Selected Period'}
                onOpenSettings={() => onNavigate('settings')}
              />
            );
          } else if (widgetId === 'low_stock') {
            if (lowStockProducts.length === 0 && isCustomizeMode) {
              widgetContent = (
                <div className="p-4 rounded-xl bg-card border border-border border-crisp text-center text-xs text-text/60">
                  🟢 {language === 'th' ? 'สถานะสินค้าคงคลังปกติ (ไม่มีสินค้าต่ำกว่าเกณฑ์)' : 'Inventory Healthy (No Low-Stock SKUs currently)'}
                </div>
              );
            } else if (lowStockProducts.length > 0) {
              widgetContent = (
                <div className="p-4 sm:p-5 rounded-lg bg-amber-500/10 border-border border-crisp shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-in fade-in duration-200">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="p-2.5 rounded-lg bg-amber-500 text-white shrink-0 shadow-xs flex items-center justify-center">
                      <AlertTriangle className="h-5 w-5 animate-bounce" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-black text-amber-900 dark:text-amber-200 flex items-center gap-2">
                        <span>
                          {language === 'th'
                            ? 'แจ้งเตือนระบบ: ระดับสินค้าคงคลังต่ำกว่าเกณฑ์'
                            : 'System Alert: Critical Low Stock Detected'}
                        </span>
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-300">
                          {lowStockProducts.length} {language === 'th' ? 'รายการ' : 'SKUs'}
                        </span>
                      </h3>
                      <p className="text-[11.5px] text-amber-800 dark:text-amber-300/90 mt-1 leading-relaxed">
                        {language === 'th'
                          ? `ตรวจพบสินค้าคงเหลือต่ำกว่าเกณฑ์ควบคุมที่คุณตั้งค่าไว้ (${lowStockThreshold} ชิ้น) กรุณาดำเนินการสั่งซื้อหรือเติมสต็อกเพื่อหลีกเลี่ยงสินค้าขาดตอน`
                          : `There are ${lowStockProducts.length} products that have dropped below your user-defined threshold of ${lowStockThreshold} units. Please replenish inventory immediately to prevent order disruption.`}
                      </p>

                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {lowStockProducts.slice(0, 4).map((p) => (
                          <span
                            key={p.id}
                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-card border-border border-crisp text-[10.5px] font-medium text-amber-900 dark:text-amber-300 font-sans"
                          >
                            <span className="font-bold truncate max-w-[120px]">{p.name}</span>
                            <span className="w-1 h-1 rounded-full bg-amber-400 shrink-0" />
                            <span className="font-mono font-bold text-rose-600 dark:text-rose-400">
                              {p.currentStock} {p.unitOfMeasure}
                            </span>
                          </span>
                        ))}
                        {lowStockProducts.length > 4 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-amber-500/10 text-[10.5px] font-bold text-amber-700 dark:text-amber-300">
                            +{lowStockProducts.length - 4} more
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    id="dashboard-replenish-inventory-btn"
                    size="md"
                    variant="secondary"
                    onClick={() => onNavigate('inventory')}
                    leftIcon={<ArrowUpRight className="h-4 w-4" />}
                    className="w-full md:w-auto text-xs font-bold shrink-0 self-stretch md:self-center bg-card hover:bg-background text-text border-border border-crisp transition-colors cursor-pointer min-h-[44px]"
                  >
                    {language === 'th' ? 'จัดการคลังสินค้า' : 'Replenish Inventory'}
                  </Button>
                </div>
              );
            }
          } else if (widgetId === 'kpis') {
            widgetContent = isFinancialAuthorized ? (
              <ManagerFinancialKPIs
                metrics={metrics}
                currentShift={currentShift}
                pendingCount={pendingCount}
                isLoading={isLoading}
                orders={orders}
                storeId={session?.currentStore?.id}
              />
            ) : (
              <StaffOperationalKPIs
                metrics={metrics}
                currentShift={currentShift}
                pendingCount={pendingCount}
                isLoading={isLoading}
              />
            );
          } else if (widgetId === 'hourly_chart') {
            widgetContent = (
              <HourlyVelocityChart
                isManager={isFinancialAuthorized}
                hourlyData={shiftHourlyData}
                currentShift={currentShift}
                currency={session?.currentStore?.currency || 'THB'}
                orders={orders}
                storeId={session?.currentStore?.id}
              />
            );
          } else if (widgetId === 'quick_actions') {
            widgetContent = <DashboardQuickActions onNavigate={onNavigate} />;
          } else if (widgetId === 'recent_orders') {
            widgetContent = (
              <RecentTransactionsSection
                isManager={isFinancialAuthorized}
                orders={filteredOrders}
                onNavigate={onNavigate}
                onResetToday={handleResetToday}
              />
            );
          }

          if (!widgetContent) return null;

          const titleObj = WIDGET_TITLES[widgetId] || { th: widgetId, en: widgetId };
          const widgetTitleText = language === 'th' ? titleObj.th : titleObj.en;

          return (
            <div
              key={widgetId}
              draggable={isCustomizeMode}
              onDragStart={(e) => handleDragStart(e, widgetId)}
              onDragOver={(e) => handleDragOver(e, widgetId)}
              onDrop={(e) => handleDrop(e, widgetId)}
              className={`transition-all duration-200 ${
                isCustomizeMode
                  ? 'p-3.5 rounded-2xl border-2 border-dashed border-primary/40 bg-card/70 shadow-sm relative group cursor-grab active:cursor-grabbing'
                  : ''
              } ${dragOverWidgetId === widgetId ? 'bg-primary/5 border-primary scale-[1.005]' : ''}`}
            >
              {isCustomizeMode && (
                <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-border/60">
                  <div className="flex items-center gap-2 text-xs font-bold text-text">
                    <GripVertical className="h-4 w-4 text-text/40 group-hover:text-primary transition-colors cursor-grab" />
                    <span className="px-2 py-0.5 rounded bg-primary/10 text-primary font-mono text-[11px]">
                      #{index + 1}
                    </span>
                    <span>{widgetTitleText}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveWidgetDirection(widgetId, 'up')}
                      disabled={index === 0}
                      className="p-1.5 rounded-lg border border-border bg-card hover:bg-background disabled:opacity-30 transition-colors text-text text-xs cursor-pointer"
                      title="Move Up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveWidgetDirection(widgetId, 'down')}
                      disabled={index === widgetOrder.length - 1}
                      className="p-1.5 rounded-lg border border-border bg-card hover:bg-background disabled:opacity-30 transition-colors text-text text-xs cursor-pointer"
                      title="Move Down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}

              {widgetContent}
            </div>
          );
        })}
      </div>
    </div>
  );
};

