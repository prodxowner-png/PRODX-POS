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
      <div className="rounded-xl border border-slate-800 bg-slate-900 text-white px-3.5 py-2.5 flex items-center justify-between gap-2.5 shadow-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative h-8 w-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
            {activePasskey?.authenticatorType === 'face_id' ? (
              <ScanFace className="w-4 h-4 text-emerald-400" />
            ) : (
              <Fingerprint className="w-4 h-4 text-emerald-400" />
            )}
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-white flex items-center gap-1.5 truncate">
              <span>{isThai ? 'เซ็นเซอร์ชีวมิติพร้อมทำงาน' : 'Biometric Sensor Ready'}</span>
              <span className="rounded bg-emerald-500/20 px-1 py-0.2 text-[9px] font-mono font-bold text-emerald-300">
                FIDO2
              </span>
            </div>
            <div className="text-[10px] text-slate-300 truncate">
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
          className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-white/10 hover:bg-white/20 border border-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white focus-visible:ring-2 focus-visible:ring-[#ff6b1a] transition-all cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-[#ff6b1a]" />
          <span>{isThai ? 'จัดการ Passkey' : 'Passkeys'}</span>
        </button>
      </div>

      {/* Tactile Biometric Interactive Target */}
      <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4 text-center shadow-xs space-y-3">
        <div className="flex flex-col items-center justify-center">
          <button
            type="button"
            disabled={!terminalReady || isLoading || isBiometricVerifying}
            onClick={() => handleTriggerScan()}
            aria-label={isThai ? 'กดเพื่อสแกนชีวมิติ' : 'Tap to scan biometrics'}
            className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              isBiometricVerifying
                ? 'bg-emerald-500 text-white shadow-xl shadow-emerald-500/30 scale-105'
                : 'bg-slate-900 text-white hover:bg-[#ea580c] hover:scale-105 active:scale-95 shadow-lg shadow-slate-900/20'
            } focus-visible:ring-2 focus-visible:ring-[#ff6b1a] focus-visible:ring-offset-2`}
          >
            {/* Animated Laser Sweep & Glow effect */}
            {isBiometricVerifying ? (
              <div className="absolute inset-0 rounded-full overflow-hidden">
                <div className="w-full h-1 bg-white animate-laser-sweep" />
              </div>
            ) : null}

            {isBiometricVerifying ? (
              <Loader2 className="w-9 h-9 animate-spin text-white" />
            ) : activePasskey?.authenticatorType === 'face_id' ? (
              <ScanFace className="w-9 h-9 text-[#ff782e] transition-transform hover:scale-110" />
            ) : (
              <Fingerprint className="w-9 h-9 text-[#ff782e] transition-transform hover:scale-110" />
            )}
          </button>
        </div>

        {/* Selected Cashier Identity Preview */}
        {activePasskey && (
          <div className="space-y-0.5">
            <div className="inline-flex items-center gap-1.5 text-xs font-black text-slate-900">
              <UserCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>{activePasskey.userName}</span>
              <span className="rounded-md bg-slate-100 border border-slate-300 px-1.5 py-0.2 text-[10px] font-bold uppercase text-slate-700">
                {activePasskey.userRole}
              </span>
            </div>
            <p className="text-[11px] text-slate-600 font-medium">
              {isThai
                ? 'แตะเซ็นเซอร์สแกนลายนิ้วมือหรือมองกล้องเพื่อเข้ากะทันที'
                : 'Touch sensor or look at camera for instant shift sign-in'}
            </p>
          </div>
        )}
      </div>

      {/* Cashier Quick-Selector Switcher */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-black uppercase text-slate-700 px-1">
          <span>{isThai ? 'เลือกพนักงานแคชเชียร์ (1-Tap Switch)' : 'Enrolled Cashiers'}</span>
          <span className="text-[10px] text-slate-500 font-bold font-mono">
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
                    ? 'border-[#ea580c] bg-primary/10 shadow-xs'
                    : 'border-slate-300 bg-white hover:border-slate-400 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div
                    className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                      isSelected ? 'bg-[#ea580c] text-white' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {pk.authenticatorType === 'face_id' ? (
                      <ScanFace className="w-4 h-4" />
                    ) : (
                      <Fingerprint className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-black text-slate-900 truncate flex items-center gap-1.5">
                      <span>{pk.userName}</span>
                      {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-[#ea580c]" />}
                    </div>
                    <div className="text-[10px] text-slate-600 truncate">{pk.deviceLabel}</div>
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
                      ? 'bg-[#ea580c] text-white hover:bg-[#c2410c]'
                      : 'bg-slate-900 text-white hover:bg-[#ea580c]'
                  } focus-visible:ring-2 focus-visible:ring-[#ff6b1a]`}
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
          className="h-4 w-4 rounded border-slate-300 text-[#ea580c] focus:ring-[#ea580c] cursor-pointer"
        />
        <span className="text-[11px] font-bold text-slate-700">
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
          className="text-xs font-bold text-slate-700 hover:text-blue-700 focus-visible:ring-2 focus-visible:ring-[#ff6b1a] rounded-lg p-1.5 transition-colors cursor-pointer inline-flex items-center gap-1.5"
        >
          <KeyRound className="w-4 h-4 text-blue-700" />
          <span>{isThai ? 'กลับไปใช้แป้น PIN' : 'Switch to PIN Pad'}</span>
        </button>
      </div>
    </div>
  );
};

