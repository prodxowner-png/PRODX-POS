import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Card, CardHeader } from '../../../components/common/Card';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';
import { formatMoney } from '../../../domain/money';
import { Order } from '../../../domain/order';
import { useLanguage } from '../../../context/LanguageContext';
import { NavRoute } from '../../../components/layout/Sidebar';
import { Receipt, Calendar, ChevronRight, RotateCcw, Package, ChevronDown, ChevronUp } from 'lucide-react';

interface RecentTransactionsSectionProps {
  isManager: boolean;
  orders: readonly Order[];
  onNavigate: (route: NavRoute) => void;
  onResetToday: () => void;
}

export const RecentTransactionsSection: React.FC<RecentTransactionsSectionProps> = ({
  isManager,
  orders,
  onNavigate,
  onResetToday,
}) => {
  const { t, language } = useLanguage();
  const [expandedOrderIds, setExpandedOrderIds] = useState<Record<string, boolean>>({});

  const toggleOrderExpansion = (orderId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setExpandedOrderIds((prev) => ({
      ...prev,
      [orderId]: !prev[orderId],
    }));
  };

  const getItemsCount = (order: Order): number => {
    return order.items.reduce((sum, item) => sum + item.quantity, 0);
  };

  return (
    <Card id="dashboard-recent-orders-card" className="shadow-2xs">
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between w-full gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm sm:text-base font-bold text-text flex items-center gap-2">
                <Receipt className="h-4 w-4 text-primary" />
                <span>
                  {isManager
                    ? t.dashboard.recentOrders
                    : language === 'th'
                    ? 'รายการขายประจำรอบ (Operational Sales Log)'
                    : 'Recent Operational Sales Log'}
                </span>
              </h3>
              <span className="px-2 py-0.5 text-[11px] font-mono font-bold rounded-lg bg-primary/10 text-primary border border-primary/20">
                {orders.length} {language === 'th' ? 'รายการในช่วงที่เลือก' : 'in range'}
              </span>
            </div>
            <p className="text-xs text-text/70 mt-0.5">
              {isManager
                ? language === 'th'
                  ? 'รายการขายที่บันทึกตามช่วงเวลาที่กำหนด พร้อมมูลค่าทางการเงิน'
                  : 'Authoritative transaction sequence for selected date period with financial settlement'
                : language === 'th'
                ? 'บันทึกคำสั่งซื้อและจำนวนสินค้าที่สแกนขายหน้าร้าน (ข้อมูลปฏิบัติการ)'
                : 'Frontline transaction stream with line-item quantities and operational fulfillment'}
            </p>
          </div>
          <Button
            id="dashboard-view-all-orders-btn"
            variant="ghost"
            size="sm"
            onClick={() => onNavigate('orders')}
            rightIcon={<ChevronRight className="h-4 w-4" />}
            className="min-h-[36px] self-start sm:self-auto"
          >
            {t.dashboard.viewAllOrders}
          </Button>
        </div>
      </CardHeader>

      {orders.length === 0 ? (
        <div className="p-8 text-center space-y-3">
          <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary mx-auto flex items-center justify-center border border-primary/20">
            <Calendar className="h-6 w-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-sm font-bold text-text">
              {language === 'th'
                ? 'ไม่พบรายการขายในช่วงเวลาที่เลือก'
                : 'No transactions recorded in this date range'}
            </h4>
            <p className="text-xs text-text/70 max-w-sm mx-auto">
              {language === 'th'
                ? 'ลองปรับเปลี่ยนวันที่เริ่มต้นและสิ้นสุดในตัวเลือกด้านบน หรือคลิกเพื่อรีเซ็ตกลับเป็นข้อมูลวันนี้'
                : 'Try adjusting your start and end dates in the date range picker above, or reset to Today.'}
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onResetToday}
            leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            className="mt-2 min-h-[44px]"
          >
            {language === 'th' ? 'รีเซ็ตเป็นวันนี้' : 'Reset to Today'}
          </Button>
        </div>
      ) : (
        <>
          {/* Mobile & Small Tablet: Responsive Card Grid */}
          <div className="lg:hidden p-3.5 sm:p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            {orders.slice(0, 8).map((order) => {
              const itemsCount = getItemsCount(order);
              return (
                <div
                  key={order.id}
                  className="p-3.5 rounded-lg border-border border-crisp bg-background shadow-2xs space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-xs text-text">
                      {order.orderNumber}
                    </span>
                    {isManager ? (
                      <span className="font-mono font-bold text-sm text-text">
                        {formatMoney(order.totals.grandTotal)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-mono font-bold text-xs px-2 py-0.5 rounded-md bg-primary/10 text-primary">
                        <Package className="h-3 w-3" />
                        <span>
                          {itemsCount} {language === 'th' ? 'ชิ้น' : 'items'}
                        </span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-text/70 pt-1 border-t border-border">
                    <span>{order.customer ? order.customer.name : t.pos.walkIn}</span>
                    <span className="font-mono">
                      {new Date(order.createdAt).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}{' '}
                      {new Date(order.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-border text-[10.5px]">
                    <span className="font-semibold text-text/80">
                      {order.payments[0]?.method === 'cash'
                        ? t.checkout.cash
                        : order.payments[0]?.method === 'card'
                        ? t.checkout.card
                        : t.checkout.promptpay}
                    </span>
                    {order.status === 'server_confirmed' ? (
                      <Badge variant="success" size="sm" dot>
                        {t.orders.completed}
                      </Badge>
                    ) : order.status === 'pending_sync_offline' ? (
                      <Badge variant="offline" size="sm" dot>
                        {language === 'th' ? 'รอซิงก์' : 'Pending'}
                      </Badge>
                    ) : (
                      <Badge variant="neutral" size="sm">
                        {order.status}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Large Tablet & Desktop: Full Authoritative Data Table */}
          <div className="hidden lg:block w-full overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-text/70 bg-card font-medium">
                  <th scope="col" className="py-3.5 px-5">{t.orders.orderNumber}</th>
                  <th scope="col" className="py-3.5 px-4">{t.orders.dateTime}</th>
                  <th scope="col" className="py-3.5 px-4">{t.orders.cashier}</th>
                  <th scope="col" className="py-3.5 px-4">{t.orders.customer}</th>
                  <th scope="col" className="py-3.5 px-4">{t.orders.payment}</th>
                  <th scope="col" className="py-3.5 px-4">{t.orders.status}</th>
                  <th scope="col" className="py-3.5 px-5 text-right tabular-nums">
                    {isManager
                      ? t.orders.total
                      : language === 'th'
                      ? 'จำนวนชิ้นที่ขาย'
                      : 'Items Sold'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.slice(0, 8).map((order) => {
                  const itemsCount = getItemsCount(order);
                  const isExpanded = !!expandedOrderIds[order.id];
                  return (
                    <React.Fragment key={order.id}>
                      <tr
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleOrderExpansion(order.id);
                          }
                        }}
                        onClick={() => toggleOrderExpansion(order.id)}
                        className="hover:bg-primary/5 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cta"
                      >
                        <td className="py-3.5 px-5 font-mono font-bold text-text">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              aria-label={
                                isExpanded
                                  ? language === 'th' ? 'ย่อรายละเอียด' : 'Collapse line items'
                                  : language === 'th' ? 'ขยายดูสินค้าในใบเสร็จ' : 'Expand line items'
                              }
                              onClick={(e) => toggleOrderExpansion(order.id, e)}
                              className={`p-1.5 min-h-[32px] min-w-[32px] inline-flex items-center justify-center rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta ${
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
                        <td className="py-3.5 px-4 text-brand-text-secondary font-mono tabular-nums">
                          {new Date(order.createdAt).toLocaleDateString([], {
                            month: 'short',
                            day: 'numeric',
                          })}{' '}
                          {new Date(order.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-3.5 px-4 text-text">{order.cashierName}</td>
                        <td className="py-3.5 px-4 text-text/70">
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
                              {language === 'th' ? 'รอซิงก์ (ออฟไลน์)' : 'Pending Sync (Offline)'}
                            </Badge>
                          ) : (
                            <Badge variant="neutral" size="sm">
                              {order.status}
                            </Badge>
                          )}
                        </td>
                        <td className="py-3.5 px-5 text-right font-mono tabular-nums font-bold text-text">
                          {isManager ? (
                            formatMoney(order.totals.grandTotal)
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 text-primary">
                              <Package className="h-3 w-3" />
                              <span>
                                {itemsCount} {language === 'th' ? 'ชิ้น' : 'units'}
                              </span>
                            </span>
                          )}
                        </td>
                      </tr>

                      <AnimatePresence initial={false}>
                        {isExpanded && (
                          <tr key={`dash-expanded-${order.id}`} className="bg-primary/5 dark:bg-primary/10 border-b border-border">
                            <td colSpan={7} className="p-0">
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.25, ease: 'easeInOut' }}
                                style={{ overflow: 'hidden' }}
                              >
                                <div className="p-3.5 sm:p-4">
                                  <div className="bg-card rounded-xl border border-border/80 p-3.5 shadow-xs space-y-3">
                                    <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                                      <div className="flex items-center gap-2">
                                        <Receipt className="h-4 w-4 text-primary shrink-0" />
                                        <span className="text-xs font-bold uppercase tracking-wider text-text">
                                          {language === 'th' ? 'รายการสินค้าในใบเสร็จ' : 'Line-Item Breakdown'} ({order.orderNumber})
                                        </span>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onNavigate('orders');
                                        }}
                                        rightIcon={<ChevronRight className="h-3.5 w-3.5" />}
                                        className="text-xs h-7 px-2 font-bold text-primary"
                                      >
                                        {language === 'th' ? 'เปิดในหน้าคำสั่งซื้อ' : 'Full Order Workspace'}
                                      </Button>
                                    </div>

                                    <div className="rounded-lg border border-border overflow-hidden bg-background/50">
                                      <table className="w-full text-left text-xs border-collapse font-mono tabular-nums">
                                        <thead>
                                          <tr className="bg-card/80 text-text/70 border-b border-border text-[11px] font-semibold">
                                            <th scope="col" className="py-2 px-3 font-sans">{language === 'th' ? 'สินค้า' : 'Item'}</th>
                                            <th scope="col" className="py-2 px-2 text-center w-16">{language === 'th' ? 'จำนวน' : 'Qty'}</th>
                                            <th scope="col" className="py-2 px-3 text-right w-24">{language === 'th' ? 'ราคา/หน่วย' : 'Unit'}</th>
                                            <th scope="col" className="py-2 px-3 text-right w-28">{language === 'th' ? 'รวม' : 'Total'}</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/60 text-xs">
                                          {order.items.map((item) => (
                                            <tr key={item.lineId} className="odd:bg-card/50 even:bg-background/20">
                                              <td className="py-2 px-3 font-sans font-medium text-text">
                                                {item.product.name}
                                              </td>
                                              <td className="py-2 px-2 text-center font-bold text-text/80">{item.quantity}</td>
                                              <td className="py-2 px-3 text-right text-text/70">{formatMoney(item.unitPrice)}</td>
                                              <td className="py-2 px-3 text-right font-bold text-text">{formatMoney(item.lineTotal)}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
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
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
};
