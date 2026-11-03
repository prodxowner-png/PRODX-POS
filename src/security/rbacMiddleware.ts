/**
 * PRODX POS — Enterprise RBAC Middleware & Access Control Policy Engine
 *
 * Enforces multi-tier Role-Based Access Control (RBAC) across:
 * 1. Route & Navigation Guarding:
 *    - General Users ('cashier') are strictly confined to the 'pos' (POS Cash Register) screen.
 *    - Shift Managers ('manager') can access store-level operational modules & store settings.
 *    - Administrators ('admin') have unrestricted access to all POS modules, the Enterprise
 *      Admin Console (/admin), and 100% of organization-level settings (Organizations, Branches,
 *      Terminals, RBAC Matrix, Role Assignments, Custom Permission Sets, and Infrastructure).
 * 2. Settings Tab Governance:
 *    - Separates store-level settings from organization-level settings ('system_config',
 *      'modules_control', 'security_roles', 'role_management', 'role_assignment',
 *      'permission_sets', 'data_sync').
 * 3. Service-Layer Mutation Middleware:
 *    - Validates actor role & permissions prior to executing organization, branch, or terminal CRUD.
 */

import { Permission, Role, ROLE_PERMISSIONS, User, hasPermission } from '../domain/auth';
import type { NavRoute, AdminConsoleSection } from '../domain/routes';
import type { SettingsTabId } from '../modules/settings/types';

export type RbacScopeTier = 'pos_operational' | 'store_management' | 'organization_admin';

export type RbacDenialReason =
  | 'unauthenticated'
  | 'inactive_account'
  | 'general_user_pos_only'
  | 'admin_role_required'
  | 'manager_or_admin_required'
  | 'missing_permission';

export interface RbacAccessDecision {
  readonly allowed: boolean;
  readonly scopeTier: RbacScopeTier;
  readonly reason?: RbacDenialReason;
  readonly requiredRoles: readonly Role[];
  readonly requiredPermissions: readonly Permission[];
  readonly missingPermissions: readonly Permission[];
  readonly redirectRoute: NavRoute;
  readonly messageEn: string;
  readonly messageTh: string;
}

export interface RouteRbacRule {
  readonly route: NavRoute;
  readonly scopeTier: RbacScopeTier;
  readonly allowedRoles: readonly Role[];
  readonly requiredPermissions: readonly Permission[];
  readonly featureNameEn: string;
  readonly featureNameTh: string;
  readonly descriptionEn: string;
  readonly descriptionTh: string;
  readonly isSensitiveFinancial: boolean;
  readonly isOrganizationLevel?: boolean;
}

/**
 * Authoritative Route RBAC Policy Matrix:
 * - General User ('cashier') is ONLY permitted on 'pos'.
 * - Store Managers ('manager') can access operational store modules.
 * - Administrators ('admin') have full access to all modules including organization-level infrastructure & settings.
 */
