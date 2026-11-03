import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Cpu,
  Hash,
  Loader2,
  Monitor,
  Printer,
  Sparkles,
  Store,
  Trash2,
  Wifi,
  Wrench,
  X,
} from 'lucide-react';
import { Organization, Branch, Terminal } from '../../settings/types';
import { CreateTerminalInput } from '../../../services/organizationService';
import { useLanguage } from '../../../context/LanguageContext';
import { useConfirmation, ConfirmationOptions } from '../../../context/ConfirmationDialogContext';
import { Button } from '../../../components/common/Button';

export interface TerminalFormDialogProps {
  isOpen: boolean;
  mode: 'create' | 'edit';
  initialData?: Terminal | null;
  presetOrgId?: string;
  presetBranchId?: string;
  organizations: Organization[];
  branches: Branch[];
  existingTerminals: Terminal[];
  onClose: () => void;
  onSubmit: (data: CreateTerminalInput) => Promise<void>;
  onConfirmDelete?: (terminal: Terminal) => Promise<void>;
}

interface TerminalFormErrors {
  orgId?: string;
  branchId?: string;
  name?: string;
  code?: string;
  deviceModel?: string;
  ipAddress?: string;
}

const TERMINAL_CODE_REGEX = /^[A-Za-z0-9_-]{2,32}$/;
const IPV4_OR_HOST_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}|localhost|(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)$/;

const HARDWARE_PRESETS = [
  'Sunmi T2s Dual Screen',
  'PAX E700 Integrated POS',
  'Elo Touch I-Series 4',
  'iPad Pro 11-inch with Stand',
  'Standard POS Station',
];

export function buildTerminalDeleteConfirmation(
  term: Terminal,
  isThai: boolean
): ConfirmationOptions {
  return {
    title: isThai ? 'ยืนยันยกเลิกลงทะเบียนเครื่อง POS' : 'Confirm POS Terminal De-registration',
    description: isThai
      ? 'การลบเครื่องจะทำให้จุดชำระเงินนี้ไม่สามารถเข้าสู่ระบบเพื่อขายสินค้าได้'
      : 'De-registering will remove terminal identity and revoke cashier shift authorization.',
    message: isThai
      ? `คุณกำลังจะลบเครื่องขาย "${term.name}" (${term.code}) ออกจาก Firestore`
      : `You are about to de-register and delete terminal "${term.name}" (${term.code}).`,
    confirmText: isThai ? 'ยกเลิกลงทะเบียนเครื่อง POS' : 'De-register POS Terminal',
    cancelText: isThai ? 'ยกเลิก' : 'Cancel',
    variant: 'danger',
    icon: 'trash',
    requireMatchText: term.code,
    matchPrompt: isThai
      ? `พิมพ์รหัสเครื่อง "${term.code}" เพื่อยืนยันการยกเลิกลงทะเบียน:`
      : `Type terminal code "${term.code}" to confirm de-registration:`,
    impactDetails: [
      { label: isThai ? 'ชื่อเครื่องขาย' : 'Terminal Name', value: term.name, danger: true },
      { label: isThai ? 'รหัสประจำเครื่อง' : 'Terminal Code', value: term.code },
      {
        label: isThai ? 'รุ่นฮาร์ดแวร์' : 'Device Model',
        value: term.deviceModel || 'Standard POS',
      },
    ],
  };
}

