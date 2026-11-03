/**
 * PRODX POS - Custom Permission Sets Domain & Storage Module
 * Enterprise RBAC profile definitions, risk calculation, and template presets
 */

import { Permission, Role, PERMISSION_DEFINITIONS, ROLE_PERMISSIONS } from './auth';

export type PermissionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CustomPermissionSet {
  id: string;
  name: string;
  nameTh?: string;
  code: string;
  description: string;
  descriptionTh?: string;
  badgeColor: 'primary' | 'amber' | 'emerald' | 'purple' | 'rose' | 'cyan' | 'slate';
  targetRole: Role;
  permissions: Permission[];
  isSystem?: boolean;
  assignedStaffIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export const HIGH_RISK_PERMISSIONS: Record<Permission, { risk: PermissionRiskLevel; warningTh: string; warningEn: string }> = {
  'pos:checkout': { risk: 'low', warningTh: 'การคิดเงินและรับชำระปกติ', warningEn: 'Standard checkout operations' },
  'pos:discount': { risk: 'medium', warningTh: 'สามารถให้ส่วนลดกับลูกค้าได้', warningEn: 'Discretionary discounts' },
  'pos:price_override': { risk: 'high', warningTh: 'สามารถแก้ไขราคาต่อหน่วยของสินค้าได้โดยตรง', warningEn: 'Direct unit price manipulation' },
  'pos:void': { risk: 'high', warningTh: 'สามารถยกเลิกบิลหรือลบรายการสินค้าที่คิดเงินแล้ว', warningEn: 'Void transaction / cancel order' },
  'pos:refund': { risk: 'critical', warningTh: 'สามารถอนุมัติคืนเงินสดหรือเงินโอนให้ลูกค้าได้', warningEn: 'Cash/card refund authorization' },
  'shift:open': { risk: 'low', warningTh: 'เปิดกะและบันทึกเงินทอนเริ่มต้น', warningEn: 'Open cash till with starting float' },
  'shift:close': { risk: 'low', warningTh: 'ปิดกะและนับเงินสดสรุปยอดสิ้นวัน', warningEn: 'Close till and reconcile cash drawer' },
  'shift:pay_movement': { risk: 'medium', warningTh: 'นำเงินสดเข้า-ออกจากลิ้นชัก (Paid In / Paid Out)', warningEn: 'Manual cash float adjustments' },
  'inventory:read': { risk: 'low', warningTh: 'ตรวจสอบจำนวนสินค้าคงเหลือในคลัง', warningEn: 'Stock level visibility' },
  'inventory:adjust': { risk: 'medium', warningTh: 'ปรับยอดสต็อกสินค้าเพิ่มหรือลดในระบบ', warningEn: 'Stock write and ledger adjustment' },
  'customers:read': { risk: 'low', warningTh: 'ดูข้อมูลสมาชิกและประวัติการซื้อ', warningEn: 'Customer loyalty read access' },
  'customers:write': { risk: 'low', warningTh: 'เพิ่มหรือแก้ไขข้อมูลลูกค้าสมาชิก', warningEn: 'Create/modify customer records' },
  'reports:read': { risk: 'medium', warningTh: 'ดูข้อมูลยอดขาย กำไร และสถิติทางการเงิน', warningEn: 'Financial analytics & sales data' },
  'audit:read': { risk: 'high', warningTh: 'เข้าถึงประวัติการเข้าใช้งานและบันทึกความปลอดภัยทั้งหมด', warningEn: 'Security audit trail logs' },
  'settings:manage': { risk: 'critical', warningTh: 'แก้ไขการตั้งค่าร้านค้า ภาษี และนโยบายระบบ', warningEn: 'Master system configuration' },
  'org:read': { risk: 'medium', warningTh: 'ดูโครงสร้างองค์กร สาขา และเครื่องขาย POS', warningEn: 'Read organization hierarchy & terminals' },
  'org:manage': { risk: 'critical', warningTh: 'สร้าง แก้ไข หรือลบข้อมูลระดับองค์กร (Admin เท่านั้น)', warningEn: 'Full organization-level governance (Admin only)' },
  'branch:manage': { risk: 'critical', warningTh: 'สร้าง แก้ไข หรือลบสาขาภายใต้เครือข่ายองค์กร', warningEn: 'Create, update, or delete store branches' },
  'terminal:manage': { risk: 'high', warningTh: 'ลงทะเบียน แก้ไข หรือลบเครื่องขาย POS (Terminal)', warningEn: 'Register, configure, or remove POS terminals' },
  'rbac:manage': { risk: 'critical', warningTh: 'แก้ไขตารางสิทธิ์ RBAC และกำหนดบทบาทพนักงาน', warningEn: 'Modify RBAC permission matrix & role assignments' },
};

export function getPermissionRisk(perm: Permission): PermissionRiskLevel {
  return HIGH_RISK_PERMISSIONS[perm]?.risk || 'low';
}

export function calculateSetRisk(permissions: Permission[]): PermissionRiskLevel {
  if (permissions.some((p) => HIGH_RISK_PERMISSIONS[p]?.risk === 'critical')) return 'critical';
  if (permissions.some((p) => HIGH_RISK_PERMISSIONS[p]?.risk === 'high')) return 'high';
  if (permissions.some((p) => HIGH_RISK_PERMISSIONS[p]?.risk === 'medium')) return 'medium';
  return 'low';
}

/**
 * Built-in Enterprise Permission Sets & Presets
 */
export const DEFAULT_PERMISSION_SETS: CustomPermissionSet[] = [
  {
    id: 'pset-admin-master',
    name: 'Administrator Master Profile',
    nameTh: 'ชุดสิทธิ์ผู้ดูแลระบบสูงสุด (Master)',
    code: 'PSET-ADM-01',
    description: 'Full root enterprise access across all POS terminals, stores, settings, audit, and user accounts.',
    descriptionTh: 'สิทธิ์ระดับสูงสุด ควบคุมทุกฟังก์ชัน ทั้งการเงิน สต็อก รายงาน บันทึกความปลอดภัย และการตั้งค่า',
    badgeColor: 'primary',
    targetRole: 'admin',
    permissions: [
      'pos:checkout',
      'pos:discount',
      'pos:price_override',
      'pos:void',
      'pos:refund',
      'shift:open',
      'shift:close',
      'shift:pay_movement',
      'inventory:read',
      'inventory:adjust',
      'customers:read',
      'customers:write',
      'reports:read',
      'audit:read',
      'settings:manage',
    ],
    isSystem: true,
    assignedStaffIds: ['usr-admin-alex'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'pset-manager-lead',
    name: 'Floor Supervisor & Shift Lead',
    nameTh: 'ผู้จัดการสาขาและหัวหน้ากะ (Shift Lead)',
    code: 'PSET-MGR-01',
    description: 'Supervisory rights for floor operations, staff shift audits, void/refund authorizations, and inventory.',
    descriptionTh: 'สิทธิ์ดูแลการปฏิบัติงานหน้าร้าน อนุมัติการยกเลิกบิล คืนเงิน และตรวจนับสต็อกสินค้า',
    badgeColor: 'amber',
    targetRole: 'manager',
    permissions: [
      'pos:checkout',
      'pos:discount',
      'pos:price_override',
      'pos:void',
      'pos:refund',
      'shift:open',
      'shift:close',
      'shift:pay_movement',
      'inventory:read',
      'inventory:adjust',
      'customers:read',
      'customers:write',
      'reports:read',
      'audit:read',
      'settings:manage',
    ],
    isSystem: true,
    assignedStaffIds: ['usr-manager-sarah'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'pset-cashier-std',
    name: 'Standard Frontline Cashier',
    nameTh: 'พนักงานแคชเชียร์มาตรฐาน',
    code: 'PSET-CSH-STD',
    description: 'Standard retail frontline operations: barcode scan, standard discount, shift open/close, and customer lookup.',
    descriptionTh: 'ปฏิบัติงานคิดเงินหน้าร้านปกติ ให้ส่วนลดตามสิทธิ์ สแกนสินค้า และเปิด-ปิดกะประจำวัน',
    badgeColor: 'emerald',
    targetRole: 'cashier',
    permissions: [
      'pos:checkout',
      'pos:discount',
      'shift:open',
      'shift:close',
      'inventory:read',
      'customers:read',
      'customers:write',
    ],
    isSystem: true,
    assignedStaffIds: ['usr-cashier-john', 'usr-cashier-emily'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'pset-cashier-senior',
    name: 'Senior Cashier & Returns Specialist',
    nameTh: 'แคชเชียร์อาวุโสและงานรับคืนสินค้า',
    code: 'PSET-CSH-SNR',
    description: 'Trusted senior cashier authorized to process customer returns, bill voids, and price overrides without supervisor delay.',
    descriptionTh: 'แคชเชียร์ระดับอาวุโส มีสิทธิ์อนุมัติคืนสินค้า ยกเลิกบิล และปรับราคาได้โดยไม่ต้องรอผู้จัดการ',
    badgeColor: 'cyan',
    targetRole: 'cashier',
    permissions: [
      'pos:checkout',
      'pos:discount',
      'pos:price_override',
      'pos:void',
      'pos:refund',
      'shift:open',
      'shift:close',
      'inventory:read',
      'customers:read',
      'customers:write',
    ],
    isSystem: false,
    assignedStaffIds: [],
    createdAt: '2026-02-15T09:30:00Z',
    updatedAt: '2026-02-15T09:30:00Z',
  },
  {
    id: 'pset-inv-auditor',
    name: 'Inventory Auditor & Stock Controller',
    nameTh: 'ผู้ตรวจนับคลังและควบคุมสต็อก',
    code: 'PSET-INV-01',
    description: 'Warehouse and back-office stock controller with read/write access to inventory ledger, reports, and shift till setup.',
    descriptionTh: 'เจ้าหน้าที่คลังสินค้า สามารถปรับยอดสต็อก ตรวจสอบรายงาน และดูประวัติสินค้าได้เต็มรูปแบบ',
    badgeColor: 'purple',
    targetRole: 'manager',
    permissions: [
      'inventory:read',
      'inventory:adjust',
      'reports:read',
      'audit:read',
      'customers:read',
      'shift:open',
    ],
    isSystem: false,
    assignedStaffIds: [],
    createdAt: '2026-02-20T14:15:00Z',
    updatedAt: '2026-02-20T14:15:00Z',
  },
  {
    id: 'pset-cashier-trainee',
    name: 'Restricted Trainee Cashier',
    nameTh: 'พนักงานฝึกงาน / แคชเชียร์ควบคุมพิเศษ',
    code: 'PSET-CSH-TRN',
    description: 'Restricted entry-level cashier. Checkout and member lookup only. Discretionary discounts, voids, and catalog edits restricted.',
    descriptionTh: 'สำหรับพนักงานทดลองงาน คิดเงินและค้นหาสมาชิกได้เท่านั้น ไม่อนุญาตให้ลดราคาหรือแก้ไขสต็อก',
    badgeColor: 'slate',
    targetRole: 'cashier',
    permissions: [
      'pos:checkout',
      'shift:open',
      'shift:close',
      'customers:read',
    ],
    isSystem: false,
    assignedStaffIds: [],
    createdAt: '2026-03-01T11:00:00Z',
    updatedAt: '2026-03-01T11:00:00Z',
  },
];

export const PERMISSION_SET_TEMPLATES: Array<{
  id: string;
  name: string;
  nameTh: string;
  code: string;
  description: string;
  descriptionTh: string;
  targetRole: Role;
  badgeColor: CustomPermissionSet['badgeColor'];
  permissions: Permission[];
}> = [
  {
    id: 'tmpl-senior-cashier',
    name: 'Senior Cashier & Returns',
    nameTh: 'แคชเชียร์อาวุโส (มีสิทธิ์รับคืนและยกเลิกบิล)',
    code: 'PSET-SNR-CSH',
    description: 'Checkout, customer discounts, voids, price overrides, and product return authorization.',
    descriptionTh: 'คิดเงิน ให้ส่วนลด ยกเลิกบิล แก้ไขราคา และคืนเงินให้ลูกค้าได้',
    targetRole: 'cashier',
    badgeColor: 'cyan',
    permissions: [
      'pos:checkout',
      'pos:discount',
      'pos:price_override',
      'pos:void',
      'pos:refund',
      'shift:open',
      'shift:close',
      'inventory:read',
      'customers:read',
      'customers:write',
    ],
  },
  {
    id: 'tmpl-stock-auditor',
    name: 'Stock Auditor & Catalog Specialist',
    nameTh: 'ผู้ตรวจสอบสต็อกและคลังสินค้า',
    code: 'PSET-STOCK-AUD',
    description: 'Inventory adjustments, stock audits, product catalogs, and analytics reports.',
    descriptionTh: 'จัดการสต็อก ปรับยอดคลังสินค้า ดูรายงานยอดขาย และบันทึก Audit',
    targetRole: 'manager',
    badgeColor: 'purple',
    permissions: [
      'inventory:read',
      'inventory:adjust',
      'reports:read',
      'audit:read',
      'customers:read',
      'shift:open',
    ],
  },
  {
    id: 'tmpl-strict-cashier',
    name: 'Strict / Seasonal Cashier',
    nameTh: 'แคชเชียร์พาร์ทไทม์ / ควบคุมเข้มงวด',
    code: 'PSET-STR-CSH',
    description: 'Basic checkout only. No discretionary discounts, no drawer moves, no voids.',
    descriptionTh: 'สแกนคิดเงินและเปิดกะเท่านั้น ไม่อนุญาตให้ลดราคาหรือแก้ไขยอดเงินในลิ้นชัก',
    targetRole: 'cashier',
    badgeColor: 'slate',
    permissions: ['pos:checkout', 'shift:open', 'shift:close', 'customers:read'],
  },
  {
    id: 'tmpl-store-accountant',
    name: 'Store Financial Accountant',
    nameTh: 'เจ้าหน้าที่บัญชีและการเงินสาขา',
    code: 'PSET-FIN-ACC',
    description: 'End-of-day reconciliation, reports, shift pay movements, and audit inspection.',
    descriptionTh: 'ตรวจนับเงินปิดกะ บันทึกนำเงินเข้า-ออก ดูรายงานการเงิน และ Audit Trail',
    targetRole: 'manager',
    badgeColor: 'emerald',
    permissions: [
      'shift:close',
      'shift:pay_movement',
      'reports:read',
      'audit:read',
      'inventory:read',
      'customers:read',
    ],
  },
];

export const CUSTOM_PERM_SETS_STORAGE_KEY = 'prodx_pos_custom_permission_sets';

export function getStoredCustomPermissionSets(): CustomPermissionSet[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PERM_SETS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.error('Failed to load custom permission sets from storage', e);
  }
  return DEFAULT_PERMISSION_SETS;
}

export function saveStoredCustomPermissionSets(sets: CustomPermissionSet[]): void {
  try {
    localStorage.setItem(CUSTOM_PERM_SETS_STORAGE_KEY, JSON.stringify(sets));
  } catch (e) {
    console.error('Failed to save custom permission sets to storage', e);
  }
}
