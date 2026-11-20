import React, { useMemo } from 'react';
import { Card, CardBody } from '../../../components/common/Card';
import { Badge } from '../../../components/common/Badge';
import { Skeleton } from '../../../components/common/Skeleton';
import { formatMoney } from '../../../domain/money';
import { Shift } from '../../../domain/shift';
import { Order } from '../../../domain/order';
import { useLanguage } from '../../../context/LanguageContext';
import { DashboardMetrics } from '../types';
import { calculateMonthOverMonthMetrics } from '../utils/momAnalytics';
import {
  TrendingUp,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  Receipt,
  DollarSign,
  AlertTriangle,
  Banknote,
  Boxes,
  QrCode,
  Layers,
} from 'lucide-react';

interface ManagerFinancialKPIsProps {
  metrics: DashboardMetrics;
  currentShift: Shift | null;
  pendingCount: number;
  isLoading: boolean;
  orders?: readonly Order[];
  storeId?: string;
  timeZone?: string;
}

export const ManagerFinancialKPIs: React.FC<ManagerFinancialKPIsProps> = ({
  metrics,
  currentShift,
  pendingCount,
  isLoading,
  orders = [],
  storeId = 'default',
  timeZone = 'UTC',
}) => {
  const { t, language } = useLanguage();

  const { metrics: momMetrics } = useMemo(() => {
    return calculateMonthOverMonthMetrics(orders, storeId, language as any, 'actual', new Date(), timeZone);
  }, [orders, storeId, language, timeZone]);

  return (
    <div id="dashboard-manager-kpi-container" className="space-y-4 sm:space-y-5">
      {/* 1. Primary Financial KPI Grid (4 Columns) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
        {/* Card 1: Selected Period Net Revenue */}
        <Card id="manager-kpi-net-revenue" className="hover:border-primary/40 transition-all shadow-2xs">
          <CardBody className="p-4 sm:p-5 lg:p-6 flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-text/70 uppercase tracking-wider">
                <span>{language === 'th' ? 'รายได้สุทธิ (ช่วงที่เลือก)' : 'Period Net Revenue'}</span>
                <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                  <DollarSign className="h-4 w-4" />
                </div>
              </div>
              {isLoading ? (
                <Skeleton className="h-9 w-32 mt-2" />
              ) : (
                <div className="mt-2 text-2xl sm:text-3xl font-black font-mono tracking-tight text-text border-b-2 border-primary/5 pb-1 w-fit tabular-nums">
                  {formatMoney(metrics.netSales)}
                </div>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-border text-[11px] text-text/70 font-medium flex items-center justify-between">
              <span
                className={`flex items-center gap-1 font-semibold ${
                  !momMetrics.hasComparablePriorPeriod
                    ? 'text-text/50'
                    : momMetrics.isGrowth
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                }`}
                aria-label={momMetrics.hasComparablePriorPeriod ? 'Verified month-over-month comparison' : 'Insufficient verified prior-period data'}
              >
                {momMetrics.hasComparablePriorPeriod ? (
                  momMetrics.isGrowth
                    ? <ArrowUp className="h-3.5 w-3.5 stroke-[2.5]" />
                    : <ArrowDown className="h-3.5 w-3.5 stroke-[2.5]" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                <span>
                  {momMetrics.hasComparablePriorPeriod
                    ? `${momMetrics.variancePercentage > 0 ? '+' : ''}${momMetrics.variancePercentage}% MoM`
                    : '—'}
                </span>
              </span>
              <span className="truncate">{language === 'th' ? 'เทียบเดือนก่อน' : 'vs prior month'}</span>
            </div>
          </CardBody>
        </Card>

        {/* Card 2: Completed Transactions & AOV */}
        <Card id="manager-kpi-transactions" className="hover:border-border transition-all shadow-2xs">
          <CardBody className="p-4 sm:p-5 lg:p-6 flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-text/70 uppercase tracking-wider">
                <span>{language === 'th' ? 'บิลที่สำเร็จ' : 'Transactions'}</span>
                <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                  <Receipt className="h-4 w-4" />
                </div>
              </div>
              {isLoading ? (
                <Skeleton className="h-9 w-24 mt-2" />
              ) : (
                <div className="mt-2 text-2xl sm:text-3xl font-black font-mono tracking-tight text-text tabular-nums">
                  {metrics.ordersCount}{' '}
                  <span className="text-xs font-sans font-medium text-text/50">
                    {language === 'th' ? 'บิล' : 'bills'}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-border text-[11px] text-text/70 font-medium flex items-center justify-between">
              <span>{t.dashboard.avgBasket}:</span>
              <span className="font-mono font-bold text-text tabular-nums">
                {formatMoney(metrics.avgOrderValue)}
              </span>
            </div>
          </CardBody>
        </Card>

        {/* Card 3: Shift Drawer Cash & Register */}
        <Card id="manager-kpi-cash-drawer" className="hover:border-emerald-500/40 transition-all shadow-2xs">
          <CardBody className="p-4 sm:p-5 lg:p-6 flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-text/70 uppercase tracking-wider">
                <span>{language === 'th' ? 'เงินสดในลิ้นชัก' : 'Shift Drawer Cash'}</span>
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Banknote className="h-4 w-4" />
                </div>
              </div>
              {isLoading ? (
                <Skeleton className="h-9 w-32 mt-2" />
              ) : currentShift ? (
                <div className="mt-2 text-2xl sm:text-3xl font-black font-mono tracking-tight text-text tabular-nums">
                  {formatMoney(currentShift.expectedCashInDrawer)}
                </div>
              ) : (
                <div className="mt-2 text-sm font-bold text-amber-600 dark:text-amber-400">
                  {t.shift.noActiveShift}
                </div>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-border text-[11px] text-text/70 font-medium flex items-center justify-between">
              <span>{language === 'th' ? 'สถานะกะ:' : 'Shift status:'}</span>
              <Badge variant={currentShift ? 'success' : 'warning'} size="sm" dot>
                {currentShift
                  ? `${language === 'th' ? 'เปิดอยู่' : 'Open'} (${currentShift.registerId})`
                  : language === 'th'
                  ? 'ยังไม่เปิด'
                  : 'No Shift'}
              </Badge>
            </div>
          </CardBody>
        </Card>

        {/* Card 4: Inventory & Outbox Alerts */}
        <Card id="manager-kpi-alerts" className="hover:border-amber-500/40 transition-all shadow-2xs">
          <CardBody className="p-4 sm:p-5 lg:p-6 flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-text/70 uppercase tracking-wider">
                <span>{language === 'th' ? 'การแจ้งเตือนระบบ' : 'Operational Alerts'}</span>
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                  <AlertTriangle className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-black font-mono text-text">
                  {metrics.lowStockCount + metrics.outOfStockCount}
                </span>
                <span className="text-xs text-text/70">
                  {language === 'th' ? 'รายการต้องเติมสต็อก' : 'items need restock'}
                </span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border text-[11px] text-text/70 flex items-center justify-between">
              <span>{language === 'th' ? 'รอซิงก์ออฟไลน์:' : 'Offline Outbox:'}</span>
              <Badge variant={pendingCount > 0 ? 'warning' : 'neutral'} size="sm" className="tabular-nums">
                {pendingCount} {t.common.pending}
              </Badge>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* 2. Secondary Financial Breakdown Strip (4 Columns) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5 lg:gap-4">
        {/* Metric A: Total Items Sold */}
        <div className="p-3.5 sm:p-4 rounded-lg border-border border-crisp bg-card shadow-2xs">
          <div className="flex items-center gap-2 text-text/70 text-xs font-medium">
            <Boxes className="h-3.5 w-3.5 text-primary" />
            <span>{language === 'th' ? 'จำนวนชิ้นที่ขาย' : 'Items Sold'}</span>
          </div>
          <div className="mt-1 text-lg sm:text-xl font-mono font-black text-text">
            {metrics.totalItemsSold}{' '}
            <span className="text-[11px] font-sans font-normal text-text/50">
              {language === 'th' ? 'ชิ้น' : 'units'}
            </span>
          </div>
        </div>

        {/* Metric B: Cash Payments */}
        <div className="p-3.5 sm:p-4 rounded-lg border-border border-crisp bg-card shadow-2xs">
          <div className="flex items-center gap-2 text-text/70 text-xs font-medium">
            <Banknote className="h-3.5 w-3.5 text-emerald-500" />
            <span>{language === 'th' ? 'ยอดขายเงินสด' : 'Cash Sales'}</span>
          </div>
          <div className="mt-1 text-lg sm:text-xl font-mono font-black text-text">
            {formatMoney(metrics.cashSales)}
          </div>
        </div>

        {/* Metric C: Digital Payments (Card / QR) */}
        <div className="p-3.5 sm:p-4 rounded-lg border-border border-crisp bg-card shadow-2xs">
          <div className="flex items-center gap-2 text-text/70 text-xs font-medium">
            <QrCode className="h-3.5 w-3.5 text-indigo-500" />
            <span>{language === 'th' ? 'ยอดขายพร้อมเพย์ / บัตร' : 'Digital / QR'}</span>
          </div>
          <div className="mt-1 text-lg sm:text-xl font-mono font-black text-text">
            {formatMoney(metrics.digitalSales)}
          </div>
        </div>

        {/* Metric D: Active Catalog SKU Count */}
        <div className="p-3.5 sm:p-4 rounded-lg border-border border-crisp bg-card shadow-2xs">
          <div className="flex items-center gap-2 text-text/70 text-xs font-medium">
            <Layers className="h-3.5 w-3.5 text-text/50" />
            <span>{language === 'th' ? 'สินค้าในแคตตาล็อก' : 'Catalog Items'}</span>
          </div>
          <div className="mt-1 text-lg sm:text-xl font-mono font-black text-text">
            {metrics.totalInventoryCount}{' '}
            <span className="text-[11px] font-sans font-normal text-text/50">SKUs</span>
          </div>
        </div>
      </div>
    </div>
  );
};
