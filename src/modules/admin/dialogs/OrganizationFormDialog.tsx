import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Globe,
  Loader2,
  Mail,
  Phone,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Organization, Branch, Terminal } from '../../settings/types';
import { CreateOrganizationInput } from '../../../services/organizationService';
import { useLanguage } from '../../../context/LanguageContext';
import { useConfirmation, ConfirmationOptions } from '../../../context/ConfirmationDialogContext';
import { Button } from '../../../components/common/Button';

export interface OrganizationFormDialogProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialData?: Organization | null;
  existingOrganizations: Organization[];
  branches?: Branch[];
  terminals?: Terminal[];
  onClose: () => void;
  onSubmit: (data: CreateOrganizationInput) => Promise<void>;
  onConfirmDelete?: (org: Organization) => Promise<void>;
}

interface FormErrors {
  name?: string;
  slug?: string;
  taxId?: string;
  phone?: string;
  email?: string;
  currency?: string;
}

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9+\-() ]{6,25}$/;
const TAX_ID_REGEX = /^[0-9A-Za-z-]{10,20}$/;

export function buildOrganizationDeleteConfirmation(
  org: Organization,
  orgBranches: Branch[],
  orgTerminals: Terminal[],
  isThai: boolean
): ConfirmationOptions {
  return {
    title: isThai ? 'ยืนยันการลบองค์กรถาวร' : 'Confirm Organization Deletion',
    description: isThai
      ? 'การกระทำนี้จะลบข้อมูลองค์กร สาขาย่อย และเครื่องขาย POS ทั้งหมดใน Firestore'
      : 'Irreversible: Deletes organization and all cascading sub-entities in Firestore',
    message: isThai
      ? `คุณกำลังจะลบองค์กร "${org.name}" (${org.slug}) ออกจากระบบ การกระทำนี้ไม่สามารถย้อนกลับได้`
      : `You are about to permanently delete organization "${org.name}" (${org.slug}). This action cannot be undone.`,
    confirmText: isThai ? 'ยืนยันลบองค์กรและข้อมูลย่อย' : 'Delete Organization & Children',
    cancelText: isThai ? 'ยกเลิก' : 'Cancel',
    variant: 'danger',
    icon: 'trash',
    requireMatchText: org.name,
    matchPrompt: isThai
      ? `พิมพ์ชื่อองค์กร "${org.name}" ในช่องด้านล่างเพื่อปลดล็อกการลบ:`
      : `Type "${org.name}" below to unlock permanent deletion:`,
    impactDetails: [
      { label: isThai ? 'ชื่อองค์กร' : 'Organization Name', value: org.name, danger: true },
      { label: isThai ? 'รหัสเรียกย่อ (Slug)' : 'Slug Identifier', value: org.slug },
      {
        label: isThai ? 'สาขาที่จะถูกลบทั้งหมด' : 'Cascading Branches Deleted',
        value: `${orgBranches.length} ${isThai ? 'แห่ง' : 'locations'}`,
        danger: orgBranches.length > 0,
      },
      {
        label: isThai ? 'เครื่องขาย POS ที่จะถูกลบ' : 'Cascading POS Terminals Deleted',
        value: `${orgTerminals.length} ${isThai ? 'เครื่อง' : 'units'}`,
        danger: orgTerminals.length > 0,
      },
    ],
  };
}

