/**
 * PRODX POS - Enterprise Role-Based Access Control (RBAC) Guard & Middleware Wrapper
 *
 * Enforces granular access control across all POS routes, store management screens,
 * and organization-level settings:
 * - General Users ('cashier') are strictly confined to the POS Cash Register ('pos') screen ONLY.
 * - Shift Managers ('manager') can access store-level operational modules & store settings.
 * - Administrators ('admin') have unrestricted access to all POS modules, the Enterprise
 *   Admin Console (/admin), and 100% of organization-level settings.
 */

import React, { useState } from 'react';
import { Role, Permission } from '../../domain/auth';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import type { NavRoute } from '../../domain/routes';
import type { SettingsTabId } from '../../modules/settings/types';
import {
  ROUTE_RBAC_POLICY,
  SETTINGS_TAB_RBAC_POLICY,
  evaluateRouteAccess,
  evaluateSettingsTabAccess,
  evaluateAdminConsoleAccess,
  type RbacAccessDecision,
} from '../../security/rbacMiddleware';
import { SupervisorAuthModal } from './SupervisorAuthModal';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import {
  ShieldAlert,
  Lock,
  ArrowLeft,
  KeyRound,
  Shield,
  UserCheck,
  Building2,
  ShoppingCart,
} from 'lucide-react';

export type RoleOrStaff = Role | 'staff';

export interface ModuleRule {
  allowedRoles: Role[];
  requiredPermissions?: Permission[];
  featureNameEn: string;
  featureNameTh: string;
  descriptionEn: string;
  descriptionTh: string;
  isSensitiveFinancial: boolean;
  isOrganizationLevel?: boolean;
}

export const MODULE_ACCESS_RULES: Record<NavRoute, ModuleRule> = {
  pos: {
    ...ROUTE_RBAC_POLICY.pos,
    allowedRoles: [...ROUTE_RBAC_POLICY.pos.allowedRoles],
    requiredPermissions: [...ROUTE_RBAC_POLICY.pos.requiredPermissions],
  },
  kds: {
    ...ROUTE_RBAC_POLICY.kds,
    allowedRoles: [...ROUTE_RBAC_POLICY.kds.allowedRoles],
    requiredPermissions: [...ROUTE_RBAC_POLICY.kds.requiredPermissions],
  },
  orders: {
    ...ROUTE_RBAC_POLICY.orders,
    allowedRoles: [...ROUTE_RBAC_POLICY.orders.allowedRoles],
    requiredPermissions: [...ROUTE_RBAC_POLICY.orders.requiredPermissions],
  },
  inventory: {
    ...ROUTE_RBAC_POLICY.inventory,
    allowedRoles: [...ROUTE_RBAC_POLICY.inventory.allowedRoles],
    requiredPermissions: [...ROUTE_RBAC_POLICY.inventory.requiredPermissions],
  },
  customers: {
    ...ROUTE_RBAC_POLICY.customers,
    allowedRoles: [...ROUTE_RBAC_POLICY.customers.allowedRoles],
    requiredPermissions: [...ROUTE_RBAC_POLICY.customers.requiredPermissions],
  },
  dashboard: {
    ...ROUTE_RBAC_POLICY.dashboard,
    allowedRoles: [...ROUTE_RBAC_POLICY.dashboard.allowedRoles],
    requiredPermissions: [...ROUTE_RBAC_POLICY.dashboard.requiredPermissions],
  },
  shift: {
    ...ROUTE_RBAC_POLICY.shift,
    allowedRoles: [...ROUTE_RBAC_POLICY.shift.allowedRoles],
    requiredPermissions: [...ROUTE_RBAC_POLICY.shift.requiredPermissions],
  },
  audit: {
    ...ROUTE_RBAC_POLICY.audit,
    allowedRoles: [...ROUTE_RBAC_POLICY.audit.allowedRoles],
    requiredPermissions: [...ROUTE_RBAC_POLICY.audit.requiredPermissions],
  },
  settings: {
    ...ROUTE_RBAC_POLICY.settings,
    allowedRoles: [...ROUTE_RBAC_POLICY.settings.allowedRoles],
    requiredPermissions: [...ROUTE_RBAC_POLICY.settings.requiredPermissions],
  },
  infrastructure: {
    ...ROUTE_RBAC_POLICY.infrastructure,
    allowedRoles: [...ROUTE_RBAC_POLICY.infrastructure.allowedRoles],
    requiredPermissions: [...ROUTE_RBAC_POLICY.infrastructure.requiredPermissions],
  },
  tasks: {
    ...ROUTE_RBAC_POLICY.tasks,
    allowedRoles: [...ROUTE_RBAC_POLICY.tasks.allowedRoles],
    requiredPermissions: [...ROUTE_RBAC_POLICY.tasks.requiredPermissions],
  },
  kitchen: {
    ...ROUTE_RBAC_POLICY.kitchen,
    allowedRoles: [...ROUTE_RBAC_POLICY.kitchen.allowedRoles],
    requiredPermissions: [...ROUTE_RBAC_POLICY.kitchen.requiredPermissions],
  },
  admin: {
    ...ROUTE_RBAC_POLICY.admin,
    allowedRoles: [...ROUTE_RBAC_POLICY.admin.allowedRoles],
    requiredPermissions: [...ROUTE_RBAC_POLICY.admin.requiredPermissions],
  },
};

