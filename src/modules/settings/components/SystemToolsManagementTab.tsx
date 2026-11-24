import React, { useState } from 'react';
import {
  Wrench,
  Zap,
  CreditCard,
  Percent,
  Receipt,
  Database,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  RefreshCw,
  QrCode,
  Lock,
  Download,
  Upload,
  AlertTriangle,
  Smartphone,
  Banknote,
  Globe,
  Ticket,
  Landmark,
  Eye,
  Wifi,
  Sparkles,
  Sliders,
  DollarSign,
  Printer,
  ChevronRight,
} from 'lucide-react';
import { useLanguage } from '../../../context/LanguageContext';
import { useToast } from '../../../context/ToastContext';
import { GraphicIcon, GraphicIconColor } from '../../../components/common/GraphicIcon';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';
import { Input } from '../../../components/common/Input';
import { Modal } from '../../../components/common/Modal';
import {
  QuickKeyItem,
  PaymentMethodItem,
  DiscountPresetItem,
  TaxBracketItem,
  ReceiptTemplateConfig,
} from '../types';

export interface SystemToolsManagementTabProps {
  quickKeys: QuickKeyItem[];
  onUpdateQuickKeys: (keys: QuickKeyItem[]) => void;
  paymentMethods: PaymentMethodItem[];
  onUpdatePaymentMethods: (methods: PaymentMethodItem[]) => void;
  discountPresets: DiscountPresetItem[];
  onUpdateDiscountPresets: (presets: DiscountPresetItem[]) => void;
  taxBrackets: TaxBracketItem[];
  onUpdateTaxBrackets: (brackets: TaxBracketItem[]) => void;
  receiptTemplate: ReceiptTemplateConfig;
  onUpdateReceiptTemplate: (tmpl: ReceiptTemplateConfig) => void;
}

