/**
 * PRODX POS - RoleManagement Module
 * Comprehensive enterprise Role Management module featuring:
 * 1. Data table for user-to-role assignment with search, filters, status toggle, and bulk actions.
 * 2. Admin interface to manage permissions (Granular Permission Matrix & Custom Permission Sets).
 * 3. Interactive permission sandbox simulator.
 * 4. All changes guarded by confirmation modal and fully consistent with the existing RBAC system.
 */

import React, { useState } from 'react';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { UserToRoleAssignmentTable } from './UserToRoleAssignmentTable';
import { PermissionMatrixSection } from './PermissionMatrixSection';
import { PermissionSetsManagement } from './PermissionSetsManagement';
import { PermissionSimulatorCard } from './PermissionSimulatorCard';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';
import {
  ShieldCheck,
  Users,
  Sliders,
  KeyRound,
  Lock,
  Award,
  ShoppingCart,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';

type RoleManagementSubTab = 'assignments' | 'matrix' | 'permission_sets' | 'simulator';

export const RoleManagementModule: React.FC = () => {
  const { language } = useLanguage();
  const { session, staffUsers, rolePermissions, customPermissionSets } = useAuth();
  const [activeSubTab, setActiveSubTab] = useState<RoleManagementSubTab>('assignments');

  if (!session) return null;

  // Metrics for RoleManagement Header
  const totalStaff = staffUsers.length;
  const adminCount = staffUsers.filter((u) => u.role === 'admin' && u.isActive !== false).length;
  const managerCount = staffUsers.filter((u) => u.role === 'manager' && u.isActive !== false).length;
  const cashierCount = staffUsers.filter((u) => u.role === 'cashier' && u.isActive !== false).length;

  return (
    <div className="space-y-5">
      {/* Module Banner Header */}
      <div className="p-4 sm:p-5 rounded-2xl bg-card border border-border border-crisp shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-text">
                {language === 'th' ? 'โมดูลบริหารจัดการบทบาทและสิทธิ์ (RoleManagement)' : 'RoleManagement & RBAC Hub'}
              </h2>
              <Badge variant="primary" size="sm" className="font-mono uppercase font-bold text-[9px]">
                RBAC SECURE
              </Badge>
            </div>
            <p className="text-xs text-text/60 mt-0.5">
              {language === 'th'
                ? 'ระบบบริหารสิทธิ์พนักงาน ตารางกำหนดบทบาทรายบุคคล และตารางตั้งค่าสิทธิ์แอดมินพร้อมหน้าต่างยืนยันความปลอดภัย'
                : 'Centralized staff-to-role data assignments, granular permission matrix, and secure change confirmations.'}
            </p>
          </div>
        </div>

        {/* Quick Stats Pills */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <div className="px-3 py-1.5 rounded-xl border border-border bg-background flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-primary" />
            <span className="font-bold text-text">{totalStaff}</span>
            <span className="text-text/50">{language === 'th' ? 'พนักงาน' : 'Staff'}</span>
          </div>

          <div className="px-3 py-1.5 rounded-xl border border-primary/30 bg-primary/10 flex items-center gap-2 text-primary">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="font-bold">{adminCount}</span>
            <span>Admin</span>
          </div>

          <div className="px-3 py-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <Award className="w-3.5 h-3.5" />
            <span className="font-bold">{managerCount}</span>
            <span>Manager</span>
          </div>

          <div className="px-3 py-1.5 rounded-xl border border-border bg-background flex items-center gap-2 text-text/70">
            <ShoppingCart className="w-3.5 h-3.5" />
            <span className="font-bold">{cashierCount}</span>
            <span>Staff</span>
          </div>
        </div>
      </div>

      {/* RoleManagement Sub-Navigation Tabs */}
      <div role="tablist" aria-label={language === 'th' ? 'แท็บจัดการบทบาท' : 'Role management tabs'} className="flex flex-wrap items-center gap-2 p-1.5 rounded-xl bg-card border border-border border-crisp shadow-2xs">
        {[
          {
            id: 'assignments' as RoleManagementSubTab,
            labelTh: 'ตารางกำหนดบทบาทพนักงาน',
            labelEn: 'User-to-Role Assignment',
            descTh: 'ตารางรายชื่อพนักงานและการมอบหมายบทบาท',
            descEn: 'Staff directory & role mapping table',
            icon: Users,
          },
          {
            id: 'matrix' as RoleManagementSubTab,
            labelTh: 'ตารางสิทธิ์การใช้งาน (Matrix)',
            labelEn: 'Permission Matrix',
            descTh: 'จัดการสิทธิ์รายฟังก์ชันของแต่ละตำแหน่ง',
            descEn: 'Granular role-permission grid',
            icon: ShieldCheck,
          },
          {
            id: 'permission_sets' as RoleManagementSubTab,
            labelTh: 'ชุดสิทธิ์กำหนดเอง (Custom Sets)',
            labelEn: 'Custom Permission Sets',
            descTh: 'สร้างและปรับแต่งโปรไฟล์สิทธิ์ขั้นสูง',
            descEn: 'Advanced custom permission profiles',
            icon: Sliders,
          },
          {
            id: 'simulator' as RoleManagementSubTab,
            labelTh: 'จำลองการทดสอบสิทธิ์ (Sandbox)',
            labelEn: 'Sandbox Simulator',
            descTh: 'ทดสอบสถานการณ์การใช้งานจริงของ POS',
            descEn: 'Live operational sandbox tester',
            icon: KeyRound,
          },
        ].map((tab) => {
          const isSelected = activeSubTab === tab.id;
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => setActiveSubTab(tab.id)}
              className={`min-h-[44px] flex-1 min-w-[210px] flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-left transition-all cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta ${
                isSelected
                  ? 'bg-primary text-primary-foreground shadow-xs font-bold'
                  : 'text-text/75 hover:text-text hover:bg-background'
              }`}
            >
              <div
                className={`p-1.5 rounded-md ${
                  isSelected ? 'bg-primary-foreground/15 text-primary-foreground' : 'bg-background border border-border text-primary'
                }`}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs truncate font-bold">
                  {language === 'th' ? tab.labelTh : tab.labelEn}
                </div>
                <div
                  className={`text-[10px] truncate ${
                    isSelected ? 'text-primary-foreground/80' : 'text-brand-text-secondary'
                  }`}
                >
                  {language === 'th' ? tab.descTh : tab.descEn}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* SubTab Content View */}
      {activeSubTab === 'assignments' && <UserToRoleAssignmentTable />}

      {activeSubTab === 'matrix' && <PermissionMatrixSection />}

      {activeSubTab === 'permission_sets' && <PermissionSetsManagement />}

      {activeSubTab === 'simulator' && (
        <PermissionSimulatorCard
          permissionSets={customPermissionSets}
          policies={{
            requirePinForVoid: true,
            requirePinForDiscount: true,
            requirePinForDrawerKick: true,
            requirePinForPriceOverride: true,
          }}
        />
      )}
    </div>
  );
};
