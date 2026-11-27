import React, { useState } from 'react';
import {
  X,
  Lock,
  KeyRound,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Copy,
  Check,
  UserCheck,
  Save,
} from 'lucide-react';
import {
  User,
  getStoredStaffDirectory,
  getStoredStaffPasswords,
  updateStaffPassword,
  getStoredStaffPins,
} from '../../domain/auth';
import { analyzePassword } from '../../utils/passwordSecurity';
import { PasswordStrengthMeter } from './PasswordStrengthMeter';
import { useToast } from '../../context/ToastContext';

interface AccountPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  language?: string;
  onPasswordUpdated?: (userId: string, newPass: string) => void;
  preselectedUserId?: string;
}

export const AccountPasswordModal: React.FC<AccountPasswordModalProps> = ({
  isOpen,
  onClose,
  language: rawLang = 'th',
  onPasswordUpdated,
  preselectedUserId,
}) => {
  const lang = rawLang === 'th' ? 'th' : 'en';
  const { addToast } = useToast();
  const localManagementEnabled = import.meta.env.DEV;
  const staffList = localManagementEnabled ? getStoredStaffDirectory() : [];
  const storedPins = localManagementEnabled ? getStoredStaffPins() : {};
  const storedPasswords = localManagementEnabled ? getStoredStaffPasswords() : {};

  const [selectedUserId, setSelectedUserId] = useState<string>(
    preselectedUserId || staffList[0]?.id || 'usr-admin-alex'
  );
  const [currentVerification, setCurrentVerification] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [copiedGenerated, setCopiedGenerated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const selectedUser = staffList.find((u) => u.id === selectedUserId) || staffList[0];
  const analysis = analyzePassword(newPassword, {
    email: selectedUser?.email,
    name: selectedUser?.name,
  });

  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isFormValid = analysis.isPolicyCompliant && passwordsMatch && currentVerification.length > 0;

  // Generator for high-entropy enterprise passphrases
  const handleGenerateSecurePassword = () => {
    const charsUpper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const charsLower = 'abcdefghijkmnopqrstuvwxyz';
    const charsNum = '23456789';
    const charsSpecial = '!@#$%^&*()_+~|}{[]:;?';

    let pass = '';
    // Guarantee each set
    pass += charsUpper[Math.floor(Math.random() * charsUpper.length)];
    pass += charsLower[Math.floor(Math.random() * charsLower.length)];
    pass += charsNum[Math.floor(Math.random() * charsNum.length)];
    pass += charsSpecial[Math.floor(Math.random() * charsSpecial.length)];

    const all = charsUpper + charsLower + charsNum + charsSpecial;
    for (let i = 0; i < 12; i++) {
      pass += all[Math.floor(Math.random() * all.length)];
    }

    // Shuffle
    const shuffled = pass.split('').sort(() => 0.5 - Math.random()).join('');
    setNewPassword(shuffled);
    setConfirmPassword(shuffled);
    setShowNewPassword(true);
    setShowConfirmPassword(true);

    // Copy to clipboard
    navigator.clipboard?.writeText(shuffled).catch(() => {});
    setCopiedGenerated(true);
    setTimeout(() => setCopiedGenerated(false), 2000);

    addToast({
      title: lang === 'th' ? 'สร้างรหัสผ่านความปลอดภัยสูงแล้ว' : 'High-Entropy Password Generated',
      message:
        lang === 'th'
          ? 'รหัสผ่านถูกคัดลอกลงคลิปบอร์ดแล้ว และตรงตามมาตรฐาน PCI-DSS ครบถ้วน'
          : 'Compliant 16-character enterprise password copied to clipboard.',
      type: 'success',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!localManagementEnabled) {
      addToast({
        title: lang === 'th' ? 'ต้องใช้ระบบจัดการบัญชีบนเซิร์ฟเวอร์' : 'Server account management required',
        message: lang === 'th' ? 'การเปลี่ยนรหัสผ่านใน production ต้องดำเนินการผ่าน API ที่ตรวจสอบสิทธิ์' : 'Production password changes must use an authorized server API.',
        type: 'error',
      });
      return;
    }
    if (!selectedUser) return;

    // Verify the selected account's persisted credential only. Never accept a universal fallback or bypass.
    const validCurrentPass = storedPasswords[selectedUser.id];
    const validPin = storedPins[selectedUser.id];
    const isCurrentValid =
      (typeof validCurrentPass === 'string' && validCurrentPass.length > 0 && currentVerification === validCurrentPass) ||
      (typeof validPin === 'string' && validPin.length > 0 && currentVerification === validPin);

    if (!isCurrentValid) {
      addToast({
        title: lang === 'th' ? 'รหัสยืนยันตัวตนปัจจุบันไม่ถูกต้อง' : 'Current Verification Failed',
        message:
          lang === 'th'
            ? `กรุณากรอกรหัสผ่านปัจจุบันหรือ PIN ของ ${selectedUser.name} ให้ถูกต้อง`
            : `Please enter the valid current password or PIN for ${selectedUser.name}`,
        type: 'error',
      });
      return;
    }

    if (!analysis.isPolicyCompliant) {
      addToast({
        title: lang === 'th' ? 'รหัสผ่านใหม่ไม่ผ่านเกณฑ์ความปลอดภัย' : 'Password Policy Violation',
        message:
          lang === 'th'
            ? 'รหัสผ่านใหม่ต้องผ่านเกณฑ์ความปลอดภัยขององค์กรครบทุกข้อ'
            : 'New password must fulfill all enterprise security policy criteria.',
        type: 'error',
      });
      return;
    }

    if (!passwordsMatch) {
      addToast({
        title: lang === 'th' ? 'รหัสผ่านยืนยันไม่ตรงกัน' : 'Passwords Do Not Match',
        message:
          lang === 'th'
            ? 'กรุณากรอกรหัสผ่านใหม่และรหัสยืนยันให้ตรงกัน'
            : 'Please ensure both password fields match exactly.',
        type: 'error',
      });
      return;
    }

    setIsSubmitting(true);
    setTimeout(() => {
      updateStaffPassword(selectedUser.id, newPassword);
      setIsSubmitting(false);

      addToast({
        title: lang === 'th' ? 'บันทึกรหัสผ่านใหม่สำเร็จ' : 'Password Successfully Updated',
        message:
          lang === 'th'
            ? `อัปเดตรหัสผ่านสำหรับ ${selectedUser.name} เรียบร้อยแล้ว สามารถเข้าสู่ระบบได้ทันที`
            : `New password for ${selectedUser.name} is now active. You can sign in immediately.`,
        type: 'success',
      });

      if (onPasswordUpdated) {
        onPasswordUpdated(selectedUser.id, newPassword);
      }
      onClose();
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-6">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900 leading-tight">
                {lang === 'th' ? 'จัดการและตั้งค่ารหัสผ่านบัญชี' : 'Secure Account Password Management'}
              </h2>
              <p className="text-[11px] text-text/60">
                {lang === 'th'
                  ? 'ตรวจสอบเกณฑ์ความปลอดภัยแบบเรียลไทม์ (NIST 800-63B & PCI-DSS)'
                  : 'Real-time security criteria verification & entropy enforcement'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Target Account Selector */}
          <div>
            <label className="block text-xs font-bold text-slate-800 mb-1.5">
              {lang === 'th' ? 'เลือกบัญชีพนักงานที่ต้องการจัดการ' : 'Target Staff Account'}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {staffList.map((user) => {
                const isSelected = user.id === selectedUserId;
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => {
                      setSelectedUserId(user.id);
                      setCurrentVerification('');
                    }}
                    className={`p-2 rounded-xl border text-left flex flex-col justify-between min-h-[58px] transition-all cursor-pointer ${
                      isSelected
                        ? 'border-primary bg-primary/5 text-primary ring-2 ring-primary/20 font-bold'
                        : 'border-slate-200 bg-slate-50/60 hover:bg-slate-100 text-slate-700'
                    }`}
                  >
                    <div className="text-[11px] font-bold truncate">{user.name.split(' ')[0]}</div>
                    <div className="text-[9px] uppercase font-mono tabular-nums text-brand-text-secondary truncate">
                      {user.role} · {user.employeeCode}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Current Verification */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-800">
                {lang === 'th' ? 'รหัสผ่านปัจจุบันหรือ PIN ของบัญชี' : 'Current Password or PIN'}
              </label>
              <span className="text-[10px] text-primary font-mono tabular-nums font-medium">
                {lang === 'th' ? `(หรือ PIN: ${storedPins[selectedUser.id] || '1234'})` : `(or PIN: ${storedPins[selectedUser.id] || '1234'})`}
              </span>
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-brand-text-secondary">
                <Lock className="w-4 h-4" />
              </div>
              <input
                type="password"
                value={currentVerification}
                onChange={(e) => setCurrentVerification(e.target.value)}
                placeholder={lang === 'th' ? 'กรอกรหัสผ่านเดิมหรือ PIN' : 'Enter current password or PIN'}
                className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary focus:bg-white transition-all placeholder:text-brand-text-secondary"
              />
            </div>
          </div>

          {/* New Password & Generator */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-800">
                {lang === 'th' ? 'รหัสผ่านใหม่ (New Password)' : 'New Password'}
              </label>
              <button
                type="button"
                onClick={handleGenerateSecurePassword}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:text-primary-dark transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{copiedGenerated ? (lang === 'th' ? 'คัดลอกแล้ว!' : 'Copied!') : (lang === 'th' ? 'สุ่มรหัสผ่านปลอดภัยสูง' : 'Generate Strong')}</span>
              </button>
            </div>

            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-brand-text-secondary">
                <KeyRound className="w-4 h-4" />
              </div>
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={lang === 'th' ? 'ตั้งรหัสผ่านใหม่ที่มีความปลอดภัย' : 'Enter new secure password'}
                className="w-full h-10 pl-9 pr-10 rounded-xl border border-slate-200 bg-slate-50 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary focus:bg-white transition-all placeholder:text-brand-text-secondary"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-brand-text-secondary hover:text-text cursor-pointer"
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>

            {/* Live Real-time Strength Meter & Validation Checklist */}
            <PasswordStrengthMeter
              analysis={analysis}
              language={lang}
              showCriteriaList={true}
              showEntropyInfo={true}
              compact={false}
            />
          </div>

          {/* Confirm Password */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-bold text-slate-800">
                {lang === 'th' ? 'ยืนยันรหัสผ่านใหม่อีกครั้ง' : 'Confirm New Password'}
              </label>
              {newPassword.length > 0 && confirmPassword.length > 0 && (
                <span
                  className={`text-[11px] font-bold flex items-center gap-1 ${
                    passwordsMatch ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {passwordsMatch ? (
                    <>
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{lang === 'th' ? 'รหัสผ่านตรงกัน' : 'Passwords match'}</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="w-3 h-3" />
                      <span>{lang === 'th' ? 'รหัสผ่านไม่ตรงกัน' : 'Does not match'}</span>
                    </>
                  )}
                </span>
              )}
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-brand-text-secondary">
                <Lock className="w-4 h-4" />
              </div>
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={lang === 'th' ? 'กรอกรหัสผ่านใหม่อีกครั้งเพื่อยืนยัน' : 'Re-type new password'}
                className={`w-full h-10 pl-9 pr-10 rounded-xl border bg-slate-50 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:bg-white transition-all placeholder:text-brand-text-secondary ${
                  confirmPassword.length > 0
                    ? passwordsMatch
                      ? 'border-emerald-400 focus:ring-emerald-500'
                      : 'border-rose-400 focus:ring-rose-500'
                    : 'border-slate-200 focus:ring-primary'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-brand-text-secondary hover:text-text cursor-pointer"
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-3 border-t border-slate-100 flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs sm:text-sm font-bold transition-all cursor-pointer"
            >
              {lang === 'th' ? 'ยกเลิก' : 'Cancel'}
            </button>

            <button
              type="submit"
              disabled={isSubmitting || !isFormValid}
              className="flex-1 h-11 rounded-xl bg-primary hover:bg-primary-dark text-primary-foreground text-xs sm:text-sm font-bold shadow-xs active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  <span>{lang === 'th' ? 'บันทึกรหัสผ่านใหม่' : 'Save New Password'}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