export const TerminalFormDialog: React.FC<TerminalFormDialogProps> = ({
  isOpen,
  mode,
  initialData,
  presetOrgId,
  presetBranchId,
  organizations,
  branches,
  existingTerminals,
  onClose,
  onSubmit,
  onConfirmDelete,
}) => {
  const { language } = useLanguage();
  const { confirm } = useConfirmation();
  const isThai = language === 'th';

  const [form, setForm] = useState<CreateTerminalInput>({
    branchId: '',
    orgId: '',
    name: '',
    code: '',
    deviceModel: 'Standard POS Station',
    ipAddress: '192.168.1.100',
    paperWidth: '80mm',
    status: 'active',
  });

  const [errors, setErrors] = useState<TerminalFormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && initialData) {
        const parentBranch = branches.find((b) => b.id === initialData.branchId);
        setForm({
          branchId: initialData.branchId,
          orgId: initialData.orgId || parentBranch?.orgId || '',
          name: initialData.name || '',
          code: initialData.code || '',
          deviceModel: initialData.deviceModel || 'Standard POS Station',
          ipAddress: initialData.ipAddress || '',
          paperWidth: initialData.paperWidth || '80mm',
          status: initialData.status || 'active',
        });
      } else {
        const targetBranch =
          branches.find((b) => b.id === presetBranchId) ||
          branches.find((b) => b.orgId === presetOrgId) ||
          branches[0];
        const targetBranchId = targetBranch?.id || '';
        const targetOrgId = targetBranch?.orgId || presetOrgId || organizations[0]?.id || '';
        const branchTerms = existingTerminals.filter((t) => t.branchId === targetBranchId);

        setForm({
          branchId: targetBranchId,
          orgId: targetOrgId,
          name: '',
          code: `Terminal-${String(branchTerms.length + 1).padStart(3, '0')}`,
          deviceModel: 'Standard POS Station',
          ipAddress: `192.168.1.${100 + branchTerms.length + 1}`,
          paperWidth: '80mm',
          status: 'active',
        });
      }
      setErrors({});
      setTouched({});
      setIsSubmitting(false);
      setIsDeleting(false);
    }
  }, [isOpen, mode, initialData, presetOrgId, presetBranchId, organizations, branches, existingTerminals]);

  const availableBranches = useMemo(() => {
    if (!form.orgId) return branches;
    return branches.filter((b) => b.orgId === form.orgId);
  }, [branches, form.orgId]);

  if (!isOpen) return null;

  const validateField = (values: CreateTerminalInput): TerminalFormErrors => {
    const nextErrors: TerminalFormErrors = {};
    const trimmedName = values.name.trim();
    const trimmedCode = values.code.trim();
    const trimmedDevice = (values.deviceModel || '').trim();
    const trimmedIp = (values.ipAddress || '').trim();

    // 1. Branch validation
    if (!values.branchId) {
      nextErrors.branchId = isThai
        ? 'กรุณาเลือกสาขาที่ติดตั้งเครื่อง POS'
        : 'Assigned store branch is required.';
    } else if (!branches.some((b) => b.id === values.branchId)) {
      nextErrors.branchId = isThai
        ? 'ไม่พบสาขาที่เลือกในระบบ'
        : 'Selected branch does not exist.';
    }

    // 2. Terminal Name validation
    if (!trimmedName) {
      nextErrors.name = isThai
        ? 'กรุณาระบุชื่อเครื่องจุดขาย (เช่น Counter 1)'
        : 'Terminal name is required.';
    } else if (trimmedName.length < 2) {
      nextErrors.name = isThai
        ? 'ชื่อเครื่องต้องมีอย่างน้อย 2 ตัวอักษร'
        : 'Terminal name must be at least 2 characters.';
    } else if (trimmedName.length > 100) {
      nextErrors.name = isThai
        ? 'ชื่อเครื่องต้องไม่เกิน 100 ตัวอักษร'
        : 'Terminal name cannot exceed 100 characters.';
    }

    // 3. Terminal Code validation
    if (!trimmedCode) {
      nextErrors.code = isThai
        ? 'กรุณาระบุรหัสประจำเครื่อง (เช่น Terminal-001)'
        : 'Terminal code is required.';
    } else if (!TERMINAL_CODE_REGEX.test(trimmedCode)) {
      nextErrors.code = isThai
        ? 'รหัสเครื่องใช้ได้เฉพาะ A-Z, 0-9, ขีดกลาง (-) และขีดล่าง (_) ความยาว 2-32 ตัวอักษร'
        : 'Code must be 2–32 alphanumeric characters, hyphens, or underscores.';
    } else if (values.branchId) {
      const duplicateCode = existingTerminals.some(
        (t) =>
          t.id !== initialData?.id &&
          t.branchId === values.branchId &&
          t.code.trim().toLowerCase() === trimmedCode.toLowerCase()
      );
      if (duplicateCode) {
        nextErrors.code = isThai
          ? `รหัสเครื่อง "${trimmedCode}" มีอยู่ในสาขานี้แล้ว`
          : `Terminal code "${trimmedCode}" is already registered in this branch.`;
      }
    }

    // 4. Device Model validation (optional)
    if (trimmedDevice && trimmedDevice.length > 100) {
      nextErrors.deviceModel = isThai
        ? 'ชื่อรุ่นฮาร์ดแวร์ต้องไม่เกิน 100 ตัวอักษร'
        : 'Hardware model cannot exceed 100 characters.';
    }

    // 5. IP Address / Hostname validation (optional)
    if (trimmedIp && !IPV4_OR_HOST_REGEX.test(trimmedIp)) {
      nextErrors.ipAddress = isThai
        ? 'รูปแบบ IP Address หรือ Hostname ไม่ถูกต้อง (เช่น 192.168.1.101)'
        : 'Invalid IPv4 address or hostname format (e.g. 192.168.1.101).';
    }

    return nextErrors;
  };

  const handleFieldChange = <K extends keyof CreateTerminalInput>(
    field: K,
    value: CreateTerminalInput[K]
  ) => {
    const updated = { ...form, [field]: value };
    setForm(updated);
    if (touched[field]) {
      setErrors(validateField(updated));
    }
  };

  const handleBlur = (field: keyof CreateTerminalInput) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors(validateField(form));
  };

  const handleAutoCode = () => {
    const branchTerms = existingTerminals.filter((t) => t.branchId === form.branchId);
    let idx = branchTerms.length + 1;
    let candidate = `Terminal-${String(idx).padStart(3, '0')}`;
    while (
      branchTerms.some(
        (t) =>
          t.id !== initialData?.id &&
          t.code.trim().toLowerCase() === candidate.toLowerCase()
      )
    ) {
      idx += 1;
      candidate = `Terminal-${String(idx).padStart(3, '0')}`;
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
      branchId: true,
      name: true,
      code: true,
      deviceModel: true,
      ipAddress: true,
    });

    const validationErrors = validateField(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    const parentBranch = branches.find((b) => b.id === form.branchId);
    const effectiveOrgId = form.orgId || parentBranch?.orgId || '';

    setIsSubmitting(true);
    try {
      await onSubmit({
        branchId: form.branchId,
        orgId: effectiveOrgId,
        name: form.name.trim(),
        code: form.code.trim(),
        deviceModel: form.deviceModel?.trim() || 'Standard POS Station',
        ipAddress: form.ipAddress?.trim() || '',
        paperWidth: form.paperWidth || '80mm',
        status: form.status || 'active',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDestructiveDelete = async () => {
    if (!initialData || !onConfirmDelete) return;
    const isConfirmed = await confirm(buildTerminalDeleteConfirmation(initialData, isThai));
    if (!isConfirmed) return;

    setIsDeleting(true);
    try {
      await onConfirmDelete(initialData);
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="terminal-dialog-title"
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
            <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-700 flex items-center justify-center font-bold shrink-0">
              <Monitor className="h-5 w-5" />
            </div>
            <div>
              <h3 id="terminal-dialog-title" className="text-base font-black text-slate-900">
                {mode === 'create'
                  ? isThai
                    ? 'ลงทะเบียนเครื่องขาย POS ใหม่'
                    : 'Register New POS Terminal'
                  : isThai
                  ? 'แก้ไขการตั้งค่าเครื่อง POS'
                  : 'Edit POS Terminal'}
              </h3>
              <p className="text-xs text-slate-400">
                {mode === 'create'
                  ? isThai
                    ? 'กำหนดจุดชำระเงิน ฮาร์ดแวร์ และเครื่องพิมพ์ใบเสร็จ'
                    : 'Configure checkout station hardware and receipt specs'
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
          {/* Organization & Assigned Branch */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isThai ? 'องค์กร (Organization)' : 'Organization'}
              </label>
              <div className="relative">
                <Building2 className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={form.orgId || ''}
                  disabled={mode === 'edit'}
                  onChange={(e) => {
                    const nextOrgId = e.target.value;
                    const firstBranchInOrg = branches.find((b) => b.orgId === nextOrgId);
                    const updated = {
                      ...form,
                      orgId: nextOrgId,
                      branchId: firstBranchInOrg ? firstBranchInOrg.id : '',
                    };
                    setForm(updated);
                    if (touched.branchId) {
                      setErrors(validateField(updated));
                    }
                  }}
                  className="w-full pl-8 pr-3 py-2 text-xs font-bold border border-slate-200 rounded-xl bg-white text-slate-900 focus:outline-hidden focus:border-blue-600 disabled:bg-slate-50 disabled:text-slate-500"
                >
                  <option value="">
                    {isThai ? '-- ทุกองค์กร --' : '-- All Organizations --'}
                  </option>
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isThai ? 'ประจำสาขา (Assigned Branch) *' : 'Assigned Branch *'}
              </label>
              <div className="relative">
                <Store className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={form.branchId}
                  onChange={(e) => {
                    const selectedBranch = branches.find((b) => b.id === e.target.value);
                    const updated = {
                      ...form,
                      branchId: e.target.value,
                      orgId: selectedBranch?.orgId || form.orgId,
                    };
                    setForm(updated);
                    setTouched((prev) => ({ ...prev, branchId: true }));
                    setErrors(validateField(updated));
                  }}
                  onBlur={() => handleBlur('branchId')}
                  className={`w-full pl-8 pr-3 py-2 text-xs font-bold border rounded-xl bg-white text-slate-900 focus:outline-hidden ${
                    touched.branchId && errors.branchId
                      ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                      : 'border-slate-200 focus:border-blue-600'
                  }`}
                >
                  <option value="">{isThai ? '-- เลือกสาขา --' : '-- Select Branch --'}</option>
                  {availableBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code || b.id})
                    </option>
                  ))}
                </select>
              </div>
              {touched.branchId && errors.branchId && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>{errors.branchId}</span>
                </p>
              )}
            </div>
          </div>

          {/* Terminal Name & Code */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isThai ? 'ชื่อเครื่องขาย (Terminal Name) *' : 'Terminal Name *'}
              </label>
              <input
                type="text"
                placeholder="e.g. Main Checkout Counter 1"
                value={form.name}
                onChange={(e) => handleFieldChange('name', e.target.value)}
                onBlur={() => handleBlur('name')}
                className={`w-full px-3 py-2 text-xs border rounded-xl bg-white text-slate-900 focus:outline-hidden ${
                  touched.name && errors.name
                    ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                    : 'border-slate-200 focus:border-blue-600'
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
                  {isThai ? 'รหัสเครื่อง (Terminal Code) *' : 'Terminal Code *'}
                </label>
                <button
                  type="button"
                  onClick={handleAutoCode}
                  className="text-[10px] font-bold text-blue-600 hover:underline flex items-center gap-0.5"
                >
                  <Sparkles className="h-2.5 w-2.5" />
                  {isThai ? 'สร้างรหัสอัตโนมัติ' : 'Auto-code'}
                </button>
              </div>
              <div className="relative">
                <Hash className="h-3.5 w-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="e.g. Terminal-001"
                  value={form.code}
                  onChange={(e) =>
                    handleFieldChange(
                      'code',
                      e.target.value.replace(/[^a-zA-Z0-9_-]/g, '-')
                    )
                  }
                  onBlur={() => handleBlur('code')}
                  className={`w-full pl-7 pr-3 py-2 text-xs font-mono border rounded-xl bg-white text-slate-900 focus:outline-hidden ${
                    touched.code && errors.code
                      ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                      : 'border-slate-200 focus:border-blue-600'
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

          {/* Device Model & LAN IP Address */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isThai ? 'รุ่นฮาร์ดแวร์ (Hardware Model)' : 'Device / Hardware Model'}
              </label>
              <div className="relative">
                <Cpu className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  list="pos-hardware-presets"
                  placeholder="e.g. Sunmi T2s Dual Screen"
                  value={form.deviceModel || ''}
                  onChange={(e) => handleFieldChange('deviceModel', e.target.value)}
                  onBlur={() => handleBlur('deviceModel')}
                  className={`w-full pl-8 pr-3 py-2 text-xs border rounded-xl bg-white text-slate-900 focus:outline-hidden ${
                    touched.deviceModel && errors.deviceModel
                      ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                      : 'border-slate-200 focus:border-blue-600'
                  }`}
                />
                <datalist id="pos-hardware-presets">
                  {HARDWARE_PRESETS.map((preset) => (
                    <option key={preset} value={preset} />
                  ))}
                </datalist>
              </div>
              {touched.deviceModel && errors.deviceModel && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>{errors.deviceModel}</span>
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isThai ? 'IP Address / เครือข่าย LAN' : 'LAN IP Address / Host'}
              </label>
              <div className="relative">
                <Wifi className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="e.g. 192.168.1.101"
                  value={form.ipAddress || ''}
                  onChange={(e) => handleFieldChange('ipAddress', e.target.value)}
                  onBlur={() => handleBlur('ipAddress')}
                  className={`w-full pl-8 pr-3 py-2 text-xs font-mono border rounded-xl bg-white text-slate-900 focus:outline-hidden ${
                    touched.ipAddress && errors.ipAddress
                      ? 'border-rose-400 bg-rose-50/30 focus:border-rose-600'
                      : 'border-slate-200 focus:border-blue-600'
                  }`}
                />
              </div>
              {touched.ipAddress && errors.ipAddress && (
                <p className="mt-1 text-[11px] font-semibold text-rose-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>{errors.ipAddress}</span>
                </p>
              )}
            </div>
          </div>

          {/* Paper Width & Terminal Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                <Printer className="h-3.5 w-3.5 text-blue-600" />
                <span>{isThai ? 'หน้ากว้างกระดาษใบเสร็จ' : 'Receipt Paper Width'}</span>
              </label>
              <select
                value={form.paperWidth || '80mm'}
                onChange={(e) =>
                  handleFieldChange('paperWidth', e.target.value as '58mm' | '80mm')
                }
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 rounded-xl bg-white text-slate-900 focus:outline-hidden focus:border-blue-600"
              >
                <option value="80mm">80mm (Standard Thermal Desktop)</option>
                <option value="58mm">58mm (Compact Handheld / Mobile)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isThai ? 'สถานะเครื่องขาย (Terminal Status)' : 'Terminal Status'}
              </label>
              <select
                value={form.status || 'active'}
                onChange={(e) =>
                  handleFieldChange(
                    'status',
                    e.target.value as 'active' | 'maintenance' | 'inactive'
                  )
                }
                className="w-full px-3 py-2 text-xs font-bold border border-slate-200 rounded-xl bg-white text-slate-900 focus:outline-hidden focus:border-blue-600"
              >
                <option value="active">
                  {isThai ? 'พร้อมปฏิบัติการ (Active)' : 'Active (Ready)'}
                </option>
                <option value="maintenance">
                  {isThai ? 'ซ่อมบำรุง (Maintenance)' : 'Maintenance'}
                </option>
                <option value="inactive">
                  {isThai ? 'ปิดการใช้งาน (Inactive)' : 'Inactive (Offline)'}
                </option>
              </select>
            </div>
          </div>

          {/* Status Indicator Preview */}
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-600">
              {form.status === 'active' && (
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              )}
              {form.status === 'maintenance' && (
                <Wrench className="h-4 w-4 text-amber-600 shrink-0" />
              )}
              {form.status === 'inactive' && (
                <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
              )}
              <span>
                {form.status === 'active'
                  ? isThai
                    ? 'อนุญาตให้แคชเชียร์เลือกเครื่องนี้ในหน้า Login เพื่อเปิดกะขายได้'
                    : 'Cashiers can select this terminal at Login to open shifts.'
                  : form.status === 'maintenance'
                  ? isThai
                    ? 'อยู่ในโหมดซ่อมบำรุง (แจ้งเตือนผู้ดูแลระบบ)'
                    : 'Flagged under hardware/printer maintenance.'
                  : isThai
                  ? 'ปิดกั้นการเข้าใช้งานเครื่องนี้ชั่วคราว'
                  : 'Terminal is disabled for shift login.'}
              </span>
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
                  {isThai ? 'ยกเลิกลงทะเบียนเครื่อง' : 'De-register Terminal'}
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
                      ? 'ลงทะเบียนเครื่อง'
                      : 'Register Station'
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
