import React, { useState } from 'react';
import { UserRound, Lock, Eye, EyeOff, Loader2, KeyRound, QrCode } from 'lucide-react';

interface EmailPasswordFormProps {
  isThai: boolean;
  terminalReady: boolean;
  isLoading: boolean;
  onSubmit: (email: string, pass: string) => void;
  onSwitchMode: (mode: 'pin' | 'biometric' | 'qr' | 'email') => void;
  onForgotPin: () => void;
}

export const EmailPasswordForm: React.FC<EmailPasswordFormProps> = ({
  isThai,
  terminalReady,
  isLoading,
  onSubmit,
  onSwitchMode,
  onForgotPin,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    onSubmit(email.trim(), password);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5 max-w-[340px] mx-auto py-1">
      <div className="space-y-1">
        <label htmlFor="pos-email" className="text-[11px] font-black uppercase text-[#183D32] dark:text-[#F8FAFC] block cursor-pointer">
          {isThai ? 'อีเมลบัญชีผู้ใช้ (Account Email)' : 'Account Email'}
        </label>
        <div className="relative">
          <UserRound className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B] dark:text-[#94A3B8]" />
          <input
            id="pos-email"
            name="email"
            type="email"
            value={email}
            disabled={!terminalReady || isLoading}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="cashier@prodx.co"
            required
            autoComplete="username"
            spellCheck={false}
            enterKeyHint="next"
            className="w-full h-11 bg-[#FFFFFF] dark:bg-[#0F172A] border border-[#CBD5E1] dark:border-[#475569] rounded-xl pl-10 pr-3 text-xs font-bold text-[#183D32] dark:text-[#F8FAFC] outline-none focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/30 transition-all disabled:opacity-50"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="pos-password" className="text-[11px] font-black uppercase text-[#183D32] dark:text-[#F8FAFC] block cursor-pointer">
          {isThai ? 'รหัสผ่าน (Password)' : 'Password'}
        </label>
        <div className="relative">
          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B] dark:text-[#94A3B8]" />
          <input
            id="pos-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            disabled={!terminalReady || isLoading}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            autoComplete="current-password"
            enterKeyHint="done"
            className="w-full h-11 bg-[#FFFFFF] dark:bg-[#0F172A] border border-[#CBD5E1] dark:border-[#475569] rounded-xl pl-10 pr-10 text-xs font-bold text-[#183D32] dark:text-[#F8FAFC] outline-none focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/30 transition-all disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] dark:text-[#94A3B8] hover:text-[#183D32] dark:hover:text-[#F8FAFC] p-1 rounded-md focus-visible:ring-2 focus-visible:ring-[#F97316] cursor-pointer"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={!terminalReady || !email.trim() || !password || isLoading}
        className="w-full h-12 px-4 bg-gradient-to-br from-[#F97316] to-[#EA580C] text-[#FFFFFF] rounded-xl font-black text-xs flex items-center justify-center gap-2 hover:from-[#EA580C] hover:to-[#C2410C] active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-md shadow-orange-500/25 cursor-pointer whitespace-nowrap"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0 text-[#FFFFFF]" />
        ) : (
          <span className="text-[#FFFFFF]">{isThai ? 'เข้าสู่ระบบด้วยอีเมล' : 'Sign in with Email'}</span>
        )}
      </button>

      {/* Mode Switcher */}
      <div className="pt-2 space-y-2">
        <div className="text-center text-xs font-bold text-[#64748B] dark:text-[#94A3B8]">
          {isThai ? 'เลือกวิธีเข้าสู่ระบบ' : 'Select Login Method'}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => onSwitchMode('pin')}
            className="h-10 px-2 rounded-xl bg-[#FFFFFF] dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-[#334155] text-[#64748B] dark:text-[#94A3B8] hover:text-[#183D32] dark:hover:text-[#F8FAFC] hover:bg-[#FFF7ED] dark:hover:bg-[#1E293B] text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>PIN</span>
          </button>
          <button
            type="button"
            onClick={() => onSwitchMode('email')}
            className="h-10 px-2 rounded-xl bg-[#F5E1D0] dark:bg-[#F97316]/20 border-2 border-[#F97316] text-[#183D32] dark:text-[#F97316] text-xs font-black flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
          >
            <UserRound className="w-3.5 h-3.5" />
            <span className="truncate">{isThai ? 'ผู้ใช้ / รหัสผ่าน' : 'User / Pass'}</span>
          </button>
          <button
            type="button"
            onClick={() => onSwitchMode('qr')}
            className="h-10 px-2 rounded-xl bg-[#FFFFFF] dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-[#334155] text-[#64748B] dark:text-[#94A3B8] hover:text-[#183D32] dark:hover:text-[#F8FAFC] hover:bg-[#FFF7ED] dark:hover:bg-[#1E293B] text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>{isThai ? 'สแกน QR' : 'Scan QR'}</span>
          </button>
        </div>
      </div>

      <div className="text-center pt-1">
        <button
          type="button"
          onClick={onForgotPin}
          className="text-xs text-[#64748B] dark:text-[#94A3B8] hover:text-[#F97316] dark:hover:text-[#F97316] underline cursor-pointer"
        >
          {isThai ? 'ลืมรหัสผ่านหรือ PIN?' : 'Forgot password or PIN?'}
        </button>
      </div>
    </form>
  );
};
