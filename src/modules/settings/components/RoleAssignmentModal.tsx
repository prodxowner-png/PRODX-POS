/**
 * PRODX POS - Single Staff Role & Permissions Assignment Modal
 */

import React, { useState, useMemo } from 'react';
import { User, Role, Permission, PERMISSION_DEFINITIONS } from '../../../domain/auth';
import { CustomPermissionSet, getPermissionRisk } from '../../../domain/permissionSets';
import { useAuth } from '../../../context/AuthContext';
import { useLanguage } from '../../../context/LanguageContext';
import { useToast } from '../../../context/ToastContext';
import { Modal } from '../../../components/common/Modal';
import { Button } from '../../../components/common/Button';
import { Badge } from '../../../components/common/Badge';
import { PermissionChangeConfirmationModal } from './PermissionChangeConfirmationModal';
import {
  Shield,
  ShieldCheck,
  Award,
  ShoppingCart,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Plus,
  Minus,
  FileText,
  Sliders,
  Check,
  UserCheck,
  Info,
} from 'lucide-react';

export interface RoleAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User | null;
  onSuccess?: () => void;
}

export const RoleAssignmentModal: React.FC<RoleAssignmentModalProps> = ({
  isOpen,
  onClose,
  user,
  onSuccess,
}) => {
  const { language } = useLanguage();
  const { session, staffUsers, rolePermissions, customPermissionSets, assignRoleToStaffUser } = useAuth();
  const { addToast } = useToast();

  const [selectedRole, setSelectedRole] = useState<Role>(user?.role || 'cashier');
  const [assignmentMode, setAssignmentMode] = useState<'default' | 'custom_set'>('default');
  const [selectedCustomSetId, setSelectedCustomSetId] = useState<string>('');
  const [assignmentNote, setAssignmentNote] = useState<string>('');
  const [isConfirmOpen, setIsConfirmOpen] = useState<boolean>(false);

  // Sync state when user prop changes
  React.useEffect(() => {
    if (user) {
      setSelectedRole(user.role);
      setAssignmentMode('default');
      setSelectedCustomSetId('');
      setAssignmentNote(user.roleAssignmentNote || '');
    }
  }, [user]);

  // Safety validations
  const isTargetingActiveUser = session?.currentUser.id === user?.id;
  const adminCount = useMemo(() => staffUsers.filter((u) => u.role === 'admin' && u.isActive !== false).length, [staffUsers]);
  const isLastAdminBeingDemoted = user?.role === 'admin' && selectedRole !== 'admin' && adminCount <= 1;

  // Available custom permission sets matching selected role
  const relevantPermissionSets = useMemo(() => {
    return customPermissionSets.filter((s) => s.targetRole === selectedRole);
  }, [customPermissionSets, selectedRole]);

  // Calculate target permissions based on configuration
  const targetPermissions: Permission[] = useMemo(() => {
    if (assignmentMode === 'custom_set' && selectedCustomSetId) {
      const pset = customPermissionSets.find((s) => s.id === selectedCustomSetId);
      if (pset) return pset.permissions;
    }
    return rolePermissions[selectedRole] || [];
  }, [assignmentMode, selectedCustomSetId, selectedRole, rolePermissions, customPermissionSets]);

  // Calculate permissions diff (added vs removed)
  const diff = useMemo(() => {
    if (!user) return { added: [], removed: [], unchanged: [] };
    const currentPerms = new Set(user.permissions.length > 0 ? user.permissions : rolePermissions[user.role] || []);
    const nextPerms = new Set(targetPermissions);

    const added: Permission[] = [];
    const removed: Permission[] = [];
    const unchanged: Permission[] = [];

    PERMISSION_DEFINITIONS.forEach((p) => {
      const inCurrent = currentPerms.has(p.id);
      const inNext = nextPerms.has(p.id);

      if (!inCurrent && inNext) {
        added.push(p.id);
      } else if (inCurrent && !inNext) {
        removed.push(p.id);
      } else if (inCurrent && inNext) {
        unchanged.push(p.id);
      }
    });

    return { added, removed, unchanged };
  }, [user, targetPermissions, rolePermissions]);

  if (!user) return null;

  const handleInitiateSave = () => {
    if (isLastAdminBeingDemoted) {
      addToast({
        title: language === 'th' ? 'ไม่สามารถเปลี่ยนบทบาทได้' : 'Cannot Demote Administrator',
        message:
          language === 'th'
            ? 'ร้านค้าต้องมีผู้ดูแลระบบ (Admin) อย่างน้อย 1 คน กรุณาตั้งผู้อื่นเป็น Admin ก่อน'
            : 'The store must retain at least one active Administrator. Promote another staff member first.',
        type: 'error',
      });
      return;
    }

    setIsConfirmOpen(true);
  };

  const handleConfirmSave = (confirmNote?: string) => {
    if (!user) return;

    const finalNote = confirmNote || assignmentNote.trim() || undefined;

    assignRoleToStaffUser(user.id, selectedRole, {
      permissions: targetPermissions,
      note: finalNote,
      permissionSetId: assignmentMode === 'custom_set' ? selectedCustomSetId : undefined,
    });

    addToast({
      title: language === 'th' ? 'กำหนดบทบาทใหม่สำเร็จ' : 'Role Assigned Successfully',
      message: `${user.name} ➔ ${selectedRole.toUpperCase()}`,
      type: 'success',
    });

    setIsConfirmOpen(false);
    if (onSuccess) onSuccess();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={language === 'th' ? 'กำหนดบทบาทและระดับสิทธิ์พนักงาน' : 'Assign Role & Access Level'}
      description={
        language === 'th'
          ? `มอบหมายบทบาทการทำงานและสิทธิ์การเข้าถึงให้ ${user.name} (${user.employeeCode})`
          : `Assign operational role and permission entitlements to ${user.name} (${user.employeeCode})`
      }
      maxWidth="3xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button type="button" variant="outline" size="sm" onClick={onClose} className="rounded-lg">
            {language === 'th' ? 'ยกเลิก' : 'Cancel'}
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleInitiateSave}
            disabled={isLastAdminBeingDemoted}
            className="rounded-lg font-bold min-h-[44px] px-4 cursor-pointer active:scale-95 transition-transform"
            leftIcon={<Check className="w-4 h-4" />}
          >
            {language === 'th' ? 'บันทึกการกำหนดบทบาท' : 'Confirm Role Assignment'}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* User Identity Banner */}
        <div className="p-3.5 rounded-xl border border-border border-crisp bg-background flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-sm">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-text">{user.name}</span>
                {isTargetingActiveUser && (
                  <Badge variant="primary" size="sm" className="font-mono text-[9px] uppercase font-bold">
                    {language === 'th' ? 'บัญชีที่คุณกำลังใช้งาน' : 'Your Active Session'}
                  </Badge>
                )}
              </div>
              <div className="text-xs text-text/60 font-mono">
                {user.employeeCode} • {user.email}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            <span className="text-xs text-text/50 font-medium">
              {language === 'th' ? 'บทบาทปัจจุบัน:' : 'Current Role:'}
            </span>
            <Badge
              variant={user.role === 'admin' ? 'primary' : user.role === 'manager' ? 'warning' : 'neutral'}
              size="sm"
              className="font-mono uppercase font-bold"
            >
              {user.role}
            </Badge>
          </div>
        </div>

        {/* Blocker alert if demoting last admin */}
        {isLastAdminBeingDemoted && (
          <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3 text-rose-700 dark:text-rose-400 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">
                {language === 'th' ? 'ไม่สามารถลดระดับบทบาทของแอดมินคนเดียวในระบบได้' : 'Cannot Demote the Last Active Administrator'}
              </p>
              <p className="text-[11px] mt-0.5 opacity-90">
                {language === 'th'
                  ? 'ระบบต้องการผู้ดูแลระบบอย่างน้อย 1 คน เพื่อป้องกันปัญหาการเข้าถึงเมนูตั้งค่า กรุณากำหนดพนักงานท่านอื่นเป็น Admin ก่อน'
                  : 'The system requires at least one Administrator to manage store settings and permissions. Promote another user first.'}
              </p>
            </div>
          </div>
        )}

        {/* Warning if elevating to Admin */}
        {selectedRole === 'admin' && user.role !== 'admin' && (
          <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3 text-amber-700 dark:text-amber-400 text-xs">
            <Shield className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">
                {language === 'th' ? 'คำเตือนความปลอดภัย: สิทธิ์ระดับ Administrator' : 'Security Notice: Administrator Level Privileges'}
              </p>
              <p className="text-[11px] mt-0.5 opacity-90">
                {language === 'th'
                  ? 'ตำแหน่ง Administrator มีสิทธิ์สูงสุด สามารถแก้ไขการตั้งค่าระบบ ภาษี ลบบัญชีพนักงาน และดูรายงานการเงินทั้งหมดได้'
                  : 'Administrators have unrestricted authority across system settings, tax configurations, audit trails, and staff profiles.'}
              </p>
            </div>
          </div>
        )}

        {/* Step 1: Select Target Role */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-text uppercase tracking-wider">
            {language === 'th' ? '1. เลือกบทบาทที่ต้องการมอบหมาย' : '1. Select Target Role'}
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              {
                id: 'admin' as Role,
                titleTh: 'ผู้ดูแลระบบ (Admin)',
                titleEn: 'Administrator',
                descTh: 'สิทธิ์สูงสุด เข้าถึงการตั้งค่า จัดการพนักงาน และรายงาน',
                descEn: 'Full store settings, audit logs & staff management',
                icon: ShieldCheck,
                badgeVariant: 'primary' as const,
                level: 'Full Access (15/15)',
              },
              {
                id: 'manager' as Role,
                titleTh: 'ผู้จัดการกะ (Manager)',
                titleEn: 'Shift Manager',
                descTh: 'เปิด-ปิดกะ คืนเงิน ปรับสต็อก และอนุมัติคำสั่งพิเศษ',
                descEn: 'Float control, refunds, line voids & inventory adjustments',
                icon: Award,
                badgeVariant: 'warning' as const,
                level: 'Supervisor (11/15)',
              },
              {
                id: 'cashier' as Role,
                titleTh: 'พนักงานขาย (Cashier)',
                titleEn: 'Cashier / Frontline',
                descTh: 'คิดเงินหน้าร้าน บันทึกลูกค้า และจัดการกะพื้นฐาน',
                descEn: 'POS checkout, customer management & till operations',
                icon: ShoppingCart,
                badgeVariant: 'neutral' as const,
                level: 'Standard POS (6/15)',
              },
            ].map((roleOption) => {
              const isSelected = selectedRole === roleOption.id;
              const Icon = roleOption.icon;

              return (
                <button
                  key={roleOption.id}
                  type="button"
                  onClick={() => setSelectedRole(roleOption.id)}
                  className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'bg-primary/10 border-primary ring-2 ring-primary/20 shadow-xs'
                      : 'bg-card border-border hover:border-primary/40'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div
                        className={`p-2 rounded-lg ${
                          isSelected ? 'bg-primary text-primary-foreground' : 'bg-background border border-border text-text/70'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>
                      <Badge variant={roleOption.badgeVariant} size="sm" className="font-mono text-[9px] uppercase font-bold">
                        {roleOption.level}
                      </Badge>
                    </div>

                    <div>
                      <h4 className="text-xs font-bold text-text">
                        {language === 'th' ? roleOption.titleTh : roleOption.titleEn}
                      </h4>
                      <p className="text-[11px] text-text/60 line-clamp-2 mt-0.5">
                        {language === 'th' ? roleOption.descTh : roleOption.descEn}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-border/50 flex items-center justify-between text-[11px]">
                    <span className="text-text/50">
                      {isSelected ? (
                        <span className="text-primary font-bold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> {language === 'th' ? 'เลือกอยู่' : 'Selected'}
                        </span>
                      ) : (
                        language === 'th' ? 'คลิกเพื่อเลือก' : 'Click to select'
                      )}
                    </span>
                    {user.role === roleOption.id && (
                      <span className="text-[10px] font-mono text-text/50 bg-background px-1.5 py-0.5 rounded border border-border">
                        {language === 'th' ? 'บทบาทปัจจุบัน' : 'Current'}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2: Permissions Configuration Mode (Default vs Custom Set) */}
        <div className="space-y-2.5">
          <label className="text-xs font-bold text-text uppercase tracking-wider">
            {language === 'th' ? '2. รูปแบบชุดสิทธิ์ (Entitlement Profile)' : '2. Entitlement Profile'}
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => {
                setAssignmentMode('default');
                setSelectedCustomSetId('');
              }}
              className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                assignmentMode === 'default'
                  ? 'bg-primary/10 border-primary ring-1 ring-primary/30'
                  : 'bg-card border-border hover:border-primary/40'
              }`}
            >
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className={`w-4 h-4 ${assignmentMode === 'default' ? 'text-primary' : 'text-text/40'}`}
                />
                <span className="text-xs font-bold text-text">
                  {language === 'th' ? 'ใช้สิทธิ์มาตรฐานตามตำแหน่ง (Standard Baseline)' : 'Standard Role Matrix Defaults'}
                </span>
              </div>
              <p className="text-[11px] text-text/60 mt-1 pl-6">
                {language === 'th'
                  ? `กำหนดสิทธิ์ตามที่ตั้งค่าไว้ในตารางสิทธิ์ตำแหน่ง ${selectedRole.toUpperCase()} อัตโนมัติ`
                  : `Automatically synchronizes with active matrix defaults for ${selectedRole.toUpperCase()}.`}
              </p>
            </button>

            <button
              type="button"
              onClick={() => {
                setAssignmentMode('custom_set');
                if (!selectedCustomSetId && relevantPermissionSets.length > 0) {
                  setSelectedCustomSetId(relevantPermissionSets[0].id);
                }
              }}
              className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                assignmentMode === 'custom_set'
                  ? 'bg-primary/10 border-primary ring-1 ring-primary/30'
                  : 'bg-card border-border hover:border-primary/40'
              }`}
            >
              <div className="flex items-center gap-2">
                <Sliders
                  className={`w-4 h-4 ${assignmentMode === 'custom_set' ? 'text-primary' : 'text-text/40'}`}
                />
                <span className="text-xs font-bold text-text">
                  {language === 'th' ? 'ผูกกับชุดสิทธิ์กำหนดเอง (Custom Permission Set)' : 'Link Custom Permission Set'}
                </span>
              </div>
              <p className="text-[11px] text-text/60 mt-1 pl-6">
                {language === 'th'
                  ? 'เลือกโปรไฟล์สิทธิ์พิเศษ เช่น แคชเชียร์อาวุโส หรือ ผู้ตรวจสอบสต็อก'
                  : 'Select an enterprise permission preset tailored for specific operational needs.'}
              </p>
            </button>
          </div>

          {/* If custom set is selected, show dropdown/cards */}
          {assignmentMode === 'custom_set' && (
            <div className="p-3.5 rounded-xl border border-border bg-background space-y-2">
              <span className="text-xs font-bold text-text">
                {language === 'th'
                  ? `เลือกชุดสิทธิ์สำหรับตำแหน่ง ${selectedRole.toUpperCase()}:`
                  : `Select Custom Set for ${selectedRole.toUpperCase()}:`}
              </span>

              {relevantPermissionSets.length === 0 ? (
                <div className="text-xs text-text/50 p-3 bg-card rounded-lg border border-border text-center">
                  {language === 'th'
                    ? `ยังไม่มีชุดสิทธิ์กำหนดเองสำหรับตำแหน่ง ${selectedRole}`
                    : `No custom permission sets created for ${selectedRole} yet.`}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {relevantPermissionSets.map((pset) => {
                    const isSetSelected = selectedCustomSetId === pset.id;
                    return (
                      <button
                        key={pset.id}
                        type="button"
                        onClick={() => setSelectedCustomSetId(pset.id)}
                        className={`p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
                          isSetSelected
                            ? 'bg-primary/10 border-primary font-bold'
                            : 'bg-card border-border hover:border-primary/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-text font-bold">
                            {language === 'th' ? pset.nameTh || pset.name : pset.name}
                          </span>
                          <span className="text-[10px] font-mono text-text/50">
                            {pset.permissions.length} perms
                          </span>
                        </div>
                        <p className="text-[10px] text-text/60 mt-0.5 truncate">
                          {language === 'th' ? pset.descriptionTh || pset.description : pset.description}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Step 3: Permissions Diff Preview */}
        <div className="p-3.5 rounded-xl border border-border border-crisp bg-background space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-text uppercase tracking-wider flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-primary" />
              {language === 'th' ? 'การเปลี่ยนแปลงสิทธิ์ (Permission Impact)' : 'Entitlement Impact Diff'}
            </span>
            <span className="text-xs font-mono text-text/60">
              {targetPermissions.length} / 15 {language === 'th' ? 'สิทธิ์ที่ได้รับ' : 'permissions active'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {/* Added permissions */}
            <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 space-y-1">
              <div className="flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-400 text-[11px]">
                <Plus className="w-3 h-3" />
                {language === 'th' ? `สิทธิ์ที่จะได้รับเพิ่ม (${diff.added.length})` : `Granted Permissions (${diff.added.length})`}
              </div>
              {diff.added.length === 0 ? (
                <div className="text-[10px] text-emerald-700/60 dark:text-emerald-400/60 italic">
                  {language === 'th' ? 'ไม่มีสิทธิ์เพิ่มเติม' : 'No new permissions added'}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pt-1">
                  {diff.added.map((p) => (
                    <span key={p} className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 font-mono text-[9px]">
                      +{p}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Removed permissions */}
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 space-y-1">
              <div className="flex items-center gap-1 font-bold text-rose-700 dark:text-rose-400 text-[11px]">
                <Minus className="w-3 h-3" />
                {language === 'th' ? `สิทธิ์ที่จะถูกถอนออก (${diff.removed.length})` : `Revoked Permissions (${diff.removed.length})`}
              </div>
              {diff.removed.length === 0 ? (
                <div className="text-[10px] text-rose-700/60 dark:text-rose-400/60 italic">
                  {language === 'th' ? 'ไม่มีสิทธิ์ที่ถูกเพิกถอน' : 'No permissions revoked'}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto pt-1">
                  {diff.removed.map((p) => (
                    <span key={p} className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-800 dark:text-rose-300 font-mono text-[9px]">
                      -{p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Step 4: Assignment Reason / Note (Audit Log) */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-text uppercase tracking-wider flex items-center justify-between">
            <span>{language === 'th' ? 'บันทึกเหตุผลการมอบหมาย (Audit Note)' : 'Assignment Note / Audit Reason'}</span>
            <span className="text-[10px] text-text/40 font-normal">{language === 'th' ? 'ไม่บังคับ' : 'Optional'}</span>
          </label>
          <input
            type="text"
            value={assignmentNote}
            onChange={(e) => setAssignmentNote(e.target.value)}
            placeholder={
              language === 'th'
                ? 'เช่น ผ่านการประเมินงาน, มอบหมายงานหัวหน้ากะ, ปรับเปลี่ยนตามหน้าที่...'
                : 'e.g. Promoted to shift supervisor, completed cashier training...'
            }
            className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background text-text focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      {/* Permission Change Confirmation Modal */}
      {isConfirmOpen && (
        <PermissionChangeConfirmationModal
          isOpen={isConfirmOpen}
          onClose={() => setIsConfirmOpen(false)}
          user={user}
          targetRole={selectedRole}
          customTargetPermissions={assignmentMode === 'custom_set' ? targetPermissions : undefined}
          onConfirm={handleConfirmSave}
        />
      )}
    </Modal>
  );
};
