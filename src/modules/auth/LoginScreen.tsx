import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Clock3,
  Globe2,
  Lock,
  RefreshCw,
  ShieldCheck,
  WifiOff,
  X,
} from 'lucide-react';
import { auditService } from '../../services/auditService';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import {
  getOrganizations,
  getBranches,
  getTerminals,
} from '../../services/organizationService';
import { Organization, Branch, Terminal } from '../settings/types';
import { OperationalScope } from '../../domain/auth';
import { OrganizationLoginContext } from '../../adapters/types';
import { TERMINAL_SCOPE_STORAGE_KEYS } from './OrganizationSelection';
import { ProdxVectorMark } from '../../components/common/ProdxLogo';
import {
  checkWebAuthnCapability,
  getRegisteredPasskeys,
  PasskeyCredentialRecord,
  WebAuthnCapability,
} from '../../services/webauthnService';
import { PasskeyEnrollModal } from '../../components/auth/PasskeyEnrollModal';

import { TerminalScopeBar } from './TerminalScopeBar';
import { OperatorPinPad } from './OperatorPinPad';
import { BiometricAuthPanel } from './BiometricAuthPanel';
import { QrBadgeScannerPanel } from './QrBadgeScannerPanel';
import { EmailPasswordForm } from './EmailPasswordForm';

const BIOMETRIC_REMEMBER_STORAGE_KEY = 'prodx.auth.remember_biometrics';
const BIOMETRIC_REMEMBER_PASSKEY_ID_KEY = 'prodx.auth.remembered_passkey_id';

const readTerminalValue = (key: string, env?: string) => {
  if (typeof window === 'undefined') return env?.trim() ?? '';
  try {
    return window.localStorage.getItem(key)?.trim() || env?.trim() || '';
  } catch {
    return env?.trim() ?? '';
  }
};

