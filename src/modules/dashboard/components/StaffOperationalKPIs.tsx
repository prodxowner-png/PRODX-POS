import React from 'react';
import { Card, CardBody } from '../../../components/common/Card';
import { Badge } from '../../../components/common/Badge';
import { Skeleton } from '../../../components/common/Skeleton';
import { Shift } from '../../../domain/shift';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { DashboardMetrics } from '../types';
import {
  Receipt,
  Boxes,
  Store,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  ShoppingBag,
  CreditCard,
  PackageCheck,
} from 'lucide-react';

interface StaffOperationalKPIsProps {
  metrics: DashboardMetrics;
  currentShift: Shift | null;
  pendingCount: number;
  isLoading: boolean;
}

export const StaffOperationalKPIs: React.FC<StaffOperationalKPIsProps> = ({
  metrics,
  currentShift,
  pendingCount,
  isLoading,
}) => {
  const { language } = useLanguage();
  const { session } = useAuth();

  return (
    <div id="dashboard-staff-kpi-container" className="space-y-4 sm:space-y-5">
      {/* 1. Primary Operational KPI Grid (4 Columns matching layout integrity) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-5">
        {/* Card 1: Completed Orders / Transactions Processed */}
        <Card id="staff-kpi-orders" className="hover:border-primary/40 transition-all shadow-2xs">
          <CardBody className="p-4 sm:p-5 lg:p-6 flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-text/70 uppercase tracking-wider">
                <span>{language === 'th' ? 'จำนวนบิลที่คิดเงินสำเร็จ' : 'Processed Orders'}</span>
                <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                  <Receipt className="h-4 w-4" />
                </div>
              </div>
              {isLoading ? (
                <Skeleton className="h-9 w-24 mt-2" />
              ) : (
                <div className="mt-2 text-2xl sm:text-3xl font-black font-mono tabular-nums tracking-tight text-text">
                  {metrics.ordersCount}{' '}
                  <span className="text-xs font-sans font-medium text-brand-text-secondary">
                    {language === 'th' ? 'บิลขาย' : 'orders'}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-border text-[11px] text-text/70 font-medium flex items-center justify-between">
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{language === 'th' ? 'บันทึกสำเร็จ 100%' : '100% Completed'}</span>
              </span>
              <span className="truncate">{language === 'th' ? 'รอบเวลาที่เลือก' : 'in selected period'}</span>
            </div>
          </CardBody>
        </Card>

        {/* Card 2: Total Units & Items Movement Velocity */}
        <Card id="staff-kpi-items" className="hover:border-primary/40 transition-all shadow-2xs">
          <CardBody className="p-4 sm:p-5 lg:p-6 flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-text/70 uppercase tracking-wider">
                <span>{language === 'th' ? 'จำนวนชิ้นที่สแกนขาย' : 'Units Sold & Scanned'}</span>
                <div className="p-1.5 rounded-lg bg-brand-surface-selected text-brand-text-accent">
                  <PackageCheck className="h-4 w-4" />
                </div>
              </div>
              {isLoading ? (
                <Skeleton className="h-9 w-24 mt-2" />
              ) : (
                <div className="mt-2 text-2xl sm:text-3xl font-black font-mono tabular-nums tracking-tight text-text">
                  {metrics.totalItemsSold}{' '}
                  <span className="text-xs font-sans font-medium text-brand-text-secondary">
                    {language === 'th' ? 'ชิ้นสินค้า' : 'units'}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-border text-[11px] text-text/70 font-medium flex items-center justify-between">
              <span>{language === 'th' ? 'เฉลี่ยต่อบิล:' : 'Avg. per bill:'}</span>
              <span className="font-mono font-bold text-text">
                {metrics.avgItemsPerOrder}{' '}
                <span className="text-[10px] font-normal text-text/60">
                  {language === 'th' ? 'ชิ้น/บิล' : 'items/bill'}
                </span>
              </span>
            </div>
          </CardBody>
        </Card>

        {/* Card 3: Terminal & Register Readiness */}
        <Card id="staff-kpi-terminal" className="hover:border-emerald-500/40 transition-all shadow-2xs">
          <CardBody className="p-4 sm:p-5 lg:p-6 flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-text/70 uppercase tracking-wider">
                <span>{language === 'th' ? 'เครื่องขาย & ความพร้อมกะ' : 'Register Readiness'}</span>
                <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Store className="h-4 w-4" />
                </div>
              </div>
              {isLoading ? (
                <Skeleton className="h-9 w-32 mt-2" />
              ) : (
                <div className="mt-2 text-xl sm:text-2xl font-black font-mono tracking-tight text-text truncate">
                  {session?.registerId || 'POS-01'}
                </div>
              )}
            </div>
            <div className="mt-3 pt-3 border-t border-border text-[11px] text-text/70 font-medium flex items-center justify-between">
              <span>{language === 'th' ? 'สถานะกะ:' : 'Shift status:'}</span>
              <Badge variant={currentShift ? 'success' : 'warning'} size="sm" dot>
                {currentShift
                  ? language === 'th'
                    ? 'เปิดกะ พร้อมขาย'
                    : 'Open & Ready'
                  : language === 'th'
                  ? 'ยังไม่เปิดกะ'
                  : 'Shift Closed'}
              </Badge>
            </div>
          </CardBody>
        </Card>

        {/* Card 4: Inventory Restock & Outbox Alerts */}
        <Card id="staff-kpi-restock" className="hover:border-amber-500/40 transition-all shadow-2xs">
          <CardBody className="p-4 sm:p-5 lg:p-6 flex flex-col justify-between h-full">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-text/70 uppercase tracking-wider">
                <span>{language === 'th' ? 'การแจ้งเตือนเติมสต็อก' : 'Inventory Operational Alerts'}</span>
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-500">
                  <AlertTriangle className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-black font-mono tabular-nums text-text">
                  {metrics.lowStockCount + metrics.outOfStockCount}
                </span>
                <span className="text-xs text-text/70">
                  {language === 'th' ? 'รายการต้องเติมสต็อก' : 'items need restock'}
                </span>
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-border text-[11px] text-text/70 flex items-center justify-between">
              <span>{language === 'th' ? 'รอซิงก์ออฟไลน์:' : 'Offline Outbox:'}</span>
              <Badge variant={pendingCount > 0 ? 'warning' : 'neutral'} size="sm">
                {pendingCount} {language === 'th' ? 'รายการ' : 'pending'}
              </Badge>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* 2. Secondary Operational Metric Strip (4 Columns maintaining layout integrity) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3.5 lg:gap-4">
        {/* Metric A: Items Scanned */}
        <div className="p-3.5 sm:p-4 rounded-lg border-border border-crisp bg-card shadow-2xs">
          <div className="flex items-center gap-2 text-text/70 text-xs font-medium">
            <Boxes className="h-3.5 w-3.5 text-primary" />
            <span>{language === 'th' ? 'จำนวนชิ้นที่ขาย' : 'Units Sold'}</span>
          </div>
          <div className="mt-1 text-lg sm:text-xl font-mono tabular-nums font-black text-text">
            {metrics.totalItemsSold}{' '}
            <span className="text-[11px] font-sans font-normal text-brand-text-secondary">
              {language === 'th' ? 'ชิ้น' : 'units'}
            </span>
          </div>
        </div>

        {/* Metric B: Average Items Per Order */}
        <div className="p-3.5 sm:p-4 rounded-lg border-border border-crisp bg-card shadow-2xs">
          <div className="flex items-center gap-2 text-text/70 text-xs font-medium">
            <ShoppingBag className="h-3.5 w-3.5 text-emerald-500" />
            <span>{language === 'th' ? 'สินค้าเฉลี่ยต่อบิล' : 'Units / Order'}</span>
          </div>
          <div className="mt-1 text-lg sm:text-xl font-mono tabular-nums font-black text-text">
            {metrics.avgItemsPerOrder}{' '}
            <span className="text-[11px] font-sans font-normal text-brand-text-secondary">
              {language === 'th' ? 'ชิ้น' : 'items'}
            </span>
          </div>
        </div>

        {/* Metric C: Payment Method Distribution Count (Pure Volume Counts, No Financial $) */}
        <div className="p-3.5 sm:p-4 rounded-lg border-border border-crisp bg-card shadow-2xs">
          <div className="flex items-center gap-2 text-text/70 text-xs font-medium">
            <CreditCard className="h-3.5 w-3.5 text-brand-text-accent" />
            <span>{language === 'th' ? 'การรับชำระ (บิล)' : 'Tender Mix (Count)'}</span>
          </div>
          <div className="mt-1 text-sm sm:text-base font-mono font-bold text-text truncate">
            <span>{metrics.cashOrdersCount} {language === 'th' ? 'เงินสด' : 'Cash'}</span>
            <span className="text-text/30 mx-1.5">·</span>
            <span className="text-primary">{metrics.digitalOrdersCount} {language === 'th' ? 'สแกน/บัตร' : 'QR/Card'}</span>
          </div>
        </div>

        {/* Metric D: Active Catalog SKU Count */}
        <div className="p-3.5 sm:p-4 rounded-lg border-border border-crisp bg-card shadow-2xs">
          <div className="flex items-center gap-2 text-text/70 text-xs font-medium">
            <Layers className="h-3.5 w-3.5 text-brand-text-secondary" />
            <span>{language === 'th' ? 'สินค้าในแคตตาล็อก' : 'Active Catalog'}</span>
          </div>
          <div className="mt-1 text-lg sm:text-xl font-mono tabular-nums font-black text-text">
            {metrics.totalInventoryCount}{' '}
            <span className="text-[11px] font-sans font-normal text-brand-text-secondary">SKUs</span>
          </div>
        </div>
      </div>
    </div>
  );
};
