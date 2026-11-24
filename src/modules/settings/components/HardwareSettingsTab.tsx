import React, { useState } from 'react';
import {
  Printer,
  Barcode,
  DollarSign,
  Volume2,
  VolumeX,
  Eye,
  Sliders,
  Play,
  Cpu,
  CheckCircle2,
  AlertTriangle,
  Radio,
  FileCode,
  Download,
  Vibrate,
  Smartphone,
  Sparkles,
  Zap,
  Keyboard,
} from 'lucide-react';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';
import { useLanguage } from '../../../context/LanguageContext';
import { useReceiptPrinter } from '../../../context/ReceiptPrinterContext';
import { useSound } from '../../../context/SoundContext';
import { useHaptic } from '../../../context/HapticContext';
import { useToast } from '../../../context/ToastContext';
import { useSettings } from '../../../context/SettingsContext';
import { ReceiptTemplateEditorModal } from '../../../components/receipt/ReceiptTemplateEditorModal';
import { ReceiptPrintModal } from '../../../components/receipt/ReceiptPrintModal';
import { HardwareStatusDashboard } from './HardwareStatusDashboard';
import { KeyboardFocusToggle } from './KeyboardFocusToggle';

export const HardwareSettingsTab: React.FC = () => {
  const { config, updateConfig } = useSettings();
  const { language } = useLanguage();
  const { addToast } = useToast();
  const { soundEnabled, setSoundEnabled, playSuccess, playWarning, playClick } = useSound();
  const {
    isSupported: isHapticSupported,
    hapticEnabled,
    setHapticEnabled,
    intensity: hapticIntensity,
    setIntensity: setHapticIntensity,
    haptic,
    lastTriggered,
  } = useHaptic();
  const {
    templates,
    activeTemplateId,
    activeTemplate,
    setActiveTemplateId,
    printerConfig,
    updatePrinterConfig,
    printTestReceipt,
    kickCashDrawer,
    getSampleOrder,
    isPrinting,
  } = useReceiptPrinter();

  const [isTemplateEditorOpen, setIsTemplateEditorOpen] = useState(false);
  const [isTestPrintModalOpen, setIsTestPrintModalOpen] = useState(false);
  const [scannerBeep, setScannerBeep] = useState(true);

  const sampleOrder = getSampleOrder();

  const handleQuickTestPrint = async () => {
    const res = await printTestReceipt();
    if (res.success) {
      addToast({
        title: language === 'th' ? 'ส่งคำสั่งพิมพ์ทดสอบสำเร็จ' : 'Test Print Dispatched',
        message: res.message,
        type: 'success',
      });
    } else {
      addToast({
        title: language === 'th' ? 'การพิมพ์ล้มเหลว' : 'Print Error',
        message: res.message,
        type: 'error',
      });
    }
  };

  const handleKickDrawer = async () => {
    const res = await kickCashDrawer();
    addToast({
      title: language === 'th' ? 'สัญญาณลิ้นชักเก็บเงิน' : 'Cash Drawer Signal',
      message: res.message,
      type: res.success ? 'info' : 'warning',
    });
  };

  return (
    <div className="space-y-6">
      {/* Real-Time Hardware Status Dashboard & Diagnostics */}
      <HardwareStatusDashboard />

      {/* Thermal Receipt Printer Hardware Card */}
      <Card className="border border-border/80 shadow-sm rounded-lg overflow-hidden">
        <CardHeader className="bg-card/50 border-b border-border/60 py-3.5 px-5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary shrink-0">
              <Printer className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-text truncate">
                {language === 'th' ? 'เครื่องพิมพ์ใบเสร็จความร้อน (Thermal Receipt Printer)' : 'Thermal Receipt Printer'}
              </h3>
              <p className="text-[11px] text-text/50 truncate">
                {language === 'th'
                  ? 'รองรับคำสั่งมาตรฐาน ESC/POS ขนาด 58mm และ 80mm ตัดกระดาษอัตโนมัติ'
                  : 'ESC/POS thermal printer driver, layout templating, and paper cutter control.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsTestPrintModalOpen(true)}
              className="rounded-md font-bold text-xs"
              leftIcon={<Eye className="h-3.5 w-3.5" />}
            >
              {language === 'th' ? 'ดูตัวอย่างบิล' : 'Preview'}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setIsTemplateEditorOpen(true)}
              className="rounded-md font-bold text-xs"
              leftIcon={<Sliders className="h-3.5 w-3.5" />}
            >
              {language === 'th' ? 'แก้ไขเทมเพลต' : 'Edit Templates'}
            </Button>
          </div>
        </CardHeader>

        <CardBody className="p-5 space-y-5">
          {/* Printer Configuration Controls */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Active Template Selector */}
            <div className="p-4 rounded-lg border border-border/80 bg-card/60 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text/80 uppercase tracking-wide">
                  {language === 'th' ? 'แม่แบบใบเสร็จ (Template)' : 'Active Template'}
                </span>
                <Badge variant="primary" size="sm">
                  {activeTemplate.paperWidth}
                </Badge>
              </div>
              <select
                value={activeTemplateId}
                onChange={(e) => {
                  setActiveTemplateId(e.target.value);
                  addToast({
                    title: language === 'th' ? 'เปลี่ยนแม่แบบใบเสร็จแล้ว' : 'Template Selected',
                    message: `Switched layout to ${e.target.value}`,
                    type: 'info',
                  });
                }}
                className="w-full min-h-[44px] h-11 rounded-md border border-border bg-background px-3 text-base sm:text-sm font-bold text-text focus:outline-hidden focus:ring-2 focus:ring-cta focus-visible:ring-2 focus-visible:ring-cta transition"
              >
                {templates.map((tmpl) => (
                  <option key={tmpl.id} value={tmpl.id}>
                    {tmpl.name} ({tmpl.paperWidth})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-brand-text-secondary">
                {activeTemplate.description}
              </p>
            </div>

            {/* Paper Width and Copies */}
            <div className="p-4 rounded-lg border border-border/80 bg-card/60 space-y-2">
              <span className="text-xs font-bold text-text/80 uppercase tracking-wide block">
                {language === 'th' ? 'ขนาดกระดาษ & จำนวนสำเนา' : 'Paper Width & Copies'}
              </span>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-brand-text-secondary font-bold uppercase block mb-1">
                    {language === 'th' ? 'ความกว้าง' : 'Width'}
                  </label>
                  <select
                    value={printerConfig.paperWidth}
                    onChange={(e) => {
                      const width = e.target.value as '80mm' | '58mm';
                      updatePrinterConfig({ paperWidth: width });
                      addToast({
                        title: language === 'th' ? 'เปลี่ยนขนาดกระดาษ' : 'Paper Width Changed',
                        message: `Paper width set to ${width}`,
                        type: 'info',
                      });
                    }}
                    className="w-full min-h-[44px] h-11 px-2 rounded-md border border-border bg-background text-base sm:text-sm font-bold text-text focus:outline-hidden focus:ring-2 focus:ring-cta focus-visible:ring-2 focus-visible:ring-cta"
                  >
                    <option value="80mm">80 mm (Standard)</option>
                    <option value="58mm">58 mm (Compact)</option>
                  </select>
                </div>

                <div>
                  <label className="text-[10px] text-brand-text-secondary font-bold uppercase block mb-1">
                    {language === 'th' ? 'จำนวนพิมพ์' : 'Copies'}
                  </label>
                  <select
                    value={printerConfig.copies || 1}
                    onChange={(e) => {
                      const copies = Number(e.target.value);
                      updatePrinterConfig({ copies });
                      addToast({
                        title: language === 'th' ? 'จำนวนสำเนาใบเสร็จ' : 'Print Copies Updated',
                        message: `Set to ${copies} copies per sale`,
                        type: 'info',
                      });
                    }}
                    className="w-full min-h-[44px] h-11 px-2 rounded-md border border-border bg-background text-base sm:text-sm font-bold text-text focus:outline-hidden focus:ring-2 focus:ring-cta focus-visible:ring-2 focus-visible:ring-cta"
                  >
                    <option value={1}>1 {language === 'th' ? 'ฉบับ' : 'Copy'}</option>
                    <option value={2}>2 {language === 'th' ? 'ฉบับ (ลูกค้า + ร้าน)' : 'Copies (Merchant + Cust)'}</option>
                  </select>
                </div>
              </div>

              <div className="text-[10px] text-brand-text-secondary font-mono pt-1">
                Port: ESC/POS Direct (USB / Raw Socket :9100)
              </div>
            </div>

            {/* Hardware Diagnostic & Quick Action */}
            <div className="p-4 rounded-lg border border-border/80 bg-card/60 space-y-2 flex flex-col justify-between">
              <div>
                <span className="text-xs font-bold text-text/80 uppercase tracking-wide block">
                  {language === 'th' ? 'ทดสอบเครื่องพิมพ์' : 'Hardware Diagnostics'}
                </span>
                <p className="text-[11px] text-brand-text-secondary mt-0.5">
                  {printerConfig.printerName}
                </p>
              </div>

              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleQuickTestPrint}
                isLoading={isPrinting}
                className="w-full min-h-[44px] rounded-md font-bold text-xs"
                leftIcon={<Printer className="h-3.5 w-3.5 text-primary" />}
              >
                {language === 'th' ? 'ส่งคำสั่งพิมพ์ทดสอบ (Test Print)' : 'Send Test Print'}
              </Button>
            </div>
          </div>

          {/* Print Automation Controls: Auto-Print and Quick Print */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Auto Print on Checkout Switch */}
            <div className="p-4 rounded-lg border border-border/80 bg-card/60 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="font-bold text-text text-xs">
                    {language === 'th' ? 'พิมพ์ใบเสร็จอัตโนมัติเมื่อทำรายการ (Auto-Print)' : 'Auto-Print on Checkout'}
                  </div>
                  {printerConfig.autoPrintOnCheckout && (
                    <Badge variant="primary" size="sm" className="text-[10px] font-mono">
                      {language === 'th' ? 'อัตโนมัติ' : 'Auto'}
                    </Badge>
                  )}
                </div>
                <div className="text-[11px] text-text/50 mt-1 leading-relaxed">
                  {language === 'th'
                    ? 'ส่งคำสั่งพิมพ์ไปยังเครื่องพิมพ์ความร้อนทันทีที่กระบวนการชำระเงินเสร็จสิ้นโดยไม่ต้องกดพิมพ์ซ้ำ'
                    : 'Automatically dispatches thermal ESC/POS print job immediately upon transaction confirmation.'}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={printerConfig.autoPrintOnCheckout}
                aria-label={language === 'th' ? 'พิมพ์ใบเสร็จอัตโนมัติเมื่อทำรายการสำเร็จ' : 'Auto-Print on Checkout'}
                onClick={() => {
                  const next = !printerConfig.autoPrintOnCheckout;
                  updatePrinterConfig({ autoPrintOnCheckout: next });
                  addToast({
                    title: language === 'th' ? 'การตั้งค่าการพิมพ์' : 'Printer Preference Updated',
                    message: next
                      ? (language === 'th' ? 'เปิดการพิมพ์อัตโนมัติ' : 'Auto-print enabled')
                      : (language === 'th' ? 'ปิดการพิมพ์อัตโนมัติ' : 'Auto-print disabled'),
                    type: 'info',
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    const next = !printerConfig.autoPrintOnCheckout;
                    updatePrinterConfig({ autoPrintOnCheckout: next });
                  }
                }}
                className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 mt-0.5 ${
                  printerConfig.autoPrintOnCheckout ? 'bg-primary' : 'bg-border dark:bg-background'
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    printerConfig.autoPrintOnCheckout ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Quick Print Toggle (Bypasses Preview Modal for Faster Transactions) */}
            <div className="p-4 rounded-lg border border-border/80 bg-card/60 flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <div className="font-bold text-text text-xs truncate">
                    {language === 'th' ? 'พิมพ์ด่วน (Quick Print)' : 'Quick Print (Direct-to-Printer)'}
                  </div>
                  <Badge
                    variant={printerConfig.quickPrint ? 'success' : 'neutral'}
                    size="sm"
                    className="text-[10px] font-mono shrink-0"
                  >
                    {printerConfig.quickPrint
                      ? language === 'th' ? 'ข้ามหน้าต่าง Preview' : 'Bypasses Preview'
                      : language === 'th' ? 'แสดงตัวอย่าง' : 'Shows Preview'}
                  </Badge>
                </div>
                <div className="text-[11px] text-text/50 mt-1 leading-relaxed">
                  {language === 'th'
                    ? 'ข้ามหน้าต่างแสดงตัวอย่าง (Preview Modal) สำหรับการพิมพ์เพื่อความรวดเร็วในการทำรายการหน้าร้าน ส่งข้อมูลตรงเข้าเครื่องพิมพ์ ESC/POS ทันที'
                    : 'Bypasses the receipt preview modal for faster transactions, enabling direct-to-printer output.'}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={printerConfig.quickPrint}
                aria-label={language === 'th' ? 'พิมพ์ด่วนข้ามหน้าต่างแสดงตัวอย่าง' : 'Quick Print - Bypass Preview Modal'}
                onClick={() => {
                  const next = !printerConfig.quickPrint;
                  updatePrinterConfig({ quickPrint: next });
                  addToast({
                    title: language === 'th' ? 'พิมพ์ด่วน (Quick Print)' : 'Quick Print Setting',
                    message: next
                      ? (language === 'th'
                          ? 'เปิดใช้งานพิมพ์ด่วน: ข้ามหน้าต่างแสดงตัวอย่างและส่งตรงเข้าเครื่องพิมพ์ทันที'
                          : 'Quick Print enabled: Bypasses preview modal for direct-to-printer output.')
                      : (language === 'th'
                          ? 'ปิดใช้งานพิมพ์ด่วน: แสดงหน้าต่างตัวอย่างใบเสร็จก่อนพิมพ์ตามปกติ'
                          : 'Quick Print disabled: Receipt preview modal will be displayed before printing.'),
                    type: next ? 'success' : 'info',
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    const next = !printerConfig.quickPrint;
                    updatePrinterConfig({ quickPrint: next });
                  }
                }}
                className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 mt-0.5 ${
                  printerConfig.quickPrint ? 'bg-amber-500' : 'bg-border dark:bg-background'
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    printerConfig.quickPrint ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Cash Drawer & Electric Kick Interface Card */}
      <Card className="border border-border/80 shadow-sm rounded-lg overflow-hidden">
        <CardHeader className="bg-card/50 border-b border-border/60 py-3.5 px-5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary shrink-0">
              <DollarSign className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-text truncate">
                {language === 'th' ? 'ลิ้นชักเก็บเงินไฟฟ้า (Electronic Cash Drawer)' : 'Electronic Cash Drawer'}
              </h3>
              <p className="text-[11px] text-text/50 truncate">
                {language === 'th'
                  ? 'ควบคุมสัญญาณไฟฟ้ากระตุกเปิดลิ้นชักผ่านพอร์ต RJ11/RJ12 ของเครื่องพิมพ์ความร้อน'
                  : 'Solonoid kick drawer pulse sent through thermal printer RJ11/RJ12 port.'}
              </p>
            </div>
          </div>
          <div className="shrink-0">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleKickDrawer}
              className="min-h-[44px] rounded-md font-bold text-xs"
              leftIcon={<DollarSign className="h-3.5 w-3.5 text-emerald-500" />}
            >
              {language === 'th' ? 'ทดสอบเด้งลิ้นชัก (Kick Drawer)' : 'Test Kick Drawer'}
            </Button>
          </div>
        </CardHeader>

        <CardBody className="p-5 space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg border border-border/80 bg-card/60">
            <div>
              <div className="font-bold text-text text-xs">
                {language === 'th' ? 'เด้งลิ้นชักอัตโนมัติเมื่อรับชำระเงินสด (Auto-Kick on Cash Payment)' : 'Auto-Kick Drawer on Cash Checkout'}
              </div>
              <div className="text-[11px] text-text/50 mt-0.5">
                {language === 'th'
                  ? 'ส่งสัญญาณกระตุกสลักลิ้นชักเมื่อผู้แคชเชียร์กดรับเงินสดเพื่อทอนเงินทันที'
                  : 'Triggers drawer solenoid kick immediately when Cash payment method is finalized.'}
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={printerConfig.autoKickDrawerOnCash}
              aria-label={language === 'th' ? 'เด้งลิ้นชักอัตโนมัติเมื่อรับชำระเงินสด' : 'Auto-Kick Drawer on Cash Checkout'}
              onClick={() => {
                const next = !printerConfig.autoKickDrawerOnCash;
                updatePrinterConfig({ autoKickDrawerOnCash: next });
                addToast({
                  title: language === 'th' ? 'ตั้งค่าลิ้นชักเก็บเงิน' : 'Cash Drawer Setting',
                  message: next
                    ? (language === 'th' ? 'เปิดการเด้งลิ้นชักอัตโนมัติเมื่อรับเงินสด' : 'Auto-kick on cash enabled')
                    : (language === 'th' ? 'ปิดการเด้งลิ้นชักอัตโนมัติ' : 'Auto-kick on cash disabled'),
                  type: 'info',
                });
              }}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  const next = !printerConfig.autoKickDrawerOnCash;
                  updatePrinterConfig({ autoKickDrawerOnCash: next });
                }
              }}
              className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                printerConfig.autoKickDrawerOnCash ? 'bg-primary' : 'bg-border dark:bg-background'
              }`}
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  printerConfig.autoKickDrawerOnCash ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="p-3 rounded-lg border border-border/60 bg-background/50 flex items-center justify-between text-xs text-text/70">
            <span>{language === 'th' ? 'โปรโตคอลการสั่งงาน:' : 'Interface Standard:'} <strong className="text-text font-mono">ESC/POS 27,112,0,25,250 (24V 50ms Pulse)</strong></span>
            <Badge variant="success" size="sm" dot>{language === 'th' ? 'พร้อมทำงาน' : 'Ready'}</Badge>
          </div>
        </CardBody>
      </Card>

      {/* Barcode Scanner & Sound System Card */}
      <Card className="border border-border/80 shadow-sm rounded-lg overflow-hidden">
        <CardHeader className="bg-card/50 border-b border-border/60 py-3.5 px-5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary shrink-0">
              <Barcode className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-text truncate">
                {language === 'th' ? 'เครื่องสแกนบาร์โค้ดและระบบเสียงตอบรับ (Scanner & Sound)' : 'Barcode Scanner & Audio Feedback'}
              </h3>
              <p className="text-[11px] text-text/50 truncate">
                {language === 'th'
                  ? 'กำหนดค่าสำหรับเครื่องสแกนบาร์โค้ด USB/HID Wedge และเสียงตอบรับการสัมผัส'
                  : 'HID Keyboard Wedge barcode scanner integration and sensory sound feedback.'}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardBody className="p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* System Sound Feedback Switch */}
            <div className="p-4 rounded-lg border border-border/80 bg-card/60 flex items-center justify-between">
              <div>
                <div className="font-bold text-text text-xs">
                  {language === 'th' ? 'เสียงตอบรับระบบ (Sound Effects)' : 'System Audio Feedback'}
                </div>
                <div className="text-[11px] text-text/50 mt-0.5">
                  {language === 'th'
                    ? 'เล่นเสียงเมื่อคิดเงินสำเร็จ ข้อผิดพลาด หรือกดปุ่มสัมผัส'
                    : 'Auditory feedback for checkouts, warnings, and touch events.'}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={soundEnabled}
                aria-label={language === 'th' ? 'เสียงตอบรับระบบ' : 'System Audio Feedback'}
                onClick={() => {
                  const next = !soundEnabled;
                  setSoundEnabled(next);
                  addToast({
                    title: language === 'th' ? 'ระบบเสียงตอบรับ' : 'Audio Feedback',
                    message: next
                      ? (language === 'th' ? 'เปิดใช้งานระบบเสียง' : 'Audio enabled')
                      : (language === 'th' ? 'ปิดใช้งานระบบเสียง' : 'Audio disabled'),
                    type: 'info',
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    setSoundEnabled(!soundEnabled);
                  }
                }}
                className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  soundEnabled ? 'bg-primary' : 'bg-border dark:bg-background'
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    soundEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Scanner Beep Switch */}
            <div className="p-4 rounded-lg border border-border/80 bg-card/60 flex items-center justify-between">
              <div>
                <div className="font-bold text-text text-xs">
                  {language === 'th' ? 'เสียงปี๊บเมื่อยิงสแกนเนอร์ (Scanner Beep)' : 'Scanner Beep Confirmation'}
                </div>
                <div className="text-[11px] text-text/50 mt-0.5">
                  {language === 'th'
                    ? 'ส่งเสียงยืนยันทันทีที่จับคู่รหัสบาร์โค้ดสำเร็จ'
                    : 'Plays synthesized high-pitch beep on successful barcode scan.'}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={scannerBeep}
                aria-label={language === 'th' ? 'เสียงปี๊บเมื่อยิงสแกนเนอร์' : 'Scanner Beep Confirmation'}
                onClick={() => {
                  setScannerBeep(!scannerBeep);
                  addToast({
                    title: language === 'th' ? 'เสียงสแกนเนอร์' : 'Scanner Sound',
                    message: !scannerBeep
                      ? (language === 'th' ? 'เปิดเสียงสแกนเนอร์' : 'Scanner beep enabled')
                      : (language === 'th' ? 'ปิดเสียงสแกนเนอร์' : 'Scanner beep disabled'),
                    type: 'info',
                  });
                }}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    setScannerBeep(!scannerBeep);
                  }
                }}
                className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  scannerBeep ? 'bg-primary' : 'bg-border dark:bg-background'
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    scannerBeep ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Test Sound Panel */}
          {soundEnabled && (
            <div className="pt-2 border-t border-border/60 space-y-2.5">
              <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                {language === 'th' ? 'ทดสอบเสียงเอฟเฟกต์ (Audio Tone Previews)' : 'Sound Previews'}
              </label>
              <div className="grid grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => playSuccess()}
                  className="flex flex-col items-center justify-center p-3 rounded-lg border border-border bg-card/60 hover:bg-background transition cursor-pointer text-center group"
                >
                  <Volume2 className="h-4 w-4 text-emerald-500 mb-1 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-bold text-text">
                    {language === 'th' ? 'สำเร็จ (Success)' : 'Success'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => playWarning()}
                  className="flex flex-col items-center justify-center p-3 rounded-lg border border-border bg-card/60 hover:bg-background transition cursor-pointer text-center group"
                >
                  <Volume2 className="h-4 w-4 text-amber-500 mb-1 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-bold text-text">
                    {language === 'th' ? 'เตือน (Warning)' : 'Warning'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => playClick()}
                  className="flex flex-col items-center justify-center p-3 rounded-lg border border-border bg-card/60 hover:bg-background transition cursor-pointer text-center group"
                >
                  <Volume2 className="h-4 w-4 text-sky-500 mb-1 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-bold text-text">
                    {language === 'th' ? 'สัมผัส (Tactile Click)' : 'Tactile Click'}
                  </span>
                </button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Haptic Feedback Service Card (Vibration API) */}
      <Card className="border border-border/80 shadow-sm rounded-lg overflow-hidden">
        <CardHeader className="bg-card/50 border-b border-border/60 py-3.5 px-5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="p-1.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 shrink-0">
              <Vibrate className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-text truncate">
                  {language === 'th'
                    ? 'ระบบสั่นสัมผัสตอบสนอง (Haptic Feedback Service)'
                    : 'Haptic Feedback & Tactile Response'}
                </h3>
                <Badge
                  variant={isHapticSupported ? 'success' : 'neutral'}
                  size="sm"
                  className="font-mono text-[10px]"
                >
                  {isHapticSupported
                    ? language === 'th'
                      ? 'รองรับฮาร์ดแวร์สั่น (Vibration API)'
                      : 'Vibration API Supported'
                    : language === 'th'
                    ? 'อุปกรณ์ไม่รองรับการสั่น (Desktop Emulation)'
                    : 'No Hardware Vibration'}
                </Badge>
              </div>
              <p className="text-[11px] text-text/50 truncate">
                {language === 'th'
                  ? 'ส่งแรงสั่นสัมผัสที่แม่นยำและนุ่มนวล (10–38ms) เมื่อกดปุ่มในหน้า POS แป้นตัวเลข และการคิดเงิน'
                  : 'Delivers subtle tactile pulses (10–38ms) on POS buttons, virtual keypads, and checkout.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={hapticEnabled}
              aria-label={language === 'th' ? 'เปิด/ปิดระบบสั่นสัมผัส' : 'Toggle Haptic Feedback'}
              onClick={() => {
                const nextState = !hapticEnabled;
                setHapticEnabled(nextState);
                if (nextState) {
                  haptic.medium();
                }
                addToast({
                  title: language === 'th' ? 'การสั่นสัมผัส' : 'Haptic Feedback',
                  message: nextState
                    ? language === 'th'
                      ? 'เปิดใช้งานระบบสั่นสัมผัสแล้ว'
                      : 'Haptic tactile feedback enabled.'
                    : language === 'th'
                    ? 'ปิดใช้งานระบบสั่นสัมผัสแล้ว'
                    : 'Haptic tactile feedback disabled.',
                  type: 'info',
                });
              }}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  setHapticEnabled(!hapticEnabled);
                }
              }}
              className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                hapticEnabled ? 'bg-primary' : 'bg-border dark:bg-background'
              }`}
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  hapticEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </CardHeader>

        <CardBody className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Status & Behavior overview */}
            <div className="p-3 rounded-lg border border-border bg-card/60 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-text">
                <span className="flex items-center gap-1.5">
                  <Smartphone className="h-3.5 w-3.5 text-primary" />
                  <span>{language === 'th' ? 'พฤติกรรมการทำงาน' : 'Tactile Interaction Engine'}</span>
                </span>
                {lastTriggered && (
                  <span className="text-[10px] font-mono text-purple-600 dark:text-purple-400 animate-pulse font-semibold">
                    {language === 'th' ? 'สั่นล่าสุด' : 'Triggered'}: {lastTriggered.type}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-text/60 leading-relaxed">
                {language === 'th'
                  ? 'ระบบสั่นถูกออกแบบให้สัมผัสเป็นธรรมชาติ ไม่ก่อให้เกิดความรำคาญ (Anti-fatigue) โดยใช้ระยะเวลาสั้นมาก (12–15ms สำหรับปุ่มทั่วไป และ 35ms สำหรับลิ้นชัก/ปิดการขาย)'
                  : 'Engineered with anti-fatigue tactile micro-pulses (12–15ms for standard button taps, 35ms for drawer kick and final checkout completion).'}
              </p>
            </div>

            {/* Intensity Selector */}
            <div className="p-3 rounded-lg border border-border bg-card/60 space-y-2">
              <label className="block text-xs font-bold text-text">
                {language === 'th' ? 'ระดับความแรงของการสั่น (Intensity)' : 'Haptic Intensity'}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['subtle', 'medium', 'strong'] as const).map((level) => {
                  const isSel = hapticIntensity === level;
                  const labelTh = level === 'subtle' ? 'นุ่มนวล' : level === 'medium' ? 'สมดุล' : 'หนักแน่น';
                  const labelEn = level === 'subtle' ? 'Subtle' : level === 'medium' ? 'Balanced' : 'Firm';
                  const msLabel = level === 'subtle' ? '0.7x' : level === 'medium' ? '1.0x' : '1.4x';

                  return (
                    <button
                      key={level}
                      type="button"
                      disabled={!hapticEnabled}
                      onClick={() => {
                        setHapticIntensity(level);
                        haptic.medium();
                      }}
                      className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                        !hapticEnabled
                          ? 'opacity-40 cursor-not-allowed border-border'
                          : isSel
                          ? 'border-primary bg-primary/10 text-primary font-bold shadow-2xs'
                          : 'border-border bg-card text-text/70 hover:text-text hover:bg-background'
                      }`}
                    >
                      <div className="text-xs font-bold capitalize">
                        {language === 'th' ? labelTh : labelEn}
                      </div>
                      <div className="text-[10px] text-text/50 font-mono mt-0.5">{msLabel}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Test Haptic Patterns */}
          {hapticEnabled && (
            <div className="pt-2 border-t border-border/60 space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                  {language === 'th' ? 'ทดสอบสัมผัสแรงสั่น (Haptic Pattern Previews)' : 'Haptic Pattern Previews'}
                </label>
                <span className="text-[10px] text-text/40 font-mono">
                  {isHapticSupported ? 'Hardware Active' : 'Desktop Emulation (Click to feel/see)'}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    haptic.tap();
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-lg border border-border bg-card/60 hover:bg-background hover:border-primary/50 transition cursor-pointer text-center group active:scale-95 shadow-2xs"
                >
                  <Vibrate className="h-4 w-4 text-sky-500 mb-1 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-bold text-text">
                    {language === 'th' ? 'แตะปุ่ม' : 'Button Tap'}
                  </span>
                  <span className="text-[9px] font-mono text-text/40 mt-0.5">12ms</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    haptic.numpad();
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-lg border border-border bg-card/60 hover:bg-background hover:border-primary/50 transition cursor-pointer text-center group active:scale-95 shadow-2xs"
                >
                  <Vibrate className="h-4 w-4 text-brand-text-accent mb-1 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-bold text-text">
                    {language === 'th' ? 'แป้นพิมพ์ตัวเลข' : 'Numpad Tick'}
                  </span>
                  <span className="text-[9px] font-mono text-text/40 mt-0.5">14ms</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    haptic.success();
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-lg border border-border bg-card/60 hover:bg-background hover:border-primary/50 transition cursor-pointer text-center group active:scale-95 shadow-2xs"
                >
                  <Vibrate className="h-4 w-4 text-emerald-500 mb-1 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-bold text-text">
                    {language === 'th' ? 'สแกนสินค้า' : 'Item Scan'}
                  </span>
                  <span className="text-[9px] font-mono text-text/40 mt-0.5">[15,45,20]ms</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    haptic.paymentSuccess();
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-lg border border-border bg-card/60 hover:bg-background hover:border-primary/50 transition cursor-pointer text-center group active:scale-95 shadow-2xs"
                >
                  <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mb-1 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-bold text-text">
                    {language === 'th' ? 'ชำระเงินสำเร็จ' : 'Checkout'}
                  </span>
                  <span className="text-[9px] font-mono text-text/40 mt-0.5">Fanfare</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    haptic.cashDrawer();
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-lg border border-border bg-card/60 hover:bg-background hover:border-primary/50 transition cursor-pointer text-center group active:scale-95 shadow-2xs"
                >
                  <Vibrate className="h-4 w-4 text-amber-500 mb-1 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-bold text-text">
                    {language === 'th' ? 'เตะลิ้นชัก' : 'Drawer Kick'}
                  </span>
                  <span className="text-[9px] font-mono text-text/40 mt-0.5">35ms</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    haptic.warning();
                  }}
                  className="flex flex-col items-center justify-center p-2.5 rounded-lg border border-border bg-card/60 hover:bg-background hover:border-primary/50 transition cursor-pointer text-center group active:scale-95 shadow-2xs"
                >
                  <Vibrate className="h-4 w-4 text-rose-500 mb-1 group-hover:scale-110 transition-transform" />
                  <span className="text-xs font-bold text-text">
                    {language === 'th' ? 'แจ้งเตือนผิดพลาด' : 'Alert Buzz'}
                  </span>
                  <span className="text-[9px] font-mono text-text/40 mt-0.5">[25,45,25]ms</span>
                </button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <KeyboardFocusToggle />

      {/* Template Editor Modal */}
      {isTemplateEditorOpen && (
        <ReceiptTemplateEditorModal
          isOpen={isTemplateEditorOpen}
          onClose={() => setIsTemplateEditorOpen(false)}
        />
      )}

      {/* Test Print Preview Modal */}
      {isTestPrintModalOpen && (
        <ReceiptPrintModal
          isOpen={isTestPrintModalOpen}
          onClose={() => setIsTestPrintModalOpen(false)}
          order={sampleOrder}
          onCustomizeTemplate={() => {
            setIsTestPrintModalOpen(false);
            setIsTemplateEditorOpen(true);
          }}
        />
      )}
    </div>
  );
};
