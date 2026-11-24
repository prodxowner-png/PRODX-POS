import React, { useState, useEffect } from 'react';
import { Fingerprint, ScanFace, Plus, KeyRound, Loader2, CheckCircle2, ShieldCheck, Sparkles, UserCheck } from 'lucide-react';
import { PasskeyCredentialRecord, WebAuthnCapability } from '../../services/webauthnService';
import { useSound } from '../../context/SoundContext';

interface BiometricAuthPanelProps {
  isThai: boolean;
  terminalReady: boolean;
  isLoading: boolean;
  isBiometricVerifying: boolean;
  enrolledPasskeys: PasskeyCredentialRecord[];
  selectedPasskeyId: string;
  webauthnCapability: WebAuthnCapability | null;
  onSelectPasskey: (id: string) => void;
  onScanBiometric: (record?: PasskeyCredentialRecord) => void;
  onOpenEnrollModal: () => void;
  onSwitchMode: (mode: 'pin' | 'biometric' | 'qr' | 'email') => void;
}

const BIOMETRIC_REMEMBER_STORAGE_KEY = 'prodx.auth.remember_biometrics';

export const BiometricAuthPanel: React.FC<BiometricAuthPanelProps> = ({
  isThai,
  terminalReady,
  isLoading,
  isBiometricVerifying,
  enrolledPasskeys,
  selectedPasskeyId,
  webauthnCapability,
  onSelectPasskey,
  onScanBiometric,
  onOpenEnrollModal,
  onSwitchMode,
}) => {
  const { playClick, playSuccess } = useSound();
  const [rememberTerminal, setRememberTerminal] = useState<boolean>(() => {
    try {
      return localStorage.getItem(BIOMETRIC_REMEMBER_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const handleToggleRemember = (checked: boolean) => {
    playClick();
    setRememberTerminal(checked);
    try {
      if (checked) {
        localStorage.setItem(BIOMETRIC_REMEMBER_STORAGE_KEY, 'true');
      } else {
        localStorage.removeItem(BIOMETRIC_REMEMBER_STORAGE_KEY);
      }
    } catch {}
  };

  const activePasskey =
    enrolledPasskeys.find((pk) => pk.id === selectedPasskeyId) ||
    enrolledPasskeys[0];

  const handleTriggerScan = (record?: PasskeyCredentialRecord) => {
    playClick();
    const target = record || activePasskey;
    if (target) {
      onSelectPasskey(target.id);
    }
    onScanBiometric(target);
  };

  return (
    <div className="space-y-3.5 max-w-[360px] mx-auto select-none">
      {/* Sensor Status Banner */}
      <div className="rounded-xl border border-[#183D32]/20 dark:border-slate-700 bg-[#183D32] dark:bg-[#0F172A] text-[#FFFFFF] px-3.5 py-2.5 flex items-center justify-between gap-2.5 shadow-sm">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative h-8 w-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
            {activePasskey?.authenticatorType === 'face_id' ? (
              <ScanFace className="w-4 h-4 text-emerald-400" />
            ) : (
              <Fingerprint className="w-4 h-4 text-emerald-400" />
            )}
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-[#FFFFFF] flex items-center gap-1.5 truncate">
              <span>{isThai ? 'เซ็นเซอร์ชีวมิติพร้อมทำงาน' : 'Biometric Sensor Ready'}</span>
              <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[9px] font-mono font-bold text-emerald-300">
                FIDO2
              </span>
            </div>
            <div className="text-[10px] text-[#CBD5E1] truncate">
              {webauthnCapability?.biometricLabel || 'Touch ID / Fingerprint / Face ID'}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            playClick();
            onOpenEnrollModal();
          }}
          className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-[#FFFFFF]/10 hover:bg-[#FFFFFF]/20 border border-[#FFFFFF]/20 px-2.5 py-1.5 min-h-[36px] text-[11px] font-bold text-[#FFFFFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] transition-all cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-[#F97316]" />
          <span>{isThai ? 'จัดการ Passkey' : 'Passkeys'}</span>
        </button>
      </div>

      {/* Tactile Biometric Interactive Target */}
      <div className="rounded-2xl border border-[#F0E1D3] dark:border-slate-700 bg-[#FFFFFF] dark:bg-[#1E293B] p-4 text-center shadow-xs space-y-3">
        <div className="flex flex-col items-center justify-center">
          <button
            type="button"
            disabled={!terminalReady || isLoading || isBiometricVerifying}
            onClick={() => handleTriggerScan()}
            aria-label={isThai ? 'กดเพื่อสแกนชีวมิติ' : 'Tap to scan biometrics'}
            className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              isBiometricVerifying
                ? 'bg-emerald-600 text-[#FFFFFF] shadow-xl shadow-emerald-600/30 scale-105'
                : 'bg-[#183D32] dark:bg-[#0F172A] text-[#FFFFFF] hover:bg-[#F97316] hover:text-[#FFFFFF] hover:scale-105 active:scale-95 shadow-lg shadow-[#183D32]/20'
            } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2`}
          >
            {/* Animated Laser Sweep & Glow effect */}
            {isBiometricVerifying ? (
              <div className="absolute inset-0 rounded-full overflow-hidden">
                <div className="w-full h-1 bg-[#FFFFFF] motion-safe:animate-laser-sweep" />
              </div>
            ) : null}

            {isBiometricVerifying ? (
              <Loader2 className="w-9 h-9 animate-spin text-[#FFFFFF]" />
            ) : activePasskey?.authenticatorType === 'face_id' ? (
              <ScanFace className="w-9 h-9 text-[#F97316] transition-transform hover:scale-110" />
            ) : (
              <Fingerprint className="w-9 h-9 text-[#F97316] transition-transform hover:scale-110" />
            )}
          </button>
        </div>

        {/* Selected Cashier Identity Preview */}
        {activePasskey && (
          <div className="space-y-0.5">
            <div className="inline-flex items-center gap-1.5 text-xs font-black text-brand-text">
              <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>{activePasskey.userName}</span>
              <span className="rounded-md bg-brand-surface border border-brand-border px-1.5 py-0.2 text-[10px] font-bold uppercase text-brand-text-secondary">
                {activePasskey.userRole}
              </span>
            </div>
            <p className="text-[11px] text-brand-text-secondary font-medium">
              {isThai
                ? 'แตะเซ็นเซอร์สแกนลายนิ้วมือหรือมองกล้องเพื่อเข้ากะทันที'
                : 'Touch sensor or look at camera for instant shift sign-in'}
            </p>
          </div>
        )}
      </div>

      {/* Cashier Quick-Selector Switcher */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-black uppercase text-brand-text-secondary px-1">
          <span>{isThai ? 'เลือกพนักงานแคชเชียร์ (1-Tap Switch)' : 'Enrolled Cashiers'}</span>
          <span className="text-[10px] text-brand-text-muted font-bold font-mono">
            {enrolledPasskeys.length} {isThai ? 'คีย์' : 'keys'}
          </span>
        </div>

        <div className="space-y-1.5 max-h-[150px] overflow-y-auto pr-0.5">
          {enrolledPasskeys.map((pk) => {
            const isSelected = pk.id === (activePasskey?.id || selectedPasskeyId);
            return (
              <div
                key={pk.id}
                onClick={() => {
                  onSelectPasskey(pk.id);
                  handleTriggerScan(pk);
                }}
                className={`rounded-xl border-2 px-3 py-2 flex items-center justify-between gap-2.5 transition-all cursor-pointer ${
                  isSelected
                    ? 'border-cta bg-brand-surface-selected shadow-xs'
                    : 'border-brand-border bg-brand-surface hover:border-brand-border-strong hover:bg-brand-surface-hover'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div
                    className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-cta text-cta-text' : 'bg-brand-surface-muted text-brand-text-secondary'
                    }`}
                  >
                    {pk.authenticatorType === 'face_id' ? (
                      <ScanFace className="w-4 h-4" />
                    ) : (
                      <Fingerprint className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-black text-brand-text truncate flex items-center gap-1.5">
                      <span>{pk.userName}</span>
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-cta" />}
                    </div>
                    <div className="text-[10px] text-brand-text-secondary truncate">{pk.deviceLabel}</div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!terminalReady || isLoading || isBiometricVerifying}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectPasskey(pk.id);
                    handleTriggerScan(pk);
                  }}
                  className={`h-7.5 px-3 rounded-lg text-xs font-black transition-all cursor-pointer disabled:opacity-40 ${
                    isSelected
                      ? 'bg-cta text-cta-text hover:bg-cta-hover'
                      : 'bg-brand-primary text-brand-primary-text hover:bg-brand-primary-hover'
                  } focus-visible:ring-2 focus-visible:ring-cta`}
                >
                  {isThai ? 'สแกน' : 'Scan'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Terminal Auto-Biometric Preference Checkbox */}
      <label className="flex items-center gap-2 px-1 pt-0.5 cursor-pointer">
        <input
          type="checkbox"
          checked={rememberTerminal}
          onChange={(e) => handleToggleRemember(e.target.checked)}
          className="h-4 w-4 rounded border-brand-border text-brand-primary focus:ring-cta cursor-pointer"
        />
        <span className="text-[11px] font-bold text-brand-text-secondary">
          {isThai ? 'เปิดโหมดชีวมิติเป็นค่าเริ่มต้นบนเครื่อง POS นี้' : 'Default to biometrics on this terminal'}
        </span>
      </label>

      {/* Switch to PIN Pad */}
      <div className="flex items-center justify-center pt-1">
        <button
          type="button"
          onClick={() => {
            playClick();
            onSwitchMode('pin');
          }}
          className="text-xs font-bold text-brand-text-secondary hover:text-brand-primary focus-visible:ring-2 focus-visible:ring-cta rounded-lg p-1.5 transition-colors cursor-pointer inline-flex items-center gap-1.5"
        >
          <KeyRound className="w-4 h-4 text-blue-700" />
          <span>{isThai ? 'กลับไปใช้แป้น PIN' : 'Switch to PIN Pad'}</span>
        </button>
      </div>
    </div>
  );
};

