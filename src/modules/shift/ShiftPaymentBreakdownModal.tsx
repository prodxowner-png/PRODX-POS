import React from 'react';
import {
  Banknote,
  CreditCard,
  QrCode,
  Printer,
  X,
  PieChart,
  TrendingUp,
  DollarSign,
  CheckCircle2,
} from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { Button } from '../../components/common/Button';
import { Badge } from '../../components/common/Badge';
import { Shift } from '../../domain/shift';
import { Order } from '../../domain/order';
import { formatMoney } from '../../domain/money';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { playScannerSound } from '../../services/soundService';

interface ShiftPaymentBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  shift: Shift;
  orders: readonly Order[];
  currency: string;
}

export const ShiftPaymentBreakdownModal: React.FC<ShiftPaymentBreakdownModalProps> = ({
  isOpen,
  onClose,
  shift,
  orders,
  currency,
}) => {
  const { t, language } = useLanguage();
  const { addToast } = useToast();

  // Filter orders belonging to this shift timeline
  const shiftOrders = React.useMemo(() => {
    const openedTime = new Date(shift.openedAt).getTime();
    const closedTime = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();

    return orders.filter((o) => {
      const orderTime = new Date(o.createdAt).getTime();
      return (
        orderTime >= openedTime &&
        orderTime <= closedTime &&
        (o.status === 'server_confirmed' || o.status === 'pending_sync_offline')
      );
    });
  }, [orders, shift]);

  // Calculate payment method totals
  const breakdown = React.useMemo(() => {
    let cashCents = 0;
    let cardCents = 0;
    let digitalCents = 0;

    let cashCount = 0;
    let cardCount = 0;
    let digitalCount = 0;

    for (const o of shiftOrders) {
      for (const p of o.payments || []) {
        const amt = p.amount.amountInCents;
        if (p.method === 'cash') {
          cashCents += amt;
          cashCount++;
        } else if (p.method === 'card') {
          cardCents += amt;
          cardCount++;
        } else if (p.method === 'qr_digital') {
          digitalCents += amt;
          digitalCount++;
        } else {
          cashCents += amt;
          cashCount++;
        }
      }
    }

    const totalCents = cashCents + cardCents + digitalCents;

    const cashPct = totalCents > 0 ? (cashCents / totalCents) * 100 : 0;
    const cardPct = totalCents > 0 ? (cardCents / totalCents) * 100 : 0;
    const digitalPct = totalCents > 0 ? (digitalCents / totalCents) * 100 : 0;

    return {
      cash: { cents: cashCents, count: cashCount, pct: cashPct },
      card: { cents: cardCents, count: cardCount, pct: cardPct },
      digital: { cents: digitalCents, count: digitalCount, pct: digitalPct },
      totalCents,
      totalCount: shiftOrders.length,
    };
  }, [shiftOrders]);

  const handlePrintSummary = () => {
    playScannerSound('click');
    try {
      const printWindow = window.open('', '_blank', 'width=420,height=600');
      if (!printWindow) {
        addToast({
          title: language === 'th' ? 'กรุณาอนุญาต Pop-up' : 'Popup Blocked',
          message: language === 'th' ? 'โปรดอนุญาตให้เปิดหน้าต่างพิมพ์รายงาน' : 'Please allow popups to print summary.',
          type: 'warning',
        });
        return;
      }

      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Shift Summary Report - ${shift.id}</title>
            <style>
              body { font-family: 'Courier New', monospace; font-size: 12px; width: 300px; margin: 0 auto; padding: 12px; color: #000; }
              .center { text-align: center; }
              .bold { font-weight: bold; }
              .line { border-bottom: 1px dashed #000; margin: 8px 0; }
              .row { display: flex; justify-content: space-between; margin: 4px 0; }
              .right { text-align: right; }
            </style>
          </head>
          <body>
            <div class="center bold" style="font-size: 14px;">PRODX RETAIL POS</div>
            <div class="center">SHIFT PAYMENT BREAKDOWN REPORT</div>
            <div class="line"></div>
            <div>Shift ID: ${shift.id}</div>
            <div>Register: Terminal ${shift.registerId}</div>
            <div>Cashier: ${shift.cashierName}</div>
            <div>Opened: ${new Date(shift.openedAt).toLocaleString()}</div>
            <div>Closed: ${shift.closedAt ? new Date(shift.closedAt).toLocaleString() : 'Active Shift'}</div>
            <div class="line"></div>
            <div class="bold">PAYMENT METHOD BREAKDOWN:</div>
            <div class="row">
              <span>1. Cash (${breakdown.cash.count} txns):</span>
              <span class="bold">${formatMoney({ amountInCents: breakdown.cash.cents, currency })}</span>
            </div>
            <div class="row" style="padding-left: 10px; font-size: 11px; color: #555;">
              <span>Share: ${breakdown.cash.pct.toFixed(1)}%</span>
            </div>

            <div class="row" style="margin-top: 6px;">
              <span>2. Card (${breakdown.card.count} txns):</span>
              <span class="bold">${formatMoney({ amountInCents: breakdown.card.cents, currency })}</span>
            </div>
            <div class="row" style="padding-left: 10px; font-size: 11px; color: #555;">
              <span>Share: ${breakdown.card.pct.toFixed(1)}%</span>
            </div>

            <div class="row" style="margin-top: 6px;">
              <span>3. Digital/QR (${breakdown.digital.count} txns):</span>
              <span class="bold">${formatMoney({ amountInCents: breakdown.digital.cents, currency })}</span>
            </div>
            <div class="row" style="padding-left: 10px; font-size: 11px; color: #555;">
              <span>Share: ${breakdown.digital.pct.toFixed(1)}%</span>
            </div>

            <div class="line"></div>
            <div class="row bold" style="font-size: 13px;">
              <span>TOTAL REVENUE:</span>
              <span>${formatMoney({ amountInCents: breakdown.totalCents, currency })}</span>
            </div>
            <div class="row">
              <span>Total Orders:</span>
              <span>${breakdown.totalCount}</span>
            </div>
            <div class="line"></div>
            <div class="center" style="font-size: 10px; margin-top: 10px;">
              *** END OF SHIFT SUMMARY REPORT ***
            </div>
          </body>
        </html>
      `;

      printWindow.document.write(htmlContent);
      printWindow.document.close();
      printWindow.focus();
      setTimeout(() => {
        printWindow.print();
        printWindow.close();
      }, 350);

      addToast({
        title: language === 'th' ? 'พิมพ์รายงานสำเร็จ' : 'Summary Printed',
        message: language === 'th' ? 'ส่งคำสั่งพิมพ์รายงานสรุปกะเรียบร้อยแล้ว' : 'Shift summary report sent to printer.',
        type: 'success',
      });
    } catch (err: any) {
      console.error('[Shift Summary Print Error]', err);
      addToast({
        title: 'Print Failed',
        message: err?.message || 'Failed to trigger print dialog.',
        type: 'error',
      });
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={language === 'th' ? 'รายงานกราฟิกสรุปยอดชำระเงินประจำกะ' : 'Shift Payment Breakdown & Graphical Analytics'}
      description={language === 'th' ? `วิเคราะห์สัดส่วนเงินสด บัตรเครดิต และช่องทางดิจิทัล สำหรับกะเครื่อง ${shift.registerId}` : `Visual breakdown of Cash, Card, and Digital tenders for register ${shift.registerId}`}
      maxWidth="lg"
    >
      <div className="space-y-6">
        {/* Top Summary Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-xl bg-card border border-border border-crisp shadow-2xs">
            <div className="text-[11px] font-semibold text-text/60 uppercase tracking-wider">
              {language === 'th' ? 'ยอดขายสุทธิรวม' : 'Total Shift Revenue'}
            </div>
            <div className="text-xl font-black font-mono text-primary mt-1">
              {formatMoney({ amountInCents: breakdown.totalCents, currency })}
            </div>
            <div className="text-[10px] text-text/50 mt-0.5">
              {breakdown.totalCount} {language === 'th' ? 'คำสั่งซื้อที่สำเร็จ' : 'completed orders'}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-card border border-border border-crisp shadow-2xs">
            <div className="text-[11px] font-semibold text-text/60 uppercase tracking-wider">
              {language === 'th' ? 'เงินสดในลิ้นชักที่คาดหวัง' : 'Expected Drawer Cash'}
            </div>
            <div className="text-xl font-black font-mono text-emerald-600 dark:text-emerald-400 mt-1">
              {formatMoney(shift.expectedCashInDrawer)}
            </div>
            <div className="text-[10px] text-text/50 mt-0.5">
              {language === 'th' ? `ยกมา ${formatMoney(shift.openingFloat)}` : `Float + Cash Sales`}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-card border border-border border-crisp shadow-2xs">
            <div className="text-[11px] font-semibold text-text/60 uppercase tracking-wider">
              {language === 'th' ? 'ตั๋วเฉลี่ยต่อบิล' : 'Average Ticket Size'}
            </div>
            <div className="text-xl font-black font-mono text-text mt-1">
              {breakdown.totalCount > 0
                ? formatMoney({
                    amountInCents: Number((BigInt(breakdown.totalCents) + BigInt(Math.max(1, breakdown.totalCount)) / 2n) / BigInt(Math.max(1, breakdown.totalCount))),
                    currency,
                  })
                : formatMoney({ amountInCents: 0, currency })}
            </div>
            <div className="text-[10px] text-text/50 mt-0.5">
              {language === 'th' ? 'มูลค่าเฉลี่ยต่อคำสั่งซื้อ' : 'Per transaction average'}
            </div>
          </div>
        </div>

        {/* Graphical Progress Bar Stack */}
        <div className="p-4 rounded-2xl bg-card border border-border border-crisp shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-2">
              <PieChart className="h-4 w-4 text-primary" />
              <span>{language === 'th' ? 'สัดส่วนช่องทางชำระเงิน (%)' : 'Tender Share Distribution'}</span>
            </h3>
            <span className="text-xs font-mono font-semibold text-text/70">
              100% Total
            </span>
          </div>

          {/* Multi-Segment Graphical Bar */}
          <div className="h-4 w-full rounded-full bg-border/40 overflow-hidden flex shadow-inner">
            <div
              style={{ width: `${breakdown.cash.pct}%` }}
              className="bg-emerald-500 transition-all duration-500 h-full"
              title={`Cash: ${breakdown.cash.pct.toFixed(1)}%`}
            />
            <div
              style={{ width: `${breakdown.card.pct}%` }}
              className="bg-blue-600 transition-all duration-500 h-full"
              title={`Card: ${breakdown.card.pct.toFixed(1)}%`}
            />
            <div
              style={{ width: `${breakdown.digital.pct}%` }}
              className="bg-purple-600 transition-all duration-500 h-full"
              title={`Digital/QR: ${breakdown.digital.pct.toFixed(1)}%`}
            />
          </div>

          {/* Legend Items */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            {/* Cash Legend */}
            <div className="p-3 rounded-xl bg-background border border-border border-crisp flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-text flex items-center justify-between">
                  <span>{language === 'th' ? 'เงินสด (Cash)' : 'Cash'}</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                    {breakdown.cash.pct.toFixed(1)}%
                  </span>
                </div>
                <div className="text-[11px] font-mono font-semibold text-text/70 mt-0.5">
                  {formatMoney({ amountInCents: breakdown.cash.cents, currency })} ({breakdown.cash.count} txns)
                </div>
              </div>
            </div>

            {/* Card Legend */}
            <div className="p-3 rounded-xl bg-background border border-border border-crisp flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-blue-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-text flex items-center justify-between">
                  <span>{language === 'th' ? 'บัตรเครดิต (Card)' : 'Card'}</span>
                  <span className="font-mono text-blue-600 dark:text-blue-400">
                    {breakdown.card.pct.toFixed(1)}%
                  </span>
                </div>
                <div className="text-[11px] font-mono font-semibold text-text/70 mt-0.5">
                  {formatMoney({ amountInCents: breakdown.card.cents, currency })} ({breakdown.card.count} txns)
                </div>
              </div>
            </div>

            {/* Digital Legend */}
            <div className="p-3 rounded-xl bg-background border border-border border-crisp flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-purple-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-text flex items-center justify-between">
                  <span>{language === 'th' ? 'คิวอาร์/ดิจิทัล (Digital)' : 'Digital/QR'}</span>
                  <span className="font-mono text-purple-600 dark:text-purple-400">
                    {breakdown.digital.pct.toFixed(1)}%
                  </span>
                </div>
                <div className="text-[11px] font-mono font-semibold text-text/70 mt-0.5">
                  {formatMoney({ amountInCents: breakdown.digital.cents, currency })} ({breakdown.digital.count} txns)
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="pt-2 flex items-center justify-between gap-3 border-t border-border border-crisp">
          <Button
            variant="outline"
            size="md"
            onClick={onClose}
          >
            {t.common.cancel}
          </Button>

          <Button
            variant="primary"
            size="md"
            onClick={handlePrintSummary}
            leftIcon={<Printer className="h-4 w-4" />}
          >
            {language === 'th' ? 'พิมพ์รายงานสรุป (Print Summary)' : 'Print Summary'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
