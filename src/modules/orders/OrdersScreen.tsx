import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { useBreadcrumb, BreadcrumbLevel } from '../../context/BreadcrumbContext';
import { useReceiptPrinter } from '../../context/ReceiptPrinterContext';
import { createOrderTransactionApi } from '../../adapters/orderTransactionApiFactory';
import { createProductionSupervisorAuthorizationApi } from '../../adapters/productionSupervisorAuthorizationApi';
import { Order, TransactionStatus } from '../../domain/order';
import { formatMoney } from '../../domain/money';
import { Card, CardHeader, CardBody } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { SearchInput } from '../../components/common/SearchInput';
import { Tabs } from '../../components/common/Tabs';
import { EmptyState } from '../../components/common/EmptyState';
import { ReceiptPrintModal } from '../../components/receipt/ReceiptPrintModal';
import { FullTaxInvoiceModal } from '../../components/receipt/FullTaxInvoiceModal';
import { SupervisorAuthModal } from '../../components/auth/SupervisorAuthModal';
import { OrderRefundModal } from '../../components/orders/OrderRefundModal';
import { User } from '../../domain/auth';
import { useCart } from '../../context/CartContext';
import { NavRoute } from '../../components/layout/Sidebar';
import {
  Receipt,
  Search,
  Filter,
  Ban,
  Printer,
  ShieldAlert,
  Clock,
  CheckCircle2,
  WifiOff,
  Eye,
  FileText,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Zap,
  ShoppingCart,
} from 'lucide-react';
import { triggerHaptic } from '../../services/hapticService';

export interface OrdersScreenProps {
  onNavigate?: (route: NavRoute) => void;
}

