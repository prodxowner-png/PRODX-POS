/**
 * PRODX POS - Security, Roles & Access Control Settings Tab
 */

import React, { useState } from 'react';
import {
  Shield,
  ShieldCheck,
  Lock,
  UserCheck,
  KeyRound,
  Clock,
  AlertTriangle,
  Fingerprint,
  Users,
  FileX,
  BadgePercent,
  CheckCircle,
  Sliders,
  LogOut,
} from 'lucide-react';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';
import { useLanguage } from '../../../context/LanguageContext';
import { useToast } from '../../../context/ToastContext';
import { useAuth } from '../../../context/AuthContext';
import { SecurityPoliciesState } from '../types';
import { PinChangeModal } from './PinChangeModal';
import { StaffManagementSection } from './StaffManagementSection';
import { PermissionMatrixSection } from './PermissionMatrixSection';
import { PermissionSetsManagement } from './PermissionSetsManagement';
import { UserToRoleAssignmentTable } from './UserToRoleAssignmentTable';
import { ManageRegisteredDevicesSection } from './ManageRegisteredDevicesSection';

export interface SecurityRolesSettingsTabProps {
  policies: SecurityPoliciesState;
  onChangePolicy: <K extends keyof SecurityPoliciesState>(
    field: K,
    value: SecurityPoliciesState[K]
  ) => void;
  defaultSubTab?: SubTab;
  onOpenAdminPasswordReset?: () => void;
}

type SubTab =
  | 'role_assignment'
  | 'staff'
  | 'matrix'
  | 'permission_sets'
  | 'governance'
  | 'registered_devices';

