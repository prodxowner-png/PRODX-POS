import React, { useEffect } from 'react';
import {
  Grid2X2,
  Delete,
  ArrowRight,
  UserRound,
  QrCode,
  Fingerprint,
  Loader2,
  ScanFace,
  Zap,
} from 'lucide-react';
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

  return (
    <div className="space-y-4">
      {/* 6 Circular PIN Indicator Dots */}
      <div
        className="flex justify-center items-center gap-3.5 sm:gap-4 py-2"
        role="status"
        aria-label={isThai ? `กรอกรหัส PIN แล้ว ${pin.length} จาก 6 หลัก` : `${pin.length} of 6 PIN digits entered`}
      >
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const isFilled = pin.length > i;
          return (
            <div
              key={i}
              className={`w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-full transition-all duration-200 ${
                isFilled
                  ? 'bg-[#F97316] border-2 border-[#F97316] shadow-sm shadow-orange-500/40 scale-110'
                  : 'bg-white/80 border-2 border-[#CBD5E1]'
              }`}
            />
          );
        })}
      </div>

      {/* Tactile Keypad Grid (3 columns x 4 rows) */}
      <div className="grid grid-cols-3 gap-2.5 max-w-[340px] mx-auto py-1">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
          <button
            type="button"
            key={digit}
            disabled={!terminalReady || isLoading}
            onClick={() => handleDigitPress(digit.toString())}
            aria-label={`Digit ${digit}`}
            className="h-13 sm:h-14 rounded-2xl bg-white border border-[#E2E8F0] text-2xl font-black text-[#183D32] hover:bg-[#FFF7ED] hover:border-[#F97316]/50 active:scale-95 focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2 transition-all flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs select-none"
          >
            {digit}
          </button>
        ))}

        {/* Row 4: Orange Backspace, 0, Orange Submit Arrow */}
        <button
          type="button"
          disabled={!terminalReady || isLoading || pin.length === 0}
          onClick={handleDeletePress}
          aria-label={isThai ? 'ลบตัวเลข PIN' : 'Backspace PIN'}
          className="h-13 sm:h-14 rounded-2xl bg-gradient-to-br from-[#F97316] to-[#EA580C] text-white flex items-center justify-center hover:from-[#EA580C] hover:to-[#C2410C] active:scale-95 focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md shadow-orange-500/25 select-none"
        >
          <Delete className="w-6 h-6 stroke-[2.2]" />
        </button>

        <button
          type="button"
          disabled={!terminalReady || isLoading}
          onClick={() => handleDigitPress('0')}
          aria-label="Digit 0"
          className="h-13 sm:h-14 rounded-2xl bg-white border border-[#E2E8F0] text-2xl font-black text-[#183D32] hover:bg-[#FFF7ED] hover:border-[#F97316]/50 active:scale-95 focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-xs select-none"
        >
          0
        </button>

        <button
          type="button"
          disabled={!terminalReady || isLoading || pin.length < 4}
          onClick={handleSubmitPress}
          aria-label={isThai ? 'เข้าสู่ระบบด้วย PIN' : 'Submit PIN'}
          className="h-13 sm:h-14 rounded-2xl bg-gradient-to-br from-[#F97316] to-[#EA580C] text-white flex items-center justify-center hover:from-[#EA580C] hover:to-[#C2410C] active:scale-95 focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2 transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer shadow-md shadow-orange-500/25 select-none"
        >
          <ArrowRight className="w-6 h-6 stroke-[2.5]" />
        </button>
      </div>

      {/* Auth Mode Switcher ("เลือกวิธีเข้าสู่ระบบ") */}
      <div className="max-w-[340px] mx-auto pt-2 space-y-2">
        <div className="text-center text-xs font-bold text-[#64748B]">
          {isThai ? 'เลือกวิธีเข้าสู่ระบบ' : 'Select Login Method'}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {/* PIN Tab (Active) */}
          <button
            type="button"
            onClick={() => onSwitchMode('pin')}
            className="h-10 px-2 rounded-xl bg-[#F5E1D0] border-2 border-[#F97316] text-[#183D32] text-xs font-black flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
          >
            <Grid2X2 className="w-3.5 h-3.5 text-[#183D32]" />
            <span>PIN</span>
          </button>

          {/* User/Password Tab */}
          <button
            type="button"
            onClick={() => onSwitchMode('email')}
            className="h-10 px-2 rounded-xl bg-white border border-[#E2E8F0] text-[#64748B] hover:text-[#183D32] hover:bg-[#FFF7ED] text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <UserRound className="w-3.5 h-3.5 text-[#64748B]" />
            <span className="truncate">{isThai ? 'ผู้ใช้ / รหัสผ่าน' : 'User / Pass'}</span>
          </button>

          {/* QR Tab */}
          <button
            type="button"
            onClick={() => onSwitchMode('qr')}
            className="h-10 px-2 rounded-xl bg-white border border-[#E2E8F0] text-[#64748B] hover:text-[#183D32] hover:bg-[#FFF7ED] text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <QrCode className="w-3.5 h-3.5 text-[#64748B]" />
            <span>{isThai ? 'สแกน QR' : 'Scan QR'}</span>
          </button>
        </div>

        {/* Quick Biometrics if enrolled */}
        {hasRegisteredBiometrics && onQuickBiometricSignIn && (
          <div className="pt-1.5">
            <button
              type="button"
              id="quick-sign-in-btn"
              disabled={!terminalReady || isLoading || isBiometricVerifying}
              onClick={() => {
                playClick();
                onQuickBiometricSignIn();
              }}
              className="w-full h-10 rounded-xl bg-[#183D32] text-white hover:bg-[#0F2A22] text-xs font-bold flex items-center justify-between px-3.5 transition-all shadow-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label={isThai ? 'เข้าสู่ระบบด่วนด้วยชีวมิติ' : 'Quick Sign-In with biometrics'}
            >
              <div className="flex items-center gap-2">
                {isBiometricVerifying ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#F97316]" />
                ) : activePasskey?.authenticatorType === 'face_id' ? (
                  <ScanFace className="w-4 h-4 text-[#F97316]" />
                ) : (
                  <Fingerprint className="w-4 h-4 text-[#F97316]" />
                )}
                <span>
                  {activePasskey
                    ? `${activePasskey.userName} · ${isThai ? 'แตะสแกนข้าม PIN' : 'Touch to bypass PIN'}`
                    : isThai
                      ? 'สแกนลายนิ้วมือ / Passkey'
                      : 'Biometric Passkey'}
                </span>
              </div>
              <span className="text-[10px] bg-[#F97316] text-white px-1.5 py-0.5 rounded font-black">
                FIDO2
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