export const ROUTE_RBAC_POLICY: Record<NavRoute, RouteRbacRule> = {
  pos: {
    route: 'pos',
    scopeTier: 'pos_operational',
    allowedRoles: ['cashier', 'manager', 'admin'],
    requiredPermissions: ['pos:checkout'],
    featureNameEn: 'POS Cash Register',
    featureNameTh: 'หน้าขายหน้าร้าน (POS Cash Register)',
    descriptionEn: 'Frontline cashier checkout, barcode scanning, and receipt issuance.',
    descriptionTh: 'หน้าจอคิดเงินหน้าร้าน สแกนบาร์โค้ด ชำระเงิน และออกใบเสร็จสำหรับแคชเชียร์และผู้ใช้งานทั่วไป',
    isSensitiveFinancial: false,
  },
  kds: {
    route: 'kds',
    scopeTier: 'store_management',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['pos:checkout'],
    featureNameEn: 'Kitchen Display System (KDS)',
    featureNameTh: 'ระบบจอแสดงรายการในครัว (KDS)',
    descriptionEn: 'Order preparation tickets, cooking queue, and kitchen dispatch management.',
    descriptionTh: 'ควบคุมคิวออเดอร์ในครัว เวลาเตรียมอาหาร และสถานะพร้อมเสิร์ฟ (สงวนสิทธิ์ระดับผู้จัดการและผู้ดูแลระบบ)',
    isSensitiveFinancial: false,
  },
  orders: {
    route: 'orders',
    scopeTier: 'store_management',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['pos:refund'],
    featureNameEn: 'Orders, Voids & Refunds Journal',
    featureNameTh: 'ประวัติคำสั่งซื้อ การคืนเงิน และยกเลิกบิล',
    descriptionEn: 'Historical transaction ledger, bill voids, and authorized refund workflows.',
    descriptionTh: 'ตรวจสอบบิลย้อนหลัง ยกเลิกบิล (Void) และอนุมัติการคืนเงิน (สงวนสิทธิ์ผู้จัดการและแอดมิน)',
    isSensitiveFinancial: true,
  },
  inventory: {
    route: 'inventory',
    scopeTier: 'store_management',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['inventory:read', 'inventory:adjust'],
    featureNameEn: 'Inventory & Stock Ledger',
    featureNameTh: 'คลังสินค้าและการปรับปรุงสต็อก',
    descriptionEn: 'Authoritative stock counts, purchase orders, and inventory ledger adjustments.',
    descriptionTh: 'บริหารจัดการคลังสินค้า ใบสั่งซื้อ และการปรับยอดสต็อก (สงวนสิทธิ์ผู้จัดการและแอดมิน)',
    isSensitiveFinancial: true,
  },
  customers: {
    route: 'customers',
    scopeTier: 'store_management',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['customers:read', 'customers:write'],
    featureNameEn: 'Customer CRM & Loyalty Directory',
    featureNameTh: 'ฐานข้อมูลสมาชิกลูกค้าและคะแนนสะสม (CRM)',
    descriptionEn: 'Customer directory administration, loyalty tier overrides, and point ledger.',
    descriptionTh: 'จัดการฐานข้อมูลลูกค้า ระดับสมาชิก VIP และการปรับคะแนนสะสม (สงวนสิทธิ์ผู้จัดการและแอดมิน)',
    isSensitiveFinancial: false,
  },
  shift: {
    route: 'shift',
    scopeTier: 'store_management',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['shift:open', 'shift:close'],
    featureNameEn: 'Cash Drawer & Shift Reconciliation',
    featureNameTh: 'ควบคุมกะการทำงานและลิ้นชักเงินสด (Z-Report)',
    descriptionEn: 'Cash drawer float, safe drops, drawer reconciliation, and Z-Report closures.',
    descriptionTh: 'การนำเงินเข้า-ออกลิ้นชัก การกระทบยอดเงินสด และการปิดสรุปกะ Z-Report',
    isSensitiveFinancial: true,
  },
  dashboard: {
    route: 'dashboard',
    scopeTier: 'store_management',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['reports:read'],
    featureNameEn: 'Sales & Executive Analytics Dashboard',
    featureNameTh: 'แดชบอร์ดสรุปยอดขายและผลประกอบการ',
    descriptionEn: 'Consolidated gross profit margins, store revenue metrics, and financial reporting.',
    descriptionTh: 'รายงานกำไรขั้นต้น ยอดขายรวมของสาขา และตัวชี้วัดทางการเงินเชิงลึก',
    isSensitiveFinancial: true,
  },
  audit: {
    route: 'audit',
    scopeTier: 'organization_admin',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['audit:read'],
    featureNameEn: 'Enterprise Security & Financial Audit Trail',
    featureNameTh: 'บันทึกประวัติความปลอดภัยและการตรวจสอบระบบ (Audit Log)',
    descriptionEn: 'Immutable cryptographic security logs, organization CRUD logs, and compliance records.',
    descriptionTh: 'บันทึกเหตุการณ์ความปลอดภัย การสร้าง/แก้ไข/ลบระดับองค์กร และการตรวจสอบระบบแบบเรียลไทม์',
    isSensitiveFinancial: true,
    isOrganizationLevel: true,
  },
  infrastructure: {
    route: 'infrastructure',
    scopeTier: 'organization_admin',
    allowedRoles: ['admin'],
    requiredPermissions: ['org:manage', 'settings:manage'],
    featureNameEn: 'Enterprise Infrastructure & AI Control Plane',
    featureNameTh: 'โครงสร้างพื้นฐานระดับองค์กรและระบบ AI (Admin Only)',
    descriptionEn: 'Organization-wide infrastructure telemetry, database health, and hardware driver orchestration.',
    descriptionTh: 'ควบคุมโครงสร้างพื้นฐานระดับองค์กร ฐานข้อมูล และไดรเวอร์ฮาร์ดแวร์ (เฉพาะผู้ดูแลระบบ Admin เท่านั้น)',
    isSensitiveFinancial: true,
    isOrganizationLevel: true,
  },
  settings: {
    route: 'settings',
    scopeTier: 'organization_admin',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['settings:manage'],
    featureNameEn: 'Enterprise & Organization Settings Hub',
    featureNameTh: 'ตั้งค่าระบบและโครงสร้างระดับองค์กร',
    descriptionEn: 'Organization hierarchy, branches, POS terminals, fiscal tax rates, and RBAC security governance.',
    descriptionTh: 'การตั้งค่าระดับองค์กร สาขา เครื่องขาย POS อัตราภาษี และตารางสิทธิ์ความปลอดภัย RBAC',
    isSensitiveFinancial: true,
    isOrganizationLevel: true,
  },
  tasks: {
    route: 'tasks',
    scopeTier: 'pos_operational',
    allowedRoles: ['admin', 'manager', 'cashier'],
    requiredPermissions: [],
    featureNameEn: 'Personal Task Management',
    featureNameTh: 'จัดการรายการงานส่วนตัว',
    descriptionEn: 'User-specific task tracking and management using Google Cloud Firestore.',
    descriptionTh: 'จัดการงานและรายการที่ต้องทำส่วนตัว (Sync ข้อมูลผ่าน Google Cloud)',
    isSensitiveFinancial: false,
  },
  kitchen: {
    route: 'kitchen',
    scopeTier: 'store_management',
    allowedRoles: ['admin', 'manager', 'cashier'],
    requiredPermissions: ['pos:checkout'],
    featureNameEn: 'Kitchen Management System',
    featureNameTh: 'ระบบจัดการห้องครัว',
    descriptionEn: 'Kitchen order management and cooking queue.',
    descriptionTh: 'ระบบจัดการออเดอร์ในครัวและคิวการทำอาหาร',
    isSensitiveFinancial: false,
  },
  admin: {
    route: 'admin',
    scopeTier: 'organization_admin',
    allowedRoles: ['admin'],
    requiredPermissions: ['settings:manage'],
    featureNameEn: 'Administrator Console',
    featureNameTh: 'แผงควบคุมผู้ดูแลระบบ',
    descriptionEn: 'Enterprise organization, tenant management, and system administration.',
    descriptionTh: 'การจัดการองค์กร ระดับผู้เช่า และการบริหารจัดการระบบ',
    isSensitiveFinancial: true,
    isOrganizationLevel: true,
  },
};