/**
 * Custom Hook for granular RBAC evaluation across Routes, Settings Tabs, and Organization Actions
 */
export function useRbac() {
  const { session, can } = useAuth();
  const user = session?.currentUser ?? null;
  const role = user?.role ?? null;

  const isAdmin = role === 'admin';
  const isManager = role === 'manager' || role === 'admin';
  const isStaff = role === 'cashier';
  const isGeneralUser = role === 'cashier';

  const hasRole = (roles: RoleOrStaff | RoleOrStaff[]): boolean => {
    if (!role) return false;
    const list = (Array.isArray(roles) ? roles : [roles]).map((r) =>
      r === 'staff' ? 'cashier' : r,
    );
    return list.includes(role);
  };

  const evaluateRoute = (module: NavRoute): RbacAccessDecision => {
    return evaluateRouteAccess(user, module, can);
  };

  const canAccessModule = (module: NavRoute): boolean => {
    return evaluateRouteAccess(user, module, can).allowed;
  };

  const evaluateSettingsTab = (tabId: SettingsTabId): RbacAccessDecision => {
    return evaluateSettingsTabAccess(user, tabId, can);
  };

  const canAccessSettingsTab = (tabId: SettingsTabId): boolean => {
    return evaluateSettingsTabAccess(user, tabId, can).allowed;
  };

  const canAccessAdminConsole = (): boolean => {
    return evaluateAdminConsoleAccess(user).allowed;
  };

  const canManageOrganization = (): boolean => {
    if (!user) return false;
    return user.role === 'admin' || can('org:manage');
  };

  const isFinancialModule = (module: NavRoute): boolean => {
    return MODULE_ACCESS_RULES[module]?.isSensitiveFinancial ?? false;
  };

  return {
    user,
    role,
    isAdmin,
    isManager,
    isStaff,
    isGeneralUser,
    hasRole,
    canAccessModule,
    canAccessSettingsTab,
    canAccessAdminConsole,
    canManageOrganization,
    evaluateRoute,
    evaluateSettingsTab,
    isFinancialModule,
  };
}

export interface RbacGuardProps {
  module?: NavRoute;
  settingsTab?: SettingsTabId;
  allowedRoles?: RoleOrStaff[];
  requiredRole?: 'manager' | 'staff' | 'admin';
  requiredPermission?: Permission;
  requiredPermissions?: Permission[];
  requireAllPermissions?: boolean;
  isOrganizationLevel?: boolean;
  featureName?: string;
  moduleDescription?: string;
  hideMode?: 'hidden' | 'denied-card';
  fallback?: React.ReactNode;
  onRedirectToPos?: () => void;
  allowSupervisorOverride?: boolean;
  children: React.ReactNode;
}

