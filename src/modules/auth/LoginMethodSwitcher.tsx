import React from 'react';
import { Fingerprint, KeyRound, QrCode, UserRound } from 'lucide-react';
import { useSound } from '../../context/SoundContext';

export type LoginMethod = 'pin' | 'biometric' | 'qr' | 'email';

export interface LoginMethodSwitcherProps {
  isThai: boolean;
  activeMode: LoginMethod;
  terminalReady: boolean;
  onSelectMode: (mode: LoginMethod) => void;
}

export const LoginMethodSwitcher: React.FC<LoginMethodSwitcherProps> = ({
  isThai,
  activeMode,
  terminalReady,
  onSelectMode,
}) => {
  const { playClick } = useSound();

  const methods: Array<{
    id: LoginMethod;
    label: string;
    icon: React.FC<{ className?: string; 'aria-hidden'?: boolean }>;
  }> = [
    {
      id: 'pin',
      label: isThai ? 'รหัส PIN' : 'PIN',
      icon: KeyRound,
    },
    {
      id: 'email',
      label: isThai ? 'ผู้ใช้/รหัส' : 'Password',
      icon: UserRound,
    },
    {
      id: 'qr',
      label: isThai ? 'สแกน QR' : 'QR Badge',
      icon: QrCode,
    },
    {
      id: 'biometric',
      label: 'Passkey',
      icon: Fingerprint,
    },
  ];

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2.5" aria-hidden="true">
        <div className="h-px flex-1 bg-brand-border" />
        <span className="text-[11px] font-bold tracking-wide text-brand-text-secondary">
          {isThai ? 'เลือกวิธีเข้าสู่ระบบ' : 'Select Login Method'}
        </span>
        <div className="h-px flex-1 bg-brand-border" />
      </div>

      <div
        role="group"
        aria-label={isThai ? 'เลือกวิธีเข้าสู่ระบบ' : 'Select login method'}
        className="grid grid-cols-2 sm:grid-cols-4 gap-2"
      >
        {methods.map(({ id, label, icon: Icon }) => {
          const isActive = activeMode === id;
          const isDisabled = id !== 'pin' && !terminalReady;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={isActive}
              disabled={isDisabled}
              onClick={() => {
                playClick();
                onSelectMode(id);
              }}
              className="min-h-[44px] px-2 py-2 rounded-xl border border-brand-border-strong bg-brand-surface-muted/70 text-brand-text-secondary hover:bg-brand-surface-hover hover:text-brand-text aria-pressed:border-cta aria-pressed:bg-cta-subtle aria-pressed:text-brand-text-accent aria-pressed:shadow-xs active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-all flex flex-col items-center justify-center gap-1 text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden={true} />
              <span className="leading-tight truncate max-w-full">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
