import React, { useState, useEffect, useMemo } from 'react';
import { User, Role } from '../../domain/auth';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { playScannerSound } from '../../services/soundService';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import {
  ShieldAlert,
  ShieldCheck,
  KeyRound,
  Delete,
  CheckCircle2,
  Lock,
  UserCheck,
  AlertCircle,
  Fingerprint,
  Loader2,
} from 'lucide-react';
import { authenticatePasskey } from '../../services/webauthnService';
import { hasProductionUrl } from '../../adapters/env';
import { authenticateSupervisorWithSupabase } from '../../lib/supabaseSupervisorAuth';
import { createProductionSupervisorDirectoryApi } from '../../adapters/productionSupervisorDirectoryApi';

export interface SupervisorAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  actionDescription: string;
  requiredRole?: Role; // default 'manager' (allows manager and admin)
  onAuthorized: (supervisor: User, notes?: string, proof?: string) => void | Promise<void>;
}

export const SupervisorAuthModal: React.FC<SupervisorAuthModalProps> = ({
  isOpen,
  onClose,
  title,
  actionDescription,
  requiredRole = 'manager',
  onAuthorized,
}) => {
  const { language } = useLanguage();
  const { staffUsers, getStaffPin, session } = useAuth();
  const isProduction = hasProductionUrl();
  const [pin, setPin] = useState('');
  const [supervisorEmail, setSupervisorEmail] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedSupervisor, setSelectedSupervisor] = useState<User | null>(null);
  const [serverSupervisors, setServerSupervisors] = useState<User[]>([]);
  const [isLoadingSupervisors, setIsLoadingSupervisors] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [isVerifyingPasskey, setIsVerifyingPasskey] = useState(false);

  // Production uses the authenticated, tenant/store-scoped supervisor directory;
  // the browser staff directory is development-only and never an auth source.
  const eligibleSupervisors = useMemo(() => {
    const candidates = isProduction
      ? serverSupervisors
      : [...(staffUsers ?? []).filter((user) => user.id !== session?.currentUser?.id), ...(session?.currentUser ? [session.currentUser] : [])];
    return candidates.filter((user) => requiredRole === 'admin' ? user.role === 'admin' : user.role === 'admin' || user.role === 'manager');
  }, [isProduction, serverSupervisors, staffUsers, session?.currentUser, requiredRole]);

  useEffect(() => {
    if (!isOpen) return;
    setPin('');
    setSupervisorEmail('');
    setErrorMsg(null);
    setSelectedSupervisor(null);
    if (isProduction) setServerSupervisors([]);
    setIsLoadingSupervisors(false);
    setOverrideReason('');
  }, [isOpen, isProduction]);

  useEffect(() => {
    if (!isOpen || !isProduction) return;
    if (!session?.token) { setErrorMsg('Authenticated POS session is required to load supervisors.'); return; }
    let active = true;
    setIsLoadingSupervisors(true);
    setServerSupervisors([]);
    void createProductionSupervisorDirectoryApi(session.token).list()
      .then((supervisors) => {
        if (!active) return;
        setServerSupervisors(supervisors);
        if (supervisors.length === 0) setErrorMsg(language === 'th' ? 'ไม่พบผู้จัดการที่มีสิทธิ์อนุมัติในสาขานี้' : 'No eligible supervisors are assigned to this store.');
      })
      .catch((error) => {
        if (active) setErrorMsg(error instanceof Error ? error.message : 'Supervisor directory is unavailable.');
      })
      .finally(() => { if (active) setIsLoadingSupervisors(false); });
    return () => { active = false; };
  }, [isOpen, isProduction, session?.token, language]);

  useEffect(() => {
    if (!isOpen || isLoadingSupervisors) return;
    if (eligibleSupervisors.length === 0) { setSelectedSupervisor(null); return; }
    if (!selectedSupervisor || !eligibleSupervisors.some((user) => user.id === selectedSupervisor.id)) setSelectedSupervisor(eligibleSupervisors[0]);
  }, [isOpen, isLoadingSupervisors, eligibleSupervisors, selectedSupervisor]);

  // Handle keyboard typing
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isProduction) {
        if (e.key === 'Enter') { e.preventDefault(); handleVerifyPin(); }
        return;
      }
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        setPin((prev) => (prev.length < 6 ? prev + e.key : prev));
        setErrorMsg(null);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        setPin((prev) => prev.slice(0, -1));
        setErrorMsg(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleVerifyPin();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, pin, supervisorEmail, selectedSupervisor, isProduction]);

  const handleKeyPress = (num: string) => {
    playScannerSound('click');
    if (pin.length < 6) {
      setPin((prev) => prev + num);
      setErrorMsg(null);
    }
  };

  const handleClear = () => {
    playScannerSound('click');
    setPin('');
    setErrorMsg(null);
  };

  const handleDelete = () => {
    playScannerSound('click');
    setPin((prev) => prev.slice(0, -1));
    setErrorMsg(null);
  };

  const handleVerifyPin = async () => {
    if (isProduction) {
      if (!selectedSupervisor || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supervisorEmail.trim()) || pin.trim().length < 4) {
        setErrorMsg(language === 'th' ? 'กรุณาเลือกผู้จัดการ กรอกอีเมล Supabase และรหัสผ่านบัญชี' : 'Select a supervisor and enter their Supabase email and account password.');
        return;
      }
      setIsVerifyingPasskey(true);
      setErrorMsg(null);
      try {
        const proof = await authenticateSupervisorWithSupabase(supervisorEmail.trim(), pin);
        await onAuthorized({ ...selectedSupervisor, email: supervisorEmail.trim() }, overrideReason || actionDescription, proof.accessToken);
        onClose();
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : 'Supervisor reauthentication failed.');
        setPin('');
      } finally {
        setIsVerifyingPasskey(false);
      }
      return;
    }
    // Check known PINs: custom supervisor pin, admin '1234', manager '5678'
    let matchedSupervisor: User | undefined;

    if (selectedSupervisor && getStaffPin(selectedSupervisor.id) === pin) {
      matchedSupervisor = selectedSupervisor;
    } else if (import.meta.env.DEV && pin === '1234') {
      matchedSupervisor = eligibleSupervisors.find((u) => u.role === 'admin') || selectedSupervisor || eligibleSupervisors[0];
    } else if (import.meta.env.DEV && pin === '5678') {
      matchedSupervisor = eligibleSupervisors.find((u) => u.role === 'manager') || selectedSupervisor || eligibleSupervisors[0];
    } else {
      // Check all eligible supervisors
      matchedSupervisor = eligibleSupervisors.find((u) => getStaffPin(u.id) === pin);
    }

    if (matchedSupervisor) {
      playScannerSound('supervisor_authorized');
      onAuthorized(matchedSupervisor, overrideReason || actionDescription, pin);
      onClose();
    } else {
      playScannerSound('error');
      setErrorMsg(
        language === 'th'
          ? 'รหัส PIN ผู้จัดการไม่ถูกต้อง หรือไม่มีสิทธิ์อนุมัติจากเซิร์ฟเวอร์'
          : 'Invalid supervisor PIN or server authorization was not provisioned'
      );
      setPin('');
    }
  };

  const handlePasskeyOverride = async () => {
    setIsVerifyingPasskey(true);
    setErrorMsg(null);
    try {
      const target = selectedSupervisor || eligibleSupervisors[0];
      const result = await authenticatePasskey(
        target ? { id: target.id, email: target.email, name: target.name } : undefined
      );

      if (result.success && result.credential) {
        const matched = eligibleSupervisors.find(
          (u) => u.email.toLowerCase() === result.credential?.userEmail.toLowerCase()
        ) || eligibleSupervisors[0];

        playScannerSound('supervisor_authorized');
        onAuthorized(matched, `Passkey Verified: ${overrideReason || actionDescription}`);
        onClose();
      } else {
        playScannerSound('error');
        setErrorMsg(result.error || (language === 'th' ? 'ชีวมิติไม่ผ่าน' : 'Biometric verification cancelled'));
      }
    } catch (err: any) {
      playScannerSound('error');
      setErrorMsg(err.message || 'Biometric authentication failed');
    } finally {
      setIsVerifyingPasskey(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        title ||
        (language === 'th'
          ? 'การอนุมัติสิทธิ์ผู้จัดการ (Supervisor Authorization)'
          : 'Supervisor Authorization Required')
      }
      description={
        language === 'th'
          ? (isProduction ? 'รายการนี้ต้องได้รับการยืนยันด้วยอีเมลและรหัสผ่านบัญชีผู้จัดการ' : 'รายการนี้จำเป็นต้องได้รับการยืนยันรหัส PIN จากหัวหน้างานหรือผู้จัดการ')
          : (isProduction ? 'This action requires the supervisor Supabase email and account password.' : 'This operational action requires supervisor approval with a valid security PIN.')
      }
      maxWidth="md"
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button variant="outline" size="sm" onClick={onClose}>
            {language === 'th' ? 'ยกเลิก' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!selectedSupervisor || isLoadingSupervisors || pin.length < 4 || (isProduction && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supervisorEmail.trim())) || isVerifyingPasskey}
            onClick={() => void handleVerifyPin()}
            leftIcon={<ShieldCheck className="h-4 w-4" />}
          >
            {language === 'th' ? 'ยืนยันอนุมัติ' : 'Authorize Action'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 select-none">
        {/* Action Target Banner */}
        <div className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/10 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2.5">
          <ShieldAlert className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-semibold">
              {language === 'th' ? 'รายการที่ต้องขออนุมัติ:' : 'Action pending approval:'}
            </span>
            <p className="text-text/80 leading-relaxed font-medium">
              {actionDescription}
            </p>
          </div>
        </div>

        {/* Supervisor Selection Chips */}
        <div>
          <label className="text-[11px] font-semibold text-text/60 uppercase tracking-wider block mb-1.5">
            {language === 'th' ? 'เลือกผู้อนุมัติ (Supervisor):' : 'Select Authorizing Supervisor:'}
          </label>
          {isLoadingSupervisors ? (
            <p className="text-xs text-text/60 py-3">{language === 'th' ? 'กำลังโหลดรายชื่อผู้จัดการ...' : 'Loading eligible supervisors...'}</p>
          ) : eligibleSupervisors.length === 0 ? (
            <p className="text-xs text-rose-600 dark:text-rose-400 py-3">{language === 'th' ? 'ไม่พบผู้จัดการที่มีสิทธิ์ในสาขานี้' : 'No eligible supervisors are available for this store.'}</p>
          ) : (
          <div className="grid grid-cols-2 gap-2">
            {eligibleSupervisors.map((sup) => {
              const isSelected = selectedSupervisor?.id === sup.id;
              return (
                <button
                  key={sup.id}
                  type="button"
                  onClick={() => {
                    setSelectedSupervisor(sup);
                    setSupervisorEmail('');
                    setPin('');
                    setErrorMsg(null);
                  }}
                  className={`p-2.5 rounded-lg border text-left flex items-center justify-between cursor-pointer transition-all ${
                    isSelected
                      ? 'border-primary bg-primary/10 ring-1 ring-primary'
                      : 'border-border border-crisp hover:bg-background/60'
                  }`}
                >
                  <div className="min-w-0 pr-1">
                    <div className="text-xs font-semibold text-text truncate">
                      {sup.name}
                    </div>
                    <div className="text-[10px] text-text/60 capitalize">
                      {sup.role} ({sup.employeeCode})
                    </div>
                  </div>
                  {isSelected && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                </button>
              );
            })}
          </div>
          )}
        </div>

        {isProduction ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <label htmlFor="supervisor-account-email" className="text-xs font-semibold text-text/80 block">
                {language === 'th' ? 'อีเมลบัญชีผู้จัดการ (Supabase Auth)' : 'Supervisor Account Email (Supabase Auth)'}
              </label>
              <input
                id="supervisor-account-email"
                type="email"
                value={supervisorEmail}
                disabled={!selectedSupervisor || isLoadingSupervisors || isVerifyingPasskey}
                onChange={(event) => { setSupervisorEmail(event.target.value); setErrorMsg(null); }}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="name@example.com"
              />
            </div>
            <div className="space-y-2">
            <label htmlFor="supervisor-account-password" className="text-xs font-semibold text-text/80 block">
              {language === 'th' ? 'รหัสผ่านบัญชีผู้จัดการ (Supabase Auth)' : 'Supervisor Account Password (Supabase Auth)'}
            </label>
            <input
              id="supervisor-account-password"
              type="password"
              value={pin}
              disabled={!selectedSupervisor || isLoadingSupervisors || isVerifyingPasskey}
              onChange={(event) => { setPin(event.target.value); setErrorMsg(null); }}
              autoComplete="current-password"
              autoCapitalize="none"
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder={language === 'th' ? 'กรอกรหัสผ่านผู้จัดการ' : 'Enter supervisor account password'}
            />
            {errorMsg && <div className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5" /><span>{errorMsg}</span></div>}
            <p className="text-[11px] text-text/50">{language === 'th' ? 'เซิร์ฟเวอร์จะตรวจสอบอีเมล รหัสผ่าน ตัวตน และสิทธิ์อนุมัติทุกครั้ง' : 'The server verifies the email, password, identity, and approval permission for every request.'}</p>
            </div>
          </div>
        ) : (
          <>
            {/* PIN Input Indicator */}
            <div className="text-center py-2 space-y-2">
              <div className="flex justify-center items-center gap-2">
                <Lock className="h-4 w-4 text-text/50" />
                <span className="text-xs font-semibold text-text/80">
                  {language === 'th' ? 'ใส่รหัส PIN 4-6 หลัก' : 'Enter 4-6 Digit Security PIN'}
                </span>
              </div>
              <div className="flex justify-center items-center gap-3">
                {[0, 1, 2, 3, 4, 5].map((index) => {
                  const isFilled = pin.length > index;
                  return <div key={index} className={`w-3.5 h-3.5 rounded-full border transition-all duration-150 ${isFilled ? 'bg-primary border-primary scale-110 shadow-xs' : 'border-border border-crisp bg-background'}`} />;
                })}
              </div>
              {errorMsg ? (
                <div className="text-xs font-semibold text-rose-600 dark:text-rose-400 flex items-center justify-center gap-1"><AlertCircle className="h-3.5 w-3.5" /><span>{errorMsg}</span></div>
              ) : (
                <div className="text-[11px] text-text/50">{language === 'th' ? (import.meta.env.DEV ? 'คำใบ้ทดสอบ: Admin = 1234, Manager = 5678' : 'การอนุมัติจะตรวจสอบกับเซิร์ฟเวอร์') : (import.meta.env.DEV ? 'Demo Hint: Admin = 1234, Manager = 5678' : 'Supervisor authorization is verified by the server')}</div>
              )}
            </div>
            {/* Numeric Keypad */}
            <div className="grid grid-cols-3 gap-2 max-w-xs mx-auto">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button key={digit} type="button" onClick={() => handleKeyPress(digit)} className="h-11 rounded-lg bg-background hover:bg-background dark:hover:bg-slate-700 active:bg-primary active:text-white font-mono font-semibold text-sm text-text border border-border border-crisp transition-all cursor-pointer shadow-2xs">{digit}</button>
              ))}
              <button type="button" onClick={handleClear} className="h-11 rounded-lg bg-background hover:bg-background dark:hover:bg-slate-700 text-xs font-semibold text-text/70 border border-border border-crisp transition-all cursor-pointer">{language === 'th' ? 'ล้าง' : 'Clear'}</button>
              <button type="button" onClick={() => handleKeyPress('0')} className="h-11 rounded-lg bg-background hover:bg-background dark:hover:bg-slate-700 active:bg-primary active:text-white font-mono font-semibold text-sm text-text border border-border border-crisp transition-all cursor-pointer shadow-2xs">0</button>
              <button type="button" onClick={handleDelete} className="h-11 rounded-lg bg-background hover:bg-background dark:hover:bg-slate-700 flex items-center justify-center text-text/70 border border-border border-crisp transition-all cursor-pointer"><Delete className="h-4 w-4" /></button>
            </div>
          </>
        )}

        {/* Biometric passkey is available only in the local mock flow; production
            authorization must use a server-verified Supabase identity proof. */}
        {import.meta.env.DEV && !isProduction && <div className="pt-2 max-w-xs mx-auto">
          <button
            type="button"
            onClick={handlePasskeyOverride}
            disabled={isVerifyingPasskey}
            className="w-full h-11 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98 shadow-xs"
          >
            {isVerifyingPasskey ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Fingerprint className="w-4 h-4" />
                <span>
                  {language === 'th'
                    ? 'อนุมัติด้วยชีวมิติผู้จัดการ (Passkey)'
                    : 'Authorize with Manager Passkey'}
                </span>
              </>
            )}
          </button>
        </div>}
      </div>
    </Modal>
  );
};
