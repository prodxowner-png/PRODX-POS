/**
 * PRODX POS - Custom Permission Sets Management Interface
 * Comprehensive enterprise hub to define, customize, audit, and assign permission profiles for employee roles
 */

import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  ShieldCheck,
  ShieldAlert,
  Plus,
  Search,
  Filter,
  Layers,
  Copy,
  Edit2,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Users,
  Lock,
  Download,
  Upload,
  RotateCcw,
  UserPlus,
  Sliders,
  Check,
  Info,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Badge } from '../../../components/common/Badge';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { getZIndexClass } from '../../../utils/ZIndexManager';
import {
  CustomPermissionSet,
  PermissionRiskLevel,
  calculateSetRisk,
  DEFAULT_PERMISSION_SETS,
} from '../../../domain/permissionSets';
import { Role, Permission, PERMISSION_DEFINITIONS, User } from '../../../domain/auth';
import { PermissionSetModal } from './PermissionSetModal';
import { PermissionSetComparisonModal } from './PermissionSetComparisonModal';
import { PermissionSimulatorCard } from './PermissionSimulatorCard';

export const PermissionSetsManagement: React.FC = () => {
  const { language } = useLanguage();
  const { addToast } = useToast();
  const {
    session,
    staffUsers,
    rolePermissions,
    customPermissionSets,
    addCustomPermissionSet,
    updateCustomPermissionSet,
    deleteCustomPermissionSet,
    applyPermissionSetToRole,
    applyPermissionSetToStaff,
    resetPermissionSetsToDefaults,
  } = useAuth();

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role | 'custom'>('all');

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit' | 'clone'>('create');
  const [selectedSet, setSelectedSet] = useState<CustomPermissionSet | null>(null);
  const [isComparisonOpen, setIsComparisonOpen] = useState(false);
  const [isAssignStaffOpen, setIsAssignStaffOpen] = useState(false);
  const [assigningSet, setAssigningSet] = useState<CustomPermissionSet | null>(null);

  // JSON Import/Export Modal
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [jsonText, setJsonText] = useState('');

  // Security policies (retrieved from localStorage for simulator)
  const policies = useMemo(() => {
    try {
      const saved = localStorage.getItem('prodx_pos_security_policies');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      requirePinForVoid: true,
      requirePinForDiscount: true,
      requirePinForDrawerKick: true,
      requirePinForPriceOverride: true,
    };
  }, []);

  // Filtered Permission Sets
  const filteredSets = useMemo(() => {
    return customPermissionSets.filter((set) => {
      const matchesSearch =
        set.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (set.nameTh && set.nameTh.toLowerCase().includes(searchQuery.toLowerCase())) ||
        set.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
        set.description.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (roleFilter === 'all') return true;
      if (roleFilter === 'custom') return !set.isSystem;
      return set.targetRole === roleFilter;
    });
  }, [customPermissionSets, searchQuery, roleFilter]);

  // Handle Save from Modal
  const handleSaveSet = (
    data: Omit<CustomPermissionSet, 'id' | 'createdAt' | 'updatedAt'>,
    applyToRoleImmediately: boolean
  ) => {
    if (modalMode === 'edit' && selectedSet) {
      updateCustomPermissionSet(selectedSet.id, data);
      if (applyToRoleImmediately) {
        applyPermissionSetToRole(selectedSet.id, data.targetRole);
      }
      addToast({
        title: language === 'th' ? 'อัปเดตชุดสิทธิ์สำเร็จ' : 'Permission Set Updated',
        message: language === 'th' ? `บันทึกการเปลี่ยนแปลงของ "${data.name}" เรียบร้อยแล้ว` : `Updated ${data.name}.`,
        type: 'success',
      });
    } else {
      const created = addCustomPermissionSet(data);
      if (applyToRoleImmediately) {
        applyPermissionSetToRole(created.id, data.targetRole);
      }
      addToast({
        title: language === 'th' ? 'สร้างชุดสิทธิ์ใหม่สำเร็จ' : 'Permission Set Created',
        message: language === 'th' ? `ชุดสิทธิ์ "${data.name}" พร้อมใช้งานแล้ว` : `Created ${data.name}.`,
        type: 'success',
      });
    }
    setIsModalOpen(false);
    setSelectedSet(null);
  };

  // Handle Apply to Role
  const handleApplyToRole = (set: CustomPermissionSet) => {
    if (
      window.confirm(
        language === 'th'
          ? `คุณต้องการนำชุดสิทธิ์ "${set.nameTh || set.name}" ไปใช้เป็นสิทธิ์มาตรฐานของตำแหน่ง ${set.targetRole.toUpperCase()} หรือไม่?\n\nพนักงานทุกคนในตำแหน่งนี้จะได้รับสิทธิ์ใหม่ทันที`
          : `Apply "${set.name}" as the active permission set for ${set.targetRole.toUpperCase()} role?\n\nAll staff in this role will inherit these permissions immediately.`
      )
    ) {
      applyPermissionSetToRole(set.id, set.targetRole);
      addToast({
        title: language === 'th' ? 'นำชุดสิทธิ์ไปใช้แล้ว' : 'Applied to Role',
        message:
          language === 'th'
            ? `สิทธิ์ของตำแหน่ง ${set.targetRole.toUpperCase()} ได้รับการอัปเดตเรียบร้อยแล้ว`
            : `Synchronized ${set.targetRole.toUpperCase()} permissions across the POS system.`,
        type: 'success',
      });
    }
  };

  // Handle Delete
  const handleDelete = (set: CustomPermissionSet) => {
    if (set.isSystem) {
      addToast({
        title: language === 'th' ? 'ไม่สามารถลบชุดสิทธิ์มาตรฐาน' : 'Cannot Delete System Set',
        message: language === 'th' ? 'ชุดสิทธิ์ที่เป็นค่าตั้งต้นของระบบไม่สามารถลบได้' : 'System default permission sets cannot be deleted.',
        type: 'error',
      });
      return;
    }

    if (
      window.confirm(
        language === 'th'
          ? `คุณต้องการลบชุดสิทธิ์ "${set.nameTh || set.name}" ใช่หรือไม่?`
          : `Are you sure you want to delete "${set.name}"?`
      )
    ) {
      deleteCustomPermissionSet(set.id);
      addToast({
        title: language === 'th' ? 'ลบชุดสิทธิ์แล้ว' : 'Permission Set Deleted',
        message: language === 'th' ? `ลบ "${set.name}" เรียบร้อยแล้ว` : `Removed ${set.name}.`,
        type: 'info',
      });
    }
  };

  // Handle Reset Defaults
  const handleResetDefaults = () => {
    if (
      window.confirm(
        language === 'th'
          ? 'คุณต้องการรีเซ็ตชุดสิทธิ์ทั้งหมดกลับเป็นค่ามาตรฐานองค์กรหรือไม่? (ชุดสิทธิ์ที่สร้างเองจะถูกลบ)'
          : 'Reset all permission sets to enterprise factory defaults?'
      )
    ) {
      resetPermissionSetsToDefaults();
      addToast({
        title: language === 'th' ? 'คืนค่ามาตรฐานสำเร็จ' : 'Defaults Restored',
        message: language === 'th' ? 'คืนค่าชุดสิทธิ์ตั้งต้นเรียบร้อยแล้ว' : 'Restored default permission sets.',
        type: 'info',
      });
    }
  };

  // Export JSON
  const handleExportJson = () => {
    const dataStr = JSON.stringify(customPermissionSets, null, 2);
    setJsonText(dataStr);
    setIsJsonModalOpen(true);
  };

  // Import JSON
  const handleImportJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed) && parsed.length > 0) {
        localStorage.setItem('prodx_pos_custom_permission_sets', JSON.stringify(parsed));
        window.location.reload();
      } else {
        throw new Error('Invalid JSON format');
      }
    } catch (e) {
      addToast({
        title: language === 'th' ? 'นำเข้าล้มเหลว' : 'Import Failed',
        message: language === 'th' ? 'รูปแบบข้อมูล JSON ไม่ถูกต้อง' : 'Invalid permission sets JSON format.',
        type: 'error',
      });
    }
  };

  const getRiskBadge = (risk: PermissionRiskLevel) => {
    switch (risk) {
      case 'critical':
        return <Badge variant="danger" size="sm" className="font-bold text-[9px]">CRITICAL</Badge>;
      case 'high':
        return <Badge variant="warning" size="sm" className="font-bold text-[9px]">HIGH RISK</Badge>;
      case 'medium':
        return <Badge variant="neutral" size="sm" className="font-bold text-[9px]">MEDIUM</Badge>;
      default:
        return <Badge variant="success" size="sm" className="font-bold text-[9px]">LOW RISK</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Title Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border border-border border-crisp bg-card shadow-xs">
        <div className="flex items-start gap-3.5">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary shrink-0 mt-0.5">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-text">
                {language === 'th'
                  ? 'การจัดการชุดสิทธิ์พนักงาน (Custom Permission Sets)'
                  : 'Custom Permission Sets Management'}
              </h2>
              <Badge variant="primary" size="sm" className="font-mono text-[9px] uppercase font-bold">
                ENTERPRISE RBAC
              </Badge>
            </div>
            <p className="text-xs text-text/60 mt-1 max-w-2xl leading-relaxed">
              {language === 'th'
                ? 'ออกแบบและกำหนดชุดสิทธิ์ตามบทบาทพนักงาน (Cashier, Manager, Admin) ปรับแต่งการเข้าถึงคำสั่งสำคัญ เช่น การคิดเงิน ยกเลิกบิล คืนเงิน และสต็อกสินค้า เพื่อความโปร่งใสและปลอดภัย'
                : 'Define, customize, and govern modular permission sets for employee roles. Control frontline checkout, voids, returns, drawer access, and inventory adjustments.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setIsComparisonOpen(true)}
            className="rounded-lg text-xs"
            leftIcon={<Layers className="h-3.5 w-3.5" />}
          >
            {language === 'th' ? 'เปรียบเทียบชุดสิทธิ์' : 'Compare'}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportJson}
            className="rounded-lg text-xs"
            leftIcon={<Download className="h-3.5 w-3.5" />}
          >
            {language === 'th' ? 'สำรอง JSON' : 'Backup JSON'}
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => {
              setSelectedSet(null);
              setModalMode('create');
              setIsModalOpen(true);
            }}
            className="rounded-lg font-bold text-xs"
            leftIcon={<Plus className="h-4 w-4" />}
          >
            {language === 'th' ? 'สร้างชุดสิทธิ์ใหม่' : 'New Permission Set'}
          </Button>
        </div>
      </div>

      {/* Overview Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs">
          <div className="text-[11px] font-bold text-text/50 uppercase">
            {language === 'th' ? 'ชุดสิทธิ์ทั้งหมด' : 'Total Permission Sets'}
          </div>
          <div className="text-xl font-mono font-bold text-text mt-1">
            {customPermissionSets.length}
            <span className="text-xs font-normal text-text/50 ml-1.5">
              ({customPermissionSets.filter((s) => !s.isSystem).length} custom)
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs">
          <div className="text-[11px] font-bold text-text/50 uppercase">
            {language === 'th' ? 'สิทธิ์ฟังก์ชันทั้งหมด' : 'Platform Operations'}
          </div>
          <div className="text-xl font-mono font-bold text-primary mt-1">
            {PERMISSION_DEFINITIONS.length}
            <span className="text-xs font-normal text-text/50 ml-1.5">granular checks</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs">
          <div className="text-[11px] font-bold text-text/50 uppercase">
            {language === 'th' ? 'พนักงานที่มอบหมายแล้ว' : 'Staff Members Governed'}
          </div>
          <div className="text-xl font-mono font-bold text-emerald-600 dark:text-emerald-400 mt-1">
            {staffUsers.length}
            <span className="text-xs font-normal text-text/50 ml-1.5">active staff</span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs">
          <div className="text-[11px] font-bold text-text/50 uppercase">
            {language === 'th' ? 'การอนุมัติระดับสูง' : 'Supervisor Overrides'}
          </div>
          <div className="text-xl font-mono font-bold text-amber-500 mt-1">
            {Object.values(policies).filter(Boolean).length} / 4
            <span className="text-xs font-normal text-text/50 ml-1.5">active policies</span>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Role Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: 'all' as const, labelTh: 'ทั้งหมด', labelEn: 'All Profiles' },
            { id: 'cashier' as const, labelTh: 'แคชเชียร์ (Cashier)', labelEn: 'Cashier' },
            { id: 'manager' as const, labelTh: 'ผู้จัดการ (Manager)', labelEn: 'Manager' },
            { id: 'admin' as const, labelTh: 'ผู้ดูแลระบบ (Admin)', labelEn: 'Admin' },
            { id: 'custom' as const, labelTh: 'ชุดสิทธิ์กำหนดเอง', labelEn: 'Custom Only' },
          ].map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setRoleFilter(pill.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                roleFilter === pill.id
                  ? 'bg-primary text-primary-foreground shadow-2xs'
                  : 'bg-card border border-border text-text/70 hover:bg-background'
              }`}
            >
              {language === 'th' ? pill.labelTh : pill.labelEn}
            </button>
          ))}
        </div>

        {/* Search Field */}
        <div className="relative min-w-[240px]">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-text/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              language === 'th'
                ? 'ค้นหาชุดสิทธิ์, รหัส, หรือคำอธิบาย...'
                : 'Search permission sets...'
            }
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-card text-xs text-text placeholder:text-text/40 focus:ring-2 focus:ring-primary focus:outline-hidden"
          />
        </div>
      </div>

      {/* Permission Sets Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredSets.map((set) => {
          const risk = calculateSetRisk(set.permissions);
          const hasVoid = set.permissions.includes('pos:void');
          const hasRefund = set.permissions.includes('pos:refund');
          const hasPriceOverride = set.permissions.includes('pos:price_override');

          // Check if this set's permissions currently match the role's active permissions
          const isRoleActiveDefault =
            JSON.stringify([...set.permissions].sort()) ===
            JSON.stringify([...(rolePermissions[set.targetRole] || [])].sort());

          // Assigned staff for this set
          const assignedStaff = staffUsers.filter(
            (u) =>
              (set.assignedStaffIds && set.assignedStaffIds.includes(u.id)) ||
              (isRoleActiveDefault && u.role === set.targetRole)
          );

          return (
            <Card
              key={set.id}
              className={`border border-crisp shadow-xs rounded-xl overflow-hidden flex flex-col justify-between transition-all hover:border-primary/40 ${
                isRoleActiveDefault ? 'border-primary/50 ring-1 ring-primary/20' : 'border-border'
              }`}
            >
              <CardHeader className="bg-card border-b border-border/80 p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge
                        variant={
                          set.targetRole === 'admin'
                            ? 'primary'
                            : set.targetRole === 'manager'
                            ? 'warning'
                            : 'success'
                        }
                        size="sm"
                        className="font-mono text-[9px] uppercase font-bold"
                      >
                        {set.targetRole}
                      </Badge>
                      {set.isSystem ? (
                        <Badge variant="neutral" size="sm" className="font-mono text-[9px] uppercase">
                          SYSTEM
                        </Badge>
                      ) : (
                        <Badge variant="purple" size="sm" className="font-mono text-[9px] uppercase font-bold">
                          CUSTOM
                        </Badge>
                      )}
                      {getRiskBadge(risk)}
                    </div>
                    <h3 className="text-sm font-bold text-text mt-1.5 truncate">
                      {language === 'th' ? set.nameTh || set.name : set.name}
                    </h3>
                    <span className="text-[10px] text-text/40 font-mono block uppercase">
                      Code: {set.code}
                    </span>
                  </div>

                  {isRoleActiveDefault && (
                    <span
                      title="Currently active baseline for this role"
                      className="px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 text-[9px] font-bold shrink-0 flex items-center gap-1"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      <span>{language === 'th' ? 'สิทธิ์ใช้งานหลัก' : 'Active Role'}</span>
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-text/60 line-clamp-2 leading-relaxed">
                  {language === 'th' ? set.descriptionTh || set.description : set.description}
                </p>
              </CardHeader>

              <CardBody className="p-4 space-y-3.5 flex-1 flex flex-col justify-between">
                <div className="space-y-3">
                  {/* Permissions Count & Progress bar */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-text/60 text-[11px]">
                        {language === 'th' ? 'ขอบเขตอำนาจในระบบ' : 'Permission Scope'}
                      </span>
                      <span className="font-mono font-bold text-text text-[11px]">
                        {set.permissions.length} / {PERMISSION_DEFINITIONS.length}{' '}
                        <span className="text-text/40">
                          ({Math.round((set.permissions.length / PERMISSION_DEFINITIONS.length) * 100)}%)
                        </span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-background rounded-full overflow-hidden border border-border/50">
                      <div
                        className="h-full bg-primary transition-all duration-300 rounded-full"
                        style={{
                          width: `${(set.permissions.length / PERMISSION_DEFINITIONS.length) * 100}%`,
                        }}
                      />
                    </div>
                  </div>

                  {/* Sensitive Action Badges */}
                  <div className="flex flex-wrap gap-1">
                    {hasVoid && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold border border-rose-500/20">
                        VOID ALLOWED
                      </span>
                    )}
                    {hasRefund && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-bold border border-rose-500/20">
                        REFUND ALLOWED
                      </span>
                    )}
                    {hasPriceOverride && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold border border-amber-500/20">
                        PRICE OVERRIDE
                      </span>
                    )}
                  </div>

                  {/* Assigned Staff Preview */}
                  <div className="pt-2 border-t border-border/60 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 text-text/60 text-[11px]">
                      <Users className="h-3.5 w-3.5 text-text/40" />
                      <span>{assignedStaff.length} {language === 'th' ? 'พนักงาน' : 'staff assigned'}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAssigningSet(set);
                        setIsAssignStaffOpen(true);
                      }}
                      className="text-[11px] font-bold text-primary hover:underline cursor-pointer flex items-center gap-1"
                    >
                      <UserPlus className="h-3 w-3" />
                      <span>{language === 'th' ? 'กำหนดพนักงาน' : 'Assign'}</span>
                    </button>
                  </div>
                </div>

                {/* Card Action Buttons */}
                <div className="pt-3 border-t border-border/80 flex items-center justify-between gap-1.5">
                  <Button
                    type="button"
                    variant={isRoleActiveDefault ? 'outline' : 'primary'}
                    size="sm"
                    onClick={() => handleApplyToRole(set)}
                    className="rounded-lg text-xs font-bold flex-1"
                  >
                    {isRoleActiveDefault
                      ? language === 'th'
                        ? 'กำลังใช้งาน (Active)'
                        : 'Active Baseline'
                      : language === 'th'
                      ? `ใช้กับ ${set.targetRole.toUpperCase()}`
                      : `Apply to ${set.targetRole}`}
                  </Button>

                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedSet(set);
                        setModalMode('clone');
                        setIsModalOpen(true);
                      }}
                      title={language === 'th' ? 'คัดลอกชุดสิทธิ์' : 'Clone set'}
                      className="p-1.5 rounded-lg text-text/60 hover:text-text"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedSet(set);
                        setModalMode('edit');
                        setIsModalOpen(true);
                      }}
                      title={language === 'th' ? 'แก้ไขชุดสิทธิ์' : 'Edit set'}
                      className="min-h-[44px] min-w-[44px] p-2 rounded-xl text-amber-700 dark:text-amber-300 bg-amber-500/15 border border-amber-500/30 hover:bg-amber-500/25 active:scale-95 transition-transform"
                    >
                      <Edit2 className="h-4 w-4 shrink-0" />
                    </Button>

                    {!set.isSystem && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(set)}
                        title={language === 'th' ? 'ลบชุดสิทธิ์' : 'Delete set'}
                        className="min-h-[44px] min-w-[44px] p-2 rounded-xl text-rose-700 dark:text-rose-300 bg-rose-500/15 border border-rose-500/30 hover:bg-rose-500/25 active:scale-95 transition-transform"
                      >
                        <Trash2 className="h-4 w-4 shrink-0" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Interactive Permission Simulator Sandbox */}
      <PermissionSimulatorCard permissionSets={customPermissionSets} policies={policies} />

      {/* Modals */}
      {isModalOpen && (
        <PermissionSetModal
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedSet(null);
          }}
          onSave={handleSaveSet}
          editingSet={selectedSet}
          mode={modalMode}
        />
      )}

      {isComparisonOpen && (
        <PermissionSetComparisonModal
          isOpen={isComparisonOpen}
          onClose={() => setIsComparisonOpen(false)}
          permissionSets={customPermissionSets}
        />
      )}

      {/* Staff Assignment Modal */}
      {isAssignStaffOpen && assigningSet && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          className={`fixed inset-0 ${getZIndexClass('modal')} flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs`}
        >
          <div className="relative w-full max-w-md bg-card rounded-2xl border border-border border-crisp shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card/90">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                  <UserPlus className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text">
                    {language === 'th' ? 'มอบหมายพนักงานเข้าชุดสิทธิ์' : 'Assign Staff to Permission Set'}
                  </h3>
                  <p className="text-[11px] text-text/50">
                    {assigningSet.nameTh || assigningSet.name} ({assigningSet.targetRole.toUpperCase()})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsAssignStaffOpen(false);
                  setAssigningSet(null);
                }}
                className="p-1 rounded-lg text-text/50 hover:text-text cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-5 max-h-80 overflow-y-auto space-y-2">
              <p className="text-xs text-text/60 mb-3">
                {language === 'th'
                  ? 'เลือกพนักงานที่ต้องการผูกชุดสิทธิ์นี้ สิทธิ์ใหม่จะถูกนำไปใช้ทันที:'
                  : 'Select staff members to apply these permissions to:'}
              </p>
              {staffUsers.map((user) => {
                const isAssigned = (assigningSet.assignedStaffIds || []).includes(user.id);
                return (
                  <label
                    key={user.id}
                    className="p-3 rounded-lg border border-border bg-background/50 hover:bg-background flex items-center justify-between cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                        {user.name.charAt(0)}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-text">{user.name}</div>
                        <div className="text-[10px] text-text/50 font-mono">
                          {user.employeeCode} • {user.role}
                        </div>
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={isAssigned}
                      onChange={() => {
                        applyPermissionSetToStaff(assigningSet.id, user.id);
                        const willBeAssigned = !isAssigned;
                        addToast({
                          title: language === 'th' ? (willBeAssigned ? 'มอบหมายสำเร็จ' : 'ยกเลิกการมอบหมาย') : (willBeAssigned ? 'Staff Assigned' : 'Staff Unassigned'),
                          message: `${user.name} ${willBeAssigned ? '->' : 'X'} ${assigningSet.name}`,
                          type: 'success',
                        });
                      }}
                      className="rounded text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                    />
                  </label>
                );
              })}
            </div>

            <div className="px-5 py-3 border-t border-border bg-card/90 flex justify-end">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => {
                  setIsAssignStaffOpen(false);
                  setAssigningSet(null);
                }}
                className="rounded-lg text-xs font-bold"
              >
                {language === 'th' ? 'เสร็จสิ้น' : 'Done'}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* JSON Modal */}
      {isJsonModalOpen && typeof document !== 'undefined' && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          className={`fixed inset-0 ${getZIndexClass('modal')} flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs`}
        >
          <div className="relative w-full max-w-2xl bg-card rounded-2xl border border-border border-crisp shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-card/90">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-text">
                  {language === 'th' ? 'สำรองและนำเข้าข้อมูลชุดสิทธิ์ (JSON)' : 'Permission Sets Backup & Import'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsJsonModalOpen(false)}
                className="p-1 rounded-lg text-text/50 hover:text-text cursor-pointer"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              <textarea
                rows={12}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                className="w-full p-3 rounded-lg border border-border bg-background font-mono text-[11px] text-text focus:ring-2 focus:ring-primary focus:outline-hidden"
              />
            </div>
            <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-card/90">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(jsonText);
                  addToast({
                    title: language === 'th' ? 'คัดลอกลงคลิปบอร์ดแล้ว' : 'Copied to Clipboard',
                    message: language === 'th' ? 'คัดลอกข้อมูล JSON เรียบร้อยแล้ว' : 'JSON payload copied.',
                    type: 'info',
                  });
                }}
                className="rounded-lg text-xs"
              >
                {language === 'th' ? 'คัดลอก JSON' : 'Copy JSON'}
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsJsonModalOpen(false)}
                  className="rounded-lg text-xs"
                >
                  {language === 'th' ? 'ปิด' : 'Close'}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleImportJson}
                  className="rounded-lg text-xs font-bold"
                >
                  {language === 'th' ? 'นำเข้าข้อมูล JSON นี้' : 'Import JSON'}
                </Button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