export const OrdersScreen: React.FC<OrdersScreenProps> = ({ onNavigate }) => {
  const { session, can } = useAuth();
  const { addToast } = useToast();
  const { t, language } = useLanguage();
  const { printReceipt, isPrinting, printerConfig } = useReceiptPrinter();
  const { setSubLevels } = useBreadcrumb();
  const { items: currentCartItems, reorderItems } = useCart();

  const [orders, setOrders] = useState<readonly Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [reorderCandidateOrder, setReorderCandidateOrder] = useState<Order | null>(null);
  const [isReceiptPrintModalOpen, setIsReceiptPrintModalOpen] = useState(false);
  const [isFullTaxModalOpen, setIsFullTaxModalOpen] = useState(false);

  const handleOrderPrint = async (order: Order) => {
    setSelectedOrder(order);
    if (printerConfig.quickPrint) {
      triggerHaptic('tap');
      const res = await printReceipt(order);
      if (res.success) {
        addToast({
          title: language === 'th' ? 'ส่งคำสั่งพิมพ์ด่วนสำเร็จ' : 'Quick Print Dispatched',
          message: language === 'th'
            ? `พิมพ์ใบเสร็จ #${order.orderNumber} ตรงไปยังเครื่องพิมพ์เรียบร้อย (ข้ามหน้าต่าง Preview)`
            : `Receipt #${order.orderNumber} sent directly to thermal printer (Quick Print enabled).`,
          type: 'success',
        });
      } else {
        addToast({
          title: language === 'th' ? 'การพิมพ์ล้มเหลว' : 'Print Error',
          message: res.message,
          type: 'error',
        });
      }
    } else {
      setIsReceiptPrintModalOpen(true);
    }
  };
  const [isRefundModalOpen, setIsRefundModalOpen] = useState(false);
  const [isSupervisorVoidModalOpen, setIsSupervisorVoidModalOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isVoiding, setIsVoiding] = useState(false);
  const [expandedOrderIds, setExpandedOrderIds] = useState<Record<string, boolean>>({});

  // Synchronize Orders navigation depth with global breadcrumbs
  useEffect(() => {
    const levels: BreadcrumbLevel[] = [];

    let filterLabel = { th: 'บิลทั้งหมด', en: 'All Receipts' };
    if (activeFilter === 'completed') filterLabel = { th: 'ชำระสำเร็จ', en: 'Completed' };
    if (activeFilter === 'voided') filterLabel = { th: 'ยกเลิกแล้ว', en: 'Voided' };
    if (activeFilter === 'refunded') filterLabel = { th: 'คืนเงินแล้ว', en: 'Refunded' };

    levels.push({
      id: 'orders-filter',
      label: filterLabel,
      onClick: () => {
        setActiveFilter('all');
        setSelectedOrder(null);
        setSearchQuery('');
      },
    });

    if (selectedOrder) {
      levels.push({
        id: 'orders-selected',
        label: {
          th: `บิล #${selectedOrder.orderNumber || selectedOrder.id.slice(0, 8)}`,
          en: `Receipt #${selectedOrder.orderNumber || selectedOrder.id.slice(0, 8)}`,
        },
        onClick: () => setSelectedOrder(null),
      });
    } else if (searchQuery.trim()) {
      levels.push({
        id: 'orders-search',
        label: { th: `ค้นหา: "${searchQuery}"`, en: `Search: "${searchQuery}"` },
        onClick: () => setSearchQuery(''),
      });
    }

    setSubLevels(levels);
  }, [activeFilter, selectedOrder, searchQuery, setSubLevels]);

  const toggleOrderExpansion = (orderId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedOrderIds((prev) => ({
      ...prev,
      [orderId]: !prev[orderId],
    }));
  };

  useEffect(() => {
    async function fetchOrders() {
      if (!session) return;
      setIsLoading(true);
      try {
        const list = await createOrderTransactionApi(session.token).getOrders(session.currentStore.id);
        setOrders(list);

        // Auto-select order if navigated from Command Palette or external link
        const targetOrderId =
          sessionStorage.getItem('prodx_selected_order_id') ||
          localStorage.getItem('prodx_selected_order_id');
        if (targetOrderId) {
          sessionStorage.removeItem('prodx_selected_order_id');
          localStorage.removeItem('prodx_selected_order_id');
          const found = list.find(
            (o) => o.id === targetOrderId || o.orderNumber.toLowerCase() === targetOrderId.toLowerCase()
          );
          if (found) {
            setSelectedOrder(found);
          }
        }
      } catch (err) {
        console.error('[OrdersScreen] Error:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchOrders();

    const handleOrderCompleted = () => {
      fetchOrders();
    };

    const handleSelectOrderEvent = (e: Event) => {
      const customEvt = e as CustomEvent<{ orderId: string }>;
      if (customEvt.detail?.orderId) {
        const targetId = customEvt.detail.orderId;
        setOrders((currentList) => {
          const found = currentList.find(
            (o) => o.id === targetId || o.orderNumber.toLowerCase() === targetId.toLowerCase()
          );
          if (found) {
            setSelectedOrder(found);
          }
          return currentList;
        });
      }
    };

    window.addEventListener('prodx:order-completed', handleOrderCompleted);
    window.addEventListener('prodx:inventory-updated', handleOrderCompleted);
    window.addEventListener('prodx:select-order', handleSelectOrderEvent);
    return () => {
      window.removeEventListener('prodx:order-completed', handleOrderCompleted);
      window.removeEventListener('prodx:inventory-updated', handleOrderCompleted);
      window.removeEventListener('prodx:select-order', handleSelectOrderEvent);
    };
  }, [session]);

  const orderMetrics = React.useMemo(() => {
    const totalCount = orders.length;
    let confirmedRevenueCents = 0;
    let offlineCount = 0;
    let refundedVoidedCount = 0;

    for (const o of orders) {
      if (o.status === 'server_confirmed') {
        confirmedRevenueCents += o.totals.grandTotal.amountInCents;
      } else if (o.status === 'pending_sync_offline') {
        offlineCount++;
        confirmedRevenueCents += o.totals.grandTotal.amountInCents;
      } else if (o.status === 'refunded' || o.status === 'voided') {
        refundedVoidedCount++;
      }
    }

    return {
      totalCount,
      confirmedRevenueCents,
      offlineCount,
      refundedVoidedCount,
      currency: orders[0]?.totals.grandTotal.currency || session?.currentStore.currency || 'THB',
    };
  }, [orders, session]);

  const filteredOrders = orders.filter((o) => {
    const matchesFilter =
      activeFilter === 'all' ||
      (activeFilter === 'confirmed' && o.status === 'server_confirmed') ||
      (activeFilter === 'offline' && o.status === 'pending_sync_offline') ||
      (activeFilter === 'refunded' && o.status === 'refunded') ||
      (activeFilter === 'voided' && o.status === 'voided');

    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      o.orderNumber.toLowerCase().includes(q) ||
      (o.customer && o.customer.name.toLowerCase().includes(q)) ||
      o.idempotencyKey.toLowerCase().includes(q);

    return matchesFilter && matchesSearch;
  });

  const handleInitiateVoid = () => {
    if (!selectedOrder) return;
    setIsSupervisorVoidModalOpen(true);
  };

  const handleSupervisorVoidAuthorized = async (supervisor: User, reasonNotes?: string, supervisorSecret?: string) => {
    if (!session || !selectedOrder) return;
    setIsVoiding(true);
    try {
      const reason = reasonNotes || 'Supervisor authorized void';
      const api = createOrderTransactionApi(session.token);
      const authorizationToken = import.meta.env.DEV
        ? undefined
        : (await createProductionSupervisorAuthorizationApi(session.token).authorize({
            action: 'void',
            orderId: selectedOrder.id,
            supervisorUsername: supervisor.email,
            supervisorSecret: supervisorSecret || '',
          })).authorizationToken;
      const voided = await api.voidOrder(
        session.currentStore.id,
        selectedOrder.id,
        reason,
        supervisor.id,
        authorizationToken
      );
      setOrders((prev) => prev.map((o) => (o.id === voided.id ? voided : o)));
      setSelectedOrder(voided);
      addToast({
        title: language === 'th' ? 'ยกเลิกคำสั่งซื้อแล้ว' : 'Order Voided',
        message:
          language === 'th'
            ? `คำสั่งซื้อ #${voided.orderNumber} ถูกยกเลิกโดย ${supervisor.name} เรียบร้อยแล้ว`
            : `Order #${voided.orderNumber} voided by ${supervisor.name}.`,
        type: 'info',
      });
    } catch (err: any) {
      addToast({
        title: language === 'th' ? 'ยกเลิกคำสั่งซื้อไม่สำเร็จ' : 'Void Operation Failed',
        message: err?.message || 'Unable to void order.',
        type: 'error',
      });
    } finally {
      setIsVoiding(false);
    }
  };

  const handleReorder = (order: Order, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!order || order.items.length === 0) {
      addToast({
        title: language === 'th' ? 'ไม่มีรายการสินค้า' : 'No Items to Reorder',
        message: language === 'th' ? 'คำสั่งซื้อนี้ไม่มีรายการสินค้า' : 'This order has no line items.',
        type: 'warning',
      });
      return;
    }

    // If active POS cart already contains items, prompt user for action
    if (currentCartItems.length > 0) {
      setReorderCandidateOrder(order);
      return;
    }

    // Cart is currently empty, proceed directly
    executeReorder(order, true);
  };

  const executeReorder = (order: Order, replace: boolean) => {
    triggerHaptic('success');
    const totalUnits = order.items.reduce((sum, item) => sum + item.quantity, 0);

    reorderItems(order.items, {
      replace,
      customer: order.customer || null,
      notes: order.notes ? `[Reorder #${order.orderNumber}] ${order.notes}` : `[Reorder #${order.orderNumber}]`,
    });

    addToast({
      title: language === 'th' ? 'นำสินค้าเข้าตะกร้าสำเร็จ' : 'Order Loaded into POS Cart',
      message: language === 'th'
        ? `นำเข้า ${order.items.length} รายการ (${totalUnits} ชิ้น) จากบิล #${order.orderNumber} ไปยังหน้าขายเรียบร้อย`
        : `Loaded ${order.items.length} items (${totalUnits} units) from order #${order.orderNumber} into active register.`,
      type: 'success',
    });

    setReorderCandidateOrder(null);
    setSelectedOrder(null);
    if (onNavigate) {
      onNavigate('pos');
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 bg-background text-text no-scrollbar">
      {/* Top Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pb-4 sm:pb-6 border-b border-border/50">
        <div className="min-w-0 flex-1">
          <h1 className="text-heading-1 text-text">
            {t.orders.title}
          </h1>
          <p className="text-caption text-text/70 mt-1">
            {t.orders.subtitle}
          </p>
        </div>
        {/* Action button container */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 shrink-0">
          <Button
            id="orders-quick-refund-top-btn"
            variant="outline"
            size="md"
            onClick={() => {
              // If an order is selected, open refund modal for it
              if (selectedOrder && selectedOrder.status !== 'voided' && selectedOrder.status !== 'refunded') {
                setIsRefundModalOpen(true);
                return;
              }
              // Otherwise find the latest refundable order
              const refundable = orders.find(
                (o) => o.status !== 'voided' && o.status !== 'refunded'
              );
              if (refundable) {
                setSelectedOrder(refundable);
                setIsRefundModalOpen(true);
              } else {
                addToast({
                  title: language === 'th' ? 'ไม่พบบิลที่คืนเงินได้' : 'No Refundable Orders',
                  message:
                    language === 'th'
                      ? 'ไม่มีคำสั่งซื้อที่สามารถทำรายการคืนเงินได้ในขณะนี้'
                      : 'No active completed orders available for refund.',
                  type: 'info',
                });
              }
            }}
            leftIcon={<Zap className="h-4 w-4 text-amber-500 fill-amber-500/20" />}
            className="whitespace-nowrap border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 font-bold"
          >
            {t.orders.quickRefund || (language === 'th' ? 'คืนเงินด่วน' : 'Quick Refund')}
          </Button>

          <Button
            variant="secondary"
            size="md"
            onClick={() => {
              addToast({
                title: language === 'th' ? 'ส่งออกข้อมูล' : 'Export Orders',
                message: language === 'th' ? 'ส่งออกรายการคำสั่งซื้อเรียบร้อย' : 'Orders exported successfully',
                type: 'success',
              });
            }}
            leftIcon={<FileText className="h-4 w-4 text-primary" />}
            className="whitespace-nowrap"
          >
            {language === 'th' ? 'ส่งออกรายงาน' : 'Export Orders'}
          </Button>
        </div>
      </div>

      {/* Executive Orders KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Metric 1: Total Orders */}
        <div className="p-4 rounded-xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{language === 'th' ? 'คำสั่งซื้อทั้งหมด' : 'Total Orders'}</span>
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Receipt className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tracking-tight text-text">
            {orderMetrics.totalCount} <span className="text-xs font-sans font-medium text-text/60">{language === 'th' ? 'รายการ' : 'txns'}</span>
          </div>
          <div className="mt-1.5 text-[11px] text-text/60">
            {language === 'th' ? 'รวมทุกสถานะบนเครื่องขาย' : 'Lifetime store transactions'}
          </div>
        </div>

        {/* Metric 2: Gross Revenue */}
        <div className="p-4 rounded-xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{language === 'th' ? 'ยอดขายสะสม' : 'Total Revenue'}</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tracking-tight text-emerald-600 dark:text-emerald-400">
            {formatMoney({ amountInCents: orderMetrics.confirmedRevenueCents, currency: orderMetrics.currency })}
          </div>
          <div className="mt-1.5 text-[11px] text-text/60">
            {language === 'th' ? 'จากคำสั่งซื้อที่เสร็จสมบูรณ์' : 'Server confirmed receipts'}
          </div>
        </div>

        {/* Metric 3: Offline Pending Sync */}
        <div className="p-4 rounded-xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{language === 'th' ? 'รอซิงก์ออฟไลน์' : 'Pending Sync'}</span>
            <div className={`p-1.5 rounded-lg ${orderMetrics.offlineCount > 0 ? 'bg-amber-500/15 text-amber-500' : 'bg-text/5 text-text/40'}`}>
              <WifiOff className="h-4 w-4" />
            </div>
          </div>
          <div className={`mt-2 text-2xl font-black font-mono tracking-tight ${orderMetrics.offlineCount > 0 ? 'text-amber-500' : 'text-text'}`}>
            {orderMetrics.offlineCount} <span className="text-xs font-sans font-medium text-text/60">{language === 'th' ? 'คิว' : 'queued'}</span>
          </div>
          <div className="mt-1.5 text-[11px] text-text/60">
            {orderMetrics.offlineCount > 0 ? (language === 'th' ? 'รอเชื่อมต่อคลาวด์' : 'Awaiting connection') : (language === 'th' ? 'ข้อมูลซิงก์ครบถ้วน' : 'All synced to cloud')}
          </div>
        </div>

        {/* Metric 4: Refunded / Voided */}
        <div className="p-4 rounded-xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{language === 'th' ? 'คืนเงิน / ยกเลิก' : 'Refunds & Voids'}</span>
            <div className="p-1.5 rounded-lg bg-rose-500/10 text-rose-500">
              <RotateCcw className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tracking-tight text-rose-500">
            {orderMetrics.refundedVoidedCount} <span className="text-xs font-sans font-medium text-text/60">{language === 'th' ? 'รายการ' : 'items'}</span>
          </div>
          <div className="mt-1.5 text-[11px] text-text/60">
            {language === 'th' ? 'ผ่านการอนุมัติ PIN ผู้จัดการ' : 'Supervisor audited'}
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex-1 max-w-md">
          <SearchInput
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery('')}
            placeholder={t.orders.searchPlaceholder}
          />
        </div>

        <div className="overflow-x-auto no-scrollbar py-0.5">
          <Tabs
            tabs={[
              { id: 'all', label: language === 'th' ? 'ทั้งหมด' : 'All Orders' },
              { id: 'confirmed', label: language === 'th' ? 'ยืนยันแล้ว' : 'Confirmed' },
              { id: 'offline', label: language === 'th' ? 'รอซิงก์' : 'Pending Sync' },
              { id: 'refunded', label: language === 'th' ? 'คืนเงินแล้ว' : 'Refunded' },
              { id: 'voided', label: language === 'th' ? 'ยกเลิกแล้ว' : 'Voided' },
            ]}
            activeTab={activeFilter}
            onChange={setActiveFilter}
          />
        </div>
      </div>

      {/* Balanced Master-Detail or Full-Width Workspace Layout */}
      <div className="flex flex-col lg:flex-row gap-6 items-start flex-1 min-h-0">
        {/* Left / Main Table View */}
        <div className={`flex flex-col gap-4 min-h-0 transition-all duration-200 ${selectedOrder ? 'w-full lg:w-[58%] xl:w-[62%]' : 'w-full'}`}>
          <div className="w-full overflow-x-auto rounded-xl border border-border bg-card shadow-2xs flex-1 flex flex-col min-h-0">
            <table className="w-full min-w-[640px] text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-text/70 bg-card font-semibold">
                  <th className="py-3.5 px-5">{t.orders.orderNumber}</th>
                  <th className="py-3.5 px-4">{t.orders.dateTime}</th>
                  <th className="py-3.5 px-4">{language === 'th' ? 'เครื่องขาย' : 'Register'}</th>
                  <th className="py-3.5 px-4">{t.orders.customer}</th>
                  <th className="py-3.5 px-4">{t.orders.payment}</th>
                  <th className="py-3.5 px-4">{t.orders.status}</th>
                  <th className="py-3.5 px-5 text-right">{t.orders.total}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-text/50">
                      <Receipt className="h-8 w-8 mx-auto text-text/30 mb-2" />
                      <p className="text-xs font-semibold text-text">
                        {language === 'th' ? 'ไม่พบรายการคำสั่งซื้อ' : 'No orders found'}
                      </p>
                      <p className="text-[11px] text-text/50 mt-0.5">
                        {language === 'th' ? 'ลองปรับคำค้นหาหรือเปลี่ยนตัวกรองสถานะ' : 'Try adjusting your search or status filter.'}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order) => {
                    const isSelected = selectedOrder?.id === order.id;
                    const isExpanded = !!expandedOrderIds[order.id];
                    return (
                      <React.Fragment key={order.id}>
                        <tr
                          onClick={() => {
                            setSelectedOrder(order);
                            toggleOrderExpansion(order.id);
                          }}
                          className={`odd:bg-card even:bg-background/30 hover:bg-primary/5 cursor-pointer transition-colors ${
                            isSelected ? 'bg-primary/10 border-l-4 border-primary font-semibold' : ''
                          }`}
                        >
                          <td className="py-3.5 px-5 font-mono font-bold text-text">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={(e) => toggleOrderExpansion(order.id, e)}
                                className={`p-1 rounded-lg transition-colors cursor-pointer ${
                                  isExpanded
                                    ? 'bg-primary/20 text-primary'
                                    : 'hover:bg-primary/10 text-text/60 hover:text-text'
                                }`}
                                title={
                                  isExpanded
                                    ? language === 'th' ? 'ย่อรายละเอียด' : 'Collapse line items'
                                    : language === 'th' ? 'ขยายดูสินค้าในใบเสร็จ' : 'Expand line items'
                                }
                              >
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4 text-primary shrink-0" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 shrink-0" />
                                )}
                              </button>
                              <span className="truncate">{order.orderNumber}</span>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-text/70 font-mono">
                            {new Date(order.createdAt).toLocaleDateString()} ·{' '}
                            {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-text/70">
                            {order.registerId}
                          </td>
                          <td className="py-3.5 px-4 font-medium text-text">
                            {order.customer ? order.customer.name : t.pos.walkIn}
                          </td>
                          <td className="py-3.5 px-4 uppercase text-[10px] font-semibold text-text/70">
                            {order.payments[0]?.method === 'cash'
                              ? t.checkout.cash
                              : order.payments[0]?.method === 'card'
                              ? t.checkout.card
                              : t.checkout.promptpay}
                          </td>
                          <td className="py-3.5 px-4">
                            {order.status === 'server_confirmed' ? (
                              <Badge variant="success" size="sm" dot>
                                {t.orders.completed}
                              </Badge>
                            ) : order.status === 'pending_sync_offline' ? (
                              <Badge variant="offline" size="sm" dot>
                                {language === 'th' ? 'รอซิงก์ (ออฟไลน์)' : 'Pending Sync'}
                              </Badge>
                            ) : order.status === 'refunded' ? (
                              <Badge variant="warning" size="sm" dot>
                                {language === 'th' ? 'คืนเงินแล้ว' : 'Refunded'}
                              </Badge>
                            ) : (
                              <Badge variant="danger" size="sm">
                                {order.status}
                              </Badge>
                            )}
                          </td>
                          <td className="py-3.5 px-5 text-right font-mono font-bold text-text">
                            {formatMoney(order.totals.grandTotal)}
                          </td>
                        </tr>

                        <AnimatePresence initial={false}>
                          {isExpanded && (
                            <tr key={`expanded-${order.id}`} className="bg-primary/5 dark:bg-primary/10 border-b border-border">
                              <td colSpan={7} className="p-0">
                                <motion.div
                                  initial={{ opacity: 0, height: 0 }}
                                  animate={{ opacity: 1, height: 'auto' }}
                                  exit={{ opacity: 0, height: 0 }}
                                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                                  style={{ overflow: 'hidden' }}
                                >
                                  <div className="p-3.5 sm:p-4 md:p-5">
                                    <div className="bg-card rounded-xl border border-border/80 p-4 shadow-xs space-y-3.5">
                                      {/* Line Items Header Bar */}
                                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border/60 pb-3">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <div className="p-1.5 rounded-lg bg-primary/10 text-primary shrink-0">
                                            <Receipt className="h-4 w-4" />
                                          </div>
                                          <div>
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="text-xs font-bold uppercase tracking-wider text-text">
                                                {language === 'th' ? 'รายการสินค้าในใบเสร็จ' : 'Line-Item Transaction Breakdown'}
                                              </span>
                                              <span className="font-mono text-xs font-bold text-primary">
                                                #{order.orderNumber}
                                              </span>
                                            </div>
                                            <p className="text-[11px] text-text/60 mt-0.5">
                                              {language === 'th' ? 'ลูกค้า' : 'Customer'}: {order.customer ? `${order.customer.name} (${order.customer.phone || 'No Phone'})` : t.pos.walkIn} · {language === 'th' ? 'พนักงานขาย' : 'Cashier'}: {order.cashierName || 'Staff'}
                                            </p>
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-2 self-start sm:self-auto shrink-0 font-mono text-[11px]">
                                          <span className="px-2 py-0.5 rounded bg-background border border-border text-text/70">
                                            POS: {order.registerId}
                                          </span>
                                          <span className="px-2 py-0.5 rounded bg-background border border-border text-text/70">
                                            {order.items.reduce((s, i) => s + i.quantity, 0)} {language === 'th' ? 'ชิ้น' : 'items'}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Itemized Table */}
                                      <div className="w-full overflow-x-auto rounded-lg border border-border bg-card">
                                        <table className="w-full text-left text-xs border-collapse">
                                          <thead>
                                            <tr className="bg-card/80 text-text/70 border-b border-border text-[11px] font-semibold">
                                              <th className="py-2.5 px-3.5">{language === 'th' ? 'ชื่อสินค้า / รายการ' : 'Product / Description'}</th>
                                              <th className="py-2.5 px-3 text-center w-20">{language === 'th' ? 'จำนวน' : 'Qty'}</th>
                                              <th className="py-2.5 px-3 text-right w-28">{language === 'th' ? 'ราคา/หน่วย' : 'Unit Price'}</th>
                                              <th className="py-2.5 px-3.5 text-right w-32">{language === 'th' ? 'ราคารวม' : 'Line Total'}</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-border/60 font-mono text-xs">
                                            {order.items.map((item) => (
                                              <tr key={item.lineId} className="odd:bg-card/50 even:bg-background/20 hover:bg-primary/5 transition-colors">
                                                <td className="py-2.5 px-3.5 font-sans">
                                                  <div className="font-bold text-text">{item.product.name}</div>
                                                  {item.product.sku && (
                                                    <div className="text-[10px] text-text/50 font-mono mt-0.5">
                                                      SKU: {item.product.sku}
                                                    </div>
                                                  )}
                                                  {item.discountBps > 0 && (
                                                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-sans mt-0.5">
                                                      Discount: {item.discountBps / 100}%
                                                    </div>
                                                  )}
                                                </td>
                                                <td className="py-2.5 px-3 text-center text-text/80 font-bold">
                                                  {item.quantity}
                                                </td>
                                                <td className="py-2.5 px-3 text-right text-text/70">
                                                  {formatMoney(item.unitPrice)}
                                                </td>
                                                <td className="py-2.5 px-3.5 text-right font-bold text-text">
                                                  {formatMoney(item.lineTotal)}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>

                                      {/* Transaction Totals & Settlement Info */}
                                      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-3 rounded-lg bg-background border border-border text-xs font-mono">
                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-text/80 text-[11px]">
                                          <div>
                                            <span className="text-text/50 font-sans">{language === 'th' ? 'ยอดรวมสินค้า' : 'Subtotal'}:</span>{' '}
                                            <span className="font-bold">{formatMoney(order.totals.grossSubtotal)}</span>
                                          </div>
                                          {order.totals.totalTax.amountInCents > 0 && (
                                            <div>
                                              <span className="text-text/50 font-sans">{language === 'th' ? 'ภาษี (VAT)' : 'Tax'}:</span>{' '}
                                              <span className="font-bold">{formatMoney(order.totals.totalTax)}</span>
                                            </div>
                                          )}
                                          {(order.totals.itemDiscounts.amountInCents + order.totals.orderDiscount.amountInCents) > 0 && (
                                            <div className="text-emerald-600 dark:text-emerald-400">
                                              <span className="font-sans">{language === 'th' ? 'ส่วนลดรวม' : 'Total Disc'}:</span>{' '}
                                              <span className="font-bold">
                                                -{formatMoney({ amountInCents: order.totals.itemDiscounts.amountInCents + order.totals.orderDiscount.amountInCents, currency: order.totals.grandTotal.currency })}
                                              </span>
                                            </div>
                                          )}
                                          <div>
                                            <span className="text-text/50 font-sans">{language === 'th' ? 'ชำระโดย' : 'Payment'}:</span>{' '}
                                            <span className="font-bold uppercase">
                                              {order.payments[0]?.method || 'Cash'}
                                            </span>
                                          </div>
                                        </div>

                                        <div className="flex items-center justify-between md:justify-end gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-border">
                                          <span className="text-text/70 text-[11px] font-sans font-bold">
                                            {language === 'th' ? 'สุทธิ (Grand Total):' : 'Grand Total:'}
                                          </span>
                                          <span className="text-sm font-black font-mono text-primary">
                                            {formatMoney(order.totals.grandTotal)}
                                          </span>
                                        </div>
                                      </div>

                                      {/* Direct Action Toolbar within Expanded Row */}
                                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60 flex-wrap">
                                        <Button
                                          type="button"
                                          variant="primary"
                                          size="sm"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleReorder(order);
                                          }}
                                          leftIcon={<ShoppingCart className="h-3.5 w-3.5 shrink-0" />}
                                          className="text-xs h-8 px-2.5 font-bold cursor-pointer"
                                        >
                                          {t.orders.reorder || (language === 'th' ? 'สั่งซื้อซ้ำ' : 'Reorder')}
                                        </Button>

                                        <div className="flex items-center gap-1.5">
                                          <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleOrderPrint(order);
                                            }}
                                            leftIcon={printerConfig.quickPrint ? <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" /> : <Printer className="h-3.5 w-3.5 text-primary shrink-0" />}
                                            className="text-xs h-8 px-2.5 font-bold cursor-pointer"
                                            isLoading={isPrinting && selectedOrder?.id === order.id}
                                          >
                                            {printerConfig.quickPrint ? (language === 'th' ? 'พิมพ์สลิปด่วน' : 'Quick Print') : t.orders.reprintReceipt}
                                          </Button>
                                          {printerConfig.quickPrint && (
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              title={language === 'th' ? 'ดูตัวอย่างก่อนพิมพ์' : 'Preview receipt layout'}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedOrder(order);
                                                setIsReceiptPrintModalOpen(true);
                                              }}
                                              className="text-xs h-8 px-2 font-bold cursor-pointer"
                                            >
                                              <Eye className="h-3.5 w-3.5 text-text/60" />
                                            </Button>
                                          )}
                                        </div>

                                        <Button
                                          type="button"
                                          variant="outline"
                                          size="sm"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedOrder(order);
                                            setIsFullTaxModalOpen(true);
                                          }}
                                          leftIcon={<FileText className="h-3.5 w-3.5 text-primary shrink-0" />}
                                          className="text-xs h-8 px-2.5 font-bold cursor-pointer"
                                        >
                                          {language === 'th' ? 'ใบกำกับภาษีเต็มรูป' : 'Tax Invoice'}
                                        </Button>

                                        {order.status !== 'voided' && order.status !== 'refunded' && (
                                          <>
                                            <Button
                                              type="button"
                                              variant="outline"
                                              size="sm"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedOrder(order);
                                                setIsRefundModalOpen(true);
                                              }}
                                              leftIcon={<Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-500/20 shrink-0" />}
                                              className="text-xs h-8 px-2.5 font-bold cursor-pointer text-amber-600 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/10"
                                            >
                                              {t.orders.quickRefund || (language === 'th' ? 'คืนเงินด่วน' : 'Quick Refund')}
                                            </Button>

                                            <Button
                                              type="button"
                                              variant="danger"
                                              size="sm"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedOrder(order);
                                                handleInitiateVoid();
                                              }}
                                              leftIcon={<Ban className="h-3.5 w-3.5 shrink-0" />}
                                              className="text-xs h-8 px-2.5 font-bold cursor-pointer"
                                            >
                                              {language === 'th' ? 'ยกเลิกบิล' : 'Void'}
                                            </Button>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </motion.div>
                              </td>
                            </tr>
                          )}
                        </AnimatePresence>
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Detail Pane (Desktop & POS display when an order is active) */}
        {selectedOrder && (
          <div className="hidden lg:flex w-full lg:w-[42%] xl:w-[38%] flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sticky top-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-text">
                    {t.orders.orderNumber}: {selectedOrder.orderNumber}
                  </h3>
                  <Badge
                    variant={
                      selectedOrder.status === 'server_confirmed'
                        ? 'success'
                        : selectedOrder.status === 'pending_sync_offline'
                        ? 'offline'
                        : selectedOrder.status === 'refunded'
                        ? 'warning'
                        : 'danger'
                    }
                    size="sm"
                  >
                    {selectedOrder.status.replace('_', ' ').toUpperCase()}
                  </Badge>
                </div>
                <p className="text-[11px] text-text/60 mt-0.5">
                  {new Date(selectedOrder.createdAt).toLocaleString()} · {selectedOrder.registerId}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedOrder(null)}
                className="text-text/50 hover:text-text h-8 px-2"
              >
                ✕
              </Button>
            </div>

            {/* Line Items List */}
            <div className="w-full overflow-x-auto rounded-lg border border-border bg-card max-h-56 overflow-y-auto no-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-background text-text/70 font-semibold border-b border-border">
                    <th className="py-2 px-3">{language === 'th' ? 'รายการสินค้า' : 'Item'}</th>
                    <th className="py-2 px-2 text-center">{language === 'th' ? 'จน.' : 'Qty'}</th>
                    <th className="py-2 px-3 text-right">{language === 'th' ? 'รวม' : 'Total'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono text-xs">
                  {selectedOrder.items.map((i) => (
                    <tr key={i.lineId} className="odd:bg-card even:bg-background/30 hover:bg-primary/5 transition-colors">
                      <td className="py-2 px-3 font-sans font-medium text-text">
                        {i.product.name}
                      </td>
                      <td className="py-2 px-2 text-center text-text/70">{i.quantity}</td>
                      <td className="py-2 px-3 text-right font-bold text-text">{formatMoney(i.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Breakdown */}
            <div className="p-3 rounded-lg bg-background border border-border space-y-1.5 text-xs font-mono text-text">
              <div className="flex justify-between text-text/70">
                <span className="font-sans">{t.pos.subtotal}</span>
                <span>{formatMoney(selectedOrder.totals.netSubtotal)}</span>
              </div>
              <div className="flex justify-between text-text/70">
                <span className="font-sans">{language === 'th' ? 'ภาษีมูลค่าเพิ่ม' : 'Tax / VAT'}</span>
                <span>{formatMoney(selectedOrder.totals.totalTax)}</span>
              </div>
              <div className="pt-2 border-t border-border flex justify-between font-bold text-sm text-primary">
                <span className="font-sans text-text">{t.checkout.totalDue}</span>
                <span>{formatMoney(selectedOrder.totals.grandTotal)}</span>
              </div>
            </div>

            {/* Quick Action Toolbar */}
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleReorder(selectedOrder)}
                leftIcon={<ShoppingCart className="h-3.5 w-3.5 shrink-0" />}
                className="font-bold cursor-pointer"
              >
                {t.orders.reorder || (language === 'th' ? 'สั่งซื้อซ้ำ' : 'Reorder')}
              </Button>

              <div className="flex items-center gap-1">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={() => handleOrderPrint(selectedOrder)}
                  isLoading={isPrinting}
                  leftIcon={printerConfig.quickPrint ? <Zap className="h-3.5 w-3.5 text-amber-500" /> : <Printer className="h-3.5 w-3.5 text-primary" />}
                >
                  {printerConfig.quickPrint ? (language === 'th' ? 'พิมพ์ด่วน' : 'Quick Print') : t.orders.reprintReceipt}
                </Button>
                {printerConfig.quickPrint && (
                  <Button
                    variant="outline"
                    size="sm"
                    title={language === 'th' ? 'ดูตัวอย่าง' : 'Preview'}
                    onClick={() => setIsReceiptPrintModalOpen(true)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsFullTaxModalOpen(true)}
                leftIcon={<FileText className="h-3.5 w-3.5 text-primary" />}
              >
                {language === 'th' ? 'ใบกำกับภาษี (A4)' : 'Tax Invoice'}
              </Button>
              {selectedOrder.status !== 'voided' && selectedOrder.status !== 'refunded' && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsRefundModalOpen(true)}
                    className="text-amber-600 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/10 font-bold"
                    leftIcon={<Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-500/20" />}
                  >
                    {t.orders.quickRefund || (language === 'th' ? 'คืนเงินด่วน' : 'Quick Refund')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={handleInitiateVoid}
                    isLoading={isVoiding}
                    leftIcon={<Ban className="h-3.5 w-3.5" />}
                  >
                    {language === 'th' ? 'ยกเลิกบิล (PIN)' : 'Void (PIN)'}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Order Detail Modal for Mobile & Small Screens */}
      {selectedOrder && (
        <div className="block lg:hidden">
          <Modal
            isOpen={Boolean(selectedOrder)}
            onClose={() => setSelectedOrder(null)}
            title={`${t.orders.orderNumber}: ${selectedOrder.orderNumber}`}
            description={`${language === 'th' ? 'สร้างเมื่อ' : 'Created at'} ${new Date(selectedOrder.createdAt).toLocaleString()} ${language === 'th' ? 'บนเครื่อง' : 'on Register'} ${selectedOrder.registerId}`}
            maxWidth="lg"
            footer={
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 w-full">
                <div className="flex items-center gap-2">
                  {selectedOrder.status !== 'voided' && selectedOrder.status !== 'refunded' && (
                    <>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={handleInitiateVoid}
                        isLoading={isVoiding}
                        leftIcon={<Ban className="h-3.5 w-3.5" />}
                      >
                        {language === 'th' ? 'ยกเลิกบิล' : 'Void'}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setIsRefundModalOpen(true)}
                        className="text-amber-600 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/10 font-bold"
                        leftIcon={<Zap className="h-3.5 w-3.5 text-amber-500 fill-amber-500/20" />}
                      >
                        {t.orders.quickRefund || (language === 'th' ? 'คืนเงินด่วน' : 'Quick Refund')}
                      </Button>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2 ml-auto flex-wrap">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleReorder(selectedOrder)}
                    leftIcon={<ShoppingCart className="h-3.5 w-3.5" />}
                  >
                    {t.orders.reorder || (language === 'th' ? 'สั่งซื้อซ้ำ' : 'Reorder')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsFullTaxModalOpen(true)}
                    leftIcon={<FileText className="h-3.5 w-3.5 text-primary" />}
                  >
                    {language === 'th' ? 'ใบกำกับภาษี' : 'Tax Invoice'}
                  </Button>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleOrderPrint(selectedOrder)}
                      isLoading={isPrinting}
                      leftIcon={printerConfig.quickPrint ? <Zap className="h-3.5 w-3.5 text-amber-300" /> : <Printer className="h-3.5 w-3.5" />}
                    >
                      <span>{printerConfig.quickPrint ? (language === 'th' ? 'พิมพ์ด่วน' : 'Quick Print') : t.orders.reprintReceipt}</span>
                    </Button>
                    {printerConfig.quickPrint && (
                      <Button
                        variant="outline"
                        size="sm"
                        title={language === 'th' ? 'ดูตัวอย่าง' : 'Preview'}
                        onClick={() => setIsReceiptPrintModalOpen(true)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setSelectedOrder(null)}>
                    {language === 'th' ? 'ปิด' : 'Close'}
                  </Button>
                </div>
              </div>
            }
          >
            <div className="space-y-4">
              {/* Status Advisory Banner */}
              <div
                className={`p-3 rounded-lg border-border border-crisp text-xs flex items-start gap-2.5 ${
                  selectedOrder.status === 'server_confirmed'
                    ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                    : selectedOrder.status === 'pending_sync_offline'
                    ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300'
                    : selectedOrder.status === 'refunded'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-rose-500/10 text-rose-800 dark:text-rose-300'
                }`}
              >
                {selectedOrder.status === 'server_confirmed' ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400 mt-0.5" />
                ) : selectedOrder.status === 'pending_sync_offline' ? (
                  <WifiOff className="h-4 w-4 text-amber-500 dark:text-amber-400 mt-0.5" />
                ) : selectedOrder.status === 'refunded' ? (
                  <RotateCcw className="h-4 w-4 text-primary mt-0.5" />
                ) : (
                  <ShieldAlert className="h-4 w-4 text-rose-500 dark:text-rose-400 mt-0.5" />
                )}
                <div>
                  <div className="font-bold">
                    {t.orders.status}: {selectedOrder.status.replace('_', ' ').toUpperCase()}
                  </div>
                  <div className="text-[11px] opacity-80 mt-0.5 font-mono">
                    Idempotency Key: {selectedOrder.idempotencyKey}
                  </div>
                </div>
              </div>

              {/* Line Items List */}
              <div className="w-full overflow-x-auto rounded-lg border border-border bg-card">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-card text-text/70 font-medium border-b border-border">
                      <th className="py-2.5 px-4">{language === 'th' ? 'สินค้า' : 'Item'}</th>
                      <th className="py-2.5 px-3">{language === 'th' ? 'จำนวน' : 'Qty'}</th>
                      <th className="py-2.5 px-3">{language === 'th' ? 'ราคา/หน่วย' : 'Unit Price'}</th>
                      <th className="py-2.5 px-3 text-right">{language === 'th' ? 'ยอดรวม' : 'Line Total'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono">
                    {selectedOrder.items.map((i) => (
                      <tr key={i.lineId} className="odd:bg-card even:bg-background/30 hover:bg-primary/5 transition-colors">
                        <td className="py-2.5 px-4 font-sans font-medium text-text">
                          {i.product.name}
                        </td>
                        <td className="py-2.5 px-3 text-text/70">{i.quantity}</td>
                        <td className="py-2.5 px-3 text-text/70">{formatMoney(i.unitPrice)}</td>
                        <td className="py-2.5 px-3 text-right font-bold text-text">{formatMoney(i.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Financial Totals Breakdown */}
              <div className="p-4 rounded-lg bg-background border-border border-crisp space-y-1.5 text-xs font-mono text-text">
                <div className="flex justify-between text-text/70">
                  <span className="font-sans">{t.pos.subtotal}</span>
                  <span>{formatMoney(selectedOrder.totals.netSubtotal)}</span>
                </div>
                <div className="flex justify-between text-text/70">
                  <span className="font-sans">{language === 'th' ? 'ภาษีมูลค่าเพิ่ม' : 'Tax (Sales / VAT)'}</span>
                  <span>{formatMoney(selectedOrder.totals.totalTax)}</span>
                </div>
                <div className="pt-2 border-t border-border flex justify-between font-bold text-sm text-primary">
                  <span className="font-sans text-text">{t.checkout.totalDue}</span>
                  <span>{formatMoney(selectedOrder.totals.grandTotal)}</span>
                </div>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {/* Thermal Receipt Reprint & Preview Modal */}
      {isReceiptPrintModalOpen && selectedOrder && (
        <ReceiptPrintModal
          isOpen={isReceiptPrintModalOpen}
          onClose={() => setIsReceiptPrintModalOpen(false)}
          order={selectedOrder}
        />
      )}

      {/* Full Tax Invoice Modal (A4 Thai Revenue Compliant) */}
      {isFullTaxModalOpen && selectedOrder && (
        <FullTaxInvoiceModal
          isOpen={isFullTaxModalOpen}
          onClose={() => setIsFullTaxModalOpen(false)}
          order={selectedOrder}
        />
      )}

      {/* Refund Modal */}
      {isRefundModalOpen && selectedOrder && (
        <OrderRefundModal
          isOpen={isRefundModalOpen}
          onClose={() => setIsRefundModalOpen(false)}
          order={selectedOrder}
          onRefundCompleted={(updatedOrder) => {
            setOrders((prev) => prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)));
            setSelectedOrder(updatedOrder);
          }}
        />
      )}

      {/* Supervisor Auth Modal for Voiding */}
      {isSupervisorVoidModalOpen && selectedOrder && (
        <SupervisorAuthModal
          isOpen={isSupervisorVoidModalOpen}
          onClose={() => setIsSupervisorVoidModalOpen(false)}
          title={language === 'th' ? `อนุมัติยกเลิกบิล #${selectedOrder.orderNumber}` : `Authorize Void Order #${selectedOrder.orderNumber}`}
          actionDescription={language === 'th' ? 'กรุณาให้ผู้จัดการหรือแอดมินใส่รหัส PIN เพื่อยืนยันการยกเลิกคำสั่งซื้อ' : 'Please enter manager or administrator PIN to void this transaction.'}
          requiredRole="manager"
          onAuthorized={(supervisor, reason) => {
            handleSupervisorVoidAuthorized(supervisor, reason);
          }}
        />
      )}

      {/* Reorder Active Cart Conflict Modal */}
      {reorderCandidateOrder && (
        <Modal
          isOpen={Boolean(reorderCandidateOrder)}
          onClose={() => setReorderCandidateOrder(null)}
          title={language === 'th' ? 'สั่งซื้อซ้ำ: มีสินค้าค้างในตะกร้า' : 'Reorder: Active Cart Conflict'}
          description={
            language === 'th'
              ? `ขณะนี้มีสินค้าอยู่ในตะกร้าขาย ${currentCartItems.length} รายการ (${currentCartItems.reduce((s, i) => s + i.quantity, 0)} ชิ้น) ต้องการดำเนินการอย่างไร?`
              : `Your POS register cart currently contains ${currentCartItems.length} items (${currentCartItems.reduce((s, i) => s + i.quantity, 0)} units). How would you like to populate the cart?`
          }
          maxWidth="md"
          footer={
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 w-full">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setReorderCandidateOrder(null)}
              >
                {language === 'th' ? 'ยกเลิก' : 'Cancel'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => executeReorder(reorderCandidateOrder, false)}
                leftIcon={<ShoppingCart className="h-3.5 w-3.5 text-primary" />}
              >
                {language === 'th' ? 'เพิ่มต่อท้าย (Append)' : 'Append to Cart'}
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => executeReorder(reorderCandidateOrder, true)}
              >
                {language === 'th' ? 'เขียนทับตะกร้า (Replace)' : 'Replace Cart'}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            {/* Target Order Summary Card */}
            <div className="p-3.5 rounded-xl border border-border bg-card space-y-2.5">
              <div className="flex items-center justify-between text-xs font-bold text-text">
                <span className="flex items-center gap-1.5 text-primary">
                  <Receipt className="h-4 w-4" />
                  <span>#{reorderCandidateOrder.orderNumber}</span>
                </span>
                <span className="font-mono text-primary font-bold">
                  {formatMoney(reorderCandidateOrder.totals.grandTotal)}
                </span>
              </div>
              <div className="text-xs text-text/70 space-y-1">
                <p>
                  <span className="font-semibold text-text">{language === 'th' ? 'ลูกค้า' : 'Customer'}:</span>{' '}
                  {reorderCandidateOrder.customer?.name || t.pos.walkIn}
                </p>
                <p>
                  <span className="font-semibold text-text">{language === 'th' ? 'จำนวนรายการ' : 'Items'}:</span>{' '}
                  {reorderCandidateOrder.items.length} {language === 'th' ? 'รายการ' : 'items'} (
                  {reorderCandidateOrder.items.reduce((s, i) => s + i.quantity, 0)} {language === 'th' ? 'ชิ้น' : 'units'})
                </p>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-300">
              <p className="font-semibold">
                {language === 'th'
                  ? '💡 ข้อแนะนำการใช้งาน:'
                  : '💡 Recommendation:'}
              </p>
              <ul className="list-disc list-inside mt-1 space-y-0.5 opacity-90">
                <li>
                  <strong>{language === 'th' ? 'เขียนทับตะกร้า (Replace)' : 'Replace Cart'}:</strong>{' '}
                  {language === 'th'
                    ? 'ล้างตะกร้าเดิมและใส่สินค้าชุดใหม่ตามบิลนี้พอดี'
                    : 'Clears existing cart and sets exact items from this order.'}
                </li>
                <li>
                  <strong>{language === 'th' ? 'เพิ่มต่อท้าย (Append)' : 'Append to Cart'}:</strong>{' '}
                  {language === 'th'
                    ? 'เก็บสินค้าในตะกร้าเดิมไว้ และเพิ่มจำนวนสินค้าจากบิลนี้เข้าไป'
                    : 'Keeps existing cart items and adds quantities from this order.'}
                </li>
              </ul>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
