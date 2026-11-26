import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { createOrderReadApi } from '../../adapters/orderReadApiFactory';
import { Order } from '../../domain/order';
import { formatMoney } from '../../domain/money';
import { playScannerSound } from '../../services/soundService';
import { triggerHaptic } from '../../services/hapticService';
import {
  ChefHat,
  Clock,
  CheckCircle2,
  AlertCircle,
  Volume2,
  VolumeX,
  Filter,
  RefreshCw,
  Utensils,
  Layers,
  Sparkles,
  Check,
  Flame,
  CheckCheck,
  Search,
  Timer
} from 'lucide-react';

export type KdsItemStatus = 'pending' | 'preparing' | 'ready' | 'served';

interface OrderKdsState {
  orderId: string;
  status: KdsItemStatus;
  startedAt?: string;
  completedAt?: string;
  itemStatuses: Record<string, KdsItemStatus>;
}

export const KitchenDisplayScreen: React.FC = () => {
  const { session } = useAuth();
  const { language } = useLanguage();
  const orderReadApi = useMemo(() => (session ? createOrderReadApi(session.token) : null), [session]);

  const [orders, setOrders] = useState<readonly Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [filterTab, setFilterTab] = useState<'active' | 'preparing' | 'ready' | 'all'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [now, setNow] = useState(Date.now());

  // Local storage for ticket prep state overrides
  const [kdsStates, setKdsStates] = useState<Record<string, OrderKdsState>>(() => {
    const saved = localStorage.getItem('prodx_kds_order_states');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return {};
  });

  // Update clock every second for live ticket timers
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Save KDS states
  useEffect(() => {
    localStorage.setItem('prodx_kds_order_states', JSON.stringify(kdsStates));
  }, [kdsStates]);

  // Load orders
  const loadOrders = async () => {
    if (!orderReadApi) return;
    setIsLoading(true);
    try {
      const fetched = await orderReadApi.getOrders(session!.currentStore.id, 100);
      setOrders(fetched);
    } catch (err) {
      console.error('[KDS] Failed to load kitchen tickets:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
    const interval = setInterval(loadOrders, 10000); // Polling every 10s
    return () => clearInterval(interval);
  }, [orderReadApi]);

  // Listen for live completed orders broadcast
  useEffect(() => {
    const handleNewOrder = (e: Event) => {
      const customEvt = e as CustomEvent<Order>;
      if (customEvt.detail) {
        if (!isMuted) {
          playScannerSound('payment_success');
        }
        loadOrders();
      }
    };
    window.addEventListener('prodx:order-completed', handleNewOrder);
    return () => window.removeEventListener('prodx:order-completed', handleNewOrder);
  }, [isMuted]);

  // Filter orders for kitchen ticket queue (non-voided)
  const activeTickets = useMemo(() => {
    return orders.filter((o) => {
      if (o.status === 'voided') return false;
      const state = kdsStates[o.id];
      const isServed = state?.status === 'served';

      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        o.orderNumber.toLowerCase().includes(q) ||
        (o.customer?.name || '').toLowerCase().includes(q) ||
        o.items.some((i) => i.product.name.toLowerCase().includes(q));

      if (!matchesSearch) return false;

      if (filterTab === 'active') return !isServed;
      if (filterTab === 'preparing') return state?.status === 'preparing';
      if (filterTab === 'ready') return state?.status === 'ready';
      return true;
    });
  }, [orders, kdsStates, filterTab, searchQuery]);

  const handleUpdateOrderStatus = (orderId: string, nextStatus: KdsItemStatus) => {
    triggerHaptic('medium');
    playScannerSound('click');
    setKdsStates((prev) => {
      const current = prev[orderId] || { orderId, status: 'pending', itemStatuses: {} };
      return {
        ...prev,
        [orderId]: {
          ...current,
          status: nextStatus,
          startedAt: nextStatus === 'preparing' && !current.startedAt ? new Date().toISOString() : current.startedAt,
          completedAt: nextStatus === 'ready' || nextStatus === 'served' ? new Date().toISOString() : current.completedAt,
        },
      };
    });
  };

  const handleUpdateItemStatus = (orderId: string, lineId: string, nextStatus: KdsItemStatus) => {
    triggerHaptic('tap');
    playScannerSound('click');
    setKdsStates((prev) => {
      const current = prev[orderId] || { orderId, status: 'pending', itemStatuses: {} };
      return {
        ...prev,
        [orderId]: {
          ...current,
          itemStatuses: {
            ...current.itemStatuses,
            [lineId]: nextStatus,
          },
        },
      };
    });
  };

  const formatElapsed = (createdIso: string) => {
    const elapsedMs = Math.max(0, now - new Date(createdIso).getTime());
    const totalSec = Math.floor(elapsedMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getUrgencyColor = (createdIso: string) => {
    const elapsedMins = (now - new Date(createdIso).getTime()) / 60000;
    if (elapsedMins >= 15) return 'bg-rose-500/10 border-rose-500/40 text-rose-600 dark:text-rose-400';
    if (elapsedMins >= 8) return 'bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400';
    return 'bg-emerald-500/10 border-emerald-500/40 text-emerald-600 dark:text-emerald-400';
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 bg-background text-text no-scrollbar">
      {/* KDS Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/50">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              <ChefHat className="h-3.5 w-3.5" />
              <span>{language === 'th' ? 'ระบบจอแสดงรายการในครัว (KDS Live)' : 'Kitchen Display System'}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>{language === 'th' ? 'อัปเดตเรียลไทม์' : 'Real-time Ticket Sync'}</span>
            </span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-text mt-1">
            {language === 'th' ? 'จอแสดงออเดอร์ห้องครัว & บาร์' : 'Kitchen & Preparation Orders'}
          </h1>
          <p className="text-xs text-text/60 mt-0.5">
            {language === 'th'
              ? 'จัดการสถานะการปรุงอาหาร ติดตามเวลารอ และแจ้งเตือนเสิร์ฟหน้าร้าน'
              : 'Track order preparation tickets, cooking timer velocity, and dispatch alerts.'}
          </p>
        </div>

        {/* Action Toolbar */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsMuted(!isMuted)}
            className={`min-h-[42px] px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs ${
              isMuted
                ? 'bg-card border-border text-brand-text-secondary hover:text-text'
                : 'bg-primary/10 border-primary/30 text-primary'
            }`}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            <span className="hidden sm:inline">
              {isMuted ? (language === 'th' ? 'ปิดเสียง' : 'Muted') : (language === 'th' ? 'เปิดเสียงเตือน' : 'Audio Alert')}
            </span>
          </button>

          <button
            type="button"
            onClick={loadOrders}
            className="min-h-[42px] px-3.5 rounded-xl border border-border bg-card hover:bg-background text-text text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin text-primary' : 'text-text/60'}`} />
            <span className="hidden sm:inline">{language === 'th' ? 'รีเฟรช' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs & Search Row */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Status Segmented Buttons */}
        <div className="flex items-center gap-1.5 p-1 bg-card rounded-xl border border-border overflow-x-auto no-scrollbar">
          {[
            { id: 'active', label: language === 'th' ? 'ออเดอร์ในครัว' : 'Active Kitchen', count: activeTickets.length },
            { id: 'preparing', label: language === 'th' ? 'กำลังปรุง' : 'Cooking', count: orders.filter((o) => kdsStates[o.id]?.status === 'preparing').length },
            { id: 'ready', label: language === 'th' ? 'พร้อมเสิร์ฟ' : 'Ready', count: orders.filter((o) => kdsStates[o.id]?.status === 'ready').length },
            { id: 'all', label: language === 'th' ? 'ทั้งหมด' : 'All Tickets', count: orders.length },
          ].map((tab) => {
            const isSel = filterTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id as any)}
                className={`py-2 px-3.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all cursor-pointer flex items-center gap-2 ${
                  isSel
                    ? 'bg-primary text-primary-foreground shadow-2xs'
                    : 'text-text/70 hover:text-text hover:bg-background'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono tabular-nums ${
                    isSel ? 'bg-white/20 text-white' : 'bg-background border border-border text-text/60'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Ticket Search */}
        <div className="relative w-full md:w-64">
          <Search className="h-4 w-4 text-brand-text-secondary absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={language === 'th' ? 'ค้นหาเลขบิล หรือเมนู...' : 'Filter ticket or item...'}
            className="w-full h-10 pl-9 pr-3 rounded-xl border border-border bg-card text-xs text-text placeholder-text/40 focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* Kitchen Order Tickets Grid */}
      {isLoading && activeTickets.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-64 rounded-2xl border border-border bg-card p-4 animate-pulse space-y-3">
              <div className="h-6 bg-background rounded w-1/3" />
              <div className="h-4 bg-background rounded w-2/3" />
              <div className="h-32 bg-background rounded w-full" />
            </div>
          ))}
        </div>
      ) : activeTickets.length === 0 ? (
        <div className="p-12 rounded-2xl border border-border bg-card text-center max-w-md mx-auto my-8 space-y-3">
          <div className="h-14 w-14 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto">
            <CheckCheck className="h-8 w-8" />
          </div>
          <h3 className="text-base font-bold text-text">
            {language === 'th' ? 'ไม่มีออเดอร์ค้างในครัว' : 'All Kitchen Tickets Clear!'}
          </h3>
          <p className="text-xs text-text/60">
            {language === 'th'
              ? 'ทุกรายการได้รับการปรุงและเสิร์ฟเรียบร้อยแล้ว ออเดอร์ใหม่จะปรากฏที่นี่อัตโนมัติ'
              : 'No pending orders waiting for kitchen preparation.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4 content-start">
          {activeTickets.map((ticket) => {
            const state = kdsStates[ticket.id] || {
              orderId: ticket.id,
              status: 'pending',
              itemStatuses: {},
            };

            const isPreparing = state.status === 'preparing';
            const isReady = state.status === 'ready';
            const isServed = state.status === 'served';
            const urgencyClass = getUrgencyColor(ticket.createdAt);

            return (
              <div
                key={ticket.id}
                className={`rounded-2xl border bg-card flex flex-col justify-between shadow-2xs transition-all overflow-hidden ${
                  isReady
                    ? 'border-emerald-500/60 ring-2 ring-emerald-500/20'
                    : isPreparing
                    ? 'border-amber-500/60'
                    : 'border-border'
                }`}
              >
                {/* Ticket Top Banner */}
                <div className={`p-3.5 border-b border-border flex items-center justify-between ${urgencyClass}`}>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono tabular-nums font-black text-sm text-text">
                        {ticket.orderNumber}
                      </span>
                      {ticket.customer && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-background border border-border text-text/80 truncate max-w-[120px]">
                          {ticket.customer.name}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-text/60 font-mono tabular-nums mt-0.5">
                      {new Date(ticket.createdAt).toLocaleTimeString()} · {ticket.registerId}
                    </div>
                  </div>

                  {/* Elapsed Timer Counter */}
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-background border border-border font-mono tabular-nums font-bold text-xs shadow-2xs">
                    <Timer className="h-3.5 w-3.5 text-amber-500 animate-spin" />
                    <span>{formatElapsed(ticket.createdAt)}</span>
                  </div>
                </div>

                {/* Ticket Line Items */}
                <div className="p-3.5 space-y-2 flex-1 overflow-y-auto max-h-64 no-scrollbar">
                  {ticket.items.map((item) => {
                    const itemState = state.itemStatuses[item.lineId] || 'pending';
                    const isItemDone = itemState === 'ready' || itemState === 'served';

                    return (
                      <button
                        key={item.lineId}
                        type="button"
                        onClick={() =>
                          handleUpdateItemStatus(
                            ticket.id,
                            item.lineId,
                            isItemDone ? 'pending' : 'ready'
                          )
                        }
                        className={`w-full text-left p-2.5 rounded-xl border text-xs flex items-start justify-between gap-2 transition-all cursor-pointer ${
                          isItemDone
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-brand-text-secondary line-through'
                            : 'bg-background border-border hover:border-primary/40 text-text'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-bold flex items-center gap-1.5">
                            <span className="font-mono tabular-nums font-black text-primary text-sm shrink-0">
                              {item.quantity}x
                            </span>
                            <span className="truncate">{item.product.name}</span>
                          </div>
                          {((item as any).notes || item.product.description) && (
                            <div className="text-[10px] text-rose-500 font-bold mt-0.5 truncate">
                              * {(item as any).notes || item.product.description}
                            </div>
                          )}
                        </div>

                        <div
                          className={`p-1 rounded-md shrink-0 ${
                            isItemDone ? 'bg-emerald-500 text-white' : 'bg-card border border-border text-brand-text-secondary'
                          }`}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Ticket Bottom Actions Bar */}
                <div className="p-3 border-t border-border bg-background/60 flex items-center gap-2">
                  {state.status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => handleUpdateOrderStatus(ticket.id, 'preparing')}
                      className="w-full min-h-[40px] py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs transition-all active:scale-95"
                    >
                      <Flame className="h-4 w-4" />
                      <span>{language === 'th' ? 'เริ่มปรุงอาหาร' : 'Start Prep'}</span>
                    </button>
                  )}

                  {state.status === 'preparing' && (
                    <button
                      type="button"
                      onClick={() => handleUpdateOrderStatus(ticket.id, 'ready')}
                      className="w-full min-h-[40px] py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs transition-all active:scale-95"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      <span>{language === 'th' ? 'ปรุงเสร็จ / พร้อมเสิร์ฟ' : 'Mark Ready'}</span>
                    </button>
                  )}

                  {(state.status === 'ready' || state.status === 'served') && (
                    <button
                      type="button"
                      onClick={() => handleUpdateOrderStatus(ticket.id, 'served')}
                      className="w-full min-h-[40px] py-2 px-3 rounded-xl bg-card border border-border hover:bg-background text-text text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95"
                    >
                      <CheckCheck className="h-4 w-4 text-emerald-500" />
                      <span>{language === 'th' ? 'เสิร์ฟแล้ว (เคลียร์ตั๋ว)' : 'Mark Served (Clear)'}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
