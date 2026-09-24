import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useShift } from '../../context/ShiftContext';
import { useToast } from '../../context/ToastContext';
import { useLanguage } from '../../context/LanguageContext';
import { CashMovementType, Shift, TimeclockRecord } from '../../domain/shift';
import { Order } from '../../domain/order';
import { formatMoney, createMoney, subtractMoney } from '../../domain/money';
import { Card, CardHeader, CardBody } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { Modal } from '../../components/common/Modal';
import { ClockInOutModal } from './ClockInOutModal';
import { ShiftPaymentBreakdownModal } from './ShiftPaymentBreakdownModal';
import { createShiftApi } from '../../adapters/productionShiftApiFactory';
import { orderApi } from '../../adapters/mockAdapter';
import { jsPDF } from 'jspdf';
import {
  Banknote,
  PlusCircle,
  MinusCircle,
  CheckCircle2,
  AlertTriangle,
  History,
  Lock,
  Unlock,
  Receipt,
  Scale,
  FileDown,
  Clock,
  UserCheck,
  PieChart,
} from 'lucide-react';

export const ShiftScreen: React.FC = () => {
  const { session } = useAuth();
  const shiftApi = session ? createShiftApi(session.token) : null;
  const { currentShift, openShift, closeShift, recordCashMovement } = useShift();
  const { addToast } = useToast();
  const { t, language } = useLanguage();

  // Modals state
  const [isOpenShiftModal, setIsOpenShiftModal] = useState(false);
  const [isCloseShiftModal, setIsCloseShiftModal] = useState(false);
  const [isMovementModal, setIsMovementModal] = useState(false);
  const [isClockModalOpen, setIsClockModalOpen] = useState(false);
  const [isBreakdownModalOpen, setIsBreakdownModalOpen] = useState(false);

  // Form states
  const [openingFloatDollars, setOpeningFloatDollars] = useState('200.00');
  const [countedDollars, setCountedDollars] = useState('200.00');
  const [movementType, setMovementType] = useState<CashMovementType>('paid_in');
  const [movementAmountDollars, setMovementAmountDollars] = useState('50.00');
  const [movementReason, setMovementReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [timeclockRecords, setTimeclockRecords] = useState<TimeclockRecord[]>([]);
  const [orders, setOrders] = useState<readonly Order[]>([]);

  const triggerOpenShiftModal = () => {
    if (currentShift && currentShift.status === 'open') {
      addToast({
        title: t.shift.shiftAlreadyActive,
        message: t.shift.shiftAlreadyActiveWarning,
        type: 'warning',
      });
      return;
    }
    setIsOpenShiftModal(true);
  };

  useEffect(() => {
    if (session) {
      shiftApi!.getTimeclockRecords(session.currentStore.id)
        .then(records => setTimeclockRecords(records))
        .catch(console.error);

      orderApi.getOrders(session.currentStore.id)
        .then(list => setOrders(list))
        .catch(console.error);
    }
  }, [session]);

  const refreshTimeclock = async () => {
    if (session) {
      const records = await shiftApi!.getTimeclockRecords(session.currentStore.id);
      setTimeclockRecords(records);
      const list = await orderApi.getOrders(session.currentStore.id);
      setOrders(list);
    }
  };

  if (!session) return null;

  const generateHandoverPDF = (shift: Shift) => {
    if (!shift) return;

    try {
      const doc = new jsPDF();
      
      // Brand Colors (Modern SaaS Blue #2563EB)
      const primaryColor = [37, 99, 235];
      const darkGray = [40, 40, 40];
      const lightGray = [245, 245, 245];

      // Draw Top Banner
      doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.rect(0, 0, 210, 40, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(20);
      doc.text('SHIFT HANDOVER REPORT', 14, 26);
      
      // Status Badge
      doc.setFontSize(10);
      doc.setFillColor(255, 255, 255);
      doc.rect(155, 18, 41, 10, 'F');
      doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
      doc.text(shift.status.toUpperCase(), 175, 24, { align: 'center' });

      // Metadata section
      doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      
      let y = 52;
      doc.text('SHIFT METADATA', 14, y);
      doc.line(14, y + 2, 196, y + 2);
      
      y += 10;
      doc.setFont('helvetica', 'normal');
      doc.text(`Store: ${session.currentStore.name} (ID: ${session.currentStore.id})`, 14, y);
      doc.text(`Register Terminal: Terminal ${shift.registerId}`, 115, y);
      
      y += 6;
      doc.text(`Cashier Name: ${shift.cashierName} (ID: ${shift.cashierId})`, 14, y);
      doc.text(`Status: ${shift.status.toUpperCase()}`, 115, y);
      
      y += 6;
      doc.text(`Opened At: ${new Date(shift.openedAt).toLocaleString()}`, 14, y);
      if (shift.closedAt) {
        doc.text(`Closed At: ${new Date(shift.closedAt).toLocaleString()}`, 115, y);
      } else {
        doc.text(`Closed At: Active / Draft Preview`, 115, y);
      }

      // Financial Metrics
      y += 16;
      doc.setFont('helvetica', 'bold');
      doc.text('FINANCIAL SUMMARY', 14, y);
      doc.line(14, y + 2, 196, y + 2);

      y += 10;
      doc.setFont('helvetica', 'normal');
      
      doc.text(`Opening Float (Cash):`, 14, y);
      doc.setFont('helvetica', 'bold');
      doc.text(`${formatMoney(shift.openingFloat)}`, 65, y);
      
      doc.setFont('helvetica', 'normal');
      doc.text(`Total Cash Sales:`, 115, y);
      doc.setFont('helvetica', 'bold');
      doc.text(`${formatMoney(shift.totalCashSales)}`, 165, y);

      y += 8;
      doc.setFont('helvetica', 'normal');
      doc.text(`Total Paid-In:`, 14, y);
      doc.setFont('helvetica', 'bold');
      doc.text(`+${formatMoney(shift.totalPaidIn)}`, 65, y);
      
      doc.setFont('helvetica', 'normal');
      doc.text(`Total Paid-Out:`, 115, y);
      doc.setFont('helvetica', 'bold');
      doc.text(`-${formatMoney(shift.totalPaidOut)}`, 165, y);

      y += 12;
      doc.setFillColor(lightGray[0], lightGray[1], lightGray[2]);
      doc.rect(14, y - 6, 182, 16, 'F');
      
      doc.setFont('helvetica', 'bold');
      doc.text(`Expected Cash in Drawer:`, 18, y + 4);
      doc.setFontSize(11);
      doc.text(`${formatMoney(shift.expectedCashInDrawer)}`, 72, y + 4);
      
      doc.setFontSize(10);
      if (shift.actualCountedCash) {
        doc.text(`Actual Counted Cash:`, 118, y + 4);
        doc.text(`${formatMoney(shift.actualCountedCash)}`, 168, y + 4);
      } else {
        doc.text(`Actual Counted Cash:`, 118, y + 4);
        doc.text(`Pending (Open Shift)`, 168, y + 4);
      }
      doc.setFont('helvetica', 'normal');

      // Cash discrepancy reconciliation
      y += 18;
      doc.setFont('helvetica', 'bold');
      doc.text('CASH RECONCILIATION & DISCREPANCIES', 14, y);
      doc.line(14, y + 2, 196, y + 2);

      y += 10;
      const varianceCents = shift.variance?.amountInCents ?? 0;
      if (varianceCents === 0) {
        doc.setFillColor(240, 253, 244);
        doc.rect(14, y - 4, 182, 12, 'F');
        doc.setTextColor(22, 101, 52);
        doc.setFont('helvetica', 'bold');
        doc.text('RECONCILED: Perfect Balance. No cash count discrepancies detected.', 18, y + 4);
      } else {
        doc.setFillColor(254, 242, 242);
        doc.rect(14, y - 4, 182, 12, 'F');
        doc.setTextColor(153, 27, 27);
        doc.setFont('helvetica', 'bold');
        doc.text(`DISCREPANCY DETECTED: Variance of ${formatMoney(shift.variance!)} in drawer cash count.`, 18, y + 4);
      }
      doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
      doc.setFont('helvetica', 'normal');

      // Staff Activity List
      y += 20;
      doc.setFont('helvetica', 'bold');
      doc.text('STAFF ACTIVITY & MOVEMENTS LEDGER', 14, y);
      doc.line(14, y + 2, 196, y + 2);

      y += 8;
      doc.setFillColor(235, 235, 235);
      doc.rect(14, y, 182, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.text('TIMESTAMP', 18, y + 5);
      doc.text('ACTIVITY TYPE', 48, y + 5);
      doc.text('CASHIER ID', 88, y + 5);
      doc.text('REASON / REMARKS', 118, y + 5);
      doc.text('AMOUNT', 192, y + 5, { align: 'right' });
      doc.setFont('helvetica', 'normal');

      y += 8;
      if (shift.movements.length === 0) {
        doc.text('No manual movements or activities recorded during this shift.', 18, y + 5);
        y += 8;
      } else {
        shift.movements.forEach((m) => {
          if (y > 255) {
            doc.addPage();
            y = 20;
            
            doc.setFillColor(235, 235, 235);
            doc.rect(14, y, 182, 8, 'F');
            doc.setFont('helvetica', 'bold');
            doc.text('TIMESTAMP', 18, y + 5);
            doc.text('ACTIVITY TYPE', 48, y + 5);
            doc.text('CASHIER ID', 88, y + 5);
            doc.text('REASON / REMARKS', 118, y + 5);
            doc.text('AMOUNT', 192, y + 5, { align: 'right' });
            doc.setFont('helvetica', 'normal');
            y += 8;
          }

          const timeStr = new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          doc.text(timeStr, 18, y + 5);
          doc.text(m.type.toUpperCase(), 48, y + 5);
          doc.text(m.performedByUserId, 88, y + 5);
          
          let reasonStr = m.reason || 'N/A';
          if (reasonStr.length > 35) {
            reasonStr = reasonStr.substring(0, 32) + '...';
          }
          doc.text(reasonStr, 118, y + 5);
          
          doc.setFont('helvetica', 'bold');
          doc.text(formatMoney(m.amount), 192, y + 5, { align: 'right' });
          doc.setFont('helvetica', 'normal');
          
          y += 7;
        });
      }

      // Handover verification and signatures
      y += 12;
      if (y > 230) {
        doc.addPage();
        y = 25;
      }

      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('HANDOVER VERIFICATION & SIGN-OFF', 14, y);
      doc.line(14, y + 2, 196, y + 2);

      y += 12;
      doc.text('Outgoing Cashier Signature', 14, y);
      doc.text('Incoming Cashier Signature', 110, y);

      y += 18;
      doc.line(14, y, 84, y);
      doc.line(110, y, 180, y);

      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.text(`Name: ${shift.cashierName}`, 14, y);
      doc.text('Name: ________________________', 110, y);

      y += 5;
      doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, y);
      doc.text('Date: ________________________', 110, y);

      const filename = `Shift_Handover_Reg${shift.registerId}_${new Date(shift.openedAt).toISOString().split('T')[0]}.pdf`;
      doc.save(filename);

      addToast({
        title: language === 'th' ? 'สร้างรายงานส่งมอบกะสำเร็จ' : 'Report Generated',
        message: language === 'th' ? `ดาวน์โหลดไฟล์ ${filename} เรียบร้อยแล้ว` : `Downloaded Shift Handover PDF: ${filename}`,
        type: 'success',
      });
    } catch (err: any) {
      console.error('[PDF Generation Error]', err);
      addToast({
        title: 'PDF Generation Failed',
        message: err?.message || 'Error occurred during shift report generation.',
        type: 'error',
      });
    }
  };

  const handleOpenShift = async () => {
    // Validation check: Warn if another shift is still active in the local database
    if (currentShift && currentShift.status === 'open') {
      addToast({
        title: t.shift.shiftAlreadyActive,
        message: t.shift.shiftAlreadyActiveWarning,
        type: 'warning',
      });
      setIsOpenShiftModal(false);
      return;
    }

    setIsSubmitting(true);
    try {
      const cents = Math.round(parseFloat(openingFloatDollars || '0') * 100);
      await openShift(createMoney(cents, session.currentStore.currency));
      addToast({
        title: language === 'th' ? 'เปิดกะเรียบร้อยแล้ว' : 'Shift Opened',
        message: `${language === 'th' ? 'เครื่องขาย' : 'Register'} ${session.registerId} ${language === 'th' ? 'พร้อมรับชำระเงินสด' : 'ready for cash transactions.'}`,
        type: 'success',
      });
      setIsOpenShiftModal(false);
    } catch (err: any) {
      addToast({
        title: language === 'th' ? 'เปิดกะไม่สำเร็จ' : 'Open Shift Failed',
        message: err?.message || (language === 'th' ? 'เกิดข้อผิดพลาดในการเปิดกะ' : 'Error opening shift.'),
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCloseShift = async () => {
    setIsSubmitting(true);
    try {
      const cents = Math.round(parseFloat(countedDollars || '0') * 100);
      const actualCounted = createMoney(cents, session.currentStore.currency);
      const closed = await closeShift(actualCounted);
      const variance = closed.variance
        ? formatMoney(closed.variance)
        : '$0.00';

      addToast({
        title: language === 'th' ? 'ปิดกะและกระทบยอดเรียบร้อย' : 'Shift Closed & Reconciled',
        message: `${language === 'th' ? 'ผลต่างเงินสด:' : 'Cash variance:'} ${variance}`,
        type: closed.variance?.amountInCents === 0 ? 'success' : 'warning',
      });
      setIsCloseShiftModal(false);
    } catch (err: any) {
      addToast({
        title: language === 'th' ? 'ปิดกะไม่สำเร็จ' : 'Close Shift Failed',
        message: err?.message || (language === 'th' ? 'เกิดข้อผิดพลาดในการปิดกะ' : 'Error closing shift.'),
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRecordMovement = async () => {
    if (!movementReason.trim()) {
      addToast({
        title: language === 'th' ? 'กรุณาระบุเหตุผล' : 'Reason Required',
        message: language === 'th' ? 'จำเป็นต้องระบุเหตุผลเพื่อเป็นหลักฐานตรวจสอบการนำเงินเข้า/ออก' : 'A mandatory audit reason is required for cash movements.',
        type: 'warning',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const cents = Math.round(parseFloat(movementAmountDollars || '0') * 100);
      await recordCashMovement(
        movementType,
        createMoney(cents, session.currentStore.currency),
        movementReason
      );
      addToast({
        title: language === 'th' ? 'บันทึกการเคลื่อนไหวเงินสดสำเร็จ' : 'Cash Drawer Movement Recorded',
        message: `${movementType.replace('_', ' ').toUpperCase()}: $${movementAmountDollars}`,
        type: 'info',
      });
      setIsMovementModal(false);
      setMovementReason('');
    } catch (err: any) {
      addToast({
        title: language === 'th' ? 'บันทึกรายการไม่สำเร็จ' : 'Movement Failed',
        message: err?.message || (language === 'th' ? 'เกิดข้อผิดพลาดในการบันทึกรายการ' : 'Error recording movement.'),
        type: 'error',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 bg-background no-scrollbar">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between pb-4 sm:pb-6 border-b border-border/50">
        <div className="min-w-0 flex-1">
          <h1 className="text-heading-1 text-text">
            {language === 'th' ? 'กะการทำงาน & ลิ้นชักเงินสด' : 'Shift & Cash Drawer'}
          </h1>
          <p className="text-caption text-text/70 mt-1">
            {language === 'th' ? 'ควบคุมการเปิด-ปิดกะ บันทึกเงินสดยกมา และกระทบยอดเงินสดอย่างรัดกุม' : 'Manage register shifts, cash float, and drawer reconciliation.'}
          </p>
        </div>
        {/* Action button container with overflow-x-auto */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 shrink-0">
          {/* ปุ่มลงเวลา, รายงาน, บันทึกเงินเข้าออก, และปุ่มปิดกะ */}
          <Button
            variant="outline"
            size="md"
            onClick={() => setIsClockModalOpen(true)}
            leftIcon={<Clock className="h-4 w-4 text-emerald-500" />}
            className="whitespace-nowrap min-h-[44px]"
          >
            {language === 'th' ? 'ลงเวลาเข้า/ออก' : 'Clock In/Out'}
          </Button>
          {currentShift ? (
            <>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setIsBreakdownModalOpen(true)}
                leftIcon={<PieChart className="h-4 w-4 text-purple-600 dark:text-purple-400" />}
                className="whitespace-nowrap min-h-[44px]"
              >
                {language === 'th' ? 'กราฟสรุปยอดชำระ' : 'Payment Breakdown'}
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => generateHandoverPDF(currentShift)}
                leftIcon={<FileDown className="h-4 w-4 text-primary" />}
                className="whitespace-nowrap min-h-[44px]"
              >
                {language === 'th' ? 'รายงานส่งมอบกะ' : 'Shift Handover'}
              </Button>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setIsMovementModal(true)}
                leftIcon={<Banknote className="h-4 w-4 text-primary" />}
                className="whitespace-nowrap min-h-[44px]"
              >
                {language === 'th' ? 'บันทึกเงินเข้า/ออก' : 'Cash Movement'}
              </Button>
              <Button
                variant="danger"
                size="md"
                onClick={() => {
                  setCountedDollars((currentShift.expectedCashInDrawer.amountInCents / 100).toFixed(2));
                  setIsCloseShiftModal(true);
                }}
                leftIcon={<Lock className="h-4 w-4" />}
                className="whitespace-nowrap min-h-[44px]"
              >
                {t.shift.closeShiftBtn}
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="md"
              onClick={triggerOpenShiftModal}
              leftIcon={<Unlock className="h-4 w-4" />}
              className="whitespace-nowrap min-h-[44px]"
            >
              {t.shift.openShiftBtn}
            </Button>
          )}
        </div>
      </div>

      {/* Active Shift Overview */}
      {currentShift ? (
        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="w-full lg:w-[45%] flex flex-col gap-6">
          {/* Metrics Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="shadow-2xs">
              <CardBody className="p-5">
                <div className="text-xs font-semibold text-text/70 uppercase tracking-wider">{t.shift.openingCash}</div>
                <div className="text-2xl font-black font-mono mt-2 text-text">
                  {formatMoney(currentShift.openingFloat)}
                </div>
                <div className="text-[11px] text-text/50 mt-1">
                  {language === 'th' ? 'เปิดกะเวลา' : 'Opened at'} {new Date(currentShift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </CardBody>
            </Card>

            <Card className="shadow-2xs">
              <CardBody className="p-5">
                <div className="text-xs font-semibold text-text/70 uppercase tracking-wider">{t.shift.cashSales}</div>
                <div className="text-2xl font-black font-mono mt-2 text-emerald-600 dark:text-emerald-400">
                  +{formatMoney(currentShift.totalCashSales)}
                </div>
                <div className="text-[11px] text-text/50 mt-1">{language === 'th' ? 'ยอดเงินสดที่รับชำระทั้งหมด' : 'Collected from cash tenders'}</div>
              </CardBody>
            </Card>

            <Card className="shadow-2xs">
              <CardBody className="p-5">
                <div className="text-xs font-semibold text-text/70 uppercase tracking-wider">{t.shift.paidIn} / {t.shift.paidOut}</div>
                <div className="flex items-center gap-3 mt-2 font-mono text-sm font-bold">
                  <span className="text-emerald-600 dark:text-emerald-400">+{formatMoney(currentShift.totalPaidIn)}</span>
                  <span className="text-rose-600 dark:text-rose-400">-{formatMoney(currentShift.totalPaidOut)}</span>
                </div>
                <div className="text-[11px] text-text/50 mt-1">{language === 'th' ? 'การนำเงินเข้าและหยอดเซฟ' : 'Cash drops and floats'}</div>
              </CardBody>
            </Card>

            <Card className="shadow-2xs">
              <CardBody className="p-5">
                <div className="text-xs font-semibold text-text/70 uppercase tracking-wider">{t.shift.expectedInDrawer}</div>
                <div className="text-2xl font-black font-mono mt-2 text-text">
                  {formatMoney(currentShift.expectedCashInDrawer)}
                </div>
                <div className="text-[11px] text-text/50 mt-1">{language === 'th' ? 'เงินทอน + ยอดขาย + ยอดเคลื่อนไหวสุทธิ' : 'Float + Sales + Net Movements'}</div>
              </CardBody>
            </Card>
          </div>

          </div>
          <div className="w-full lg:w-[55%]">
          {/* Cash Movements Ledger */}
          <Card className="shadow-2xs flex-1">
            <CardHeader>
              <div>
                <h3 className="text-sm font-bold text-text">
                  {language === 'th' ? 'ประวัติความเคลื่อนไหวเงินสดในลิ้นชัก' : 'Shift Drawer Activity & Movements'}
                </h3>
                <p className="text-xs text-text/70 mt-0.5">
                  {language === 'th' ? `บันทึกการนำเงินเข้า-ออก ตรวจสอบได้สำหรับเครื่อง ${session.registerId}` : `Traceable cash drops, adjustments, and receipts for register ${session.registerId}.`}
                </p>
              </div>
            </CardHeader>
            <div className="w-full overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-border border-crisp text-text/70 bg-card font-medium">
                    <th className="py-3 px-5">{t.audit.timestamp}</th>
                    <th className="py-3 px-4">{language === 'th' ? 'ประเภทรายการ' : 'Action Type'}</th>
                    <th className="py-3 px-4">{t.shift.cashier}</th>
                    <th className="py-3 px-4">{language === 'th' ? 'เหตุผล / หมายเหตุ' : 'Audit Reason / Notes'}</th>
                    <th className="py-3 px-5 text-right">{language === 'th' ? 'จำนวนเงิน' : 'Amount'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono">
                  {currentShift.movements.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-text/50 font-sans">
                        {language === 'th' ? 'ยังไม่มีรายการเคลื่อนไหวเงินสดในกะนี้' : 'No manual cash movements in this shift yet.'}
                      </td>
                    </tr>
                  ) : (
                    currentShift.movements.map((m) => (
                      <tr key={m.id} className="hover:bg-background">
                        <td className="py-3 px-5 text-text/50">
                          {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="py-3 px-4 font-sans">
                          <Badge
                            variant={
                              m.type === 'paid_in' || m.type === 'opening_float' || m.type === 'cash_sale'
                                ? 'success'
                                : 'neutral'
                            }
                            size="sm"
                          >
                            {m.type === 'drawer_drop'
                              ? t.shift.cashDrop
                              : (m.type as string) === 'paid_in'
                              ? t.shift.paidIn
                              : (m.type as string) === 'paid_out'
                              ? t.shift.paidOut
                              : m.type.replace('_', ' ').toUpperCase()}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-text/50">{m.performedByUserId}</td>
                        <td className="py-3 px-4 font-sans text-text/70">
                          {m.reason}
                        </td>
                        <td className="py-3 px-5 text-right font-mono font-bold text-text">
                          {formatMoney(m.amount)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          </div>
      </div>
      ) : (
        /* No Shift Open Empty State */
        <Card className="text-center py-16 px-4">
          <Banknote className="h-12 w-12 mx-auto text-text/30 mb-3" />
          <h3 className="text-base font-bold text-text">
            {t.shift.noActiveShift} ({language === 'th' ? 'เครื่อง' : 'Register'} {session.registerId})
          </h3>
          <p className="text-xs text-text/50 max-w-sm mx-auto mt-1 mb-6">
            {t.shift.noShiftPrompt}
          </p>
          <Button
            variant="primary"
            size="lg"
            onClick={triggerOpenShiftModal}
            leftIcon={<Unlock className="h-4 w-4" />}
          >
            {t.shift.openShiftBtn}
          </Button>
        </Card>
      )}

      {/* Timeclock Records Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <h2 className="text-sm font-bold text-text flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-emerald-500" />
            {language === 'th' ? 'บันทึกเวลาเข้า-ออกงาน' : 'Timeclock Records'}
          </h2>
          <Badge variant="neutral">{timeclockRecords.length} {language === 'th' ? 'รายการ' : 'Records'}</Badge>
        </CardHeader>
        <div className="w-full overflow-x-auto rounded-lg border border-border bg-card max-h-[300px]">
          <table className="w-full text-left text-sm">
            <thead className="bg-card sticky top-0 border-b border-border border-crisp">
              <tr>
                <th className="py-2.5 px-4 font-semibold text-text/70 text-xs uppercase">{language === 'th' ? 'สถานะ' : 'Status'}</th>
                <th className="py-2.5 px-4 font-semibold text-text/70 text-xs uppercase">{language === 'th' ? 'พนักงาน' : 'Employee'}</th>
                <th className="py-2.5 px-4 font-semibold text-text/70 text-xs uppercase">{language === 'th' ? 'รหัสพนักงาน' : 'Code'}</th>
                <th className="py-2.5 px-4 font-semibold text-text/70 text-xs uppercase">{language === 'th' ? 'เวลาเข้า' : 'In'}</th>
                <th className="py-2.5 px-4 font-semibold text-text/70 text-xs uppercase">{language === 'th' ? 'เวลาออก' : 'Out'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {timeclockRecords.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-text/50 text-sm">
                    {language === 'th' ? 'ไม่มีบันทึกเวลา' : 'No timeclock records'}
                  </td>
                </tr>
              ) : (
                timeclockRecords.map((r) => (
                  <tr key={r.id} className="hover:bg-background transition-colors">
                    <td className="py-2.5 px-4">
                      {r.status === 'clocked_in' ? (
                        <Badge variant="success" className="text-[10px]">
                          {language === 'th' ? 'เข้างาน' : 'Clocked In'}
                        </Badge>
                      ) : (
                        <Badge variant="neutral" className="text-[10px]">
                          {language === 'th' ? 'ออกงาน' : 'Clocked Out'}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-text">{r.userName}</td>
                    <td className="py-2.5 px-4 font-mono text-xs text-text/50">{r.employeeCode}</td>
                    <td className="py-2.5 px-4 text-text/70">
                      {new Date(r.clockedInAt).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="py-2.5 px-4 text-text/70">
                      {r.clockedOutAt ? new Date(r.clockedOutAt).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : '-'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Open Shift Modal */}
      <Modal
        isOpen={isOpenShiftModal}
        onClose={() => setIsOpenShiftModal(false)}
        title={t.shift.openShiftBtn}
        description={`${language === 'th' ? 'เริ่มต้นลิ้นชักเงินสดสำหรับ' : 'Initialize cash drawer on'} ${session.currentStore.code} / ${session.registerId}`}
        maxWidth="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text/70 mb-1.5">
              {t.shift.openingCash} ($)
            </label>
            <input
              type="number"
              step="0.01"
              value={openingFloatDollars}
              onChange={(e) => setOpeningFloatDollars(e.target.value)}
              className="w-full rounded-lg border-crisp border border-border bg-card text-lg font-mono font-bold py-2.5 px-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button variant="outline" size="md" onClick={() => setIsOpenShiftModal(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleOpenShift}
              isLoading={isSubmitting}
            >
              {language === 'th' ? 'ยืนยันเปิดกะ' : 'Confirm & Open'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Close & Reconcile Shift Modal */}
      {currentShift && (
        <Modal
          isOpen={isCloseShiftModal}
          onClose={() => setIsCloseShiftModal(false)}
          title={t.shift.closeShiftBtn}
          description={language === 'th' ? 'นับเงินสดทั้งหมดในลิ้นชักเพื่อทำการกระทบยอดปิดกะ' : 'Count all cash in drawer to perform end-of-shift reconciliation.'}
          maxWidth="sm"
        >
          <div className="space-y-4">
            <div className="p-3.5 rounded-lg border-crisp border border-border bg-card flex justify-between items-center text-xs">
              <span className="text-text/70">{t.shift.expectedInDrawer}:</span>
              <span className="font-mono font-bold text-base text-text">
                {formatMoney(currentShift.expectedCashInDrawer)}
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text/70 mb-1.5">
                {t.shift.countedCash} ($)
              </label>
              <input
                type="number"
                step="0.01"
                value={countedDollars}
                onChange={(e) => setCountedDollars(e.target.value)}
                className="w-full rounded-lg border-crisp border border-border bg-card text-xl font-mono font-bold py-2.5 px-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            {/* Calculated Variance */}
            {(() => {
              const countedCents = Math.round(parseFloat(countedDollars || '0') * 100);
              const varianceCents = countedCents - currentShift.expectedCashInDrawer.amountInCents;
              const isOver = varianceCents > 0;
              const isShort = varianceCents < 0;

              return (
                <div
                  className={`p-3 rounded-lg border-crisp border text-xs flex items-center justify-between font-medium ${
                    varianceCents === 0
                      ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-200'
                      : 'border-amber-200 dark:border-amber-900 bg-amber-50/50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-200'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Scale className="h-4 w-4" />
                    <span>{t.shift.variance}:</span>
                  </span>
                  <span className="font-mono font-bold text-sm">
                    {varianceCents === 0
                      ? `${t.shift.balanced} ($0.00)`
                      : `${isOver ? '+' : '-'}$${(Math.abs(varianceCents) / 100).toFixed(2)} (${isOver ? (language === 'th' ? 'เกิน' : 'Over') : (language === 'th' ? 'ขาด' : 'Short')})`}
                  </span>
                </div>
              );
            })()}

            <div className="pt-2 flex items-center justify-end gap-2">
              <Button variant="outline" size="md" onClick={() => setIsCloseShiftModal(false)}>
                {t.common.cancel}
              </Button>
              <Button
                variant="danger"
                size="md"
                onClick={handleCloseShift}
                isLoading={isSubmitting}
              >
                {language === 'th' ? 'กระทบยอด & ปิดกะ' : 'Reconcile & Close Shift'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Cash Movement Modal */}
      <Modal
        isOpen={isMovementModal}
        onClose={() => setIsMovementModal(false)}
        title={language === 'th' ? 'บันทึกการเคลื่อนไหวเงินสด' : 'Record Cash Drawer Movement'}
        description={language === 'th' ? 'นำเงินสดออกเซฟ, เบิกเงินสดย่อย หรือเติมเงินทอน' : 'Audited cash drops, petty cash, or extra float.'}
        maxWidth="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text/70 mb-1.5">
              {language === 'th' ? 'ประเภทรายการ' : 'Movement Type'}
            </label>
            <select
              value={movementType}
              onChange={(e) => setMovementType(e.target.value as CashMovementType)}
              className="w-full rounded-lg border-crisp border border-border bg-card text-xs py-2.5 px-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            >
              <option value="paid_in">{language === 'th' ? 'นำเงินเข้า (Paid In)' : 'Paid In (Adding Cash)'}</option>
              <option value="paid_out">{language === 'th' ? 'จ่ายเงินออก (Paid Out)' : 'Paid Out (Petty Cash / Expense)'}</option>
              <option value="drawer_drop">{language === 'th' ? 'ส่งเงินเข้าเซฟ (Safe Deposit / Drop)' : 'Safe Drop (Drawer Drop)'}</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-text/70 mb-1.5">
              {language === 'th' ? 'จำนวนเงิน' : 'Amount ($)'}
            </label>
            <input
              type="number"
              step="0.01"
              value={movementAmountDollars}
              onChange={(e) => setMovementAmountDollars(e.target.value)}
              className="w-full rounded-lg border-crisp border border-border bg-card text-base font-mono font-bold py-2.5 px-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text/70 mb-1.5">
              {language === 'th' ? 'เหตุผลการทำรายการ (จำเป็น)' : 'Mandatory Audit Reason'}
            </label>
            <input
              type="text"
              value={movementReason}
              onChange={(e) => setMovementReason(e.target.value)}
              placeholder={language === 'th' ? 'เช่น ส่งเงินเข้าเซฟระหว่างวัน, ซื้อของฉุกเฉิน...' : 'e.g. Midday safe drop, emergency purchase...'}
              className="w-full rounded-lg border-crisp border border-border bg-card text-xs py-2.5 px-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button variant="outline" size="md" onClick={() => setIsMovementModal(false)}>
              {t.common.cancel}
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleRecordMovement}
              isLoading={isSubmitting}
            >
              {language === 'th' ? 'ยืนยันรายการ' : 'Confirm Movement'}
            </Button>
          </div>
        </div>
      </Modal>

      <ClockInOutModal
        isOpen={isClockModalOpen}
        onClose={() => setIsClockModalOpen(false)}
        onSuccess={refreshTimeclock}
      />

      {currentShift && (
        <ShiftPaymentBreakdownModal
          isOpen={isBreakdownModalOpen}
          onClose={() => setIsBreakdownModalOpen(false)}
          shift={currentShift}
          orders={orders}
          currency={session.currentStore.currency}
        />
      )}
    </div>
  );
};