export const RbacGuard: React.FC<RbacGuardProps> = ({
  module,
  settingsTab,
  allowedRoles,
  requiredRole,
  requiredPermission,
  requiredPermissions,
  requireAllPermissions = false,
  isOrganizationLevel = false,
  featureName,
  moduleDescription,
  hideMode = 'denied-card',
  fallback = null,
  onRedirectToPos,
  allowSupervisorOverride = true,
  children,
}) => {
  const { session, can, switchDemoRole } = useAuth();
  const { language } = useLanguage();
  const [supervisorOverrideGranted, setSupervisorOverrideGranted] = useState(false);
  const [isSupervisorModalOpen, setIsSupervisorModalOpen] = useState(false);

  const currentUser = session?.currentUser;

  // Administrator ('admin') always has full organization-wide and store-wide access
  if (currentUser?.role === 'admin') {
    return <>{children}</>;
  }

  // If supervisor override was granted during this component lifecycle, permit access
  if (supervisorOverrideGranted) {
    return <>{children}</>;
  }

  // Determine effective allowed roles
  let effectiveAllowedRoles: Role[] | undefined = undefined;

  if (requiredRole === 'manager') {
    effectiveAllowedRoles = ['manager', 'admin'];
  } else if (requiredRole === 'admin') {
    effectiveAllowedRoles = ['admin'];
  } else if (requiredRole === 'staff') {
    effectiveAllowedRoles = ['cashier', 'manager', 'admin'];
  } else if (allowedRoles && allowedRoles.length > 0) {
    effectiveAllowedRoles = allowedRoles.map((r) => (r === 'staff' ? 'cashier' : r));
  }

  let effectivePermissions =
    requiredPermissions || (requiredPermission ? [requiredPermission] : []);
  let effectiveName = featureName;
  let effectiveDesc = moduleDescription;
  let isSensitive = false;
  let isOrgScope = isOrganizationLevel;

  // Apply Settings Tab policy if specified
  if (settingsTab && SETTINGS_TAB_RBAC_POLICY[settingsTab]) {
    const tabRule = SETTINGS_TAB_RBAC_POLICY[settingsTab];
    if (!effectiveAllowedRoles) {
      effectiveAllowedRoles = [...tabRule.allowedRoles];
    }
    if (effectivePermissions.length === 0 && tabRule.requiredPermissions) {
      effectivePermissions = [...tabRule.requiredPermissions];
    }
    if (!effectiveName) {
      effectiveName = language === 'th' ? tabRule.titleTh : tabRule.titleEn;
    }
    if (tabRule.isOrganizationLevel) {
      isOrgScope = true;
      isSensitive = true;
    }
  }

  // Apply Route Module policy if specified
  if (module && MODULE_ACCESS_RULES[module]) {
    const rule = MODULE_ACCESS_RULES[module];
    if (!effectiveAllowedRoles) {
      effectiveAllowedRoles = [...rule.allowedRoles];
    }
    if (effectivePermissions.length === 0 && rule.requiredPermissions) {
      effectivePermissions = [...rule.requiredPermissions];
    }
    if (!effectiveName) {
      effectiveName = language === 'th' ? rule.featureNameTh : rule.featureNameEn;
    }
    if (!effectiveDesc) {
      effectiveDesc = language === 'th' ? rule.descriptionTh : rule.descriptionEn;
    }
    isSensitive = rule.isSensitiveFinancial;
    if (rule.isOrganizationLevel) {
      isOrgScope = true;
    }
  }

  // Evaluate RBAC decision
  let isAllowed = true;

  if (!currentUser) {
    isAllowed = false;
  } else if (currentUser.isActive === false) {
    isAllowed = false;
  } else if (currentUser.role === 'cashier' && module && module !== 'pos') {
    // Strict POS-only confinement for General Users ('cashier')
    isAllowed = false;
  } else if (currentUser.role === 'cashier' && (settingsTab || isOrgScope)) {
    isAllowed = false;
  } else {
    // 1. Role validation
    if (effectiveAllowedRoles && effectiveAllowedRoles.length > 0) {
      if (!effectiveAllowedRoles.includes(currentUser.role)) {
        isAllowed = false;
      }
    }

    // 2. Permission validation
    if (isAllowed && effectivePermissions && effectivePermissions.length > 0) {
      if (requireAllPermissions) {
        const hasAll = effectivePermissions.every((p) => can(p));
        if (!hasAll) isAllowed = false;
      } else {
        const hasAtLeastOne = effectivePermissions.some((p) => can(p));
        if (!hasAtLeastOne) isAllowed = false;
      }
    }
  }

  if (isAllowed) {
    return <>{children}</>;
  }

  if (hideMode === 'hidden') {
    return fallback ? <>{fallback}</> : null;
  }

  const rolesList = effectiveAllowedRoles || (isOrgScope ? ['admin'] : ['manager', 'admin']);
  const isStrictAdminOnly = rolesList.length === 1 && rolesList[0] === 'admin';
  const isGeneralUserBlocked = currentUser?.role === 'cashier';

  const requiredRolesDisplay = rolesList
    .map((r) =>
      r === 'cashier'
        ? language === 'th'
          ? 'พนักงานขาย (POS Staff)'
          : 'Staff (Cashier)'
        : r === 'manager'
        ? language === 'th'
          ? 'ผู้จัดการสาขา (Manager)'
          : 'Shift Manager'
        : language === 'th'
        ? 'ผู้ดูแลระบบระดับองค์กร (Admin)'
        : 'Enterprise Administrator (Admin)',
    )
    .join(' / ');

  const currentRoleDisplay =
    currentUser?.role === 'cashier'
      ? language === 'th'
        ? 'ผู้ใช้งานทั่วไป / แคชเชียร์ (POS Only)'
        : 'General User / Cashier (POS Only)'
      : currentUser?.role === 'manager'
      ? language === 'th'
        ? 'ผู้จัดการสาขา (Shift Manager)'
        : 'Shift Manager'
      : currentUser?.role === 'admin'
      ? language === 'th'
        ? 'ผู้ดูแลระบบระดับองค์กร (Admin)'
        : 'Administrator (Full Org Access)'
      : 'Unauthenticated';

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-4 sm:p-6 lg:p-8 bg-background select-none overflow-y-auto">
      <div className="w-full max-w-lg rounded-2xl border border-border border-crisp bg-card p-6 sm:p-8 shadow-sm text-center space-y-5">
        {/* Security Shield Icon Header */}
        <div
          className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto border ${
            isStrictAdminOnly || isOrgScope
              ? 'bg-rose-500/10 border-rose-500/25 text-rose-600 dark:text-rose-400'
              : 'bg-amber-500/10 border-amber-500/25 text-amber-600 dark:text-amber-400'
          }`}
        >
          {isStrictAdminOnly || isOrgScope ? (
            <Building2 className="w-7 h-7" />
          ) : (
            <ShieldAlert className="w-7 h-7" />
          )}
        </div>

        {/* Status Badges */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Badge
            variant={isStrictAdminOnly || isOrgScope ? 'danger' : 'warning'}
            size="sm"
            className="font-mono uppercase text-[11px] font-bold tracking-wider"
          >
            <Lock className="w-3 h-3 mr-1 inline" />
            {isGeneralUserBlocked
              ? language === 'th'
                ? 'จำกัดสิทธิ์เฉพาะหน้า POS เท่านั้น'
                : 'POS-Only Access Policy'
              : isStrictAdminOnly || isOrgScope
              ? language === 'th'
                ? 'สงวนสิทธิ์เฉพาะ Admin ระดับองค์กร'
                : 'Organization Admin Required'
              : language === 'th'
              ? 'จำกัดสิทธิ์การเข้าถึง (RBAC Guard)'
              : 'RBAC Access Restricted'}
          </Badge>
          {isOrgScope && (
            <Badge
              variant="primary"
              size="sm"
              className="font-mono uppercase text-[10px] font-bold tracking-wider"
            >
              {language === 'th' ? 'การตั้งค่าระดับองค์กร' : 'Organization-Level Scope'}
            </Badge>
          )}
          {isSensitive && !isOrgScope && (
            <Badge
              variant="neutral"
              size="sm"
              className="font-mono uppercase text-[10px] font-bold tracking-wider"
            >
              {language === 'th' ? 'โมดูลควบคุมภายใน' : 'Protected Module'}
            </Badge>
          )}
        </div>

        {/* Feature Title & Explanation */}
        <div className="space-y-2">
          <h2 className="text-xl font-black text-text tracking-tight">
            {effectiveName ||
              (language === 'th' ? 'โมดูลที่ต้องได้รับการอนุมัติสิทธิ์' : 'Protected Enterprise Module')}
          </h2>
          <p className="text-xs sm:text-sm text-text/75 max-w-md mx-auto leading-relaxed">
            {isGeneralUserBlocked
              ? language === 'th'
                ? 'ตามนโยบายความปลอดภัย RBAC บัญชีผู้ใช้งานทั่วไป (Cashier / Staff) ได้รับอนุญาตให้เข้าถึงเฉพาะหน้าจอขายหน้าร้าน (POS Cash Register) เท่านั้น ไม่สามารถเข้าถึงเมนูจัดการหรือการตั้งค่าระดับองค์กรได้'
                : 'Per enterprise RBAC policy, General User (Cashier / Staff) accounts are strictly confined to the POS Cash Register screen and cannot access back-office or organization settings.'
              : isStrictAdminOnly || isOrgScope
              ? language === 'th'
                ? 'ส่วนงานนี้เป็นการตั้งค่าระดับองค์กร (Organization, Branches, Terminals & Global RBAC) ซึ่งอนุญาตให้เฉพาะผู้ดูแลระบบสูงสุด (Admin) เข้าถึงและแก้ไขได้ทั้งหมดเท่านั้น'
                : 'This workspace governs organization-level configurations (Organizations, Store Branches, POS Terminals, and Global RBAC) and is strictly restricted to Administrators (Admin).'
              : language === 'th'
              ? `โมดูลนี้ประกอบด้วยการจัดการสาขา ยอดกระทบ หรือบันทึกความปลอดภัย ซึ่งอนุญาตเฉพาะบทบาทระดับ ${requiredRolesDisplay} เท่านั้น`
              : `This module is restricted to ${requiredRolesDisplay} roles.`}
          </p>
          {effectiveDesc && (
            <p className="text-[11px] text-text/50 italic max-w-sm mx-auto">"{effectiveDesc}"</p>
          )}
        </div>

        {/* Active Session Context Breakdown */}
        <div className="border-y border-border border-crisp py-3.5 my-3 divide-y divide-border/60 text-xs text-left">
          <div className="flex items-center justify-between py-1.5">
            <span className="text-text/60 font-medium">
              {language === 'th' ? 'ผู้ใช้งานปัจจุบัน (Active User):' : 'Current Session User:'}
            </span>
            <span className="font-bold text-text truncate max-w-[230px]">
              {currentUser?.name || 'Unknown User'}{' '}
              <span className="text-text/50 font-mono text-[11px]">
                ({currentUser?.employeeCode})
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-text/60 font-medium">
              {language === 'th' ? 'ระดับสิทธิ์ปัจจุบัน (Current Role):' : 'Assigned Role:'}
            </span>
            <Badge
              variant={currentUser?.role === 'cashier' ? 'neutral' : 'warning'}
              size="sm"
              className="font-mono font-bold uppercase"
            >
              {currentRoleDisplay}
            </Badge>
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-text/60 font-medium">
              {language === 'th' ? 'สิทธิ์ที่จำเป็น (Required Role):' : 'Required Role Level:'}
            </span>
            <span className="font-mono font-bold text-primary text-right">
              {requiredRolesDisplay}
            </span>
          </div>
          {effectivePermissions.length > 0 && (
            <div className="flex items-center justify-between py-1.5">
              <span className="text-text/60 font-medium">
                {language === 'th' ? 'พอร์ตสิทธิ์ RBAC (Permissions):' : 'Required Permissions:'}
              </span>
              <span className="font-mono text-[10px] font-semibold text-text/70">
                {effectivePermissions.join(', ')}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between py-1.5">
            <span className="text-text/60 font-medium">
              {language === 'th' ? 'สถานะ Middleware Guard:' : 'RBAC Middleware Policy:'}
            </span>
            <span className="text-text/60 font-mono text-[11px] flex items-center gap-1">
              <Shield className="w-3.5 h-3.5 text-emerald-500" />
              {isGeneralUserBlocked
                ? language === 'th'
                  ? 'ล็อกเฉพาะหน้า POS (POS-Only Enforced)'
                  : 'POS-Only Enforced'
                : language === 'th'
                ? 'ป้องกันการเข้าถึงระดับองค์กร'
                : 'Org-Level Guard Active'}
            </span>
          </div>
        </div>

        {/* Action Controls */}
        <div className="space-y-2 pt-1">
          {onRedirectToPos && (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={onRedirectToPos}
              className="w-full justify-center font-bold text-xs cursor-pointer"
              leftIcon={<ShoppingCart className="w-4 h-4" />}
            >
              {language === 'th'
                ? 'กลับสู่หน้าขายหน้าร้านทันที (Return to POS Register — F1)'
                : 'Return to POS Cash Register (F1)'}
            </Button>
          )}

          {allowSupervisorOverride && (
            <Button
              type="button"
              variant={onRedirectToPos ? 'outline' : 'primary'}
              size="md"
              onClick={() => setIsSupervisorModalOpen(true)}
              className="w-full justify-center font-bold text-xs cursor-pointer"
              leftIcon={<KeyRound className="w-4 h-4" />}
            >
              {isStrictAdminOnly || isOrgScope
                ? language === 'th'
                  ? 'ยืนยันรหัสผู้ดูแลระบบ (Admin Override PIN)'
                  : 'Authorize with Administrator PIN'
                : language === 'th'
                ? 'ขอยืนยันสิทธิ์จากหัวหน้างาน (Supervisor Override)'
                : 'Request Supervisor Override'}
            </Button>
          )}
        </div>

        {/* Dedicated Admin Console Authentication Path */}
        <div className="pt-3 border-t border-border/60">
          <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-text/60">
            <span className="flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-primary shrink-0" />
              <span>
                {language === 'th'
                  ? 'ต้องการเข้าใช้งานในฐานะผู้ดูแลระบบระดับองค์กร?'
                  : 'Need full Enterprise Administrator access?'}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.history.pushState({}, '', '/admin/login');
                  window.dispatchEvent(new PopStateEvent('popstate'));
                }
              }}
              className="px-3 py-1.5 text-[11px] rounded-lg font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            >
              {language === 'th' ? 'เข้าสู่ระบบ Admin (/admin/login)' : 'Admin Login (/admin/login)'}
            </button>
          </div>
        </div>
      </div>

      {/* Supervisor Authorization Modal */}
      {isSupervisorModalOpen && (
        <SupervisorAuthModal
          isOpen={isSupervisorModalOpen}
          onClose={() => setIsSupervisorModalOpen(false)}
          title={
            language === 'th'
              ? `อนุมัติการเข้าถึง: ${effectiveName}`
              : `Authorize Access: ${effectiveName}`
          }
          actionDescription={
            language === 'th'
              ? `ผู้ใช้งาน ${currentUser?.name} (${currentUser?.role}) ขอเข้าใช้งาน ${effectiveName}`
              : `User ${currentUser?.name} (${currentUser?.role}) requested elevated access to ${effectiveName}`
          }
          requiredRole={rolesList.includes('manager') && !isStrictAdminOnly ? 'manager' : 'admin'}
          onAuthorized={() => {
            setSupervisorOverrideGranted(true);
            setIsSupervisorModalOpen(false);
          }}
        />
      )}
    </div>
  );
};
