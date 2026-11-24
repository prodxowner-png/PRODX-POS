/**
 * PRODX POS - Staff & User Accounts Management Section
 */

import React, { useState, useMemo } from 'react';
import { User, Role } from '../../../domain/auth';
import { useAuth } from '../../../context/AuthContext';
import { useLanguage } from '../../../context/LanguageContext';
import { useToast } from '../../../context/ToastContext';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Badge } from '../../../components/common/Badge';
import { StaffFormModal } from './StaffFormModal';
import { UserToRoleAssignmentTable } from './UserToRoleAssignmentTable';
import {
  Users,
  UserPlus,
  Search,
  KeyRound,
  Shield,
  ShieldCheck,
  Edit2,
  Trash2,
  CheckCircle2,
  ArrowRightLeft,
  UserCheck,
  Lock,
  LayoutGrid,
  Table,
} from 'lucide-react';

export const StaffManagementSection: React.FC = () => {
  const { language } = useLanguage();
  const { session, staffUsers, addStaffUser, updateStaffUser, deleteStaffUser, switchActiveUser, rolePermissions } =
    useAuth();
  const { addToast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | Role>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [viewMode, setViewMode] = useState<'cards' | 'role_matrix'>('cards');

  const filteredUsers = useMemo(() => {
    return staffUsers.filter((u) => {
      const matchesRole = roleFilter === 'all' || u.role === roleFilter;
      const q = searchQuery.toLowerCase().trim();
      const matchesQuery =
        !q ||
        u.name.toLowerCase().includes(q) ||
        u.employeeCode.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q);
      return matchesRole && matchesQuery;
    });
  }, [staffUsers, roleFilter, searchQuery]);

  const counts = useMemo(() => {
    return {
      total: staffUsers.length,
      admin: staffUsers.filter((u) => u.role === 'admin').length,
      manager: staffUsers.filter((u) => u.role === 'manager').length,
      cashier: staffUsers.filter((u) => u.role === 'cashier').length,
    };
  }, [staffUsers]);

  const handleOpenAdd = () => {
    setEditingUser(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (user: User) => {
    setEditingUser(user);
    setIsModalOpen(true);
  };

  const handleSaveUser = (data: {
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

    if (editingUser) {
      updateStaffUser(editingUser.id, {
        ...data,
        lastRoleAssignedAt: data.role !== editingUser.role ? now : editingUser.lastRoleAssignedAt || now,
        assignedBy: data.role !== editingUser.role ? assignedBy : editingUser.assignedBy || assignedBy,
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

  const handleDelete = (user: User) => {
    if (session?.currentUser.id === user.id) {
      addToast({
        title: language === 'th' ? 'ไม่สามารถลบบัญชีตัวเองได้' : 'Cannot Delete Active User',
        message: language === 'th' ? 'คุณกำลังล็อกอินด้วยบัญชีนี้อยู่ในขณะนี้' : 'You are currently signed in as this user.',
        type: 'error',
      });
      return;
    }

    if (window.confirm(
      language === 'th'
        ? `ต้องการลบพนักงาน ${user.name} (${user.employeeCode}) หรือไม่?`
        : `Are you sure you want to delete ${user.name} (${user.employeeCode})?`
    )) {
      deleteStaffUser(user.id);
      addToast({
        title: language === 'th' ? 'ลบพนักงานสำเร็จ' : 'Staff Member Removed',
        message: `${user.name} (${user.employeeCode})`,
        type: 'info',
      });
    }
  };

  const handleSwitchUser = (user: User) => {
    switchActiveUser(user);
    addToast({
      title: language === 'th' ? 'สลับผู้ใช้งานสำเร็จ' : 'Switched Active User',
      message: `${user.name} • ${user.role.toUpperCase()} (${user.employeeCode})`,
      type: 'success',
    });
  };

  return (
    <div className="space-y-4">
      {/* Overview Stat Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs">
          <div className="text-[11px] font-bold text-text/50 uppercase">
            {language === 'th' ? 'พนักงานทั้งหมด' : 'Total Staff'}
          </div>
          <div className="text-xl font-bold text-text mt-1">{counts.total}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs">
          <div className="text-[11px] font-bold text-text/50 uppercase">
            {language === 'th' ? 'ผู้ดูแลระบบ (Admin)' : 'Administrators'}
          </div>
          <div className="text-xl font-bold text-primary mt-1">{counts.admin}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs">
          <div className="text-[11px] font-bold text-text/50 uppercase">
            {language === 'th' ? 'ผู้จัดการ (Manager)' : 'Shift Managers'}
          </div>
          <div className="text-xl font-bold text-amber-500 mt-1">{counts.manager}</div>
        </div>
        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs">
          <div className="text-[11px] font-bold text-text/50 uppercase">
            {language === 'th' ? 'แคชเชียร์ (Cashier)' : 'Cashiers'}
          </div>
          <div className="text-xl font-bold text-text/80 mt-1">{counts.cashier}</div>
        </div>
      </div>

      {/* Main Staff Directory Card */}
      {viewMode === 'role_matrix' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-text/60">
                {language === 'th' ? 'มุมมองแสดงผล:' : 'View Mode:'}
              </span>
              <div role="tablist" aria-label={language === 'th' ? 'มุมมองแสดงผล' : 'View mode'} className="flex items-center p-0.5 rounded-lg bg-background border border-border">
                <button
                  type="button"
                  role="tab"
                  aria-selected={false}
                  onClick={() => setViewMode('cards')}
                  className="min-h-[40px] flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-md transition-colors cursor-pointer text-brand-text-secondary hover:text-text focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>{language === 'th' ? 'การ์ดพนักงาน' : 'Cards'}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={true}
                  onClick={() => setViewMode('role_matrix')}
                  className="min-h-[40px] flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-md transition-colors cursor-pointer bg-primary text-primary-foreground shadow-2xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{language === 'th' ? 'ตารางกำหนดบทบาท' : 'Role Matrix'}</span>
                </button>
              </div>
            </div>

            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handleOpenAdd}
              className="min-h-[44px] rounded-lg font-bold text-xs"
              leftIcon={<UserPlus className="h-3.5 w-3.5" />}
            >
              {language === 'th' ? 'เพิ่มพนักงานใหม่' : 'Add Staff Member'}
            </Button>
          </div>

          <UserToRoleAssignmentTable />
        </div>
      ) : (
        <Card className="border border-border border-crisp shadow-xs rounded-xl overflow-hidden">
          <CardHeader className="bg-card border-b border-border py-3.5 px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-text">
                  {language === 'th' ? 'รายชื่อและบัญชีพนักงาน (Staff Directory)' : 'Staff & Accounts Directory'}
                </h3>
                <p className="text-[11px] text-brand-text-secondary">
                  {language === 'th'
                    ? 'จัดการข้อมูลพนักงาน กำหนดบทบาทสิทธิ์ และรหัส PIN ส่วนตัว'
                    : 'Manage employee records, role assignments, and authentication PINs.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div role="tablist" aria-label={language === 'th' ? 'มุมมองแสดงผล' : 'View mode'} className="flex items-center p-0.5 rounded-lg bg-background border border-border">
                <button
                  type="button"
                  role="tab"
                  aria-selected={true}
                  onClick={() => setViewMode('cards')}
                  className="min-h-[40px] flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-md transition-colors cursor-pointer bg-card text-text shadow-2xs border border-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">{language === 'th' ? 'การ์ด' : 'Cards'}</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={false}
                  onClick={() => setViewMode('role_matrix')}
                  className="min-h-[40px] flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-md transition-colors cursor-pointer text-brand-text-secondary hover:text-text focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{language === 'th' ? 'ตารางบทบาท' : 'Role Matrix'}</span>
                </button>
              </div>

              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleOpenAdd}
                className="min-h-[44px] rounded-lg font-bold text-xs"
                leftIcon={<UserPlus className="h-3.5 w-3.5" />}
              >
                {language === 'th' ? 'เพิ่มพนักงานใหม่' : 'Add Staff Member'}
              </Button>
            </div>
          </CardHeader>

        <CardBody className="p-4 sm:p-5 space-y-4">
          {/* Search and Role Filter */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-secondary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  language === 'th'
                    ? 'ค้นหาชื่อ, รหัสพนักงาน, อีเมล...'
                    : 'Search name, code, email...'
                }
                className="w-full min-h-[44px] h-11 pl-9 pr-3 text-base sm:text-sm rounded-lg border border-border bg-background text-text focus:outline-hidden focus:ring-2 focus:ring-cta focus-visible:ring-2 focus-visible:ring-cta"
              />
            </div>

            <div role="tablist" aria-label={language === 'th' ? 'กรองตามบทบาท' : 'Filter by role'} className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
              {(
                [
                  { id: 'all', labelTh: 'ทั้งหมด', labelEn: 'All' },
                  { id: 'admin', labelTh: 'Admin', labelEn: 'Admin' },
                  { id: 'manager', labelTh: 'Manager', labelEn: 'Manager' },
                  { id: 'cashier', labelTh: 'Cashier', labelEn: 'Cashier' },
                ] as const
              ).map((f) => {
                const isSelected = roleFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setRoleFilter(f.id)}
                    className={`min-h-[44px] px-3 py-1.5 text-xs rounded-lg font-bold transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta ${
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-2xs'
                        : 'bg-background border border-border border-crisp text-text/80 hover:text-text'
                    }`}
                  >
                    {language === 'th' ? f.labelTh : f.labelEn}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Staff Table / Cards */}
          <div className="border border-border border-crisp rounded-xl overflow-hidden divide-y divide-border/60">
            {filteredUsers.length === 0 ? (
              <div className="p-8 text-center text-text/50 text-xs">
                {language === 'th' ? 'ไม่พบข้อมูลพนักงานที่ตรงกับเงื่อนไข' : 'No staff members found matching criteria.'}
              </div>
            ) : (
              filteredUsers.map((u) => {
                const isActiveUser = session?.currentUser.id === u.id;
                const permissionsCount = rolePermissions[u.role]?.length || u.permissions.length;

                return (
                  <div
                    key={u.id}
                    className={`p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors ${
                      isActiveUser ? 'bg-primary/5' : 'hover:bg-background/60'
                    }`}
                  >
                    {/* User Identity Info */}
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div
                        className={`w-10 h-10 rounded-xl border flex items-center justify-center font-bold text-sm shrink-0 ${
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
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs sm:text-sm font-bold text-text truncate">{u.name}</h4>
                          {isActiveUser && (
                            <Badge variant="primary" size="sm" className="font-mono text-[9px] uppercase font-bold">
                              {language === 'th' ? 'ผู้ใช้ปัจจุบัน' : 'Active User'}
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-text/60 mt-0.5 flex items-center gap-2 font-mono">
                          <span className="font-bold text-text">{u.employeeCode}</span>
                          <span>•</span>
                          <span className="truncate">{u.email}</span>
                        </div>

                        {(u.assignedBy || u.lastRoleAssignedAt || u.roleAssignmentNote) && (
                          <div className="mt-1 text-[10px] text-text/50 flex items-center gap-1.5 flex-wrap">
                            {u.assignedBy && (
                              <span className="font-medium text-text/70">
                                {language === 'th' ? 'กำหนดโดย' : 'By'}: {u.assignedBy}
                              </span>
                            )}
                            {u.lastRoleAssignedAt && (
                              <>
                                <span>•</span>
                                <span>{new Date(u.lastRoleAssignedAt).toLocaleDateString()}</span>
                              </>
                            )}
                            {u.roleAssignmentNote && (
                              <>
                                <span>•</span>
                                <span className="italic text-text/60">"{u.roleAssignmentNote}"</span>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Role & Permissions Badge */}
                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                      <div className="text-right">
                        <Badge
                          variant={u.role === 'admin' ? 'primary' : u.role === 'manager' ? 'warning' : 'neutral'}
                          size="sm"
                          className="font-mono uppercase text-[10px] font-bold"
                        >
                          {u.role === 'cashier' ? 'Staff (Cashier)' : u.role}
                        </Badge>
                        <div className="text-[10px] text-text/50 font-mono mt-0.5">
                          {permissionsCount} {language === 'th' ? 'สิทธิ์' : 'perms'}
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-1.5 border-l border-border pl-3">
                        {!isActiveUser && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleSwitchUser(u)}
                            className="text-xs h-8 px-2.5 font-semibold"
                            leftIcon={<ArrowRightLeft className="w-3 h-3 text-primary" />}
                            title={language === 'th' ? 'สลับมาใช้งานบัญชีนี้' : 'Switch to this account'}
                          >
                            <span className="hidden sm:inline">
                              {language === 'th' ? 'สลับใช้' : 'Switch'}
                            </span>
                          </Button>
                        )}

                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleOpenEdit(u)}
                          className="text-xs h-8 w-8 p-0"
                          title={language === 'th' ? 'แก้ไขข้อมูล' : 'Edit staff profile'}
                        >
                          <Edit2 className="w-3.5 h-3.5 text-text/70" />
                        </Button>

                        {!isActiveUser && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(u)}
                            className="text-xs h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-500/10"
                            title={language === 'th' ? 'ลบพนักงาน' : 'Delete staff member'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardBody>
      </Card>
      )}

      {/* Staff Form Modal */}
      {isModalOpen && (
        <StaffFormModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          editingUser={editingUser}
          onSave={handleSaveUser}
        />
      )}
    </div>
  );
};