export interface SettingsTabRbacRule {
  readonly tabId: SettingsTabId;
  readonly scopeTier: RbacScopeTier;
  readonly allowedRoles: readonly Role[];
  readonly requiredPermissions: readonly Permission[];
  readonly isOrganizationLevel: boolean;
  readonly titleEn: string;
  readonly titleTh: string;
}

/**
 * Granular Settings Tab RBAC Matrix:
 * Ensures that Organization-Level settings (Organizations, Branches, Terminals, RBAC Matrix,
 * Role Assignments, Permission Sets, Full Modules Control, and Security Governance) are
 * accessible to Admin ('admin'), while blocking unauthorized roles.
 */
export const SETTINGS_TAB_RBAC_POLICY: Record<SettingsTabId, SettingsTabRbacRule> = {
  system_config: {
    tabId: 'system_config',
    scopeTier: 'organization_admin',
    allowedRoles: ['admin'],
    requiredPermissions: ['org:manage'],
    isOrganizationLevel: true,
    titleEn: 'Enterprise Organization, Branch & Terminal Configuration',
    titleTh: 'การตั้งค่าองค์กร สาขา และเครื่องขาย POS (Admin Only)',
  },
  modules_control: {
    tabId: 'modules_control',
    scopeTier: 'organization_admin',
    allowedRoles: ['admin'],
    requiredPermissions: ['org:manage'],
    isOrganizationLevel: true,
    titleEn: '100% Enterprise System Modules Control',
    titleTh: 'ควบคุมการเปิด/ปิดโมดูลทั้งองค์กร (Admin Only)',
  },
  admin_security: {
    tabId: 'admin_security',
    scopeTier: 'organization_admin',
    allowedRoles: ['admin'],
    requiredPermissions: ['rbac:manage'],
    isOrganizationLevel: true,
    titleEn: 'Admin Security & System Owner Credential Vault',
    titleTh: 'ความปลอดภัยผู้ดูแลระบบและเปลี่ยนรหัสผ่านเจ้าของระบบ (Admin Security)',
  },
  security_roles: {
    tabId: 'security_roles',
    scopeTier: 'organization_admin',
    allowedRoles: ['admin'],
    requiredPermissions: ['rbac:manage'],
    isOrganizationLevel: true,
    titleEn: 'Enterprise Security & PIN Governance Policies',
    titleTh: 'นโยบายความปลอดภัยและรหัส PIN ระดับองค์กร (Admin Only)',
  },
  role_management: {
    tabId: 'role_management',
    scopeTier: 'organization_admin',
    allowedRoles: ['admin'],
    requiredPermissions: ['rbac:manage'],
    isOrganizationLevel: true,
    titleEn: 'Enterprise Role & Permission Matrix (RBAC)',
    titleTh: 'จัดการบทบาทและตารางสิทธิ์ RBAC ระดับองค์กร (Admin Only)',
  },
  role_assignment: {
    tabId: 'role_assignment',
    scopeTier: 'organization_admin',
    allowedRoles: ['admin'],
    requiredPermissions: ['rbac:manage'],
    isOrganizationLevel: true,
    titleEn: 'Organization Staff Role Assignments',
    titleTh: 'การมอบหมายตำแหน่งและสิทธิ์พนักงานทั้งองค์กร (Admin Only)',
  },
  permission_sets: {
    tabId: 'permission_sets',
    scopeTier: 'organization_admin',
    allowedRoles: ['admin'],
    requiredPermissions: ['rbac:manage'],
    isOrganizationLevel: true,
    titleEn: 'Custom Enterprise Permission Sets',
    titleTh: 'ชุดสิทธิ์พนักงานกำหนดเองระดับองค์กร (Admin Only)',
  },
  data_sync: {
    tabId: 'data_sync',
    scopeTier: 'organization_admin',
    allowedRoles: ['admin'],
    requiredPermissions: ['org:manage'],
    isOrganizationLevel: true,
    titleEn: 'Enterprise Cloud Sync, Outbox & Backup',
    titleTh: 'การซิงค์ฐานข้อมูลและสำรองข้อมูลระดับองค์กร (Admin Only)',
  },
  general: {
    tabId: 'general',
    scopeTier: 'store_management',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['settings:manage'],
    isOrganizationLevel: false,
    titleEn: 'Store Identity & Receipt Header',
    titleTh: 'ข้อมูลสาขาและหัวใบเสร็จ',
  },
  appearance: {
    tabId: 'appearance',
    scopeTier: 'store_management',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['settings:manage'],
    isOrganizationLevel: false,
    titleEn: 'Theme Appearance & Customer Display',
    titleTh: 'รูปลักษณ์ธีมและจอแสดงผลฝั่งลูกค้า (CFD)',
  },
  tax_accounting: {
    tabId: 'tax_accounting',
    scopeTier: 'store_management',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['settings:manage'],
    isOrganizationLevel: false,
    titleEn: 'Tax (VAT) & Accounting Configuration',
    titleTh: 'การเงินและภาษีมูลค่าเพิ่ม (VAT)',
  },
  hardware: {
    tabId: 'hardware',
    scopeTier: 'store_management',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['settings:manage'],
    isOrganizationLevel: false,
    titleEn: 'Printers & Hardware Peripherals',
    titleTh: 'เครื่องพิมพ์และฮาร์ดแวร์ต่อพ่วง',
  },
  system_tools: {
    tabId: 'system_tools',
    scopeTier: 'store_management',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['settings:manage'],
    isOrganizationLevel: false,
    titleEn: 'POS Quick Keys, Payment Tenders & Discounts',
    titleTh: 'ปุ่มลัดสินค้า ช่องทางชำระเงิน และส่วนลด',
  },
  loyalty_crm: {
    tabId: 'loyalty_crm',
    scopeTier: 'store_management',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['settings:manage'],
    isOrganizationLevel: false,
    titleEn: 'Loyalty CRM & VIP Tiers',
    titleTh: 'ระบบสมาชิกและระดับ VIP Tiers',
  },
  ai_assistant: {
    tabId: 'ai_assistant',
    scopeTier: 'store_management',
    allowedRoles: ['manager', 'admin'],
    requiredPermissions: ['settings:manage'],
    isOrganizationLevel: false,
    titleEn: 'PRODX AI Assistant Settings',
    titleTh: 'ตั้งค่าผู้ช่วยอัจฉริยะ PRODX AI',
  },
};