export const SystemToolsManagementTab: React.FC<SystemToolsManagementTabProps> = ({
  quickKeys,
  onUpdateQuickKeys,
  paymentMethods,
  onUpdatePaymentMethods,
  discountPresets,
  onUpdateDiscountPresets,
  taxBrackets,
  onUpdateTaxBrackets,
  receiptTemplate,
  onUpdateReceiptTemplate,
}) => {
  const { language } = useLanguage();
  const { addToast } = useToast();

  const [activeSubSection, setActiveSubSection] = useState<
    'quick_keys' | 'payments' | 'discounts' | 'taxes' | 'receipt_builder' | 'diagnostics'
  >('quick_keys');

  // -------------------------------------------------------------
  // Quick Keys CRUD States
  // -------------------------------------------------------------
  const [isQuickKeyModalOpen, setIsQuickKeyModalOpen] = useState(false);
  const [editingQuickKey, setEditingQuickKey] = useState<QuickKeyItem | null>(null);
  const [quickKeyForm, setQuickKeyForm] = useState<Partial<QuickKeyItem>>({
    label: '',
    sku: '',
    price: 0,
    actionType: 'add_product',
    color: 'primary',
    iconName: 'Zap',
    isEnabled: true,
  });

  const handleOpenQuickKeyModal = (item?: QuickKeyItem) => {
    if (item) {
      setEditingQuickKey(item);
      setQuickKeyForm({ ...item });
    } else {
      setEditingQuickKey(null);
      setQuickKeyForm({
        id: `qk-${Date.now()}`,
        label: '',
        sku: '',
        price: 0,
        actionType: 'add_product',
        color: 'primary',
        iconName: 'Zap',
        sortOrder: quickKeys.length + 1,
        isEnabled: true,
      });
    }
    setIsQuickKeyModalOpen(true);
  };

  const handleSaveQuickKey = () => {
    if (!quickKeyForm.label?.trim()) {
      addToast({
        title: language === 'th' ? 'กรุณากรอกชื่อปุ่มลัด' : 'Label Required',
        message: language === 'th' ? 'ต้องระบุชื่อปุ่มลัด' : 'Please enter a key label',
        type: 'error',
      });
      return;
    }

    if (editingQuickKey) {
      const updated = quickKeys.map((k) =>
        k.id === editingQuickKey.id ? ({ ...k, ...quickKeyForm } as QuickKeyItem) : k
      );
      onUpdateQuickKeys(updated);
    } else {
      const newItem: QuickKeyItem = {
        id: `qk-${Date.now()}`,
        label: quickKeyForm.label || 'ปุ่มลัดใหม่',
        sku: quickKeyForm.sku || '',
        price: Number(quickKeyForm.price) || 0,
        actionType: quickKeyForm.actionType || 'add_product',
        color: quickKeyForm.color || 'primary',
        iconName: quickKeyForm.iconName || 'Zap',
        sortOrder: quickKeys.length + 1,
        isEnabled: quickKeyForm.isEnabled ?? true,
      };
      onUpdateQuickKeys([...quickKeys, newItem]);
    }

    setIsQuickKeyModalOpen(false);
    addToast({
      title: language === 'th' ? 'บันทึกปุ่มลัดสำเร็จ' : 'Quick Key Saved',
      message: language === 'th' ? 'อัปเดตปุ่มลัดในระบบแล้ว' : 'Quick action key updated.',
      type: 'success',
    });
  };

  const handleDeleteQuickKey = (id: string) => {
    onUpdateQuickKeys(quickKeys.filter((k) => k.id !== id));
    addToast({
      title: language === 'th' ? 'ลบปุ่มลัดแล้ว' : 'Quick Key Removed',
      message: language === 'th' ? 'ลบปุ่มลัดออกจากระบบแล้ว' : 'Deleted key successfully.',
      type: 'info',
    });
  };

  // -------------------------------------------------------------
  // Payment Methods CRUD States
  // -------------------------------------------------------------
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentMethodItem | null>(null);
  const [paymentForm, setPaymentForm] = useState<Partial<PaymentMethodItem>>({
    name: '',
    code: '',
    type: 'cash',
    color: 'emerald',
    feePercent: 0,
    minAmount: 0,
    requireApproval: false,
    isEnabled: true,
  });

  const handleOpenPaymentModal = (item?: PaymentMethodItem) => {
    if (item) {
      setEditingPayment(item);
      setPaymentForm({ ...item });
    } else {
      setEditingPayment(null);
      setPaymentForm({
        id: `pay-${Date.now()}`,
        name: '',
        code: `CUSTOM_${Date.now().toString().slice(-4)}`,
        type: 'ewallet',
        color: 'purple',
        iconName: 'CreditCard',
        feePercent: 0,
        minAmount: 0,
        requireApproval: false,
        isEnabled: true,
        sortOrder: paymentMethods.length + 1,
      });
    }
    setIsPaymentModalOpen(true);
  };

  const handleSavePaymentMethod = () => {
    if (!paymentForm.name?.trim()) {
      addToast({
        title: language === 'th' ? 'กรุณาระบุชื่อช่องทางชำระ' : 'Name Required',
        message: language === 'th' ? 'ต้องระบุชื่อช่องทางชำระ' : 'Please provide payment name',
        type: 'error',
      });
      return;
    }

    if (editingPayment) {
      const updated = paymentMethods.map((p) =>
        p.id === editingPayment.id ? ({ ...p, ...paymentForm } as PaymentMethodItem) : p
      );
      onUpdatePaymentMethods(updated);
    } else {
      const newItem: PaymentMethodItem = {
        id: `pay-${Date.now()}`,
        name: paymentForm.name || 'ช่องทางใหม่',
        code: paymentForm.code || `PAY_${Date.now().toString().slice(-4)}`,
        type: paymentForm.type || 'card',
        iconName: paymentForm.iconName || 'CreditCard',
        color: paymentForm.color || 'indigo',
        feePercent: Number(paymentForm.feePercent) || 0,
        minAmount: Number(paymentForm.minAmount) || 0,
        requireApproval: paymentForm.requireApproval || false,
        isEnabled: paymentForm.isEnabled ?? true,
        sortOrder: paymentMethods.length + 1,
      };
      onUpdatePaymentMethods([...paymentMethods, newItem]);
    }

    setIsPaymentModalOpen(false);
    addToast({
      title: language === 'th' ? 'บันทึกช่องทางชำระเงินแล้ว' : 'Payment Method Saved',
      message: language === 'th' ? 'ข้อมูลช่องทางชำระเงินอัปเดตเรียบร้อย' : 'Updated payment gateway.',
      type: 'success',
    });
  };

  const handleDeletePaymentMethod = (id: string) => {
    if (paymentMethods.length <= 1) {
      addToast({
        title: language === 'th' ? 'ไม่สามารถลบได้' : 'Cannot Delete',
        message: language === 'th' ? 'ต้องมีช่องทางชำระเงินอย่างน้อย 1 ช่องทาง' : 'Minimum 1 payment tender is required.',
        type: 'error',
      });
      return;
    }
    onUpdatePaymentMethods(paymentMethods.filter((p) => p.id !== id));
    addToast({
      title: language === 'th' ? 'ลบช่องทางชำระเงินแล้ว' : 'Payment Method Deleted',
      message: language === 'th' ? 'นำช่องทางชำระออกจากระบบเรียบร้อย' : 'Removed tender successfully.',
      type: 'info',
    });
  };

  // -------------------------------------------------------------
  // Discount Presets CRUD
  // -------------------------------------------------------------
  const [isDiscountModalOpen, setIsDiscountModalOpen] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<DiscountPresetItem | null>(null);
  const [discountForm, setDiscountForm] = useState<Partial<DiscountPresetItem>>({
    name: '',
    code: '',
    type: 'percentage',
    value: 10,
    minOrderAmount: 0,
    maxDiscountAmount: 1000,
    requireManagerPin: false,
    isEnabled: true,
  });

  const handleOpenDiscountModal = (item?: DiscountPresetItem) => {
    if (item) {
      setEditingDiscount(item);
      setDiscountForm({ ...item });
    } else {
      setEditingDiscount(null);
      setDiscountForm({
        id: `disc-${Date.now()}`,
        name: '',
        code: `DISC_${Date.now().toString().slice(-4)}`,
        type: 'percentage',
        value: 10,
        minOrderAmount: 0,
        maxDiscountAmount: 1000,
        requireManagerPin: false,
        isEnabled: true,
      });
    }
    setIsDiscountModalOpen(true);
  };

  const handleSaveDiscount = () => {
    if (!discountForm.name?.trim()) {
      addToast({
        title: language === 'th' ? 'กรุณาระบุชื่อส่วนลด' : 'Name Required',
        message: language === 'th' ? 'ต้องระบุชื่อส่วนลด' : 'Please provide discount name',
        type: 'error',
      });
      return;
    }

    if (editingDiscount) {
      const updated = discountPresets.map((d) =>
        d.id === editingDiscount.id ? ({ ...d, ...discountForm } as DiscountPresetItem) : d
      );
      onUpdateDiscountPresets(updated);
    } else {
      const newItem: DiscountPresetItem = {
        id: `disc-${Date.now()}`,
        name: discountForm.name || 'ส่วนลดใหม่',
        code: discountForm.code || `DISC_${Date.now().toString().slice(-4)}`,
        type: discountForm.type || 'percentage',
        value: Number(discountForm.value) || 0,
        minOrderAmount: Number(discountForm.minOrderAmount) || 0,
        maxDiscountAmount: Number(discountForm.maxDiscountAmount) || 0,
        requireManagerPin: discountForm.requireManagerPin || false,
        isEnabled: discountForm.isEnabled ?? true,
      };
      onUpdateDiscountPresets([...discountPresets, newItem]);
    }

    setIsDiscountModalOpen(false);
    addToast({
      title: language === 'th' ? 'บันทึกพรีเซ็ตส่วนลดแล้ว' : 'Discount Preset Saved',
      message: language === 'th' ? 'อัปเดตโปรโมชั่นส่วนลดในระบบแล้ว' : 'Discount configuration committed.',
      type: 'success',
    });
  };

  const handleDeleteDiscount = (id: string) => {
    onUpdateDiscountPresets(discountPresets.filter((d) => d.id !== id));
    addToast({
      title: language === 'th' ? 'ลบพรีเซ็ตส่วนลดแล้ว' : 'Discount Preset Deleted',
      message: language === 'th' ? 'ลบรายการส่วนลดออกจากระบบแล้ว' : 'Discount removed.',
      type: 'info',
    });
  };

  // -------------------------------------------------------------
  // Tax Brackets CRUD
  // -------------------------------------------------------------
  const [isTaxModalOpen, setIsTaxModalOpen] = useState(false);
  const [editingTax, setEditingTax] = useState<TaxBracketItem | null>(null);
  const [taxForm, setTaxForm] = useState<Partial<TaxBracketItem>>({
    name: '',
    rateBps: 700,
    isInclusive: true,
    isDefault: false,
    isEnabled: true,
    description: '',
  });

  const handleOpenTaxModal = (item?: TaxBracketItem) => {
    if (item) {
      setEditingTax(item);
      setTaxForm({ ...item });
    } else {
      setEditingTax(null);
      setTaxForm({
        id: `tax-${Date.now()}`,
        name: '',
        rateBps: 700,
        isInclusive: true,
        isDefault: false,
        isEnabled: true,
        description: '',
      });
    }
    setIsTaxModalOpen(true);
  };

  const handleSaveTaxBracket = () => {
    if (!taxForm.name?.trim()) {
      addToast({
        title: language === 'th' ? 'กรุณาระบุชื่อภาษี' : 'Name Required',
        message: language === 'th' ? 'ต้องระบุชื่อภาษี' : 'Please enter tax bracket name',
        type: 'error',
      });
      return;
    }

    if (editingTax) {
      let updated = taxBrackets.map((t) =>
        t.id === editingTax.id ? ({ ...t, ...taxForm } as TaxBracketItem) : t
      );
      if (taxForm.isDefault) {
        updated = updated.map((t) => ({
          ...t,
          isDefault: t.id === editingTax.id,
        }));
      }
      onUpdateTaxBrackets(updated);
    } else {
      let updated = [...taxBrackets];
      if (taxForm.isDefault) {
        updated = updated.map((t) => ({ ...t, isDefault: false }));
      }
      const newItem: TaxBracketItem = {
        id: `tax-${Date.now()}`,
        name: taxForm.name || 'ภาษีใหม่',
        rateBps: Number(taxForm.rateBps) || 0,
        isInclusive: taxForm.isInclusive ?? true,
        isDefault: taxForm.isDefault ?? false,
        isEnabled: taxForm.isEnabled ?? true,
        description: taxForm.description || '',
      };
      onUpdateTaxBrackets([...updated, newItem]);
    }

    setIsTaxModalOpen(false);
    addToast({
      title: language === 'th' ? 'บันทึกอัตราภาษีแล้ว' : 'Tax Bracket Saved',
      message: language === 'th' ? 'อัปเดตอัตราภาษีเรียบร้อย' : 'Updated tax rates.',
      type: 'success',
    });
  };

  const handleDeleteTaxBracket = (id: string) => {
    if (taxBrackets.length <= 1) {
      addToast({
        title: language === 'th' ? 'ไม่สามารถลบได้' : 'Cannot Delete',
        message: language === 'th' ? 'ต้องมีอัตราภาษีอย่างน้อย 1 รายการ' : 'Minimum 1 tax rate is required.',
        type: 'error',
      });
      return;
    }
    onUpdateTaxBrackets(taxBrackets.filter((t) => t.id !== id));
    addToast({
      title: language === 'th' ? 'ลบอัตราภาษีแล้ว' : 'Tax Bracket Deleted',
      message: language === 'th' ? 'นำอัตราภาษีออกจากระบบแล้ว' : 'Removed tax bracket.',
      type: 'info',
    });
  };

  // -------------------------------------------------------------
  // Full System Diagnostic & Backup Tools
  // -------------------------------------------------------------
  const handleExportFullBackup = () => {
    try {
      const backupData = {
        version: '2.4.0',
        timestamp: new Date().toISOString(),
        quickKeys,
        paymentMethods,
        discountPresets,
        taxBrackets,
        receiptTemplate,
        localStorageDump: { ...localStorage },
      };
      const blob = new Blob([JSON.stringify(backupData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `PRODX_SYSTEM_BACKUP_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      addToast({
        title: language === 'th' ? 'ส่งออกไฟล์สำรองสำเร็จ' : 'Backup Exported',
        message:
          language === 'th'
            ? 'ดาวน์โหลดไฟล์สำรองข้อมูลระบบทั้งหมดเรียบร้อยแล้ว'
            : 'Complete JSON backup archive saved to your device.',
        type: 'success',
      });
    } catch (e) {
      addToast({
        title: language === 'th' ? 'ส่งออกล้มเหลว' : 'Export Failed',
        message: String(e),
        type: 'error',
      });
    }
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const content = evt.target?.result as string;
        const parsed = JSON.parse(content);
        if (parsed.quickKeys) onUpdateQuickKeys(parsed.quickKeys);
        if (parsed.paymentMethods) onUpdatePaymentMethods(parsed.paymentMethods);
        if (parsed.discountPresets) onUpdateDiscountPresets(parsed.discountPresets);
        if (parsed.taxBrackets) onUpdateTaxBrackets(parsed.taxBrackets);
        if (parsed.receiptTemplate) onUpdateReceiptTemplate(parsed.receiptTemplate);

        addToast({
          title: language === 'th' ? 'กู้คืนระบบสำเร็จ' : 'Restore Successful',
          message:
            language === 'th'
              ? 'นำเข้าและกู้คืนการตั้งค่าระบบจากไฟล์เรียบร้อยแล้ว'
              : 'Restored all configurations from backup archive.',
          type: 'success',
        });
      } catch (err) {
        addToast({
          title: language === 'th' ? 'ไฟล์สำรองไม่ถูกต้อง' : 'Invalid Backup File',
          message: String(err),
          type: 'error',
        });
      }
    };
    reader.readAsText(file);
  };

  const getTenderIcon = (iconName: string) => {
    switch (iconName) {
      case 'Banknote':
        return Banknote;
      case 'QrCode':
        return QrCode;
      case 'Smartphone':
        return Smartphone;
      case 'Globe':
        return Globe;
      case 'Ticket':
        return Ticket;
      case 'Landmark':
        return Landmark;
      default:
        return CreditCard;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-card rounded-2xl border border-border border-crisp p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <GraphicIcon
              icon={Wrench}
              color="indigo"
              variant="glow"
              size="lg"
            />
            <div>
              <h2 className="text-base font-black text-text tracking-tight flex items-center gap-2">
                <span>
                  {language === 'th'
                    ? 'ศูนย์เครื่องมือจัดการคอมโพเนนต์และฟังก์ชันระบบ (Component Tools Hub)'
                    : 'System Component Management & Tools Hub'}
                </span>
                <Badge variant="primary" size="sm">
                  CRUD Ready
                </Badge>
              </h2>
              <p className="text-xs text-text/60 mt-0.5">
                {language === 'th'
                  ? 'เพิ่ม ลบ แก้ไข และกำหนดค่าปุ่มลัดด่วน, ช่องทางชำระเงิน, พรีเซ็ตส่วนลด, อัตราภาษี และตัวออกแบบใบเสร็จ'
                  : 'Full CRUD management for quick keys, payment tenders, discount presets, tax brackets, and thermal receipts.'}
              </p>
            </div>
          </div>
        </div>

        {/* Sub-Navigation Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-4 mt-4 border-t border-border/60">
          <button
            type="button"
            onClick={() => setActiveSubSection('quick_keys')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeSubSection === 'quick_keys'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-text/70 hover:bg-background hover:text-text'
            }`}
          >
            <Zap className="h-3.5 w-3.5" />
            <span>
              {language === 'th' ? 'ปุ่มลัดด่วน POS' : 'POS Quick Keys'}
            </span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20">
              {quickKeys.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubSection('payments')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeSubSection === 'payments'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-text/70 hover:bg-background hover:text-text'
            }`}
          >
            <CreditCard className="h-3.5 w-3.5" />
            <span>
              {language === 'th' ? 'ช่องทางชำระเงิน' : 'Payment Tenders'}
            </span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20">
              {paymentMethods.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubSection('discounts')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeSubSection === 'discounts'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-text/70 hover:bg-background hover:text-text'
            }`}
          >
            <Percent className="h-3.5 w-3.5" />
            <span>
              {language === 'th' ? 'พรีเซ็ตส่วนลด' : 'Discount Presets'}
            </span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20">
              {discountPresets.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubSection('taxes')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeSubSection === 'taxes'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-text/70 hover:bg-background hover:text-text'
            }`}
          >
            <DollarSign className="h-3.5 w-3.5" />
            <span>{language === 'th' ? 'อัตราภาษี & VAT' : 'Tax Brackets'}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/20">
              {taxBrackets.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubSection('receipt_builder')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeSubSection === 'receipt_builder'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-text/70 hover:bg-background hover:text-text'
            }`}
          >
            <Receipt className="h-3.5 w-3.5" />
            <span>
              {language === 'th'
                ? 'ออกแบบใบเสร็จ (Visual Builder)'
                : 'Receipt Builder'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubSection('diagnostics')}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 shrink-0 cursor-pointer ${
              activeSubSection === 'diagnostics'
                ? 'bg-primary text-primary-foreground shadow-xs'
                : 'text-text/70 hover:bg-background hover:text-text'
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            <span>
              {language === 'th' ? 'สำรอง & กู้คืนระบบ' : 'Backup & Tools'}
            </span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 1. POS QUICK KEYS MANAGEMENT */}
      {/* ========================================================================= */}
      {activeSubSection === 'quick_keys' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-text">
                {language === 'th'
                  ? 'รายการปุ่มลัดด่วนหน้าแคชเชียร์ (POS Quick Keys Grid)'
                  : 'POS Fast Action Keys'}
              </h3>
              <p className="text-xs text-text/60">
                {language === 'th'
                  ? 'สร้างปุ่มทางลัดสำหรับสินค้ายอดนิยม ส่วนลด หรือคำสั่งเปิดลิ้นชัก'
                  : 'Customize fast shortcut tiles for top sellers, discounts, and no-sale drawer triggers.'}
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleOpenQuickKeyModal()}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              {language === 'th' ? 'เพิ่มปุ่มลัดใหม่' : 'Add Quick Key'}
            </Button>
          </div>

          {/* Simulated POS Quick Keys Live Bar */}
          <div className="p-4 rounded-2xl bg-card border border-border border-crisp">
            <div className="text-[11px] font-bold text-text/50 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5 text-primary" />
              <span>
                {language === 'th'
                  ? 'ตัวอย่างการแสดงผลบนหน้าจอขาย (Live POS Simulation)'
                  : 'Live POS Preview'}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
              {quickKeys
                .filter((k) => k.isEnabled)
                .map((k) => (
                  <div
                    key={k.id}
                    className="p-2.5 rounded-xl border border-border bg-background flex flex-col items-center justify-center text-center gap-1.5 min-h-[72px] shadow-2xs"
                  >
                    <GraphicIcon
                      icon={Zap}
                      color={k.color}
                      variant="badge"
                      size="sm"
                      animateHover={false}
                    />
                    <div className="text-[11px] font-bold text-text line-clamp-1">
                      {k.label}
                    </div>
                    {k.price ? (
                      <span className="text-[10px] font-bold text-primary">
                        ฿{k.price}
                      </span>
                    ) : (
                      <span className="text-[9px] font-mono text-text/50 uppercase">
                        {k.actionType}
                      </span>
                    )}
                  </div>
                ))}
            </div>
          </div>

          {/* Quick Keys Table */}
          <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
            <div className="w-full overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-left text-xs">
                <thead className="bg-background border-b border-border/80 text-text/60 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="py-3 px-4">#</th>
                    <th className="py-3 px-4">
                      {language === 'th' ? 'ปุ่มลัด' : 'Tile & Color'}
                    </th>
                    <th className="py-3 px-4">
                      {language === 'th' ? 'ประเภทคำสั่ง' : 'Action Type'}
                    </th>
                    <th className="py-3 px-4">SKU / ราคา</th>
                    <th className="py-3 px-4">
                      {language === 'th' ? 'สถานะ' : 'Status'}
                    </th>
                    <th className="py-3 px-4 text-right">
                      {language === 'th' ? 'จัดการ' : 'Actions'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60 font-medium">
                  {quickKeys.map((item, idx) => (
                    <tr
                      key={item.id}
                      className="hover:bg-background/60 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono text-text/50">
                        {idx + 1}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5">
                          <GraphicIcon
                            icon={Zap}
                            color={item.color}
                            variant="badge"
                            size="sm"
                          />
                          <div>
                            <div className="font-bold text-text">
                              {item.label}
                            </div>
                            <div className="text-[10px] text-text/40 font-mono">
                              ID: {item.id}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <Badge variant="neutral" size="sm" className="capitalize">
                          {item.actionType.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        {item.price ? (
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            ฿{item.price.toFixed(2)}
                          </span>
                        ) : item.sku ? (
                          <span className="font-mono text-text/60">{item.sku}</span>
                        ) : (
                          <span className="text-text/40">-</span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => {
                            const updated = quickKeys.map((k) =>
                              k.id === item.id ? { ...k, isEnabled: !k.isEnabled } : k
                            );
                            onUpdateQuickKeys(updated);
                          }}
                          className="cursor-pointer"
                        >
                          <Badge
                            variant={item.isEnabled ? 'success' : 'neutral'}
                            size="sm"
                          >
                            {item.isEnabled
                              ? language === 'th'
                                ? 'เปิดใช้งาน'
                                : 'Active'
                              : language === 'th'
                              ? 'ปิด'
                              : 'Disabled'}
                          </Badge>
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenQuickKeyModal(item)}
                            className="p-1.5 rounded-lg hover:bg-background text-text/70 hover:text-primary transition-colors cursor-pointer"
                            title="Edit"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteQuickKey(item.id)}
                            className="p-1.5 rounded-lg hover:bg-rose-500/10 text-text/70 hover:text-rose-500 transition-colors cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 2. PAYMENT METHODS CRUD */}
      {/* ========================================================================= */}
      {activeSubSection === 'payments' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-text">
                {language === 'th'
                  ? 'ช่องทางและเกตเวย์การชำระเงิน (Tender Payment Rails)'
                  : 'Payment Channels & Tenders'}
              </h3>
              <p className="text-xs text-text/60">
                {language === 'th'
                  ? 'กำหนดค่าช่องทางชำระเงินสด พร้อมเพย์ บัตรเครดิต ทรูมันนี่ และวงเงินเชื่อ'
                  : 'Configure active tender options, merchant fee surcharges, and manager authorization rules.'}
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleOpenPaymentModal()}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              {language === 'th' ? 'เพิ่มช่องทางชำระ' : 'Add Payment Rail'}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {paymentMethods.map((tender) => {
              const TenderIcon = getTenderIcon(tender.iconName);
              return (
                <div
                  key={tender.id}
                  className={`p-4 rounded-2xl border transition-all flex flex-col justify-between gap-3 bg-card ${
                    tender.isEnabled
                      ? 'border-border/90 shadow-xs'
                      : 'border-border/40 opacity-70 bg-card/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <GraphicIcon
                      icon={TenderIcon}
                      color={tender.color}
                      variant="badge"
                      size="md"
                    />
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleOpenPaymentModal(tender)}
                        className="p-1 rounded-lg hover:bg-background text-text/60 hover:text-primary transition-colors cursor-pointer"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePaymentMethod(tender.id)}
                        className="p-1 rounded-lg hover:bg-rose-500/10 text-text/60 hover:text-rose-500 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div>
                    <div className="font-bold text-xs text-text">{tender.name}</div>
                    <div className="text-[10px] font-mono text-text/50 uppercase mt-0.5">
                      CODE: {tender.code}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border/60 flex items-center justify-between text-[11px]">
                    <div className="text-text/60">
                      {tender.feePercent > 0 ? (
                        <span className="text-amber-500 font-bold">
                          +{tender.feePercent}% Fee
                        </span>
                      ) : (
                        <span className="text-emerald-500 font-bold">0% Fee</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const updated = paymentMethods.map((p) =>
                          p.id === tender.id ? { ...p, isEnabled: !p.isEnabled } : p
                        );
                        onUpdatePaymentMethods(updated);
                      }}
                      className="cursor-pointer"
                    >
                      <Badge
                        variant={tender.isEnabled ? 'success' : 'neutral'}
                        size="sm"
                      >
                        {tender.isEnabled
                          ? language === 'th'
                            ? 'เปิด'
                            : 'Active'
                          : language === 'th'
                          ? 'ปิด'
                          : 'Disabled'}
                      </Badge>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. DISCOUNT PRESETS CRUD */}
      {/* ========================================================================= */}
      {activeSubSection === 'discounts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-text">
                {language === 'th'
                  ? 'พรีเซ็ตส่วนลดและคูปอง (Discount Presets & Promotions)'
                  : 'Discount Presets & Coupons'}
              </h3>
              <p className="text-xs text-text/60">
                {language === 'th'
                  ? 'กำหนดส่วนลดแบบเปอร์เซ็นต์ หรือยอดคงที่ พร้อมเงื่อนไขรหัส PIN ผู้จัดการ'
                  : 'Preset standard discount percentages, fixed vouchers, and supervisor approval caps.'}
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleOpenDiscountModal()}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              {language === 'th' ? 'เพิ่มส่วนลดใหม่' : 'Add Discount Preset'}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {discountPresets.map((disc) => (
              <div
                key={disc.id}
                className="p-4 rounded-2xl border border-border bg-card shadow-xs flex flex-col justify-between gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <GraphicIcon
                      icon={Percent}
                      color="rose"
                      variant="badge"
                      size="sm"
                    />
                    <div>
                      <div className="font-bold text-xs text-text">
                        {disc.name}
                      </div>
                      <div className="text-[10px] font-mono text-text/40">
                        {disc.code}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenDiscountModal(disc)}
                      className="p-1 rounded-lg hover:bg-background text-text/60 hover:text-primary transition-colors cursor-pointer"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteDiscount(disc.id)}
                      className="p-1 rounded-lg hover:bg-rose-500/10 text-text/60 hover:text-rose-500 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="bg-background rounded-xl p-3 border border-border/70 flex items-center justify-between">
                  <div className="text-[11px] text-text/60">
                    {language === 'th' ? 'มูลค่าส่วนลด' : 'Discount Value'}
                  </div>
                  <div className="text-base font-black text-rose-500">
                    {disc.type === 'percentage'
                      ? `${disc.value}%`
                      : `฿${disc.value.toFixed(2)}`}
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-text/60">
                  <div className="flex items-center gap-1">
                    {disc.requireManagerPin && (
                      <span className="flex items-center gap-1 text-amber-500 font-bold">
                        <Lock className="h-3 w-3" />
                        {language === 'th' ? 'ต้องใช้ PIN ผู้จัดการ' : 'Requires PIN'}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = discountPresets.map((d) =>
                        d.id === disc.id ? { ...d, isEnabled: !d.isEnabled } : d
                      );
                      onUpdateDiscountPresets(updated);
                    }}
                    className="cursor-pointer"
                  >
                    <Badge
                      variant={disc.isEnabled ? 'success' : 'neutral'}
                      size="sm"
                    >
                      {disc.isEnabled
                        ? language === 'th'
                          ? 'เปิด'
                          : 'Active'
                        : language === 'th'
                        ? 'ปิด'
                        : 'Disabled'}
                    </Badge>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. TAX BRACKETS CRUD */}
      {/* ========================================================================= */}
      {activeSubSection === 'taxes' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-text">
                {language === 'th'
                  ? 'อัตราภาษีและเซอร์วิสชาร์จ (Tax & Surcharge Brackets)'
                  : 'Tax Rates & Surcharges'}
              </h3>
              <p className="text-xs text-text/60">
                {language === 'th'
                  ? 'จัดการอัตราภาษี VAT 7%, ยกเว้นภาษี 0% หรือค่าบริการเซอร์วิสชาร์จ 10%'
                  : 'Configure VAT basis points, tax calculation mode (inclusive/exclusive), and service charge rules.'}
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleOpenTaxModal()}
              leftIcon={<Plus className="h-4 w-4" />}
            >
              {language === 'th' ? 'เพิ่มอัตราภาษี' : 'Add Tax Rate'}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {taxBrackets.map((tax) => (
              <div
                key={tax.id}
                className="p-4 rounded-2xl border border-border bg-card shadow-xs flex flex-col justify-between gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <GraphicIcon
                      icon={DollarSign}
                      color="emerald"
                      variant="badge"
                      size="sm"
                    />
                    <div>
                      <div className="font-bold text-xs text-text flex items-center gap-1.5">
                        <span>{tax.name}</span>
                        {tax.isDefault && (
                          <Badge variant="primary" size="sm" className="text-[9px]">
                            {language === 'th' ? 'ค่าเริ่มต้น' : 'Default'}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-text/50 mt-0.5">
                        {tax.description}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenTaxModal(tax)}
                      className="p-1 rounded-lg hover:bg-background text-text/60 hover:text-primary transition-colors cursor-pointer"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTaxBracket(tax.id)}
                      className="p-1 rounded-lg hover:bg-rose-500/10 text-text/60 hover:text-rose-500 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="pt-3 border-t border-border/60 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <div>
                      <span className="text-[10px] text-text/50 block">อัตรา</span>
                      <span className="font-black text-text">
                        {(tax.rateBps / 100).toFixed(2)}%
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-text/50 block">การคิด</span>
                      <span className="font-semibold text-text/80">
                        {tax.isInclusive
                          ? language === 'th'
                            ? 'รวมในราคา (Inclusive)'
                            : 'Inclusive'
                          : language === 'th'
                          ? 'คิดเพิ่มนอกราคา (Exclusive)'
                          : 'Exclusive'}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      const updated = taxBrackets.map((t) =>
                        t.id === tax.id ? { ...t, isEnabled: !t.isEnabled } : t
                      );
                      onUpdateTaxBrackets(updated);
                    }}
                    className="cursor-pointer"
                  >
                    <Badge
                      variant={tax.isEnabled ? 'success' : 'neutral'}
                      size="sm"
                    >
                      {tax.isEnabled
                        ? language === 'th'
                          ? 'เปิด'
                          : 'Active'
                        : language === 'th'
                        ? 'ปิด'
                        : 'Disabled'}
                    </Badge>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 5. VISUAL THERMAL RECEIPT BUILDER & DESIGNER */}
      {/* ========================================================================= */}
      {activeSubSection === 'receipt_builder' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Form Settings Controls (Left 7 Cols) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="bg-card rounded-2xl border border-border border-crisp p-5 shadow-xs space-y-4">
              <h3 className="text-sm font-black text-text">
                {language === 'th'
                  ? 'กำหนดค่าข้อมูลบนใบเสร็จรับเงิน (Thermal Receipt Customizer)'
                  : 'Thermal Receipt Customizer'}
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label={language === 'th' ? 'ชื่อหัวร้าน' : 'Store Header Name'}
                  value={receiptTemplate.storeName}
                  onChange={(e) =>
                    onUpdateReceiptTemplate({
                      ...receiptTemplate,
                      storeName: e.target.value,
                    })
                  }
                />
                <Input
                  label={language === 'th' ? 'ชื่อสาขา' : 'Branch Name'}
                  value={receiptTemplate.branchName}
                  onChange={(e) =>
                    onUpdateReceiptTemplate({
                      ...receiptTemplate,
                      branchName: e.target.value,
                    })
                  }
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label={
                    language === 'th'
                      ? 'เลขประจำตัวผู้เสียภาษี (Tax ID)'
                      : 'Tax ID'
                  }
                  value={receiptTemplate.taxId}
                  onChange={(e) =>
                    onUpdateReceiptTemplate({
                      ...receiptTemplate,
                      taxId: e.target.value,
                    })
                  }
                />
                <Input
                  label={
                    language === 'th' ? 'เบอร์โทรศัพท์ร้าน' : 'Store Phone'
                  }
                  value={receiptTemplate.phone}
                  onChange={(e) =>
                    onUpdateReceiptTemplate({
                      ...receiptTemplate,
                      phone: e.target.value,
                    })
                  }
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-text mb-1">
                  {language === 'th' ? 'ที่อยู่ร้าน' : 'Store Address'}
                </label>
                <textarea
                  rows={2}
                  value={receiptTemplate.address}
                  onChange={(e) =>
                    onUpdateReceiptTemplate({
                      ...receiptTemplate,
                      address: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-border bg-background text-text focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-text mb-1">
                  {language === 'th'
                    ? 'ข้อความส่วนท้ายใบเสร็จ (Footer Return Policy)'
                    : 'Footer Message'}
                </label>
                <textarea
                  rows={2}
                  value={receiptTemplate.footerMessage}
                  onChange={(e) =>
                    onUpdateReceiptTemplate({
                      ...receiptTemplate,
                      footerMessage: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 text-xs font-medium rounded-xl border border-border bg-background text-text focus:outline-hidden focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* Wi-Fi Info Fields */}
              <div className="pt-3 border-t border-border/60">
                <div className="text-xs font-bold text-text mb-2 flex items-center gap-1.5">
                  <Wifi className="h-4 w-4 text-primary" />
                  <span>
                    {language === 'th'
                      ? 'ข้อมูล Wi-Fi ให้บริการลูกค้า'
                      : 'Customer Wi-Fi Broadcast'}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="Wi-Fi SSID"
                    value={receiptTemplate.wifiSsid}
                    onChange={(e) =>
                      onUpdateReceiptTemplate({
                        ...receiptTemplate,
                        wifiSsid: e.target.value,
                      })
                    }
                  />
                  <Input
                    label="Wi-Fi Password"
                    value={receiptTemplate.wifiPassword}
                    onChange={(e) =>
                      onUpdateReceiptTemplate({
                        ...receiptTemplate,
                        wifiPassword: e.target.value,
                      })
                    }
                  />
                </div>
              </div>

              {/* Toggles List */}
              <div className="pt-3 border-t border-border/60 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="flex items-center justify-between p-2.5 rounded-xl bg-background border border-border/60 cursor-pointer">
                  <span className="font-semibold text-text">
                    {language === 'th'
                      ? 'แสดงสรุปแยกยอดภาษี'
                      : 'Tax Breakdown'}
                  </span>
                  <input
                    type="checkbox"
                    checked={receiptTemplate.showTaxBreakdown}
                    onChange={(e) =>
                      onUpdateReceiptTemplate({
                        ...receiptTemplate,
                        showTaxBreakdown: e.target.checked,
                      })
                    }
                    className="rounded text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-2.5 rounded-xl bg-background border border-border/60 cursor-pointer">
                  <span className="font-semibold text-text">
                    {language === 'th' ? 'แสดงชื่อแคชเชียร์' : 'Cashier Name'}
                  </span>
                  <input
                    type="checkbox"
                    checked={receiptTemplate.showCashierName}
                    onChange={(e) =>
                      onUpdateReceiptTemplate({
                        ...receiptTemplate,
                        showCashierName: e.target.checked,
                      })
                    }
                    className="rounded text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-2.5 rounded-xl bg-background border border-border/60 cursor-pointer">
                  <span className="font-semibold text-text">
                    {language === 'th'
                      ? 'แสดงบาร์โค้ดหมายเลขบิล'
                      : 'Barcode on Receipt'}
                  </span>
                  <input
                    type="checkbox"
                    checked={receiptTemplate.showBarcode}
                    onChange={(e) =>
                      onUpdateReceiptTemplate({
                        ...receiptTemplate,
                        showBarcode: e.target.checked,
                      })
                    }
                    className="rounded text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                  />
                </label>

                <label className="flex items-center justify-between p-2.5 rounded-xl bg-background border border-border/60 cursor-pointer">
                  <span className="font-semibold text-text">
                    {language === 'th'
                      ? 'แสดงแต้มสะสมสมาชิก'
                      : 'Member Points'}
                  </span>
                  <input
                    type="checkbox"
                    checked={receiptTemplate.showCustomerLoyalty}
                    onChange={(e) =>
                      onUpdateReceiptTemplate({
                        ...receiptTemplate,
                        showCustomerLoyalty: e.target.checked,
                      })
                    }
                    className="rounded text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Live Simulated Thermal Receipt Paper (Right 5 Cols) */}
          <div className="lg:col-span-5 flex flex-col items-center">
            <div className="w-full max-w-[320px] bg-white text-black p-5 rounded-md shadow-2xl font-mono text-[11px] leading-tight border border-neutral-300">
              {/* Header */}
              <div className="text-center space-y-1 pb-3 border-b border-dashed border-neutral-400">
                <div className="font-black text-sm tracking-wider uppercase">
                  {receiptTemplate.storeName}
                </div>
                <div className="text-[10px] text-neutral-600">
                  {receiptTemplate.branchName}
                </div>
                <div className="text-[9px] text-neutral-500">
                  {receiptTemplate.address}
                </div>
                <div className="text-[9px] text-neutral-500">
                  TAX ID: {receiptTemplate.taxId} | TEL: {receiptTemplate.phone}
                </div>
              </div>

              {/* Meta */}
              <div className="py-2.5 border-b border-dashed border-neutral-400 text-[10px] space-y-0.5">
                <div className="flex justify-between">
                  <span>RECEIPT #: INV-20260906-0042</span>
                </div>
                <div className="flex justify-between text-neutral-600">
                  <span>DATE: 06/09/2026 12:45</span>
                  <span>POS: {receiptTemplate.posId}</span>
                </div>
                {receiptTemplate.showCashierName && (
                  <div className="flex justify-between text-neutral-600">
                    <span>CASHIER: Somchai P.</span>
                    <span>TYPE: DINE-IN</span>
                  </div>
                )}
              </div>

              {/* Items List */}
              <div className="py-2.5 border-b border-dashed border-neutral-400 space-y-1.5">
                <div className="flex justify-between">
                  <div>
                    <div className="font-bold">1x ESPRESSO HOT (REG)</div>
                    <div className="text-[9px] text-neutral-500">
                      BEV-HOT-ESP
                    </div>
                  </div>
                  <span className="font-bold">฿55.00</span>
                </div>

                <div className="flex justify-between">
                  <div>
                    <div className="font-bold">2x MATCHA LATTE (ICE)</div>
                    <div className="text-[9px] text-neutral-500">
                      @฿65.00 / ea
                    </div>
                  </div>
                  <span className="font-bold">฿130.00</span>
                </div>

                <div className="flex justify-between">
                  <div>
                    <div className="font-bold">1x BUTTER CROISSANT</div>
                    <div className="text-[9px] text-neutral-500">BAK-CR-001</div>
                  </div>
                  <span className="font-bold">฿75.00</span>
                </div>
              </div>

              {/* Totals */}
              <div className="py-2.5 border-b border-dashed border-neutral-400 space-y-1">
                <div className="flex justify-between">
                  <span>SUBTOTAL</span>
                  <span>฿260.00</span>
                </div>
                <div className="flex justify-between text-neutral-600">
                  <span>VIP DISCOUNT (5%)</span>
                  <span>-฿13.00</span>
                </div>
                <div className="flex justify-between font-black text-sm pt-1 border-t border-neutral-300">
                  <span>TOTAL NET</span>
                  <span>฿247.00</span>
                </div>
                <div className="flex justify-between text-[10px] text-neutral-600 pt-1">
                  <span>PROMPTPAY QR</span>
                  <span>฿247.00</span>
                </div>
              </div>

              {/* Tax breakdown */}
              {receiptTemplate.showTaxBreakdown && (
                <div className="py-2 border-b border-dashed border-neutral-400 text-[9px] text-neutral-600 space-y-0.5">
                  <div className="flex justify-between">
                    <span>VAT INCLUDED (7%)</span>
                    <span>฿16.16</span>
                  </div>
                  <div className="flex justify-between">
                    <span>TAXABLE AMOUNT</span>
                    <span>฿230.84</span>
                  </div>
                </div>
              )}

              {/* Loyalty info */}
              {receiptTemplate.showCustomerLoyalty && (
                <div className="py-2 border-b border-dashed border-neutral-400 text-[9px] text-neutral-700 text-center space-y-0.5 bg-neutral-100 p-1.5 rounded">
                  <div className="font-bold">MEMBER: K. THANAPAT (SILVER VIP)</div>
                  <div>POINTS EARNED: +9 PTS | BALANCE: 480 PTS</div>
                </div>
              )}

              {/* Wi-Fi Details */}
              {receiptTemplate.showWifiInfo && (
                <div className="py-2 text-[9px] text-center border-b border-dashed border-neutral-400">
                  <div className="font-bold">FREE CUSTOMER WI-FI</div>
                  <div>SSID: {receiptTemplate.wifiSsid}</div>
                  <div>PASS: {receiptTemplate.wifiPassword}</div>
                </div>
              )}

              {/* Barcode & Footer */}
              <div className="pt-3 text-center space-y-2">
                {receiptTemplate.showBarcode && (
                  <div className="flex flex-col items-center">
                    <div className="font-mono text-lg tracking-[0.25em] font-black border-y border-neutral-800 py-1">
                      ||| | | |||| | || | |||
                    </div>
                    <span className="text-[8px] tracking-widest text-neutral-500">
                      *INV-20260906-0042*
                    </span>
                  </div>
                )}
                <div className="text-[9px] text-neutral-600 leading-snug">
                  {receiptTemplate.footerMessage}
                </div>
                <div className="text-[8px] text-neutral-400">
                  --- THANK YOU FOR VISITING ---
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 6. SYSTEM DIAGNOSTICS & BACKUP TOOLS */}
      {/* ========================================================================= */}
      {activeSubSection === 'diagnostics' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Full Encrypted JSON Backup */}
            <div className="p-5 rounded-2xl bg-card border border-border border-crisp shadow-xs space-y-3">
              <GraphicIcon
                icon={Download}
                color="emerald"
                variant="badge"
                size="md"
              />
              <div>
                <h4 className="text-sm font-black text-text">
                  {language === 'th'
                    ? 'ส่งออกสำรองข้อมูลระบบ (Full JSON Backup)'
                    : 'Export Complete Backup'}
                </h4>
                <p className="text-xs text-text/60 mt-1">
                  {language === 'th'
                    ? 'บันทึกการตั้งค่า โมดูล สต็อก ปุ่มลัด และนโยบายความปลอดภัยทั้งหมด'
                    : 'Download complete system snapshots including catalog, tenders, and permissions.'}
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                className="w-full"
                onClick={handleExportFullBackup}
                leftIcon={<Download className="h-4 w-4" />}
              >
                {language === 'th'
                  ? 'ดาวน์โหลดไฟล์สำรอง .JSON'
                  : 'Download .JSON Backup'}
              </Button>
            </div>

            {/* Restore from JSON Backup */}
            <div className="p-5 rounded-2xl bg-card border border-border border-crisp shadow-xs space-y-3">
              <GraphicIcon
                icon={Upload}
                color="indigo"
                variant="badge"
                size="md"
              />
              <div>
                <h4 className="text-sm font-black text-text">
                  {language === 'th'
                    ? 'กู้คืนระบบจากไฟล์สำรอง (Restore from Backup)'
                    : 'Restore from Backup'}
                </h4>
                <p className="text-xs text-text/60 mt-1">
                  {language === 'th'
                    ? 'นำเข้าและกู้คืนการตั้งค่าระบบจากไฟล์ JSON ที่สำรองไว้ก่อนหน้า'
                    : 'Upload previously exported JSON backup to reconstruct complete parameters.'}
                </p>
              </div>
              <label className="block w-full">
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportBackup}
                  className="hidden"
                />
                <span className="w-full h-9 px-4 rounded-xl border border-border bg-background hover:bg-card text-xs font-bold text-text flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-2xs">
                  <Upload className="h-4 w-4 text-primary" />
                  <span>
                    {language === 'th' ? 'เลือกไฟล์ .JSON' : 'Select Backup File'}
                  </span>
                </span>
              </label>
            </div>

            {/* Storage Inspector */}
            <div className="p-5 rounded-2xl bg-card border border-border border-crisp shadow-xs space-y-3">
              <GraphicIcon
                icon={Database}
                color="cyan"
                variant="badge"
                size="md"
              />
              <div>
                <h4 className="text-sm font-black text-text">
                  {language === 'th'
                    ? 'พื้นที่จัดเก็บในเครื่อง (Storage Health)'
                    : 'Storage Diagnostics'}
                </h4>
                <p className="text-xs text-text/60 mt-1">
                  {language === 'th'
                    ? 'IndexedDB แคชออฟไลน์ และ LocalStorage กุญแจระบบ'
                    : 'Local cache capacity, active sync queues, and database health.'}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-background border border-border/70 text-xs flex justify-between items-center">
                <span className="text-text/60 font-semibold">IndexedDB Cache</span>
                <span className="font-bold text-emerald-500">100% Healthy</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD/EDIT QUICK KEY */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isQuickKeyModalOpen}
        onClose={() => setIsQuickKeyModalOpen(false)}
        title={
          editingQuickKey
            ? language === 'th'
              ? 'แก้ไขปุ่มลัด'
              : 'Edit Quick Key'
            : language === 'th'
            ? 'เพิ่มปุ่มลัดใหม่'
            : 'Add Quick Key'
        }
      >
        <div className="space-y-4">
          <Input
            label={language === 'th' ? 'ชื่อปุ่มลัด (Label)' : 'Tile Label'}
            value={quickKeyForm.label}
            onChange={(e) =>
              setQuickKeyForm({ ...quickKeyForm, label: e.target.value })
            }
            placeholder="เช่น กาแฟเอสเพรสโซ่ร้อน"
          />

          <div>
            <label className="block text-xs font-bold text-text mb-1">
              {language === 'th' ? 'ประเภทคำสั่ง (Action)' : 'Action Type'}
            </label>
            <select
              value={quickKeyForm.actionType}
              onChange={(e) =>
                setQuickKeyForm({
                  ...quickKeyForm,
                  actionType: e.target.value as any,
                })
              }
              className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-border bg-background text-text"
            >
              <option value="add_product">
                {language === 'th' ? 'เพิ่มสินค้าลงตะกร้า' : 'Add Product'}
              </option>
              <option value="discount">
                {language === 'th' ? 'ใช้ส่วนลด' : 'Apply Discount'}
              </option>
              <option value="open_drawer">
                {language === 'th' ? 'เตะเปิดลิ้นชัก (No Sale)' : 'Open Cash Drawer'}
              </option>
              <option value="print_last">
                {language === 'th' ? 'พิมพ์ใบเสร็จล่าสุด' : 'Print Last Receipt'}
              </option>
              <option value="custom_amount">
                {language === 'th' ? 'สินค้าราคากำหนดเอง' : 'Custom Amount Item'}
              </option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="SKU สินค้า (ถ้ามี)"
              value={quickKeyForm.sku}
              onChange={(e) =>
                setQuickKeyForm({ ...quickKeyForm, sku: e.target.value })
              }
              placeholder="BEV-HOT-01"
            />
            <Input
              label={language === 'th' ? 'ราคา (บาท)' : 'Price (THB)'}
              type="number"
              value={quickKeyForm.price || ''}
              onChange={(e) =>
                setQuickKeyForm({
                  ...quickKeyForm,
                  price: Number(e.target.value),
                })
              }
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-text mb-1.5">
              {language === 'th' ? 'โทนสีกราฟฟิกไอคอน' : 'Graphic Color'}
            </label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  'primary',
                  'emerald',
                  'amber',
                  'rose',
                  'indigo',
                  'purple',
                  'cyan',
                  'orange',
                ] as GraphicIconColor[]
              ).map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() =>
                    setQuickKeyForm({ ...quickKeyForm, color: col })
                  }
                  className={`p-1.5 rounded-xl border cursor-pointer transition-all ${
                    quickKeyForm.color === col
                      ? 'border-primary ring-2 ring-primary/30'
                      : 'border-border'
                  }`}
                >
                  <GraphicIcon
                    icon={Zap}
                    color={col}
                    variant="badge"
                    size="sm"
                    animateHover={false}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-border/60 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsQuickKeyModalOpen(false)}
            >
              {language === 'th' ? 'ยกเลิก' : 'Cancel'}
            </Button>
            <Button variant="primary" size="sm" onClick={handleSaveQuickKey}>
              {language === 'th' ? 'บันทึกข้อมูล' : 'Save Quick Key'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: ADD/EDIT PAYMENT METHOD */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        title={
          editingPayment
            ? language === 'th'
              ? 'แก้ไขช่องทางชำระเงิน'
              : 'Edit Payment Rail'
            : language === 'th'
            ? 'เพิ่มช่องทางชำระเงินใหม่'
            : 'Add Payment Rail'
        }
      >
        <div className="space-y-4">
          <Input
            label={language === 'th' ? 'ชื่อช่องทางชำระ' : 'Payment Name'}
            value={paymentForm.name}
            onChange={(e) =>
              setPaymentForm({ ...paymentForm, name: e.target.value })
            }
            placeholder="เช่น TrueMoney Wallet"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="รหัสช่องทาง (Code)"
              value={paymentForm.code}
              onChange={(e) =>
                setPaymentForm({ ...paymentForm, code: e.target.value })
              }
              placeholder="TRUEMONEY"
            />
            <div>
              <label className="block text-xs font-bold text-text mb-1">
                {language === 'th' ? 'ประเภท' : 'Tender Type'}
              </label>
              <select
                value={paymentForm.type}
                onChange={(e) =>
                  setPaymentForm({ ...paymentForm, type: e.target.value as any })
                }
                className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-border bg-background text-text"
              >
                <option value="cash">เงินสด (Cash)</option>
                <option value="qr">พร้อมเพย์ / QR Code</option>
                <option value="card">บัตรเครดิต/เดบิต (Card)</option>
                <option value="ewallet">กระเป๋าเงินดิจิทัล (e-Wallet)</option>
                <option value="voucher">บัตรกำนัล (Voucher)</option>
                <option value="credit">วงเงินเชื่อ (Store Credit)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={language === 'th' ? 'ค่าธรรมเนียม (%)' : 'Surcharge Fee (%)'}
              type="number"
              value={paymentForm.feePercent || ''}
              onChange={(e) =>
                setPaymentForm({
                  ...paymentForm,
                  feePercent: Number(e.target.value),
                })
              }
              placeholder="0.00"
            />
            <Input
              label={language === 'th' ? 'ยอดขั้นต่ำ (บาท)' : 'Min Spend (THB)'}
              type="number"
              value={paymentForm.minAmount || ''}
              onChange={(e) =>
                setPaymentForm({
                  ...paymentForm,
                  minAmount: Number(e.target.value),
                })
              }
              placeholder="0"
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-bold text-text cursor-pointer">
            <input
              type="checkbox"
              checked={paymentForm.requireApproval}
              onChange={(e) =>
                setPaymentForm({
                  ...paymentForm,
                  requireApproval: e.target.checked,
                })
              }
              className="rounded text-primary focus:ring-primary h-4 w-4"
            />
            <span>
              {language === 'th'
                ? 'ต้องได้รับการอนุมัติจากผู้จัดการ (Supervisor Approval)'
                : 'Require Manager PIN approval'}
            </span>
          </label>

          <div className="pt-3 border-t border-border/60 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsPaymentModalOpen(false)}
            >
              {language === 'th' ? 'ยกเลิก' : 'Cancel'}
            </Button>
            <Button variant="primary" size="sm" onClick={handleSavePaymentMethod}>
              {language === 'th' ? 'บันทึกช่องทางชำระ' : 'Save Payment Rail'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: ADD/EDIT DISCOUNT PRESET */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isDiscountModalOpen}
        onClose={() => setIsDiscountModalOpen(false)}
        title={
          editingDiscount
            ? language === 'th'
              ? 'แก้ไขพรีเซ็ตส่วนลด'
              : 'Edit Discount'
            : language === 'th'
            ? 'เพิ่มพรีเซ็ตส่วนลดใหม่'
            : 'Add Discount'
        }
      >
        <div className="space-y-4">
          <Input
            label={language === 'th' ? 'ชื่อส่วนลด' : 'Discount Name'}
            value={discountForm.name}
            onChange={(e) =>
              setDiscountForm({ ...discountForm, name: e.target.value })
            }
            placeholder="เช่น ส่วนลดสมาชิก VIP 10%"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-text mb-1">
                {language === 'th' ? 'รูปแบบส่วนลด' : 'Discount Type'}
              </label>
              <select
                value={discountForm.type}
                onChange={(e) =>
                  setDiscountForm({
                    ...discountForm,
                    type: e.target.value as any,
                  })
                }
                className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-border bg-background text-text"
              >
                <option value="percentage">
                  {language === 'th' ? 'เปอร์เซ็นต์ (%)' : 'Percentage (%)'}
                </option>
                <option value="fixed">
                  {language === 'th' ? 'ยอดคงที่ (บาท)' : 'Fixed (THB)'}
                </option>
              </select>
            </div>
            <Input
              label={
                discountForm.type === 'percentage'
                  ? language === 'th'
                    ? 'อัตราส่วนลด (%)'
                    : 'Discount Rate (%)'
                  : language === 'th'
                  ? 'มูลค่าส่วนลด (บาท)'
                  : 'Discount Value (THB)'
              }
              type="number"
              value={discountForm.value || ''}
              onChange={(e) =>
                setDiscountForm({
                  ...discountForm,
                  value: Number(e.target.value),
                })
              }
              placeholder="10"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={
                language === 'th' ? 'ยอดซื้อขั้นต่ำ (บาท)' : 'Min Order Spend (THB)'
              }
              type="number"
              value={discountForm.minOrderAmount || ''}
              onChange={(e) =>
                setDiscountForm({
                  ...discountForm,
                  minOrderAmount: Number(e.target.value),
                })
              }
              placeholder="0"
            />
            <Input
              label={
                language === 'th' ? 'ลดสูงสุดไม่เกิน (บาท)' : 'Max Cap (THB)'
              }
              type="number"
              value={discountForm.maxDiscountAmount || ''}
              onChange={(e) =>
                setDiscountForm({
                  ...discountForm,
                  maxDiscountAmount: Number(e.target.value),
                })
              }
              placeholder="1000"
            />
          </div>

          <label className="flex items-center gap-2 text-xs font-bold text-text cursor-pointer">
            <input
              type="checkbox"
              checked={discountForm.requireManagerPin}
              onChange={(e) =>
                setDiscountForm({
                  ...discountForm,
                  requireManagerPin: e.target.checked,
                })
              }
              className="rounded text-primary focus:ring-primary h-4 w-4"
            />
            <span>
              {language === 'th'
                ? 'ต้องใช้รหัส PIN ผู้จัดการก่อนใช้ส่วนลดนี้'
                : 'Require Manager PIN override'}
            </span>
          </label>

          <div className="pt-3 border-t border-border/60 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDiscountModalOpen(false)}
            >
              {language === 'th' ? 'ยกเลิก' : 'Cancel'}
            </Button>
            <Button variant="primary" size="sm" onClick={handleSaveDiscount}>
              {language === 'th' ? 'บันทึกส่วนลด' : 'Save Discount'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ========================================================================= */}
      {/* MODAL: ADD/EDIT TAX BRACKET */}
      {/* ========================================================================= */}
      <Modal
        isOpen={isTaxModalOpen}
        onClose={() => setIsTaxModalOpen(false)}
        title={
          editingTax
            ? language === 'th'
              ? 'แก้ไขอัตราภาษี'
              : 'Edit Tax Bracket'
            : language === 'th'
            ? 'เพิ่มอัตราภาษีใหม่'
            : 'Add Tax Bracket'
        }
      >
        <div className="space-y-4">
          <Input
            label={language === 'th' ? 'ชื่ออัตราภาษี' : 'Tax Name'}
            value={taxForm.name}
            onChange={(e) => setTaxForm({ ...taxForm, name: e.target.value })}
            placeholder="เช่น ภาษีมูลค่าเพิ่ม 7% (VAT 7.00%)"
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label={language === 'th' ? 'อัตราภาษี (%)' : 'Tax Rate (%)'}
              type="number"
              step="0.01"
              value={((taxForm.rateBps || 0) / 100).toString()}
              onChange={(e) =>
                setTaxForm({
                  ...taxForm,
                  rateBps: Math.round(Number(e.target.value) * 100),
                })
              }
              placeholder="7.00"
            />
            <div>
              <label className="block text-xs font-bold text-text mb-1">
                {language === 'th' ? 'วิธีคิดภาษี' : 'Tax Mode'}
              </label>
              <select
                value={taxForm.isInclusive ? 'inclusive' : 'exclusive'}
                onChange={(e) =>
                  setTaxForm({
                    ...taxForm,
                    isInclusive: e.target.value === 'inclusive',
                  })
                }
                className="w-full px-3 py-2 text-xs font-bold rounded-xl border border-border bg-background text-text"
              >
                <option value="inclusive">
                  {language === 'th' ? 'รวมในราคา (Inclusive)' : 'Inclusive'}
                </option>
                <option value="exclusive">
                  {language === 'th' ? 'คิดเพิ่มนอกราคา (Exclusive)' : 'Exclusive'}
                </option>
              </select>
            </div>
          </div>

          <Input
            label={language === 'th' ? 'คำอธิบายเพิ่มเติม' : 'Description'}
            value={taxForm.description}
            onChange={(e) =>
              setTaxForm({ ...taxForm, description: e.target.value })
            }
            placeholder="ระบุวัตถุประสงค์ของอัตราภาษีนี้"
          />

          <label className="flex items-center gap-2 text-xs font-bold text-text cursor-pointer">
            <input
              type="checkbox"
              checked={taxForm.isDefault}
              onChange={(e) =>
                setTaxForm({ ...taxForm, isDefault: e.target.checked })
              }
              className="rounded text-primary focus:ring-primary h-4 w-4"
            />
            <span>
              {language === 'th'
                ? 'ตั้งเป็นอัตราภาษีเริ่มต้นของระบบ'
                : 'Set as Default Store Tax Rate'}
            </span>
          </label>

          <div className="pt-3 border-t border-border/60 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsTaxModalOpen(false)}
            >
              {language === 'th' ? 'ยกเลิก' : 'Cancel'}
            </Button>
            <Button variant="primary" size="sm" onClick={handleSaveTaxBracket}>
              {language === 'th' ? 'บันทึกอัตราภาษี' : 'Save Tax Rate'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
