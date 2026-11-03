/**
 * PRODX POS — Manage Registered Devices (WebAuthn / Passkeys Lifecycle Section)
 *
 * Allows staff, managers, and administrators in SettingsScreen to:
 * 1. Inspect all registered WebAuthn / Passkey biometric credentials (device label, authenticator type,
 *    credential ID, signature counter, creation date, and last used timestamp).
 * 2. Rename existing WebAuthn keys for clear terminal/device identification.
 * 3. Revoke existing WebAuthn keys immediately if a user loses access to their registered device,
 *    replaces hardware, or suspects credential compromise.
 * 4. Enroll/register a new WebAuthn passkey for the active workstation or restore default keys.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Fingerprint,
  Smartphone,
  Laptop,
  KeyRound,
  ShieldAlert,
  ShieldCheck,
  Pencil,
  Trash2,
  Plus,
  RotateCcw,
  Check,
  X,
  Clock,
  Hash,
  Search,
  User,
  AlertTriangle,
} from 'lucide-react';
import {
  PasskeyCredentialRecord,
  PasskeyRevocationReason,
  WebAuthnCapability,
  checkWebAuthnCapability,
  getRegisteredPasskeys,
  registerPasskey,
  renameEnrolledPasskey,
  revokeEnrolledPasskey,
  resetPasskeys,
} from '../../../services/webauthnService';
import { useAuth } from '../../../context/AuthContext';
import { useLanguage } from '../../../context/LanguageContext';
import { useToast } from '../../../context/ToastContext';
import { auditService } from '../../../services/auditService';
import { Badge } from '../../../components/common/Badge';
import { GraphicIcon } from '../../../components/common/GraphicIcon';

const QUICK_DEVICE_NAME_PRESETS = [
  'Front Register Terminal (Touch ID)',
  'Manager Tablet (Face ID)',
  'Backoffice Workstation (Windows Hello)',
  'Store Lead Hardware Security Key',
];

export const ManageRegisteredDevicesSection: React.FC = () => {
  const { session } = useAuth();
  const { language } = useLanguage();
  const { addToast } = useToast();
  const isThai = language === 'th';

  const currentUser = session?.currentUser;
  const isAdminOrManager =
    currentUser?.role === 'admin' || currentUser?.role === 'manager';

  const [passkeys, setPasskeys] = useState<PasskeyCredentialRecord[]>(() =>
    getRegisteredPasskeys(),
  );
  const [capability, setCapability] = useState<WebAuthnCapability | null>(null);
  const [scopeFilter, setScopeFilter] = useState<'all' | 'mine'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Inline Rename State
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');

  // Inline Revoke Confirmation State
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] =
    useState<PasskeyRevocationReason>('lost_device');

  // New Device Registration State
  const [isRegisteringNew, setIsRegisteringNew] = useState(false);
  const [newDeviceCustomLabel, setNewDeviceCustomLabel] = useState('');
  const [showEnrollPanel, setShowEnrollPanel] = useState(false);

  const refreshPasskeys = useCallback(() => {
    setPasskeys(getRegisteredPasskeys());
  }, []);

  useEffect(() => {
    checkWebAuthnCapability().then(setCapability).catch(() => {});
    refreshPasskeys();
  }, [refreshPasskeys]);

  const filteredPasskeys = useMemo(() => {
    return passkeys.filter((item) => {
      if (scopeFilter === 'mine' && currentUser) {
        const matchesUser =
          item.userId === currentUser.id ||
          item.userEmail.toLowerCase() === currentUser.email.toLowerCase();
        if (!matchesUser) return false;
      }

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.deviceLabel.toLowerCase().includes(q) ||
        item.userName.toLowerCase().includes(q) ||
        item.userEmail.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.authenticatorType.toLowerCase().includes(q)
      );
    });
  }, [passkeys, scopeFilter, currentUser, searchQuery]);

  const handleStartRename = (record: PasskeyCredentialRecord) => {
    setRevokingKeyId(null);
    setEditingKeyId(record.id);
    setEditingLabel(record.deviceLabel);
  };

  const handleConfirmRename = (record: PasskeyCredentialRecord) => {
    const trimmed = editingLabel.trim();
    if (!trimmed) {
      addToast({
        title: isThai ? 'กรุณาระบุชื่ออุปกรณ์' : 'Device Name Required',
        message: isThai
          ? 'ชื่ออุปกรณ์ WebAuthn ต้องไม่เป็นค่าว่าง'
          : 'Please enter a valid label for this WebAuthn key.',
        type: 'warning',
      });
      return;
    }

    const result = renameEnrolledPasskey(record.id, trimmed);
    setPasskeys(result.updated);
    setEditingKeyId(null);
    setEditingLabel('');

    auditService.logDiagnosticEvent({
      category: 'system',
      level: 'INFO',
      event: 'WEBAUTHN_DEVICE_KEY_RENAMED',
      message: `Renamed WebAuthn key ${record.id} from "${result.previousLabel}" to "${trimmed}"`,
      metadata: {
        credentialId: record.id,
        ownerEmail: record.userEmail,
        previousLabel: result.previousLabel,
        newDeviceLabel: trimmed,
        actorEmail: currentUser?.email,
      },
    });

    addToast({
      title: isThai ? 'เปลี่ยนชื่ออุปกรณ์สำเร็จ' : 'WebAuthn Key Renamed',
      message: isThai
        ? `อัปเดตชื่อคีย์เป็น "${trimmed}" เรียบร้อยแล้ว`
        : `Updated registered device name to "${trimmed}".`,
      type: 'success',
    });
  };

  const handleConfirmRevoke = (record: PasskeyCredentialRecord) => {
    const result = revokeEnrolledPasskey(record.id, revokeReason);
    setPasskeys(result.remaining);
    setRevokingKeyId(null);

    const reasonLabelMap: Record<PasskeyRevocationReason, string> = {
      lost_device: isThai
        ? 'สูญเสียการเข้าถึงอุปกรณ์ / อุปกรณ์สูญหาย'
        : 'Lost access to registered device',
      replaced: isThai ? 'เปลี่ยนอุปกรณ์เครื่องใหม่' : 'Replaced hardware device',
      compromised: isThai
        ? 'สงสัยว่าคีย์ไม่ปลอดภัย / เพิกถอนฉุกเฉิน'
        : 'Suspected credential compromise',
      manual: isThai ? 'เพิกถอนด้วยตนเอง' : 'Manual revocation',
    };

    auditService.logDiagnosticEvent({
      category: 'system',
      level: 'WARN',
      event: 'WEBAUTHN_DEVICE_KEY_REVOKED',
      message: `Revoked WebAuthn key "${record.deviceLabel}" (${record.id}) for ${record.userEmail} — Reason: ${revokeReason}`,
      metadata: {
        credentialId: record.id,
        deviceLabel: record.deviceLabel,
        ownerEmail: record.userEmail,
        reason: revokeReason,
        actorEmail: currentUser?.email,
      },
    });

    addToast({
      title: isThai ? 'เพิกถอนคีย์ WebAuthn สำเร็จ' : 'WebAuthn Key Revoked',
      message: isThai
        ? `เพิกถอน "${record.deviceLabel}" (${reasonLabelMap[revokeReason]}) เรียบร้อยแล้ว อุปกรณ์เดิมจะไม่สามารถเข้าสู่ระบบได้อีก`
        : `Revoked "${record.deviceLabel}" (${reasonLabelMap[revokeReason]}). This key can no longer authenticate.`,
      type: 'info',
    });
  };

  const handleRegisterCurrentDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    setIsRegisteringNew(true);
    try {
      const result = await registerPasskey(
        {
          id: currentUser.id,
          email: currentUser.email,
          name: currentUser.name,
          role: currentUser.role,
        },
        newDeviceCustomLabel.trim() || undefined,
      );

      if (!result.success || !result.credential) {
        addToast({
          title: isThai ? 'ลงทะเบียนอุปกรณ์ไม่สำเร็จ' : 'Device Registration Failed',
          message:
            result.error ||
            (isThai
              ? 'ไม่สามารถลงทะเบียนคีย์ WebAuthn บนอุปกรณ์นี้ได้'
              : 'Could not enroll a new WebAuthn passkey on this device.'),
          type: 'error',
        });
        return;
      }

      refreshPasskeys();
      setNewDeviceCustomLabel('');
      setShowEnrollPanel(false);

      auditService.logDiagnosticEvent({
        category: 'system',
        level: 'INFO',
        event: 'WEBAUTHN_DEVICE_KEY_ENROLLED',
        message: `Enrolled new WebAuthn device key "${result.credential.deviceLabel}" for ${currentUser.email}`,
        metadata: {
          credentialId: result.credential.id,
          deviceLabel: result.credential.deviceLabel,
          userEmail: currentUser.email,
        },
      });

      addToast({
        title: isThai ? 'ลงทะเบียนอุปกรณ์ใหม่สำเร็จ' : 'New Device Registered',
        message: isThai
          ? `เพิ่มคีย์ "${result.credential.deviceLabel}" สำหรับเข้าสู่ระบบด้วยลายนิ้วมือ/ใบหน้าแล้ว`
          : `Enrolled "${result.credential.deviceLabel}" for biometric authentication.`,
        type: 'success',
      });
    } finally {
      setIsRegisteringNew(false);
    }
  };

  const handleRestoreDefaults = () => {
    const restored = resetPasskeys();
    setPasskeys(restored);
    setEditingKeyId(null);
    setRevokingKeyId(null);
    addToast({
      title: isThai ? 'คืนค่าคีย์อุปกรณ์เริ่มต้นแล้ว' : 'Default Registered Devices Restored',
      message: isThai
        ? 'กู้คืนรายการอุปกรณ์ WebAuthn มาตรฐานของระบบเรียบร้อยแล้ว'
        : 'Restored default terminal WebAuthn passkeys.',
      type: 'info',
    });
  };

  const getAuthenticatorTypeMeta = (
    type: PasskeyCredentialRecord['authenticatorType'],
  ) => {
    switch (type) {
      case 'touch_id':
        return {
          label: 'Touch ID / Fingerprint',
          icon: Fingerprint,
        };
      case 'face_id':
        return {
          label: 'Face ID / Biometric',
          icon: Smartphone,
        };
      case 'windows_hello':
        return {
          label: 'Windows Hello',
          icon: Laptop,
        };
      case 'android_biometric':
        return {
          label: 'Android Biometric',
          icon: Smartphone,
        };
      case 'security_key':
        return {
          label: 'Hardware Security Key',
          icon: KeyRound,
        };
      default:
        return {
          label: 'Verified Passkey',
          icon: Fingerprint,
        };
    }
  };

  return (
    <section
      id="manage-registered-devices-section"
      aria-labelledby="manage-registered-devices-heading"
      className="bg-card border border-border border-crisp rounded-2xl p-5 sm:p-6 shadow-xs space-y-5"
    >
      {/* Section Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-border/60">
        <div className="flex items-start sm:items-center gap-3.5">
          <GraphicIcon icon={Fingerprint} color="primary" variant="glow" size="md" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2
                id="manage-registered-devices-heading"
                className="text-base sm:text-lg font-black text-text"
              >
                {isThai
                  ? 'จัดการอุปกรณ์ที่ลงทะเบียน (Manage Registered Devices)'
                  : 'Manage Registered Devices (WebAuthn & Passkeys)'}
              </h2>
              <Badge variant="primary" size="xs" className="font-mono">
                {passkeys.length} {isThai ? 'คีย์ที่ลงทะเบียน' : 'REGISTERED KEYS'}
              </Badge>
            </div>
            <p className="text-xs text-text/65 mt-1">
              {isThai
                ? 'เปลี่ยนชื่อเรียกอุปกรณ์ (Rename) หรือเพิกถอนคีย์ WebAuthn ทันที (Revoke) กรณีทำอุปกรณ์สูญหาย เปลี่ยนเครื่องใหม่ หรือไม่สามารถเข้าถึงอุปกรณ์ที่ลงทะเบียนไว้ได้'
                : 'Rename or immediately revoke existing WebAuthn biometric keys if you lose access to a registered device or replace hardware.'}
            </p>
          </div>
        </div>

        {/* Top Action Buttons (44px+ Touch Targets) */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            id="register-new-webauthn-device-btn"
            onClick={() => setShowEnrollPanel((prev) => !prev)}
            className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-95 transition flex items-center gap-2 cursor-pointer shadow-2xs"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>
              {isThai ? 'ลงทะเบียนอุปกรณ์นี้เพิ่ม' : 'Register Current Device'}
            </span>
          </button>

          <button
            type="button"
            id="restore-default-webauthn-keys-btn"
            onClick={handleRestoreDefaults}
            title={
              isThai
                ? 'คืนค่ารายการคีย์อุปกรณ์เริ่มต้น'
                : 'Restore default registered passkeys'
            }
            className="min-h-[44px] px-3.5 rounded-xl border border-border bg-background hover:bg-card text-text/75 hover:text-text text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5 shrink-0" />
            <span>{isThai ? 'คืนค่าคีย์เริ่มต้น' : 'Restore Defaults'}</span>
          </button>
        </div>
      </div>

      {/* Optional New Device Registration Drawer */}
      {showEnrollPanel && (
        <form
          onSubmit={handleRegisterCurrentDevice}
          className="rounded-xl border border-primary/40 bg-primary/5 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-black text-primary">
              <ShieldCheck className="w-4 h-4" />
              <span>
                {isThai
                  ? 'ลงทะเบียนคีย์ WebAuthn / Passkey ใหม่สำหรับอุปกรณ์ปัจจุบัน'
                  : 'Enroll New WebAuthn Passkey for Current Device'}
              </span>
            </div>
            <span className="text-[11px] font-mono text-text/60">
              {capability?.platformSummary || 'WebAuthn Ready'}
            </span>
          </div>

          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="text"
              value={newDeviceCustomLabel}
              onChange={(e) => setNewDeviceCustomLabel(e.target.value)}
              placeholder={
                isThai
                  ? 'ตั้งชื่ออุปกรณ์ เช่น เครื่องแคชเชียร์หลัก (Touch ID)...'
                  : 'Custom device name (e.g., Main POS Terminal Touch ID)...'
              }
              className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-border bg-card text-xs sm:text-sm text-text focus:outline-hidden focus:ring-2 focus:ring-primary/50"
            />
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="submit"
                disabled={isRegisteringNew}
                className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-95 disabled:opacity-50 transition flex items-center gap-1.5 cursor-pointer"
              >
                <Fingerprint className="w-4 h-4" />
                <span>
                  {isRegisteringNew
                    ? isThai
                      ? 'กำลังลงทะเบียน...'
                      : 'Registering...'
                    : isThai
                      ? 'บันทึกและลงทะเบียนคีย์'
                      : 'Enroll Key Now'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setShowEnrollPanel(false)}
                className="min-h-[44px] px-3 rounded-xl border border-border bg-card text-xs font-bold text-text/70 hover:text-text cursor-pointer"
              >
                {isThai ? 'ปิด' : 'Cancel'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div
          className="inline-flex p-1 rounded-xl border border-border bg-background/60 self-start"
          role="group"
          aria-label="Filter registered devices scope"
        >
          <button
            type="button"
            onClick={() => setScopeFilter('all')}
            className={`min-h-[38px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              scopeFilter === 'all'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-text/65 hover:text-text'
            }`}
          >
            {isThai
              ? `อุปกรณ์ทั้งหมด (${passkeys.length})`
              : `All Terminal Devices (${passkeys.length})`}
          </button>
          <button
            type="button"
            onClick={() => setScopeFilter('mine')}
            className={`min-h-[38px] px-3.5 rounded-lg text-xs font-bold transition cursor-pointer ${
              scopeFilter === 'mine'
                ? 'bg-primary text-primary-foreground shadow-2xs'
                : 'text-text/65 hover:text-text'
            }`}
          >
            {isThai ? 'เฉพาะบัญชีของฉัน' : 'My Account Keys'}
          </button>
        </div>

        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-text/40 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              isThai
                ? 'ค้นหาชื่ออุปกรณ์, ชื่อพนักงาน, อีเมล หรือรหัสคีย์...'
                : 'Search device name, staff member, email, or key ID...'
            }
            className="w-full min-h-[42px] pl-9 pr-8 rounded-xl border border-border bg-background/70 text-xs text-text focus:outline-hidden focus:ring-2 focus:ring-primary/50"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text/40 hover:text-text cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Registered WebAuthn Keys List */}
      {filteredPasskeys.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center space-y-3 bg-background/30">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center mx-auto">
            <Fingerprint className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-text">
              {isThai
                ? 'ไม่พบคีย์อุปกรณ์ WebAuthn ที่ลงทะเบียน'
                : 'No Registered WebAuthn Devices Found'}
            </h3>
            <p className="text-xs text-text/60 max-w-md mx-auto">
              {isThai
                ? 'หากคุณเพิกถอนอุปกรณ์เดิมไปแล้ว สามารถกดปุ่ม "ลงทะเบียนอุปกรณ์นี้เพิ่ม" ด้านบนเพื่อผูกคีย์ใหม่ได้ทันที'
                : 'If you revoked a lost device, click "Register Current Device" above to enroll your current workstation.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredPasskeys.map((record) => {
            const authMeta = getAuthenticatorTypeMeta(record.authenticatorType);
            const AuthIcon = authMeta.icon;
            const isEditingThis = editingKeyId === record.id;
            const isRevokingThis = revokingKeyId === record.id;
            const isCurrentUsersKey =
              currentUser &&
              (record.userId === currentUser.id ||
                record.userEmail.toLowerCase() ===
                  currentUser.email.toLowerCase());
            const canModifyKey = Boolean(isCurrentUsersKey || isAdminOrManager);

            return (
              <div
                key={record.id}
                data-testid={`registered-device-card-${record.id}`}
                className={`rounded-2xl border transition-all p-4 sm:p-5 space-y-4 ${
                  isRevokingThis
                    ? 'border-rose-500/50 bg-rose-500/5'
                    : isEditingThis
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border bg-background/50 hover:border-border/90'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left: Device Identity & Telemetry */}
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/25 text-primary flex items-center justify-center shrink-0 mt-0.5">
                      <AuthIcon className="w-5 h-5" />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-black text-text break-words">
                          {record.deviceLabel}
                        </span>
                        <Badge variant="primary" size="xs" className="font-mono">
                          {authMeta.label}
                        </Badge>
                        {isCurrentUsersKey && (
                          <Badge variant="success" size="xs" className="font-mono">
                            {isThai ? 'อุปกรณ์ของคุณ' : 'YOUR KEY'}
                          </Badge>
                        )}
                      </div>

                      {/* Owner & Role Metadata */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text/70">
                        <span className="inline-flex items-center gap-1 font-semibold text-text/85">
                          <User className="w-3.5 h-3.5 text-primary" />
                          {record.userName} ({record.userEmail})
                        </span>
                        <span className="text-text/30">•</span>
                        <span className=" uppercase font-mono text-[11px] font-bold text-amber-600 dark:text-amber-400">
                          Role: {record.userRole}
                        </span>
                      </div>

                      {/* Cryptographic Key ID, Counter & Timestamps */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono text-text/55">
                        <span className="inline-flex items-center gap-1">
                          <Hash className="w-3 h-3 text-text/40" />
                          ID: {record.id.length > 28 ? `${record.id.slice(0, 24)}...` : record.id}
                        </span>
                        <span>SignCount: #{record.counter || 1}</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 text-text/40" />
                          {isThai ? 'ใช้งานล่าสุด:' : 'Last used:'}{' '}
                          {record.lastUsedAt
                            ? new Date(record.lastUsedAt).toLocaleString()
                            : new Date(record.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Rename & Revoke Actions (44px+ Touch Targets) */}
                  <div className="flex flex-wrap items-center gap-2 shrink-0 self-end lg:self-center">
                    <button
                      type="button"
                      disabled={!canModifyKey}
                      onClick={() => handleStartRename(record)}
                      className="min-h-[44px] px-3.5 rounded-xl border border-border bg-card hover:bg-background text-xs font-bold text-text flex items-center gap-1.5 transition cursor-pointer disabled:opacity-40"
                    >
                      <Pencil className="w-3.5 h-3.5 text-primary" />
                      <span>{isThai ? 'เปลี่ยนชื่อ (Rename)' : 'Rename'}</span>
                    </button>

                    <button
                      type="button"
                      disabled={!canModifyKey}
                      onClick={() => {
                        setEditingKeyId(null);
                        setRevokingKeyId(isRevokingThis ? null : record.id);
                        setRevokeReason('lost_device');
                      }}
                      className="min-h-[44px] px-3.5 rounded-xl border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-bold flex items-center gap-1.5 transition cursor-pointer disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        {isThai ? 'เพิกถอนคีย์ (Revoke)' : 'Revoke Key'}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Inline Rename Editor */}
                {isEditingThis && (
                  <div className="rounded-xl border border-primary/40 bg-card p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor={`rename-input-${record.id}`}
                        className="text-xs font-bold text-text flex items-center gap-1.5"
                      >
                        <Pencil className="w-3.5 h-3.5 text-primary" />
                        <span>
                          {isThai
                            ? 'กำหนดชื่อเรียกอุปกรณ์ WebAuthn ใหม่'
                            : 'Rename Registered WebAuthn Device'}
                        </span>
                      </label>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2.5">
                      <input
                        id={`rename-input-${record.id}`}
                        type="text"
                        value={editingLabel}
                        onChange={(e) => setEditingLabel(e.target.value)}
                        placeholder={
                          isThai
                            ? 'ระบุชื่ออุปกรณ์ที่จดจำง่าย...'
                            : 'Enter a descriptive device label...'
                        }
                        className="flex-1 min-h-[44px] px-3.5 rounded-xl border border-border bg-background text-xs sm:text-sm text-text focus:outline-hidden focus:ring-2 focus:ring-primary/50"
                      />

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleConfirmRename(record)}
                          className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-95 transition flex items-center gap-1.5 cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                          <span>{isThai ? 'บันทึกชื่อใหม่' : 'Save Name'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingKeyId(null);
                            setEditingLabel('');
                          }}
                          className="min-h-[44px] px-3.5 rounded-xl border border-border bg-background text-xs font-bold text-text/70 hover:text-text cursor-pointer"
                        >
                          {isThai ? 'ยกเลิก' : 'Cancel'}
                        </button>
                      </div>
                    </div>

                    {/* Quick Preset Name Chips */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[11px] text-text/50 mr-1">
                        {isThai ? 'ชื่อแนะนำ:' : 'Suggestions:'}
                      </span>
                      {QUICK_DEVICE_NAME_PRESETS.map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setEditingLabel(preset)}
                          className="px-2.5 py-1 rounded-lg border border-border bg-background hover:border-primary/40 text-[11px] font-medium text-text/75 hover:text-primary cursor-pointer"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Inline Revoke Confirmation Guard (Lost Access to Device Workflow) */}
                {isRevokingThis && (
                  <div
                    role="alertdialog"
                    aria-label="Confirm WebAuthn Key Revocation"
                    className="rounded-xl border border-rose-500/50 bg-card p-4 space-y-3"
                  >
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <h4 className="text-xs font-black text-rose-600 dark:text-rose-400">
                          {isThai
                            ? `ยืนยันการเพิกถอนคีย์ "${record.deviceLabel}" ถาวรหรือไม่?`
                            : `Revoke WebAuthn Key "${record.deviceLabel}"?`}
                        </h4>
                        <p className="text-xs text-text/70">
                          {isThai
                            ? 'เมื่อเพิกถอนแล้ว อุปกรณ์ที่สูญหายหรือเลิกใช้งานจะไม่สามารถสแกนลายนิ้วมือ/ใบหน้าเพื่อเข้าสู่ระบบหรือปลดล็อกหน้าจอ POS ได้อีกต่อไป'
                            : 'Once revoked, this lost or replaced device will immediately lose biometric sign-in and terminal unlock privileges.'}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {(
                        [
                          {
                            id: 'lost_device',
                            labelTh: 'ทำอุปกรณ์สูญหาย / เข้าถึงไม่ได้',
                            labelEn: 'Lost Access to Device',
                          },
                          {
                            id: 'replaced',
                            labelTh: 'เปลี่ยนเครื่องใหม่ / เลิกใช้',
                            labelEn: 'Replaced / Upgraded Device',
                          },
                          {
                            id: 'compromised',
                            labelTh: 'สงสัยว่าคีย์ไม่ปลอดภัย',
                            labelEn: 'Suspected Compromise',
                          },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setRevokeReason(opt.id)}
                          className={`min-h-[40px] px-3 py-2 rounded-xl border text-left text-xs font-bold transition cursor-pointer flex items-center justify-between ${
                            revokeReason === opt.id
                              ? 'border-rose-500 bg-rose-500/15 text-rose-600 dark:text-rose-300'
                              : 'border-border bg-background text-text/70 hover:text-text'
                          }`}
                        >
                          <span>{isThai ? opt.labelTh : opt.labelEn}</span>
                          {revokeReason === opt.id && (
                            <Check className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                          )}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setRevokingKeyId(null)}
                        className="min-h-[44px] px-4 rounded-xl border border-border bg-background text-xs font-bold text-text/75 hover:text-text cursor-pointer"
                      >
                        {isThai ? 'ยกเลิก' : 'Keep Key'}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleConfirmRevoke(record)}
                        className="min-h-[44px] px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        <ShieldAlert className="w-4 h-4" />
                        <span>
                          {isThai
                            ? 'ยืนยันเพิกถอนคีย์ทันที (Confirm Revoke)'
                            : 'Confirm Revoke Key'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
