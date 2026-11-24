import React, { useEffect } from 'react';
import { KeyRound, Lock, Fingerprint, QrCode, UserRound, ArrowRight, Delete, Loader2, ScanFace, Zap } from 'lucide-react';
import { useSound } from '../../context/SoundContext';
import { PasskeyCredentialRecord } from '../../services/webauthnService';

export interface OperatorPinPadProps {
  isThai: boolean;
  terminalReady: boolean;
  isLoading: boolean;
  pin: string;
  onPinInput: (digit: string) => void;
  onPinClear: () => void;
  onPinDelete: () => void;
  onSubmit: () => void;
  onSwitchMode: (mode: 'pin' | 'biometric' | 'qr' | 'email') => void;
  onForgotPin: () => void;
  onTriggerScopeError: () => void;
  hasRegisteredBiometrics?: boolean;
  isBiometricVerifying?: boolean;
  activePasskey?: PasskeyCredentialRecord;
  onQuickBiometricSignIn?: () => void;
}

export const OperatorPinPad: React.FC<OperatorPinPadProps> = ({
  isThai,
  terminalReady,
  isLoading,
  pin,
  onPinInput,
  onPinClear,
  onPinDelete,
  onSubmit,
  onSwitchMode,
  onForgotPin,
  onTriggerScopeError,
  hasRegisteredBiometrics = false,
  isBiometricVerifying = false,
  activePasskey,
  onQuickBiometricSignIn,
}) => {
  const { playClick, playSuccess, playCriticalAlert } = useSound();

  const handleDigitPress = (digit: string) => {
    playClick();
    onPinInput(digit);
  };

  const handleClearPress = () => {
    playClick();
    onPinClear();
  };

  const handleDeletePress = () => {
    playClick();
    onPinDelete();
  };

  const handleSubmitPress = () => {
    playClick();
    onSubmit();
  };

  // Physical keyboard numpad listener with tactile audio/haptic click
  useEffect(() => {
    if (!terminalReady) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl instanceof HTMLSelectElement
      ) {
        return;
      }

      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        playClick();
        onPinInput(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        playClick();
        onPinDelete();
      } else if (e.key === 'Enter' && pin.length >= 4) {
        e.preventDefault();
        playClick();
        onSubmit();
      } else if (e.key === 'Escape' || e.key === 'Delete') {
        e.preventDefault();
        playClick();
        onPinClear();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [terminalReady, pin, onPinInput, onPinDelete, onSubmit, onPinClear, playClick]);

  return (
    <div className="space-y-3">
      {/* Quick Sign-In (WebAuthn / Passkeys) to bypass PIN */}
      {hasRegisteredBiometrics && onQuickBiometricSignIn && (
        <div className="space-y-2 pb-1">
          <button
            type="button"
            id="quick-sign-in-btn"
            disabled={!terminalReady || isLoading || isBiometricVerifying}
            onClick={() => {
              playClick();
              onQuickBiometricSignIn();
            }}
            className="w-full relative group overflow-hidden rounded-2xl border-2 border-brand-border-strong bg-brand-primary hover:bg-brand-primary-hover text-brand-primary-text p-3 sm:p-3.5 transition-all shadow-md shadow-brand-primary/20 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 active:scale-[0.99]"
            aria-label={isThai ? 'เข้าสู่ระบบด่วนด้วยชีวมิติ (ข้ามการกด PIN)' : 'Quick Sign-In with biometrics (Bypass PIN)'}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-10 w-10 rounded-xl bg-cta text-cta-text flex items-center justify-center shrink-0 shadow-sm shadow-cta/30 group-hover:scale-105 transition-transform">
                  {isBiometricVerifying ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : activePasskey?.authenticatorType === 'face_id' ? (
                    <ScanFace className="w-5 h-5" />
                  ) : (
                    <Fingerprint className="w-5 h-5" />
                  )}
                </div>
                <div className="text-left min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-black tracking-tight text-brand-primary-text flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-cta fill-cta" />
                      <span>{isThai ? 'เข้าสู่ระบบด่วน' : 'Quick Sign-In'}</span>
                    </span>
                    <span className="rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider">
                      FIDO2
                    </span>
                  </div>
                  <div className="text-[11px] text-brand-primary-text/80 truncate">
                    {activePasskey
                      ? `${activePasskey.userName} · ${isThai ? 'แตะสแกนข้าม PIN' : 'Touch to bypass PIN'}`
                      : isThai
                        ? 'สแกนลายนิ้วมือเพื่อข้ามการกด PIN'
                        : 'Biometric scan to bypass PIN'}
                  </div>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-1 text-xs font-black text-cta group-hover:text-brand-primary-text transition-colors">
                <span className="hidden xs:inline">{isThai ? 'สแกน' : 'Scan'}</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </div>
          </button>

          <div className="relative py-1 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-brand-border" />
            </div>
            <div className="relative bg-brand-surface px-2.5 text-[10px] font-black uppercase tracking-wider text-brand-text-secondary">
              {isThai ? 'หรือ กดรหัส PIN 6 หลัก' : 'Or Enter 6-Digit PIN'}
            </div>
          </div>
        </div>
      )}

      {/* PIN Dots */}
      <div className="flex justify-center gap-3 py-1">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`w-10 h-12 sm:w-11 sm:h-13 rounded-2xl border-2 flex items-center justify-center transition-all duration-300 ${
              pin.length > i
                ? 'border-cta bg-cta-subtle text-cta scale-105 shadow-md shadow-cta/20'
                : 'border-brand-border bg-brand-surface-muted'
            }`}
          >
            {pin.length > i ? <div className="w-3.5 h-3.5 rounded-full bg-cta" /> : null}
          </div>
        ))}
      </div>

      {/* Numpad Grid */}
      <div className="grid grid-cols-3 gap-2 max-w-[340px] mx-auto py-1">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
          <button
            type="button"
            key={digit}
            disabled={!terminalReady || isLoading}
            onClick={() => handleDigitPress(digit.toString())}
            className="h-13 sm:h-14 rounded-2xl bg-brand-surface border-2 border-brand-border text-lg font-black tabular-nums text-brand-text hover:border-cta hover:bg-cta-subtle hover:text-cta active:scale-95 focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-all flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs select-none"
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          disabled={!terminalReady || isLoading}
          onClick={handleClearPress}
          className="h-13 sm:h-14 rounded-2xl bg-brand-surface-muted border-2 border-brand-border text-brand-text-secondary font-black text-xs uppercase tracking-wider hover:bg-danger-subtle hover:text-danger hover:border-danger active:scale-95 focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none"
        >
          {isThai ? 'ล้าง' : 'Clear'}
        </button>
        <button
          type="button"
          disabled={!terminalReady || isLoading}
          onClick={() => handleDigitPress('0')}
          className="h-13 sm:h-14 rounded-2xl bg-brand-surface border-2 border-brand-border text-lg font-black tabular-nums text-brand-text hover:border-cta hover:bg-cta-subtle hover:text-cta active:scale-95 focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs select-none"
        >
          0
        </button>
        <button
          type="button"
          disabled={!terminalReady || isLoading}
          onClick={handleDeletePress}
          aria-label={isThai ? 'ลบตัวเลขล่าสุด' : 'Delete last digit'}
          className="h-13 sm:h-14 rounded-2xl bg-brand-surface-muted border-2 border-brand-border flex items-center justify-center text-brand-text-secondary hover:bg-brand-surface-hover hover:text-brand-text active:scale-95 focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer select-none"
        >
          <Delete className="w-5 h-5" />
        </button>
      </div>

      {/* Submit CTA */}
      <div className="max-w-[340px] mx-auto space-y-3 pt-1">
        <button
          type="button"
          disabled={!terminalReady || pin.length < 4 || isLoading}
          onClick={handleSubmitPress}
          className="w-full h-13 px-6 bg-cta text-cta-text rounded-2xl font-black text-sm flex items-center justify-center gap-2 hover:bg-cta-hover active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed shadow-md shadow-cta/30 cursor-pointer whitespace-nowrap"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin shrink-0" />
          ) : (
            <span className="truncate">{isThai ? 'เข้าสู่ระบบ POS' : 'Sign in to POS Terminal'}</span>
          )}
        </button>

        {/* Secondary Navigation Options */}
        <div className="flex items-center justify-between pt-1 text-xs font-bold text-brand-text-secondary">
          <button
            type="button"
            disabled={!terminalReady}
            onClick={() => {
              playClick();
              onSwitchMode('biometric');
            }}
            className="min-h-[44px] px-2 hover:text-brand-text-accent focus-visible:ring-2 focus-visible:ring-cta rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
          >
            <Fingerprint className="w-4 h-4 text-brand-text-accent" />
            <span>{isThai ? 'ชีวมิติ' : 'Biometric'}</span>
          </button>
          <button
            type="button"
            disabled={!terminalReady}
            onClick={() => {
              playClick();
              onSwitchMode('qr');
            }}
            className="min-h-[44px] px-2 hover:text-brand-text-accent focus-visible:ring-2 focus-visible:ring-cta rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
          >
            <QrCode className="w-4 h-4 text-brand-text-accent" />
            <span>{isThai ? 'สแกน QR' : 'QR Badge'}</span>
          </button>
          <button
            type="button"
            disabled={!terminalReady}
            onClick={() => {
              playClick();
              onSwitchMode('email');
            }}
            className="min-h-[44px] px-2 hover:text-brand-text-accent focus-visible:ring-2 focus-visible:ring-cta rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
          >
            <UserRound className="w-4 h-4 text-brand-text-accent" />
            <span>{isThai ? 'บัญชีพนักงาน' : 'Staff ID'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
