/**
 * PRODX POS - Bulk / Batch User Role Assignment Modal
 */

import React, { useState, useMemo } from 'react';
import { User, Role, ROLE_PERMISSIONS } from '../../../domain/auth';
import { useAuth } from '../../../context/AuthContext';
import { useLanguage } from '../../../context/LanguageContext';
import { useToast } from '../../../context/ToastContext';
import { Modal } from '../../../components/common/Modal';
import { Button } from '../../../components/common/Button';
import { Badge } from '../../../components/common/Badge';
import {
  Users,
  Shield,
  ShieldCheck,
  Award,
  ShoppingCart,
  AlertTriangle,
  Check,
} from 'lucide-react';

export interface BatchRoleAssignmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedUserIds: string[];
  onSuccess?: () => void;
}

export const BatchRoleAssignmentModal: React.FC<BatchRoleAssignmentModalProps> = ({
  isOpen,
  onClose,
  selectedUserIds,
  onSuccess,
}) => {
  const { language } = useLanguage();
  const { staffUsers, bulkAssignRoles, session } = useAuth();
  const { addToast } = useToast();

  const [targetRole, setTargetRole] = useState<Role>('cashier');
  const [note, setNote] = useState<string>('');

  const selectedUsers = useMemo(() => {
    return staffUsers.filter((u) => selectedUserIds.includes(u.id));
  }, [staffUsers, selectedUserIds]);

  // Check if this batch would demote all admins
  const totalAdmins = useMemo(() => staffUsers.filter((u) => u.role === 'admin').length, [staffUsers]);
  const adminsInSelection = useMemo(() => selectedUsers.filter((u) => u.role === 'admin').length, [selectedUsers]);
  const isDemotingAllAdmins = targetRole !== 'admin' && adminsInSelection >= totalAdmins;

  const handleConfirm = () => {
    if (isDemotingAllAdmins) {
      addToast({
        title: language === 'th' ? 'ไม่สามารถดำเนินการได้' : 'Operation Blocked',
        message:
          language === 'th'
            ? 'ไม่สามารถเปลี่ยนบทบาทแอดมินทั้งหมดได้ ระบบต้องมี Admin อย่างน้อย 1 คน'
            : 'Cannot demote all system administrators. At least one Admin must remain.',
        type: 'error',
      });
      return;
    }

    bulkAssignRoles(selectedUserIds, targetRole, {
      note: note.trim() || undefined,
    });

    addToast({
      title: language === 'th' ? 'กำหนดบทบาทกลุ่มสำเร็จ' : 'Bulk Role Assignment Applied',
      message:
        language === 'th'
          ? `อัปเดตบทบาท ${selectedUsers.length} คนเป็น ${targetRole.toUpperCase()}`
          : `Updated ${selectedUsers.length} staff profiles to ${targetRole.toUpperCase()}`,
      type: 'success',
    });

    if (onSuccess) onSuccess();
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={language === 'th' ? 'กำหนดบทบาทแบบกลุ่ม (Batch Role Assignment)' : 'Batch Assign Staff Roles'}
      description={
        language === 'th'
          ? `มอบหมายบทบาทใหม่ให้กับพนักงานที่เลือกจำนวน ${selectedUsers.length} คนพร้อมกัน`
          : `Apply role and permission matrix to ${selectedUsers.length} selected staff profiles at once.`
      }
      maxWidth="2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button type="button" variant="outline" size="sm" onClick={onClose} className="rounded-lg">
            {language === 'th' ? 'ยกเลิก' : 'Cancel'}
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleConfirm}
            disabled={isDemotingAllAdmins || selectedUserIds.length === 0}
            className="rounded-lg font-bold"
            leftIcon={<Check className="w-4 h-4" />}
          >
            {language === 'th'
              ? `ยืนยันมอบหมาย (${selectedUsers.length} คน)`
              : `Assign to ${selectedUsers.length} Users`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Selected Users Pill List */}
        <div className="p-3 rounded-xl border border-border bg-background space-y-2">
          <span className="text-xs font-bold text-text flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-primary" />
            {language === 'th'
              ? `พนักงานที่เลือก (${selectedUsers.length} คน):`
              : `Selected Staff Profiles (${selectedUsers.length}):`}
          </span>

          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
            {selectedUsers.map((u) => (
              <span
                key={u.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-card border border-border text-xs text-text font-medium"
              >
                <span>{u.name}</span>
                <span className="text-[10px] font-mono text-text/50">({u.role})</span>
              </span>
            ))}
          </div>
        </div>

        {/* Safety Warning if demoting all admins */}
        {isDemotingAllAdmins && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-400 text-xs flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">
                {language === 'th' ? 'เกิดข้อผิดพลาดด้านความปลอดภัย' : 'Security Policy Violation'}
              </p>
              <p className="text-[11px] mt-0.5">
                {language === 'th'
                  ? 'คุณกำลังเลือกเปลี่ยนบทบาทของ Administrator ทุกคนในระบบพร้อมกัน ระบบจำเป็นต้องมี Admin อย่างน้อย 1 คนเสมอ'
                  : 'This batch operation would remove all active Administrators from the store. Keep at least one Admin profile.'}
              </p>
            </div>
          </div>
        )}

        {/* Target Role Selector */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-text uppercase tracking-wider">
            {language === 'th' ? 'เลือกบทบาทปลายทาง (Target Role)' : 'Select Target Role'}
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {[
              {
                id: 'admin' as Role,
                title: 'Administrator',
                titleTh: 'ผู้ดูแลระบบ (Admin)',
                desc: 'Full System Control (15 perms)',
                descTh: 'สิทธิ์สูงสุด 15 รายการ',
                icon: ShieldCheck,
                badgeVariant: 'primary' as const,
              },
              {
                id: 'manager' as Role,
                title: 'Shift Manager',
                titleTh: 'ผู้จัดการ (Manager)',
                desc: 'Till Float, Refunds, Voids (11 perms)',
                descTh: 'เปิดปิดกะ คืนเงิน ปรับสต็อก',
                icon: Award,
                badgeVariant: 'warning' as const,
              },
              {
                id: 'cashier' as Role,
                title: 'Cashier Staff',
                titleTh: 'พนักงานขาย (Cashier)',
                desc: 'Standard Checkout (6 perms)',
                descTh: 'คิดเงินหน้าร้านปกติ',
                icon: ShoppingCart,
                badgeVariant: 'neutral' as const,
              },
            ].map((r) => {
              const isSelected = targetRole === r.id;
              const Icon = r.icon;

              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setTargetRole(r.id)}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-primary/10 border-primary ring-2 ring-primary/20'
                      : 'bg-card border-border hover:border-primary/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div
                      className={`p-1.5 rounded-lg ${
                        isSelected ? 'bg-primary text-primary-foreground' : 'bg-background border border-border text-text/70'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <Badge variant={r.badgeVariant} size="sm" className="font-mono text-[9px] uppercase font-bold">
                      {r.id}
                    </Badge>
                  </div>

                  <div className="mt-2">
                    <h5 className="text-xs font-bold text-text">
                      {language === 'th' ? r.titleTh : r.title}
                    </h5>
                    <p className="text-[10px] text-text/50 mt-0.5">
                      {language === 'th' ? r.descTh : r.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Audit Note */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-text uppercase tracking-wider">
            {language === 'th' ? 'บันทึกเหตุผลการดำเนินการกลุ่ม' : 'Batch Audit Reason'}
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={
              language === 'th'
                ? 'เช่น สลับกะการทำงานวันหยุด, อัปเดตตำแหน่งประจำไตรมาส...'
                : 'e.g. Quarterly staff role rotation, weekend shift handover...'
            }
            className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background text-text focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>
    </Modal>
  );
};
