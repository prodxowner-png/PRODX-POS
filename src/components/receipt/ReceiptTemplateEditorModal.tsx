/**
 * PRODX POS - Receipt Template & Store Branding Customizer Modal
 * 
 * Provides an interactive visual studio to customize store branding, receipt layout,
 * thermal printer hardware codes, and preview output in real-time.
 */

import React, { useState } from 'react';
import { useReceiptPrinter } from '../../context/ReceiptPrinterContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { ReceiptTemplate, ReceiptPaperWidth, INITIAL_RECEIPT_TEMPLATES } from '../../domain/receipt';
import { ReceiptPaperPreview } from './ReceiptPaperPreview';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import {
  Palette,
  Layout,
  Cpu,
  Store,
  Sparkles,
  Save,
  RotateCcw,
  Copy,
  Trash2,
  Sliders,
  CheckCircle2,
  Printer,
  ShieldCheck,
  Tag,
  DollarSign,
  QrCode,
  FileCode,
} from 'lucide-react';

interface ReceiptTemplateEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTemplate?: ReceiptTemplate;
}

export const ReceiptTemplateEditorModal: React.FC<ReceiptTemplateEditorModalProps> = ({
  isOpen,
  onClose,
  initialTemplate,
}) => {
  const {
    templates,
    activeTemplate,
    saveTemplate,
    deleteTemplate,
    setActiveTemplateId,
    getSampleOrder,
    printReceipt,
    isPrinting,
  } = useReceiptPrinter();
  const { language, t } = useLanguage();
  const { addToast } = useToast();

  const [currentTemplate, setCurrentTemplate] = useState<ReceiptTemplate>(() => {
    return initialTemplate || activeTemplate;
  });

  const [activeTab, setActiveTab] = useState<'branding' | 'layout' | 'hardware' | 'presets'>('branding');

  const sampleOrder = getSampleOrder();

  const handleFieldChange = (section: 'branding' | 'layout' | 'hardware', key: string, value: any) => {
    setCurrentTemplate((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value,
      },
    }));
  };

  const handlePaperWidthChange = (width: ReceiptPaperWidth) => {
    setCurrentTemplate((prev) => ({
      ...prev,
      paperWidth: width,
      characterColumns: width === '58mm' ? 32 : 48,
    }));
  };

  const handleSave = () => {
    saveTemplate(currentTemplate);
    setActiveTemplateId(currentTemplate.id);
    addToast({
      title: language === 'th' ? 'บันทึกรูปแบบใบเสร็จสำเร็จ' : 'Receipt Template Saved',
      message: language === 'th' ? `อัปเดตรูปแบบ "${currentTemplate.name}" เรียบร้อยแล้ว` : `Template "${currentTemplate.name}" saved and set as active.`,
      type: 'success',
    });
    onClose();
  };

  const handleDuplicate = () => {
    const newId = `tmpl-custom-${Date.now()}`;
    const cloned: ReceiptTemplate = {
      ...currentTemplate,
      id: newId,
      name: `${currentTemplate.name} (Copy)`,
      isDefault: false,
      isSystem: false,
      updatedAt: new Date().toISOString(),
    };
    saveTemplate(cloned);
    setCurrentTemplate(cloned);
    setActiveTemplateId(cloned.id);
    addToast({
      title: language === 'th' ? 'คัดลอกเทมเพลตเรียบร้อย' : 'Template Duplicated',
      message: language === 'th' ? `สร้างเทมเพลตใหม่ "${cloned.name}"` : `Created clone "${cloned.name}".`,
      type: 'info',
    });
  };

  const handleApplyPreset = (preset: ReceiptTemplate) => {
    setCurrentTemplate({
      ...preset,
      id: currentTemplate.isSystem ? preset.id : currentTemplate.id,
      name: currentTemplate.isSystem ? preset.name : currentTemplate.name,
    });
    addToast({
      title: language === 'th' ? 'นำค่าพรีเซ็ตมาใช้' : 'Preset Applied',
      message: `${preset.name} (${preset.paperWidth})`,
      type: 'info',
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={language === 'th' ? 'ปรับแต่งรูปแบบใบเสร็จและความเป็นแบรนด์' : 'Thermal Receipt & Branding Studio'}
      description={language === 'th' ? 'กำหนดข้อมูลร้านค้า โลโก้ ข้อความภาษี และรูปแบบการพิมพ์กระดาษความร้อน' : 'Customize store identity, VAT registration, layout toggles, and ESC/POS printer hardware codes.'}
      maxWidth="2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDuplicate}
              leftIcon={<Copy className="h-3.5 w-3.5" />}
            >
              {language === 'th' ? 'คัดลอกเทมเพลต' : 'Duplicate'}
            </Button>
            {!currentTemplate.isSystem && templates.length > 1 && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  deleteTemplate(currentTemplate.id);
                  onClose();
                }}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              >
                {language === 'th' ? 'ลบ' : 'Delete'}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              leftIcon={<Save className="h-3.5 w-3.5" />}
            >
              {language === 'th' ? 'บันทึกและเปิดใช้งาน' : 'Save & Activate'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[540px]">
        {/* Left Side: Editor Controls (7 cols) */}
        <div className="lg:col-span-7 flex flex-col space-y-4">
          {/* Template Header & Tabs */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <input
                type="text"
                value={currentTemplate.name}
                onChange={(e) => setCurrentTemplate((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Template Name"
                className="text-sm font-bold bg-transparent border-b border-border dark:border-white/10 px-1 py-0.5 text-text focus:outline-none focus:border-orange-500 w-2/3"
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handlePaperWidthChange('58mm')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono tabular-nums font-bold transition-all cursor-pointer ${
                    currentTemplate.paperWidth === '58mm'
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'bg-background dark:bg-white/5 text-text/70 dark:text-white/60 hover:bg-zinc-200'
                  }`}
                >
                  58mm
                </button>
                <button
                  type="button"
                  onClick={() => handlePaperWidthChange('80mm')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono tabular-nums font-bold transition-all cursor-pointer ${
                    currentTemplate.paperWidth === '80mm'
                      ? 'bg-primary text-primary-foreground shadow-2xs'
                      : 'bg-background dark:bg-white/5 text-text/70 dark:text-white/60 hover:bg-zinc-200'
                  }`}
                >
                  80mm
                </button>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-1 border-b border-border border-crisp pb-1">
              {[
                { id: 'branding', label: language === 'th' ? 'ข้อมูลแบรนด์' : 'Store Branding', icon: <Store className="h-3.5 w-3.5" /> },
                { id: 'layout', label: language === 'th' ? 'การแสดงผล' : 'Layout & Toggles', icon: <Layout className="h-3.5 w-3.5" /> },
                { id: 'hardware', label: language === 'th' ? 'ฮาร์ดแวร์ / ESC' : 'ESC/POS & Cut', icon: <Cpu className="h-3.5 w-3.5" /> },
                { id: 'presets', label: language === 'th' ? 'แม่แบบสำเร็จรูป' : 'Presets', icon: <Sparkles className="h-3.5 w-3.5" /> },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    activeTab === tab.id
                      ? 'bg-primary/10 text-primary dark:text-orange-400 font-bold'
                      : 'text-text/70 dark:text-white/60 hover:text-text'
                  }`}
                >
                  {tab.icon}
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Tab 1: Store Branding */}
          {activeTab === 'branding' && (
            <div className="space-y-3 overflow-y-auto max-h-[460px] pr-1 text-xs no-scrollbar">
              <div>
                <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                  {language === 'th' ? 'ชื่อร้านค้า (หัวใบเสร็จ)' : 'Store Name (Header)'}
                </label>
                <input
                  type="text"
                  value={currentTemplate.branding.storeName}
                  onChange={(e) => handleFieldChange('branding', 'storeName', e.target.value)}
                  className="w-full h-9 rounded-xl border border-border border-crisp bg-card px-3 font-semibold text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                    {language === 'th' ? 'สาขา' : 'Branch / Location'}
                  </label>
                  <input
                    type="text"
                    value={currentTemplate.branding.branchName}
                    onChange={(e) => handleFieldChange('branding', 'branchName', e.target.value)}
                    className="w-full h-9 rounded-xl border border-border border-crisp bg-card px-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                    {language === 'th' ? 'สโลแกน / แท็กไลน์' : 'Tagline / Sub-header'}
                  </label>
                  <input
                    type="text"
                    value={currentTemplate.branding.tagline}
                    onChange={(e) => handleFieldChange('branding', 'tagline', e.target.value)}
                    className="w-full h-9 rounded-xl border border-border border-crisp bg-card px-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                  {language === 'th' ? 'เลขประจำตัวผู้เสียภาษี (Tax ID / VAT Reg.)' : 'Tax ID / VAT Registration Number'}
                </label>
                <input
                  type="text"
                  value={currentTemplate.branding.taxId}
                  onChange={(e) => handleFieldChange('branding', 'taxId', e.target.value)}
                  className="w-full h-9 rounded-xl border border-border border-crisp bg-card px-3 font-mono tabular-nums text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                    {language === 'th' ? 'ที่อยู่บรรทัดที่ 1' : 'Address Line 1'}
                  </label>
                  <input
                    type="text"
                    value={currentTemplate.branding.addressLine1}
                    onChange={(e) => handleFieldChange('branding', 'addressLine1', e.target.value)}
                    className="w-full h-9 rounded-xl border border-border border-crisp bg-card px-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                    {language === 'th' ? 'ที่อยู่บรรทัดที่ 2' : 'Address Line 2 (City/Postcode)'}
                  </label>
                  <input
                    type="text"
                    value={currentTemplate.branding.addressLine2}
                    onChange={(e) => handleFieldChange('branding', 'addressLine2', e.target.value)}
                    className="w-full h-9 rounded-xl border border-border border-crisp bg-card px-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                    {language === 'th' ? 'โทรศัพท์' : 'Phone'}
                  </label>
                  <input
                    type="text"
                    value={currentTemplate.branding.phone}
                    onChange={(e) => handleFieldChange('branding', 'phone', e.target.value)}
                    className="w-full h-9 rounded-xl border border-border border-crisp bg-card px-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                    {language === 'th' ? 'อีเมล' : 'Email'}
                  </label>
                  <input
                    type="text"
                    value={currentTemplate.branding.email}
                    onChange={(e) => handleFieldChange('branding', 'email', e.target.value)}
                    className="w-full h-9 rounded-xl border border-border border-crisp bg-card px-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                    {language === 'th' ? 'เว็บไซต์' : 'Website'}
                  </label>
                  <input
                    type="text"
                    value={currentTemplate.branding.website}
                    onChange={(e) => handleFieldChange('branding', 'website', e.target.value)}
                    className="w-full h-9 rounded-xl border border-border border-crisp bg-card px-3 text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                </div>
              </div>

              <div className="pt-2 border-t border-border border-crisp">
                <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                  {language === 'th' ? 'ข้อความขอบคุณท้ายใบเสร็จ (Footer Message)' : 'Customer Thank You / Footer Note'}
                </label>
                <textarea
                  rows={2}
                  value={currentTemplate.layout.footerMessage}
                  onChange={(e) => handleFieldChange('layout', 'footerMessage', e.target.value)}
                  className="w-full rounded-xl border border-border border-crisp bg-card p-2.5 text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <div>
                <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                  {language === 'th' ? 'เงื่อนไขการเปลี่ยน/คืนสินค้า (Return Policy)' : 'Return & Exchange Policy Note'}
                </label>
                <textarea
                  rows={2}
                  value={currentTemplate.layout.returnPolicyText}
                  onChange={(e) => handleFieldChange('layout', 'returnPolicyText', e.target.value)}
                  className="w-full rounded-xl border border-border border-crisp bg-card p-2.5 text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </div>
          )}

          {/* Tab 2: Layout & Toggles */}
          {activeTab === 'layout' && (
            <div className="space-y-4 overflow-y-auto max-h-[460px] pr-1 text-xs no-scrollbar">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  { key: 'showStoreHeader', label: 'Store Name Header' },
                  { key: 'showBranchName', label: 'Branch / Location Name' },
                  { key: 'showTagline', label: 'Tagline & Slogan' },
                  { key: 'showTaxId', label: 'Tax ID / VAT Registration' },
                  { key: 'showAddress', label: 'Store Address' },
                  { key: 'showContactInfo', label: 'Contact (Tel/Email/Web)' },
                  { key: 'showCashierName', label: 'Cashier Staff Name' },
                  { key: 'showRegisterId', label: 'Register Terminal ID' },
                  { key: 'showOrderTimestamp', label: 'Date & Time Stamp' },
                  { key: 'showCustomerInfo', label: 'Customer Loyalty Name' },
                  { key: 'showLoyaltyPoints', label: 'Customer Loyalty Points' },
                  { key: 'showItemSku', label: 'Product SKU Codes' },
                  { key: 'showItemUnitPrice', label: 'Unit Price Multiplier' },
                  { key: 'showItemDiscounts', label: 'Item Discount Breakdown' },
                  { key: 'showTaxBreakdown', label: 'VAT / Sales Tax Breakdown' },
                  { key: 'showPaymentBreakdown', label: 'Tender Method Details' },
                  { key: 'showChangeGiven', label: 'Change Returned Display' },
                  { key: 'showBarcode', label: 'Order Number Barcode' },
                  { key: 'showQrCode', label: 'E-Receipt QR Code' },
                  { key: 'showFooterNote', label: 'Thank You Footer Note' },
                  { key: 'showReturnPolicy', label: 'Return Policy Notice' },
                  { key: 'showWifiInfo', label: 'Store Guest Wi-Fi Note' },
                ].map((toggle) => (
                  <label
                    key={toggle.key}
                    className="p-2.5 rounded-xl border border-border border-crisp bg-card flex items-center justify-between cursor-pointer hover:border-primary/40 transition-colors"
                  >
                    <span className="font-semibold text-text dark:text-white/80">
                      {toggle.label}
                    </span>
                    <input
                      type="checkbox"
                      checked={Boolean((currentTemplate.layout as any)[toggle.key])}
                      onChange={(e) => handleFieldChange('layout', toggle.key, e.target.checked)}
                      className="rounded text-primary focus:ring-primary h-4 w-4"
                    />
                  </label>
                ))}
              </div>

              <div className="pt-2 border-t border-border border-crisp grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                    Divider Style Character
                  </label>
                  <select
                    value={currentTemplate.layout.dividerStyle}
                    onChange={(e) => handleFieldChange('layout', 'dividerStyle', e.target.value)}
                    className="w-full h-9 rounded-xl border border-border border-crisp bg-card px-3 font-mono tabular-nums text-text focus:outline-none"
                  >
                    <option value="=">= (Double Line)</option>
                    <option value="-">- (Dashed Line)</option>
                    <option value="*">* (Asterisk Line)</option>
                    <option value="~">~ (Wavy Line)</option>
                    <option value=".">. (Dotted Line)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                    E-Receipt QR Code Prefix
                  </label>
                  <input
                    type="text"
                    value={currentTemplate.layout.qrCodeUrlPrefix}
                    onChange={(e) => handleFieldChange('layout', 'qrCodeUrlPrefix', e.target.value)}
                    className="w-full h-9 rounded-xl border border-border border-crisp bg-card px-3 font-mono tabular-nums text-text focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Hardware & ESC/POS */}
          {activeTab === 'hardware' && (
            <div className="space-y-4 overflow-y-auto max-h-[460px] pr-1 text-xs no-scrollbar">
              <div className="p-3.5 rounded-xl border border-primary/30 bg-primary/5 text-orange-950 dark:text-orange-200 flex items-start gap-2.5">
                <Cpu className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold">Hardware ESC/POS Control Commands</div>
                  <div className="text-[11px] opacity-80 mt-0.5">
                    Direct binary commands executed by thermal printer microcontrollers (Epson, Star, Bixolon, Citizen).
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="p-3 rounded-xl border border-border border-crisp bg-card flex items-center justify-between cursor-pointer">
                  <div>
                    <div className="font-bold text-text">
                      Auto-Cut Paper After Ticket (GS V)
                    </div>
                    <div className="text-[11px] text-text/60 dark:text-white/40">
                      Sends paper guillotine cut command at end of job.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={currentTemplate.hardware.autoCutPaper}
                    onChange={(e) => handleFieldChange('hardware', 'autoCutPaper', e.target.checked)}
                    className="rounded text-primary focus:ring-primary h-4 w-4"
                  />
                </label>

                <label className="p-3 rounded-xl border border-border border-crisp bg-card flex items-center justify-between cursor-pointer">
                  <div>
                    <div className="font-bold text-text">
                      Kick Cash Drawer on Print (ESC p)
                    </div>
                    <div className="text-[11px] text-text/60 dark:text-white/40">
                      Triggers 24V RJ12 solenoid kick pulse to open drawer automatically.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={currentTemplate.hardware.openCashDrawer}
                    onChange={(e) => handleFieldChange('hardware', 'openCashDrawer', e.target.checked)}
                    className="rounded text-primary focus:ring-primary h-4 w-4"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                      Drawer Kick Pin
                    </label>
                    <select
                      value={currentTemplate.hardware.drawerKickPin}
                      onChange={(e) => handleFieldChange('hardware', 'drawerKickPin', Number(e.target.value))}
                      className="w-full h-9 rounded-xl border border-border border-crisp bg-card px-3 text-text focus:outline-none"
                    >
                      <option value={2}>Pin 2 (Standard Epson / Star)</option>
                      <option value={5}>Pin 5 (Secondary Drawer)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-zinc-700 dark:text-white/70 mb-1">
                      Feed Lines Before Cut
                    </label>
                    <input
                      type="number"
                    inputMode="decimal"
                      min={0}
                      max={10}
                      value={currentTemplate.hardware.feedLinesBeforeCut}
                      onChange={(e) => handleFieldChange('hardware', 'feedLinesBeforeCut', Number(e.target.value))}
                      className="w-full h-9 rounded-xl border border-border border-crisp bg-card px-3 text-text focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="p-3 rounded-xl border border-border border-crisp bg-card flex items-center justify-between cursor-pointer">
                    <span className="font-semibold text-text dark:text-white/80">Double-Width Header</span>
                    <input
                      type="checkbox"
                      checked={currentTemplate.hardware.doubleWidthHeader}
                      onChange={(e) => handleFieldChange('hardware', 'doubleWidthHeader', e.target.checked)}
                      className="rounded text-primary focus:ring-primary h-4 w-4"
                    />
                  </label>

                  <label className="p-3 rounded-xl border border-border border-crisp bg-card flex items-center justify-between cursor-pointer">
                    <span className="font-semibold text-text dark:text-white/80">Emphasize Totals</span>
                    <input
                      type="checkbox"
                      checked={currentTemplate.hardware.emphasizeTotals}
                      onChange={(e) => handleFieldChange('hardware', 'emphasizeTotals', e.target.checked)}
                      className="rounded text-primary focus:ring-primary h-4 w-4"
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: Presets */}
          {activeTab === 'presets' && (
            <div className="space-y-3 overflow-y-auto max-h-[460px] pr-1 text-xs no-scrollbar">
              <div className="text-text/70 dark:text-white/60 mb-2">
                Select a professionally pre-configured thermal layout:
              </div>

              {INITIAL_RECEIPT_TEMPLATES.map((preset) => (
                <div
                  key={preset.id}
                  className="p-3.5 rounded-xl border border-border border-crisp bg-card hover:border-primary/40 transition-all flex items-center justify-between"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-text">{preset.name}</span>
                      <Badge variant="primary" size="sm">
                        {preset.paperWidth}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-text/60 dark:text-white/40 mt-1">
                      {preset.description}
                    </div>
                  </div>

                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleApplyPreset(preset)}
                  >
                    Apply Preset
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Side: Real-Time Live Thermal Paper Visualizer (5 cols) */}
        <div className="lg:col-span-5 flex flex-col space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-bold text-text flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>Live Thermal Simulator</span>
            </span>
            <span className="text-[11px] font-mono tabular-nums text-brand-text-secondary">
              {currentTemplate.paperWidth} · {currentTemplate.characterColumns}c
            </span>
          </div>

          <ReceiptPaperPreview
            order={sampleOrder}
            template={currentTemplate}
            onPrint={() => printReceipt(sampleOrder, currentTemplate)}
            isPrinting={isPrinting}
          />
        </div>
      </div>
    </Modal>
  );
};
