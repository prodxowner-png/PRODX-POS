import React, { useState, useMemo } from 'react';
import { Order } from '../../domain/order';
import { Store } from '../../domain/auth';
import { formatMoney } from '../../domain/money';
import {
  TaxInvoiceBuyer,
  FullTaxInvoice,
  generateFullTaxInvoice,
  validateThaiTaxId,
} from '../../domain/taxInvoice';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useReceiptPrinter } from '../../context/ReceiptPrinterContext';
import { useToast } from '../../context/ToastContext';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { ProdxReceiptLogo } from '../common/ProdxLogo';
import {
  FileText,
  Printer,
  Building,
  User,
  CheckCircle2,
  AlertCircle,
  Download,
  Share2,
  Sparkles,
  Eye,
  FileSpreadsheet,
} from 'lucide-react';

export interface FullTaxInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  order?: Order | null;
}

const PRESET_BUYERS: { label: string; buyer: TaxInvoiceBuyer }[] = [
  {
    label: 'บจก. สยาม คอร์ปอเรชั่น (สำนักงานใหญ่)',
    buyer: {
      name: 'บริษัท สยาม คอร์ปอเรชั่น จำกัด (มหาชน)',
      taxId: '0107536000285',
      branchType: 'head_office',
      address: '999/9 อาคารสยามพาวิลเลียน ชั้น 28 ถนนพระราม 1 แขวงปทุมวัน เขตปทุมวัน กรุงเทพมหานคร 10330',
      phone: '02-690-1000',
      email: 'accounting@siamcorp.co.th',
    },
  },
  {
    label: 'บจก. ดิจิทัล โซลูชั่นส์ (สาขา 00002)',
    buyer: {
      name: 'บริษัท ดิจิทัล โซลูชั่นส์ จำกัด',
      taxId: '0105558123456',
      branchType: 'branch',
      branchNumber: '00002',
      address: '88/12 อาคารเอ็กเชนทาวเวอร์ ชั้น 15 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110',
      phone: '02-260-8800',
      email: 'tax@digitalsolutions.io',
    },
  },
  {
    label: 'คุณสมชาย ใจดี (บุคคลธรรมดา)',
    buyer: {
      name: 'นายสมชาย ใจดี',
      taxId: '1100500123451',
      branchType: 'head_office',
      address: '123/45 ซอยสุขุมวิท 39 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพฯ 10110',
      phone: '089-123-4567',
      email: 'somchai.j@example.com',
    },
  },
];

