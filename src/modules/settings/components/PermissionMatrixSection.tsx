/**
 * PRODX POS - Granular Role-Permission Matrix Section
 */

import React, { useState } from 'react';
import { Role, Permission, PERMISSION_DEFINITIONS, PermissionMeta } from '../../../domain/auth';
import { useAuth } from '../../../context/AuthContext';
import { useLanguage } from '../../../context/LanguageContext';
import { useToast } from '../../../context/ToastContext';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Badge } from '../../../components/common/Badge';
import {
  ShieldCheck,
  RotateCcw,
  Save,
  CheckCircle2,
  Lock,
  AlertTriangle,
  ShoppingCart,
  Receipt,
  Layers,
  Users,
  BarChart3,
  Settings,
  HelpCircle,
} from 'lucide-react';

export const PermissionMatrixSection: React.FC = () => {
  const { language } = useLanguage();
  const { rolePermissions, updateRolePermissions, resetRolePermissions } = useAuth();
  const { addToast } = useToast();

  const [matrix, setMatrix] = useState<Record<Role, Permission[]>>(() => ({
    admin: [...(rolePermissions.admin || [])],
    manager: [...(rolePermissions.manager || [])],
    cashier: [...(rolePermissions.cashier || [])],
  }));

  const [hasChanges, setHasChanges] = useState(false);

  // Group permissions by category
  const categories = [
    {
      id: 'pos',
      titleTh: 'จุดขายและแคชเชียร์ (POS Checkout Operations)',
      titleEn: 'Cash Register & Checkout Operations',
      icon: ShoppingCart,
    },
    {
      id: 'shift',
      titleTh: 'ลิ้นชักและการเงิน (Cash Drawer & Shift Management)',
      titleEn: 'Cash Float, Drawer & Shift Governance',
      icon: Receipt,
    },
    {
      id: 'inventory',
      titleTh: 'คลังสินค้าและสต็อก (Catalog & Inventory)',
      titleEn: 'Catalog & Stock Ledger',
      icon: Layers,
    },
    {
      id: 'customers',
      titleTh: 'ลูกค้าสัมพันธ์ (Customers & Loyalty)',
      titleEn: 'Customer Profiles & Loyalty CRM',
      icon: Users,
    },
    {
      id: 'reports',
      titleTh: 'รายงานและการตรวจสอบ (Analytics & Audit Trail)',
      titleEn: 'Financial Reports & Security Audit',
      icon: BarChart3,
    },
    {
      id: 'settings',
      titleTh: 'ตั้งค่าระบบและความปลอดภัย (System & Security Settings)',
      titleEn: 'Store Policies & Master Settings',
      icon: Settings,
    },
  ];

  const handleToggle = (role: Role, permId: Permission) => {
    // Admin permissions are fixed to all for safety, but manager and cashier can be toggled
    if (role === 'admin') return;

    setMatrix((prev) => {
      const currentList = prev[role] || [];
      const hasPerm = currentList.includes(permId);
      const nextList = hasPerm
        ? currentList.filter((p) => p !== permId)
        : [...currentList, permId];

      setHasChanges(true);
      return {
        ...prev,
        [role]: nextList,
      };
    });
  };

  const handleSave = () => {
    updateRolePermissions('manager', matrix.manager);
    updateRolePermissions('cashier', matrix.cashier);
    setHasChanges(false);

    addToast({
      title: language === 'th' ? 'บันทึกตารางกำหนดสิทธิ์แล้ว' : 'Permission Matrix Saved',
      message:
        language === 'th'
          ? 'การเปลี่ยนแปลงสิทธิ์มีผลกับพนักงานทุกตำแหน่งในระบบทันที'
          : 'Role permissions have been synchronized across all active sessions.',
      type: 'success',
    });
  };

  const handleReset = () => {
    if (
      window.confirm(
        language === 'th'
          ? 'คุณต้องการรีเซ็ตสิทธิ์ของทุกตำแหน่งกลับเป็นค่ามาตรฐานเริ่มต้นหรือไม่?'
          : 'Reset all role permissions to standard enterprise defaults?'
      )
    ) {
      resetRolePermissions();
      // Re-fetch default matrix
      setMatrix({
        admin: [...(rolePermissions.admin || [])],
        manager: [
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
        cashier: [
          'pos:checkout',
          'pos:discount',
          'shift:open',
          'shift:close',
          'inventory:read',
          'customers:read',
          'customers:write',
        ],
      });
      setHasChanges(false);

      addToast({
        title: language === 'th' ? 'คืนค่าเริ่มต้นสำเร็จ' : 'Permissions Reset',
        message:
          language === 'th'
            ? 'คืนค่าสิทธิ์ของระบบ POS กลับเป็นค่าเริ่มต้นเรียบร้อยแล้ว'
            : 'Default enterprise permissions restored successfully.',
        type: 'info',
      });
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Banner & Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-brand-text-secondary uppercase">
              {language === 'th' ? 'ผู้ดูแลระบบ (Admin)' : 'Administrator'}
            </div>
            <div className="text-sm font-bold text-primary mt-0.5">
              {PERMISSION_DEFINITIONS.length} / {PERMISSION_DEFINITIONS.length}{' '}
              <span className="text-xs font-normal text-text/60">
                {language === 'th' ? 'สิทธิ์เต็ม 100%' : 'Full access'}
              </span>
            </div>
          </div>
          <Badge variant="primary" size="sm" className="font-mono text-[10px] uppercase font-bold">
            MASTER
          </Badge>
        </div>

        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-brand-text-secondary uppercase">
              {language === 'th' ? 'ผู้จัดการ (Shift Manager)' : 'Shift Manager'}
            </div>
            <div className="text-sm font-bold text-amber-500 mt-0.5">
              {matrix.manager.length} / {PERMISSION_DEFINITIONS.length}{' '}
              <span className="text-xs font-normal text-text/60">
                {language === 'th' ? 'สิทธิ์ที่เปิดใช้งาน' : 'active permissions'}
              </span>
            </div>
          </div>
          <Badge variant="warning" size="sm" className="font-mono text-[10px] uppercase font-bold">
            SUPERVISOR
          </Badge>
        </div>

        <div className="p-3.5 rounded-xl border border-border border-crisp bg-card shadow-2xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-brand-text-secondary uppercase">
              {language === 'th' ? 'แคชเชียร์ (Cashier / Staff)' : 'Staff Cashier'}
            </div>
            <div className="text-sm font-bold text-text/80 mt-0.5">
              {matrix.cashier.length} / {PERMISSION_DEFINITIONS.length}{' '}
              <span className="text-xs font-normal text-text/60">
                {language === 'th' ? 'สิทธิ์ที่เปิดใช้งาน' : 'active permissions'}
              </span>
            </div>
          </div>
          <Badge variant="neutral" size="sm" className="font-mono text-[10px] uppercase font-bold">
            OPERATOR
          </Badge>
        </div>
      </div>

      {/* Main Permission Matrix Table Card */}
      <Card className="border border-border border-crisp shadow-xs rounded-xl overflow-hidden">
        <CardHeader className="bg-card border-b border-border py-3.5 px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-text">
                {language === 'th' ? 'ตารางกำหนดสิทธิ์ละเอียด (Granular Permission Matrix)' : 'Role & Permission Matrix'}
              </h3>
              <p className="text-[11px] text-brand-text-secondary">
                {language === 'th'
                  ? 'เปิด/ปิดการเข้าถึงฟังก์ชันงานของแต่ละตำแหน่ง เพื่อความปลอดภัยและความโปร่งใส'
                  : 'Configure operational permissions across roles to enforce enterprise separation of duties.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReset}
              className="rounded-lg text-xs font-semibold"
              leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
            >
              {language === 'th' ? 'คืนค่าเริ่มต้น' : 'Reset Defaults'}
            </Button>
            <Button
              type="button"
              variant={hasChanges ? 'primary' : 'outline'}
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges}
              className="rounded-lg text-xs font-bold"
              leftIcon={<Save className="h-3.5 w-3.5" />}
            >
              {language === 'th' ? 'บันทึกการตั้งค่า' : 'Save Changes'}
            </Button>
          </div>
        </CardHeader>

        <CardBody className="p-0">
          <div className="w-full overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border bg-background/70">
                  <th scope="col" className="py-3 px-5 font-bold text-text/70 uppercase text-[11px]">
                    {language === 'th' ? 'รายการสิทธิ์ในระบบ (Permission Description)' : 'System Permission & Scope'}
                  </th>
                  <th scope="col" className="py-3 px-4 text-center font-bold text-primary uppercase text-[11px] w-28">
                    {language === 'th' ? 'แอดมิน' : 'Admin'}
                  </th>
                  <th scope="col" className="py-3 px-4 text-center font-bold text-amber-500 uppercase text-[11px] w-28">
                    {language === 'th' ? 'ผู้จัดการ' : 'Manager'}
                  </th>
                  <th scope="col" className="py-3 px-4 text-center font-bold text-text/70 uppercase text-[11px] w-28">
                    {language === 'th' ? 'แคชเชียร์' : 'Cashier'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => {
                  const catPerms = PERMISSION_DEFINITIONS.filter((p) => p.category === cat.id);
                  const Icon = cat.icon;

                  return (
                    <React.Fragment key={cat.id}>
                      {/* Category Header Row */}
                      <tr className="bg-background/40 border-b border-border">
                        <td colSpan={4} className="py-2 px-5 font-bold text-text flex items-center gap-2">
                          <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
                          <span className="text-xs">{language === 'th' ? cat.titleTh : cat.titleEn}</span>
                        </td>
                      </tr>

                      {/* Permission Rows */}
                      {catPerms.map((p) => {
                        const adminHas = matrix.admin.includes(p.id);
                        const managerHas = matrix.manager.includes(p.id);
                        const cashierHas = matrix.cashier.includes(p.id);

                        return (
                          <tr
                            key={p.id}
                            className="border-b border-border/50 hover:bg-background/50 transition-colors"
                          >
                            <td className="py-3 px-5">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-text">
                                  {language === 'th' ? p.nameTh : p.nameEn}
                                </span>
                                {p.isSensitive && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400">
                                    {language === 'th' ? 'ควบคุมเข้มงวด' : 'Sensitive'}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-text/60 mt-0.5">
                                {language === 'th' ? p.descTh : p.descEn}
                              </p>
                            </td>

                            {/* Admin Checkbox (Always on) */}
                            <td className="py-3 px-4 text-center">
                              <div className="flex items-center justify-center">
                                <div className="w-5 h-5 rounded-md bg-primary/10 border border-primary/30 flex items-center justify-center text-primary cursor-not-allowed">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </div>
                              </div>
                            </td>

                            {/* Manager Checkbox */}
                            <td className="py-3 px-4 text-center">
                              <div className="flex items-center justify-center">
                                <button
                                  type="button"
                                  onClick={() => handleToggle('manager', p.id)}
                                  className={`w-5 h-5 rounded-md border flex items-center justify-center cursor-pointer transition-colors ${
                                    managerHas
                                      ? 'bg-warning-subtle border-warning text-warning-text shadow-2xs'
                                      : 'bg-background border-border hover:border-text/40 text-transparent'
                                  }`}
                                  title={
                                    managerHas
                                      ? language === 'th'
                                        ? 'คลิกเพื่อปิดสิทธิ์'
                                        : 'Click to revoke'
                                      : language === 'th'
                                      ? 'คลิกเพื่อเปิดสิทธิ์'
                                      : 'Click to grant'
                                  }
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>

                            {/* Cashier Checkbox */}
                            <td className="py-3 px-4 text-center">
                              <div className="flex items-center justify-center">
                                <button
                                  type="button"
                                  onClick={() => handleToggle('cashier', p.id)}
                                  className={`w-5 h-5 rounded-md border flex items-center justify-center cursor-pointer transition-colors ${
                                    cashierHas
                                      ? 'bg-primary border-primary text-primary-foreground shadow-2xs'
                                      : 'bg-background border-border hover:border-text/40 text-transparent'
                                  }`}
                                  title={
                                    cashierHas
                                      ? language === 'th'
                                        ? 'คลิกเพื่อปิดสิทธิ์'
                                        : 'Click to revoke'
                                      : language === 'th'
                                      ? 'คลิกเพื่อเปิดสิทธิ์'
                                      : 'Click to grant'
                                  }
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>
    </div>
  );
};
