/**
 * PRODX POS - User-to-Role Assignment Table Component
 * Comprehensive enterprise RBAC table enabling administrators to manage personnel access
 * by mapping staff profiles to predefined system roles (Admin, Manager, Staff/Cashier)
 * with a searchable interface and confirmation modal for all permission changes.
 */

import React, { useState, useMemo } from 'react';
import { User, Role, Permission, ROLE_PERMISSIONS, PERMISSION_DEFINITIONS } from '../../../domain/auth';
import { useAuth } from '../../../context/AuthContext';
import { useLanguage } from '../../../context/LanguageContext';
import { useToast } from '../../../context/ToastContext';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Badge } from '../../../components/common/Badge';
import { RoleAssignmentModal } from './RoleAssignmentModal';
import { BatchRoleAssignmentModal } from './BatchRoleAssignmentModal';
import { PermissionChangeConfirmationModal } from './PermissionChangeConfirmationModal';
import { ResetRolePermissionsModal } from './ResetRolePermissionsModal';
import { StaffFormModal } from './StaffFormModal';
import { getRbacAuditLogs, RbacAuditLog } from '../utils/rbacAudit';
import {
  Users,
  Shield,
  ShieldCheck,
  Award,
  ShoppingCart,
  Search,
  CheckCircle2,
  AlertTriangle,
  ArrowRightLeft,
  Sliders,
  Check,
  X,
  RotateCcw,
  Sparkles,
  Info,
  CheckSquare,
  Square,
  Filter,
  ArrowUpDown,
  Lock,
  UserCheck,
  HelpCircle,
  UserPlus,
  Edit2,
  Trash2,
  FileText,
} from 'lucide-react';

