import React, { useState, useMemo } from 'react';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Badge } from '../../../components/common/Badge';
import { useLanguage } from '../../../context/LanguageContext';
import { HourlyDataPoint } from '../types';
import { Shift } from '../../../domain/shift';
import { Order } from '../../../domain/order';
import {
  Activity,
  Clock,
  TrendingUp,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  Zap,
  UserCheck,
  Calendar,
  Sparkles,
  Lightbulb,
  AlertCircle,
  HelpCircle,
  BarChart3,
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Legend,
} from 'recharts';
import {
  calculateMonthOverMonthMetrics,
  MonthOverMonthMetrics,
  MonthlyTrendDataPoint,
} from '../utils/momAnalytics';
import { MomInsightsModal } from './MomInsightsModal';

export interface HourlyVelocityChartProps {
  isManager: boolean;
  hourlyData: readonly HourlyDataPoint[];
  currentShift?: Shift | null;
  currency?: string;
  orders?: readonly Order[];
  storeId?: string;
}

export const HourlyVelocityChart: React.FC<HourlyVelocityChartProps> = ({
  isManager,
  hourlyData,
  currentShift,
  currency = 'THB',
  orders = [],
  storeId = 'default',
}) => {
  const { language } = useLanguage();

  // Chart view mode: 'hourly' (today's shift) vs 'mom_trend' (30-day Month-over-Month comparison)
  const [chartViewMode, setChartViewMode] = useState<'hourly' | 'mom_trend'>('hourly');
  const [isMomModalOpen, setIsMomModalOpen] = useState(false);
  const [simulationMode, setSimulationMode] = useState<'actual' | 'growth' | 'decline'>('actual');

  // Metric toggles:
  // For manager: 'sales' | 'orders'
  // For staff: 'orders' | 'units'
  const [activeMetric, setActiveMetric] = useState<'sales' | 'orders' | 'units'>(
    isManager ? 'sales' : 'orders'
  );

  const currencySymbol = currency === 'THB' ? '฿' : '$';

  // Calculate Month-over-Month analytics
  const { metrics: momMetrics, trendData: momTrendData } = useMemo(() => {
    return calculateMonthOverMonthMetrics(orders, storeId, language as any, simulationMode);
  }, [orders, storeId, language, simulationMode]);

  // Prepare chart data array for Recharts (Hourly View)
  const chartData = useMemo(() => {
    return hourlyData.map((d) => ({
      hour: d.hour,
      sales: d.amount,
      orders: d.orders,
      units: d.units,
      fullHour: d.fullHour || d.hour,
      isCurrentHour: d.isCurrentHour,
    }));
  }, [hourlyData]);

  // Find peak hour and peak values
  const peakPoint = useMemo(() => {
    if (chartData.length === 0) return null;
    let maxItem = chartData[0];
    for (const item of chartData) {
      const val =
        activeMetric === 'sales'
          ? item.sales
          : activeMetric === 'units'
          ? item.units
          : item.orders;
      const currentMax =
        activeMetric === 'sales'
          ? maxItem.sales
          : activeMetric === 'units'
          ? maxItem.units
          : maxItem.orders;
      if (val > currentMax) {
        maxItem = item;
      }
    }
    return maxItem;
  }, [chartData, activeMetric]);

  const totalShiftSales = useMemo(() => {
    return chartData.reduce((acc, curr) => acc + curr.sales, 0);
  }, [chartData]);

  const totalShiftOrders = useMemo(() => {
    return chartData.reduce((acc, curr) => acc + curr.orders, 0);
  }, [chartData]);

  const totalShiftUnits = useMemo(() => {
    return chartData.reduce((acc, curr) => acc + curr.units, 0);
  }, [chartData]);

  const activeMetricKey =
    activeMetric === 'sales' ? 'sales' : activeMetric === 'units' ? 'units' : 'orders';

  const activeMetricLabel =
    activeMetric === 'sales'
      ? language === 'th'
        ? 'ยอดขาย'
        : 'Sales Volume'
      : activeMetric === 'units'
      ? language === 'th'
        ? 'จำนวนชิ้นที่ขาย'
        : 'Units Sold'
      : language === 'th'
      ? 'จำนวนบิล'
      : 'Orders Completed';

  // Shift opening time formatting
  const shiftOpenTimeFormatted = useMemo(() => {
    if (!currentShift?.openedAt) return null;
    try {
      const d = new Date(currentShift.openedAt);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return null;
    }
  }, [currentShift]);

  // Custom Recharts Tooltip for Hourly View
  const CustomHourlyTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      return (
        <div className="bg-card/95 backdrop-blur-md px-3.5 py-2.5 rounded-xl border border-border border-crisp shadow-lg text-xs font-sans min-w-[170px] pointer-events-none">
          <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5 mb-2">
            <span className="font-mono font-bold text-text text-[11px] flex items-center gap-1">
              <Clock className="h-3 w-3 text-primary shrink-0" />
              {item.fullHour || item.hour}
            </span>
            {item.isCurrentHour && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                {language === 'th' ? 'ชั่วโมงปัจจุบัน' : 'Now'}
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text/70">{language === 'th' ? 'ยอดขาย:' : 'Sales Volume:'}</span>
              <span className="font-mono font-bold text-primary">
                {currencySymbol}
                {item.sales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text/70">{language === 'th' ? 'จำนวนบิล:' : 'Order Bills:'}</span>
              <span className="font-mono font-semibold text-text">
                {item.orders} {language === 'th' ? 'บิล' : 'bills'}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-text/70">{language === 'th' ? 'จำนวนชิ้น:' : 'Items Sold:'}</span>
              <span className="font-mono font-semibold text-text/80">
                {item.units} {language === 'th' ? 'ชิ้น' : 'units'}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  // Custom Recharts Tooltip for Month-over-Month Trend View
  const CustomMomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload as MonthlyTrendDataPoint;
      const hasCurrent = item.day <= momMetrics.currentDay;
      const variance = item.dailyVariancePercent;
      const isDayGrowth = variance >= 0;

      return (
        <div className="bg-card/95 backdrop-blur-md px-3.5 py-2.5 rounded-xl border border-border border-crisp shadow-lg text-xs font-sans min-w-[210px] pointer-events-none">
          <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-1.5 mb-2">
            <span className="font-mono font-bold text-text text-[11px] flex items-center gap-1">
              <Calendar className="h-3 w-3 text-primary shrink-0" />
              {item.dayLabel}
            </span>
            {hasCurrent && (
              <span
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                  isDayGrowth
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
                }`}
              >
                {isDayGrowth ? (
                  <ArrowUp className="h-2.5 w-2.5 stroke-[2.5]" />
                ) : (
                  <ArrowDown className="h-2.5 w-2.5 stroke-[2.5]" />
                )}
                <span>{variance > 0 ? '+' : ''}{variance}%</span>
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text/70 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span>{language === 'th' ? 'เดือนปัจจุบัน:' : 'Current Month:'}</span>
              </span>
              <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                {hasCurrent
                  ? `${currencySymbol}${item.currentMonthSales.toLocaleString()}`
                  : language === 'th' ? 'กำลังจะถึง' : 'Upcoming'}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="text-text/70 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-500" />
                <span>{language === 'th' ? 'เดือนก่อนหน้า:' : 'Prior Month:'}</span>
              </span>
              <span className="font-mono font-medium text-purple-600 dark:text-purple-400">
                {currencySymbol}{item.priorMonthSales.toLocaleString()}
              </span>
            </div>

            {hasCurrent && (
              <div className="pt-1 mt-1 border-t border-border/40 flex items-center justify-between text-[11px]">
                <span className="text-text/60">{language === 'th' ? 'ส่วนต่างรายวัน:' : 'Daily Delta:'}</span>
                <span className={`font-mono font-bold ${isDayGrowth ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {item.currentMonthSales - item.priorMonthSales >= 0 ? '+' : ''}
                  {currencySymbol}{(item.currentMonthSales - item.priorMonthSales).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  const isGrowth = momMetrics.isGrowth;
  const momVarianceLabel = momMetrics.hasComparablePriorPeriod
    ? `${momMetrics.variancePercentage > 0 ? '+' : ''}${momMetrics.variancePercentage}%`
    : 'N/A';

  return (
    <>
      <Card id="dashboard-hourly-velocity-card" className="w-full shadow-2xs">
        <CardHeader>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 w-full">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm sm:text-base font-bold text-text flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  <span>
                    {chartViewMode === 'mom_trend'
                      ? language === 'th'
                        ? 'แนวโน้มยอดขายเปรียบเทียบเดือนต่อเดือน (MoM Trend)'
                        : 'Month-over-Month Sales Velocity & Trend'
                      : isManager
                      ? language === 'th'
                        ? 'ปริมาณยอดขายรายชั่วโมง (กะปัจจุบัน)'
                        : 'Current Shift Hourly Sales Volume'
                      : language === 'th'
                      ? 'ความเร็วรอบการขายรายชั่วโมง (กะปัจจุบัน)'
                      : 'Current Shift Hourly Sales Velocity'}
                  </span>
                </h3>

                {/* Status Indicator */}
                {chartViewMode === 'hourly' && currentShift && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span>
                      {currentShift.registerId || 'REG-01'} ·{' '}
                      {currentShift.status === 'open'
                        ? language === 'th' ? 'กะกำลังเปิด' : 'Active Shift'
                        : language === 'th' ? 'ปิดกะแล้ว' : 'Shift Closed'}
                    </span>
                  </span>
                )}

                {/* PROMINENT MONTH-OVER-MONTH (MoM) VARIANCE INDICATOR */}
                {isManager && (
                  <button
                    type="button"
                    id="chart-mom-variance-badge"
                    onClick={() => setIsMomModalOpen(true)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs font-bold border transition-all cursor-pointer shadow-xs active:scale-95 group ${
                      isGrowth
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20 hover:border-emerald-500/50'
                        : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30 hover:bg-rose-500/20 hover:border-rose-500/50'
                    }`}
                    title={
                      language === 'th'
                        ? 'คลิกเพื่อดูบทวิเคราะห์ MoM และข้อเสนอแนะเชิงปฏิบัติการสำหรับผู้จัดการร้าน'
                        : 'Click to view MoM variance analysis and actionable manager recommendations'
                    }
                  >
                    <span
                      className={`flex items-center justify-center w-4 h-4 rounded-full ${
                        isGrowth
                          ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                          : 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {isGrowth ? (
                        <ArrowUp className="h-2.5 w-2.5 stroke-[3]" />
                      ) : (
                        <ArrowDown className="h-2.5 w-2.5 stroke-[3]" />
                      )}
                    </span>
                    <span className="font-mono font-black">{momVarianceLabel}</span>
                    <span className="text-[10px] font-semibold opacity-80 uppercase tracking-tight">
                      MoM {isGrowth ? (language === 'th' ? 'เติบโต' : 'Growth') : (language === 'th' ? 'ชะลอตัว' : 'Decline')}
                    </span>
                    <Lightbulb className="h-3 w-3 opacity-60 group-hover:opacity-100 text-amber-500 transition-opacity" />
                  </button>
                )}
              </div>

              <p className="text-xs text-text/70 mt-0.5 flex items-center gap-2 flex-wrap">
                <span>
                  {chartViewMode === 'mom_trend'
                    ? language === 'th'
                      ? `เปรียบเทียบยอดขายรายวันสะสมระหว่าง ${momMetrics.currentMonthName} กับ ${momMetrics.priorMonthName}`
                      : `Comparing cumulative daily velocity between ${momMetrics.currentMonthName} and ${momMetrics.priorMonthName}`
                    : isManager
                    ? language === 'th'
                      ? 'กราฟวิเคราะห์แนวโน้มยอดขายและปริมาณคำสั่งซื้อประจำชั่วโมงของกะทำงานปัจจุบัน'
                      : 'Interactive hourly sales and ticket volume tracking for the active shift'
                    : language === 'th'
                    ? 'สถิติจำนวนคำสั่งซื้อและจำนวนชิ้นสินค้าที่แคชเชียร์สแกนขายในแต่ละชั่วโมง'
                    : 'Order dispatch volume and item checkout velocity throughout the shift'}
                </span>
                {chartViewMode === 'hourly' && shiftOpenTimeFormatted && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono text-text/60">
                    <UserCheck className="h-3 w-3 text-primary/70" />
                    <span>
                      {currentShift?.cashierName || 'Cashier'} · {language === 'th' ? 'เปิดเมื่อ' : 'Opened'} {shiftOpenTimeFormatted}
                    </span>
                  </span>
                )}
              </p>
            </div>

            {/* Controls Bar: View Switcher (Hourly vs MoM) + Metric Toggle */}
            <div className="flex items-center gap-2 flex-wrap shrink-0 self-start lg:self-auto">
              {/* Store Manager View Switcher */}
              {isManager && (
                <div className="flex items-center gap-1 p-1 bg-background rounded-lg border border-border shrink-0">
                  <button
                    type="button"
                    id="chart-view-hourly"
                    onClick={() => setChartViewMode('hourly')}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                      chartViewMode === 'hourly'
                        ? 'bg-card text-primary shadow-2xs border border-border/50'
                        : 'text-text/70 hover:text-text'
                    }`}
                  >
                    <Clock className="h-3 w-3" />
                    <span>{language === 'th' ? 'รายชั่วโมง' : 'Hourly'}</span>
                  </button>

                  <button
                    type="button"
                    id="chart-view-mom"
                    onClick={() => setChartViewMode('mom_trend')}
                    className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer flex items-center gap-1 ${
                      chartViewMode === 'mom_trend'
                        ? 'bg-card text-primary shadow-2xs border border-border/50'
                        : 'text-text/70 hover:text-text'
                    }`}
                  >
                    <Calendar className="h-3 w-3" />
                    <span>{language === 'th' ? 'เทียบรายเดือน (MoM)' : 'MoM Trend'}</span>
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isGrowth ? 'bg-emerald-500' : 'bg-rose-500'
                      }`}
                    />
                  </button>
                </div>
              )}

              {/* Metric Toggle Buttons (When in Hourly View) */}
              {chartViewMode === 'hourly' && (
                <div className="flex items-center gap-1 p-1 bg-background rounded-lg border border-border shrink-0">
                  {isManager ? (
                    <>
                      <button
                        type="button"
                        id="chart-toggle-sales"
                        onClick={() => setActiveMetric('sales')}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          activeMetric === 'sales'
                            ? 'bg-card text-primary shadow-2xs border border-border/50'
                            : 'text-text/70 hover:text-text'
                        }`}
                      >
                        {language === 'th' ? `ยอดขาย (${currencySymbol})` : `Sales (${currencySymbol})`}
                      </button>
                      <button
                        type="button"
                        id="chart-toggle-orders"
                        onClick={() => setActiveMetric('orders')}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          activeMetric === 'orders'
                            ? 'bg-card text-primary shadow-2xs border border-border/50'
                            : 'text-text/70 hover:text-text'
                        }`}
                      >
                        {language === 'th' ? 'จำนวนบิล' : 'Orders'}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        id="chart-toggle-orders-staff"
                        onClick={() => setActiveMetric('orders')}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          activeMetric === 'orders'
                            ? 'bg-card text-primary shadow-2xs border border-border/50'
                            : 'text-text/70 hover:text-text'
                        }`}
                      >
                        {language === 'th' ? 'จำนวนบิล' : 'Orders'}
                      </button>
                      <button
                        type="button"
                        id="chart-toggle-units-staff"
                        onClick={() => setActiveMetric('units')}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          activeMetric === 'units'
                            ? 'bg-card text-primary shadow-2xs border border-border/50'
                            : 'text-text/70 hover:text-text'
                        }`}
                      >
                        {language === 'th' ? 'จำนวนชิ้น' : 'Units'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </CardHeader>

        <CardBody className="p-4 sm:p-6">
          {/* MOM COMPARISON BANNER: Displayed in MoM Trend View */}
          {chartViewMode === 'mom_trend' && (
            <div className="mb-4 p-3 rounded-xl bg-background border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-blue-500 rounded-full" />
                  <span className="font-semibold text-text">
                    {momMetrics.currentMonthName} (MTD):
                  </span>
                  <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                    {currencySymbol}{momMetrics.currentMonthSales.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="w-3 h-0.5 border-b-2 border-dashed border-purple-500" />
                  <span className="font-medium text-text/70">
                    {momMetrics.priorMonthName}:
                  </span>
                  <span className="font-mono font-semibold text-purple-600 dark:text-purple-400">
                    {currencySymbol}{momMetrics.priorMonthSales.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </span>
                </div>

                {/* Variance callout */}
                <div className="flex items-center gap-1.5 pl-2 border-l border-border/80">
                  {momMetrics.hasComparablePriorPeriod ? (
                    <span
                      className={`inline-flex items-center gap-1 font-mono font-bold ${
                        isGrowth ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {isGrowth ? (
                        <ArrowUp className="h-3.5 w-3.5 stroke-[2.5]" />
                      ) : (
                        <ArrowDown className="h-3.5 w-3.5 stroke-[2.5]" />
                      )}
                      <span>{momVarianceLabel} MoM</span>
                    </span>
                  ) : (
                    <span className="text-text/60">{language === 'th' ? 'ข้อมูลเปรียบเทียบไม่เพียงพอ' : 'Insufficient comparison data'}</span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsMomModalOpen(true)}
                className="text-primary font-bold hover:underline flex items-center gap-1 cursor-pointer shrink-0 self-start sm:self-auto"
              >
                <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
                <span>{language === 'th' ? 'ดูคำแนะนำเชิงปฏิบัติการ' : 'View Manager Playbook'}</span>
              </button>
            </div>
          )}

          {/* Show an explicit empty state instead of a zero-line chart when no verified data exists. */}
          {chartViewMode === 'hourly' && totalShiftOrders === 0 ? (
            <div role="status" className="h-[260px] flex items-center justify-center rounded-xl border border-dashed border-border bg-background px-6 text-center text-sm text-text/60">
              {language === 'th'
                ? 'ยังไม่มีรายการขายที่ยืนยันแล้วในกะนี้ จึงยังไม่สามารถแสดงแนวโน้มรายชั่วโมงได้'
                : 'No server-confirmed orders exist for this shift yet, so hourly trends are unavailable.'}
            </div>
          ) : chartViewMode === 'mom_trend' && !momMetrics.hasComparablePriorPeriod ? (
            <div role="status" className="h-[260px] flex items-center justify-center rounded-xl border border-dashed border-border bg-background px-6 text-center text-sm text-text/60">
              {language === 'th'
                ? 'ยังไม่มีข้อมูลยอดขายที่ยืนยันแล้วของเดือนก่อนเพียงพอสำหรับเปรียบเทียบ'
                : 'There is not enough server-confirmed prior-month sales data for comparison.'}
            </div>
          ) : (
          <div id="recharts-shift-line-chart-wrapper" className="w-full h-[260px] select-none">
            <ResponsiveContainer width="100%" height="100%">
              {chartViewMode === 'hourly' ? (
                /* --- Hourly Shift View --- */
                <LineChart
                  data={chartData}
                  margin={{ top: 15, right: 20, left: -5, bottom: 5 }}
                >
                  <defs>
                    <linearGradient id="chartLineGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary-color)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="var(--primary-color)" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="currentColor"
                    className="text-border/60"
                    vertical={false}
                  />

                  <XAxis
                    dataKey="hour"
                    stroke="currentColor"
                    className="text-text/60"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'currentColor', opacity: 0.2 }}
                    dy={6}
                  />

                  <YAxis
                    stroke="currentColor"
                    className="text-text/60"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val: number) => {
                      if (activeMetric === 'sales') {
                        return val >= 1000 ? `${(val / 1000).toFixed(1)}k` : `${val}`;
                      }
                      return `${val}`;
                    }}
                    dx={-2}
                  />

                  <Tooltip content={<CustomHourlyTooltip />} />

                  {/* Optional peak indicator reference line */}
                  {peakPoint && (activeMetric === 'sales' ? peakPoint.sales > 0 : peakPoint.orders > 0) && (
                    <ReferenceLine
                      y={
                        activeMetric === 'sales'
                          ? peakPoint.sales
                          : activeMetric === 'units'
                          ? peakPoint.units
                          : peakPoint.orders
                      }
                      stroke="var(--success)"
                      strokeDasharray="4 4"
                      strokeOpacity={0.4}
                    />
                  )}

                  <Line
                    type="monotone"
                    dataKey={activeMetricKey}
                    name={activeMetricLabel}
                    stroke="var(--primary-color)"
                    strokeWidth={2.5}
                    dot={{
                      r: 4,
                      fill: 'var(--card-color)',
                      stroke: 'var(--primary-color)',
                      strokeWidth: 2,
                    }}
                    activeDot={{
                      r: 6,
                      fill: 'var(--primary-color)',
                      stroke: 'var(--text-color)',
                      strokeWidth: 2,
                    }}
                    animationDuration={600}
                    isAnimationActive={true}
                  />
                </LineChart>
              ) : (
                /* --- Month-over-Month (MoM) Trend Comparison View --- */
                <LineChart
                  data={momTrendData as any}
                  margin={{ top: 15, right: 20, left: -5, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="currentColor"
                    className="text-border/60"
                    vertical={false}
                  />

                  <XAxis
                    dataKey="day"
                    stroke="currentColor"
                    className="text-text/60"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={{ stroke: 'currentColor', opacity: 0.2 }}
                    tickFormatter={(day) => `${day}`}
                    dy={6}
                  />

                  <YAxis
                    stroke="currentColor"
                    className="text-text/60"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(val: number) => (val >= 1000 ? `${(val / 1000).toFixed(0)}k` : `${val}`)}
                    dx={-2}
                  />

                  <Tooltip content={<CustomMomTooltip />} />

                  {/* Prior Month Line (Dashed) */}
                  <Line
                    type="monotone"
                    dataKey="priorMonthSales"
                    name={momMetrics.priorMonthName}
                    stroke="var(--chart-purple)"
                    strokeWidth={2}
                    strokeDasharray="4 4"
                    dot={false}
                    activeDot={{ r: 5, fill: 'var(--chart-purple)' }}
                    animationDuration={600}
                  />

                  {/* Current Month Line (Solid Primary Blue) */}
                  <Line
                    type="monotone"
                    dataKey="currentMonthSales"
                    name={momMetrics.currentMonthName}
                    stroke="var(--primary-color)"
                    strokeWidth={2.5}
                    dot={{
                      r: 3.5,
                      fill: 'var(--card-color)',
                      stroke: 'var(--primary-color)',
                      strokeWidth: 2,
                    }}
                    activeDot={{
                      r: 6,
                      fill: 'var(--primary-color)',
                      stroke: 'var(--text-color)',
                      strokeWidth: 2,
                    }}
                    animationDuration={600}
                  />
                </LineChart>
              )}
            </ResponsiveContainer>
          </div>
          )}

          {/* Summary Footer & Actionable Indicators */}
          <div className="mt-4 pt-3 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-text/70">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
              <span className="font-medium">
                {chartViewMode === 'mom_trend' && momMetrics.hasComparablePriorPeriod ? (
                  <span>
                    <span className="text-text font-bold">
                      {language === 'th' ? 'สถานะความเร็ว MoM:' : 'MoM Velocity Pace:'}{' '}
                    </span>
                    <span
                      className={`font-mono font-bold ${
                        isGrowth ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {momVarianceLabel} {isGrowth ? (language === 'th' ? 'โตขึ้น' : 'Ahead') : (language === 'th' ? 'ชะลอลง' : 'Behind')}
                    </span>
                    <span className="text-text/60">
                      {' '}· {language === 'th' ? 'ความต่างสุทธิ' : 'Net Diff'} {momMetrics.varianceAmount >= 0 ? '+' : ''}
                      {currencySymbol}{Math.abs(momMetrics.varianceAmount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                    </span>
                  </span>
                ) : chartViewMode === 'mom_trend' ? (
                  <span>{language === 'th' ? 'ไม่มีข้อมูลเดือนก่อนที่ยืนยันแล้วเพียงพอสำหรับการเปรียบเทียบ' : 'Not enough verified prior-month data for comparison.'}</span>
                ) : peakPoint && (activeMetric === 'sales' ? peakPoint.sales > 0 : peakPoint.orders > 0) ? (
                  <>
                    <span className="text-text font-bold">
                      {language === 'th' ? 'ช่วงเวลาขายดีที่สุดในกะ:' : 'Current Shift Peak:'}{' '}
                    </span>
                    <span className="text-primary font-mono font-bold">
                      {peakPoint.fullHour || peakPoint.hour}
                    </span>
                    <span className="text-text/60">
                      {' '}(
                      {activeMetric === 'sales'
                        ? `${currencySymbol}${peakPoint.sales.toLocaleString()} · ${peakPoint.orders} ${language === 'th' ? 'บิล' : 'bills'}`
                        : `${peakPoint.orders} ${language === 'th' ? 'บิล' : 'bills'} · ${peakPoint.units} ${language === 'th' ? 'ชิ้น' : 'units'}`}
                      )
                    </span>
                  </>
                ) : (
                  <span>
                    {language === 'th'
                      ? 'ยังไม่มีรายการขายที่ยืนยันแล้วในกะปัจจุบัน'
                      : 'No server-confirmed orders in the current shift'}
                  </span>
                )}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* MoM Variance Indicator Badge */}
              {isManager && momMetrics.hasComparablePriorPeriod && (
                <button
                  type="button"
                  onClick={() => setIsMomModalOpen(true)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border transition-colors cursor-pointer ${
                    isGrowth
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20'
                      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30 hover:bg-rose-500/20'
                  }`}
                  title={language === 'th' ? 'คลิกดูข้อเสนอแนะเชิงปฏิบัติการ' : 'Click to view manager playbook'}
                >
                  {isGrowth ? (
                    <ArrowUp className="h-3 w-3 stroke-[2.5]" />
                  ) : (
                    <ArrowDown className="h-3 w-3 stroke-[2.5]" />
                  )}
                  <span>MoM: {momVarianceLabel}</span>
                </button>
              )}

              <Badge variant="neutral" size="sm" className="font-mono text-[11px]">
                {chartViewMode === 'mom_trend'
                  ? (language === 'th' ? 'บันทึกแล้ว:' : 'Tracked:')
                  : (language === 'th' ? 'ยอดรวมในกะ:' : 'Shift Total:')}{' '}
                <strong className="text-text font-bold">
                  {chartViewMode === 'mom_trend'
                    ? `${momMetrics.currentDay} ${language === 'th' ? 'วัน' : 'days'}`
                    : `${currencySymbol}${totalShiftSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                </strong>
                {chartViewMode === 'hourly' && ` (${totalShiftOrders} ${language === 'th' ? 'บิล' : 'bills'})`}
              </Badge>

              <Badge variant="neutral" size="sm" className="font-mono text-[11px]">
                {chartViewMode === 'mom_trend'
                  ? (language === 'th' ? 'รอบ 30 วัน' : '30-Day Window')
                  : `${hourlyData.length} ${language === 'th' ? 'ช่วงเวลา' : 'Hours Logged'}`}
              </Badge>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Actionable Manager Insights Modal */}
      {isMomModalOpen && (
        <MomInsightsModal
          isOpen={isMomModalOpen}
          onClose={() => setIsMomModalOpen(false)}
          metrics={momMetrics}
          currencySymbol={currencySymbol}
          onSwitchToMomView={() => setChartViewMode('mom_trend')}
          onSimulate={(mode) => setSimulationMode(mode)}
          simulationMode={simulationMode}
        />
      )}
    </>
  );
};

