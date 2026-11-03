import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Eye, EyeOff, Fingerprint, Lock, LogOut, ShieldAlert } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { ProdxLogo } from '../common/ProdxLogo';
import { getZIndexClass } from '../../utils/ZIndexManager';

export const LockScreenModal: React.FC = () => {
  const { session, unlockSystem, unlockWithBiometrics, logout, isLocked } = useAuth();
  const { language } = useLanguage();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!isLocked || !session || typeof document === 'undefined') return null;

  const handleUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!password) {
      setErrorMsg(language === 'th' ? 'กรุณากรอกรหัสผ่าน' : 'Enter your password.');
      return;
    }
    setIsUnlocking(true);
    setErrorMsg('');
    try {
      if (await unlockSystem(password)) {
        setPassword('');
        return;
      }
      setPassword('');
      setErrorMsg(
        language === 'th'
          ? 'ยืนยันตัวตนไม่สำเร็จ กรุณาตรวจสอบรหัสผ่าน'
          : 'Reauthentication failed. Check your password.',
      );
    } catch {
      setPassword('');
      setErrorMsg(
        language === 'th'
          ? 'ไม่สามารถยืนยันตัวตนกับเซิร์ฟเวอร์ได้'
          : 'Unable to verify your account with the server.',
      );
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleBiometricUnlock = async () => {
    if (isUnlocking) return;
    setIsUnlocking(true);
    setErrorMsg('');
    try {
      const ok = await unlockWithBiometrics();
      if (!ok) {
        setErrorMsg(
          language === 'th'
            ? 'ยืนยันตัวตนชีวมิติไม่สำเร็จ กรุณาลองอีกครั้งหรือใช้รหัสผ่าน'
            : 'Biometric verification failed. Please retry or use your password.',
        );
      }
    } finally {
      setIsUnlocking(false);
    }
  };

  return createPortal(
    <div className={`fixed inset-0 ${getZIndexClass('modal')} flex select-none items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm`}>
      <div className="relative z-10 flex w-full max-w-md flex-col items-center rounded-lg border border-border bg-card p-6 text-center shadow-xl sm:p-7">
        <div className="mb-3.5 flex h-12 w-12 items-center justify-center rounded-lg border border-blue-200/60 bg-blue-50 text-blue-600 dark:border-blue-800/60 dark:bg-blue-950/60 dark:text-blue-400">
          <Lock className="h-6 w-6" />
        </div>

        <div className="mb-2"><ProdxLogo variant="horizontal" size="sm" showTagline={false} /></div>
        <h2 className="mt-1 text-base font-semibold tracking-tight text-text">
          {language === 'th' ? 'หน้าจอถูกล็อกชั่วคราว' : 'Terminal locked'}
        </h2>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-text/60">
          {language === 'th'
            ? 'กรอกรหัสผ่านของบัญชีปัจจุบันหรือสแกนชีวมิติเพื่อยืนยันตัวตนอีกครั้ง'
            : 'Enter the current account password or use biometrics to reauthenticate.'}
        </p>

        <div className="my-4 flex w-full items-center gap-3 rounded-lg border border-border bg-slate-50/80 p-3 dark:bg-slate-900/60">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-blue-200/50 bg-blue-100/60 text-sm font-bold text-blue-600 dark:border-blue-800/50 dark:bg-blue-950/80 dark:text-blue-400">
            {session.currentUser.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-xs font-semibold text-text sm:text-sm">{session.currentUser.name}</div>
            <div className="mt-0.5 text-xs text-text/60">{session.currentStore.name} · {session.registerId}</div>
          </div>
          <div className="shrink-0 text-right font-mono text-xs text-text/40">
            {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>

        <form onSubmit={handleUnlock} className="w-full">
          <label className="block text-left">
            <span className="mb-2 block text-xs font-semibold text-text/70">
              {language === 'th' ? 'รหัสผ่าน' : 'Password'}
            </span>
            <span className="relative block">
              <input
                value={password}
                onChange={(event) => { setPassword(event.target.value); setErrorMsg(''); }}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                maxLength={256}
                autoFocus
                className="h-12 w-full rounded-lg border border-border bg-background px-3 pr-12 text-sm text-text outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-md text-text/60 hover:bg-background"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
          </label>

          {errorMsg && (
            <div className="mt-2 flex items-center justify-center gap-1 text-xs font-medium text-rose-500 dark:text-rose-400" role="alert">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isUnlocking || !password}
            className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:pointer-events-none disabled:opacity-50"
          >
            <span>{isUnlocking ? (language === 'th' ? 'กำลังตรวจสอบ…' : 'Verifying…') : (language === 'th' ? 'ปลดล็อกหน้าจอ' : 'Unlock terminal')}</span>
            <ArrowRight className="h-4 w-4" />
          </button>

          <button
            type="button"
            disabled={isUnlocking}
            onClick={() => void handleBiometricUnlock()}
            className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-300 disabled:pointer-events-none disabled:opacity-50 cursor-pointer"
          >
            <Fingerprint className="h-4 w-4 shrink-0" />
            <span>
              {language === 'th'
                ? 'ปลดล็อกด้วยลายนิ้วมือ / ใบหน้า (WebAuthn)'
                : 'Unlock with Biometrics (WebAuthn)'}
            </span>
          </button>
        </form>

        <button
          type="button"
          onClick={() => void logout()}
          className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-text/60 transition-colors hover:bg-background/80"
        >
          <LogOut className="h-3.5 w-3.5 text-rose-500" />
          <span>{language === 'th' ? 'ออกจากระบบแทน' : 'Sign out instead'}</span>
        </button>
      </div>
    </div>,
    document.body,
  );
};