export const OrganizationFormDialog: React.FC<OrganizationFormDialogProps> = ({
  isOpen,
  mode,
  initialData,
  existingOrganizations,
  branches = [],
  terminals = [],
  onClose,
  onSubmit,
  onConfirmDelete,
}) => {
  const { language } = useLanguage();
  const { confirm } = useConfirmation();
  const isThai = language === 'th';

  const [form, setForm] = useState<CreateOrganizationInput>({
    name: '',
    slug: '',
    taxId: '',
    phone: '',
    email: '',
    currency: 'THB',
    status: 'active',
  });

  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && initialData) {
        setForm({
          name: initialData.name || '',
          slug: initialData.slug || '',
          taxId: initialData.taxId || '',
          phone: initialData.phone || '',
          email: initialData.email || '',
          currency: initialData.currency || 'THB',
          status: initialData.status || 'active',
        });
      } else {
        setForm({
          name: '',
          slug: '',
          taxId: '',
          phone: '',
          email: '',
          currency: 'THB',
          status: 'active',
        });
      }
      setErrors({});
      setTouched({});
      setIsSubmitting(false);
      setIsDeleting(false);
    }
  }, [isOpen, mode, initialData]);

  if (!isOpen) return null;

  const validateField = (values: CreateOrganizationInput): FormErrors => {
    const nextErrors: FormErrors = {};
    const trimmedName = values.name.trim();
    const trimmedSlug = values.slug.trim().toLowerCase();
    const trimmedTaxId = (values.taxId || '').trim();
    const trimmedPhone = (values.phone || '').trim();
    const trimmedEmail = (values.email || '').trim();

    if (!trimmedName) {
      nextErrors.name = isThai
        ? 'กรุณาระบุชื่อองค์กร'
        : 'Organization name is required.';
    } else if (trimmedName.length < 2) {
      nextErrors.name = isThai
        ? 'ชื่อองค์กรต้องมีความยาวอย่างน้อย 2 ตัวอักษร'
        : 'Organization name must be at least 2 characters.';
    } else if (trimmedName.length > 120) {
      nextErrors.name = isThai
        ? 'ชื่อองค์กรต้องไม่เกิน 120 ตัวอักษร'
        : 'Organization name cannot exceed 120 characters.';
    } else {
      const duplicateName = existingOrganizations.some(
        (org) =>
          org.id !== initialData?.id &&
          org.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (duplicateName) {
        nextErrors.name = isThai
          ? 'ชื่อองค์กรนี้ถูกใช้งานแล้วในระบบ'
          : 'An organization with this name already exists.';
      }
    }

    if (!trimmedSlug) {
      nextErrors.slug = isThai
        ? 'กรุณาระบุรหัสเรียกย่อ (Slug)'
        : 'Organization slug identifier is required.';
    } else if (trimmedSlug.length < 2 || trimmedSlug.length > 64) {
      nextErrors.slug = isThai
        ? 'Slug ต้องมีความยาว 2 ถึง 64 ตัวอักษร'
        : 'Slug must be between 2 and 64 characters.';
    } else if (!SLUG_REGEX.test(trimmedSlug)) {
      nextErrors.slug = isThai
        ? 'ใช้ได้เฉพาะตัวพิมพ์เล็ก (a-z), ตัวเลข (0-9) และขีดกลาง (-)'
        : 'Use lowercase letters, numbers, and single hyphens only.';
    } else {
      const duplicateSlug = existingOrganizations.some(
        (org) =>
          org.id !== initialData?.id &&
          org.slug.trim().toLowerCase() === trimmedSlug
      );
      if (duplicateSlug) {
        nextErrors.slug = isThai
          ? `รหัส Slug "${trimmedSlug}" ถูกใช้งานโดยองค์กรอื่นแล้ว`
          : `Slug "${trimmedSlug}" is already in use by another organization.`;
      }
    }

    if (trimmedTaxId && !TAX_ID_REGEX.test(trimmedTaxId)) {
      nextErrors.taxId = isThai
        ? 'เลขประจำตัวผู้เสียภาษีต้องมี 10-20 ตัวอักษร/ตัวเลข (เช่น 13 หลัก)'
        : 'Tax ID must be 10–20 alphanumeric characters (e.g. 13-digit Tax ID).';
    }

    if (trimmedPhone && !PHONE_REGEX.test(trimmedPhone)) {
      nextErrors.phone = isThai
        ? 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง (เช่น +66-2-888-9000)'
        : 'Invalid phone number format (e.g. +66-2-888-9000).';
    }

    if (trimmedEmail && !EMAIL_REGEX.test(trimmedEmail)) {
      nextErrors.email = isThai
        ? 'รูปแบบอีเมลไม่ถูกต้อง (เช่น contact@company.com)'
        : 'Please enter a valid email address.';
    }

    return nextErrors;
  };

  const handleFieldChange = <K extends keyof CreateOrganizationInput>(
    field: K,
    value: CreateOrganizationInput[K]
  ) => {
    const updated = { ...form, [field]: value };
    setForm(updated);
    if (touched[field]) {
      setErrors(validateField(updated));
    }
  };

  const handleBlur = (field: keyof CreateOrganizationInput) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateField(form));
  };

  const handleAutoSlug = () => {
    if (!form.name.trim()) return;
    const generated = form.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    if (generated) {
      const updated = { ...form, slug: generated };
      setForm(updated);
      setTouched((prev) => ({ ...prev, slug: true }));
      setErrors(validateField(updated));
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({
      name: true,
      slug: true,
      taxId: true,
      phone: true,
      email: true,
      currency: true,
    });

    const validationErrors = validateField(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    if (
      mode === 'edit' &&
      initialData &&
      initialData.status !== 'inactive' &&
      form.status === 'inactive'
    ) {
      const orgBranches = branches.filter((b) => b.orgId === initialData.id);
      const orgTerminals = terminals.filter((t) => t.orgId === initialData.id);
      if (orgBranches.length > 0 || orgTerminals.length > 0) {
        const confirmedDeactivate = await confirm({
          title: isThai ? 'ยืนยันการระงับสถานะองค์กร' : 'Confirm Organization Deactivation',
          description: isThai
            ? 'การตั้งค่าสถานะเป็น Inactive จะส่งผลต่อการเข้าใช้งานของสาขาภายใต้สังกัด'
            : 'Setting status to Inactive affects operational access for child branches.',
          message: isThai
            ? `คุณต้องการเปลี่ยนสถานะของ "${form.name}" เป็นระงับการใช้งาน (Inactive) หรือไม่?`
            : `Are you sure you want to mark "${form.name}" as Inactive?`,
          confirmText: isThai ? 'ยืนยันระงับการใช้งาน' : 'Mark as Inactive',
          cancelText: isThai ? 'ยกเลิก' : 'Cancel',
          variant: 'warning',
          icon: 'warning',
          impactDetails: [
            { label: isThai ? 'สาขาภายใต้สังกัด' : 'Child Branches', value: orgBranches.length },
            { label: isThai ? 'เครื่องขาย POS' : 'POS Terminals', value: orgTerminals.length },
          ],
        });
        if (!confirmedDeactivate) return;
      }
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        name: form.name.trim(),
        slug: form.slug.trim().toLowerCase(),
        taxId: form.taxId?.trim() || '',
        phone: form.phone?.trim() || '',
        email: form.email?.trim() || '',
        currency: form.currency || 'THB',
        status: form.status || 'active',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDestructiveDelete = async () => {
    if (!initialData || !onConfirmDelete) return;
    const orgBranches = branches.filter((b) => b.orgId === initialData.id);
    const orgTerminals = terminals.filter((t) => t.orgId === initialData.id);

    const isConfirmed = await confirm(
      buildOrganizationDeleteConfirmation(initialData, orgBranches, orgTerminals, isThai)
    );
    if (!isConfirmed) return;

    setIsDeleting(true);
    try {
      await onConfirmDelete(initialData);
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  const orgBranchCount = initialData
    ? branches.filter((b) => b.orgId === initialData.id).length
    : 0;
  const orgTerminalCount = initialData
    ? terminals.filter((t) => t.orgId === initialData.id).length
    : 0;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="org-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting && !isDeleting) {
          onClose();
        }
      }}
    >
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-[#ff6b1a]/10 text-[#ff6b1a] flex items-center justify-center font-bold shrink-0">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h3 id="org-dialog-title" className="text-base font-black text-slate-900">
                {mode === 'create'
                  ? isThai
                    ? 'สร้างโปรไฟล์องค์กรใหม่'
                    : 'Create Organization Profile'
                  : isThai
                  ? 'แก้ไขข้อมูลโปรไฟล์องค์กร'
                  : 'Edit Organization Profile'}
              </h3>
              <p className="text-xs text-slate-400">
                {mode === 'create'
                  ? isThai
                    ? 'กำหนดข้อมูลนิติบุคคลและรหัสแยกฐานข้อมูล Multi-Tenant ใน Firestore'
                    : 'Configure multi-tenant organization identity in Firestore'
                  : `ID: ${initialData?.id}`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting || isDeleting}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleFormSubmit} noValidate className="space-y-4">
          {/* Organization Name */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {isThai ? 'ชื่อองค์กร / นิติบุคคล (Organization Name) *' : 'Organization Name *'}
            </label>
            <input
              type="text"
              placeholder="e.g. PRODX Retail Group Co., Ltd."
              value={form.name}
              onChange={(e) => handleFieldChange('name', e.target.value)}
              onBlur={() => handleBlur('name')}
              className={`w-full px-3 py-2 text-xs border rounded-xl bg-white text-slate-900 focus:outline-hidden transition-colors ${
                touched.name && errors.name
                  ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                  : 'border-slate-200 focus:border-[#ff6b1a]'
              }`}
            />
            {touched.name && errors.name && (
              <p className="mt-1 text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span>{errors.name}</span>
              </p>
            )}
          </div>

          {/* Slug Identifier */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-700">
                {isThai ? 'รหัสเรียกย่อ / Slug (ใช้ระบุขอบเขตข้อมูล) *' : 'Slug / Tenant Identifier *'}
              </label>
              <button
                type="button"
                onClick={handleAutoSlug}
                className="text-[11px] font-bold text-[#ff6b1a] hover:underline flex items-center gap-1"
              >
                <Sparkles className="h-3 w-3" />
                {isThai ? 'สร้างอัตโนมัติจากชื่อ' : 'Generate from name'}
              </button>
            </div>
            <div className="relative">
              <Globe className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="e.g. prodx-retail"
                value={form.slug}
                onChange={(e) =>
                  handleFieldChange(
                    'slug',
                    e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')
                  )
                }
                onBlur={() => handleBlur('slug')}
                className={`w-full pl-8 pr-3 py-2 text-xs font-mono border rounded-xl bg-white text-slate-900 focus:outline-hidden transition-colors ${
                  touched.slug && errors.slug
                    ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                    : 'border-slate-200 focus:border-[#ff6b1a]'
                }`}
              />
            </div>
            {touched.slug && errors.slug ? (
              <p className="mt-1 text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span>{errors.slug}</span>
              </p>
            ) : (
              <p className="mt-1 text-[10px] text-slate-400">
                {isThai
                  ? 'ตัวพิมพ์เล็ก a-z, ตัวเลข 0-9 และขีดกลาง (-) ไม่ซ้ำกับองค์กรอื่น'
                  : 'Lowercase alphanumeric with hyphens, unique across the platform.'}
              </p>
            )}
          </div>

          {/* Tax ID & Currency */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isThai ? 'เลขประจำตัวผู้เสียภาษี (Tax ID)' : 'Tax Registration ID'}
              </label>
              <input
                type="text"
                placeholder="e.g. 0105562089412"
                value={form.taxId || ''}
                onChange={(e) => handleFieldChange('taxId', e.target.value)}
                onBlur={() => handleBlur('taxId')}
                className={`w-full px-3 py-2 text-xs font-mono border rounded-xl bg-white text-slate-900 focus:outline-hidden ${
                  touched.taxId && errors.taxId
                    ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                    : 'border-slate-200 focus:border-[#ff6b1a]'
                }`}
              />
              {touched.taxId && errors.taxId && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>{errors.taxId}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isThai ? 'สกุลเงินหลัก (Currency)' : 'Base Currency'}
              </label>
              <select
                value={form.currency || 'THB'}
                onChange={(e) => handleFieldChange('currency', e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white text-slate-900 font-bold focus:outline-hidden focus:border-[#ff6b1a]"
              >
                <option value="THB">THB (฿ - Thai Baht)</option>
                <option value="USD">USD ($ - US Dollar)</option>
                <option value="EUR">EUR (€ - Euro)</option>
                <option value="JPY">JPY (¥ - Japanese Yen)</option>
                <option value="SGD">SGD (S$ - Singapore Dollar)</option>
              </select>
            </div>
          </div>

          {/* Phone & Email */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isThai ? 'เบอร์โทรศัพท์ติดต่อ' : 'Contact Phone'}
              </label>
              <div className="relative">
                <Phone className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  placeholder="+66-2-888-9000"
                  value={form.phone || ''}
                  onChange={(e) => handleFieldChange('phone', e.target.value)}
                  onBlur={() => handleBlur('phone')}
                  className={`w-full pl-8 pr-3 py-2 text-xs border rounded-xl bg-white text-slate-900 focus:outline-hidden ${
                    touched.phone && errors.phone
                      ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                      : 'border-slate-200 focus:border-[#ff6b1a]'
                  }`}
                />
              </div>
              {touched.phone && errors.phone && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>{errors.phone}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isThai ? 'อีเมลติดต่อทางการ' : 'Official Email'}
              </label>
              <div className="relative">
                <Mail className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  placeholder="admin@prodx-group.com"
                  value={form.email || ''}
                  onChange={(e) => handleFieldChange('email', e.target.value)}
                  onBlur={() => handleBlur('email')}
                  className={`w-full pl-8 pr-3 py-2 text-xs border rounded-xl bg-white text-slate-900 focus:outline-hidden ${
                    touched.email && errors.email
                      ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                      : 'border-slate-200 focus:border-[#ff6b1a]'
                  }`}
                />
              </div>
              {touched.email && errors.email && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>{errors.email}</span>
                </p>
              )}
            </div>
          </div>

          {/* Status Radio Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              {isThai ? 'สถานะองค์กร (Operational Status)' : 'Operational Status'}
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => handleFieldChange('status', 'active')}
                className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2.5 ${
                  form.status === 'active'
                    ? 'border-emerald-500 bg-emerald-50/60 text-emerald-900 ring-2 ring-emerald-500/15'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <CheckCircle2
                  className={`h-4 w-4 shrink-0 ${
                    form.status === 'active' ? 'text-emerald-600' : 'text-slate-300'
                  }`}
                />
                <div>
                  <div className="text-xs font-black">
                    {isThai ? 'เปิดใช้งาน (Active)' : 'Active'}
                  </div>
                  <div className="text-[10px] opacity-75">
                    {isThai ? 'อนุญาตให้สาขาเปิดกะขายปกติ' : 'Normal POS operations'}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleFieldChange('status', 'inactive')}
                className={`p-2.5 rounded-xl border text-left transition-all flex items-center gap-2.5 ${
                  form.status === 'inactive'
                    ? 'border-rose-500 bg-rose-50/60 text-rose-900 ring-2 ring-rose-500/15'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                <AlertCircle
                  className={`h-4 w-4 shrink-0 ${
                    form.status === 'inactive' ? 'text-rose-600' : 'text-slate-300'
                  }`}
                />
                <div>
                  <div className="text-xs font-black">
                    {isThai ? 'ระงับชั่วคราว (Inactive)' : 'Inactive'}
                  </div>
                  <div className="text-[10px] opacity-75">
                    {isThai ? 'ปิดกั้นการเข้าใช้งานชั่วคราว' : 'Suspend tenant access'}
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Footer with Destructive Delete (in Edit mode) and Submit */}
          <div className="flex items-center justify-between gap-2.5 pt-4 border-t border-slate-100">
            {mode === 'edit' && initialData && onConfirmDelete ? (
              <button
                type="button"
                onClick={handleDestructiveDelete}
                disabled={isSubmitting || isDeleting}
                className="px-3 py-2 text-xs font-bold text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl border border-rose-200 transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>
                  {isThai ? 'ลบองค์กรถาวร' : 'Delete Organization'}
                  {(orgBranchCount > 0 || orgTerminalCount > 0) &&
                    ` (${orgBranchCount}B / ${orgTerminalCount}T)`}
                </span>
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={isSubmitting || isDeleting}
              >
                {isThai ? 'ยกเลิก' : 'Cancel'}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting || isDeleting}
                className="font-bold flex items-center gap-1.5"
              >
                {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>
                  {mode === 'create'
                    ? isThai
                      ? 'บันทึกองค์กร'
                      : 'Create Organization'
                    : isThai
                    ? 'บันทึกการเปลี่ยนแปลง'
                    : 'Save Changes'}
                </span>
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