/**
 * Evaluates whether the current user has permission, falling back to role matrix if needed.
 */
function checkUserPermission(
  user: User,
  permission: Permission,
  customPermissionChecker?: (perm: Permission) => boolean,
): boolean {
  // Admin role always has full organization-level and operational authority
  if (user.role === 'admin') {
    return true;
  }
  if (customPermissionChecker) {
    return customPermissionChecker(permission);
  }
  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return hasPermission(user, permission);
  }
  return ROLE_PERMISSIONS[user.role]?.includes(permission) ?? false;
}

export function isGeneralUserPosOnly(user: User | null | undefined): boolean {
  if (!user) return true;
  return user.role === 'cashier';
}

export function isOrganizationAdmin(user: User | null | undefined): boolean {
  if (!user || user.isActive === false) return false;
  return user.role === 'admin';
}

export function getPermittedRoutesForUser(
  user: User | null | undefined,
  customPermissionChecker?: (perm: Permission) => boolean,
): NavRoute[] {
  const routes = Object.keys(ROUTE_RBAC_POLICY) as NavRoute[];
  return routes.filter((route) => evaluateRouteAccess(user, route, customPermissionChecker).allowed);
}

export function getPermittedSettingsTabsForUser(
  user: User | null | undefined,
  customPermissionChecker?: (perm: Permission) => boolean,
): SettingsTabId[] {
  const tabs = Object.keys(SETTINGS_TAB_RBAC_POLICY) as SettingsTabId[];
  return tabs.filter((tab) => evaluateSettingsTabAccess(user, tab, customPermissionChecker).allowed);
}

