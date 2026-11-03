import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Hash,
  Loader2,
  MapPin,
  Phone,
  Sparkles,
  Store,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { Organization, Branch, Terminal } from '../../settings/types';
import { CreateBranchInput } from '../../../services/organizationService';
import { useLanguage } from '../../../context/LanguageContext';
import { useConfirmation, ConfirmationOptions } from '../../../context/ConfirmationDialogContext';
import { Button } from '../../../components/common/Button';

export interface BranchFormDialogProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialData?: Branch | null;
  presetOrgId?: string;
  organizations: Organization[];
  existingBranches: Branch[];
  terminals?: Terminal[];
  onClose: () => void;
  onSubmit: (data: CreateBranchInput) => Promise<void>;
  onConfirmDelete?: (branch: Branch) => Promise<void>;
}

interface BranchFormErrors {
  orgId?: string;
  name?: string;
  code?: string;
  address?: string;
  phone?: string;
  manager?: string;
}

const BRANCH_CODE_REGEX = /^[A-Za-z0-9_-]{2,24}$/;
const PHONE_REGEX = /^[0-9+\-() ]{6,25}$/;

export function buildBranchDeleteConfirmation(
  branch: Branch,
  branchTerminals: Terminal[],
  isThai: boolean
): ConfirmationOptions {
  return {
    title: isThai ? 'ยืนยันการลบสาขาหน้าร้าน' : 'Confirm Branch Deletion',
    description: isThai
      ? 'การลบสาขาจะส่งผลให้เครื่องขาย POS ในสาขานี้ถูกลบไปด้วย'
      : 'Deleting this branch will cascade-delete all registered POS terminals in it.',
    message: isThai
      ? `คุณกำลังจะลบสาขา "${branch.name}" ออกจากระบบ`
      : `You are about to delete store branch "${branch.name}".`,
    confirmText: isThai ? 'ยืนยันลบสาขาและเครื่องขาย' : 'Delete Branch & Terminals',
    cancelText: isThai ? 'ยกเลิก' : 'Cancel',
    variant: 'danger',
    icon: 'trash',
    requireMatchText: branch.name,
    matchPrompt: isThai
      ? `พิมพ์ชื่อสาขา "${branch.name}" เพื่อยืนยันการลบ:`
      : `Type branch name "${branch.name}" to confirm deletion:`,
    impactDetails: [
      { label: isThai ? 'ชื่อสาขา' : 'Branch Name', value: branch.name, danger: true },
      { label: isThai ? 'รหัสสาขา' : 'Branch Code', value: branch.code || branch.id },
      {
        label: isThai ? 'เครื่องขาย POS ที่จะถูกลบ' : 'Cascading Terminals Deleted',
        value: `${branchTerminals.length} ${isThai ? 'เครื่อง' : 'units'}`,
        danger: branchTerminals.length > 0,
      },
    ],
  };
}

