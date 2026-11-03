/**
 * PRODX POS — System Owner Admin Re-Authentication & Reset Password Modal
 *
 * Enforces mandatory re-authentication (current password or WebAuthn biometrics)
 * and verifies that the signed-in user is the System Owner ('kamkokaewthodsawat@gmail.com')
 * The legacy client-side reset path is disabled until a server-authoritative PostgreSQL endpoint is wired.
 */

import React, { useState } from 'react';
import {
  X,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Eye,
  EyeOff,
  Fingerprint,
  Sparkles,
  CheckCircle2,
  Database,
} from 'lucide-react';
import {
  SYSTEM_OWNER_ADMIN_EMAIL,
  isVerifiedSystemOwner,
  getPersistedAdminCredentialOverride,
} from '../../../domain/auth';
import { useAuth } from '../../../context/AuthContext';
import { useLanguage } from '../../../context/LanguageContext';
import { useToast } from '../../../context/ToastContext';
import { analyzePassword } from '../../../utils/passwordSecurity';
import { PasswordStrengthMeter } from '../../../components/auth/PasswordStrengthMeter';
import { verifySystemOwnerReauthentication, ResetSystemOwnerPasswordResult } from '../../../services/adminCredentialService';
import { authenticatePasskey } from '../../../services/webauthnService';

export interface AdminResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResetAdminPassword: (params: {
    currentPassword?: string;
    biometricVerified?: boolean;
    newPassword: string;
  }) => Promise<ResetSystemOwnerPasswordResult>;
}

