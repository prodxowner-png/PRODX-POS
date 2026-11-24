import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Clock3,
  Globe2,
  ShieldCheck,
  Sun,
  X,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { useTheme } from '../../context/ThemeContext';
import {
  getOrganizations,
  getBranches,
  getTerminals,
} from '../../services/organizationService';
import { Organization, Branch, Terminal } from '../settings/types';
import { OperationalScope } from '../../domain/auth';
import { OrganizationLoginContext } from '../../adapters/types';
import { TERMINAL_SCOPE_STORAGE_KEYS } from './OrganizationSelection';
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
import { PosTerminalIllustration } from './PosTerminalIllustration';

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
  const { login, loginWithBiometrics, isLoading, operationalScope, setOperationalScope } =
    useAuth();
  const { language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
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
    <main className="min-h-[100svh] w-screen overflow-x-hidden bg-[#FAF5EE] text-[#183D32] font-sans flex flex-col justify-center items-center p-3 sm:p-6 lg:p-10">
      <div className="w-full max-w-6xl flex flex-col lg:grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
        {/* Left Side: Desktop Visual Hero (Retail Minimart Scene) */}
        <section className="hidden lg:flex flex-col justify-between w-full h-full min-h-[580px] p-6 xl:p-8">
          <PosTerminalIllustration isThai={isThai} />
        </section>

        {/* Right Side: Exact Reference Floating Card (#FFF7ED) */}
        <section className="w-full flex items-center justify-center">
          <article
            className="relative w-full max-w-[420px] sm:max-w-[440px] rounded-[28px] sm:rounded-[32px] bg-[#FFF7ED] border border-[#F5E1D0] p-6 sm:p-7 shadow-2xl shadow-orange-950/10 overflow-hidden"
            aria-labelledby="login-card-title"
          >
            {/* Top-Left Organic Decorative Orange Swoosh */}
            <svg
              className="absolute -top-2 -left-2 w-28 h-28 pointer-events-none z-0"
              viewBox="0 0 120 120"
              fill="none"
              aria-hidden="true"
            >
              <path d="M0 70 C 25 35, 50 15, 95 0 L 0 0 Z" fill="#F97316" fillOpacity="0.2" />
              <path d="M0 50 C 20 25, 40 10, 75 0 L 0 0 Z" fill="#F97316" fillOpacity="0.38" />
            </svg>

            {/* Bottom-Right Organic Decorative Orange Swoosh */}
            <svg
              className="absolute -bottom-2 -right-2 w-28 h-28 pointer-events-none z-0"
              viewBox="0 0 120 120"
              fill="none"
              aria-hidden="true"
            >
              <path d="M120 50 C 95 85, 70 105, 25 120 L 120 120 Z" fill="#F97316" fillOpacity="0.2" />
              <path d="M120 70 C 100 95, 80 110, 45 120 L 120 120 Z" fill="#F97316" fillOpacity="0.38" />
            </svg>

            <div className="relative z-10 space-y-4">
              {/* Top Controls: Admin link + Language + Theme Toggle */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={navigateToAdminLogin}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/80 border border-[#E2E8F0] hover:border-[#183D32] text-[11px] font-black text-[#183D32] transition-all cursor-pointer shadow-2xs"
                  aria-label="Admin Portal"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-[#F97316]" />
                  <span>Admin</span>
                </button>

                <div className="flex items-center gap-2">
                  {/* Language Selector Pill */}
                  <button
                    type="button"
                    onClick={() => setLanguage(isThai ? 'en' : 'th')}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-white/80 border border-[#E2E8F0] hover:border-[#183D32] text-xs font-black text-[#183D32] transition-all cursor-pointer shadow-2xs"
                    aria-label={isThai ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
                  >
                    <Globe2 className="w-3.5 h-3.5 text-[#64748B]" />
                    <span>{isThai ? 'TH' : 'EN'}</span>
                    <ChevronDown className="w-3 h-3 text-[#64748B]" />
                  </button>

                  {/* Theme Toggle Button (Sun icon in circular beige button) */}
                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="w-8 h-8 rounded-full bg-[#F5E1D0] hover:bg-[#EAD4C2] flex items-center justify-center transition-colors cursor-pointer shadow-2xs"
                    aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                  >
                    <Sun className="w-4 h-4 text-[#EA580C]" />
                  </button>
                </div>
              </div>

              {/* Card Brand Header */}
              <header className="text-center pt-1 pb-1">
                <div className="flex flex-col items-center justify-center">
                  <div className="w-12 h-12 rounded-2xl bg-[#F97316] text-white font-black text-2xl flex items-center justify-center shadow-md shadow-orange-500/25">
                    P
                  </div>
                  <div className="mt-2 text-xl font-black text-[#183D32] tracking-tight">
                    PRODX <span className="text-[#F97316]">POS</span>
                  </div>
                  <div className="text-[9px] font-bold uppercase tracking-[0.26em] text-[#64748B] mt-0.5">
                    - PROFESSIONAL POS SYSTEM -
                  </div>
                </div>

                <h2 id="login-card-title" className="text-2xl sm:text-3xl font-black text-[#183D32] tracking-tight mt-3">
                  {isThai ? 'เข้าสู่ระบบ' : 'Sign In'}
                </h2>
                <p className="text-xs text-[#5A616D] font-medium mt-1">
                  {isThai
                    ? 'ยินดีต้อนรับสู่ระบบจัดการร้านค้า PRODX POS'
                    : 'Welcome to PRODX POS Retail Management'}
                </p>
              </header>

              {/* Login Error Alert */}
              {loginError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 flex items-start gap-2 text-xs text-rose-900 animate-in fade-in duration-200">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="font-black">{loginError.title}</div>
                    <div>{loginError.message}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLoginError(null)}
                    aria-label="Dismiss error"
                    className="text-rose-400 hover:text-rose-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Authentication Mode Panel */}
              <div>
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
                    onForgotPin={() => setLoginMode('email')}
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

                {loginMode === 'email' && (
                  <EmailPasswordForm
                    isThai={isThai}
                    terminalReady={terminalReady}
                    isLoading={isLoading}
                    onSubmit={(em, pw) => void performLogin(em, pw)}
                    onSwitchMode={(mode) => setLoginMode(mode)}
                    onForgotPin={() => {
                      addToast({
                        title: 'Password Reset',
                        message: 'Contact administrator to reset password or PIN.',
                        type: 'info',
                      });
                    }}
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
              </div>

              {/* Scope & Terminal Status Bar */}
              <div className="pt-1">
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
              </div>

              {/* Card Footer Divider & Developer Attribution */}
              <footer className="pt-2">
                <div className="w-full border-t border-[#E2E8F0] my-2" />
                <div className="text-[10px] sm:text-[11px] font-black tracking-[0.2em] text-[#64748B] uppercase text-center">
                  — DEVELOPED BY THODSAWAT —
                </div>
              </footer>
            </div>
          </article>
        </section>
      </div>

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
