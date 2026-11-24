/**
 * PRODX POS - Real-time Permission Simulator & Role Access Tester
 */

import React, { useState } from 'react';
import {
  Sliders,
  CheckCircle2,
  XCircle,
  KeyRound,
  ShieldCheck,
  AlertTriangle,
  Play,
  User,
  Users,
  Lock,
} from 'lucide-react';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';
import { useLanguage } from '../../../context/LanguageContext';
import { useAuth } from '../../../context/AuthContext';
import { CustomPermissionSet } from '../../../domain/permissionSets';
import { Permission, Role } from '../../../domain/auth';

export interface PermissionSimulatorCardProps {
  permissionSets: CustomPermissionSet[];
  policies: {
    requirePinForVoid: boolean;
    requirePinForDiscount: boolean;
    requirePinForDrawerKick: boolean;
    requirePinForPriceOverride: boolean;
  };
}

interface TestScenario {
  id: string;
  nameTh: string;
  nameEn: string;
  requiredPermission: Permission;
  supervisorPinRequiredPolicy?: keyof PermissionSimulatorCardProps['policies'];
  dangerLevel: 'low' | 'medium' | 'high' | 'critical';
}

const TEST_SCENARIOS: TestScenario[] = [
  {
    id: 'sc-checkout',
    nameTh: 'สแกนบาร์โค้ดและรับชำระเงินหน้าร้าน (Checkout & Collect Payment)',
    nameEn: 'Barcode Scan & Standard Checkout',
    requiredPermission: 'pos:checkout',
    dangerLevel: 'low',
  },
  {
    id: 'sc-discount',
    nameTh: 'ให้ส่วนลดพิเศษแก่ลูกค้า (Custom Discount)',
    nameEn: 'Discretionary Custom Discount',
    requiredPermission: 'pos:discount',
    supervisorPinRequiredPolicy: 'requirePinForDiscount',
    dangerLevel: 'medium',
  },
  {
    id: 'sc-price-override',
    nameTh: 'แก้ไขราคาต่อหน่วยสินค้าเอง (Manual Price Override)',
    nameEn: 'Override Unit Price on Active Cart Item',
    requiredPermission: 'pos:price_override',
    supervisorPinRequiredPolicy: 'requirePinForPriceOverride',
    dangerLevel: 'high',
  },
  {
    id: 'sc-void',
    nameTh: 'ยกเลิกบิลหรือล้างรายการชำระเงิน (Void Transaction)',
    nameEn: 'Void Paid Order / Clear Cart',
    requiredPermission: 'pos:void',
    supervisorPinRequiredPolicy: 'requirePinForVoid',
    dangerLevel: 'high',
  },
  {
    id: 'sc-refund',
    nameTh: 'ทำเรื่องคืนเงินและรับคืนสินค้า (Process Customer Refund)',
    nameEn: 'Issue Cash / Card Customer Refund',
    requiredPermission: 'pos:refund',
    dangerLevel: 'critical',
  },
  {
    id: 'sc-drawer-movement',
    nameTh: 'สั่งเปิดลิ้นชักฉุกเฉิน / นำเงินเข้า-ออก (Cash Movement)',
    nameEn: 'Manual Drawer Kick & Paid In / Paid Out',
    requiredPermission: 'shift:pay_movement',
    supervisorPinRequiredPolicy: 'requirePinForDrawerKick',
    dangerLevel: 'medium',
  },
  {
    id: 'sc-inv-adjust',
    nameTh: 'ปรับยอดสต็อกสินค้าในคลัง (Stock Ledger Adjustment)',
    nameEn: 'Modify Stock Count & Inventory Ledger',
    requiredPermission: 'inventory:adjust',
    dangerLevel: 'medium',
  },
  {
    id: 'sc-reports',
    nameTh: 'เข้าดูรายงานยอดขายและกำไร (Financial Analytics)',
    nameEn: 'Access Daily Sales & Financial Analytics',
    requiredPermission: 'reports:read',
    dangerLevel: 'medium',
  },
  {
    id: 'sc-audit',
    nameTh: 'ตรวจสอบบันทึกความปลอดภัย (Audit Trail Inspection)',
    nameEn: 'Inspect Audit Logs & Security Events',
    requiredPermission: 'audit:read',
    dangerLevel: 'high',
  },
  {
    id: 'sc-settings',
    nameTh: 'แก้ไขการตั้งค่าระบบและนโยบายร้าน (Master Settings)',
    nameEn: 'Modify System Settings & Master Configuration',
    requiredPermission: 'settings:manage',
    dangerLevel: 'critical',
  },
];

