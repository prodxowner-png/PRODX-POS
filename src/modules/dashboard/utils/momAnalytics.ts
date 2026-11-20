import type { Order } from '../../../domain/order';
import { getStoreDateParts } from './storeTime';

export interface ManagerActionableInsight {
  readonly id: string;
  readonly category: 'inventory' | 'staffing' | 'basket' | 'promotions' | 'data_quality';
  readonly categoryLabel: { readonly th: string; readonly en: string };
  readonly title: { readonly th: string; readonly en: string };
  readonly description: { readonly th: string; readonly en: string };
  readonly recommendation: { readonly th: string; readonly en: string };
  readonly impactLevel: 'high' | 'medium';
  readonly type: 'positive' | 'warning' | 'neutral';
}

export interface MonthOverMonthMetrics {
  readonly currentMonthSales: number;
  readonly priorMonthSales: number;
  readonly variancePercentage: number;
  readonly isGrowth: boolean;
  readonly varianceAmount: number;
  readonly currentMonthOrders: number;
  readonly priorMonthOrders: number;
  readonly orderVariancePercentage: number;
  readonly currentMonthAov: number;
  readonly priorMonthAov: number;
  readonly aovVariancePercentage: number;
  readonly currentMonthName: string;
  readonly priorMonthName: string;
  readonly currentDay: number;
  readonly daysInCurrentMonth: number;
  readonly hasCurrentPeriodData: boolean;
  readonly hasComparablePriorPeriod: boolean;
  readonly isSimulation: boolean;
  readonly paceStatus: 'exceeding' | 'on_track' | 'lagging' | 'insufficient_data';
  readonly insights: readonly ManagerActionableInsight[];
}

export interface MonthlyTrendDataPoint {
  readonly day: number;
  readonly dayLabel: string;
  readonly currentMonthSales: number;
  readonly priorMonthSales: number;
  readonly currentCumulative: number;
  readonly priorCumulative: number;
  readonly dailyVariancePercent: number;
  readonly isProjected?: boolean;
}

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_NAMES_TH = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_SHORT_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

type ScenarioMode = 'actual' | 'growth' | 'decline';

const roundToOneDecimal = (value: number): number => Math.round(value * 10) / 10;
const roundToTwoDecimals = (value: number): number => Math.round(value * 100) / 100;

/**
 * Calculates month-over-month metrics exclusively from server-confirmed orders.
 * Scenario modes are explicit projections based on the prior month's verified data;
 * they never add synthetic store baselines or silently alter Actual Data.
 */