/**
 * Middleware function: Evaluates access to a primary application route (NavRoute).
 * Guarantees that:
 * - General Users ('cashier') can ONLY access 'pos'.
 * - Admins ('admin') can access ALL routes and organization-level settings.
 */
export function evaluateRouteAccess(
  user: User | null | undefined,
  route: NavRoute,
  customPermissionChecker?: (perm: Permission) => boolean,
): RbacAccessDecision {
  const rule = ROUTE_RBAC_POLICY[route] || ROUTE_RBAC_POLICY.pos;

  if (!user) {
    return {
      allowed: false,
      scopeTier: rule.scopeTier,
      reason: 'unauthenticated',
      requiredRoles: rule.allowedRoles,
      requiredPermissions: rule.requiredPermissions,
      missingPermissions: rule.requiredPermissions,
      redirectRoute: 'pos',
      messageEn: 'Authentication is required to access this terminal route.',
      messageTh: 'กรุณาเข้าสู่ระบบก่อนเข้าใช้งานหน้าต่างนี้',
    };
  }

  if (user.isActive === false) {
    return {
      allowed: false,
      scopeTier: rule.scopeTier,
      reason: 'inactive_account',
      requiredRoles: rule.allowedRoles,
      requiredPermissions: rule.requiredPermissions,
      missingPermissions: rule.requiredPermissions,
      redirectRoute: 'pos',
      messageEn: 'This user account has been suspended by an administrator.',
      messageTh: 'บัญชีผู้ใช้งานนี้ถูกระงับการใช้งานชั่วคราวโดยผู้ดูแลระบบ',
    };
  }

  // Administrators have full organization-wide and store-wide access
  if (user.role === 'admin') {
    return {
      allowed: true,
      scopeTier: rule.scopeTier,
      requiredRoles: rule.allowedRoles,
      requiredPermissions: rule.requiredPermissions,
      missingPermissions: [],
      redirectRoute: route,
      messageEn: 'Full Administrator access granted.',
      messageTh: 'อนุญาตการเข้าถึงระดับผู้ดูแลระบบสูงสุด (Admin)',
    };
  }

  // General User ('cashier') strict POS-only confinement guard
  if (user.role === 'cashier' && route !== 'pos') {
    return {
      allowed: false,
      scopeTier: rule.scopeTier,
      reason: 'general_user_pos_only',
      requiredRoles: rule.allowedRoles,
      requiredPermissions: rule.requiredPermissions,
      missingPermissions: rule.requiredPermissions,
      redirectRoute: 'pos',
      messageEn:
        'General User (Cashier) accounts are strictly restricted to the POS Cash Register screen only.',
      messageTh:
        'ผู้ใช้งานทั่วไป (Cashier / Staff) สามารถเข้าถึงได้เฉพาะหน้าจอขายหน้าร้าน (POS) เท่านั้น ไม่สามารถเข้าถึงเมนูจัดการหรือการตั้งค่าได้',
    };
  }

  // Role check (e.g., manager attempting an admin-only route like infrastructure)
  if (!rule.allowedRoles.includes(user.role)) {
    const isAdminOnly = rule.allowedRoles.length === 1 && rule.allowedRoles[0] === 'admin';
    return {
      allowed: false,
      scopeTier: rule.scopeTier,
      reason: isAdminOnly ? 'admin_role_required' : 'manager_or_admin_required',
      requiredRoles: rule.allowedRoles,
      requiredPermissions: rule.requiredPermissions,
      missingPermissions: rule.requiredPermissions,
      redirectRoute: 'pos',
      messageEn: isAdminOnly
        ? 'Organization-level configuration and infrastructure are restricted to Administrators (Admin) only.'
        : 'This module requires Shift Manager or Administrator privileges.',
      messageTh: isAdminOnly
        ? 'การตั้งค่าระดับองค์กรและโครงสร้างพื้นฐานสงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น'
        : 'โมดูลนี้ต้องใช้สิทธิ์ระดับผู้จัดการสาขา (Manager) หรือผู้ดูแลระบบ (Admin)',
    };
  }

  // Granular permission verification
  const missingPermissions = rule.requiredPermissions.filter(
    (perm) => !checkUserPermission(user, perm, customPermissionChecker),
  );

  if (missingPermissions.length > 0) {
    return {
      allowed: false,
      scopeTier: rule.scopeTier,
      reason: 'missing_permission',
      requiredRoles: rule.allowedRoles,
      requiredPermissions: rule.requiredPermissions,
      missingPermissions,
      redirectRoute: 'pos',
      messageEn: `Missing required RBAC permission(s): ${missingPermissions.join(', ')}`,
      messageTh: `บัญชีของคุณไม่มีสิทธิ์ RBAC ที่จำเป็น: ${missingPermissions.join(', ')}`,
    };
  }

  return {
    allowed: true,
    scopeTier: rule.scopeTier,
    requiredRoles: rule.allowedRoles,
    requiredPermissions: rule.requiredPermissions,
    missingPermissions: [],
    redirectRoute: route,
    messageEn: 'Access granted.',
    messageTh: 'อนุญาตการเข้าถึง',
  };
}

