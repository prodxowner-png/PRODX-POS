import React, { useEffect } from 'react';
import { ArrowRight, Delete, Fingerprint, Loader2, ScanFace, Zap } from 'lucide-react';
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
  hasRegisteredBiometrics = false,
  isBiometricVerifying = false,
  activePasskey,
  onQuickBiometricSignIn,
}) => {
  const { playClick } = useSound();

  const handleDigitPress = (digit: string) => {
    playClick();
    onPinInput(digit);
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

  const canSubmit = terminalReady && pin.length >= 4 && !isLoading;

  return (
    <div className="space-y-4">
      {/* Quick Sign-In (WebAuthn / Passkeys) to bypass PIN */}
      {hasRegisteredBiometrics && onQuickBiometricSignIn && (
        <div className="space-y-2">
          <button
            type="button"
            id="quick-sign-in-btn"
            disabled={!terminalReady || isLoading || isBiometricVerifying}
            onClick={() => {
              playClick();
              onQuickBiometricSignIn();
            }}
            className="w-full relative group overflow-hidden rounded-2xl border-2 border-brand-border-strong bg-brand-primary hover:bg-brand-primary-hover text-brand-primary-text p-3 sm:p-3.5 transition-all shadow-md shadow-brand-primary/20 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 active:scale-[0.99]"
            aria-label={isThai ? 'เข้าสู่ระบบด่วนด้วยชีวมิติ (ข้ามการกด PIN)' : 'Quick Sign-In with biometrics (Bypass PIN)'}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  aria-hidden="true"
                  className="h-10 w-10 rounded-xl bg-cta text-cta-text flex items-center justify-center shrink-0 shadow-sm shadow-cta/30 motion-safe:group-hover:scale-105 transition-transform"
                >
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
                      <Zap className="w-3.5 h-3.5 text-brand-gold-500 fill-brand-gold-500" aria-hidden="true" />
                      <span>{isThai ? 'เข้าสู่ระบบด่วน' : 'Quick Sign-In'}</span>
                    </span>
                    <span className="rounded-md bg-white/15 text-brand-primary-text border border-white/25 px-1.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider">
                      FIDO2
                    </span>
                  </div>
                  <div className="text-xs text-brand-primary-text/85 truncate leading-snug">
                    {activePasskey
                      ? `${activePasskey.userName} · ${isThai ? 'แตะสแกนข้าม PIN' : 'Touch to bypass PIN'}`
                      : isThai
                        ? 'สแกนลายนิ้วมือเพื่อข้ามการกด PIN'
                        : 'Biometric scan to bypass PIN'}
                  </div>
                </div>
              </div>
              <div className="shrink-0 flex items-center gap-1 text-xs font-black text-brand-primary-text transition-colors">
                <span className="hidden sm:inline">{isThai ? 'สแกน' : 'Scan'}</span>
                <ArrowRight className="w-4 h-4 motion-safe:group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
              </div>
            </div>
          </button>

          <div className="relative py-1 flex items-center justify-center">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-brand-border" />
            </div>
            <div className="relative bg-brand-surface px-2.5 text-xs font-black uppercase tracking-wider text-brand-text-secondary">
              {isThai ? 'หรือ กดรหัส PIN 6 หลัก' : 'Or Enter 6-Digit PIN'}
            </div>
          </div>
        </div>
      )}

      {/* 6 Round PIN Progress Dots */}
      <div
        className="flex items-center justify-center gap-3.5 py-1.5"
        role="status"
        aria-live="polite"
        aria-label={
          isThai
            ? `กรอกรหัส PIN แล้ว ${pin.length} จาก 6 หลัก`
            : `PIN ${pin.length} of 6 digits entered`
        }
      >
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const filled = pin.length > i;
          return (
            <span
              key={i}
              aria-hidden="true"
              className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                filled
                  ? 'border-cta bg-cta motion-safe:scale-110 shadow-xs'
                  : 'border-brand-border-strong bg-brand-surface-muted'
              }`}
            />
          );
        })}
      </div>

      {/* Reference 3×4 Tactile Numpad Grid with Orange Corner Actions */}
      <div className="grid grid-cols-3 gap-2.5 max-w-[300px] sm:max-w-[320px] mx-auto">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
          <button
            type="button"
            key={digit}
            disabled={!terminalReady || isLoading}
            onClick={() => handleDigitPress(digit.toString())}
            className="min-h-[56px] rounded-2xl bg-brand-surface border-2 border-brand-border-strong text-2xl font-mono font-black tabular-nums text-brand-text hover:border-cta hover:bg-cta-subtle hover:text-brand-text-accent active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-all flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs select-none"
          >
            {digit}
          </button>
        ))}

        {/* Row 4 Left: Orange Backspace */}
        <button
          type="button"
          disabled={!terminalReady || isLoading}
          onClick={handleDeletePress}
          aria-label={isThai ? 'ลบตัวเลขล่าสุด' : 'Delete last digit'}
          className="min-h-[56px] rounded-2xl bg-cta text-cta-text hover:bg-cta-hover active:bg-cta-pressed active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-all flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-sm select-none"
        >
          <Delete className="w-5 h-5" aria-hidden="true" />
        </button>

        {/* Row 4 Center: Zero */}
        <button
          type="button"
          disabled={!terminalReady || isLoading}
          onClick={() => handleDigitPress('0')}
          className="min-h-[56px] rounded-2xl bg-brand-surface border-2 border-brand-border-strong text-2xl font-mono font-black tabular-nums text-brand-text hover:border-cta hover:bg-cta-subtle hover:text-brand-text-accent active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-all flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs select-none"
        >
          0
        </button>

        {/* Row 4 Right: Orange Submit Arrow */}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={handleSubmitPress}
          aria-label={isThai ? 'ยืนยันรหัส PIN เพื่อเข้าสู่ระบบ' : 'Submit PIN to sign in'}
          className={`min-h-[56px] rounded-2xl flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-all select-none ${
            canSubmit
              ? 'bg-cta text-cta-text hover:bg-cta-hover active:bg-cta-pressed active:scale-[0.97] shadow-sm cursor-pointer'
              : 'bg-brand-surface-muted border-2 border-brand-border text-brand-text-muted cursor-not-allowed'
          }`}
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowRight className="w-5 h-5" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
};
