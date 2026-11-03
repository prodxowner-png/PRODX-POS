/**
 * PRODX POS — Admin Security Tab & System Owner 'Change Admin Password' Vault
 *
 * Provides a dedicated 'Admin Security' workspace inside SettingsScreen.tsx featuring:
 * Legacy reset controls remain visible for diagnosis but are fail-closed until a server-authoritative PostgreSQL reset endpoint exists.
 * Browser hashing is display-only and is not authentication evidence.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Fingerprint,
  Sparkles,
  CheckCircle2,
  Database,
  RefreshCw,
  Cpu,
  FileKey2,
  Copy,
  Check,
} from 'lucide-react';
import {
  SYSTEM_OWNER_ADMIN_EMAIL,
  SYSTEM_OWNER_ADMIN_ID,
  isVerifiedSystemOwner,
} from '../../../domain/auth';
import { useAuth } from '../../../context/AuthContext';
import { useLanguage } from '../../../context/LanguageContext';
import { useToast } from '../../../context/ToastContext';
import { analyzePassword } from '../../../utils/passwordSecurity';
import { PasswordStrengthMeter } from '../../../components/auth/PasswordStrengthMeter';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';
import { GraphicIcon } from '../../../components/common/GraphicIcon';
import {
  verifySystemOwnerReauthentication,
  performCryptographicHashAndEncryptionCheck,
  fetchSystemOwnerCredentialStatusFromDatabase,
  AdminCredentialDatabaseStatus,
  ResetSystemOwnerPasswordResult,
} from '../../../services/adminCredentialService';
import { authenticatePasskey } from '../../../services/webauthnService';
import { ManageRegisteredDevicesSection } from './ManageRegisteredDevicesSection';

export interface AdminSecuritySettingsTabProps {
  onChangeAdminPassword: (params: {
    currentPassword?: string;
    biometricVerified?: boolean;
    newPassword: string;
  }) => Promise<ResetSystemOwnerPasswordResult>;
  onOpenResetModal?: () => void;
}

export const AdminSecuritySettingsTab: React.FC<AdminSecuritySettingsTabProps> = ({
  onChangeAdminPassword,
  onOpenResetModal,
}) => {
  const { session, issueWebAuthnChallenge, verifyWebAuthnChallengeResponse } = useAuth();
  const { language } = useLanguage();
  const { addToast } = useToast();
  const isThai = language === 'th';

  const currentUser = session?.currentUser;
  const isOwner = isVerifiedSystemOwner(currentUser);

  // Database Credential Record Telemetry
  const [dbStatus, setDbStatus] = useState<AdminCredentialDatabaseStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);

  // Step 1: Mandatory Re-Authentication State
  const [currentPassword, setCurrentPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [isReauthenticated, setIsReauthenticated] = useState(false);
  const [reauthMethod, setReauthMethod] = useState<'password' | 'webauthn_biometric'>('password');
  const [reauthenticatedAt, setReauthenticatedAt] = useState<number | null>(null);
  const [isVerifyingReauth, setIsVerifyingReauth] = useState(false);

  // Step 2: Change Admin Password & Cryptographic Hashing Check State
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [previewSalt, setPreviewSalt] = useState<string>(() =>
    `salt-${Date.now().toString(36)}-owner`,
  );
  const [cryptoPreview, setCryptoPreview] = useState<{
    valid: boolean;
    digestHex: string;
    algorithm: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastUpdateReceipt, setLastUpdateReceipt] = useState<ResetSystemOwnerPasswordResult | null>(
    null,
  );
  const [copiedHash, setCopiedHash] = useState(false);

  const loadCredentialStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    try {
      const status = await fetchSystemOwnerCredentialStatusFromDatabase();
      setDbStatus(status);
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    void loadCredentialStatus();
  }, [loadCredentialStatus]);

  // Live Cryptographic Hashing & Encryption Check Preview whenever newPassword changes
  useEffect(() => {
    let active = true;
    const trimmed = newPassword.trim();
    if (!trimmed) {
      setCryptoPreview(null);
      return;
    }
    performCryptographicHashAndEncryptionCheck(trimmed, previewSalt).then((res) => {
      if (active) {
        setCryptoPreview(res);
      }
    });
    return () => {
      active = false;
    };
  }, [newPassword, previewSalt]);

  const analysis = analyzePassword(newPassword, {
    email: SYSTEM_OWNER_ADMIN_EMAIL,
    name: currentUser?.name || 'Kamkokaew Thodsawat',
  });
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  // Step 1A: Verify Current Password Re-Authentication
  const handleVerifyCurrentPassword = async () => {
    if (!currentPassword.trim()) {
      setErrorMessage(
        isThai
          ? 'กรุณากรอกรหัสผ่านผู้ดูแลระบบปัจจุบันเพื่อยืนยันตัวตน (Re-authentication)'
          : 'Please enter your current administrator password to re-authenticate.',
      );
      return;
    }

    setIsVerifyingReauth(true);
    setErrorMessage(null);
    try {
      const result = await verifySystemOwnerReauthentication({
        user: currentUser,
        currentPassword: currentPassword.trim(),
      });

      if (!result.verified) {
        setIsReauthenticated(false);
        setErrorMessage(
          result.error ||
            (isThai
              ? 'การยืนยันตัวตนไม่สำเร็จ: รหัสผ่านผู้ดูแลระบบปัจจุบันไม่ถูกต้อง'
              : 'Re-authentication failed: Current administrator password is incorrect.'),
        );
        return;
      }

      setIsReauthenticated(true);
      setReauthMethod('password');
      setReauthenticatedAt(Date.now());
      addToast({
        title: isThai ? 'ยืนยันตัวตนผู้ดูแลระบบสำเร็จ' : 'Admin Re-Authentication Verified',
        message: isThai
          ? 'ตรวจสอบแฮชรหัสผ่านปัจจุบันสำเร็จ คุณสามารถตั้งรหัสผ่านใหม่ได้ทันที'
          : 'Current password hash verified. You can now change the admin password.',
        type: 'success',
      });
    } finally {
      setIsVerifyingReauth(false);
    }
  };

  // Step 1B: Verify WebAuthn Biometric Re-Authentication
  const handleBiometricReauth = async () => {
    if (!isOwner || !currentUser) {
      setErrorMessage(
        isThai
          ? `อนุญาตเฉพาะเจ้าของระบบ (${SYSTEM_OWNER_ADMIN_EMAIL}) เท่านั้น`
          : `Restricted strictly to System Owner (${SYSTEM_OWNER_ADMIN_EMAIL}).`,
      );
      return;
    }

    setIsVerifyingReauth(true);
    setErrorMessage(null);
    try {
      const challenge = issueWebAuthnChallenge({
        id: currentUser.id,
        email: currentUser.email,
      });
      const authResult = await authenticatePasskey(
        {
          id: currentUser.id,
          email: currentUser.email,
          name: currentUser.name,
        },
        challenge,
      );
      if (!authResult.success || !authResult.assertion) {
        throw new Error(
          authResult.error ||
            (isThai
              ? 'การสแกนลายนิ้วมือหรือใบหน้าไม่สำเร็จ'
              : 'Biometric re-authentication failed.'),
        );
      }

      const verification = await verifyWebAuthnChallengeResponse(
        authResult.assertion,
        currentUser.email,
      );
      if (!verification.verified) {
        throw new Error(
          verification.error ||
            (isThai
              ? 'การตรวจสอบ Challenge-Response ไม่ผ่าน'
              : 'WebAuthn challenge-response verification failed.'),
        );
      }

      setIsReauthenticated(true);
      setReauthMethod('webauthn_biometric');
      setReauthenticatedAt(Date.now());
      addToast({
        title: isThai ? 'ยืนยันตัวตนชีวมิติสำเร็จ' : 'Biometric Re-Authentication Verified',
        message: isThai
          ? 'ตรวจสอบสิทธิ์เจ้าของระบบด้วย WebAuthn สำเร็จ'
          : 'System owner re-authenticated via WebAuthn challenge-response.',
        type: 'success',
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsVerifyingReauth(false);
    }
  };

  const handleGenerateStrongPassword = () => {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%^&*&_+=';
    let generated =
      upper[Math.floor(Math.random() * upper.length)] +
      lower[Math.floor(Math.random() * lower.length)] +
      digits[Math.floor(Math.random() * digits.length)] +
      symbols[Math.floor(Math.random() * symbols.length)];
    const all = upper + lower + digits + symbols;
    for (let i = 0; i < 10; i++) {
      generated += all[Math.floor(Math.random() * all.length)];
    }
    const shuffled = generated
      .split('')
      .sort(() => 0.5 - Math.random())
      .join('');
    setNewPassword(shuffled);
    setConfirmPassword(shuffled);
    setShowNewPassword(true);
    setShowConfirmPassword(true);
    setPreviewSalt(`salt-${Date.now().toString(36)}-owner`);
    navigator.clipboard?.writeText(shuffled).catch(() => {});
  };

  const handleSubmitChangeAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!isOwner) {
      setErrorMessage(
        isThai
          ? `ปฏิเสธการเข้าถึง: ต้องเข้าสู่ระบบด้วยบัญชีเจ้าของระบบ (${SYSTEM_OWNER_ADMIN_EMAIL}) เท่านั้น`
          : `Access Denied: You must be signed in as the System Owner (${SYSTEM_OWNER_ADMIN_EMAIL}).`,
      );
      return;
    }

    if (!isReauthenticated && !currentPassword.trim()) {
      setErrorMessage(
        isThai
          ? 'กรุณายืนยันตัวตนซ้ำ (Re-authenticate) ในขั้นตอนที่ 1 ก่อนเปลี่ยนรหัสผ่านผู้ดูแลระบบ'
          : 'Please complete Step 1 Re-Authentication before changing the admin password.',
      );
      return;
    }

    if (!analysis.isPolicyCompliant) {
      setErrorMessage(
        isThai
          ? 'รหัสผ่านใหม่ยังไม่ผ่านเกณฑ์ความปลอดภัยขั้นต่ำขององค์กร'
          : 'New password does not meet enterprise security policy requirements.',
      );
      return;
    }

    if (!passwordsMatch) {
      setErrorMessage(
        isThai
          ? 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน'
          : 'New password and confirmation password do not match.',
      );
      return;
    }

    setIsSubmitting(true);
    try {
      // Perform explicit pre-commit cryptographic hashing & encryption check
      const cryptoCheck = await performCryptographicHashAndEncryptionCheck(
        newPassword.trim(),
        previewSalt,
      );
      if (!cryptoCheck.valid) {
        setErrorMessage(
          isThai
            ? 'การตรวจสอบการเข้ารหัสและแฮช (Hashing/Encryption Check) ไม่ผ่าน'
            : 'Cryptographic hashing/encryption check failed.',
        );
        return;
      }

      const result = await onChangeAdminPassword({
        currentPassword: currentPassword.trim() || undefined,
        biometricVerified: reauthMethod === 'webauthn_biometric' && isReauthenticated,
        newPassword: newPassword.trim(),
      });

      if (!result.success) {
        setErrorMessage(
          result.error ||
            (isThai
              ? 'ไม่สามารถเปลี่ยนรหัสผ่านผู้ดูแลระบบในฐานข้อมูลได้'
              : 'Failed to update admin credentials in the database.'),
        );
        return;
      }

      setLastUpdateReceipt(result);
      setNewPassword('');
      setConfirmPassword('');
      setCurrentPassword('');
      await loadCredentialStatus();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyHash = (hash: string) => {
    navigator.clipboard?.writeText(hash).catch(() => {});
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-text">
        <strong>{isThai ? 'รีเซ็ตรหัสผ่านถูกปิดชั่วคราวเพื่อความปลอดภัย' : 'Administrator credential reset is disabled for security.'}</strong>{' '}
        {isThai ? 'ยังไม่มี API ฝั่งเซิร์ฟเวอร์ที่ตรวจสอบรหัสผ่านและบันทึก credential กับ audit ใน PostgreSQL transaction เดียวกัน จึงไม่มีการแก้ credential จากเบราว์เซอร์' : 'A server endpoint that verifies the current password and atomically commits the credential update with its audit record is not wired yet. Browser-side credential writes are disabled.'}
      </div>
      {/* Top Identity & Cryptographic Vault Header Card */}
      <div className="bg-card border border-border border-crisp rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-border/60">
          <div className="flex items-start sm:items-center gap-3.5">
            <GraphicIcon icon={KeyRound} color="amber" variant="glow" size="md" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-text">
                  {isThai
                    ? 'ความปลอดภัยผู้ดูแลระบบและรหัสผ่านเจ้าของระบบ (Admin Security Vault)'
                    : 'Admin Security & System Owner Credential Vault'}
                </h2>
                <Badge variant={isOwner ? 'success' : 'warning'} size="xs" className="font-mono">
                  {isOwner ? 'VERIFIED SYSTEM OWNER' : 'OWNER VERIFICATION REQUIRED'}
                </Badge>
              </div>
              <p className="text-xs text-text/65 mt-1">
                {isThai
                  ? 'เปลี่ยนรหัสผ่านผู้ดูแลระบบหลัก (Change Admin Password) โดยบังคับยืนยันตัวตนซ้ำ (Re-authentication) ตรวจสอบการเข้ารหัส PBKDF2/SHA-256 และอัปเดตข้อมูลเจ้าของระบบลงในฐานข้อมูล Firestore'
                  : 'Change the primary administrator password with mandatory re-authentication, PBKDF2/SHA-256 cryptographic hashing verification, and live database synchronization.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadCredentialStatus}
              disabled={isLoadingStatus}
              leftIcon={
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingStatus ? 'animate-spin' : ''}`} />
              }
              className="min-h-[40px] px-3 text-xs font-bold cursor-pointer"
            >
              {isThai ? 'รีเฟรชสถานะฐานข้อมูล' : 'Refresh DB Status'}
            </Button>

            {onOpenResetModal && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onOpenResetModal}
                disabled={true}
                leftIcon={<KeyRound className="w-3.5 h-3.5 text-amber-500" />}
                className="min-h-[40px] px-3 text-xs font-bold border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 cursor-pointer"
              >
                {isThai ? 'เปิดในหน้าต่างป๊อปอัป' : 'Open Quick Reset Modal'}
              </Button>
            )}
          </div>
        </div>

        {/* Live Database Credential Telemetry Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="p-3.5 rounded-xl bg-background/70 border border-border/70 space-y-1">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-text/50">
              <span>{isThai ? 'บัญชีเจ้าของระบบ (Hardcoded Owner)' : 'Hardcoded System Owner'}</span>
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <div className="text-xs font-mono font-bold text-text truncate">
              {SYSTEM_OWNER_ADMIN_EMAIL}
            </div>
            <div className="text-[11px] font-mono text-text/50">ID: {SYSTEM_OWNER_ADMIN_ID}</div>
          </div>

          <div className="p-3.5 rounded-xl bg-background/70 border border-border/70 space-y-1">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-text/50">
              <span>{isThai ? 'อัลกอริทึมการเข้ารหัส/แฮช' : 'Hashing / Encryption Spec'}</span>
              <Cpu className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="text-xs font-mono font-bold text-primary truncate">
              {dbStatus?.hashAlgorithm || 'Server-managed; client hashing disabled'}
            </div>
            <div className="text-[11px] font-mono text-text/50 truncate">
              Salt: {dbStatus?.passwordSalt || (dbStatus?.source === 'unconfigured' ? (isThai ? 'ยังไม่ได้ตั้งค่า' : 'Not configured') : '—')}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-background/70 border border-border/70 space-y-1">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-text/50">
              <span>{isThai ? 'แฮชรหัสผ่านในฐานข้อมูล' : 'Database Credential Hash'}</span>
              <FileKey2 className="w-3.5 h-3.5 text-amber-500" />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono font-bold text-text truncate">
                {dbStatus?.passwordHash
                  ? `${dbStatus.passwordHash.slice(0, 18)}...${dbStatus.passwordHash.slice(-6)}`
                  : dbStatus?.source === 'unconfigured' ? (isThai ? 'ยังไม่ได้ตั้งค่า' : 'Not configured') : 'Unavailable'}
              </span>
              {dbStatus?.passwordHash && (
                <button
                  type="button"
                  onClick={() => handleCopyHash(dbStatus.passwordHash)}
                  title={isThai ? 'คัดลอกค่าแฮช SHA-256' : 'Copy full SHA-256 hash'}
                  className="p-1 rounded hover:bg-card text-text/50 hover:text-text cursor-pointer"
                >
                  {copiedHash ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
            <div className="text-[11px] font-mono text-text/50">
              256-bit (64 hex chars) • v{dbStatus?.version || 1}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-background/70 border border-border/70 space-y-1">
            <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-text/50">
              <span>{isThai ? 'แหล่งข้อมูลฐานข้อมูล' : 'Database Storage Target'}</span>
              <Database className="w-3.5 h-3.5 text-emerald-500" />
            </div>
            <div className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400 truncate">
              {isThai ? 'ปิดใช้งาน — รอ API ฝั่งเซิร์ฟเวอร์' : 'Disabled — awaiting server API'}
            </div>
            <div className="text-[11px] text-text/50 truncate">
              {dbStatus?.updatedAt
                ? `${isThai ? 'อัปเดตล่าสุด:' : 'Updated:'} ${new Date(dbStatus.updatedAt).toLocaleTimeString()}`
                : isThai
                  ? 'พร้อมซิงค์ข้อมูล'
                  : dbStatus?.source === 'unconfigured'
                    ? isThai ? 'ยังไม่ได้ตั้งค่า' : 'Not configured'
                    : isThai ? 'พร้อมซิงค์ข้อมูล' : 'Ready for sync'}
            </div>
          </div>
        </div>
      </div>

      {/* Main Change Admin Password Form Card */}
      <form
        id="admin-security-change-password-form"
        onSubmit={handleSubmitChangeAdminPassword}
        className="bg-card border border-border border-crisp rounded-2xl p-5 sm:p-6 shadow-xs space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-border/60">
          <div>
            <h3 className="text-sm sm:text-base font-black text-text flex items-center gap-2">
              <Lock className="w-4 h-4 text-amber-500" />
              <span>
                {isThai
                  ? 'เปลี่ยนรหัสผ่านผู้ดูแลระบบ (Change Admin Password)'
                  : 'Change Admin Password (System Owner Re-Authentication)'}
              </span>
            </h3>
            <p className="text-xs text-text/60 mt-0.5">
              {isThai
                ? 'ดำเนินการ 2 ขั้นตอน: (1) ยืนยันตัวตนซ้ำด้วยรหัสผ่านเดิมหรือสแกนลายนิ้วมือ/ใบหน้า และ (2) ตรวจสอบแฮชและบันทึกรหัสผ่านใหม่ลงฐานข้อมูล'
                : 'Complete the 2-step security flow: (1) Re-authenticate as System Owner, and (2) Verify cryptographic hash & update database credentials.'}
            </p>
          </div>
          <Badge
            variant={isReauthenticated ? 'success' : 'warning'}
            size="sm"
            className="font-mono self-start sm:self-center"
          >
            {isReauthenticated
              ? reauthMethod === 'webauthn_biometric'
                ? 'STEP 1 PASSED: WEBAUTHN VERIFIED'
                : 'STEP 1 PASSED: PASSWORD VERIFIED'
              : 'STEP 1 REQUIRED: RE-AUTHENTICATE'}
          </Badge>
        </div>

        {/* Step 1: Mandatory Re-Authentication Section */}
        <div className="rounded-2xl border border-border bg-background/40 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-600 dark:text-amber-400 text-xs font-black flex items-center justify-center">
                1
              </span>
              <span className="text-xs sm:text-sm font-bold text-text">
                {isThai
                  ? 'การยืนยันตัวตนซ้ำก่อนเปลี่ยนรหัสผ่าน (Mandatory Re-Authentication)'
                  : 'Step 1: Mandatory System Owner Re-Authentication'}
              </span>
            </div>

            {isReauthenticated && reauthenticatedAt && (
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                {isThai ? 'ยืนยันตัวตนสำเร็จเมื่อ' : 'Verified at'}{' '}
                {new Date(reauthenticatedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3 items-end">
            <div className="space-y-1.5">
              <label
                htmlFor="admin-security-current-password"
                className="block text-xs font-semibold text-text/80"
              >
                {isThai
                  ? 'รหัสผ่านผู้ดูแลระบบปัจจุบัน (Current Admin Password)'
                  : 'Current Administrator Password'}
              </label>
              <div className="relative">
                <input
                  id="admin-security-current-password"
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    if (isReauthenticated && reauthMethod === 'password') {
                      setIsReauthenticated(false);
                    }
                  }}
                  disabled={!isOwner}
                  placeholder={
                    isThai
                      ? 'กรอกรหัสผ่านผู้ดูแลระบบปัจจุบันเพื่อตรวจสอบแฮช...'
                      : 'Enter current admin password to verify...'
                  }
                  className="w-full min-h-[44px] pl-3.5 pr-11 rounded-xl border border-border bg-card text-sm text-text focus:outline-hidden focus:ring-2 focus:ring-primary/50"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword((v) => !v)}
                  aria-label={showCurrentPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] flex items-center justify-center text-text/50 hover:text-text cursor-pointer"
                >
                  {showCurrentPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="button"
              id="admin-security-verify-reauth-btn"
              onClick={handleVerifyCurrentPassword}
              disabled={!isOwner || isVerifyingReauth}
              className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:opacity-95 disabled:opacity-50 transition flex items-center justify-center gap-2 cursor-pointer shrink-0"
            >
              <Unlock className="w-4 h-4" />
              <span>{isThai ? 'ตรวจสอบรหัสผ่านเดิม' : 'Verify Current Password'}</span>
            </button>

            <button
              type="button"
              id="admin-security-biometric-reauth-btn"
              onClick={handleBiometricReauth}
              disabled={!isOwner || isVerifyingReauth}
              className="min-h-[44px] px-4 rounded-xl border border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 disabled:opacity-50 text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shrink-0"
            >
              <Fingerprint className="w-4 h-4" />
              <span>{isThai ? 'ยืนยันด้วย WebAuthn Biometrics' : 'Re-Auth with Biometrics'}</span>
            </button>
          </div>
        </div>

        {/* Step 2: New Admin Password & Cryptographic Hashing Verification */}
        <div className="rounded-2xl border border-border bg-background/40 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-primary/15 border border-primary/40 text-primary text-xs font-black flex items-center justify-center">
                2
              </span>
              <span className="text-xs sm:text-sm font-bold text-text">
                {isThai
                  ? 'ตั้งรหัสผ่านผู้ดูแลระบบใหม่และตรวจสอบการเข้ารหัส (New Password & Cryptographic Check)'
                  : 'Step 2: New Admin Password & Cryptographic Hashing Check'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleGenerateStrongPassword}
                disabled={!isOwner}
                className="min-h-[36px] px-3 rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/15 text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{isThai ? 'สุ่มรหัสผ่านปลอดภัยสูง' : 'Generate Strong Password'}</span>
              </button>

            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="admin-security-new-password"
                className="block text-xs font-semibold text-text/80"
              >
                {isThai ? 'รหัสผ่านผู้ดูแลระบบใหม่ (New Admin Password)' : 'New Admin Password'}
              </label>
              <div className="relative">
                <input
                  id="admin-security-new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  disabled={!isOwner}
                  placeholder={isThai ? 'อย่างน้อย 8 ตัวอักษร (A-Z, a-z, 0-9, สัญลักษณ์)' : 'Min 8+ chars (A-Z, a-z, 0-9, symbol)'}
                  className="w-full min-h-[44px] pl-3.5 pr-11 rounded-xl border border-border bg-card text-sm text-text focus:outline-hidden focus:ring-2 focus:ring-primary/50"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((v) => !v)}
                  aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] flex items-center justify-center text-text/50 hover:text-text cursor-pointer"
                >
                  {showNewPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="admin-security-confirm-password"
                className="block text-xs font-semibold text-text/80"
              >
                {isThai
                  ? 'ยืนยันรหัสผ่านผู้ดูแลระบบใหม่ (Confirm New Password)'
                  : 'Confirm New Admin Password'}
              </label>
              <div className="relative">
                <input
                  id="admin-security-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={!isOwner}
                  placeholder={isThai ? 'กรอกรหัสผ่านใหม่อีกครั้งให้ตรงกัน' : 'Re-enter new admin password'}
                  className="w-full min-h-[44px] pl-3.5 pr-11 rounded-xl border border-border bg-card text-sm text-text focus:outline-hidden focus:ring-2 focus:ring-primary/50"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[36px] min-h-[36px] flex items-center justify-center text-text/50 hover:text-text cursor-pointer"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <PasswordStrengthMeter analysis={analysis} language={language} />

          {/* Live Cryptographic Hashing & Encryption Verification Panel */}
          <div className="rounded-xl border border-border/80 bg-card p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-text flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-primary" />
                {isThai
                  ? 'ผลการตรวจสอบการแฮชและเข้ารหัส (Live Cryptographic Hashing & Encryption Check)'
                  : 'Live Cryptographic Hashing & Encryption Verification'}
              </span>
              <Badge
                variant={cryptoPreview?.valid ? 'success' : 'neutral'}
                size="xs"
                className="font-mono"
              >
                {cryptoPreview?.valid ? 'HASH & PBKDF2 VERIFIED' : 'AWAITING INPUT'}
              </Badge>
            </div>

            {cryptoPreview ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="p-2 rounded-lg bg-background border border-border/60 truncate">
                  <span className="text-text/50">Algorithm: </span>
                  <span className="text-primary font-bold">{cryptoPreview.algorithm}</span>
                </div>
                <div className="p-2 rounded-lg bg-background border border-border/60 truncate">
                  <span className="text-text/50">Salt: </span>
                  <span className="text-text font-bold">{previewSalt}</span>
                </div>
                <div className="sm:col-span-2 p-2 rounded-lg bg-background border border-border/60 break-all">
                  <span className="text-text/50">Derived SHA-256 Digest: </span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                    {cryptoPreview.digestHex}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-text/50">
                {isThai
                  ? 'พิมพ์รหัสผ่านใหม่ด้านบนเพื่อจำลองและตรวจสอบค่าแฮช PBKDF2-HMAC-SHA256 ก่อนบันทึกลงฐานข้อมูล'
                  : 'Enter a new password above to run the real-time Web Crypto PBKDF2-HMAC-SHA256 & Salted SHA-256 integrity check.'}
              </p>
            )}
          </div>
        </div>

        {/* Error Banner */}
        {errorMessage && (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs font-semibold text-rose-600 dark:text-rose-300 flex items-start gap-2.5"
          >
            <ShieldAlert className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Last Successful Database Credential Update Receipt */}
        {lastUpdateReceipt?.success && (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-black text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>
                  {isThai
                    ? 'อัปเดตรหัสผ่านเจ้าของระบบลงในฐานข้อมูลเรียบร้อยแล้ว'
                    : 'Hardcoded System Owner Credentials Updated in Database'}
                </span>
              </div>
              <Badge variant="success" size="xs" className="font-mono">
                v{lastUpdateReceipt.version}
              </Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono text-text/80">
              <div>
                <span className="text-text/50">Owner Account: </span>
                <span className="font-bold">{SYSTEM_OWNER_ADMIN_EMAIL}</span>
              </div>
              <div>
                <span className="text-text/50">Re-Auth Method: </span>
                <span className="font-bold uppercase">{lastUpdateReceipt.reauthMethod}</span>
              </div>
              <div className="sm:col-span-2 truncate">
                <span className="text-text/50">Committed SHA-256 Hash: </span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {lastUpdateReceipt.passwordHash}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Submit Actions */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
          <div className="text-xs text-text/60 flex items-center gap-2">
            <Database className="w-4 h-4 text-primary shrink-0" />
            <span>
              {isThai
                ? 'ปิดใช้งานจนกว่าจะมี API ฝั่งเซิร์ฟเวอร์สำหรับบันทึก credential และ audit แบบ atomic'
                : 'Disabled. Credential changes require a server-authoritative PostgreSQL transaction and immutable audit record.'}
            </span>
          </div>

          <button
            type="submit"
            id="admin-security-submit-change-password-btn"
            disabled={true}
            className="min-h-[44px] px-6 rounded-xl bg-amber-500 text-slate-950 font-black text-xs hover:bg-amber-400 disabled:opacity-40 transition flex items-center justify-center gap-2 cursor-pointer shadow-sm"
          >
            <KeyRound className="w-4 h-4" />
            <span>
              {isSubmitting
                ? isThai
                  ? 'กำลังเข้ารหัสและอัปเดตฐานข้อมูล...'
                  : 'Hashing & Updating Database...'
                : isThai
                  ? 'เปลี่ยนรหัสผ่านผู้ดูแลระบบและบันทึกฐานข้อมูล'
                  : 'Change Admin Password & Update Database'}
            </span>
          </button>
        </div>
      </form>

      {/* Manage Registered Devices (WebAuthn / Passkeys) Section */}
      <ManageRegisteredDevicesSection />
    </div>
  );
};

