import React from 'react';
import { Fingerprint, KeyRound, Loader2, ShieldCheck } from 'lucide-react';
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
  onSwitchMode: (mode: 'pin' | 'biometric' | 'qr' | 'email') => void;
}

export const BiometricAuthPanel: React.FC<BiometricAuthPanelProps> = ({
  isThai, terminalReady, isLoading, isBiometricVerifying, username, onUsernameChange,
  webauthnCapability, serverEnabled, onScanBiometric, onSwitchMode,
}) => (
  <div className="space-y-4 max-w-[360px] mx-auto">
    <div className="rounded-xl border border-brand-border bg-brand-primary text-brand-primary-text px-3.5 py-3 flex items-center gap-3 shadow-xs">
      <div className="h-9 w-9 rounded-lg bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center shrink-0">
        <ShieldCheck className="w-5 h-5 text-emerald-300" />
      </div>
      <div className="min-w-0">
        <div className="text-xs font-bold truncate">{serverEnabled ? (isThai ? 'Passkey พร้อมใช้งาน' : 'Server Passkeys Available') : (isThai ? 'Passkey ยังไม่พร้อมใช้งาน' : 'Passkeys Not Configured')}</div>
        <div className="text-[10px] text-brand-primary-text/75 truncate">{webauthnCapability?.platformSummary || 'WebAuthn capability check pending'}</div>
      </div>
    </div>

    {!serverEnabled && (
      <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-brand-text-secondary">
        {isThai ? 'ระบบ Passkey ยังไม่ได้ตั้งค่า RP ID และ Origin บน Server กรุณาใช้ PIN หรือรหัสผ่านแทน' : 'The authentication server has not configured its WebAuthn RP ID and allowed origins. Use PIN or password sign-in for now.'}
      </div>
    )}

    <div className="rounded-2xl border-2 border-brand-border bg-brand-surface-muted p-4 text-center shadow-xs space-y-3">
      <label className="block text-left space-y-1.5">
        <span className="text-xs font-bold text-brand-text">{isThai ? 'ชื่อผู้ใช้' : 'Account username'}</span>
        <input
          type="text"
          autoComplete="username webauthn"
          value={username}
          onChange={(event) => onUsernameChange(event.target.value)}
          placeholder={isThai ? 'กรอก Username' : 'Enter username'}
          maxLength={256}
          className="w-full min-h-[44px] rounded-lg border border-brand-border bg-brand-surface px-3 text-sm text-brand-text outline-none focus-visible:ring-2 focus-visible:ring-cta"
        />
      </label>
      <button
        type="button"
        disabled={!terminalReady || !serverEnabled || !webauthnCapability?.isSupported || !username.trim() || isLoading || isBiometricVerifying}
        onClick={onScanBiometric}
        className="mx-auto relative w-20 h-20 rounded-full flex items-center justify-center bg-brand-primary text-brand-primary-text hover:bg-cta hover:text-cta-text transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-brand-primary/20 focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2"
        aria-label={isThai ? 'เข้าสู่ระบบด้วย Passkey' : 'Sign in with passkey'}
      >
        {isBiometricVerifying ? <Loader2 className="w-9 h-9 animate-spin" /> : <Fingerprint className="w-9 h-9 text-cta" />}
      </button>
      <p className="text-[11px] text-brand-text-secondary">
        {isThai ? 'กดปุ่มเพื่อเปิดหน้าต่างยืนยัน Passkey ของอุปกรณ์' : 'Continue with your device or password manager passkey prompt'}
      </p>
    </div>

    <div className="flex items-center justify-center pt-1">
      <button
        type="button"
        onClick={() => onSwitchMode('pin')}
        className="min-h-[44px] px-3 text-xs font-bold text-brand-text-secondary hover:text-brand-text-accent focus-visible:ring-2 focus-visible:ring-cta rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5"
      >
        <KeyRound className="w-4 h-4 text-brand-text-accent" />
        <span>{isThai ? 'กลับไปใช้แป้น PIN' : 'Switch to PIN Pad'}</span>
      </button>
    </div>
  </div>
);