export const FullTaxInvoiceModal: React.FC<FullTaxInvoiceModalProps> = ({
  isOpen,
  onClose,
  order,
}) => {
  const { session } = useAuth();
  const { language } = useLanguage();
  const { printReceipt } = useReceiptPrinter();
  const { addToast } = useToast();

  const [activeView, setActiveView] = useState<'a4' | 'thermal'>('a4');
  const [buyerName, setBuyerName] = useState(order?.customer?.name || '');
  const [taxId, setTaxId] = useState('');
  const [branchType, setBranchType] = useState<'head_office' | 'branch'>('head_office');
  const [branchNumber, setBranchNumber] = useState('00001');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState(order?.customer?.phone || '');
  const [email, setEmail] = useState(order?.customer?.email || '');

  // Checksum status
  const isTaxIdValid = useMemo(() => {
    return taxId ? validateThaiTaxId(taxId) : false;
  }, [taxId]);

  const buyerData: TaxInvoiceBuyer = useMemo(
    () => ({
      name: buyerName.trim() || (language === 'th' ? 'ลูกค้าทั่วไป' : 'Walk-in Customer'),
      taxId: taxId.trim() || '0000000000000',
      branchType,
      branchNumber: branchType === 'branch' ? branchNumber : undefined,
      address: address.trim() || (language === 'th' ? 'กรุงเทพมหานคร' : 'Bangkok, Thailand'),
      phone,
      email,
    }),
    [buyerName, taxId, branchType, branchNumber, address, phone, email, language]
  );

  const taxInvoiceDoc: FullTaxInvoice | null = useMemo(() => {
    if (!order) return null;
    const store: Store = session?.currentStore || {
      id: 'store-01',
      organizationId: 'org-01',
      code: 'STR-01',
      name: 'PRODX Flagship Store',
      address: '999 Rama I Rd, Pathum Wan, Bangkok 10330',
      phone: '+66 2 123 4567',
      currency: 'THB',
      timezone: 'Asia/Bangkok',
      defaultTaxRateBps: 700,
    };
    return generateFullTaxInvoice(order, store, buyerData);
  }, [order, session, buyerData]);

  if (!isOpen || !order || !taxInvoiceDoc) return null;

  const handleApplyPreset = (preset: typeof PRESET_BUYERS[0]) => {
    setBuyerName(preset.buyer.name);
    setTaxId(preset.buyer.taxId);
    setBranchType(preset.buyer.branchType);
    setBranchNumber(preset.buyer.branchNumber || '00001');
    setAddress(preset.buyer.address);
    setPhone(preset.buyer.phone || '');
    setEmail(preset.buyer.email || '');
    addToast({
      title: language === 'th' ? 'โหลดข้อมูลผู้เสียภาษีแล้ว' : 'Tax Profile Loaded',
      message: preset.label,
      type: 'info',
    });
  };

  const handlePrintA4 = () => {
    window.print();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={language === 'th' ? 'ออกใบกำกับภาษีเต็มรูป (Full Tax Invoice)' : 'Full Tax Invoice Generator'}
      description={
        language === 'th'
          ? 'กรอกข้อมูลผู้เสียภาษีอากรและพิมพ์ใบกำกับภาษีเต็มรูปตามมาตรฐานกรมสรรพากร'
          : 'Generate and print official full tax invoices compliant with revenue regulations.'
      }
      maxWidth="2xl"
    >
      <div className="space-y-4">
        {/* Quick Presets Bar */}
        <div>
          <div className="text-[11px] font-semibold text-text/60 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            <span>{language === 'th' ? 'ข้อมูลตัวอย่างรวดเร็ว (Quick Fill Presets):' : 'Quick Presets:'}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_BUYERS.map((p, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleApplyPreset(p)}
                className="px-2.5 py-1.5 rounded-md border border-border border-crisp hover:border-primary/40 bg-background/60 hover:bg-blue-50 dark:hover:bg-blue-950/20 text-xs text-text/80 transition-colors cursor-pointer"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Customer / Buyer Tax Form Grid */}
        <div className="p-4 rounded-lg border border-border border-crisp bg-card space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-text/80 block mb-1">
                {language === 'th' ? 'ชื่อผู้ซื้อ / บริษัท / นิติบุคคล *' : 'Buyer / Company Name *'}
              </label>
              <input
                type="text"
                value={buyerName}
                onChange={(e) => setBuyerName(e.target.value)}
                placeholder={language === 'th' ? 'เช่น บริษัท สยาม อินโนเวชั่น จำกัด' : 'Company or individual name'}
                className="w-full px-3 py-2 text-xs rounded-md border border-border border-crisp bg-card text-text focus:ring-2 focus:ring-primary outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-text/80">
                  {language === 'th' ? 'เลขประจำตัวผู้เสียภาษี (13 หลัก) *' : '13-Digit Tax ID *'}
                </label>
                {taxId.length === 13 && (
                  <span className={`text-[10px] font-semibold ${isTaxIdValid ? 'text-emerald-500' : 'text-rose-500'}`}>
                    {isTaxIdValid ? (language === 'th' ? '✓ ถูกต้อง' : '✓ Valid') : (language === 'th' ? '✗ รูปแบบไม่ถูกต้อง' : '✗ Invalid Checksum')}
                  </span>
                )}
              </div>
              <input
                type="text"
                maxLength={13}
                value={taxId}
                onChange={(e) => setTaxId(e.target.value.replace(/\D/g, ''))}
                placeholder="0105565019842"
                className="w-full px-3 py-2 text-xs font-mono rounded-md border border-border border-crisp bg-card text-text focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-text/80 block mb-1">
                {language === 'th' ? 'สาขา (Branch Type)' : 'Branch Type'}
              </label>
              <select
                value={branchType}
                onChange={(e) => setBranchType(e.target.value as any)}
                className="w-full px-3 py-2 text-xs rounded-md border border-border border-crisp bg-card text-text focus:ring-2 focus:ring-primary outline-none"
              >
                <option value="head_office">{language === 'th' ? 'สำนักงานใหญ่ (Head Office)' : 'Head Office'}</option>
                <option value="branch">{language === 'th' ? 'สาขา (Branch)' : 'Branch'}</option>
              </select>
            </div>

            {branchType === 'branch' && (
              <div>
                <label className="text-xs font-semibold text-text/80 block mb-1">
                  {language === 'th' ? 'รหัสสาขา (5 หลัก)' : 'Branch Code (5 Digits)'}
                </label>
                <input
                  type="text"
                  maxLength={5}
                  value={branchNumber}
                  onChange={(e) => setBranchNumber(e.target.value)}
                  placeholder="00001"
                  className="w-full px-3 py-2 text-xs font-mono rounded-md border border-border border-crisp bg-card text-text focus:ring-2 focus:ring-primary outline-none"
                />
              </div>
            )}

            <div className={branchType === 'branch' ? '' : 'sm:col-span-2'}>
              <label className="text-xs font-semibold text-text/80 block mb-1">
                {language === 'th' ? 'เบอร์โทรศัพท์ / อีเมล' : 'Phone / Email'}
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="02-123-4567"
                className="w-full px-3 py-2 text-xs rounded-md border border-border border-crisp bg-card text-text focus:ring-2 focus:ring-primary outline-none"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-text/80 block mb-1">
              {language === 'th' ? 'ที่อยู่ตามทะเบียนภาษี (Tax Registered Address) *' : 'Registered Address *'}
            </label>
            <textarea
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={language === 'th' ? 'เลขที่ ถนน แขวง/ตำบล เขต/อำเภอ จังหวัด รหัสไปรษณีย์' : 'Address, City, Postal Code'}
              className="w-full px-3 py-2 text-xs rounded-md border border-border border-crisp bg-card text-text focus:ring-2 focus:ring-primary outline-none resize-none"
            />
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 bg-background p-1 rounded-lg border border-border border-crisp">
            <button
              type="button"
              onClick={() => setActiveView('a4')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${
                activeView === 'a4'
                  ? 'bg-white dark:bg-background text-text shadow-xs'
                  : 'text-slate-500 hover:text-text'
              }`}
            >
              <FileText className="h-3.5 w-3.5 text-primary" />
              <span>{language === 'th' ? 'พรีวิวขนาด A4 (เต็มรูป)' : 'A4 Full Tax Format'}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveView('thermal')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 ${
                activeView === 'thermal'
                  ? 'bg-white dark:bg-background text-text shadow-xs'
                  : 'text-slate-500 hover:text-text'
              }`}
            >
              <Printer className="h-3.5 w-3.5 text-primary" />
              <span>{language === 'th' ? 'สลิปเทอร์มอล 80mm' : '80mm Slip Format'}</span>
            </button>
          </div>

          <div className="text-xs font-mono font-semibold text-text/60">
            {taxInvoiceDoc.invoiceNumber}
          </div>
        </div>

        {/* A4 Tax Invoice Document Printable Layout */}
        {activeView === 'a4' ? (
          <div
            id="printable-tax-invoice-a4"
            className="p-6 sm:p-8 rounded-2xl bg-white text-zinc-900 border border-border shadow-sm font-sans space-y-6 text-xs select-text"
          >
            {/* Header Title */}
            <div className="border-b pb-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="space-y-2">
                <ProdxReceiptLogo paperWidth="80mm" className="items-start justify-start" />
                <div>
                  <div className="text-lg font-black tracking-tight text-zinc-950 uppercase">
                    {taxInvoiceDoc.seller.companyName}
                  </div>
                  <div className="text-text/70 mt-1 space-y-0.5 text-[11px]">
                    <div>{taxInvoiceDoc.seller.address}</div>
                    <div>
                      เลขประจำตัวผู้เสียภาษีอากร:{' '}
                      <span className="font-mono font-bold">{taxInvoiceDoc.seller.taxId}</span> (สำนักงานใหญ่)
                    </div>
                    <div>โทร: {taxInvoiceDoc.seller.phone}</div>
                  </div>
                </div>
              </div>

              <div className="sm:text-right border-l sm:border-l-0 sm:pl-0 pl-3 border-border">
                <div className="inline-block border-2 border-border px-3 py-1 font-black text-sm text-zinc-900 uppercase">
                  ใบกำกับภาษี / ใบเสร็จรับเงิน
                  <div className="text-[10px] font-semibold text-text/70">FULL TAX INVOICE / RECEIPT</div>
                </div>
                <div className="mt-2 space-y-0.5 text-[11px] font-mono">
                  <div>
                    <span className="font-sans font-bold">เลขที่ (No.):</span> {taxInvoiceDoc.invoiceNumber}
                  </div>
                  <div>
                    <span className="font-sans font-bold">วันที่ (Date):</span>{' '}
                    {new Date(taxInvoiceDoc.issueDate).toLocaleDateString('th-TH')}
                  </div>
                  <div>
                    <span className="font-sans font-bold">อ้างอิงบิล (Ref):</span> {taxInvoiceDoc.referenceOrderNumber}
                  </div>
                </div>
              </div>
            </div>

            {/* Buyer Details Box */}
            <div className="border border-border rounded-lg p-3 bg-background/50/50 space-y-1 text-[11px]">
              <div className="flex flex-col sm:flex-row sm:items-baseline justify-between">
                <div>
                  <span className="font-bold">ชื่อผู้ซื้อ (Customer Name):</span>{' '}
                  <span className="font-semibold text-zinc-950">{taxInvoiceDoc.buyer.name}</span>
                </div>
                <div className="font-mono">
                  <span className="font-sans font-bold">เลขประจำตัวผู้เสียภาษี:</span>{' '}
                  <span className="font-bold">{taxInvoiceDoc.buyer.taxId}</span>
                </div>
              </div>
              <div>
                <span className="font-bold">สาขา (Branch):</span>{' '}
                {taxInvoiceDoc.buyer.branchType === 'head_office'
                  ? 'สำนักงานใหญ่ (Head Office)'
                  : `สาขาที่ ${taxInvoiceDoc.buyer.branchNumber || '00001'}`}
              </div>
              <div>
                <span className="font-bold">ที่อยู่ (Address):</span> {taxInvoiceDoc.buyer.address}
              </div>
            </div>

            {/* Itemized Table */}
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-left text-[11px] border-collapse">
                <thead>
                  <tr className="bg-background border-b border-border font-bold text-text">
                    <th className="py-2 px-2.5 text-center w-10">ลำดับ</th>
                    <th className="py-2 px-3">รายการสินค้า / Description</th>
                    <th className="py-2 px-2.5 text-right w-16">จำนวน</th>
                    <th className="py-2 px-3 text-right w-24">ราคา/หน่วย</th>
                    <th className="py-2 px-3 text-right w-24">ส่วนลด</th>
                    <th className="py-2 px-3 text-right w-28">จำนวนเงิน</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 font-mono">
                  {taxInvoiceDoc.items.map((item) => (
                    <tr key={item.lineNumber}>
                      <td className="py-2 px-2.5 text-center">{item.lineNumber}</td>
                      <td className="py-2 px-3 font-sans font-medium text-zinc-900">
                        {item.description}
                        <span className="block text-[10px] text-text/60 font-mono">SKU: {item.sku}</span>
                      </td>
                      <td className="py-2 px-2.5 text-right">{item.quantity}</td>
                      <td className="py-2 px-3 text-right">{formatMoney(item.unitPrice)}</td>
                      <td className="py-2 px-3 text-right text-rose-600">
                        {item.discount.amountInCents > 0 ? `-${formatMoney(item.discount)}` : '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-zinc-950">{formatMoney(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Summary & Baht Text */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border border-border rounded-lg p-3">
              <div className="flex flex-col justify-between">
                <div>
                  <div className="text-[10px] font-bold text-text/60 uppercase">จำนวนเงินตัวอักษร / BAHT TEXT</div>
                  <div className="text-xs font-bold text-zinc-900 mt-1 p-2 rounded bg-background border border-border">
                    ({taxInvoiceDoc.bahtText})
                  </div>
                </div>
                <div className="text-[10px] text-text/60 mt-3">
                  พนักงานแคชเชียร์: {taxInvoiceDoc.cashierName} · เครื่อง: {order.registerId}
                </div>
              </div>

              <div className="space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between text-text/70">
                  <span className="font-sans">รวมมูลค่าสินค้า (Gross Amount)</span>
                  <span>{formatMoney(taxInvoiceDoc.totals.grossSubtotal)}</span>
                </div>
                <div className="flex justify-between text-rose-600">
                  <span className="font-sans">หักส่วนลด (Discounts)</span>
                  <span>-{formatMoney(taxInvoiceDoc.totals.discountTotal)}</span>
                </div>
                <div className="flex justify-between text-text/70">
                  <span className="font-sans">มูลค่าที่คิดภาษี (Taxable Base 7%)</span>
                  <span>{formatMoney(taxInvoiceDoc.totals.taxableBase)}</span>
                </div>
                <div className="flex justify-between text-text/70">
                  <span className="font-sans">ภาษีมูลค่าเพิ่ม 7% (VAT 7%)</span>
                  <span>{formatMoney(taxInvoiceDoc.totals.taxAmount)}</span>
                </div>
                <div className="pt-1.5 border-t border-border flex justify-between font-black text-sm text-zinc-950">
                  <span className="font-sans">จำนวนเงินรวมทั้งสิ้น (Grand Total)</span>
                  <span>{formatMoney(taxInvoiceDoc.totals.grandTotal)}</span>
                </div>
              </div>
            </div>

            {/* Signatures Block */}
            <div className="grid grid-cols-2 gap-8 pt-6 border-t border-border text-center text-[10px] text-text/70">
              <div>
                <div className="h-10 border-b border-dashed border-border mx-8" />
                <div className="mt-1 font-semibold">ผู้รับเงิน / Cashier Collector</div>
                <div className="text-[9px] text-text/50">วันที่ .......... / .......... / ..........</div>
              </div>
              <div>
                <div className="h-10 border-b border-dashed border-border mx-8" />
                <div className="mt-1 font-semibold">ผู้จ่ายเงิน / Customer Recipient</div>
                <div className="text-[9px] text-text/50">วันที่ .......... / .......... / ..........</div>
              </div>
            </div>
          </div>
        ) : (
          /* Thermal Slip Full Tax Format */
          <div className="max-w-xs mx-auto p-4 rounded-xl bg-white text-zinc-950 font-mono text-[11px] shadow-sm border border-border space-y-2">
            <div className="text-center font-bold">
              <div className="flex justify-center mb-2">
                <ProdxReceiptLogo paperWidth="80mm" />
              </div>
              <div>{taxInvoiceDoc.seller.companyName}</div>
              <div className="text-[10px]">TAX ID: {taxInvoiceDoc.seller.taxId} (HQ)</div>
              <div className="text-xs border-y border-dashed my-1 py-0.5">
                ใบกำกับภาษีเต็มรูป / ใบเสร็จรับเงิน
              </div>
            </div>
            <div className="text-[10px] space-y-0.5">
              <div>TAX NO: {taxInvoiceDoc.invoiceNumber}</div>
              <div>REF ORD: {taxInvoiceDoc.referenceOrderNumber}</div>
              <div>DATE: {new Date(taxInvoiceDoc.issueDate).toLocaleString('th-TH')}</div>
              <div>BUYER: {taxInvoiceDoc.buyer.name}</div>
              <div>BUYER TAX ID: {taxInvoiceDoc.buyer.taxId}</div>
              <div>
                BRANCH: {taxInvoiceDoc.buyer.branchType === 'head_office' ? 'สำนักงานใหญ่' : `สาขา ${taxInvoiceDoc.buyer.branchNumber}`}
              </div>
              <div>ADDR: {taxInvoiceDoc.buyer.address}</div>
            </div>
            <div className="border-t border-dashed pt-1 space-y-1">
              {taxInvoiceDoc.items.map((i) => (
                <div key={i.lineNumber} className="flex justify-between">
                  <span>{i.quantity}x {i.description}</span>
                  <span>{formatMoney(i.amount)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-dashed pt-1 space-y-0.5 text-right font-bold">
              <div className="flex justify-between font-normal text-[10px]">
                <span>BASE (TAXABLE):</span>
                <span>{formatMoney(taxInvoiceDoc.totals.taxableBase)}</span>
              </div>
              <div className="flex justify-between font-normal text-[10px]">
                <span>VAT 7%:</span>
                <span>{formatMoney(taxInvoiceDoc.totals.taxAmount)}</span>
              </div>
              <div className="flex justify-between text-xs pt-1 border-t">
                <span>TOTAL:</span>
                <span>{formatMoney(taxInvoiceDoc.totals.grandTotal)}</span>
              </div>
            </div>
            <div className="text-[9px] text-center italic">({taxInvoiceDoc.bahtText})</div>
          </div>
        )}

        {/* Footer Action Buttons */}
        <div className="pt-3 border-t border-border border-crisp flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-text/60">
            {language === 'th'
              ? 'ใบกำกับภาษีนี้สร้างถูกต้องตามระเบียบกรมสรรพากร พร้อมพิมพ์'
              : 'Official tax invoice prepared according to Revenue Department standards.'}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              {language === 'th' ? 'ปิด' : 'Close'}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handlePrintA4}
              leftIcon={<Printer className="h-4 w-4" />}
            >
              {language === 'th' ? 'พิมพ์ใบกำกับภาษี (Print A4)' : 'Print Full Tax Invoice'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
