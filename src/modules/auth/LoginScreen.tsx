import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Globe2,
  Lock,
  Moon,
  ShieldCheck,
  Sun,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
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
import {
  checkWebAuthnCapability,
  getRegisteredPasskeys,
  PasskeyCredentialRecord,
  WebAuthnCapability,
} from '../../services/webauthnService';
import { webauthnApi } from '../../adapters/webauthnApi';

import { PosTerminalIllustration } from './PosTerminalIllustration';
import { TerminalScopeBar } from './TerminalScopeBar';
import { OperatorPinPad } from './OperatorPinPad';
import { BiometricAuthPanel } from './BiometricAuthPanel';
import { QrBadgeScannerPanel } from './QrBadgeScannerPanel';
import { EmailPasswordForm } from './EmailPasswordForm';
import { LoginMethod, LoginMethodSwitcher } from './LoginMethodSwitcher';

const BIOMETRIC_REMEMBER_STORAGE_KEY = 'prodx.auth.remember_biometrics';

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
  const isDark = theme === 'dark';

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
  const [loginMode, setLoginMode] = useState<LoginMethod>(() =>
    readRememberBiometricsPreference() ? 'biometric' : 'pin',
  );
  const [isScopeBarExpanded, setIsScopeBarExpanded] = useState<boolean>(false);

  const [webauthnCapability, setWebauthnCapability] = useState<WebAuthnCapability | null>(null);
  const [webauthnServerEnabled, setWebauthnServerEnabled] = useState(false);
  const [biometricUsername, setBiometricUsername] = useState('');
  const [enrolledPasskeys, setEnrolledPasskeys] = useState<PasskeyCredentialRecord[]>(() =>
    getRegisteredPasskeys(),
  );
  const [selectedPasskeyId, setSelectedPasskeyId] = useState<string>('');
  const [isBiometricVerifying, setIsBiometricVerifying] = useState<boolean>(false);

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
            title: 'เข้าสู่ระบบ',
            subtitle: 'กรอกรหัส PIN พนักงานเพื่อเริ่มกะการขาย',
            subtitleEmail: 'เข้าสู่ระบบด้วยอีเมลและรหัสผ่านพนักงาน',
            subtitleQr: 'สแกนบัตรพนักงานเพื่อเปิดใช้งานเครื่อง POS',
            subtitlePasskey: 'ยืนยันตัวตนผ่าน Passkey ของอุปกรณ์',
            language: 'EN',
            languageAria: 'สลับภาษาเป็นภาษาอังกฤษ',
            adminLoginBtn: 'Admin',
            adminLoginAria: 'ไปที่หน้าเข้าสู่ระบบผู้ดูแลระบบ',
          }
        : {
            title: 'Sign In',
            subtitle: 'Enter your operator PIN to start your shift',
            subtitleEmail: 'Sign in with your operator email and password',
            subtitleQr: 'Scan your employee QR badge to open the POS terminal',
            subtitlePasskey: 'Authenticate with your device or password manager passkey',
            language: 'ไทย',
            languageAria: 'Switch language to Thai',
            adminLoginBtn: 'Admin',
            adminLoginAria: 'Open administrator login',
          },
    [isThai],
  );

  const activeSubtitle = useMemo(() => {
    if (loginMode === 'email') return copy.subtitleEmail;
    if (loginMode === 'qr') return copy.subtitleQr;
    if (loginMode === 'biometric') return copy.subtitlePasskey;
    return copy.subtitle;
  }, [loginMode, copy]);

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
    setEnrolledPasskeys([]);
    setSelectedPasskeyId('');
    const [capability, serverStatus] = await Promise.all([
      checkWebAuthnCapability(),
      webauthnApi.status().catch(() => null),
    ]);
    setWebauthnCapability(capability);
    setWebauthnServerEnabled(serverStatus?.enabled === true);
  }, []);

  useEffect(() => {
    void refreshPasskeysAndCapability();
  }, [refreshPasskeysAndCapability]);

  const handleBiometricLogin = useCallback(
    async () => {
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

      setIsBiometricVerifying(true);
      setLoginError(null);

      try {
        persistTerminal();
        const verification = await loginWithBiometrics({
          organizationSlug: organizationContext.organizationSlug,
          storeCode: organizationContext.branchCode || organizationContext.branchName,
          registerId: organizationContext.terminalCode,
          organizationContext,
          username: biometricUsername.trim(),
        });

        if (!verification.verified) {
          throw new Error(verification.error || 'Passkey verification failed.');
        }

        addToast({
          title: isThai ? 'ยืนยันตัวตนชีวมิติสำเร็จ' : 'Biometric Verified',
          message: isThai ? 'เข้าสู่ระบบด้วย Passkey สำเร็จ' : 'Signed in with your passkey.',
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
    [isLoading, isBiometricVerifying, terminalReady, organizationContext, biometricUsername, isThai, addToast, loginWithBiometrics],
  );

  return (
    <main className="min-h-[100svh] w-full bg-brand-bg text-brand-text font-sans flex items-center justify-center p-3 sm:p-6 lg:p-10 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center">
        {/* Desktop Retail Hero Illustration */}
        <section
          aria-label={isThai ? 'ภาพรวมระบบ PRODX POS' : 'PRODX POS overview'}
          className="hidden lg:flex flex-col justify-center min-h-[600px] px-4"
        >
          <PosTerminalIllustration isThai={isThai} />
        </section>

        {/* Reference Floating Cream Card with Organic Orange Corner Swooshes */}
        <article
          aria-labelledby="login-card-title"
          className="relative w-full max-w-[460px] mx-auto rounded-[28px] border border-brand-border bg-brand-surface text-brand-text shadow-2xl overflow-hidden"
        >
          {/* Decorative Organic Orange Corner Swooshes */}
          <svg
            aria-hidden="true"
            viewBox="0 0 220 220"
            className="pointer-events-none absolute -top-12 -right-12 w-44 h-44 text-cta opacity-20 dark:opacity-15"
            fill="currentColor"
          >
            <path d="M118.4,14.2C160.2,24.8,195.8,56.5,208.1,97.9C220.4,139.3,209.4,190.4,173.3,205.4C137.2,220.4,76,199.3,42.3,162.8C8.6,126.3,2.5,74.4,24.1,42.6C45.7,10.8,76.6,3.6,118.4,14.2Z" />
          </svg>
          <svg
            aria-hidden="true"
            viewBox="0 0 220 220"
            className="pointer-events-none absolute -bottom-16 -left-14 w-48 h-48 text-cta opacity-20 dark:opacity-15"
            fill="currentColor"
          >
            <path d="M135.7,25.8C171.9,44.1,196.1,87.2,190.4,127.8C184.7,168.4,149.1,206.5,107.8,210.8C66.5,215.1,19.6,185.6,8.4,145.5C-2.8,105.4,21.7,54.7,57.8,31.2C93.9,7.7,99.5,7.5,135.7,25.8Z" />
          </svg>

          <div className="relative z-10 p-5 sm:p-7 space-y-5">
            {/* Top Utility Bar: Admin, Theme Toggle, Language */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={navigateToAdminLogin}
                aria-label={copy.adminLoginAria}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-brand-primary text-brand-primary-text hover:bg-brand-primary-hover active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-all inline-flex items-center gap-1.5 text-xs font-black shadow-xs cursor-pointer whitespace-nowrap"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-brand-gold-500 shrink-0" aria-hidden="true" />
                <span>{copy.adminLoginBtn}</span>
              </button>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-pressed={isDark}
                  aria-label={
                    isDark
                      ? isThai
                        ? 'สลับเป็นโหมดสว่าง'
                        : 'Switch to light mode'
                      : isThai
                        ? 'สลับเป็นโหมดมืด'
                        : 'Switch to dark mode'
                  }
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-brand-border-strong bg-brand-surface-muted/70 hover:bg-brand-surface-hover text-brand-text active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-all cursor-pointer"
                >
                  {isDark ? (
                    <Sun className="w-4 h-4 text-cta shrink-0" aria-hidden="true" />
                  ) : (
                    <Moon className="w-4 h-4 text-brand-text shrink-0" aria-hidden="true" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setLanguage(isThai ? 'en' : 'th')}
                  aria-label={copy.languageAria}
                  className="min-h-[44px] px-3 py-2 rounded-xl border border-brand-border-strong bg-brand-surface-muted/70 hover:bg-brand-surface-hover text-xs font-black text-brand-text active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-all inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                >
                  <Globe2 className="w-3.5 h-3.5 text-brand-text-secondary shrink-0" aria-hidden="true" />
                  <span>{copy.language}</span>
                </button>
              </div>
            </div>

            {/* Brand Mark & Card Heading */}
            <header className="text-center space-y-2.5">
              <div className="inline-flex items-center justify-center gap-2.5">
                <div
                  aria-hidden="true"
                  className="w-10 h-10 rounded-2xl bg-cta text-cta-text flex items-center justify-center font-black text-xl shadow-sm"
                >
                  P
                </div>
                <div className="text-left">
                  <div className="text-lg font-black tracking-tight text-brand-text leading-none">
                    PRODX <span className="text-brand-text-accent">POS</span>
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-brand-text-secondary mt-0.5">
                    - PROFESSIONAL POS SYSTEM -
                  </div>
                </div>
              </div>

              <div className="space-y-0.5 pt-1">
                <h1
                  id="login-card-title"
                  className="text-2xl font-black tracking-tight text-brand-text leading-snug"
                >
                  {copy.title}
                </h1>
                <p className="text-xs font-medium text-brand-text-secondary leading-relaxed">
                  {activeSubtitle}
                </p>
              </div>
            </header>

            {/* Login Error Notification Banner */}
            {loginError && (
              <div
                role="alert"
                className="rounded-xl border border-danger/40 bg-danger-subtle p-3 flex items-start gap-2.5 text-xs text-danger-text"
              >
                <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" aria-hidden="true" />
                <div className="flex-1 leading-relaxed">
                  <div className="font-black">{loginError.title}</div>
                  <div>{loginError.message}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setLoginError(null)}
                  aria-label={isThai ? 'ปิดข้อความแจ้งเตือน' : 'Dismiss error message'}
                  className="min-h-[44px] min-w-[44px] -my-1.5 -mr-1.5 flex items-center justify-center text-danger-text/80 hover:text-danger-text rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            )}

            {/* Operator Authentication Mode Panels */}
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
                  username={biometricUsername}
                  onUsernameChange={setBiometricUsername}
                  webauthnCapability={webauthnCapability}
                  serverEnabled={webauthnServerEnabled}
                  onScanBiometric={() => void handleBiometricLogin()}
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
                />
              )}

              {loginMode === 'email' && (
                <EmailPasswordForm
                  isThai={isThai}
                  terminalReady={terminalReady}
                  isLoading={isLoading}
                  onSubmit={(email, pass) => void performLogin(email, pass)}
                  onForgotPin={() => {
                    addToast({ title: 'Password Reset', message: 'Reset email requested.', type: 'info' });
                  }}
                />
              )}
            </div>

            {/* 4-Way Accessible Login Method Switcher */}
            <LoginMethodSwitcher
              isThai={isThai}
              activeMode={loginMode}
              terminalReady={terminalReady}
              onSelectMode={(mode) => {
                setLoginError(null);
                setLoginMode(mode);
              }}
            />

            {/* Bottom Terminal Scope Pill Bar & Expandable Drawer */}
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

            {/* Reference Attribution Footer */}
            <footer className="pt-3 border-t border-brand-border flex flex-col items-center gap-1.5 text-center">
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-brand-text-secondary">
                — DEVELOPED BY THODSAWAT —
              </div>
              <div className="inline-flex items-center gap-1 text-[11px] font-bold text-success-text">
                <Lock className="w-3 h-3 text-success shrink-0" aria-hidden="true" />
                <span>Encrypted Session</span>
              </div>
            </footer>
          </div>
        </article>
      </div>
    </main>
  );
};