/**
 * Middleware function: Evaluates access to a specific Settings Tab (SettingsTabId).
 * Ensures Admin has access to all organization-level tabs while restricting non-admins.
 */
export function evaluateSettingsTabAccess(
  user: User | null | undefined,
  tabId: SettingsTabId,
  customPermissionChecker?: (perm: Permission) => boolean,
): RbacAccessDecision {
  const rule = SETTINGS_TAB_RBAC_POLICY[tabId] || SETTINGS_TAB_RBAC_POLICY.general;

  if (!user) {
    return {
      allowed: false,
      scopeTier: rule.scopeTier,
      reason: 'unauthenticated',
      requiredRoles: rule.allowedRoles,
      requiredPermissions: rule.requiredPermissions,
      missingPermissions: rule.requiredPermissions,
      redirectRoute: 'pos',
      messageEn: 'Authentication required.',
      messageTh: 'กรุณาเข้าสู่ระบบ',
    };
  }

  // Admin has unrestricted access to ALL settings tabs (both organization-level and store-level)
  if (user.role === 'admin') {
    return {
      allowed: true,
      scopeTier: rule.scopeTier,
      requiredRoles: rule.allowedRoles,
      requiredPermissions: rule.requiredPermissions,
      missingPermissions: [],
      redirectRoute: 'settings',
      messageEn: 'Administrator access granted to all organization & store settings.',
      messageTh: 'ผู้ดูแลระบบ (Admin) สามารถเข้าถึงการตั้งค่าระดับองค์กรและสาขาได้ทั้งหมด',
    };
  }

  // General user ('cashier') is strictly POS-only
  if (user.role === 'cashier') {
    return {
      allowed: false,
      scopeTier: rule.scopeTier,
      reason: 'general_user_pos_only',
      requiredRoles: rule.allowedRoles,
      requiredPermissions: rule.requiredPermissions,
      missingPermissions: rule.requiredPermissions,
      redirectRoute: 'pos',
      messageEn: 'General users can only access the POS screen and cannot access system settings.',
      messageTh: 'ผู้ใช้งานทั่วไปสามารถเข้าถึงได้เฉพาะหน้าขาย POS เท่านั้น ไม่สามารถเข้าถึงการตั้งค่าระบบได้',
    };
  }

  // Check if this settings tab is an Organization-Level Admin-Only tab
  if (!rule.allowedRoles.includes(user.role)) {
    return {
      allowed: false,
      scopeTier: rule.scopeTier,
      reason: 'admin_role_required',
      requiredRoles: rule.allowedRoles,
      requiredPermissions: rule.requiredPermissions,
      missingPermissions: rule.requiredPermissions,
      redirectRoute: 'pos',
      messageEn: `"${rule.titleEn}" is an organization-level setting restricted to Administrators (Admin) only.`,
      messageTh: `"${rule.titleTh}" เป็นการตั้งค่าระดับองค์กร สงวนสิทธิ์เฉพาะผู้ดูแลระบบ (Admin) เท่านั้น`,
    };
  }

  const missingPermissions = rule.requiredPermissions.filter(
    (perm) => !checkUserPermission(user, perm, customPermissionChecker),
  );

  if (missingPermissions.length > 0) {
    return {
      allowed: false,
      scopeTier: rule.scopeTier,
      reason: 'missing_permission',
      requiredRoles: rule.allowedRoles,
      requiredPermissions: rule.requiredPermissions,
      missingPermissions,
      redirectRoute: 'pos',
      messageEn: `Missing required permission(s): ${missingPermissions.join(', ')}`,
      messageTh: `ขาดสิทธิ์ที่จำเป็น: ${missingPermissions.join(', ')}`,
    };
  }

  return {
    allowed: true,
    scopeTier: rule.scopeTier,
    requiredRoles: rule.allowedRoles,
    requiredPermissions: rule.requiredPermissions,
    missingPermissions: [],
    redirectRoute: 'settings',
    messageEn: 'Store settings access granted.',
    messageTh: 'อนุญาตการเข้าถึงการตั้งค่าระดับสาขา',
  };
}