export const AdminResetPasswordModal: React.FC<AdminResetPasswordModalProps> = ({
  isOpen,
  onClose,
  onResetAdminPassword,
}) => {
  const { session, issueWebAuthnChallenge, verifyWebAuthnChallengeResponse } = useAuth();
  const { language } = useLanguage();
  const { addToast } = useToast();
  const isThai = language === 'th';

  const [currentPassword, setCurrentPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [isReauthenticated, setIsReauthenticated] = useState(false);
  const [reauthMethod, setReauthMethod] = useState<'password' | 'webauthn_biometric'>('password');
  const [isVerifyingReauth, setIsVerifyingReauth] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentUser = session?.currentUser;
  const isOwner = isVerifiedSystemOwner(currentUser);
  const persistedOverride = getPersistedAdminCredentialOverride();

  const analysis = analyzePassword(newPassword, {
    email: SYSTEM_OWNER_ADMIN_EMAIL,
    name: currentUser?.name || 'Kamkokaew Thodsawat',
  });
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  const handleVerifyCurrentPassword = async () => {
    if (!currentPassword.trim()) {
      setErrorMessage(
        isThai
          ? 'กรุณากรอกรหัสผ่านผู้ดูแลระบบปัจจุบันเพื่อยืนยันตัวตนอีกครั้ง (Re-authentication)'
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
              ? 'ยืนยันตัวตนไม่สำเร็จ: รหัสผ่านผู้ดูแลระบบปัจจุบันไม่ถูกต้อง'
              : 'Re-authentication failed: Current administrator password is incorrect.'),
        );
        return;
      }

      setIsReauthenticated(true);
      setReauthMethod('password');
      addToast({
        title: isThai ? 'ยืนยันตัวตนเจ้าของระบบสำเร็จ' : 'System Owner Re-Authenticated',
        message: isThai
          ? 'ตรวจสอบสิทธิ์เรียบร้อยแล้ว คุณสามารถตั้งรหัสผ่านใหม่ได้ทันที'
          : 'Identity verified. You may now set and commit the new admin password.',
        type: 'success',
      });
    } finally {
      setIsVerifyingReauth(false);
    }
  };

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
      addToast({
        title: isThai ? 'ยืนยันตัวตนด้วยชีวมิติสำเร็จ' : 'Biometric Re-Authentication Verified',
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
    navigator.clipboard?.writeText(shuffled).catch(() => {});
  };

  const handleSubmit = async (e: React.FormEvent) => {
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
          ? 'กรุณายืนยันตัวตนอีกครั้ง (Re-authenticate) ด้วยรหัสผ่านปัจจุบันหรือสแกนลายนิ้วมือ/ใบหน้าก่อน'
          : 'Please complete re-authentication via current password or WebAuthn biometrics first.',
      );
      return;
    }

    if (!analysis.isPolicyCompliant) {
      setErrorMessage(
        isThai
          ? 'รหัสผ่านใหม่ยังไม่ผ่านเกณฑ์ความปลอดภัยขั้นต่ำ'
          : 'New password does not satisfy enterprise security policy criteria.',
      );
      return;
    }

    if (!passwordsMatch) {
      setErrorMessage(
        isThai
          ? 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน'
          : 'New password and confirmation do not match.',
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await onResetAdminPassword({
        currentPassword: currentPassword.trim() || undefined,
        biometricVerified: isReauthenticated && reauthMethod === 'webauthn_biometric',
        newPassword: newPassword.trim(),
      });

      if (!result.success) {
        setErrorMessage(
          result.error ||
            (isThai
              ? 'ไม่สามารถอัปเดตรหัสผ่านผู้ดูแลระบบได้'
              : 'Failed to reset system owner administrator password.'),
        );
        return;
      }

      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isThai ? 'รีเซ็ตรหัสผ่านผู้ดูแลระบบหลัก (System Owner)' : 'Reset System Owner Admin Password'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4 overflow-y-auto"
    >
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl overflow-hidden my-6">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border bg-background/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/25 text-primary flex items-center justify-center shrink-0">
              <KeyRound className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-text truncate">
                {isThai
                  ? 'รีเซ็ตรหัสผ่านผู้ดูแลระบบสูงสุด (System Owner)'
                  : 'Reset System Owner Admin Password'}
              </h2>
              <p className="text-[11px] text-text/60 truncate">
                {isThai
                  ? 'ปิดใช้งานชั่วคราวจนกว่าจะมี API ฝั่งเซิร์ฟเวอร์ที่ตรวจสอบสิทธิ์และบันทึกแบบ atomic'
                  : 'Disabled until server-side PostgreSQL verification and atomic audit persistence are wired'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] rounded-xl text-text/50 hover:text-text hover:bg-background flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* System Owner Identity Verification Banner */}
          <div
            className={`rounded-xl border p-3.5 flex items-center justify-between gap-3 ${
              isOwner
                ? 'border-emerald-500/35 bg-emerald-500/10'
                : 'border-rose-500/35 bg-rose-500/10'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {isOwner ? (
                <ShieldCheck className="w-5 h-5 text-emerald-500 shrink-0" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-rose-500 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="text-xs font-black text-text truncate">
                  {SYSTEM_OWNER_ADMIN_EMAIL}
                </div>
                <div className="text-[11px] text-text/65 truncate">
                  {isOwner
                    ? isThai
                      ? 'บัญชีนี้ผ่านการแสดงผลเท่านั้น ไม่ใช่หลักฐานยืนยันสิทธิ์ฝั่งเซิร์ฟเวอร์'
                      : 'Client identity display is not server-side authorization; reset remains disabled'
                    : isThai
                    ? 'บัญชีปัจจุบันไม่ใช่เจ้าของระบบ (สงวนสิทธิ์เฉพาะ kamkokaewthodsawat@gmail.com)'
                    : 'Current account is not the verified System Owner'}
                </div>
              </div>
            </div>

            <span
              className={`shrink-0 whitespace-nowrap text-[10px] font-mono font-black uppercase px-2 py-0.5 rounded-md ${
                isOwner
                  ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300'
                  : 'bg-rose-500/20 text-rose-600 dark:text-rose-300'
              }`}
            >
              {isOwner ? `OWNER v${persistedOverride?.version || 1}` : 'RESTRICTED'}
            </span>
          </div>

          {/* Step 1: Mandatory Re-Authentication */}
          <div className="rounded-xl border border-border bg-background/60 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-text flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-primary shrink-0" />
                {isThai
                  ? '1. ยืนยันตัวตนซ้ำ (Mandatory Re-Authentication)'
                  : '1. Mandatory Re-Authentication'}
              </span>
              {isReauthenticated && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 whitespace-nowrap">
                  <CheckCircle2 className="w-3 h-3" />
                  {reauthMethod === 'webauthn_biometric' ? 'BIOMETRIC VERIFIED' : 'VERIFIED'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1 min-w-0">
                <input
                  id="admin-reset-current-password"
                  type={showCurrentPassword ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => {
                    setCurrentPassword(e.target.value);
                    if (reauthMethod === 'password') setIsReauthenticated(false);
                    setErrorMessage(null);
                  }}
                  placeholder={
                    isThai
                      ? 'รหัสผ่านผู้ดูแลระบบปัจจุบัน'
                      : 'Enter current admin password'
                  }
                  className="w-full min-h-[44px] pl-3 pr-9 rounded-xl border border-border bg-card text-xs font-mono text-text outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text/50 hover:text-text cursor-pointer"
                >
                  {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <button
                type="button"
                disabled={isVerifyingReauth || !currentPassword.trim()}
                onClick={() => void handleVerifyCurrentPassword()}
                className="min-h-[44px] px-3.5 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary/90 disabled:opacity-40 transition-all cursor-pointer shrink-0 whitespace-nowrap"
              >
                {isThai ? 'ตรวจสอบรหัส' : 'Verify'}
              </button>
            </div>

            <button
              type="button"
              disabled={isVerifyingReauth || !isOwner}
              onClick={() => void handleBiometricReauth()}
              className="w-full min-h-[44px] px-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-40 whitespace-nowrap"
            >
              <Fingerprint className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {isThai
                  ? 'ยืนยันตัวตนซ้ำด้วยลายนิ้วมือ / ใบหน้า (WebAuthn Re-Auth)'
                  : 'Re-Authenticate with Fingerprint / Face ID (WebAuthn)'}
              </span>
            </button>
          </div>

          {/* Step 2: New Admin Password & Firestore Sync */}
          <div className="rounded-xl border border-border bg-background/60 p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-xs font-black uppercase tracking-wider text-text flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-primary shrink-0" />
                {isThai
                  ? '2. ตั้งรหัสผ่านผู้ดูแลระบบใหม่ (New Admin Password)'
                  : '2. New System Owner Password'}
              </span>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleGenerateStrongPassword}
                  className="min-h-[32px] px-2.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-[11px] font-bold flex items-center gap-1 transition-all cursor-pointer whitespace-nowrap"
                >
                  <Sparkles className="w-3 h-3 shrink-0" />
                  <span>{isThai ? 'สุ่มรหัสปลอดภัยสูง' : 'Generate Strong'}</span>
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="relative">
                <input
                  id="admin-reset-new-password"
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    setErrorMessage(null);
                  }}
                  placeholder={isThai ? 'รหัสผ่านผู้ดูแลระบบใหม่...' : 'Enter new admin password...'}
                  className="w-full min-h-[44px] pl-3 pr-9 rounded-xl border border-border bg-card text-xs font-mono text-text outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text/50 hover:text-text cursor-pointer"
                >
                  {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <div className="relative">
                <input
                  id="admin-reset-confirm-password"
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setErrorMessage(null);
                  }}
                  placeholder={
                    isThai ? 'ยืนยันรหัสผ่านผู้ดูแลระบบใหม่...' : 'Confirm new admin password...'
                  }
                  className="w-full min-h-[44px] pl-3 pr-9 rounded-xl border border-border bg-card text-xs font-mono text-text outline-none focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text/50 hover:text-text cursor-pointer"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {newPassword.length > 0 && <PasswordStrengthMeter analysis={analysis} language={isThai ? 'th' : 'en'} />}
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 flex items-start gap-2 text-xs font-semibold text-rose-600 dark:text-rose-300"
            >
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 rounded-xl border border-border bg-background hover:bg-card text-xs font-bold text-text/75 transition-all cursor-pointer whitespace-nowrap"
            >
              {isThai ? 'ยกเลิก' : 'Cancel'}
            </button>

            <button
              type="submit"
              disabled={isSubmitting || !isOwner || !analysis.isPolicyCompliant || !passwordsMatch}
              className="min-h-[44px] px-5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-black flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <KeyRound className="w-4 h-4 shrink-0" />
              <span className="truncate">
                {isSubmitting
                  ? isThai
                    ? 'กำลังอัปเดตฐานข้อมูล...'
                    : 'Updating Database...'
                  : isThai
                  ? 'ยืนยันและอัปเดตรหัสผ่าน Admin'
                  : 'Re-Authenticate & Update Admin Password'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