export const UserToRoleAssignmentTable: React.FC = () => {
  const { language } = useLanguage();
  const {
    session,
    staffUsers,
    rolePermissions,
    customPermissionSets,
    assignRoleToStaffUser,
    updateStaffUser,
    addStaffUser,
    deleteStaffUser,
    switchActiveUser,
    resetRolePermissions,
  } = useAuth();
  const { addToast } = useToast();

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [capabilityFilter, setCapabilityFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'name' | 'role' | 'code'>('role');

  // Multi-selection state
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  // Modal dialog states
  const [assignmentModalUser, setAssignmentModalUser] = useState<User | null>(null);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [editingStaffUser, setEditingStaffUser] = useState<User | null>(null);

  // Dedicated Permission Change Confirmation Modal State
  const [confirmingRoleChange, setConfirmingRoleChange] = useState<{
    user: User;
    targetRole: Role;
  } | null>(null);

  // Activity Log visibility state
  const [showActivityLog, setShowActivityLog] = useState(false);

  const handleOpenAddStaff = () => {
    setEditingStaffUser(null);
    setIsStaffModalOpen(true);
  };

  const handleOpenEditStaff = (u: User) => {
    setEditingStaffUser(u);
    setIsStaffModalOpen(true);
  };

  const handleDeleteStaff = (u: User) => {
    if (session?.currentUser.id === u.id) {
      addToast({
        title: language === 'th' ? 'ไม่สามารถลบบัญชีตัวเองได้' : 'Cannot Delete Active User',
        message: language === 'th' ? 'คุณกำลังล็อกอินด้วยบัญชีนี้อยู่ในขณะนี้' : 'You are currently signed in as this user.',
        type: 'error',
      });
      return;
    }

    if (window.confirm(
      language === 'th'
        ? `ต้องการลบพนักงาน ${u.name} (${u.employeeCode}) หรือไม่?`
        : `Are you sure you want to delete ${u.name} (${u.employeeCode})?`
    )) {
      deleteStaffUser(u.id);
      addToast({
        title: language === 'th' ? 'ลบพนักงานสำเร็จ' : 'Staff Member Removed',
        message: `${u.name} (${u.employeeCode})`,
        type: 'info',
      });
    }
  };

  const handleSaveStaffForm = (data: {
    name: string;
    email: string;
    role: Role;
    employeeCode: string;
    pin?: string;
    isActive?: boolean;
    roleAssignmentNote?: string;
    assignedPermissionSetId?: string;
  }) => {
    const now = new Date().toISOString();
    const assignedBy = session?.currentUser.name || 'Administrator';

    if (editingStaffUser) {
      updateStaffUser(editingStaffUser.id, {
        ...data,
        lastRoleAssignedAt: data.role !== editingStaffUser.role ? now : editingStaffUser.lastRoleAssignedAt || now,
        assignedBy: data.role !== editingStaffUser.role ? assignedBy : editingStaffUser.assignedBy || assignedBy,
        roleAssignmentNote: data.roleAssignmentNote,
        assignedPermissionSetId: data.assignedPermissionSetId,
      });
      addToast({
        title: language === 'th' ? 'อัปเดตข้อมูลพนักงานแล้ว' : 'Staff Updated',
        message: `${data.name} (${data.employeeCode})`,
        type: 'success',
      });
    } else {
      const created = addStaffUser({
        name: data.name,
        email: data.email,
        role: data.role,
        employeeCode: data.employeeCode,
        pin: data.pin,
        isActive: data.isActive,
      });
      updateStaffUser(created.id, {
        lastRoleAssignedAt: now,
        assignedBy,
        roleAssignmentNote: data.roleAssignmentNote,
        assignedPermissionSetId: data.assignedPermissionSetId,
      });
      addToast({
        title: language === 'th' ? 'เพิ่มพนักงานใหม่สำเร็จ' : 'Staff Member Added',
        message: `${created.name} (${created.employeeCode})`,
        type: 'success',
      });
    }
  };

  // Filtered users calculation
  const filteredUsers = useMemo(() => {
    return staffUsers
      .filter((u) => {
        // Role match
        const matchesRole = roleFilter === 'all' || u.role === roleFilter;

        // Status match
        const matchesStatus =
          statusFilter === 'all' ||
          (statusFilter === 'active' && u.isActive !== false) ||
          (statusFilter === 'inactive' && u.isActive === false);

        // Search text match (Name, Employee ID, Email, Role Note)
        const q = searchQuery.toLowerCase().trim();
        const matchesQuery =
          !q ||
          u.name.toLowerCase().includes(q) ||
          u.employeeCode.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          (u.roleAssignmentNote && u.roleAssignmentNote.toLowerCase().includes(q)) ||
          u.role.toLowerCase().includes(q);

        // Capability filter match
        let matchesCapability = true;
        if (capabilityFilter !== 'all') {
          const userPerms = u.permissions.length > 0 ? u.permissions : (rolePermissions[u.role] as Permission[]) || [];
          matchesCapability = userPerms.includes(capabilityFilter as Permission);
        }

        return matchesRole && matchesStatus && matchesQuery && matchesCapability;
      })
      .sort((a, b) => {
        if (sortBy === 'name') {
          return a.name.localeCompare(b.name);
        }
        if (sortBy === 'code') {
          return a.employeeCode.localeCompare(b.employeeCode);
        }
        // Sort by role hierarchy: admin -> manager -> cashier
        const roleOrder: Record<Role, number> = { admin: 1, manager: 2, cashier: 3 };
        const orderDiff = (roleOrder[a.role] || 4) - (roleOrder[b.role] || 4);
        if (orderDiff !== 0) return orderDiff;
        return a.name.localeCompare(b.name);
      });
  }, [staffUsers, roleFilter, statusFilter, capabilityFilter, searchQuery, sortBy, rolePermissions]);

  // Role metrics & safety counters
  const metrics = useMemo(() => {
    const total = staffUsers.length;
    const adminCount = staffUsers.filter((u) => u.role === 'admin' && u.isActive !== false).length;
    const managerCount = staffUsers.filter((u) => u.role === 'manager' && u.isActive !== false).length;
    const cashierCount = staffUsers.filter((u) => u.role === 'cashier' && u.isActive !== false).length;
    const inactiveCount = staffUsers.filter((u) => u.isActive === false).length;

    return {
      total,
      adminCount,
      managerCount,
      cashierCount,
      inactiveCount,
      isSingleAdmin: adminCount === 1,
      hasNoAdmin: adminCount === 0,
    };
  }, [staffUsers]);

  // Bulk selection handlers
  const isAllSelected = filteredUsers.length > 0 && selectedUserIds.length === filteredUsers.length;
  const isPartiallySelected = selectedUserIds.length > 0 && selectedUserIds.length < filteredUsers.length;

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedUserIds([]);
    } else {
      setSelectedUserIds(filteredUsers.map((u) => u.id));
    }
  };

  const handleToggleSelectRow = (userId: string) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  // Direct Inline Role Switch handler: Opens the confirmation modal instead of applying silently
  const handleInitiateRoleChange = (user: User, newRole: Role) => {
    if (user.role === newRole) return;

    // Safety check: Cannot demote the last remaining admin
    if (user.role === 'admin' && newRole !== 'admin' && metrics.adminCount <= 1) {
      addToast({
        title: language === 'th' ? 'ไม่สามารถเปลี่ยนบทบาทได้' : 'Operation Blocked',
        message:
          language === 'th'
            ? 'ร้านค้าต้องมีผู้ดูแลระบบ (Admin) อย่างน้อย 1 คนเสมอ เพื่อความปลอดภัยของระบบ'
            : 'At least one Administrator must remain in the store directory.',
        type: 'error',
      });
      return;
    }

    // Open confirmation modal
    setConfirmingRoleChange({ user, targetRole: newRole });
  };

  // Execution of confirmed role change
  const handleConfirmRoleChange = (note?: string) => {
    if (!confirmingRoleChange) return;

    const { user, targetRole } = confirmingRoleChange;

    assignRoleToStaffUser(user.id, targetRole, {
      note: note || `Role changed to ${targetRole.toUpperCase()} via User-to-Role Assignment Table`,
    });

    addToast({
      title: language === 'th' ? 'เปลี่ยนบทบาทและบันทึกสิทธิ์สำเร็จ' : 'Role & Permissions Updated',
      message: `${user.name} ➔ ${targetRole === 'admin' ? 'ADMIN' : targetRole === 'manager' ? 'MANAGER' : 'STAFF (CASHIER)'}`,
      type: 'success',
    });

    setConfirmingRoleChange(null);
  };

  // Toggle user active / inactive status with confirmation
  const handleToggleActiveStatus = (user: User) => {
    if (session?.currentUser.id === user.id) {
      addToast({
        title: language === 'th' ? 'ไม่สามารถระงับบัญชีตนเองได้' : 'Cannot Deactivate Self',
        message: language === 'th' ? 'คุณกำลังล็อกอินด้วยบัญชีนี้' : 'You are signed in with this profile.',
        type: 'error',
      });
      return;
    }

    const nextStatus = user.isActive === false;
    const confirmPrompt = nextStatus
      ? (language === 'th' ? `ต้องการเปิดใช้งานบัญชีของ ${user.name} (${user.employeeCode}) อีกครั้งหรือไม่?` : `Re-activate access for ${user.name} (${user.employeeCode})?`)
      : (language === 'th' ? `ต้องการระงับการใช้งานบัญชีของ ${user.name} (${user.employeeCode}) หรือไม่? การระงับจะยกเลิกสิทธิ์เข้าใช้งาน POS ทันที` : `Suspend access for ${user.name} (${user.employeeCode})? This immediately revokes operational entitlements.`);

    if (window.confirm(confirmPrompt)) {
      updateStaffUser(user.id, { isActive: nextStatus });

      addToast({
        title: nextStatus
          ? language === 'th' ? 'เปิดใช้งานบัญชีพนักงานแล้ว' : 'Personnel Profile Activated'
          : language === 'th' ? 'ระงับการใช้งานบัญชีพนักงานแล้ว' : 'Personnel Profile Suspended',
        message: `${user.name} (${user.employeeCode})`,
        type: 'info',
      });
    }
  };

  // Test switch active user
  const handleSwitchUser = (user: User) => {
    switchActiveUser(user);
    addToast({
      title: language === 'th' ? 'สลับผู้ใช้งานแล้ว' : 'Session Switched',
      message: `${user.name} • ${user.role.toUpperCase()}`,
      type: 'success',
    });
  };

  // Reset roles confirmed execution
  const handleConfirmResetToDefaults = () => {
    resetRolePermissions();
    addToast({
      title: language === 'th' ? 'รีเซ็ตสิทธิ์มาตรฐานสำเร็จ' : 'Role Baselines Restored',
      message:
        language === 'th'
          ? 'สิทธิ์ของ Admin, Manager, และ Cashier ถูกคืนค่าเริ่มต้นแล้ว'
          : 'Standard system role baseline permissions restored.',
      type: 'success',
    });
  };

  return (
    <div className="space-y-4">
      {/* Metrics & Role Health Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Total Profiles */}
        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs">
          <div className="text-[11px] font-bold text-text/50 uppercase tracking-wider">
            {language === 'th' ? 'พนักงานทั้งหมด' : 'Staff Profiles'}
          </div>
          <div className="text-xl font-bold text-text mt-1 flex items-baseline gap-2">
            <span>{metrics.total}</span>
            {metrics.inactiveCount > 0 && (
              <span className="text-[11px] font-normal text-text/50">
                ({metrics.inactiveCount} {language === 'th' ? 'ปิดใช้งาน' : 'inactive'})
              </span>
            )}
          </div>
        </div>

        {/* Administrators */}
        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-primary uppercase tracking-wider">
              {language === 'th' ? 'ผู้ดูแลระบบ (Admin)' : 'Administrators'}
            </span>
            <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          </div>
          <div className="text-xl font-bold text-primary mt-1 flex items-center justify-between">
            <span>{metrics.adminCount}</span>
            {metrics.isSingleAdmin && (
              <Badge variant="warning" size="sm" className="font-mono text-[9px]">
                {language === 'th' ? 'มีเพียง 1 คน' : 'Single Admin'}
              </Badge>
            )}
          </div>
        </div>

        {/* Shift Managers */}
        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
              {language === 'th' ? 'ผู้จัดการ (Manager)' : 'Shift Managers'}
            </span>
            <Award className="w-3.5 h-3.5 text-amber-500" />
          </div>
          <div className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">
            {metrics.managerCount}
          </div>
        </div>

        {/* Staff / Cashiers */}
        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-text/60 uppercase tracking-wider">
              {language === 'th' ? 'พนักงานขาย (Staff)' : 'Staff (Cashiers)'}
            </span>
            <ShoppingCart className="w-3.5 h-3.5 text-text/40" />
          </div>
          <div className="text-xl font-bold text-text/80 mt-1">
            {metrics.cashierCount}
          </div>
        </div>
      </div>

      {/* Main Assignment Table Card */}
      <Card className="border border-border border-crisp shadow-xs rounded-xl overflow-hidden">
        {/* Header with Title and Reset Controls */}
        <CardHeader className="bg-card border-b border-border py-3.5 px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-text">
                  {language === 'th'
                    ? 'ตารางกำหนดบทบาทพนักงาน (User-to-Role Assignment)'
                    : 'User-to-Role Assignment Table'}
                </h3>
                <Badge variant="primary" size="sm" className="font-mono text-[9px] uppercase font-bold">
                  RBAC
                </Badge>
              </div>
              <p className="text-[11px] text-text/50">
                {language === 'th'
                  ? 'มอบหมายบทบาทการทำงานและสิทธิ์ของพนักงาน (Manager / Staff / Admin) พร้อมระบบยืนยันความปลอดภัย'
                  : 'Map staff profiles to predefined system roles (Manager/Staff) with searchable controls and change confirmation.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleOpenAddStaff}
              className="text-xs h-9 px-3 font-bold shadow-xs cursor-pointer"
              leftIcon={<UserPlus className="w-4 h-4" />}
            >
              {language === 'th' ? '+ เพิ่มพนักงาน' : '+ Add Staff'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsResetModalOpen(true)}
              className="text-xs h-9 px-3 font-semibold text-text/70 hover:text-text cursor-pointer"
              leftIcon={<RotateCcw className="w-3.5 h-3.5 text-text/50" />}
              title={language === 'th' ? 'คืนค่าสิทธิ์มาตรฐานทุกตำแหน่ง' : 'Reset role permissions to baseline defaults'}
            >
              {language === 'th' ? 'คืนค่าสิทธิ์มาตรฐาน' : 'Reset Defaults'}
            </Button>
          </div>
        </CardHeader>

        <CardBody className="p-4 sm:p-5 space-y-4">
          {/* Search, Filters, and Sorting Toolbar */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            {/* Search Input with Clear Button */}
            <div className="relative w-full lg:w-80">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text/40" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  language === 'th'
                    ? 'ค้นหาชื่อ, รหัสพนักงาน, อีเมล...'
                    : 'Search staff by name, code, email...'
                }
                className="w-full pl-9 pr-8 py-1.5 text-xs rounded-lg border border-border bg-background text-text focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text/40 hover:text-text p-0.5 cursor-pointer"
                  title="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter Pills and Dropdowns */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Role filter buttons */}
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-background border border-border">
                {(
                  [
                    { id: 'all', labelTh: 'ทุกบทบาท', labelEn: 'All Roles' },
                    { id: 'admin', labelTh: 'Admin', labelEn: 'Admin' },
                    { id: 'manager', labelTh: 'Manager', labelEn: 'Manager' },
                    { id: 'cashier', labelTh: 'Staff', labelEn: 'Staff' },
                  ] as const
                ).map((f) => {
                  const isSelected = roleFilter === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setRoleFilter(f.id)}
                      className={`px-2.5 py-1 text-xs rounded-md font-bold transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-primary text-primary-foreground shadow-2xs'
                          : 'text-text/70 hover:text-text'
                      }`}
                    >
                      {language === 'th' ? f.labelTh : f.labelEn}
                    </button>
                  );
                })}
              </div>

              {/* Specific Capability Filter */}
              <select
                value={capabilityFilter}
                onChange={(e) => setCapabilityFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background text-text font-medium focus:outline-none cursor-pointer"
                title="Filter by capability"
              >
                <option value="all">{language === 'th' ? '⚡ ทุกสิทธิ์การใช้งาน' : '⚡ All Capabilities'}</option>
                <option value="pos:refund">{language === 'th' ? 'คืนเงิน (Refund)' : 'Can Refund'}</option>
                <option value="pos:void">{language === 'th' ? 'ยกเลิกบิล (Void)' : 'Can Void'}</option>
                <option value="pos:discount">{language === 'th' ? 'ให้ส่วนลด (Discount)' : 'Can Discount'}</option>
                <option value="pos:price_override">{language === 'th' ? 'แก้ราคา (Price Override)' : 'Can Price Override'}</option>
                <option value="settings:manage">{language === 'th' ? 'ตั้งค่าระบบ (Settings)' : 'Can Manage Settings'}</option>
                <option value="shift:pay_movement">{language === 'th' ? 'เบิกเงินลิ้นชัก (Drawer Float)' : 'Can Open Drawer Float'}</option>
                <option value="inventory:adjust">{language === 'th' ? 'ปรับสต็อก (Stock Adjust)' : 'Can Adjust Inventory'}</option>
              </select>

              {/* Status Filter */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background text-text font-medium focus:outline-none cursor-pointer"
              >
                <option value="all">{language === 'th' ? 'สถานะทั้งหมด' : 'All Status'}</option>
                <option value="active">{language === 'th' ? 'ใช้งานปกติ' : 'Active Only'}</option>
                <option value="inactive">{language === 'th' ? 'ระงับใช้งาน' : 'Inactive Only'}</option>
              </select>

              {/* Sort By */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'name' | 'role' | 'code')}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-border bg-background text-text font-medium focus:outline-none cursor-pointer"
              >
                <option value="role">{language === 'th' ? 'เรียงตาม: ลำดับบทบาท' : 'Sort: Role Hierarchy'}</option>
                <option value="name">{language === 'th' ? 'เรียงตาม: ชื่อ (A-Z)' : 'Sort: Name (A-Z)'}</option>
                <option value="code">{language === 'th' ? 'เรียงตาม: รหัสพนักงาน' : 'Sort: Employee Code'}</option>
              </select>
            </div>
          </div>

          {/* Bulk Selection Action Banner */}
          {selectedUserIds.length > 0 && (
            <div className="p-3 rounded-xl bg-primary/10 border border-primary/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-150">
              <div className="flex items-center gap-2">
                <Badge variant="primary" size="sm" className="font-mono font-bold">
                  {selectedUserIds.length}
                </Badge>
                <span className="text-xs font-bold text-text">
                  {language === 'th'
                    ? `เลือกพนักงานไว้ ${selectedUserIds.length} คน`
                    : `${selectedUserIds.length} staff profiles selected`}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setIsBatchModalOpen(true)}
                  className="rounded-lg font-bold text-xs h-7.5 px-3"
                  leftIcon={<Sliders className="w-3.5 h-3.5" />}
                >
                  {language === 'th' ? 'กำหนดบทบาทกลุ่ม' : 'Batch Assign Role'}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedUserIds([])}
                  className="rounded-lg text-xs h-7.5 px-2.5"
                >
                  {language === 'th' ? 'ยกเลิกการเลือก' : 'Clear'}
                </Button>
              </div>
            </div>
          )}

          {/* Active Filter Summary / Result Count */}
          <div className="flex items-center justify-between text-xs text-text/50 px-1">
            <span>
              {language === 'th'
                ? `แสดงพนักงาน ${filteredUsers.length} จากทั้งหมด ${staffUsers.length} คน`
                : `Showing ${filteredUsers.length} of ${staffUsers.length} personnel profiles`}
            </span>
            {(searchQuery || roleFilter !== 'all' || statusFilter !== 'all' || capabilityFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setRoleFilter('all');
                  setStatusFilter('all');
                  setCapabilityFilter('all');
                }}
                className="text-primary hover:underline font-semibold cursor-pointer"
              >
                {language === 'th' ? 'ล้างตัวกรองทั้งหมด' : 'Reset all filters'}
              </button>
            )}
          </div>

          {/* Mobile Personnel Cards View (< lg breakpoint) */}
          <div className="block lg:hidden space-y-3">
            {filteredUsers.length === 0 ? (
              <div className="p-8 text-center bg-card border border-border rounded-xl text-text/50">
                <Users className="w-8 h-8 text-text/30 mx-auto mb-2" />
                <p className="font-bold text-sm text-text">
                  {language === 'th'
                    ? 'ไม่พบข้อมูลพนักงานที่ตรงกับเงื่อนไขการค้นหา'
                    : 'No personnel profiles match the filter criteria.'}
                </p>
                <p className="text-xs text-text/50 mt-1">
                  {language === 'th'
                    ? 'ลองปรับเปลี่ยนคำค้นหา หรือล้างตัวกรองบทบาท'
                    : 'Try adjusting your search terms or clearing role filters.'}
                </p>
              </div>
            ) : (
              filteredUsers.map((u) => {
                const isSelected = selectedUserIds.includes(u.id);
                const isActiveSession = session?.currentUser.id === u.id;
                const effectivePerms =
                  u.permissions.length > 0
                    ? u.permissions
                    : (rolePermissions[u.role] as Permission[]) || [];
                const totalPermsCount = effectivePerms.length;

                const canRefund = effectivePerms.includes('pos:refund');
                const canDiscount = effectivePerms.includes('pos:discount');
                const canVoid = effectivePerms.includes('pos:void');
                const canSettings = effectivePerms.includes('settings:manage');
                const canDrawer = effectivePerms.includes('shift:pay_movement');

                return (
                  <div
                    key={`mob_${u.id}`}
                    className={`p-3.5 rounded-xl border transition-colors shadow-2xs space-y-3 ${
                      isActiveSession
                        ? 'bg-primary/5 border-primary/30'
                        : isSelected
                        ? 'bg-primary/5 border-primary/30'
                        : 'bg-card border-border hover:border-primary/30'
                    }`}
                  >
                    {/* Card Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <button
                          type="button"
                          onClick={() => handleToggleSelectRow(u.id)}
                          className="mt-0.5 cursor-pointer text-text/50 hover:text-primary shrink-0"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-primary" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>

                        <div
                          className={`w-9 h-9 rounded-xl border flex items-center justify-center font-bold text-xs shrink-0 ${
                            u.role === 'admin'
                              ? 'bg-primary/10 border-primary/20 text-primary'
                              : u.role === 'manager'
                              ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
                              : 'bg-background border-border text-text/70'
                          }`}
                        >
                          {u.name.charAt(0).toUpperCase()}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-sm text-text truncate">{u.name}</span>
                            {isActiveSession && (
                              <Badge variant="primary" size="sm" className="font-mono text-[9px] uppercase font-bold">
                                {language === 'th' ? 'คุณ' : 'You'}
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-text/50 font-mono mt-0.5 flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-text/80">{u.employeeCode}</span>
                            <span>•</span>
                            <span className="truncate max-w-[170px]">{u.email}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleToggleActiveStatus(u)}
                        className="cursor-pointer shrink-0"
                      >
                        {u.isActive !== false ? (
                          <Badge variant="success" size="sm" dot className="font-mono text-[9px] uppercase font-bold">
                            {language === 'th' ? 'ใช้งาน' : 'Active'}
                          </Badge>
                        ) : (
                          <Badge variant="neutral" size="sm" className="font-mono text-[9px] uppercase text-text/40">
                            {language === 'th' ? 'ระงับ' : 'Inactive'}
                          </Badge>
                        )}
                      </button>
                    </div>

                    {/* Role Switcher */}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50 flex-wrap">
                      <div className="text-xs font-semibold text-text/60">
                        {language === 'th' ? 'กำหนดบทบาทระบบ:' : 'System Role:'}
                      </div>
                      <div className="inline-flex p-0.5 rounded-lg bg-background border border-border">
                        {(
                          [
                            { id: 'admin' as Role, label: 'Admin' },
                            { id: 'manager' as Role, label: 'Manager' },
                            { id: 'cashier' as Role, label: 'Staff' },
                          ] as const
                        ).map((r) => {
                          const isCurrentRole = u.role === r.id;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => handleInitiateRoleChange(u, r.id)}
                              className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                                isCurrentRole
                                  ? r.id === 'admin'
                                    ? 'bg-primary text-primary-foreground shadow-2xs'
                                    : r.id === 'manager'
                                    ? 'bg-amber-500 text-white shadow-2xs'
                                    : 'bg-text/70 text-white shadow-2xs'
                                  : 'text-text/60 hover:text-text hover:bg-card'
                              }`}
                            >
                              {r.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Key Entitlements */}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/50 flex-wrap">
                      <div className="text-[11px] font-mono font-bold text-text/60">
                        {totalPermsCount}/15 {language === 'th' ? 'สิทธิ์การใช้งาน' : 'perms'}
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${canRefund ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-bold' : 'bg-background border border-border text-text/30 line-through'}`}>Refund</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${canDiscount ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-bold' : 'bg-background border border-border text-text/30 line-through'}`}>Disc</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${canVoid ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-bold' : 'bg-background border border-border text-text/30 line-through'}`}>Void</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${canDrawer ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-bold' : 'bg-background border border-border text-text/30 line-through'}`}>Drawer</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${canSettings ? 'bg-primary/10 text-primary font-bold' : 'bg-background border border-border text-text/30 line-through'}`}>Config</span>
                      </div>
                    </div>

                    {/* Mobile Card Action Buttons */}
                    <div className="flex items-center justify-end gap-2 pt-2.5 border-t border-border/50 flex-wrap">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setAssignmentModalUser(u)}
                        className="text-xs min-h-[44px] px-3 font-bold cursor-pointer active:scale-95 transition-transform bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25 shadow-2xs"
                        leftIcon={<Sliders className="w-4 h-4 text-primary shrink-0" />}
                      >
                        <span>{language === 'th' ? 'สิทธิ์' : 'Config'}</span>
                      </Button>

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleOpenEditStaff(u)}
                        className="text-xs min-h-[44px] px-3 font-bold cursor-pointer active:scale-95 transition-transform bg-amber-500/20 text-amber-950 dark:text-amber-100 border border-amber-500/50 hover:bg-amber-500/30 shadow-2xs"
                        leftIcon={<Edit2 className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0" />}
                      >
                        <span>{language === 'th' ? 'แก้ไข' : 'Edit'}</span>
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteStaff(u)}
                        className="text-xs min-h-[44px] px-3 font-bold cursor-pointer active:scale-95 transition-transform bg-rose-500/20 text-rose-950 dark:text-rose-100 border border-rose-500/50 hover:bg-rose-500/30 shadow-2xs"
                        leftIcon={<Trash2 className="w-4 h-4 text-rose-700 dark:text-rose-300 shrink-0" />}
                      >
                        <span>{language === 'th' ? 'ลบ' : 'Delete'}</span>
                      </Button>

                      {!isActiveSession && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleSwitchUser(u)}
                          className="text-xs min-h-[44px] min-w-[44px] p-0 text-text/80 hover:text-text cursor-pointer active:scale-95 transition-transform border border-border bg-background hover:bg-primary/10 flex items-center justify-center rounded-xl shadow-2xs"
                          title={language === 'th' ? 'สลับเข้าใช้งานบัญชีนี้' : 'Switch account'}
                        >
                          <ArrowRightLeft className="w-4 h-4 text-text/80" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop User-to-Role Assignment Data Table (>= lg breakpoint) */}
          <div className="hidden lg:block w-full overflow-x-auto rounded-xl border border-border bg-card shadow-2xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-card border-b border-border text-[11px] font-bold text-text/60 uppercase tracking-wider">
                  <th className="py-2.5 px-3 w-10 text-center">
                    <button
                      type="button"
                      onClick={handleToggleSelectAll}
                      className="cursor-pointer text-text/50 hover:text-primary flex items-center justify-center mx-auto"
                      title={language === 'th' ? 'เลือกทั้งหมด' : 'Select all'}
                    >
                      {isAllSelected ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : isPartiallySelected ? (
                        <div className="w-4 h-4 border-2 border-primary rounded bg-primary/20 flex items-center justify-center">
                          <div className="w-2 h-0.5 bg-primary" />
                        </div>
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  </th>

                  <th className="py-2.5 px-3 min-w-[200px]">
                    {language === 'th' ? 'พนักงานและรหัสประจำตัว' : 'Personnel Profile & ID'}
                  </th>

                  <th className="py-2.5 px-3 w-24 text-center">
                    {language === 'th' ? 'สถานะ' : 'Status'}
                  </th>

                  <th className="py-2.5 px-3 min-w-[120px]">
                    {language === 'th' ? 'บทบาทปัจจุบัน' : 'Current Role'}
                  </th>

                  <th className="py-2.5 px-3 min-w-[240px]">
                    <div className="flex items-center gap-1">
                      <span>{language === 'th' ? 'กำหนดบทบาทระบบ' : 'Map System Role'}</span>
                      <span className="text-[10px] text-text/40 font-normal font-sans">
                        ({language === 'th' ? 'มีหน้าต่างยืนยัน' : 'confirms on change'})
                      </span>
                    </div>
                  </th>

                  <th className="py-2.5 px-3 min-w-[170px]">
                    {language === 'th' ? 'ระดับสิทธิ์การใช้งาน' : 'Effective Capabilities'}
                  </th>

                  <th className="py-2.5 px-3 text-right min-w-[220px]">
                    {language === 'th' ? 'การดำเนินการ (Action)' : 'Action'}
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border/60 text-xs">
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-text/50">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Users className="w-8 h-8 text-text/30" />
                        <p className="font-bold text-sm text-text">
                          {language === 'th'
                            ? 'ไม่พบข้อมูลพนักงานที่ตรงกับเงื่อนไขการค้นหา'
                            : 'No personnel profiles match the filter criteria.'}
                        </p>
                        <p className="text-xs text-text/50">
                          {language === 'th'
                            ? 'ลองปรับเปลี่ยนคำค้นหา หรือล้างตัวกรองบทบาท'
                            : 'Try adjusting your search terms or clearing role filters.'}
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((u) => {
                    const isSelected = selectedUserIds.includes(u.id);
                    const isActiveSession = session?.currentUser.id === u.id;
                    const effectivePerms =
                      u.permissions.length > 0
                        ? u.permissions
                        : (rolePermissions[u.role] as Permission[]) || [];
                    const totalPermsCount = effectivePerms.length;

                    const canRefund = effectivePerms.includes('pos:refund');
                    const canDiscount = effectivePerms.includes('pos:discount');
                    const canVoid = effectivePerms.includes('pos:void');
                    const canSettings = effectivePerms.includes('settings:manage');
                    const canDrawer = effectivePerms.includes('shift:pay_movement');

                    return (
                      <tr
                        key={u.id}
                        className={`transition-colors duration-150 border-b border-border/50 ${
                          isActiveSession
                            ? 'bg-primary/10 hover:bg-primary/15'
                            : isSelected
                            ? 'bg-primary/10 hover:bg-primary/15'
                            : 'odd:bg-card even:bg-background/80 dark:even:bg-background/40 hover:bg-primary/10 dark:hover:bg-primary/20'
                        }`}
                      >
                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleSelectRow(u.id)}
                            className="cursor-pointer text-text/50 hover:text-primary flex items-center justify-center mx-auto min-h-[44px] min-w-[44px]"
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-primary" />
                            ) : (
                              <Square className="w-4 h-4" />
                            )}
                          </button>
                        </td>

                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2.5">
                            <div
                              className={`w-8 h-8 rounded-lg border flex items-center justify-center font-bold text-xs shrink-0 ${
                                u.role === 'admin'
                                  ? 'bg-primary/15 border-primary/30 text-primary'
                                  : u.role === 'manager'
                                  ? 'bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300'
                                  : 'bg-background border-border text-text/80'
                              }`}
                            >
                              {u.name.charAt(0).toUpperCase()}
                            </div>

                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-bold text-text truncate">{u.name}</span>
                                {isActiveSession && (
                                  <Badge variant="primary" size="sm" className="font-mono text-[9px] uppercase font-bold">
                                    {language === 'th' ? 'คุณ' : 'You'}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-[11px] text-text/60 font-mono mt-0.5 flex items-center gap-1.5">
                                <span className="font-bold text-text/80">{u.employeeCode}</span>
                                <span>•</span>
                                <span className="truncate max-w-[140px]">{u.email}</span>
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-2.5 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleToggleActiveStatus(u)}
                            className="cursor-pointer inline-flex items-center transition-transform hover:scale-105 active:scale-95 min-h-[44px]"
                            title={language === 'th' ? 'คลิกเพื่อเปิด/ปิดสิทธิ์การใช้งาน' : 'Click to toggle active status'}
                          >
                            {u.isActive !== false ? (
                              <Badge variant="success" size="sm" dot className="font-mono text-[10px] uppercase font-extrabold bg-emerald-500/20 text-emerald-950 dark:text-emerald-100 border border-emerald-500/50 shadow-2xs">
                                {language === 'th' ? 'ใช้งาน' : 'Active'}
                              </Badge>
                            ) : (
                              <Badge variant="neutral" size="sm" className="font-mono text-[10px] uppercase font-extrabold bg-rose-500/20 text-rose-950 dark:text-rose-100 border border-rose-500/50 shadow-2xs">
                                {language === 'th' ? 'ระงับ' : 'Inactive'}
                              </Badge>
                            )}
                          </button>
                        </td>

                        <td className="py-2.5 px-3">
                          <div className="space-y-0.5">
                            <Badge
                              variant={u.role === 'admin' ? 'primary' : u.role === 'manager' ? 'warning' : 'neutral'}
                              size="sm"
                              className={`font-mono uppercase text-[10px] font-extrabold inline-flex items-center gap-1 shadow-2xs ${
                                u.role === 'admin'
                                  ? 'bg-primary/20 text-primary border border-primary/40'
                                  : u.role === 'manager'
                                  ? 'bg-amber-500/20 text-amber-950 dark:text-amber-100 border border-amber-500/50'
                                  : 'bg-slate-500/20 text-text border border-slate-500/50'
                              }`}
                            >
                              {u.role === 'admin' && <ShieldCheck className="w-3 h-3" />}
                              {u.role === 'manager' && <Award className="w-3 h-3" />}
                              {u.role === 'cashier' && <ShoppingCart className="w-3 h-3" />}
                              {u.role === 'cashier' ? 'STAFF' : u.role.toUpperCase()}
                            </Badge>
                          </div>
                        </td>

                        <td className="py-2.5 px-3">
                          <div className="inline-flex p-1 rounded-xl bg-background border border-border border-crisp shadow-2xs items-center gap-1">
                            {(
                              [
                                { id: 'admin' as Role, label: 'Admin' },
                                { id: 'manager' as Role, label: 'Manager' },
                                { id: 'cashier' as Role, label: 'Staff' },
                              ] as const
                            ).map((r) => {
                              const isCurrentRole = u.role === r.id;
                              return (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={() => handleInitiateRoleChange(u, r.id)}
                                  className={`px-2.5 min-h-[38px] text-[11px] font-bold rounded-lg transition-all cursor-pointer active:scale-95 flex items-center justify-center ${
                                    isCurrentRole
                                      ? r.id === 'admin'
                                        ? 'bg-primary text-primary-foreground shadow-2xs'
                                        : r.id === 'manager'
                                        ? 'bg-amber-500 text-white shadow-2xs'
                                        : 'bg-slate-700 dark:bg-slate-300 text-white dark:text-slate-950 shadow-2xs'
                                      : 'text-text/70 hover:text-text hover:bg-card'
                                  }`}
                                >
                                  {r.label}
                                </button>
                              );
                            })}
                          </div>
                        </td>

                        <td className="py-2.5 px-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[11px] font-extrabold text-text">
                                {totalPermsCount}/15
                              </span>
                            </div>

                            <div className="flex items-center gap-1 flex-wrap">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${canRefund ? 'bg-emerald-500/20 text-emerald-950 dark:text-emerald-100 font-extrabold border border-emerald-500/30' : 'bg-background border border-border/60 text-text/40 line-through'}`}>Refund</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${canDiscount ? 'bg-emerald-500/20 text-emerald-950 dark:text-emerald-100 font-extrabold border border-emerald-500/30' : 'bg-background border border-border/60 text-text/40 line-through'}`}>Disc</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${canVoid ? 'bg-emerald-500/20 text-emerald-950 dark:text-emerald-100 font-extrabold border border-emerald-500/30' : 'bg-background border border-border/60 text-text/40 line-through'}`}>Void</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono ${canSettings ? 'bg-primary/20 text-primary font-extrabold border border-primary/30' : 'bg-background border border-border/60 text-text/40 line-through'}`}>Config</span>
                            </div>
                          </div>
                        </td>

                        <td className="py-2.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setAssignmentModalUser(u)}
                              className="text-xs min-h-[44px] px-3 font-bold cursor-pointer active:scale-95 transition-transform bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25 shadow-2xs"
                              title={language === 'th' ? 'กำหนดสิทธิ์รายละเอียด' : 'Configure role & permission set'}
                              leftIcon={<Sliders className="w-4 h-4 text-primary shrink-0" />}
                            >
                              <span>{language === 'th' ? 'สิทธิ์' : 'Config'}</span>
                            </Button>

                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenEditStaff(u)}
                              className="text-xs min-h-[44px] px-3 font-bold cursor-pointer active:scale-95 transition-transform bg-amber-500/20 text-amber-950 dark:text-amber-100 border border-amber-500/50 hover:bg-amber-500/30 shadow-2xs"
                              title={language === 'th' ? 'แก้ไขข้อมูลพนักงาน' : 'Edit staff profile'}
                              leftIcon={<Edit2 className="w-4 h-4 text-amber-700 dark:text-amber-300 shrink-0" />}
                            >
                              <span>{language === 'th' ? 'แก้ไข' : 'Edit'}</span>
                            </Button>

                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteStaff(u)}
                              className="text-xs min-h-[44px] px-3 font-bold cursor-pointer active:scale-95 transition-transform bg-rose-500/20 text-rose-950 dark:text-rose-100 border border-rose-500/50 hover:bg-rose-500/30 shadow-2xs"
                              title={language === 'th' ? 'ลบพนักงาน' : 'Delete staff member'}
                              leftIcon={<Trash2 className="w-4 h-4 text-rose-700 dark:text-rose-300 shrink-0" />}
                            >
                              <span>{language === 'th' ? 'ลบ' : 'Delete'}</span>
                            </Button>

                            {!isActiveSession && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleSwitchUser(u)}
                                className="text-xs min-h-[44px] min-w-[44px] p-0 text-text/80 hover:text-text cursor-pointer active:scale-95 transition-transform border border-border bg-background hover:bg-primary/10 flex items-center justify-center rounded-xl shadow-2xs"
                                title={language === 'th' ? 'สลับเข้าใช้งานบัญชีนี้' : 'Switch account'}
                              >
                                <ArrowRightLeft className="w-4 h-4 text-text/80" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      {/* Activity Log Toggle & Panel */}
      <div className="pt-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowActivityLog(!showActivityLog)}
          className="text-xs h-9 px-3.5 font-semibold gap-2 cursor-pointer shadow-2xs"
          leftIcon={<FileText className="w-4 h-4 text-primary" />}
        >
          <span>
            {language === 'th'
              ? (showActivityLog ? 'ปิดประวัติ Activity Log' : '📜 เปิดประวัติ Activity Log (ประวัติการเปลี่ยนสิทธิ์)')
              : (showActivityLog ? 'Hide RBAC Activity Log' : '📜 Show RBAC Activity Log')}
          </span>
          <Badge variant="neutral" size="sm" className="font-mono text-[9px]">
            {getRbacAuditLogs().length}
          </Badge>
        </Button>

        {showActivityLog && (
          <div className="mt-3 p-4 rounded-xl border border-border border-crisp bg-card space-y-3 shadow-xs animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold text-text uppercase tracking-wide flex items-center gap-2">
                <span>{language === 'th' ? 'ประวัติการเปลี่ยนแปลงสิทธิ์ (Audit Trail & Activity Log)' : 'RBAC Audit Trail & Activity Log'}</span>
              </div>
              <span className="text-[11px] text-text/50">
                {language === 'th' ? 'จัดเก็บใน localStorage แบบปลอดภัย' : 'Persisted securely in localStorage'}
              </span>
            </div>

            {getRbacAuditLogs().length === 0 ? (
              <div className="py-8 text-center text-xs text-text/50">
                {language === 'th'
                  ? 'ยังไม่มีประวัติการเปลี่ยนแปลงสิทธิ์ในเซสชันนี้'
                  : 'No permission change audit logs recorded yet.'}
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {getRbacAuditLogs().map((log: RbacAuditLog) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-xl border border-border bg-background flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="font-bold text-text flex items-center gap-2">
                        <span>{log.action}</span>
                      </div>
                      {log.details && (
                        <div className="text-[11px] text-text/60 mt-0.5">{log.details}</div>
                      )}
                      <div className="text-[10px] text-text/40 font-mono mt-1 flex items-center gap-2">
                        <span>👤 {log.author}</span>
                        {log.authorEmail && <span>({log.authorEmail})</span>}
                      </div>
                    </div>
                    <div className="text-[10px] text-text/50 font-mono shrink-0 self-start sm:self-center">
                      {new Date(log.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Staff Create / Edit Modal */}
      <StaffFormModal
        isOpen={isStaffModalOpen}
        onClose={() => setIsStaffModalOpen(false)}
        editingUser={editingStaffUser}
        onSave={handleSaveStaffForm}
      />

      {/* Permission Change Confirmation Modal (Shown on any role change) */}
      {confirmingRoleChange && (
        <PermissionChangeConfirmationModal
          isOpen={!!confirmingRoleChange}
          onClose={() => setConfirmingRoleChange(null)}
          user={confirmingRoleChange.user}
          targetRole={confirmingRoleChange.targetRole}
          onConfirm={handleConfirmRoleChange}
        />
      )}

      {/* Single Staff Role & Permissions Granular Modal */}
      {assignmentModalUser && (
        <RoleAssignmentModal
          isOpen={!!assignmentModalUser}
          onClose={() => setAssignmentModalUser(null)}
          user={assignmentModalUser}
        />
      )}

      {/* Batch Role Assignment Modal */}
      {isBatchModalOpen && (
        <BatchRoleAssignmentModal
          isOpen={isBatchModalOpen}
          onClose={() => setIsBatchModalOpen(false)}
          selectedUserIds={selectedUserIds}
          onSuccess={() => setSelectedUserIds([])}
        />
      )}

      {/* Reset Role Permissions Confirmation Modal */}
      {isResetModalOpen && (
        <ResetRolePermissionsModal
          isOpen={isResetModalOpen}
          onClose={() => setIsResetModalOpen(false)}
          onConfirm={handleConfirmResetToDefaults}
        />
      )}
    </div>
  );
};