export const PermissionSimulatorCard: React.FC<PermissionSimulatorCardProps> = ({
  permissionSets,
  policies,
}) => {
  const { language } = useLanguage();
  const { staffUsers, rolePermissions } = useAuth();

  const [simulationTargetType, setSimulationTargetType] = useState<'set' | 'staff'>('set');
  const [selectedSetId, setSelectedSetId] = useState<string>(
    permissionSets[0]?.id || 'pset-cashier-std'
  );
  const [selectedStaffId, setSelectedStaffId] = useState<string>(
    staffUsers[0]?.id || ''
  );

  // Derive active permissions of the tested subject
  const currentTestedPermissions: Permission[] = React.useMemo(() => {
    if (simulationTargetType === 'set') {
      const set = permissionSets.find((s) => s.id === selectedSetId);
      return set ? [...set.permissions] : [];
    } else {
      const user = staffUsers.find((u) => u.id === selectedStaffId);
      if (!user) return [];
      // Dynamic permissions based on role or direct permissions
      return user.permissions.length > 0
        ? [...user.permissions]
        : [...(rolePermissions[user.role] || [])];
    }
  }, [simulationTargetType, selectedSetId, selectedStaffId, permissionSets, staffUsers, rolePermissions]);

  const targetName = React.useMemo(() => {
    if (simulationTargetType === 'set') {
      const set = permissionSets.find((s) => s.id === selectedSetId);
      return set ? (language === 'th' ? set.nameTh || set.name : set.name) : '';
    } else {
      const user = staffUsers.find((u) => u.id === selectedStaffId);
      return user ? `${user.name} (${user.role.toUpperCase()})` : '';
    }
  }, [simulationTargetType, selectedSetId, selectedStaffId, permissionSets, staffUsers, language]);

  return (
    <Card className="border border-border border-crisp shadow-xs rounded-xl overflow-hidden">
      <CardHeader className="bg-card border-b border-border py-3.5 px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
            <Sliders className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-text flex items-center gap-2">
              <span>
                {language === 'th'
                  ? 'เครื่องมือทดสอบการเข้าถึงจริง (Interactive Permission Simulator)'
                  : 'Interactive Permission Simulator'}
              </span>
              <Badge variant="primary" size="sm" className="font-mono text-[9px] uppercase font-bold">
                LIVE SANDBOX
              </Badge>
            </h3>
            <p className="text-[11px] text-text/50">
              {language === 'th'
                ? 'จำลองสถานการณ์การใช้งานจริงของระบบ POS สำหรับแต่ละชุดสิทธิ์หรือพนักงาน'
                : 'Simulate frontline operations to verify which actions are allowed, blocked, or require supervisor PIN.'}
            </p>
          </div>
        </div>

        {/* Target Switcher: Permission Set vs Staff User */}
        <div role="tablist" aria-label={language === 'th' ? 'ประเภทเป้าหมายการจำลอง' : 'Simulation target type'} className="flex items-center gap-1.5 p-1 rounded-lg bg-background border border-border border-crisp">
          <button
            type="button"
            role="tab"
            aria-selected={simulationTargetType === 'set'}
            onClick={() => setSimulationTargetType('set')}
            className={`min-h-[44px] px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta ${
              simulationTargetType === 'set'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-brand-text-secondary hover:text-text'
            }`}
          >
            {language === 'th' ? 'เลือกตามชุดสิทธิ์' : 'By Permission Set'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={simulationTargetType === 'staff'}
            onClick={() => setSimulationTargetType('staff')}
            className={`min-h-[44px] px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-cta ${
              simulationTargetType === 'staff'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-brand-text-secondary hover:text-text'
            }`}
          >
            {language === 'th' ? 'เลือกตามพนักงาน' : 'By Staff Member'}
          </button>
        </div>
      </CardHeader>

      <CardBody className="p-5 space-y-4">
        {/* Selector Dropdown */}
        <div className="p-3.5 rounded-xl border border-border border-crisp bg-background/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-card border border-border text-primary shrink-0">
              {simulationTargetType === 'set' ? <ShieldCheck className="h-5 w-5" /> : <User className="h-5 w-5" />}
            </div>
            <div>
              <div className="text-[11px] font-bold text-text/50 uppercase">
                {simulationTargetType === 'set'
                  ? language === 'th'
                    ? 'ชุดสิทธิ์ที่กำลังทดสอบ (Tested Set)'
                    : 'Target Permission Set'
                  : language === 'th'
                  ? 'พนักงานที่กำลังทดสอบ (Tested Staff)'
                  : 'Target Staff Member'}
              </div>
              <div className="text-xs font-bold text-text mt-0.5">{targetName}</div>
            </div>
          </div>

          <div className="min-w-[220px]">
            {simulationTargetType === 'set' ? (
              <select
                value={selectedSetId}
                onChange={(e) => setSelectedSetId(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-bold text-text focus:ring-2 focus:ring-primary focus:outline-hidden cursor-pointer"
              >
                {permissionSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {language === 'th' ? s.nameTh || s.name : s.name} ({s.targetRole.toUpperCase()})
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={selectedStaffId}
                onChange={(e) => setSelectedStaffId(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-bold text-text focus:ring-2 focus:ring-primary focus:outline-hidden cursor-pointer"
              >
                {staffUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.employeeCode} • {u.role})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Simulation Results Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {TEST_SCENARIOS.map((sc) => {
            const hasPerm = currentTestedPermissions.includes(sc.requiredPermission);
            const requiresPin =
              sc.supervisorPinRequiredPolicy && policies[sc.supervisorPinRequiredPolicy];

            return (
              <div
                key={sc.id}
                className={`p-3 rounded-lg border transition-all flex items-center justify-between gap-3 ${
                  hasPerm
                    ? 'border-border bg-card hover:bg-background/80'
                    : 'border-border/60 bg-background/40 opacity-70'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-text truncate">
                    {language === 'th' ? sc.nameTh : sc.nameEn}
                  </div>
                  <div className="text-[10px] text-text/50 font-mono mt-0.5">
                    Perm: <strong>{sc.requiredPermission}</strong>
                  </div>
                </div>

                <div className="shrink-0">
                  {hasPerm ? (
                    requiresPin ? (
                      <Badge variant="warning" size="sm" className="font-bold text-[10px] flex items-center gap-1">
                        <KeyRound className="h-3 w-3" />
                        <span>{language === 'th' ? 'ต้องใช้ PIN ผู้จัดการ' : 'Supervisor PIN'}</span>
                      </Badge>
                    ) : (
                      <Badge variant="success" size="sm" className="font-bold text-[10px] flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>{language === 'th' ? 'ทำรายการได้ทันที' : 'Allowed'}</span>
                      </Badge>
                    )
                  ) : (
                    <Badge variant="danger" size="sm" className="font-bold text-[10px] flex items-center gap-1">
                      <XCircle className="h-3 w-3" />
                      <span>{language === 'th' ? 'ไม่อนุญาต (ห้ามทำ)' : 'Forbidden'}</span>
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
};
