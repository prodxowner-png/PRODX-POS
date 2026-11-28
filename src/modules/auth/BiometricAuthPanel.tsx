import React from 'react';
import { Fingerprint, Loader2, ShieldCheck } from 'lucide-react';
import type { WebAuthnCapability } from '../../services/webauthnService';

interface BiometricAuthPanelProps {
  isThai: boolean;
  terminalReady: boolean;
  isLoading: boolean;
  isBiometricVerifying: boolean;
  username: string;
  onUsernameChange: (value: string) => void;
  webauthnCapability: WebAuthnCapability | null;
  serverEnabled: boolean;
  onScanBiometric: () => void;
}

export const BiometricAuthPanel: React.FC<BiometricAuthPanelProps> = ({
  isThai,
  terminalReady,
  isLoading,
  isBiometricVerifying,
  username,
  onUsernameChange,
  webauthnCapability,
  serverEnabled,
  onScanBiometric,
}) => {
  const canScan =
    terminalReady &&
    serverEnabled &&
    Boolean(webauthnCapability?.isSupported) &&
    Boolean(username.trim()) &&
    !isLoading &&
    !isBiometricVerifying;

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (canScan) {
      onScanBiometric();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3.5 max-w-[360px] mx-auto">
      <div className="rounded-xl border border-brand-border bg-brand-primary text-brand-primary-text px-3.5 py-3 flex items-center gap-3 shadow-xs">
        <div
          aria-hidden="true"
          className="h-9 w-9 rounded-lg bg-white/15 border border-white/25 flex items-center justify-center shrink-0"
        >
          <ShieldCheck className="w-5 h-5 text-brand-gold-500" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-bold truncate">
            {serverEnabled
              ? isThai
                ? 'Passkey พร้อมใช้งาน'
                : 'Server Passkeys Available'
              : isThai
                ? 'Passkey ยังไม่พร้อมใช้งาน'
                : 'Passkeys Not Configured'}
          </div>
          <div className="text-[11px] text-brand-primary-text/80 truncate">
            {webauthnCapability?.platformSummary || 'WebAuthn capability check pending'}
          </div>
        </div>
      </div>

      {!serverEnabled && (
        <div
          role="status"
          className="rounded-xl border border-warning/40 bg-warning-subtle px-3 py-2 text-xs leading-relaxed text-warning-text"
        >
          {isThai
            ? 'ระบบ Passkey ยังไม่ได้ตั้งค่า RP ID และ Origin บน Server กรุณาใช้ PIN หรือรหัสผ่านแทน'
            : 'The authentication server has not configured its WebAuthn RP ID and allowed origins. Use PIN or password sign-in for now.'}
        </div>
      )}

      <div className="rounded-2xl border-2 border-brand-border bg-brand-surface-muted p-4 text-center shadow-xs space-y-3">
        <label htmlFor="operator-passkey-username" className="block text-left space-y-1.5">
          <span className="text-xs font-bold text-brand-text">
            {isThai ? 'ชื่อผู้ใช้' : 'Account username'}
          </span>
          <input
            id="operator-passkey-username"
            name="username"
            type="text"
            autoComplete="username webauthn"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
            placeholder={isThai ? 'กรอก Username' : 'Enter username'}
            maxLength={256}
            className="w-full min-h-[44px] rounded-xl border-2 border-brand-border-strong bg-brand-surface px-3 py-2 text-base sm:text-sm font-bold text-brand-text outline-none focus:border-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta transition-all"
          />
        </label>

        <button
          type="submit"
          disabled={!canScan}
          className="mx-auto relative w-20 h-20 rounded-full flex items-center justify-center bg-brand-primary text-brand-primary-text hover:bg-cta hover:text-cta-text transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-brand-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2"
          aria-label={isThai ? 'เข้าสู่ระบบด้วย Passkey' : 'Sign in with passkey'}
        >
          {isBiometricVerifying ? (
            <Loader2 className="w-9 h-9 animate-spin" aria-hidden="true" />
          ) : (
            <Fingerprint className="w-9 h-9 text-cta" aria-hidden="true" />
          )}
        </button>

        <p className="text-xs text-brand-text-secondary leading-relaxed">
          {isThai
            ? 'กดปุ่มเพื่อเปิดหน้าต่างยืนยัน Passkey ของอุปกรณ์'
            : 'Continue with your device or password manager passkey prompt'}
        </p>
      </div>
    </form>
  );
};
