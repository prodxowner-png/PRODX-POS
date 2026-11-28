import React, { useState } from 'react';
import { Eye, EyeOff, Loader2, Lock, UserRound } from 'lucide-react';

interface EmailPasswordFormProps {
  isThai: boolean;
  terminalReady: boolean;
  isLoading: boolean;
  onSubmit: (email: string, pass: string) => void;
  onForgotPin: () => void;
}

export const EmailPasswordForm: React.FC<EmailPasswordFormProps> = ({
  isThai,
  terminalReady,
  isLoading,
  onSubmit,
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
          className="text-xs font-black uppercase text-brand-text-secondary cursor-pointer"
        >
          {isThai ? 'อีเมลบัญชีผู้ใช้' : 'Account Email'}
        </label>
        <div className="relative">
          <UserRound
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-text-secondary pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="operator-login-email"
            name="email"
            type="email"
            value={email}
            disabled={!terminalReady || isLoading}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="cashier@prodx.co"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="next"
            required
            className="w-full min-h-[44px] bg-brand-surface border-2 border-brand-border-strong rounded-xl pl-9 pr-3 py-2 text-base sm:text-sm font-bold text-brand-text outline-none focus:border-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta transition-all disabled:opacity-50"
          />
        </div>
      </div>

      <div className="space-y-1">
        <label
          htmlFor="operator-login-password"
          className="text-xs font-black uppercase text-brand-text-secondary cursor-pointer"
        >
          {isThai ? 'รหัสผ่าน' : 'Password'}
        </label>
        <div className="relative">
          <Lock
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-brand-text-secondary pointer-events-none"
            aria-hidden="true"
          />
          <input
            id="operator-login-password"
            name="password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            disabled={!terminalReady || isLoading}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            enterKeyHint="done"
            required
            className="w-full min-h-[44px] bg-brand-surface border-2 border-brand-border-strong rounded-xl pl-9 pr-12 py-2 text-base sm:text-sm font-bold text-brand-text outline-none focus:border-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta transition-all disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-pressed={showPassword}
            className="absolute right-0.5 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-brand-text-secondary hover:text-brand-text rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta cursor-pointer"
            aria-label={
              showPassword
                ? isThai
                  ? 'ซ่อนรหัสผ่าน'
                  : 'Hide password'
                : isThai
                  ? 'แสดงรหัสผ่าน'
                  : 'Show password'
            }
          >
            {showPassword ? (
              <EyeOff className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Eye className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={!terminalReady || !email.trim() || !password || isLoading}
        className={`w-full min-h-[48px] px-4 py-2.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-all whitespace-nowrap ${
          !terminalReady || !email.trim() || !password || isLoading
            ? 'bg-brand-surface-muted border border-brand-border text-brand-text-muted shadow-none cursor-not-allowed'
            : 'bg-cta text-cta-text hover:bg-cta-hover active:bg-cta-pressed active:scale-[0.98] shadow-md shadow-cta/25 cursor-pointer'
        }`}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
        ) : (
          <span>{isThai ? 'เข้าสู่ระบบด้วยอีเมล' : 'Sign in with Email'}</span>
        )}
      </button>

      <div className="flex items-center justify-end text-xs font-bold text-brand-text-secondary">
        <button
          type="button"
          onClick={onForgotPin}
          className="min-h-[44px] px-2 text-brand-text-secondary hover:text-brand-text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta rounded-lg transition-colors cursor-pointer inline-flex items-center"
        >
          {isThai ? 'ลืมรหัสผ่าน?' : 'Forgot password?'}
        </button>
      </div>
    </form>
  );
};