/**
 * Middleware function: Evaluates access to the dedicated Enterprise Admin Console (/admin).
 * Strictly requires 'admin' role.
 */
export function evaluateAdminConsoleAccess(
  user: User | null | undefined,
  _section?: AdminConsoleSection,
): RbacAccessDecision {
  if (!user) {
    return {
      allowed: false,
      scopeTier: 'organization_admin',
      reason: 'unauthenticated',
      requiredRoles: ['admin'],
      requiredPermissions: ['org:manage', 'branch:manage', 'terminal:manage', 'rbac:manage'],
      missingPermissions: ['org:manage'],
      redirectRoute: 'pos',
      messageEn: 'Administrator authentication is required to access the Organization Admin Console.',
      messageTh: 'กรุณาเข้าสู่ระบบด้วยบัญชีผู้ดูแลระบบ (Admin) เพื่อเข้าถึงคอนโซลจัดการระดับองค์กร',
    };
  }

  if (user.role !== 'admin') {
    return {
      allowed: false,
      scopeTier: 'organization_admin',
      reason: user.role === 'cashier' ? 'general_user_pos_only' : 'admin_role_required',
      requiredRoles: ['admin'],
      requiredPermissions: ['org:manage', 'branch:manage', 'terminal:manage', 'rbac:manage'],
      missingPermissions: ['org:manage', 'branch:manage', 'terminal:manage', 'rbac:manage'],
      redirectRoute: 'pos',
      messageEn:
        user.role === 'cashier'
          ? 'General Users are strictly restricted to the POS Cash Register and cannot enter the Admin Console.'
          : 'Only Administrators (Admin) can access organization-level settings in the Admin Console.',
      messageTh:
        user.role === 'cashier'
          ? 'ผู้ใช้งานทั่วไปสามารถใช้งานได้เฉพาะหน้าขาย POS เท่านั้น ไม่ได้รับอนุญาตให้เข้าถึง Admin Console'
          : 'เฉพาะผู้ดูแลระบบสูงสุด (Admin) เท่านั้นที่สามารถเข้าถึงการตั้งค่าระดับองค์กรใน Admin Console ได้',
    };
  }

  return {
    allowed: true,
    scopeTier: 'organization_admin',
    requiredRoles: ['admin'],
    requiredPermissions: ['org:manage', 'branch:manage', 'terminal:manage', 'rbac:manage'],
    missingPermissions: [],
    redirectRoute: 'settings',
    messageEn: 'Full Enterprise Organization Admin access verified.',
    messageTh: 'ยืนยันสิทธิ์ผู้ดูแลระบบระดับองค์กร (Admin) สำเร็จ',
  };
}

