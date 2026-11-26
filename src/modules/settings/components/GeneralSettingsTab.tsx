import React from 'react';
import { Store, Globe, MapPin, Phone, Clock, FileText, Check, DollarSign, Building2, Printer, CreditCard } from 'lucide-react';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Badge } from '../../../components/common/Badge';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { LanguageSwitcher } from '../../../components/common/LanguageSwitcher';
import { SUPPORTED_CURRENCIES, CurrencyService } from '../../../services/currency/currencyService';
import { StoreProfileFormState } from '../types';
import { PWAInstallCard } from '../../../components/pwa/PWAInstallCard';

export interface GeneralSettingsTabProps {
  formData: StoreProfileFormState;
  onChangeField: <K extends keyof StoreProfileFormState>(field: K, value: StoreProfileFormState[K]) => void;
}

export const GeneralSettingsTab: React.FC<GeneralSettingsTabProps> = ({
  formData,
  onChangeField,
}) => {
  const { language, t } = useLanguage();
  const { session, switchCurrency } = useAuth();
  const { addToast } = useToast();

  if (!session) return null;

  return (
    <div className="space-y-6">
      {/* PWA Prompt to Install Card */}
      <PWAInstallCard />

      {/* Store Identity & Profile Card with Live Receipt Mockup */}
      <Card className="border border-border/80 shadow-sm rounded-lg overflow-hidden">
        <CardHeader className="bg-card/50 border-b border-border/60 py-3.5 px-5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary shrink-0">
              <Building2 className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-text truncate">
                {language === 'th' ? 'ข้อมูลสาขาและโปรไฟล์ร้านค้า (Store Profile & Identity)' : 'Store Profile & Identity'}
              </h3>
              <p className="text-[11px] text-brand-text-secondary truncate">
                {language === 'th' ? 'ข้อมูลที่แสดงในเอกสารขาย หัวใบเสร็จ และระบบบัญชี' : 'Business identity printed on thermal receipts and export documents.'}
              </p>
            </div>
          </div>
          <Badge variant="primary" size="sm" className="font-mono shrink-0">
            {formData.storeCode || session.currentStore.code}
          </Badge>
        </CardHeader>

        <CardBody className="p-5">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* Form Inputs (7 Cols) */}
            <div className="xl:col-span-7 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Store Name */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                    {language === 'th' ? 'ชื่อร้านค้า / แบรนด์ (Store Name)' : 'Store Name'} <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={formData.storeName}
                      onChange={(e) => onChangeField('storeName', e.target.value)}
                      placeholder="e.g. PRODX Flagship CentralWorld"
                      className="w-full min-h-[44px] h-11 px-3.5 rounded-xl border border-brand-border-strong bg-background text-base sm:text-sm font-semibold text-text focus:outline-hidden focus-visible:ring-2 focus-visible:ring-cta transition shadow-2xs"
                      required
                    />
                  </div>
                </div>

                {/* Store Code */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                    {language === 'th' ? 'รหัสสาขา (Store / Branch Code)' : 'Store / Branch Code'} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.storeCode}
                    onChange={(e) => onChangeField('storeCode', e.target.value)}
                    placeholder="e.g. BKK-01"
                    className="w-full min-h-[44px] h-11 px-3.5 rounded-xl border border-brand-border-strong bg-background text-base sm:text-sm font-mono font-semibold text-text focus:outline-hidden focus-visible:ring-2 focus-visible:ring-cta transition shadow-2xs"
                    required
                  />
                </div>

                {/* Branch Name / Sub-label */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                    {language === 'th' ? 'ชื่อสาขาย่อย (Branch Name)' : 'Branch Name'}
                  </label>
                  <input
                    type="text"
                    value={formData.branchName}
                    onChange={(e) => onChangeField('branchName', e.target.value)}
                    placeholder="e.g. สาขาเซ็นทรัลเวิลด์ ชั้น 4"
                    className="w-full min-h-[44px] h-11 px-3.5 rounded-xl border border-brand-border-strong bg-background text-base sm:text-sm font-semibold text-text focus:outline-hidden focus-visible:ring-2 focus-visible:ring-cta transition shadow-2xs"
                  />
                </div>

                {/* Phone */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                    {language === 'th' ? 'เบอร์โทรศัพท์สาขา (Phone)' : 'Contact Phone'}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={formData.storePhone}
                      onChange={(e) => onChangeField('storePhone', e.target.value)}
                      placeholder="e.g. 02-123-4567, 089-999-8888"
                      className="w-full min-h-[44px] h-11 px-3.5 rounded-xl border border-brand-border-strong bg-background text-base sm:text-sm font-semibold text-text focus:outline-hidden focus-visible:ring-2 focus-visible:ring-cta transition shadow-2xs"
                    />
                  </div>
                </div>
              </div>

              {/* Tax ID */}
              <div className="space-y-1.5 pt-2 border-t border-border/60">
                <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                  {language === 'th' ? 'เลขประจำตัวผู้เสียภาษี (Tax Identification Number)' : 'Tax Identification Number'}
                </label>
                <input
                  type="text"
                  value={formData.taxId}
                  onChange={(e) => onChangeField('taxId', e.target.value)}
                  placeholder="e.g. 0105559012345"
                  className="w-full min-h-[44px] h-11 px-3.5 rounded-xl border border-brand-border-strong bg-background text-base sm:text-sm font-mono font-semibold text-text focus:outline-hidden focus-visible:ring-2 focus-visible:ring-cta transition shadow-2xs"
                />
              </div>

              {/* Store Address for Receipts */}
              <div className="space-y-1.5 pt-2 border-t border-border/60">
                <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                  {language === 'th' ? 'ที่อยู่สาขาสำหรับพิมพ์หัวใบเสร็จ (Receipt Header Address)' : 'Store Address (Printed on Receipts)'}
                </label>
                <textarea
                  rows={2}
                  value={formData.storeAddress}
                  onChange={(e) => onChangeField('storeAddress', e.target.value)}
                  placeholder="e.g. 999/9 ถนนพระราม 1 แขวงปทุมวัน เขตปทุมวัน กรุงเทพฯ 10330"
                  className="w-full p-3 rounded-xl border border-brand-border-strong bg-background text-base sm:text-sm text-text focus:outline-hidden focus-visible:ring-2 focus-visible:ring-cta transition resize-none shadow-2xs"
                />
              </div>

              {/* Receipt Custom Messages */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                    {language === 'th' ? 'ข้อความต้อนรับหัวบิล (Header Note)' : 'Header Welcome Note'}
                  </label>
                  <input
                    type="text"
                    value={formData.receiptHeaderMsg}
                    onChange={(e) => onChangeField('receiptHeaderMsg', e.target.value)}
                    placeholder="e.g. ยินดีต้อนรับสู่ PRODX Flagship"
                    className="w-full min-h-[44px] h-11 px-3.5 rounded-xl border border-brand-border-strong bg-background text-base sm:text-sm text-text focus:outline-hidden focus-visible:ring-2 focus-visible:ring-cta transition shadow-2xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                    {language === 'th' ? 'ข้อความขอบคุณท้ายบิล (Footer Note)' : 'Footer Thank You Note'}
                  </label>
                  <input
                    type="text"
                    value={formData.receiptFooterMsg}
                    onChange={(e) => onChangeField('receiptFooterMsg', e.target.value)}
                    placeholder="e.g. ขอบคุณที่ใช้บริการ / สินค้าซื้อแล้วไม่รับเปลี่ยนคืน"
                    className="w-full min-h-[44px] h-11 px-3.5 rounded-xl border border-brand-border-strong bg-background text-base sm:text-sm text-text focus:outline-hidden focus-visible:ring-2 focus-visible:ring-cta transition shadow-2xs"
                  />
                </div>
              </div>
            </div>

            {/* Live Thermal Receipt Mockup Preview (5 Cols) */}
            <div className="xl:col-span-5 bg-slate-900/5 dark:bg-black/30 p-4 rounded-2xl border border-border/80 flex flex-col items-center space-y-3">
              <div className="w-full flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5 text-xs font-bold text-text/80 uppercase tracking-wider">
                  <Printer className="w-4 h-4 text-primary" />
                  <span>{language === 'th' ? 'ตัวอย่างใบเสร็จจริง (Live Receipt Preview)' : 'Live Receipt Preview'}</span>
                </div>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  REAL-TIME
                </span>
              </div>

              {/* Thermal Paper Container */}
              <div className="w-full max-w-[320px] bg-white text-slate-900 p-5 rounded-sm shadow-xl font-mono text-[11px] leading-snug space-y-3 border-t-4 border-primary border-b-2 border-dashed border-slate-300">
                {/* Store Header */}
                <div className="text-center space-y-1 pb-3 border-b border-dashed border-slate-300">
                  <div className="text-sm font-black uppercase tracking-wider text-slate-900">
                    {formData.storeName || 'PRODX POS STORE'}
                  </div>
                  {formData.branchName && (
                    <div className="text-[10px] font-bold text-slate-600">
                      {formData.branchName} ({formData.storeCode || 'BKK-01'})
                    </div>
                  )}
                  {formData.storeAddress && (
                    <div className="text-[9px] text-slate-600 px-2 line-clamp-2">
                      {formData.storeAddress}
                    </div>
                  )}
                  <div className="text-[9px] text-slate-500 flex items-center justify-center gap-2 pt-0.5">
                    {formData.storePhone && <span>Tel: {formData.storePhone}</span>}
                    {formData.taxId && <span>TAX ID: {formData.taxId}</span>}
                  </div>
                  {formData.receiptHeaderMsg && (
                    <div className="text-[10px] font-bold text-primary pt-1 border-t border-slate-100">
                      *** {formData.receiptHeaderMsg} ***
                    </div>
                  )}
                </div>

                {/* Sample Items Table */}
                <div className="space-y-1.5 text-[10px] py-1 border-b border-dashed border-slate-300">
                  <div className="flex justify-between font-bold text-slate-500 border-b border-slate-200 pb-1">
                    <span>ITEM</span>
                    <span>QTY x PRICE</span>
                    <span>AMT</span>
                  </div>
                  <div className="flex justify-between">
                    <span>1. Iced Matcha Latte (L)</span>
                    <span>1 x 120.00</span>
                    <span className="font-bold">120.00</span>
                  </div>
                  <div className="flex justify-between">
                    <span>2. Butter Croissant</span>
                    <span>2 x 85.00</span>
                    <span className="font-bold">170.00</span>
                  </div>
                </div>

                {/* Totals */}
                <div className="space-y-1 text-[10px] pt-1">
                  <div className="flex justify-between text-slate-600">
                    <span>SUBTOTAL:</span>
                    <span>290.00</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>VAT 7% (INCLUDED):</span>
                    <span>18.97</span>
                  </div>
                  <div className="flex justify-between text-xs font-black text-slate-900 pt-1 border-t border-slate-800">
                    <span>TOTAL THB:</span>
                    <span className="text-sm">290.00</span>
                  </div>
                </div>

                {/* Footer Note */}
                <div className="text-center pt-3 border-t border-dashed border-slate-300 space-y-1">
                  <p className="text-[9px] text-slate-600 font-bold">
                    {formData.receiptFooterMsg || 'ขอบคุณที่ใช้บริการ / THANK YOU'}
                  </p>
                  <div className="text-[8px] text-slate-400 font-mono pt-1">
                    Receipt #INV-20260908-0042 • Cashier: Admin
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* 1. System Language Settings Card (2-Column x 2-Row Grid) */}
      <Card className="border border-border/80 shadow-sm rounded-lg overflow-hidden">
        <CardHeader className="bg-card/50 border-b border-border/60 py-3.5 px-5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary shrink-0">
              <Globe className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-text truncate">
                {language === 'th' ? 'การตั้งค่าภาษาระบบ (System Interface Language)' : 'System Interface Language'}
              </h3>
              <p className="text-[11px] text-brand-text-secondary truncate">
                {language === 'th' ? 'เลือกภาษาหลักสำหรับการแสดงผลส่วนติดต่อผู้ใช้ (UI) เมนู ปุ่มคำสั่ง และรายงานทั้งระบบ' : 'Select system-wide interface language for POS screens, menus, and real-time reports.'}
              </p>
            </div>
            <Badge size="sm" className="font-mono text-[10px] shrink-0 uppercase">
              {language} Active
            </Badge>
          </div>
        </CardHeader>

        <CardBody className="p-5 space-y-4">
          <LanguageSwitcher />
        </CardBody>
      </Card>

      {/* 2. Regional Language & Locale Display Card (2-Column x 2-Row Grid) */}
      <Card className="border border-border/80 shadow-sm rounded-lg overflow-hidden">
        <CardHeader className="bg-card/50 border-b border-border/60 py-3.5 px-5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary shrink-0">
              <MapPin className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-text truncate">
                {language === 'th' ? 'การแสดงผลภาษาส่วนภูมิภาค (Regional Language & Locale Display)' : 'Regional Language & Locale Display'}
              </h3>
              <p className="text-[11px] text-brand-text-secondary truncate">
                {language === 'th' ? 'การแสดงผลรหัสภูมิภาค รูปแบบวันที่ สกุลเงินท้องถิ่น และตัวเลขแยกตามประเทศ' : 'Regional format alignment for local date, currency symbols, and country codes.'}
              </p>
            </div>
            <Badge variant="neutral" size="sm" className="font-mono text-[10px] shrink-0">
              2x2 Grid
            </Badge>
          </div>
        </CardHeader>

        <CardBody className="p-5 space-y-5">
          {/* 2-Column x 2-Row Regional Format Cards */}
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3.5">
            {[
              {
                code: 'th-TH',
                langCode: 'th',
                flag: '🇹🇭',
                title: 'ภาษาไทย (ประเทศไทย)',
                titleEn: 'Thai (Thailand)',
                dateFormat: 'DD/MM/YYYY (25/10/2026)',
                numberFormat: '฿1,234,567.89',
                currency: 'THB (฿)',
                timezone: 'Asia/Bangkok (UTC+07:00)',
                badge: 'th-TH',
              },
              {
                code: 'en-US',
                langCode: 'en',
                flag: '🇺🇸',
                title: 'English (United States / Global)',
                titleEn: 'English (US / Global)',
                dateFormat: 'MM/DD/YYYY (10/25/2026)',
                numberFormat: '$1,234,567.89',
                currency: 'USD ($)',
                timezone: 'UTC / Global Standard',
                badge: 'en-US',
              },
              {
                code: 'zh-CN',
                langCode: 'zh',
                flag: '🇨🇳',
                title: '简体中文 (中国 / 亚洲)',
                titleEn: 'Chinese Simplified (China / Asia)',
                dateFormat: 'YYYY-MM-DD (2026-10-25)',
                numberFormat: '¥1,234,567.89',
                currency: 'CNY (¥)',
                timezone: 'Asia/Shanghai (UTC+08:00)',
                badge: 'zh-CN',
              },
              {
                code: 'ja-JP',
                langCode: 'ja',
                flag: '🇯🇵',
                title: '日本語 (日本)',
                titleEn: 'Japanese (Japan)',
                dateFormat: 'YYYY/MM/DD (2026/10/25)',
                numberFormat: '¥1,234,567',
                currency: 'JPY (¥)',
                timezone: 'Asia/Tokyo (UTC+09:00)',
                badge: 'ja-JP',
              },
            ].map((reg) => {
              const isSelected = language === reg.langCode;
              return (
                <div
                  key={reg.code}
                  onClick={() => {
                    if (language !== reg.langCode) {
                      addToast({
                        title: language === 'th' ? 'ปรับใช้รูปแบบภูมิภาคแล้ว' : 'Regional Locale Selected',
                        message: `Set locale formatting to ${reg.titleEn} (${reg.code})`,
                        type: 'success',
                      });
                    }
                  }}
                  className={`p-3 sm:p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-2.5 group relative ${
                    isSelected
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20 shadow-xs'
                      : 'border-border bg-card hover:bg-background/80 hover:border-text/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0">
                      <span className="text-xl sm:text-2xl leading-none shrink-0">{reg.flag}</span>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-text truncate">{reg.title}</div>
                        <div className="text-[10px] text-brand-text-secondary font-medium truncate">{reg.titleEn}</div>
                      </div>
                    </div>
                    {isSelected ? (
                      <span className="flex items-center gap-0.5 px-1.5 sm:px-2 py-0.5 rounded-full bg-primary text-primary-foreground text-[9px] sm:text-[10px] font-black uppercase shadow-xs shrink-0">
                        <Check className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                        <span>Active</span>
                      </span>
                    ) : (
                      <Badge variant="neutral" size="sm" className="font-mono text-[9px] shrink-0">
                        {reg.badge}
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-2 border-t border-border/60 text-[10px] text-text/60">
                    <div className="min-w-0">
                      <span className="text-[9px] sm:text-[10px] text-brand-text-secondary block font-medium truncate">วันที่ (Date Format)</span>
                      <span className="font-mono text-text/80 text-[9px] sm:text-[10px] font-bold block truncate">{reg.dateFormat}</span>
                    </div>
                    <div className="min-w-0">
                      <span className="text-[9px] sm:text-[10px] text-brand-text-secondary block font-medium truncate">สกุลเงิน (Currency)</span>
                      <span className="font-mono text-text/80 text-[9px] sm:text-[10px] font-bold block truncate">{reg.numberFormat}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 text-[9px] sm:text-[10px] text-brand-text-secondary font-mono gap-1">
                    <span className="truncate">TZ: {reg.timezone}</span>
                    <span className="text-primary font-bold shrink-0">{reg.currency}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Timezone and Date Format Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-border/60">
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-primary" />
                <span>{language === 'th' ? 'เขตเวลาสาขา (Timezone)' : 'Store Timezone'}</span>
              </label>
              <select
                value={formData.timezone}
                onChange={(e) => onChangeField('timezone', e.target.value)}
                className="w-full min-h-[44px] h-11 px-3 rounded-xl border border-brand-border-strong bg-background text-base sm:text-sm tabular-nums font-semibold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cta transition"
              >
                <option value="Asia/Bangkok">Asia/Bangkok (UTC+07:00 Indochina Time)</option>
                <option value="Asia/Singapore">Asia/Singapore (UTC+08:00 Singapore Standard Time)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (UTC+09:00 Japan Standard Time)</option>
                <option value="Asia/Hong_Kong">Asia/Hong_Kong (UTC+08:00 HKT)</option>
                <option value="Europe/London">Europe/London (UTC+00:00 GMT/BST)</option>
                <option value="America/New_York">America/New_York (UTC-05:00 EST)</option>
                <option value="Australia/Sydney">Australia/Sydney (UTC+10:00 AEST)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                {language === 'th' ? 'รูปแบบวันที่ (Date Format)' : 'Date Format'}
              </label>
              <select
                defaultValue="DD/MM/YYYY"
                className="w-full min-h-[44px] h-11 px-3 rounded-xl border border-brand-border-strong bg-background text-base sm:text-sm tabular-nums font-semibold text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cta transition"
              >
                <option value="DD/MM/YYYY">DD/MM/YYYY (e.g. 25/10/2026)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (ISO 8601)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (US Standard)</option>
                <option value="D MMM YYYY">D MMM YYYY (e.g. 25 Oct 2026)</option>
              </select>
            </div>
          </div>

          {/* Base Currency Selection */}
          <div className="space-y-3 pt-3 border-t border-border/60">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                  {language === 'th' ? 'สกุลเงินหลักประจำเครื่อง (Base Currency)' : 'Store Base Currency'}
                </label>
                <span className="text-[11px] text-brand-text-secondary">
                  {language === 'th' ? 'สกุลเงินที่ใช้ลงบัญชีและคำนวณราคาสินค้าในแคตตาล็อก' : 'All catalog prices and shift drawer balances are tracked in this currency.'}
                </span>
              </div>
              <Badge variant="success" size="sm" className="font-mono">
                {session.currentStore.currency || 'THB'}
              </Badge>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
              {SUPPORTED_CURRENCIES.map((cur) => {
                const isActive = (session.currentStore.currency || 'THB') === cur.code;
                return (
                  <button
                    key={cur.code}
                    type="button"
                    onClick={() => {
                      switchCurrency(cur.code);
                      CurrencyService.setBaseCurrency(cur.code);
                      onChangeField('baseCurrency', cur.code);
                      addToast({
                        title: language === 'th' ? 'สลับสกุลเงินหลักสำเร็จ' : 'Base Currency Updated',
                        message: language === 'th'
                          ? `ระบบอัปเดตสกุลเงินหลักเป็น ${cur.code} (${cur.symbol}) แล้ว`
                          : `Successfully set system base currency to ${cur.code} (${cur.symbol}).`,
                        type: 'success',
                      });
                    }}
                    className={`p-2.5 rounded-lg border flex flex-col items-center justify-center gap-1 cursor-pointer transition-all duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 ${
                      isActive
                        ? 'border-primary bg-primary/10 text-primary font-bold shadow-xs'
                        : 'border-border bg-card text-text hover:bg-background'
                    }`}
                  >
                    <span className="text-xl">{cur.flag}</span>
                    <span className="text-xs font-bold">{cur.code} ({cur.symbol})</span>
                    <span className="text-[10px] text-brand-text-secondary">{cur.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </CardBody>
      </Card>
      {/* 3. Financial & Payment Terminals Configuration */}
      <Card className="border border-border/80 shadow-sm rounded-lg overflow-hidden">
        <CardHeader className="bg-card/50 border-b border-border/60 py-3.5 px-5">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary shrink-0">
              <DollarSign className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-text truncate">
                {language === 'th' ? 'การตั้งค่าช่องทางชำระเงินและเครื่องรูดบัตร (Payments & Terminals)' : 'Financial & Payment Terminals'}
              </h3>
              <p className="text-[11px] text-brand-text-secondary truncate">
                {language === 'th' ? 'จัดการรหัส PromptPay ID และหมายเลขเครื่องรูดบัตร EDC ประจำร้าน' : 'Manage PromptPay ID and EDC terminal identification for this register.'}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardBody className="p-5 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* PromptPay ID */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                {language === 'th' ? 'หมายเลข PromptPay (Phone / Tax ID)' : 'PromptPay ID'}
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-brand-text-secondary group-focus-within:text-primary transition-colors">
                  <Phone className="h-3.5 w-3.5" />
                </div>
                <input
                  type="text"
                  value={formData.promptPayId}
                  onChange={(e) => onChangeField('promptPayId', e.target.value)}
                  placeholder="e.g. 0812345678"
                  className="w-full min-h-[44px] h-11 pl-9 pr-3.5 rounded-xl border border-brand-border-strong bg-background text-base sm:text-sm font-mono font-bold text-text focus:outline-hidden focus-visible:ring-2 focus-visible:ring-cta transition shadow-2xs"
                />
              </div>
              <p className="text-[10px] text-brand-text-secondary">
                {language === 'th' ? 'หมายเลขนี้จะใช้สำหรับสร้าง QR Code รับเงินอัตโนมัติ' : 'This ID is used to generate dynamic payment QR codes for customers.'}
              </p>
            </div>

            {/* EDC Terminal Reference */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-text/80 uppercase tracking-wide">
                {language === 'th' ? 'รหัสอ้างอิงเครื่องรูดบัตร (Terminal ID)' : 'EDC Terminal ID'}
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-brand-text-secondary group-focus-within:text-primary transition-colors">
                  <CreditCard className="h-3.5 w-3.5" />
                </div>
                <input
                  type="text"
                  value={formData.terminalId}
                  onChange={(e) => onChangeField('terminalId', e.target.value)}
                  placeholder="e.g. TRM-EDC-01"
                  className="w-full min-h-[44px] h-11 pl-9 pr-3.5 rounded-xl border border-brand-border-strong bg-background text-base sm:text-sm font-mono font-bold text-text focus:outline-hidden focus-visible:ring-2 focus-visible:ring-cta transition shadow-2xs"
                />
              </div>
              <p className="text-[10px] text-brand-text-secondary">
                {language === 'th' ? 'ชื่อหรือรหัสประจำเครื่อง EDC สำหรับบันทึกในใบเสร็จ' : 'Hardware identifier recorded on transactions for terminal reconciliation.'}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
};