export function calculateMonthOverMonthMetrics(
  orders: readonly Order[],
  storeId: string = 'default',
  language: 'th' | 'en' | 'zh' | 'ja' = 'th',
  mode: ScenarioMode = 'actual',
  now: Date = new Date(),
  timeZone: string = 'UTC',
): {
  metrics: MonthOverMonthMetrics;
  trendData: readonly MonthlyTrendDataPoint[];
} {
  const nowParts = getStoreDateParts(now, timeZone);
  const currentYear = nowParts.year;
  const currentMonthIndex = nowParts.month - 1;
  const currentDay = nowParts.day;
  const priorDate = new Date(Date.UTC(currentYear, currentMonthIndex - 1, 1));
  const priorYear = priorDate.getUTCFullYear();
  const priorMonthIndex = priorDate.getUTCMonth();
  const daysInCurrentMonth = new Date(Date.UTC(currentYear, currentMonthIndex + 1, 0)).getUTCDate();
  const daysInPriorMonth = new Date(Date.UTC(priorYear, priorMonthIndex + 1, 0)).getUTCDate();
  const isThai = language === 'th';

  const currentMonthName = isThai
    ? `${MONTH_NAMES_TH[currentMonthIndex]} ${currentYear + 543}`
    : `${MONTH_NAMES_EN[currentMonthIndex]} ${currentYear}`;
  const priorMonthName = isThai
    ? `${MONTH_NAMES_TH[priorMonthIndex]} ${priorYear + 543}`
    : `${MONTH_NAMES_EN[priorMonthIndex]} ${priorYear}`;

  const currentDailyCents = new Map<number, number>();
  const priorDailyCents = new Map<number, number>();
  const currentDailyOrders = new Map<number, number>();
  const priorDailyOrders = new Map<number, number>();

  for (const order of orders) {
    if (order.status !== 'server_confirmed') continue;
    if (storeId !== 'default' && order.storeId !== storeId) continue;

    const orderDate = new Date(order.createdAt);
    if (!Number.isFinite(orderDate.getTime())) continue;

    const orderParts = getStoreDateParts(orderDate, timeZone);
    const year = orderParts.year;
    const month = orderParts.month - 1;
    const day = orderParts.day;
    const cents = Math.max(0, order.totals.grandTotal.amountInCents - (order.refundedAmount?.amountInCents ?? 0));

    if (year === currentYear && month === currentMonthIndex && day <= currentDay) {
      currentDailyCents.set(day, (currentDailyCents.get(day) ?? 0) + cents);
      currentDailyOrders.set(day, (currentDailyOrders.get(day) ?? 0) + 1);
    } else if (year === priorYear && month === priorMonthIndex && day <= currentDay && day <= daysInPriorMonth) {
      priorDailyCents.set(day, (priorDailyCents.get(day) ?? 0) + cents);
      priorDailyOrders.set(day, (priorDailyOrders.get(day) ?? 0) + 1);
    }
  }

  const actualCurrentSales = Array.from(currentDailyCents.values()).reduce((sum, cents) => sum + cents, 0) / 100;
  const priorMonthSales = Array.from(priorDailyCents.values()).reduce((sum, cents) => sum + cents, 0) / 100;
  const actualCurrentOrders = Array.from(currentDailyOrders.values()).reduce((sum, count) => sum + count, 0);
  const priorMonthOrders = Array.from(priorDailyOrders.values()).reduce((sum, count) => sum + count, 0);
  const hasCurrentPeriodData = actualCurrentOrders > 0;
  const hasComparablePriorPeriod = priorMonthSales > 0 && priorMonthOrders > 0;
  const isSimulation = mode !== 'actual' && hasComparablePriorPeriod;
  const scenarioMultiplier = mode === 'growth' ? 1.146 : mode === 'decline' ? 0.938 : 1;

  const trendData: MonthlyTrendDataPoint[] = [];
  let currentMonthSales = 0;
  let priorCumulative = 0;
  let currentCumulative = 0;

  for (let day = 1; day <= currentDay; day += 1) {
    const currentActual = (currentDailyCents.get(day) ?? 0) / 100;
    const priorActual = (priorDailyCents.get(day) ?? 0) / 100;
    const currentValue = isSimulation
      ? roundToTwoDecimals(priorActual * scenarioMultiplier)
      : currentActual;

    currentMonthSales += currentValue;
    priorCumulative += priorActual;
    currentCumulative += currentValue;

    trendData.push({
      day,
      dayLabel: `${isThai ? MONTH_SHORT_TH[currentMonthIndex] : MONTH_SHORT_EN[currentMonthIndex]} ${day}`,
      currentMonthSales: currentValue,
      priorMonthSales: priorActual,
      currentCumulative: roundToTwoDecimals(currentCumulative),
      priorCumulative: roundToTwoDecimals(priorCumulative),
      dailyVariancePercent: priorActual > 0
        ? roundToOneDecimal(((currentValue - priorActual) / priorActual) * 100)
        : 0,
      isProjected: isSimulation,
    });
  }

  currentMonthSales = roundToTwoDecimals(currentMonthSales);
  const currentMonthOrders = isSimulation
    ? Math.round(priorMonthOrders * scenarioMultiplier)
    : actualCurrentOrders;
  const currentMonthAov = currentMonthOrders > 0 ? Math.round(currentMonthSales / currentMonthOrders) : 0;
  const priorMonthAov = priorMonthOrders > 0 ? Math.round(priorMonthSales / priorMonthOrders) : 0;
  const varianceAmount = hasComparablePriorPeriod ? roundToTwoDecimals(currentMonthSales - priorMonthSales) : 0;
  const variancePercentage = hasComparablePriorPeriod
    ? roundToOneDecimal(((currentMonthSales - priorMonthSales) / priorMonthSales) * 100)
    : 0;
  const orderVariancePercentage = priorMonthOrders > 0
    ? roundToOneDecimal(((currentMonthOrders - priorMonthOrders) / priorMonthOrders) * 100)
    : 0;
  const aovVariancePercentage = priorMonthAov > 0
    ? roundToOneDecimal(((currentMonthAov - priorMonthAov) / priorMonthAov) * 100)
    : 0;
  const isGrowth = hasComparablePriorPeriod && variancePercentage >= 0;
  const paceStatus: MonthOverMonthMetrics['paceStatus'] = !hasComparablePriorPeriod
    ? 'insufficient_data'
    : variancePercentage >= 10
      ? 'exceeding'
      : variancePercentage >= 0
        ? 'on_track'
        : 'lagging';

  const insights: ManagerActionableInsight[] = !hasComparablePriorPeriod
    ? [{
        id: 'insufficient-verified-history',
        category: 'data_quality',
        categoryLabel: { th: 'ความพร้อมของข้อมูล', en: 'Data Readiness' },
        title: { th: 'ข้อมูลยังไม่เพียงพอสำหรับเปรียบเทียบ', en: 'Not enough verified history to compare' },
        description: {
          th: `พบออเดอร์ที่ยืนยันแล้วเดือนนี้ ${actualCurrentOrders} รายการ และเดือนก่อน ${priorMonthOrders} รายการในช่วงวันที่เดียวกัน`,
          en: `Found ${actualCurrentOrders} server-confirmed orders this month and ${priorMonthOrders} in the comparable period last month.`,
        },
        recommendation: {
          th: 'รอข้อมูลออเดอร์ที่ยืนยันแล้วของเดือนก่อนให้เพียงพอ ก่อนใช้เปอร์เซ็นต์ MoM ประกอบการตัดสินใจ',
          en: 'Wait for sufficient server-confirmed prior-period orders before using an MoM percentage to make decisions.',
        },
        impactLevel: 'medium',
        type: 'neutral',
      }]
    : isSimulation
      ? [{
          id: 'scenario-simulation-only',
          category: 'data_quality',
          categoryLabel: { th: 'การจำลองสถานการณ์', en: 'Scenario Simulation' },
          title: {
            th: mode === 'growth' ? 'ตัวอย่างสถานการณ์ยอดขายเติบโต' : 'ตัวอย่างสถานการณ์ยอดขายชะลอตัว',
            en: mode === 'growth' ? 'Sales growth scenario' : 'Sales decline scenario',
          },
          description: {
            th: `ตัวเลขปัจจุบันเป็นการจำลองจากยอดขายที่ยืนยันแล้วของเดือนก่อน โดยใช้ตัวคูณ ${scenarioMultiplier}`,
            en: `Current-period figures are simulated from prior-month server-confirmed sales using a ${scenarioMultiplier} multiplier.`,
          },
          recommendation: {
            th: 'ใช้เพื่อทดลองวางแผนเท่านั้น ไม่ใช่ผลประกอบการจริง และไม่ควรใช้แทนรายงานยอดขายจริง',
            en: 'Use this only for scenario planning. It is not actual performance and must not replace verified sales reports.',
          },
          impactLevel: 'medium',
          type: 'neutral',
        }]
      : [{
          id: 'verified-mom-summary',
          category: isGrowth ? 'basket' : 'promotions',
          categoryLabel: {
            th: isGrowth ? 'สรุปผลยอดขาย' : 'จุดที่ควรตรวจสอบ',
            en: isGrowth ? 'Sales Summary' : 'Review Required',
          },
          title: {
            th: `ยอดขายที่ยืนยันแล้ว${isGrowth ? 'สูงกว่า' : 'ต่ำกว่า'}ช่วงเดียวกันเดือนก่อน ${Math.abs(variancePercentage)}%`,
            en: `Verified sales are ${isGrowth ? 'above' : 'below'} the comparable prior period by ${Math.abs(variancePercentage)}%`,
          },
          description: {
            th: `คำนวณจากออเดอร์ที่ server ยืนยันแล้วเท่านั้น: ${actualCurrentOrders} บิลในเดือนนี้ เทียบกับ ${priorMonthOrders} บิลในเดือนก่อน`,
            en: `Calculated only from server-confirmed orders: ${actualCurrentOrders} this month versus ${priorMonthOrders} in the comparable prior period.`,
          },
          recommendation: {
            th: 'ตรวจสอบรายงานสินค้าและช่วงเวลาขายจริงเพิ่มเติม ก่อนปรับแผนสต็อก โปรโมชั่น หรือกำลังคน',
            en: 'Review verified product and time-of-day reports before changing inventory, promotions, or staffing plans.',
          },
          impactLevel: 'medium',
          type: isGrowth ? 'positive' : 'warning',
        }];

  return {
    metrics: {
      currentMonthSales,
      priorMonthSales,
      variancePercentage,
      isGrowth,
      varianceAmount,
      currentMonthOrders,
      priorMonthOrders,
      orderVariancePercentage,
      currentMonthAov,
      priorMonthAov,
      aovVariancePercentage,
      currentMonthName,
      priorMonthName,
      currentDay,
      daysInCurrentMonth,
      hasCurrentPeriodData,
      hasComparablePriorPeriod,
      isSimulation,
      paceStatus,
      insights,
    },
    trendData,
  };
}