/**
 * Error thrown when a service-level organization CRUD operation is attempted by a non-admin actor.
 */
export class RbacUnauthorizedError extends Error {
  public readonly code = 'RBAC_FORBIDDEN';
  public readonly actorRole: string;
  public readonly requiredRole = 'admin';
  public readonly operation: string;

  constructor(operation: string, actorRole = 'unknown') {
    super(
      `[RBAC Guard] Access Denied: Operation "${operation}" requires "admin" role (current role: "${actorRole}"). General users are restricted to POS operations only.`,
    );
    this.name = 'RbacUnauthorizedError';
    this.actorRole = actorRole;
    this.operation = operation;
  }
}

export const RbacAuthorizationError = RbacUnauthorizedError;

/**
 * Service-layer RBAC Middleware Guard for Organization, Branch & Terminal mutations.
 * If an explicit actor is supplied with a non-admin role (e.g., 'cashier' or 'manager'),
 * throws RbacUnauthorizedError to prevent unauthorized organization-level mutations.
 */
export function assertOrganizationAdminAccess(
  actor: { id?: string; name?: string; email?: string; role?: string } | undefined,
  operation: string,
): void {
  if (!actor || !actor.role) {
    // Allow internal/system calls that do not specify an untrusted non-admin user role
    return;
  }

  const normalizedRole = actor.role.trim().toLowerCase();
  if (normalizedRole !== 'admin') {
    throw new RbacUnauthorizedError(operation, actor.role);
  }
}