export const SecurityRolesSettingsTab: React.FC<SecurityRolesSettingsTabProps> = ({
  policies,
  onChangePolicy,
  defaultSubTab = 'role_assignment',
  onOpenAdminPasswordReset,
}) => {
  const { language } = useLanguage();
  const { session, inactivityTimeoutMinutes, setInactivityTimeoutMinutes, autoLogoutTimeoutMinutes, setAutoLogoutTimeoutMinutes, lockSystem } = useAuth();
  const { addToast } = useToast();

  const [activeSubTab, setActiveSubTab] = useState<SubTab>(defaultSubTab);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);

  if (!session) return null;

  return (
    <div className="space-y-5">
      {/* Sub-navigation Pills */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-xl bg-card border border-border border-crisp shadow-2xs">
        {[
          {
            id: 'role_assignment' as SubTab,
            labelTh: 'กำหนดบทบาทพนักงาน',
            labelEn: 'Role Assignments',
            descTh: 'ตารางกำหนดสิทธิ์รายบุคคล และการมอบหมายกลุ่ม',
            descEn: 'User-to-role matrix & bulk assign',
            icon: ShieldCheck,
          },
          {
            id: 'staff' as SubTab,
            labelTh: 'รายชื่อและบัญชีพนักงาน',
            labelEn: 'Staff & Accounts',
            descTh: 'จัดการพนักงาน, บทบาท, รหัส PIN',
            descEn: 'Directory, roles & PINs',
            icon: Users,
          },
          {
            id: 'matrix' as SubTab,
            labelTh: 'ตารางกำหนดสิทธิ์ละเอียด',
            labelEn: 'Permission Matrix',
            descTh: 'เปิด-ปิดสิทธิ์แต่ละตำแหน่ง (Admin/Manager/Cashier)',
            descEn: 'Granular access controls',
            icon: ShieldCheck,
          },
          {
            id: 'permission_sets' as SubTab,
            labelTh: 'ชุดสิทธิ์พนักงานกำหนดเอง',
            labelEn: 'Custom Permission Sets',
            descTh: 'สร้าง/แก้ไขโปรไฟล์สิทธิ์ และจำลองสิทธิ์ (Sandbox)',
            descEn: 'Define role profiles & sandbox',
            icon: Sliders,
          },
          {
            id: 'governance' as SubTab,
            labelTh: 'นโยบายความปลอดภัยและการอนุมัติ',
            labelEn: 'Security Governance',
            descTh: 'พักหน้าจออัตโนมัติ, ผู้จัดการอนุมัติคำสั่ง',
            descEn: 'Auto-lock & supervisor PIN',
            icon: Lock,
          },
          {
            id: 'registered_devices' as SubTab,
            labelTh: 'จัดการอุปกรณ์ที่ลงทะเบียน (WebAuthn)',
            labelEn: 'Manage Registered Devices',
            descTh: 'เปลี่ยนชื่อหรือเพิกถอนคีย์ WebAuthn เมื่ออุปกรณ์สูญหาย',
            descEn: 'Rename or revoke WebAuthn biometric keys',
            icon: Fingerprint,
          },
        ].map((tab) => {
          const isSelected = activeSubTab === tab.id;
          const Icon = tab.icon;

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex-1 min-w-[200px] flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-left transition-all cursor-pointer ${
                isSelected
                  ? 'bg-primary text-white shadow-xs font-bold'
                  : 'text-text/70 hover:text-text hover:bg-background'
              }`}
            >
              <div
                className={`p-1.5 rounded-md ${
                  isSelected ? 'bg-white/20 text-white' : 'bg-background border border-border text-primary'
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
                    isSelected ? 'text-white/80' : 'text-text/50'
                  }`}
                >
                  {language === 'th' ? tab.descTh : tab.descEn}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* SubTab: Role Assignments Matrix */}
      {activeSubTab === 'role_assignment' && <UserToRoleAssignmentTable />}

      {/* SubTab 1: Staff & Accounts Directory */}
      {activeSubTab === 'staff' && <StaffManagementSection />}

      {/* SubTab 2: Granular Role-Permission Matrix */}
      {activeSubTab === 'matrix' && <PermissionMatrixSection />}

      {/* SubTab 3: Custom Permission Sets Management */}
      {activeSubTab === 'permission_sets' && <PermissionSetsManagement />}

      {/* SubTab 4: Security Governance Policies */}
      {activeSubTab === 'governance' && (
        <div className="space-y-5">
          {/* Current User Identity & Quick PIN Card */}
          <Card className="border border-border border-crisp shadow-xs rounded-xl overflow-hidden">
            <CardHeader className="bg-card border-b border-border py-3.5 px-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                  <UserCheck className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text">
                    {language === 'th'
                      ? 'ข้อมูลผู้ใช้งานและรหัสผ่าน PIN (Active User Credentials)'
                      : 'Active User Credentials'}
                  </h3>
                  <p className="text-[11px] text-text/50">
                    {language === 'th'
                      ? 'ข้อมูลประจำตัว สิทธิการเข้าถึงระบบ และรหัสผ่านด่วน PIN สำหรับปลดล็อก'
                      : 'Active staff member profile, role authority, and quick authentication PIN.'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {session.currentUser.role === 'admin' && onOpenAdminPasswordReset && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onOpenAdminPasswordReset}
                    className="rounded-lg font-bold text-xs border-primary/40 text-primary hover:bg-primary/10"
                    leftIcon={<ShieldCheck className="h-3.5 w-3.5 text-primary" />}
                  >
                    {language === 'th'
                      ? 'รีเซ็ตรหัสผ่าน Admin (System Owner)'
                      : 'Reset Admin Password'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setIsPinModalOpen(true)}
                  className="rounded-lg font-bold text-xs"
                  leftIcon={<KeyRound className="h-3.5 w-3.5" />}
                >
                  {language === 'th' ? 'เปลี่ยนรหัส PIN ส่วนตัว' : 'Change Personal PIN'}
                </Button>
              </div>
            </CardHeader>

            <CardBody className="p-5 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl border border-border border-crisp bg-background/50">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center font-bold text-lg shrink-0">
                    {session.currentUser.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-text">{session.currentUser.name}</h4>
                      <Badge variant="primary" size="sm" className="font-mono uppercase font-bold text-[9px]">
                        {session.currentUser.role}
                      </Badge>
                    </div>
                    <div className="text-xs text-text/60 mt-0.5 flex items-center gap-3 font-mono">
                      <span>
                        Code:{' '}
                        <strong className="text-text">
                          {session.currentUser.employeeCode || session.currentUser.id}
                        </strong>
                      </span>
                      <span>•</span>
                      <span>
                        Store: <strong className="text-text">{session.currentStore.code}</strong>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      lockSystem();
                      addToast({
                        title: language === 'th' ? 'ล็อกระบบทันทีแล้ว' : 'Terminal Locked',
                        message:
                          language === 'th'
                            ? 'ใส่รหัส PIN เพื่อปลดล็อกหน้าจอ'
                            : 'Enter your PIN to resume.',
                        type: 'info',
                      });
                    }}
                    className="rounded-lg font-bold text-xs"
                    leftIcon={<Lock className="h-3.5 w-3.5 text-amber-500" />}
                  >
                    {language === 'th' ? 'ล็อกหน้าจอทันที (Lock Now)' : 'Lock Screen Now'}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Inactivity Auto-Lock Policy Card */}
          <Card className="border border-border border-crisp shadow-xs rounded-xl overflow-hidden">
            <CardHeader className="bg-card border-b border-border py-3.5 px-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                  <Clock className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text">
                    {language === 'th'
                      ? 'การพักหน้าจออัตโนมัติ (Inactivity Auto-Lock Timeout)'
                      : 'Inactivity Auto-Lock Timeout'}
                  </h3>
                  <p className="text-[11px] text-text/50">
                    {language === 'th'
                      ? 'ล็อกหน้าจอ POS อัตโนมัติเมื่อไม่มีการใช้งานตามเวลาที่กำหนดเพื่อความปลอดภัย'
                      : 'Automatically locks cash register and prompts for PIN after a period of idle inactivity.'}
                  </p>
                </div>
              </div>
              <Badge variant={inactivityTimeoutMinutes === 0 ? 'warning' : 'success'} size="sm" className="font-bold">
                {inactivityTimeoutMinutes === 0
                  ? language === 'th'
                    ? 'ปิดการล็อก'
                    : 'Disabled'
                  : `${inactivityTimeoutMinutes} ${language === 'th' ? 'นาที' : 'Min'}`}
              </Badge>
            </CardHeader>

            <CardBody className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {[
                  { mins: 0, labelTh: 'ไม่ล็อก (ปิด)', labelEn: 'Disabled' },
                  { mins: 1, labelTh: '1 นาที', labelEn: '1 Min' },
                  { mins: 3, labelTh: '3 นาที', labelEn: '3 Min' },
                  { mins: 5, labelTh: '5 นาที (แนะนำ)', labelEn: '5 Min (Default)' },
                  { mins: 15, labelTh: '15 นาที', labelEn: '15 Min' },
                  { mins: 30, labelTh: '30 นาที', labelEn: '30 Min' },
                ].map((item) => {
                  const isSelected = inactivityTimeoutMinutes === item.mins;
                  return (
                    <button
                      key={item.mins}
                      type="button"
                      onClick={() => {
                        setInactivityTimeoutMinutes(item.mins);
                        onChangePolicy('inactivityTimeoutMinutes', item.mins);
                        addToast({
                          title: language === 'th' ? 'ตั้งเวลาพักหน้าจอแล้ว' : 'Auto-Lock Timeout Updated',
                          message:
                            item.mins === 0
                              ? language === 'th'
                                ? 'ปิดการพักหน้าจออัตโนมัติ'
                                : 'Auto-lock disabled'
                              : `Auto-lock set to ${item.mins} minutes.`,
                          type: 'success',
                        });
                      }}
                      className={`p-3 rounded-lg border text-center cursor-pointer transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-primary font-bold shadow-2xs'
                          : 'border-border bg-card text-text/80 hover:bg-background'
                      }`}
                    >
                      <div className="text-xs font-bold font-mono">
                        {item.mins === 0 ? 'OFF' : `${item.mins}m`}
                      </div>
                      <div className="text-[10px] text-text/50 truncate mt-0.5">
                        {language === 'th' ? item.labelTh : item.labelEn}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardBody>
          </Card>

          {/* Inactivity Auto-Logout Timeout Policy Card */}
          <Card className="border border-border border-crisp shadow-xs rounded-xl overflow-hidden">
            <CardHeader className="bg-card border-b border-border py-3.5 px-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                  <LogOut className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text">
                    {language === 'th'
                      ? 'การออกจากระบบอัตโนมัติ (Inactivity Auto-Logout Timeout)'
                      : 'Inactivity Auto-Logout Timeout'}
                  </h3>
                  <p className="text-[11px] text-text/50">
                    {language === 'th'
                      ? 'ออกจากระบบและคืนหน้าจอ Login อัตโนมัติเมื่อไม่มีการใช้งานตามเวลาที่กำหนด'
                      : 'Terminates active cashier session and returns to login screen after extended idle time.'}
                  </p>
                </div>
              </div>
              <Badge variant={autoLogoutTimeoutMinutes === 0 ? 'warning' : 'success'} size="sm" className="font-bold">
                {autoLogoutTimeoutMinutes === 0
                  ? language === 'th'
                    ? 'ปิดใช้งาน'
                    : 'Disabled'
                  : `${autoLogoutTimeoutMinutes} ${language === 'th' ? 'นาที' : 'Min'}`}
              </Badge>
            </CardHeader>

            <CardBody className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {[
                  { mins: 0, labelTh: 'ปิดการตั้งค่า', labelEn: 'Disabled' },
                  { mins: 5, labelTh: '5 นาที', labelEn: '5 Min' },
                  { mins: 15, labelTh: '15 นาที', labelEn: '15 Min' },
                  { mins: 30, labelTh: '30 นาที (แนะนำ)', labelEn: '30 Min (Default)' },
                  { mins: 60, labelTh: '60 นาที', labelEn: '60 Min' },
                ].map((item) => {
                  const isSelected = autoLogoutTimeoutMinutes === item.mins;
                  return (
                    <button
                      key={item.mins}
                      type="button"
                      onClick={() => {
                        setAutoLogoutTimeoutMinutes(item.mins);
                        addToast({
                          title: language === 'th' ? 'ตั้งเวลา Auto-Logout แล้ว' : 'Auto-Logout Timeout Updated',
                          message:
                            item.mins === 0
                              ? language === 'th'
                                ? 'ปิดการออกจากระบบอัตโนมัติ'
                                : 'Auto-logout disabled'
                              : `Auto-logout set to ${item.mins} minutes.`,
                          type: 'success',
                        });
                      }}
                      className={`p-3 rounded-lg border text-center cursor-pointer transition-all ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-primary font-bold shadow-2xs'
                          : 'border-border bg-card text-text/80 hover:bg-background'
                      }`}
                    >
                      <div className="text-xs font-bold font-mono">
                        {item.mins === 0 ? 'OFF' : `${item.mins}m`}
                      </div>
                      <div className="text-[10px] text-text/50 truncate mt-0.5">
                        {language === 'th' ? item.labelTh : item.labelEn}
                      </div>
                    </button>
                  );
                })}
              </div>
            </CardBody>
          </Card>

          {/* Security Governance & Supervisor Authorizations Card */}
          <Card className="border border-border border-crisp shadow-xs rounded-xl overflow-hidden">
            <CardHeader className="bg-card border-b border-border py-3.5 px-5">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-text">
                    {language === 'th'
                      ? 'นโยบายการอนุมัติระดับผู้จัดการ (Supervisor Authorization Governance)'
                      : 'Supervisor Authorization Governance'}
                  </h3>
                  <p className="text-[11px] text-text/50">
                    {language === 'th'
                      ? 'กำหนดคำสั่งที่จำเป็นต้องให้ผู้จัดการสาขายืนยันรหัส PIN ก่อนดำเนินการ'
                      : 'Enforce high-privilege operations to require supervisor PIN approval.'}
                  </p>
                </div>
              </div>
            </CardHeader>

            <CardBody className="p-5 space-y-3">
              <div className="space-y-3">
                {/* Require PIN for Void */}
                <div className="p-3.5 rounded-xl border border-border border-crisp bg-background/50 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-text flex items-center gap-2">
                      <FileX className="h-4 w-4 text-rose-500" />
                      <span>
                        {language === 'th'
                          ? 'บังคับใส่ PIN ผู้จัดการเมื่อยกเลิกบิล (Require PIN for Order Void)'
                          : 'Require Manager PIN for Order Void'}
                      </span>
                    </div>
                    <div className="text-[11px] text-text/50 mt-0.5 pl-6">
                      {language === 'th'
                        ? 'ป้องกันการยกเลิกบิลหรือล้างรายการสินค้าโดยพลการ'
                        : 'Restricts voiding paid orders or held bills to authorized supervisors.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={policies.requirePinForVoid}
                    onClick={() => onChangePolicy('requirePinForVoid', !policies.requirePinForVoid)}
                    className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                      policies.requirePinForVoid ? 'bg-primary' : 'bg-border'
                    }`}
                  >
                    <div
                      className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                        policies.requirePinForVoid ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Require PIN for High Discounts */}
                <div className="p-3.5 rounded-xl border border-border border-crisp bg-background/50 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-text flex items-center gap-2">
                      <BadgePercent className="h-4 w-4 text-amber-500" />
                      <span>
                        {language === 'th'
                          ? 'บังคับใส่ PIN เมื่อให้ส่วนลดพิเศษเกิน 15% (Require PIN for Discount > 15%)'
                          : 'Require Manager PIN for Custom Discounts > 15%'}
                      </span>
                    </div>
                    <div className="text-[11px] text-text/50 mt-0.5 pl-6">
                      {language === 'th'
                        ? 'ป้องกันการให้ส่วนลดกำหนดเองที่เกินอัตรามาตรฐานสาขา'
                        : 'Requires supervisor authorization for discretionary discount entries over 15%.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={policies.requirePinForDiscount}
                    onClick={() => onChangePolicy('requirePinForDiscount', !policies.requirePinForDiscount)}
                    className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                      policies.requirePinForDiscount ? 'bg-primary' : 'bg-border'
                    }`}
                  >
                    <div
                      className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                        policies.requirePinForDiscount ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Require PIN for Emergency Drawer Kick */}
                <div className="p-3.5 rounded-xl border border-border border-crisp bg-background/50 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-text flex items-center gap-2">
                      <KeyRound className="h-4 w-4 text-primary" />
                      <span>
                        {language === 'th'
                          ? 'บังคับใส่ PIN เมื่อสั่งเปิดลิ้นชักฉุกเฉิน (Require PIN for Manual Drawer Open)'
                          : 'Require Manager PIN for Emergency Drawer Open'}
                      </span>
                    </div>
                    <div className="text-[11px] text-text/50 mt-0.5 pl-6">
                      {language === 'th'
                        ? 'การเปิดลิ้นชักโดยไม่มีรายการขาย (No-Sale Drawer Kick) ต้องบันทึกประวัติการใส่ PIN'
                        : 'Logs no-sale drawer opens with supervisor security credentials.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={policies.requirePinForDrawerKick}
                    onClick={() =>
                      onChangePolicy('requirePinForDrawerKick', !policies.requirePinForDrawerKick)
                    }
                    className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                      policies.requirePinForDrawerKick ? 'bg-primary' : 'bg-border'
                    }`}
                  >
                    <div
                      className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                        policies.requirePinForDrawerKick ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Require PIN for Price Override */}
                <div className="p-3.5 rounded-xl border border-border border-crisp bg-background/50 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-text flex items-center gap-2">
                      <Shield className="h-4 w-4 text-emerald-500" />
                      <span>
                        {language === 'th'
                          ? 'บังคับใส่ PIN เมื่อแก้ไขราคาสินค้าหน้าร้าน (Price Override)'
                          : 'Require Manager PIN for Price Override'}
                      </span>
                    </div>
                    <div className="text-[11px] text-text/50 mt-0.5 pl-6">
                      {language === 'th'
                        ? 'การปรับเปลี่ยนราคาต่อหน่วยระหว่างการคิดเงินต้องได้รับอนุมัติ'
                        : 'Requires supervisor override to alter unit price on active cart items.'}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={policies.requirePinForPriceOverride}
                    onClick={() =>
                      onChangePolicy('requirePinForPriceOverride', !policies.requirePinForPriceOverride)
                    }
                    className={`w-11 h-6 shrink-0 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                      policies.requirePinForPriceOverride ? 'bg-primary' : 'bg-border'
                    }`}
                  >
                    <div
                      className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                        policies.requirePinForPriceOverride ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Manage Registered Devices (WebAuthn / Passkeys) */}
          <ManageRegisteredDevicesSection />
        </div>
      )}

      {/* SubTab 5: Dedicated Manage Registered Devices View */}
      {activeSubTab === 'registered_devices' && <ManageRegisteredDevicesSection />}

      {/* Change PIN Modal */}
      {isPinModalOpen && (
        <PinChangeModal isOpen={isPinModalOpen} onClose={() => setIsPinModalOpen(false)} />
      )}
    </div>
  );
};