export const BranchFormDialog: React.FC<BranchFormDialogProps> = ({
  isOpen,
  mode,
  initialData,
  presetOrgId,
  organizations,
  existingBranches,
  terminals = [],
  onClose,
  onSubmit,
  onConfirmDelete,
}) => {
  const { language } = useLanguage();
  const { confirm } = useConfirmation();
  const isThai = language === 'th';

  const [form, setForm] = useState<CreateBranchInput>({
    orgId: '',
    name: '',
    code: '',
    address: '',
    phone: '',
    manager: '',
    status: 'active',
  });

  const [errors, setErrors] = useState<BranchFormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && initialData) {
        setForm({
          orgId: initialData.orgId,
          name: initialData.name || '',
          code: initialData.code || '',
          address: initialData.address || '',
          phone: initialData.phone || '',
          manager: initialData.manager || '',
          status: initialData.status || 'active',
        });
      } else {
        const defaultOrgId = presetOrgId || organizations[0]?.id || '';
        const orgBranchCount = existingBranches.filter((b) => b.orgId === defaultOrgId).length;
        setForm({
          orgId: defaultOrgId,
          name: '',
          code: `STR-${String(orgBranchCount + 1).padStart(2, '0')}`,
          address: '',
          phone: '',
          manager: '',
          status: 'active',
        });
      }
      setErrors({});
      setTouched({});
      setIsSubmitting(false);
      setIsDeleting(false);
    }
  }, [isOpen, mode, initialData, presetOrgId, organizations, existingBranches]);

  if (!isOpen) return null;

  const validateField = (values: CreateBranchInput): BranchFormErrors => {
    const nextErrors: BranchFormErrors = {};
    const trimmedName = values.name.trim();
    const trimmedCode = (values.code || '').trim().toUpperCase();
    const trimmedAddress = values.address.trim();
    const trimmedPhone = (values.phone || '').trim();
    const trimmedManager = (values.manager || '').trim();

    // 1. Parent Organization validation
    if (!values.orgId) {
      nextErrors.orgId = isThai
        ? 'กรุณาเลือกองค์กรต้นสังกัด'
        : 'Parent organization is required.';
    } else if (!organizations.some((o) => o.id === values.orgId)) {
      nextErrors.orgId = isThai
        ? 'ไม่พบองค์กรที่เลือกในระบบ'
        : 'Selected organization does not exist.';
    }

    // 2. Branch Name validation
    if (!trimmedName) {
      nextErrors.name = isThai ? 'กรุณาระบุชื่อสาขา' : 'Branch name is required.';
    } else if (trimmedName.length < 2) {
      nextErrors.name = isThai
        ? 'ชื่อสาขาต้องมีความยาวอย่างน้อย 2 ตัวอักษร'
        : 'Branch name must be at least 2 characters.';
    } else if (trimmedName.length > 120) {
      nextErrors.name = isThai
        ? 'ชื่อสาขาต้องไม่เกิน 120 ตัวอักษร'
        : 'Branch name cannot exceed 120 characters.';
    } else if (values.orgId) {
      const duplicateName = existingBranches.some(
        (b) =>
          b.id !== initialData?.id &&
          b.orgId === values.orgId &&
          b.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (duplicateName) {
        nextErrors.name = isThai
          ? 'มีชื่อสาขานี้อยู่ในองค์กรเดียวกันแล้ว'
          : 'A branch with this name already exists in the selected organization.';
      }
    }

    // 3. Branch Code validation
    if (!trimmedCode) {
      nextErrors.code = isThai ? 'กรุณาระบุรหัสสาขา (เช่น STR-01)' : 'Branch code is required.';
    } else if (!BRANCH_CODE_REGEX.test(trimmedCode)) {
      nextErrors.code = isThai
        ? 'รหัสสาขาต้องเป็น A-Z, 0-9, ขีดกลาง (-) หรือขีดล่าง (_) ความยาว 2-24 ตัวอักษร'
        : 'Code must be 2–24 alphanumeric characters, hyphens, or underscores.';
    } else if (values.orgId) {
      const duplicateCode = existingBranches.some(
        (b) =>
          b.id !== initialData?.id &&
          b.orgId === values.orgId &&
          (b.code || '').trim().toUpperCase() === trimmedCode
      );
      if (duplicateCode) {
        nextErrors.code = isThai
          ? `รหัสสาขา "${trimmedCode}" ถูกใช้งานในองค์กรนี้แล้ว`
          : `Branch code "${trimmedCode}" is already used in this organization.`;
      }
    }

    // 4. Physical Address validation
    if (!trimmedAddress) {
      nextErrors.address = isThai
        ? 'กรุณาระบุที่ตั้งสาขาหน้าร้าน'
        : 'Physical store address is required.';
    } else if (trimmedAddress.length < 5) {
      nextErrors.address = isThai
        ? 'กรุณาระบุที่อยู่ให้ชัดเจน (อย่างน้อย 5 ตัวอักษร)'
        : 'Address must be at least 5 characters.';
    } else if (trimmedAddress.length > 300) {
      nextErrors.address = isThai
        ? 'ที่อยู่ต้องไม่เกิน 300 ตัวอักษร'
        : 'Address cannot exceed 300 characters.';
    }

    // 5. Phone validation (optional)
    if (trimmedPhone && !PHONE_REGEX.test(trimmedPhone)) {
      nextErrors.phone = isThai
        ? 'รูปแบบเบอร์โทรศัพท์สาขาไม่ถูกต้อง'
        : 'Invalid phone number format.';
    }

    // 6. Manager validation (optional)
    if (trimmedManager && (trimmedManager.length < 2 || trimmedManager.length > 100)) {
      nextErrors.manager = isThai
        ? 'ชื่อผู้จัดการสาขาต้องมีความยาว 2-100 ตัวอักษร'
        : 'Manager name must be between 2 and 100 characters.';
    }

    return nextErrors;
  };

  const handleFieldChange = <K extends keyof CreateBranchInput>(
    field: K,
    value: CreateBranchInput[K]
  ) => {
    const updated = { ...form, [field]: value };
    setForm(updated);
    if (touched[field]) {
      setErrors(validateField(updated));
    }
  };

  const handleBlur = (field: keyof CreateBranchInput) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateField(form));
  };

  const handleSuggestCode = () => {
    const orgBranches = existingBranches.filter((b) => b.orgId === form.orgId);
    const parentOrg = organizations.find((o) => o.id === form.orgId);
    const prefix = parentOrg
      ? parentOrg.slug.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase() || 'STR'
      : 'STR';
    let index = orgBranches.length + 1;
    let candidate = `${prefix}-${String(index).padStart(2, '0')}`;
    while (
      orgBranches.some(
        (b) =>
          b.id !== initialData?.id &&
          (b.code || '').trim().toUpperCase() === candidate
      )
    ) {
      index += 1;
      candidate = `${prefix}-${String(index).padStart(2, '0')}`;
    }
    const updated = { ...form, code: candidate };
    setForm(updated);
    setTouched((prev) => ({ ...prev, code: true }));
    setErrors(validateField(updated));
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({
      orgId: true,
      name: true,
      code: true,
      address: true,
      phone: true,
      manager: true,
    });

    const validationErrors = validateField(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    // Confirm if deactivating an active branch with registered terminals
    if (
      mode === 'edit' &&
      initialData &&
      initialData.status !== 'inactive' &&
      form.status === 'inactive'
    ) {
      const branchTerminals = terminals.filter((t) => t.branchId === initialData.id);
      if (branchTerminals.length > 0) {
        const confirmedDeactivate = await confirm({
          title: isThai ? 'ยืนยันการปิดสถานะสาขาชั่วคราว' : 'Confirm Branch Deactivation',
          description: isThai
            ? 'เครื่องขาย POS ในสาขานี้จะถูกระงับการเปิดกะขายชั่วคราว'
            : 'POS terminals assigned to this branch will be suspended.',
          message: isThai
            ? `คุณต้องการเปลี่ยนสถานะสาขา "${form.name}" เป็นระงับการใช้งาน (Inactive) หรือไม่?`
            : `Are you sure you want to mark branch "${form.name}" as Inactive?`,
          confirmText: isThai ? 'ยืนยันระงับสาขา' : 'Deactivate Branch',
          cancelText: isThai ? 'ยกเลิก' : 'Cancel',
          variant: 'warning',
          icon: 'warning',
          impactDetails: [
            {
              label: isThai ? 'เครื่องขาย POS ในสาขา' : 'Assigned POS Terminals',
              value: branchTerminals.length,
            },
          ],
        });
        if (!confirmedDeactivate) return;
      }
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        orgId: form.orgId,
        name: form.name.trim(),
        code: (form.code || '').trim().toUpperCase(),
        address: form.address.trim(),
        phone: form.phone?.trim() || '',
        manager: form.manager?.trim() || '',
        status: form.status || 'active',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDestructiveDelete = async () => {
    if (!initialData || !onConfirmDelete) return;
    const branchTerminals = terminals.filter((t) => t.branchId === initialData.id);
    const isConfirmed = await confirm(
      buildBranchDeleteConfirmation(initialData, branchTerminals, isThai)
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

  const branchTerminalCount = initialData
    ? terminals.filter((t) => t.branchId === initialData.id).length
    : 0;

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="branch-dialog-title"
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
            <div className="h-10 w-10 rounded-xl bg-emerald-500/10 text-emerald-700 flex items-center justify-center font-bold shrink-0">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <h3 id="branch-dialog-title" className="text-base font-black text-slate-900">
                {mode === 'create'
                  ? isThai
                    ? 'เพิ่มสาขาหน้าร้านใหม่'
                    : 'Register Store Branch'
                  : isThai
                  ? 'แก้ไขข้อมูลสาขาหน้าร้าน'
                  : 'Edit Store Branch'}
              </h3>
              <p className="text-xs text-slate-400">
                {mode === 'create'
                  ? isThai
                    ? 'ผูกโยงสาขาเข้ากับองค์กรต้นสังกัดใน Firestore'
                    : 'Link physical store location to parent organization'
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
          {/* Parent Organization */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {isThai ? 'องค์กรต้นสังกัด (Parent Organization) *' : 'Parent Organization *'}
            </label>
            <div className="relative">
              <Building2 className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <select
                value={form.orgId}
                disabled={mode === 'edit'}
                onChange={(e) => handleFieldChange('orgId', e.target.value)}
                onBlur={() => handleBlur('orgId')}
                className={`w-full pl-8 pr-3 py-2 text-xs font-bold border rounded-xl bg-white text-slate-900 focus:outline-hidden disabled:bg-slate-50 disabled:text-slate-500 ${
                  touched.orgId && errors.orgId
                    ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                    : 'border-slate-200 focus:border-emerald-600'
                }`}
              >
                <option value="">
                  {isThai ? '-- เลือกองค์กรต้นสังกัด --' : '-- Select Organization --'}
                </option>
                {organizations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.slug})
                  </option>
                ))}
              </select>
            </div>
            {touched.orgId && errors.orgId && (
              <p className="mt-1 text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span>{errors.orgId}</span>
              </p>
            )}
          </div>

          {/* Branch Name & Branch Code */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isThai ? 'ชื่อสาขา (Branch Name) *' : 'Branch Name *'}
              </label>
              <input
                type="text"
                placeholder="e.g. Central World Flagship"
                value={form.name}
                onChange={(e) => handleFieldChange('name', e.target.value)}
                onBlur={() => handleBlur('name')}
                className={`w-full px-3 py-2 text-xs border rounded-xl bg-white text-slate-900 focus:outline-hidden ${
                  touched.name && errors.name
                    ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                    : 'border-slate-200 focus:border-emerald-600'
                }`}
              />
              {touched.name && errors.name && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>{errors.name}</span>
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-slate-700">
                  {isThai ? 'รหัสสาขา (Code) *' : 'Branch Code *'}
                </label>
                <button
                  type="button"
                  onClick={handleSuggestCode}
                  className="text-[10px] font-bold text-emerald-700 hover:underline flex items-center gap-0.5"
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  {isThai ? 'รันรหัสอัตโนมัติ' : 'Auto-code'}
                </button>
              </div>
              <div className="relative">
                <Hash className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="e.g. STR-01"
                  value={form.code || ''}
                  onChange={(e) =>
                    handleFieldChange(
                      'code',
                      e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '-')
                    )
                  }
                  onBlur={() => handleBlur('code')}
                  className={`w-full pl-7 pr-3 py-2 text-xs font-mono border rounded-xl bg-white text-slate-900 focus:outline-hidden ${
                    touched.code && errors.code
                      ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                      : 'border-slate-200 focus:border-emerald-600'
                  }`}
                />
              </div>
              {touched.code && errors.code && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>{errors.code}</span>
                </p>
              )}
            </div>
          </div>

          {/* Physical Address */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-emerald-600" />
              <span>
                {isThai ? 'ที่อยู่สาขาหน้าร้าน (Physical Store Address) *' : 'Physical Store Address *'}
              </span>
            </label>
            <textarea
              rows={2}
              placeholder="e.g. 999/9 Rama I Rd, Pathum Wan, Bangkok 10330"
              value={form.address}
              onChange={(e) => handleFieldChange('address', e.target.value)}
              onBlur={() => handleBlur('address')}
              className={`w-full px-3 py-2 text-xs border rounded-xl bg-white text-slate-900 focus:outline-hidden ${
                touched.address && errors.address
                  ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                  : 'border-slate-200 focus:border-emerald-600'
              }`}
            />
            {touched.address && errors.address && (
              <p className="mt-1 text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />
                <span>{errors.address}</span>
              </p>
            )}
          </div>

          {/* Phone & Store Manager */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isThai ? 'เบอร์โทรติดต่อสาขา' : 'Branch Phone'}
              </label>
              <div className="relative">
                <Phone className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  placeholder="+66-2-888-9001"
                  value={form.phone || ''}
                  onChange={(e) => handleFieldChange('phone', e.target.value)}
                  onBlur={() => handleBlur('phone')}
                  className={`w-full pl-8 pr-3 py-2 text-xs border rounded-xl bg-white text-slate-900 focus:outline-hidden ${
                    touched.phone && errors.phone
                      ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                      : 'border-slate-200 focus:border-emerald-600'
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
                {isThai ? 'ผู้จัดการสาขา (Store Manager)' : 'Store Manager'}
              </label>
              <div className="relative">
                <User className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="e.g. Somchai Prasert"
                  value={form.manager || ''}
                  onChange={(e) => handleFieldChange('manager', e.target.value)}
                  onBlur={() => handleBlur('manager')}
                  className={`w-full pl-8 pr-3 py-2 text-xs border rounded-xl bg-white text-slate-900 focus:outline-hidden ${
                    touched.manager && errors.manager
                      ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                      : 'border-slate-200 focus:border-emerald-600'
                  }`}
                />
              </div>
              {touched.manager && errors.manager && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>{errors.manager}</span>
                </p>
              )}
            </div>
          </div>

          {/* Branch Status */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              {isThai ? 'สถานะการเปิดให้บริการสาขา (Branch Status)' : 'Branch Operational Status'}
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
                    {isThai ? 'เปิดให้บริการ (Active)' : 'Active'}
                  </div>
                  <div className="text-[10px] opacity-75">
                    {isThai ? 'พร้อมเปิดกะขายหน้าร้าน' : 'Ready for POS shifts'}
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
                    {isThai ? 'ปิดปรับปรุง / ระงับ (Inactive)' : 'Inactive'}
                  </div>
                  <div className="text-[10px] opacity-75">
                    {isThai ? 'งดรับรายการขายชั่วคราว' : 'Temporarily closed'}
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
                  {isThai ? 'ลบสาขา' : 'Delete Branch'}
                  {branchTerminalCount > 0 && ` (${branchTerminalCount} POS)`}
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
                      ? 'บันทึกสาขา'
                      : 'Create Branch'
                    : isThai
                    ? 'บันทึกการแก้ไข'
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
