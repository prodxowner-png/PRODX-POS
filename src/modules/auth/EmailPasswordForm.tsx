import React, { useState } from 'react';
import { UserRound, Lock, Eye, EyeOff, Loader2, KeyRound } from 'lucide-react';

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
    <form onSubmit={handleSubmit} className="space-y-3 max-w-[340px] mx-auto">
      <div className="space-y-1">
        <label
          htmlFor="operator-login-email"
          className="text-[11px] font-black uppercase text-brand-text-secondary cursor-pointer"
        >
          {isThai ? 'อีเมลบัญชีผู้ใช้' : 'Account Email'}
        </label>
        <div className="relative">
          <UserRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-text-secondary" />
          <input
            id="operator-login-email"
            type="email"
            value={email}
            disabled={!terminalReady || isLoading}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="cashier@prodx.co"
            autoComplete="username"
            spellCheck={false}
            required
            className="w-full h-11 bg-brand-surface border-2 border-brand-border rounded-xl pl-9 pr-3 text-base sm:text-sm font-bold text-brand-text outline-none focus:border-cta focus:ring-2 focus:ring-cta/30 transition-all disabled:opacity-50"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label
          htmlFor="operator-login-password"
          className="text-[11px] font-black uppercase text-brand-text-secondary cursor-pointer"
        >
          {isThai ? 'รหัสผ่าน' : 'Password'}
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-text-secondary" />
          <input
            id="operator-login-password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            disabled={!terminalReady || isLoading}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
            className="w-full h-11 bg-brand-surface border-2 border-brand-border rounded-xl pl-9 pr-11 text-base sm:text-sm font-bold text-brand-text outline-none focus:border-cta focus:ring-2 focus:ring-cta/30 transition-all disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-brand-text-secondary hover:text-brand-text rounded-md focus-visible:ring-2 focus-visible:ring-cta cursor-pointer"
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={!terminalReady || !email.trim() || !password || isLoading}
        className="w-full h-12 px-4 bg-cta text-cta-text rounded-xl font-black text-xs flex items-center justify-center gap-2 hover:bg-cta-hover active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-md shadow-cta/20 cursor-pointer whitespace-nowrap"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
        ) : (
          <span>{isThai ? 'เข้าสู่ระบบด้วยอีเมล' : 'Sign in with Email'}</span>
        )}
      </button>

      <div className="flex items-center justify-between pt-1 text-xs font-bold text-brand-text-secondary">
        <button
          type="button"
          onClick={() => onSwitchMode('pin')}
          className="min-h-[44px] px-2 hover:text-brand-text-accent focus-visible:ring-2 focus-visible:ring-cta rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1"
        >
          <KeyRound className="w-4 h-4 text-brand-text-accent" />
          <span>{isThai ? 'ใช้แป้น PIN' : 'Use PIN Pad'}</span>
        </button>
        <button
          type="button"
          onClick={onForgotPin}
          className="min-h-[44px] px-2 text-brand-text-secondary hover:text-brand-text-accent underline focus-visible:ring-2 focus-visible:ring-cta rounded-lg transition-colors cursor-pointer inline-flex items-center"
        >
          {isThai ? 'ลืมรหัสผ่าน?' : 'Forgot password?'}
        </button>
      </div>
    </form>
  );
};
