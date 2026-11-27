import React, { useState } from 'react';
import { Modal } from '../../../components/common/Modal';
import { Button } from '../../../components/common/Button';
import { Badge } from '../../../components/common/Badge';
import { useLanguage } from '../../../context/LanguageContext';
import { MonthOverMonthMetrics } from '../utils/momAnalytics';
import {
  TrendingUp,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Boxes,
  Users,
  ShoppingBag,
  Sparkles,
  Zap,
  DollarSign,
  Receipt,
  RotateCcw,
} from 'lucide-react';

export interface MomInsightsModalProps {
  isOpen: boolean;
  onClose: () => void;
  metrics: MonthOverMonthMetrics;
  currencySymbol?: string;
  onSwitchToMomView?: () => void;
  onSimulate?: (mode: 'actual' | 'growth' | 'decline') => void;
  simulationMode?: 'actual' | 'growth' | 'decline';
}

export const MomInsightsModal: React.FC<MomInsightsModalProps> = ({
  isOpen,
  onClose,
  metrics,
  currencySymbol = '฿',
  onSwitchToMomView,
  onSimulate,
  simulationMode = 'actual',
}) => {
  const { language } = useLanguage();

  const isGrowth = metrics.isGrowth;
  const varianceFormatted = `${metrics.variancePercentage > 0 ? '+' : ''}${metrics.variancePercentage}%`;

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'inventory':
        return <Boxes className="h-4 w-4 text-amber-500" />;
      case 'staffing':
        return <Users className="h-4 w-4 text-blue-500" />;
      case 'basket':
        return <ShoppingBag className="h-4 w-4 text-brand-text-accent" />;
      case 'promotions':
        return <Sparkles className="h-4 w-4 text-rose-500" />;
      case 'data_quality':
        return <AlertTriangle className="h-4 w-4 text-amber-500" />;
      default:
        return <Lightbulb className="h-4 w-4 text-primary" />;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={language === 'th' ? 'รายงานวิเคราะห์ยอดขายเทียบเดือนก่อน (MoM)' : 'Month-over-Month Performance & Manager Insights'}
      description={
        language === 'th'
          ? `เปรียบเทียบผลการดำเนินงานระหว่าง ${metrics.currentMonthName} กับ ${metrics.priorMonthName}`
          : `Performance variance & operational insights comparing ${metrics.currentMonthName} vs ${metrics.priorMonthName}`
      }
      maxWidth="3xl"
      id="mom-insights-modal"
    >
      <div className="space-y-5">
        {/* 1. Simulation / Scenario Switcher for Store Managers */}
        {onSimulate && (
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-background border border-border flex-wrap gap-2 text-xs">
            <span className="text-text/70 font-medium flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              <span>{language === 'th' ? 'โหมดจำลองสถานการณ์:' : 'Scenario Simulation:'}</span>
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSimulate('actual')}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-colors cursor-pointer ${
                  simulationMode === 'actual'
                    ? 'bg-card text-primary shadow-xs border border-border'
                    : 'text-text/60 hover:text-text'
                }`}
              >
                {language === 'th' ? 'ข้อมูลจริง (Real)' : 'Actual Data'}
              </button>
              <button
                type="button"
                onClick={() => onSimulate('growth')}
                disabled={!metrics.hasComparablePriorPeriod}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-colors cursor-pointer flex items-center gap-1 ${
                  simulationMode === 'growth'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                    : 'text-text/60 hover:text-emerald-600'
                }`}
              >
                <ArrowUp className="h-3 w-3 text-emerald-500" />
                <span>{language === 'th' ? 'จำลองเติบโต (+14.6%)' : 'Simulate Growth'}</span>
              </button>
              <button
                type="button"
                onClick={() => onSimulate('decline')}
                disabled={!metrics.hasComparablePriorPeriod}
                className={`px-2.5 py-1 rounded-lg font-bold text-xs transition-colors cursor-pointer flex items-center gap-1 ${
                  simulationMode === 'decline'
                    ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                    : 'text-text/60 hover:text-rose-600'
                }`}
              >
                <ArrowDown className="h-3 w-3 text-rose-500" />
                <span>{language === 'th' ? 'จำลองชะลอตัว (-6.2%)' : 'Simulate Decline'}</span>
              </button>
            </div>
          </div>
        )}

        {metrics.isSimulation && (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-3 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              {language === 'th'
                ? 'โหมดจำลองสถานการณ์: ตัวเลขนี้ไม่ใช่ผลประกอบการจริง และไม่ควรใช้แทนรายงานยอดขายที่ยืนยันแล้ว'
                : 'Scenario simulation: these figures are not actual performance and must not replace verified sales reports.'}
            </span>
          </div>
        )}

        {!metrics.hasComparablePriorPeriod && (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-border bg-background p-3 text-xs text-text/70">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
            <span>
              {language === 'th'
                ? 'ยังไม่มีข้อมูลยอดขายที่ยืนยันแล้วของเดือนก่อนเพียงพอ จึงไม่แสดงเปอร์เซ็นต์เปรียบเทียบ'
                : 'There is not enough server-confirmed prior-month sales data, so percentage comparisons are unavailable.'}
            </span>
          </div>
        )}

        {/* 2. Primary Hero Variance Callout Card */}
        <div
          className={`p-5 rounded-2xl border transition-all ${
            !metrics.hasComparablePriorPeriod
              ? 'bg-background border-border text-text'
              : isGrowth
                ? 'bg-emerald-500/5 border-emerald-500/30 text-emerald-950 dark:text-emerald-50'
                : 'bg-rose-500/5 border-rose-500/30 text-rose-950 dark:text-rose-50'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                    !metrics.hasComparablePriorPeriod
                      ? 'bg-slate-500/10 text-text/70 border-border'
                      : isGrowth
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                        : 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30'
                  }`}
                >
                  {!metrics.hasComparablePriorPeriod ? (
                    <span>{language === 'th' ? 'ข้อมูลเปรียบเทียบไม่เพียงพอ' : 'Insufficient comparison data'}</span>
                  ) : isGrowth ? (
                    <>
                      <ArrowUp className="h-3.5 w-3.5 stroke-[2.5]" />
                      <span>{language === 'th' ? 'อัตราเติบโตเทียบเดือนก่อน (MoM Growth)' : 'Month-over-Month Growth'}</span>
                    </>
                  ) : (
                    <>
                      <ArrowDown className="h-3.5 w-3.5 stroke-[2.5]" />
                      <span>{language === 'th' ? 'อัตราชะลอตัวเทียบเดือนก่อน (MoM Decline)' : 'Month-over-Month Decline'}</span>
                    </>
                  )}
                </span>
                <span className="text-xs text-text/60 font-mono">
                  {language === 'th' ? `เทียบช่วงวันที่ 1 - ${metrics.currentDay}` : `MTD Day 1 - ${metrics.currentDay}`}
                </span>
              </div>

              <div className="flex items-baseline gap-3 mt-3">
                <span
                  className={`text-4xl sm:text-5xl font-black font-mono tracking-tight ${
                    !metrics.hasComparablePriorPeriod
                      ? 'text-text/60'
                      : isGrowth
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {metrics.hasComparablePriorPeriod ? varianceFormatted : '—'}
                </span>
                <span className="text-sm font-medium text-text/70">
                  {metrics.hasComparablePriorPeriod
                    ? isGrowth
                      ? (language === 'th' ? 'ยอดขายสูงกว่าช่วงเดียวกันเดือนก่อน' : 'higher than same period last month')
                      : (language === 'th' ? 'ยอดขายต่ำกว่าช่วงเดียวกันเดือนก่อน' : 'lower than same period last month')
                    : (language === 'th' ? 'ไม่มีข้อมูลเพียงพอสำหรับคำนวณส่วนต่าง' : 'Not enough data to calculate variance')}
                </span>
              </div>

              {metrics.hasComparablePriorPeriod && (
                <p className="text-xs text-text/70 mt-1">
                  {language === 'th' ? 'ส่วนต่างยอดขายสุทธิ:' : 'Net Volume Variance:'}{' '}
                  <strong className="font-mono text-text">
                    {metrics.varianceAmount >= 0 ? '+' : ''}
                    {currencySymbol}
                    {metrics.varianceAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </strong>
                </p>
              )}
            </div>

            {/* Target & Pace Indicator */}
            <div className="sm:text-right bg-card p-3 rounded-xl border border-border sm:min-w-[170px]">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-text/60 block">
                {language === 'th' ? 'สถานะรอบการขาย' : 'Monthly Pace'}
              </span>
              <span className="text-sm font-bold text-text mt-1 flex items-center sm:justify-end gap-1.5">
                {metrics.paceStatus === 'exceeding' ? (
                  <>
                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                    <span className="text-emerald-600 dark:text-emerald-400">
                      {language === 'th' ? 'เร็วกว่าเป้าหมาย' : 'Exceeding Pace'}
                    </span>
                  </>
                ) : metrics.paceStatus === 'on_track' ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-blue-500" />
                    <span className="text-blue-600 dark:text-blue-400">
                      {language === 'th' ? 'ตามเกณฑ์ปกติ' : 'On Track'}
                    </span>
                  </>
                ) : metrics.paceStatus === 'lagging' ? (
                  <>
                    <TrendingDown className="h-4 w-4 text-rose-500" />
                    <span className="text-rose-600 dark:text-rose-400">
                      {language === 'th' ? 'ต้องตรวจสอบยอดขาย' : 'Below Prior Period'}
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <span className="text-text/60">
                      {language === 'th' ? 'ข้อมูลไม่เพียงพอ' : 'Insufficient Data'}
                    </span>
                  </>
                )}
              </span>
              <span className="text-[11px] font-mono text-text/60 mt-0.5 block">
                {language === 'th'
                  ? `วันที่ ${metrics.currentDay} จาก ${metrics.daysInCurrentMonth} วัน`
                  : `Day ${metrics.currentDay} of ${metrics.daysInCurrentMonth}`}
              </span>
            </div>
          </div>
        </div>

        {/* 3. Detailed KPI Comparison Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Card 1: Total Sales MTD */}
          <div className="p-3.5 rounded-xl bg-card border border-border">
            <div className="flex items-center justify-between text-xs text-text/70 mb-1">
              <span className="font-medium">{language === 'th' ? 'ยอดขายรวม (MTD)' : 'Sales Volume (MTD)'}</span>
              <DollarSign className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="text-lg font-black font-mono text-text">
              {currencySymbol}{metrics.currentMonthSales.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
            </div>
            <div className="text-[11px] text-text/60 mt-1 flex items-center justify-between">
              <span>{language === 'th' ? 'เดือนก่อน:' : 'Prior Month:'}</span>
              <span className="font-mono">
                {metrics.hasComparablePriorPeriod
                  ? `${currencySymbol}${metrics.priorMonthSales.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
                  : '—'}
              </span>
            </div>
          </div>

          {/* Card 2: Total Orders MTD */}
          <div className="p-3.5 rounded-xl bg-card border border-border">
            <div className="flex items-center justify-between text-xs text-text/70 mb-1">
              <span className="font-medium">{language === 'th' ? 'จำนวนบิลรวม' : 'Order Tickets'}</span>
              <Receipt className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="text-lg font-black font-mono text-text flex items-center gap-2">
              <span>{metrics.currentMonthOrders.toLocaleString()}</span>
              {metrics.hasComparablePriorPeriod ? (
                <span
                  className={`text-xs font-bold flex items-center ${
                    metrics.orderVariancePercentage >= 0 ? 'text-emerald-500' : 'text-rose-500'
                  }`}
                >
                  {metrics.orderVariancePercentage >= 0 ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )}
                  {metrics.orderVariancePercentage > 0 ? '+' : ''}{metrics.orderVariancePercentage}%
                </span>
              ) : (
                <span className="text-xs text-brand-text-secondary">—</span>
              )}
            </div>
            <div className="text-[11px] text-text/60 mt-1 flex items-center justify-between">
              <span>{language === 'th' ? 'เดือนก่อน:' : 'Prior Month:'}</span>
              <span className="font-mono">
                {metrics.hasComparablePriorPeriod
                  ? `${metrics.priorMonthOrders.toLocaleString()} ${language === 'th' ? 'บิล' : 'bills'}`
                  : '—'}
              </span>
            </div>
          </div>

          {/* Card 3: Average Order Value (AOV) */}
          <div className="p-3.5 rounded-xl bg-card border border-border">
            <div className="flex items-center justify-between text-xs text-text/70 mb-1">
              <span className="font-medium">{language === 'th' ? 'ยอดซื้อเฉลี่ยต่อบิล' : 'Avg. Ticket (AOV)'}</span>
              <ShoppingBag className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="text-lg font-black font-mono text-text flex items-center gap-2">
              <span>{currencySymbol}{metrics.currentMonthAov}</span>
              {metrics.hasComparablePriorPeriod ? (
                <span
                  className={`text-xs font-bold flex items-center ${
                    metrics.aovVariancePercentage >= 0 ? 'text-emerald-500' : 'text-rose-500'
                  }`}
                >
                  {metrics.aovVariancePercentage >= 0 ? (
                    <ArrowUp className="h-3 w-3" />
                  ) : (
                    <ArrowDown className="h-3 w-3" />
                  )}
                  {metrics.aovVariancePercentage > 0 ? '+' : ''}{metrics.aovVariancePercentage}%
                </span>
              ) : (
                <span className="text-xs text-brand-text-secondary">—</span>
              )}
            </div>
            <div className="text-[11px] text-text/60 mt-1 flex items-center justify-between">
              <span>{language === 'th' ? 'เดือนก่อน:' : 'Prior Month:'}</span>
              <span className="font-mono">
                {metrics.hasComparablePriorPeriod ? `${currencySymbol}${metrics.priorMonthAov}` : '—'}
              </span>
            </div>
          </div>
        </div>

        {/* 4. Actionable Insights for Store Managers */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-text/70 flex items-center gap-1.5">
              <Lightbulb className="h-3.5 w-3.5 text-primary" />
              <span>
                {language === 'th' ? 'ข้อเสนอแนะเชิงปฏิบัติการสำหรับผู้จัดการร้าน' : 'Actionable Manager Playbook & Recommendations'}
              </span>
            </h4>
            <Badge variant="primary" size="sm">
              {metrics.insights.length} {language === 'th' ? 'ประเด็น' : 'Action Items'}
            </Badge>
          </div>

          <div className="space-y-2.5">
            {metrics.insights.map((insight) => (
              <div
                key={insight.id}
                className="p-3.5 rounded-xl bg-card border border-border hover:border-primary/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2.5">
                    <div className="p-1.5 rounded-lg bg-background border border-border shrink-0 mt-0.5">
                      {getCategoryIcon(insight.category)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-text">
                          {language === 'th' ? insight.title.th : insight.title.en}
                        </span>
                        <Badge
                          variant={insight.impactLevel === 'high' ? 'warning' : 'neutral'}
                          size="sm"
                          className="text-[10px]"
                        >
                          {insight.impactLevel === 'high'
                            ? (language === 'th' ? 'ผลกระทบสูง' : 'High Impact')
                            : (language === 'th' ? 'ผลกระทบปานกลาง' : 'Medium Impact')}
                        </Badge>
                      </div>

                      <p className="text-xs text-text/70 mt-1">
                        {language === 'th' ? insight.description.th : insight.description.en}
                      </p>

                      <div className="mt-2.5 p-2 rounded-lg bg-background border border-border/60 text-xs flex items-center gap-2 text-primary font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                        <span>
                          <strong className="text-text font-semibold">
                            {language === 'th' ? 'คำแนะนำ:' : 'Action:'}{' '}
                          </strong>
                          {language === 'th' ? insight.recommendation.th : insight.recommendation.en}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 mt-4 border-t border-border flex-wrap gap-2">
        {onSwitchToMomView && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              onSwitchToMomView();
              onClose();
            }}
            leftIcon={<Calendar className="h-3.5 w-3.5 text-primary" />}
            className="text-xs font-bold"
          >
            {language === 'th' ? 'เปิดดูกราฟเปรียบเทียบ 30 วัน' : 'View 30-Day MoM Trend Chart'}
          </Button>
        )}
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onClose}
          className="text-xs font-bold ml-auto"
        >
          {language === 'th' ? 'รับทราบและปิด' : 'Close Insights'}
        </Button>
      </div>
    </Modal>
  );
};
