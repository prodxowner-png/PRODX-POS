import React from 'react';
import {
  Receipt,
  Percent,
  CreditCard,
  Banknote,
  QrCode,
  Layers,
  FileCheck2,
  DollarSign,
  Building,
  RotateCcw,
} from 'lucide-react';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';
import { useLanguage } from '../../../context/LanguageContext';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';
import { useCart } from '../../../context/CartContext';
import { TaxAccountingFormState } from '../types';
import { SUPPORTED_CURRENCIES } from '../../../services/currency/currencyService';

export interface TaxAccountingSettingsTabProps {
  formData: TaxAccountingFormState;
  onChangeField: <K extends keyof TaxAccountingFormState>(
    field: K,
    value: TaxAccountingFormState[K]
  ) => void;
}

export const TaxAccountingSettingsTab: React.FC<TaxAccountingSettingsTabProps> = ({
  formData,
  onChangeField,
}) => {
  const { language } = useLanguage();
  const { session } = useAuth();
  const { addToast } = useToast();
  const {
    exchangeRates,
    activeSecondaryCurrency,
    setActiveSecondaryCurrency,
    setExchangeRate,
  } = useCart();

  if (!session) return null;

  return (
    <div className="space-y-6">
      {/* VAT & Tax Calculation Policy Card */}
      <Card className="border border-border/80 shadow-sm rounded-lg overflow-hidden">
        <CardHeader className="bg-card/50 border-b border-border/60 py-3.5 px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary shrink-0">
              <Percent className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-text">
                {language === 'th' ? 'ภาษีมูลค่าเพิ่มและข้อกำหนดทางภาษี (VAT & Taxation)' : 'VAT & Tax Configuration'}
              </h3>
              <p className="text-[11px] text-brand-text-secondary">
                {language === 'th'
                  ? 'กำหนดอัตราภาษีฐาน (Basis Points) และประเภทการคำนวณภาษีในใบเสร็จ'
                  : 'VAT basis point precision, tax calculation modes, and fiscal registration data.'}
              </p>
            </div>
          </div>
          <Badge variant="primary" size="sm" className="font-mono shrink-0 self-start sm:self-auto">
            {(formData.defaultTaxRateBps / 100).toFixed(2)}% VAT
          </Badge>
        </CardHeader>

        <CardBody className="p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Default VAT Rate (Basis Points) */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                {language === 'th' ? 'อัตราภาษีมูลค่าเพิ่มเริ่มต้น (VAT Rate)' : 'Default Tax Rate (VAT)'}
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    max="100"
                    value={(formData.defaultTaxRateBps / 100).toFixed(2)}
                    onChange={(e) => {
                      const pct = parseFloat(e.target.value);
                      if (!isNaN(pct) && pct >= 0) {
                        onChangeField('defaultTaxRateBps', Math.round(pct * 100));
                      }
                    }}
                    className="w-full min-h-[44px] h-11 px-3 pr-8 rounded-md border border-border bg-background text-base sm:text-sm font-mono tabular-nums font-bold text-text focus:outline-hidden focus:ring-2 focus:ring-cta focus-visible:ring-2 focus-visible:ring-cta transition"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-brand-text-secondary">
                    %
                  </span>
                </div>
                <div className="flex gap-1">
                  {[0, 7, 10].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => onChangeField('defaultTaxRateBps', rate * 100)}
                      className={`min-h-[44px] px-3 rounded-md border text-xs font-mono tabular-nums font-bold cursor-pointer transition focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta ${
                        formData.defaultTaxRateBps === rate * 100
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card hover:bg-background text-brand-text-secondary'
                      }`}
                    >
                      {rate}%
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-brand-text-secondary font-mono tabular-nums">
                Integer Invariant: {formData.defaultTaxRateBps} bps (Basis Points)
              </p>
            </div>

            {/* Tax Calculation Mode (Inclusive vs Exclusive) */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                {language === 'th' ? 'ประเภทการแสดงราคา (Tax Mode)' : 'Tax Calculation Mode'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onChangeField('taxCalculationType', 'inclusive')}
                  className={`min-h-[44px] p-2.5 rounded-md border flex flex-col items-start gap-1 cursor-pointer transition focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta ${
                    formData.taxCalculationType === 'inclusive'
                      ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
                      : 'border-border bg-card text-text/80 hover:bg-background'
                  }`}
                >
                  <span className="text-xs font-bold">
                    {language === 'th' ? 'ราคารวมภาษีแล้ว' : 'Tax Inclusive'}
                  </span>
                  <span className="text-[10px] text-brand-text-secondary">
                    {language === 'th' ? 'VAT Included' : 'Gross Pricing'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onChangeField('taxCalculationType', 'exclusive')}
                  className={`min-h-[44px] p-2.5 rounded-md border flex flex-col items-start gap-1 cursor-pointer transition focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta ${
                    formData.taxCalculationType === 'exclusive'
                      ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
                      : 'border-border bg-card text-text/80 hover:bg-background'
                  }`}
                >
                  <span className="text-xs font-bold">
                    {language === 'th' ? 'ราคาแยกภาษี' : 'Tax Exclusive'}
                  </span>
                  <span className="text-[10px] text-brand-text-secondary">
                    {language === 'th' ? 'Add VAT on Top' : 'Net + Tax'}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Fiscal Identifiers for Full Tax Invoice */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-border/60">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide flex items-center gap-1.5">
                <Building className="h-3.5 w-3.5 text-primary" />
                <span>{language === 'th' ? 'เลขประจำตัวผู้เสียภาษี (Tax ID / TIN)' : 'Tax Identification Number (TIN)'}</span>
              </label>
              <input
                type="text"
                value={formData.taxId}
                onChange={(e) => onChangeField('taxId', e.target.value)}
                placeholder="e.g. 0105559012345"
                className="w-full min-h-[44px] h-11 px-3 rounded-md border border-border bg-background text-base sm:text-sm font-mono font-bold text-text focus:outline-hidden focus:ring-2 focus:ring-cta focus-visible:ring-2 focus-visible:ring-cta transition"
              />
              <p className="text-[11px] text-brand-text-secondary">
                {language === 'th'
                  ? 'เลข 13 หลักสำหรับออกใบกำกับภาษีอย่างย่อและเต็มรูปตามเกณฑ์สรรพากร'
                  : '13-digit official corporate registration number for fiscal tax invoices.'}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide flex items-center gap-1.5">
                <FileCheck2 className="h-3.5 w-3.5 text-primary" />
                <span>{language === 'th' ? 'รหัสเครื่องบันทึกการเก็บเงิน (POS Machine ID)' : 'Fiscal POS Terminal ID'}</span>
              </label>
              <input
                type="text"
                value={formData.posMachineId}
                onChange={(e) => onChangeField('posMachineId', e.target.value)}
                placeholder="e.g. REG-BKK-001"
                className="w-full min-h-[44px] h-11 px-3 rounded-md border border-border bg-background text-base sm:text-sm font-mono font-bold text-text focus:outline-hidden focus:ring-2 focus:ring-cta focus-visible:ring-2 focus-visible:ring-cta transition"
              />
              <p className="text-[11px] text-brand-text-secondary">
                {language === 'th'
                  ? 'รหัสระบุเครื่องที่ได้รับอนุญาตในการพิมพ์หัวใบกำกับภาษี'
                  : 'Authorized fiscal hardware serial code.'}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Payment Methods Acceptance Card */}
      <Card className="border border-border/80 shadow-sm rounded-lg overflow-hidden">
        <CardHeader className="bg-card/50 border-b border-border/60 py-3.5 px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary shrink-0">
              <CreditCard className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-text">
                {language === 'th' ? 'ช่องทางการรับชำระเงิน (Accepted Payment Methods)' : 'Payment Methods Configuration'}
              </h3>
              <p className="text-[11px] text-text/50">
                {language === 'th'
                  ? 'เปิด/ปิดช่องทางชำระเงินที่ต้องการให้แคชเชียร์เลือกใช้งานในขั้นตอนคิดเงิน'
                  : 'Toggle active payment rails enabled on the cashier checkout dialog.'}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardBody className="p-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Cash */}
            <div className="p-3.5 rounded-lg border border-border/80 bg-card/60 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-500 shrink-0">
                  <Banknote className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-text">
                    {language === 'th' ? 'เงินสด (Cash Payment)' : 'Cash Payment'}
                  </div>
                  <div className="text-[10px] text-text/50">
                    {language === 'th' ? 'คำนวณเงินทอนและจัดการกะลิ้นชัก' : 'Cash drawer and change calculator'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={formData.enableCash}
                aria-label={language === 'th' ? 'เปิดรับชำระเงินสด' : 'Enable Cash Payment'}
                onClick={() => onChangeField('enableCash', !formData.enableCash)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    onChangeField('enableCash', !formData.enableCash);
                  }
                }}
                className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  formData.enableCash ? 'bg-primary' : 'bg-border dark:bg-background'
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    formData.enableCash ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Credit / Debit Card */}
            <div className="p-3.5 rounded-lg border border-border/80 bg-card/60 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="p-2 rounded-md bg-blue-500/10 text-blue-500 shrink-0">
                  <CreditCard className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-text">
                    {language === 'th' ? 'บัตรเครดิต/เดบิต (Card / EDC)' : 'Credit / Debit Card'}
                  </div>
                  <div className="text-[10px] text-text/50">
                    {language === 'th' ? 'เครื่องรูดบัตร EDC Terminal' : 'Smart POS EDC terminal integration'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={formData.enableCard}
                aria-label={language === 'th' ? 'เปิดรับชำระบัตรเครดิต/เดบิต' : 'Enable Credit / Debit Card'}
                onClick={() => onChangeField('enableCard', !formData.enableCard)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    onChangeField('enableCard', !formData.enableCard);
                  }
                }}
                className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  formData.enableCard ? 'bg-primary' : 'bg-border dark:bg-background'
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    formData.enableCard ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* PromptPay QR */}
            <div className="p-3.5 rounded-lg border border-border/80 bg-card/60 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="p-2 rounded-md bg-sky-500/10 text-sky-500 shrink-0">
                  <QrCode className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-text">
                    {language === 'th' ? 'พร้อมเพย์ QR (PromptPay QR)' : 'PromptPay QR Payment'}
                  </div>
                  <div className="text-[10px] text-text/50">
                    {language === 'th' ? 'สร้าง EMVCo Dynamic QR อัตโนมัติ' : 'Dynamic EMVCo QR code generator'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={formData.enablePromptPay}
                aria-label={language === 'th' ? 'เปิดรับชำระพร้อมเพย์ QR' : 'Enable PromptPay QR'}
                onClick={() => onChangeField('enablePromptPay', !formData.enablePromptPay)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    onChangeField('enablePromptPay', !formData.enablePromptPay);
                  }
                }}
                className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  formData.enablePromptPay ? 'bg-primary' : 'bg-border dark:bg-background'
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    formData.enablePromptPay ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Split Payment */}
            <div className="p-3.5 rounded-lg border border-border/80 bg-card/60 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="p-2 rounded-md bg-purple-500/10 text-purple-500 shrink-0">
                  <Layers className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-text">
                    {language === 'th' ? 'แบ่งชำระหลายช่องทาง (Split Payment)' : 'Multi-Tender / Split Payment'}
                  </div>
                  <div className="text-[10px] text-text/50">
                    {language === 'th' ? 'รองรับชำระเงินสดร่วมกับบัตรหรือ QR' : 'Combine cash, card, and QR in 1 bill'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={formData.enableSplitPayment}
                aria-label={language === 'th' ? 'เปิดรับการแบ่งชำระหลายช่องทาง' : 'Enable Multi-Tender Split Payment'}
                onClick={() => onChangeField('enableSplitPayment', !formData.enableSplitPayment)}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    onChangeField('enableSplitPayment', !formData.enableSplitPayment);
                  }
                }}
                className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                  formData.enableSplitPayment ? 'bg-primary' : 'bg-border dark:bg-background'
                }`}
              >
                <div
                  className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                    formData.enableSplitPayment ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Multi-Currency Exchange Rates Table */}
      <Card className="border border-border/80 shadow-sm rounded-lg overflow-hidden">
        <CardHeader className="bg-card/50 border-b border-border/60 py-3.5 px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary shrink-0">
              <DollarSign className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-text">
                {language === 'th' ? 'อัตราแลกเปลี่ยนหลายสกุลเงิน (Multi-Currency Rates)' : 'Multi-Currency Exchange Rates'}
              </h3>
              <p className="text-[11px] text-text/50">
                {language === 'th'
                  ? `อัตราแปลงมูลค่าเทียบกับ 1 ${session.currentStore.currency || 'THB'} เพื่อแสดงราคาสุทธิเสริม`
                  : `Conversion rates relative to 1 ${session.currentStore.currency || 'THB'} for secondary currency estimation.`}
              </p>
            </div>
          </div>
          <div className="shrink-0 w-full sm:w-auto">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setExchangeRate('THB', 1.0);
                setExchangeRate('USD', 0.029);
                setExchangeRate('EUR', 0.026);
                setExchangeRate('JPY', 4.35);
                setExchangeRate('GBP', 0.023);
                setExchangeRate('AUD', 0.044);
                addToast({
                  title: language === 'th' ? 'รีเซ็ตอัตราแลกเปลี่ยน' : 'Exchange Rates Reset',
                  message: language === 'th' ? 'คืนค่าอัตราแลกเปลี่ยนมาตรฐานสากลแล้ว' : 'Restored default exchange rates.',
                  type: 'info',
                });
              }}
              className="w-full sm:w-auto rounded-md font-bold text-xs"
              leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            >
              {language === 'th' ? 'รีเซ็ตค่ามาตรฐาน' : 'Reset Defaults'}
            </Button>
          </div>
        </CardHeader>

        <CardBody className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {SUPPORTED_CURRENCIES.map((cur) => {
              const isBase = (session.currentStore.currency || 'THB') === cur.code;
              const rate = exchangeRates[cur.code] || 1.0;
              const isActiveSecondary = activeSecondaryCurrency === cur.code;

              return (
                <div
                  key={cur.code}
                  className={`p-3.5 rounded-lg border transition ${
                    isActiveSecondary
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'border-border/80 bg-card/60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{cur.flag}</span>
                      <span className="text-xs font-bold text-text">{cur.code} ({cur.symbol})</span>
                    </div>
                    {isBase ? (
                      <Badge variant="success" size="sm">BASE</Badge>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setActiveSecondaryCurrency(cur.code);
                          addToast({
                            title: language === 'th' ? 'เลือกสกุลเงินเสริมแล้ว' : 'Secondary Active',
                            message: `Active secondary display currency: ${cur.code}`,
                            type: 'info',
                          });
                        }}
                        className={`min-h-[36px] sm:min-h-[40px] px-3 text-xs font-bold rounded-md cursor-pointer transition focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta ${
                          isActiveSecondary
                            ? 'bg-primary text-primary-foreground'
                            : 'border border-border text-text/80 hover:bg-background'
                        }`}
                      >
                        {isActiveSecondary ? 'ACTIVE' : 'USE'}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-brand-text-secondary font-mono tabular-nums shrink-0">
                      1 {session.currentStore.currency || 'THB'} =
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.0001"
                      disabled={isBase}
                      value={isBase ? 1.0 : rate}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (!isNaN(val) && val >= 0) {
                          setExchangeRate(cur.code, val);
                        }
                      }}
                      className="w-full min-h-[44px] h-11 px-3 rounded-md border border-border bg-background text-base sm:text-sm font-mono tabular-nums font-bold text-text focus:outline-hidden focus:ring-2 focus:ring-cta focus-visible:ring-2 focus-visible:ring-cta transition disabled:opacity-50"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>
    </div>
  );
};