const readRememberBiometricsPreference = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(BIOMETRIC_REMEMBER_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

export interface LoginScreenProps {
  onOpenAdminLogin?: () => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onOpenAdminLogin }) => {
  const { login, loginWithBiometrics, forgotPin, isLoading, operationalScope, setOperationalScope } =
    useAuth();
  const { language, setLanguage } = useLanguage();
  const { addToast } = useToast();
  const isThai = language === 'th';

  const [selectedOrgId, setSelectedOrgId] = useState<string>(
    () => operationalScope?.organizationId || readTerminalValue(TERMINAL_SCOPE_STORAGE_KEYS.organization),
  );
  const [selectedBranchId, setSelectedBranchId] = useState<string>(
    () => operationalScope?.branchId || readTerminalValue(TERMINAL_SCOPE_STORAGE_KEYS.store),
  );
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>(
    () => operationalScope?.terminalId || readTerminalValue(TERMINAL_SCOPE_STORAGE_KEYS.register),
  );

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [isFetching, setIsFetching] = useState<boolean>(true);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isFetchingBranches, setIsFetchingBranches] = useState<boolean>(false);
  const [isFetchingTerminals, setIsFetchingTerminals] = useState<boolean>(false);

  const [pin, setPin] = useState('');
  const [loginMode, setLoginMode] = useState<'pin' | 'biometric' | 'email' | 'qr'>(() =>
    readRememberBiometricsPreference() ? 'biometric' : 'pin',
  );
  const [clock, setClock] = useState('');
  const [isScopeBarExpanded, setIsScopeBarExpanded] = useState<boolean>(false);

  const [webauthnCapability, setWebauthnCapability] = useState<WebAuthnCapability | null>(null);
  const [enrolledPasskeys, setEnrolledPasskeys] = useState<PasskeyCredentialRecord[]>(() =>
    getRegisteredPasskeys(),
  );
  const [selectedPasskeyId, setSelectedPasskeyId] = useState<string>(() => {
    const keys = getRegisteredPasskeys();
    const rememberedId = readTerminalValue(BIOMETRIC_REMEMBER_PASSKEY_ID_KEY);
    if (rememberedId && keys.some((k) => k.id === rememberedId)) {
      return rememberedId;
    }
    return keys[0]?.id || '';
  });
  const [isBiometricVerifying, setIsBiometricVerifying] = useState<boolean>(false);
  const [isEnrollModalOpen, setIsEnrollModalOpen] = useState<boolean>(false);
  const hasAutoInitiatedBiometricRef = useRef<boolean>(false);

  type LoginErrorType = 'network' | 'credentials' | 'mapping' | null;

  interface LoginErrorInfo {
    type: LoginErrorType;
    title: string;
    message: string;
  }

  const [loginError, setLoginError] = useState<LoginErrorInfo | null>(null);

  const navigateToAdminLogin = () => {
    if (onOpenAdminLogin) {
      onOpenAdminLogin();
      return;
    }
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/admin/login');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const copy = useMemo(
    () =>
      isThai
        ? {
            eyebrow: 'PRODX POS · OPERATOR CONSOLE',
            title: 'พร้อมเริ่มกะการขาย',
            subtitle: 'ยืนยันตัวตนพนักงานแคชเชียร์เพื่อเปิดใช้งานเครื่อง POS',
            signIn: 'เข้าสู่ระบบพนักงาน POS',
            organization: 'องค์กร',
            store: 'สาขา',
            register: 'เครื่องขาย POS',
            verified: 'Secure Enterprise Login',
            language: 'English',
            adminLoginBtn: 'Admin Login',
          }
        : {
            eyebrow: 'PRODX POS · OPERATOR CONSOLE',
            title: 'Ready for your shift',
            subtitle: 'Authenticate cashier operator to access POS terminal.',
            signIn: 'Sign in to POS Terminal',
            organization: 'Organization',
            store: 'Store Branch',
            register: 'POS Terminal',
            verified: 'Secure Enterprise Login',
            language: 'ไทย',
            adminLoginBtn: 'Admin Login',
          },
    [isThai],
  );

  const selectedOrganization = useMemo(
    () => orgs.find((o) => o.id === selectedOrgId || o.slug === selectedOrgId) ?? null,
    [orgs, selectedOrgId],
  );

  const selectedBranch = useMemo(
    () => branches.find((b) => b.id === selectedBranchId || b.name === selectedBranchId) ?? null,
    [branches, selectedBranchId],
  );

  const selectedTerminal = useMemo(
    () => terminals.find((t) => t.id === selectedTerminalId || t.code === selectedTerminalId) ?? null,
    [terminals, selectedTerminalId],
  );

  const organizationContext = useMemo<OrganizationLoginContext | null>(() => {
    if (!selectedOrganization || !selectedBranch || !selectedTerminal) return null;
    return {
      organizationId: selectedOrganization.id,
      organizationName: selectedOrganization.name,
      organizationSlug: selectedOrganization.slug,
      branchId: selectedBranch.id,
      branchName: selectedBranch.name,
      branchCode: selectedBranch.code || '',
      branchAddress: selectedBranch.address || '',
      terminalId: selectedTerminal.id,
      terminalName: selectedTerminal.name,
      terminalCode: selectedTerminal.code,
    };
  }, [selectedOrganization, selectedBranch, selectedTerminal]);

  const isOrgValid = Boolean(selectedOrgId && selectedOrganization);
  const isBranchValid = Boolean(isOrgValid && selectedBranchId && selectedBranch);
  const isTerminalValid = Boolean(isBranchValid && selectedTerminalId && selectedTerminal);
  const terminalReady = isOrgValid && isBranchValid && isTerminalValid && Boolean(organizationContext);

  const loadFirestoreCatalog = useCallback(async () => {
    setIsFetching(true);
    setIsInitialLoading(true);
    try {
      const fetchedOrgs = await getOrganizations();
      setOrgs(fetchedOrgs);

      const activeOrgId = selectedOrgId || operationalScope?.organizationId;
      const targetOrg =
        (activeOrgId && fetchedOrgs.find((o) => o.id === activeOrgId || o.slug === activeOrgId)) ||
        fetchedOrgs[0];

      if (targetOrg) {
        setSelectedOrgId(targetOrg.id);
        const fetchedBranches = await getBranches(targetOrg.id);
        setBranches(fetchedBranches);

        const activeBranchId = selectedBranchId || operationalScope?.branchId;
        const targetBranch =
          (activeBranchId &&
            fetchedBranches.find(
              (b) => b.id === activeBranchId || b.name === activeBranchId || b.code === activeBranchId,
            )) ||
          fetchedBranches[0];

        if (targetBranch) {
          setSelectedBranchId(targetBranch.id);
          const fetchedTerminals = await getTerminals(targetBranch.id, targetOrg.id);
          setTerminals(fetchedTerminals);

          const activeTerminalId = selectedTerminalId || operationalScope?.terminalId;
          const targetTerminal =
            (activeTerminalId &&
              fetchedTerminals.find(
                (t) => t.id === activeTerminalId || t.code === activeTerminalId,
              )) ||
            fetchedTerminals[0];

          if (targetTerminal) {
            setSelectedTerminalId(targetTerminal.id);
            const scope: OperationalScope = {
              organizationId: targetOrg.id,
              organizationName: targetOrg.name,
              organizationSlug: targetOrg.slug,
              branchId: targetBranch.id,
              branchName: targetBranch.name,
              branchCode: targetBranch.code || targetBranch.name,
              branchAddress: targetBranch.address || '',
              terminalId: targetTerminal.id,
              terminalName: targetTerminal.name,
              terminalCode: targetTerminal.code,
            };
            setOperationalScope(scope);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load Firestore catalog:', err);
    } finally {
      setIsFetching(false);
      setIsInitialLoading(false);
    }
  }, [selectedOrgId, selectedBranchId, selectedTerminalId, operationalScope, setOperationalScope]);

  const initialMountFetchRef = useRef(false);
  useEffect(() => {
    if (initialMountFetchRef.current) return;
    initialMountFetchRef.current = true;
    void loadFirestoreCatalog();
  }, [loadFirestoreCatalog]);

  useEffect(() => {
    if (isFetching) return;
    if (terminalReady && organizationContext) {
      setOperationalScope(organizationContext);
    } else {
      setOperationalScope(null);
      setPin('');
    }
  }, [isFetching, terminalReady, organizationContext, setOperationalScope]);

  const handleOrganizationChange = async (nextOrgId: string) => {
    setSelectedOrgId(nextOrgId);
    setSelectedBranchId('');
    setSelectedTerminalId('');
    setBranches([]);
    setTerminals([]);
    setOperationalScope(null);
    if (!nextOrgId) return;
    const nextOrg = orgs.find((o) => o.id === nextOrgId || o.slug === nextOrgId);
    if (!nextOrg) return;
    setIsFetching(true);
    try {
      const freshBranches = await getBranches(nextOrg.id);
      setBranches(freshBranches);
    } catch (err) {
      console.error(err);
    } finally {
      setIsFetching(false);
    }
  };

  const handleBranchChange = async (nextBranchId: string) => {
    setSelectedBranchId(nextBranchId);
    setSelectedTerminalId('');
    setTerminals([]);
    setOperationalScope(null);
    if (!nextBranchId || !selectedOrganization) return;
    const nextBranch = branches.find((b) => b.id === nextBranchId || b.name === nextBranchId);
    if (!nextBranch) return;
    setIsFetching(true);
    try {
      const freshTerminals = await getTerminals(nextBranch.id, selectedOrganization.id);
      setTerminals(freshTerminals);
    } catch (err) {
      console.error(err);
    } finally {
      setIsFetching(false);
    }
  };

  const handleTerminalChange = (nextTerminalId: string) => {
    setSelectedTerminalId(nextTerminalId);
    if (!nextTerminalId) {
      setOperationalScope(null);
      return;
    }
    const nextTerminal = terminals.find((t) => t.id === nextTerminalId || t.code === nextTerminalId);
    if (nextTerminal && selectedOrganization && selectedBranch) {
      const scope: OperationalScope = {
        organizationId: selectedOrganization.id,
        organizationName: selectedOrganization.name,
        organizationSlug: selectedOrganization.slug,
        branchId: selectedBranch.id,
        branchName: selectedBranch.name,
        branchCode: selectedBranch.code || '',
        branchAddress: selectedBranch.address || '',
        terminalId: nextTerminal.id,
        terminalName: nextTerminal.name,
        terminalCode: nextTerminal.code,
      };
      setOperationalScope(scope);
      setIsScopeBarExpanded(false);
    }
  };

  const persistTerminal = () => {
    if (!organizationContext) return;
    setOperationalScope(organizationContext);
    try {
      window.localStorage.setItem(TERMINAL_SCOPE_STORAGE_KEYS.organization, organizationContext.organizationId);
      window.localStorage.setItem(TERMINAL_SCOPE_STORAGE_KEYS.store, organizationContext.branchId);
      window.localStorage.setItem(TERMINAL_SCOPE_STORAGE_KEYS.register, organizationContext.terminalId);
    } catch {}
  };

  const performLogin = async (identity: string, secret: string) => {
    if (!terminalReady || !organizationContext) {
      addToast({ title: 'Scope Required', message: 'Please select POS terminal scope first.', type: 'error' });
      return;
    }
    try {
      persistTerminal();
      await login({
        organizationSlug: organizationContext.organizationSlug,
        storeCode: organizationContext.branchName,
        registerId: organizationContext.terminalCode,
        emailOrPin: identity,
        passwordOrPin: secret,
        organizationContext,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoginError({ type: 'credentials', title: 'Login Failed', message: msg });
      addToast({ title: 'Authentication Failed', message: msg, type: 'error' });
      setPin('');
    }
  };

  const handlePinInput = (digit: string) => {
    if (!terminalReady) {
      addToast({ title: 'Scope Required', message: 'Please select POS terminal scope first.', type: 'warning' });
      return;
    }
    if (pin.length < 6) {
      const nextPin = pin + digit;
      setPin(nextPin);
      if (nextPin.length >= 4) {
        void performLogin(nextPin, nextPin);
      }
    }
  };

  const handlePinClear = () => setPin('');
  const handlePinDelete = () => setPin((prev) => prev.slice(0, -1));

  const refreshPasskeysAndCapability = useCallback(async () => {
    const keys = getRegisteredPasskeys();
    setEnrolledPasskeys(keys);
    setSelectedPasskeyId((prev) => (keys.some((k) => k.id === prev) ? prev : keys[0]?.id || ''));
    const cap = await checkWebAuthnCapability();
    setWebauthnCapability(cap);
  }, []);

  useEffect(() => {
    void refreshPasskeysAndCapability();
  }, [refreshPasskeysAndCapability]);

  useEffect(() => {
    const update = () =>
      setClock(
        new Intl.DateTimeFormat(isThai ? 'th-TH' : 'en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        }).format(new Date()),
      );
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, [isThai]);

  const handleBiometricLogin = useCallback(
    async (targetRecord?: PasskeyCredentialRecord) => {
      if (isLoading || isBiometricVerifying) return;
      if (!terminalReady || !organizationContext) {
        setIsScopeBarExpanded(true);
        addToast({
          title: isThai ? 'กรุณาเลือกเครื่องขาย' : 'Scope Required',
          message: isThai ? 'กรุณาเลือกสาขาและเครื่องขาย POS ก่อนเริ่มเข้ากะ' : 'Please select POS terminal scope first.',
          type: 'warning',
        });
        return;
      }

      const chosenPasskey =
        targetRecord ||
        enrolledPasskeys.find((k) => k.id === selectedPasskeyId) ||
        enrolledPasskeys[0];

      setIsBiometricVerifying(true);
      setLoginError(null);

      try {
        persistTerminal();
        const verification = await loginWithBiometrics({
          organizationSlug: organizationContext.organizationSlug,
          storeCode: organizationContext.branchName,
          registerId: organizationContext.terminalCode,
          organizationContext,
          targetUser: chosenPasskey
            ? {
                id: chosenPasskey.userId,
                email: chosenPasskey.userEmail,
                name: chosenPasskey.userName,
              }
            : undefined,
        });

        if (!verification.verified || !verification.credential) {
          throw new Error(verification.error || 'Biometric verification failed.');
        }

        addToast({
          title: isThai ? 'ยืนยันตัวตนชีวมิติสำเร็จ' : 'Biometric Verified',
          message: `Signed in as ${verification.credential.userName}`,
          type: 'success',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setLoginError({ type: 'credentials', title: 'Biometric Error', message: msg });
        addToast({ title: 'Biometric Error', message: msg, type: 'error' });
      } finally {
        setIsBiometricVerifying(false);
      }
    },
    [isLoading, isBiometricVerifying, terminalReady, organizationContext, enrolledPasskeys, selectedPasskeyId, isThai, addToast, loginWithBiometrics],
  );

  return (
    <main className="h-[100svh] w-screen overflow-hidden bg-white text-slate-950 font-sans flex flex-col lg:grid lg:grid-cols-[40%_60%]">
      {/* Visual Sidebar */}
      <section className="relative hidden overflow-hidden bg-[#07111f] text-white lg:flex flex-col justify-between p-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,107,26,0.15),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(16,91,145,0.2),transparent_40%)]" />
        <div className="relative z-10 flex items-center gap-4">
          <ProdxVectorMark size={48} className="shadow-2xl rounded-2xl" />
          <div>
            <div className="text-2xl font-black tracking-tighter">
              PRODX<span className="font-light text-slate-400">POS</span>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">
              Enterprise POS Engine
            </div>
          </div>
        </div>

        <div className="relative z-10 max-w-md my-auto space-y-4">
          <div className="inline-flex items-center gap-2 rounded-md bg-sky-500/10 border border-sky-500/30 px-3 py-1">
            <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-300">{copy.verified}</span>
          </div>
          <h1 className="text-4xl xl:text-5xl font-black tracking-tight leading-tight">
            {isThai ? 'จุดชำระเงินอัจฉริยะ' : 'High-Performance'} <br />
            <span className="text-[#ff6b1a]">{isThai ? 'ระดับองค์กร' : 'Retail POS Station'}</span>
          </h1>
          <p className="text-sm text-slate-300 leading-relaxed">
            {isThai
              ? 'ระบบจัดการหน้าร้านความเร็วสูง รองรับออฟไลน์ซิงค์และบันทึกความปลอดภัยระดับสูงสุด'
              : 'Empowering enterprise retail with rapid checkout, offline resilience, and secure auditing.'}
          </p>
        </div>

        <div className="relative z-10 pt-6 border-t border-white/10 flex items-center justify-between text-xs text-slate-400 font-bold">
          <span>POS Terminal Operator Authentication</span>
          <div>© PRODX POS</div>
        </div>
      </section>

      {/* Main Zero-Scroll Authentication Panel */}
      <section className="flex-1 flex flex-col justify-between bg-white overflow-hidden p-4 sm:p-6 lg:p-8">
        <header className="flex items-center justify-between gap-4 pb-4 border-b border-slate-100 shrink-0">
          <div className="lg:hidden flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-slate-950 text-white font-black flex items-center justify-center text-sm">P</div>
            <span className="font-black text-lg">PRODX<span className="text-primary">POS</span></span>
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <div className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-800">
              <Clock3 className="w-3.5 h-3.5 text-slate-700" />
              <span>{clock}</span>
            </div>
            <button
              type="button"
              onClick={navigateToAdminLogin}
              className="flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] bg-slate-900 text-white rounded-lg text-xs font-black hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-[#ff6b1a] focus-visible:ring-offset-2 transition-all shadow-xs cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-[#ff6b1a]" />
              <span>{copy.adminLoginBtn}</span>
            </button>
            <button
              type="button"
              onClick={() => setLanguage(isThai ? 'en' : 'th')}
              className="flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] border-2 border-slate-300 rounded-lg text-xs font-black text-slate-900 hover:border-slate-900 focus-visible:ring-2 focus-visible:ring-[#ff6b1a] focus-visible:ring-offset-2 cursor-pointer"
            >
              <Globe2 className="w-3.5 h-3.5 text-slate-800" />
              <span>{copy.language}</span>
            </button>
          </div>
        </header>

        {/* Dynamic Body: Zero-Scroll Compact Layout */}
        <div className="flex-1 flex flex-col justify-center max-w-[440px] mx-auto w-full py-4 space-y-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#c2410c] dark:text-[#ff8c42] mb-1">
              {copy.eyebrow}
            </div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">{copy.title}</h2>
            <p className="text-xs text-slate-600 font-medium">{copy.subtitle}</p>
          </div>

          {/* Compact Terminal Scope Bar */}
          <TerminalScopeBar
            isThai={isThai}
            isInitialLoading={isInitialLoading}
            isFetching={isFetching}
            terminalReady={terminalReady}
            organizationContext={organizationContext}
            selectedOrgId={selectedOrgId}
            selectedBranchId={selectedBranchId}
            selectedTerminalId={selectedTerminalId}
            orgs={orgs}
            branches={branches}
            terminals={terminals}
            isOrgValid={isOrgValid}
            isBranchValid={isBranchValid}
            isTerminalValid={isTerminalValid}
            onOrganizationChange={handleOrganizationChange}
            onBranchChange={handleBranchChange}
            onTerminalChange={handleTerminalChange}
            onSyncCatalog={loadFirestoreCatalog}
            isExpanded={isScopeBarExpanded}
            onToggleExpand={() => setIsScopeBarExpanded((prev) => !prev)}
          />

          {/* Login Error Notification Banner */}
          {loginError && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 flex items-start gap-2.5 text-xs text-rose-900">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-black">{loginError.title}</div>
                <div>{loginError.message}</div>
              </div>
              <button type="button" onClick={() => setLoginError(null)} className="text-rose-400 hover:text-rose-600">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Operator Authentication Mode Panels */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            {loginMode === 'pin' && (
              <OperatorPinPad
                isThai={isThai}
                terminalReady={terminalReady}
                isLoading={isLoading}
                pin={pin}
                onPinInput={handlePinInput}
                onPinClear={handlePinClear}
                onPinDelete={handlePinDelete}
                onSubmit={() => void performLogin(pin, pin)}
                onSwitchMode={(mode) => setLoginMode(mode)}
                onForgotPin={() => {
                  setLoginMode('email');
                }}
                onTriggerScopeError={() => setIsScopeBarExpanded(true)}
                hasRegisteredBiometrics={enrolledPasskeys.length > 0}
                isBiometricVerifying={isBiometricVerifying}
                activePasskey={
                  enrolledPasskeys.find((k) => k.id === selectedPasskeyId) ||
                  enrolledPasskeys[0]
                }
                onQuickBiometricSignIn={() => void handleBiometricLogin()}
              />
            )}

            {loginMode === 'biometric' && (
              <BiometricAuthPanel
                isThai={isThai}
                terminalReady={terminalReady}
                isLoading={isLoading}
                isBiometricVerifying={isBiometricVerifying}
                enrolledPasskeys={enrolledPasskeys}
                selectedPasskeyId={selectedPasskeyId}
                webauthnCapability={webauthnCapability}
                onSelectPasskey={setSelectedPasskeyId}
                onScanBiometric={handleBiometricLogin}
                onOpenEnrollModal={() => setIsEnrollModalOpen(true)}
                onSwitchMode={(mode) => setLoginMode(mode)}
              />
            )}

            {loginMode === 'qr' && (
              <QrBadgeScannerPanel
                isThai={isThai}
                terminalReady={terminalReady}
                isLoading={isLoading}
                onScan={(res) => {
                  if (res?.[0]?.rawValue) {
                    void performLogin(res[0].rawValue, res[0].rawValue);
                  }
                }}
                onSwitchMode={(mode) => setLoginMode(mode)}
              />
            )}

            {loginMode === 'email' && (
              <EmailPasswordForm
                isThai={isThai}
                terminalReady={terminalReady}
                isLoading={isLoading}
                onSubmit={(email, pass) => void performLogin(email, pass)}
                onSwitchMode={(mode) => setLoginMode(mode)}
                onForgotPin={() => {
                  addToast({ title: 'Password Reset', message: 'Reset email requested.', type: 'info' });
                }}
              />
            )}
          </div>
        </div>

        <footer className="pt-3 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-600 font-medium shrink-0">
          <div>PRODX POS v2.5 · Enterprise Edition</div>
          <div className="flex items-center gap-1.5">
            <Lock className="w-3 h-3 text-emerald-600" />
            <span className="text-emerald-700 font-bold">Encrypted Session</span>
          </div>
        </footer>
      </section>

      {/* Passkey Enrollment Modal */}
      {isEnrollModalOpen && (
        <PasskeyEnrollModal
          isOpen={isEnrollModalOpen}
          onClose={() => {
            setIsEnrollModalOpen(false);
            void refreshPasskeysAndCapability();
          }}
        />
      )}
    </main>
  );
};
