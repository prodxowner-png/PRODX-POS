import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  Database,
  HardDrive,
  Loader2,
  Monitor,
  RefreshCw,
  Store,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import {
  getBranchesByOrg,
  getOrganizationSelectionCatalogWithFallback,
  getTerminalsByBranch,
  isSimulatedFirestoreTimeoutActive,
  OrganizationCatalogSource,
  OrganizationFallbackReason,
  saveSelectionScopeToLocalStorage,
  setSimulatedFirestoreTimeout,
} from '../../services/organizationService';
import { Organization, Branch, Terminal } from '../settings/types';
import { OrganizationLoginContext } from '../../adapters/types';

export const TERMINAL_SCOPE_STORAGE_KEYS = {
  organization: 'prodx.terminal.organization',
  store: 'prodx.terminal.store',
  register: 'prodx.terminal.register',
} as const;

const readTerminalValue = (key: string, env?: string) => {
  if (typeof window === 'undefined') return env?.trim() ?? '';
  try {
    return window.localStorage.getItem(key)?.trim() || env?.trim() || '';
  } catch {
    return env?.trim() ?? '';
  }
};

export interface OrganizationSelectionState {
  scope: OrganizationLoginContext | null;
  isReady: boolean;
  isFetching: boolean;
  focusFirstMissing: () => void;
  refreshCatalog: () => Promise<void>;
  catalogSource?: OrganizationCatalogSource;
  degraded?: boolean;
}

export interface OrganizationSelectionProps {
  onScopeChange?: (state: OrganizationSelectionState) => void;
  externalTouchTrigger?: number;
}

export const OrganizationSelection: React.FC<OrganizationSelectionProps> = ({
  onScopeChange,
  externalTouchTrigger = 0,
}) => {
  const { operationalScope, setOperationalScope } = useAuth();
  const { language } = useLanguage();
  const { addToast } = useToast();
  const isThai = language === 'th';

  const [organizationSlug, setOrganizationSlug] = useState(() =>
    operationalScope?.organizationSlug ||
    readTerminalValue(
      TERMINAL_SCOPE_STORAGE_KEYS.organization,
      import.meta.env.VITE_PRODX_ORGANIZATION_SLUG || 'prodx',
    ),
  );
  const [storeCode, setStoreCode] = useState(() =>
    operationalScope?.branchName ||
    readTerminalValue(
      TERMINAL_SCOPE_STORAGE_KEYS.store,
      import.meta.env.VITE_PRODX_STORE_CODE || 'STR-01',
    ),
  );
  const [registerId, setRegisterId] = useState(() =>
    operationalScope?.terminalCode ||
    readTerminalValue(
      TERMINAL_SCOPE_STORAGE_KEYS.register,
      import.meta.env.VITE_PRODX_REGISTER_ID || 'Terminal-001',
    ),
  );

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [allTerminals, setAllTerminals] = useState<Terminal[]>([]);
  const [isFetching, setIsFetching] = useState(false);

  // Resilience & Fallback Telemetry State
  const [catalogSource, setCatalogSource] = useState<OrganizationCatalogSource>('firestore');
  const [isDegraded, setIsDegraded] = useState(false);
  const [isTimedOut, setIsTimedOut] = useState(false);
  const [fallbackReason, setFallbackReason] = useState<OrganizationFallbackReason | undefined>(
    undefined,
  );
  const [fallbackErrorMsg, setFallbackErrorMsg] = useState<string | undefined>(undefined);
  const [latencyMs, setLatencyMs] = useState<number>(0);
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [simulateTimeoutMode, setSimulateTimeoutMode] = useState<boolean>(() =>
    isSimulatedFirestoreTimeoutActive(),
  );

  const [touched, setTouched] = useState<{
    organization: boolean;
    store: boolean;
    register: boolean;
  }>({
    organization: false,
    store: false,
    register: false,
  });

  const copy = useMemo(
    () =>
      isThai
        ? {
            terminal: '1. เลือกขอบเขตการปฏิบัติงาน (Organization, Branch & Terminal — บังคับเลือก)',
            organization: 'องค์กร',
            store: 'สาขา',
            register: 'เครื่อง POS',
            selectOrg: 'เลือกองค์กร (บังคับ)',
            selectBranch: 'เลือกสาขา (บังคับ)',
            selectTerminal: 'เลือกเครื่อง POS (บังคับ)',
            orgRequiredMsg: 'กรุณาเลือกองค์กรก่อนดำเนินการต่อ',
            branchRequiredMsg: 'กรุณาเลือกสาขาที่สังกัดองค์กรนี้',
            terminalRequiredMsg: 'กรุณาเลือกเครื่อง POS ประจำจุดขาย',
            validationReady:
              'บันทึกขอบเขตการปฏิบัติงาน (Operational Scope) ใน AuthContext แล้ว พร้อมป้อนรหัสยืนยันตัวตน',
            validationPending:
              'บังคับเลือกองค์กร สาขา และเครื่อง POS ให้ครบทั้ง 3 ส่วนก่อนจึงจะป้อนข้อมูลเข้าสู่ระบบได้',
            syncCatalog: 'ซิงค์ข้อมูลจาก Firestore',
            sourceFirestore: 'เชื่อมต่อ Firestore สำเร็จ',
            sourceLocalStorage: 'โหมดสำรองฉุกเฉิน: ดึงข้อมูลจาก LocalStorage Cache',
            sourceDefaults: 'โหมดสำรองฉุกเฉิน: ใช้ข้อมูล Default ของระบบ',
            timeoutBannerTitle:
              'ตรวจพบ Firestore Connection Timeout — ระบบสลับไปใช้ข้อมูลสำรองจาก LocalStorage อัตโนมัติ',
            timeoutBannerDesc:
              'แคชข้อมูลองค์กร สาขา และเครื่อง POS ล่าสุดในเครื่องถูกนำมาใช้งานทันที เพื่อให้พนักงานแคชเชียร์เข้าสู่ระบบได้โดยไม่หยุดชะงัก',
            simulateTimeoutBtn: 'จำลอง Timeout',
            restoreOnlineBtn: 'ยกเลิกจำลอง Timeout',
          }
        : {
            terminal: '1. Operational Scope Selection (Firestore + LocalStorage Fallback)',
            organization: 'Organization',
            store: 'Store / Branch',
            register: 'POS Terminal',
            selectOrg: 'Select Organization (Required)',
            selectBranch: 'Select Branch (Required)',
            selectTerminal: 'Select Terminal (Required)',
            orgRequiredMsg: 'Please select an organization to continue.',
            branchRequiredMsg: 'Please select a branch for this organization.',
            terminalRequiredMsg: 'Please select an active POS terminal.',
            validationReady:
              'Operational scope persisted in AuthContext & localStorage. Credential entry is unlocked.',
            validationPending:
              'Select Organization, Branch, and POS Terminal above before entering credentials.',
            syncCatalog: 'Sync from Firestore',
            sourceFirestore: 'Live Firestore Connected',
            sourceLocalStorage: 'Fallback Active: LocalStorage Cache',
            sourceDefaults: 'Fallback Active: System Defaults',
            timeoutBannerTitle:
              'Firestore Connection Timeout Handled — Using LocalStorage Fallback Data',
            timeoutBannerDesc:
              'Cached Organization, Branch, and POS Terminal records were automatically restored from localStorage so terminal sign-in continues without interruption.',
            simulateTimeoutBtn: 'Simulate Timeout',
            restoreOnlineBtn: 'Restore Firestore',
          },
    [isThai],
  );

  // Reactive selected Organization, filtered Branches, selected Branch, filtered Terminals, and selected Terminal
  const selectedOrganization = useMemo(
    () => orgs.find((o) => o.slug === organizationSlug) ?? null,
    [orgs, organizationSlug],
  );

  const branches = useMemo(() => {
    if (!selectedOrganization) return [];
    return allBranches.filter((b) => b.orgId === selectedOrganization.id);
  }, [allBranches, selectedOrganization]);

  const selectedBranch = useMemo(
    () => branches.find((b) => b.name === storeCode) ?? null,
    [branches, storeCode],
  );

  const terminals = useMemo(() => {
    if (!selectedBranch) return [];
    return allTerminals.filter((t) => t.branchId === selectedBranch.id);
  }, [allTerminals, selectedBranch]);

  const selectedTerminal = useMemo(
    () => terminals.find((t) => t.code === registerId) ?? null,
    [terminals, registerId],
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
      branchAddress: selectedBranch.address,
      terminalId: selectedTerminal.id,
      terminalName: selectedTerminal.name,
      terminalCode: selectedTerminal.code,
    };
  }, [selectedOrganization, selectedBranch, selectedTerminal]);

  const isOrgValid = useMemo(() => {
    if (!organizationSlug.trim()) return false;
    if (orgs.length === 0) return false;
    return Boolean(selectedOrganization);
  }, [organizationSlug, orgs.length, selectedOrganization]);

  const isBranchValid = useMemo(() => {
    if (!isOrgValid || !storeCode.trim()) return false;
    if (branches.length === 0) return false;
    return Boolean(selectedBranch);
  }, [isOrgValid, storeCode, branches.length, selectedBranch]);

  const isTerminalValid = useMemo(() => {
    if (!isBranchValid || !registerId.trim()) return false;
    if (terminals.length === 0) return false;
    return Boolean(selectedTerminal);
  }, [isBranchValid, registerId, terminals.length, selectedTerminal]);

  const terminalReady =
    isOrgValid && isBranchValid && isTerminalValid && Boolean(organizationContext);

  const validationErrors = useMemo(
    () => ({
      organization: !isOrgValid ? copy.orgRequiredMsg : null,
      store: isOrgValid && !isBranchValid ? copy.branchRequiredMsg : null,
      register: isOrgValid && isBranchValid && !isTerminalValid ? copy.terminalRequiredMsg : null,
    }),
    [isOrgValid, isBranchValid, isTerminalValid, copy],
  );

  const focusFirstMissing = useCallback(() => {
    setTouched({ organization: true, store: true, register: true });
    if (typeof document === 'undefined') return;
    const targetId = !isOrgValid
      ? 'login-org-select'
      : !isBranchValid
      ? 'login-branch-select'
      : 'login-terminal-select';
    const el = document.getElementById(targetId);
    el?.focus();
  }, [isOrgValid, isBranchValid]);

  useEffect(() => {
    if (externalTouchTrigger > 0) {
      focusFirstMissing();
    }
  }, [externalTouchTrigger, focusFirstMissing]);

  // Fetch organizations, branches, and terminals via organizationService timeout + localStorage fallback handler
  const loadFirestoreCatalog = useCallback(
    async (preferred?: { orgSlug?: string; branchName?: string; terminalCode?: string }) => {
      setIsFetching(true);
      try {
        const catalog = await getOrganizationSelectionCatalogWithFallback();
        setOrgs(catalog.organizations);
        setAllBranches(catalog.branches);
        setAllTerminals(catalog.terminals);
        setCatalogSource(catalog.source);
        setIsDegraded(catalog.degraded);
        setIsTimedOut(catalog.timedOut);
        setFallbackReason(catalog.fallbackReason);
        setFallbackErrorMsg(catalog.errorMessage);
        setLatencyMs(catalog.latencyMs);
        setCachedAt(catalog.cachedAt);

        const savedScope = catalog.savedSelection;

        const targetOrgSlug =
          preferred?.orgSlug ??
          operationalScope?.organizationSlug ??
          savedScope?.organizationSlug ??
          organizationSlug;
        const matchedOrg =
          catalog.organizations.find((o) => o.slug === targetOrgSlug) ||
          catalog.organizations[0] ||
          null;

        if (!matchedOrg) {
          setOrganizationSlug('');
          setStoreCode('');
          setRegisterId('');
          return;
        }

        setOrganizationSlug(matchedOrg.slug);

        const orgBranches = catalog.branches.filter((b) => b.orgId === matchedOrg.id);
        const targetBranchName =
          preferred?.branchName ??
          operationalScope?.branchName ??
          savedScope?.branchName ??
          storeCode;
        const matchedBranch =
          orgBranches.find((b) => b.name === targetBranchName) || orgBranches[0] || null;

        if (!matchedBranch) {
          setStoreCode('');
          setRegisterId('');
          return;
        }

        setStoreCode(matchedBranch.name);

        const branchTerminals = catalog.terminals.filter((t) => t.branchId === matchedBranch.id);
        const targetTerminalCode =
          preferred?.terminalCode ??
          operationalScope?.terminalCode ??
          savedScope?.terminalCode ??
          registerId;
        const matchedTerminal =
          branchTerminals.find((t) => t.code === targetTerminalCode) ||
          branchTerminals[0] ||
          null;

        setRegisterId(matchedTerminal ? matchedTerminal.code : '');

        if (catalog.degraded) {
          addToast({
            title: isThai
              ? 'สลับใช้ข้อมูลสำรองจาก LocalStorage'
              : 'LocalStorage Fallback Activated',
            message: isThai
              ? `การเชื่อมต่อ Firestore เกินเวลา (${catalog.latencyMs}ms) ระบบดึงข้อมูลองค์กร/สาขา/เครื่อง POS จาก LocalStorage เรียบร้อยแล้ว`
              : `Firestore connection timed out (${catalog.latencyMs}ms). Loaded Organization, Branch & Terminal catalog from localStorage.`,
            type: 'warning',
          });
        }
      } catch {
        addToast({
          title: 'Error',
          message: 'Failed to load system configuration from Firestore and fallback cache.',
          type: 'error',
        });
      } finally {
        setIsFetching(false);
      }
    },
    [organizationSlug, storeCode, registerId, operationalScope, addToast, isThai],
  );

  const initialFetchDoneRef = useRef(false);
  useEffect(() => {
    if (initialFetchDoneRef.current) return;
    initialFetchDoneRef.current = true;
    void loadFirestoreCatalog();
  }, [loadFirestoreCatalog]);

  // Update AuthContext operationalScope and persist to localStorage whenever selection changes
  useEffect(() => {
    if (isFetching) return;
    if (terminalReady && organizationContext) {
      setOperationalScope(organizationContext);
      saveSelectionScopeToLocalStorage(organizationContext);
    } else {
      setOperationalScope(null);
    }
  }, [isFetching, terminalReady, organizationContext, setOperationalScope]);

  // Notify parent LoginScreen of current scope, readiness, and helpers
  useEffect(() => {
    onScopeChange?.({
      scope: terminalReady ? organizationContext : null,
      isReady: terminalReady,
      isFetching,
      focusFirstMissing,
      refreshCatalog: () => loadFirestoreCatalog(),
      catalogSource,
      degraded: isDegraded,
    });
  }, [
    terminalReady,
    organizationContext,
    isFetching,
    focusFirstMissing,
    loadFirestoreCatalog,
    catalogSource,
    isDegraded,
    onScopeChange,
  ]);

  const handleToggleSimulateTimeout = async () => {
    const nextState = !simulateTimeoutMode;
    setSimulateTimeoutMode(nextState);
    setSimulatedFirestoreTimeout(nextState);
    await loadFirestoreCatalog({
      orgSlug: organizationSlug,
      branchName: storeCode,
      terminalCode: registerId,
    });
  };

  // Reactive handler when user selects a different Organization
  const handleOrganizationChange = async (nextOrgSlug: string) => {
    setOrganizationSlug(nextOrgSlug);
    setTouched((prev) => ({
      ...prev,
      organization: true,
      store: false,
      register: false,
    }));

    if (!nextOrgSlug) {
      setStoreCode('');
      setRegisterId('');
      return;
    }

    const nextOrg = orgs.find((o) => o.slug === nextOrgSlug);
    if (!nextOrg) {
      setStoreCode('');
      setRegisterId('');
      return;
    }

    // Immediately compute from cached branches, then refresh via timeout-protected service
    const cachedOrgBranches = allBranches.filter((b) => b.orgId === nextOrg.id);
    const initialBranch =
      cachedOrgBranches.find((b) => b.name === storeCode) || cachedOrgBranches[0] || null;
    const nextBranchName = initialBranch ? initialBranch.name : '';
    setStoreCode(nextBranchName);

    if (initialBranch) {
      const cachedBranchTerminals = allTerminals.filter((t) => t.branchId === initialBranch.id);
      const initialTerminal =
        cachedBranchTerminals.find((t) => t.code === registerId) ||
        cachedBranchTerminals[0] ||
        null;
      setRegisterId(initialTerminal ? initialTerminal.code : '');
    } else {
      setRegisterId('');
    }

    try {
      const freshBranches = await getBranchesByOrg(nextOrg.id);
      setAllBranches((prev) => {
        const others = prev.filter((b) => b.orgId !== nextOrg.id);
        return [...others, ...freshBranches];
      });
      const resolvedBranch =
        freshBranches.find((b) => b.name === nextBranchName) || freshBranches[0] || null;
      if (resolvedBranch) {
        setStoreCode(resolvedBranch.name);
        const freshTerminals = await getTerminalsByBranch(resolvedBranch.id, nextOrg.id);
        setAllTerminals((prev) => {
          const others = prev.filter((t) => t.branchId !== resolvedBranch.id);
          return [...others, ...freshTerminals];
        });
        const resolvedTerminal =
          freshTerminals.find((t) => t.code === registerId) || freshTerminals[0] || null;
        setRegisterId(resolvedTerminal ? resolvedTerminal.code : '');
      } else {
        setStoreCode('');
        setRegisterId('');
      }
    } catch {
      // Retain cached selection on network hiccup
    }
  };

  // Reactive handler when user selects a different Branch
  const handleBranchChange = async (nextStoreCode: string) => {
    setStoreCode(nextStoreCode);
    setTouched((prev) => ({
      ...prev,
      store: true,
      register: false,
    }));

    if (!nextStoreCode || !selectedOrganization) {
      setRegisterId('');
      return;
    }

    const nextBranch = branches.find((b) => b.name === nextStoreCode);
    if (!nextBranch) {
      setRegisterId('');
      return;
    }

    const cachedTerminals = allTerminals.filter((t) => t.branchId === nextBranch.id);
    const initialTerminal =
      cachedTerminals.find((t) => t.code === registerId) || cachedTerminals[0] || null;
    setRegisterId(initialTerminal ? initialTerminal.code : '');

    try {
      const freshTerminals = await getTerminalsByBranch(nextBranch.id, selectedOrganization.id);
      setAllTerminals((prev) => {
        const others = prev.filter((t) => t.branchId !== nextBranch.id);
        return [...others, ...freshTerminals];
      });
      const resolvedTerminal =
        freshTerminals.find((t) => t.code === registerId) || freshTerminals[0] || null;
      setRegisterId(resolvedTerminal ? resolvedTerminal.code : '');
    } catch {
      // Retain cached selection on network hiccup
    }
  };

  return (
    <div className="space-y-4 mb-6" data-testid="organization-selection">
      {/* Reactive Terminal Readiness & AuthContext Operational Scope Banner */}
      <div
        role="status"
        aria-live="polite"
        className={`rounded-xl border p-3.5 transition-all ${
          terminalReady
            ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900'
            : 'border-amber-200 bg-amber-50/70 text-amber-900'
        }`}
      >
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5 text-xs font-bold">
            {terminalReady ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            )}
            <span>{terminalReady ? copy.validationReady : copy.validationPending}</span>
          </div>

          {/* Data Source & Latency Badge */}
          <div className="flex items-center gap-1.5">
            <span
              data-testid="catalog-source-badge"
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider border ${
                isDegraded
                  ? 'bg-amber-100/90 border-amber-300 text-amber-900'
                  : 'bg-emerald-100/80 border-emerald-300 text-emerald-800'
              }`}
            >
              {isDegraded ? (
                <HardDrive className="w-3 h-3 text-amber-700" />
              ) : (
                <Database className="w-3 h-3 text-emerald-700" />
              )}
              <span>
                {catalogSource === 'firestore'
                  ? copy.sourceFirestore
                  : catalogSource === 'localStorage'
                  ? copy.sourceLocalStorage
                  : copy.sourceDefaults}
              </span>
              {latencyMs > 0 && <span className="font-mono opacity-75">({latencyMs}ms)</span>}
            </span>
          </div>
        </div>

        <div className="mt-2.5 grid grid-cols-3 gap-2">
          {[
            {
              label: copy.organization,
              valid: isOrgValid,
              value: selectedOrganization
                ? `${selectedOrganization.name} (${selectedOrganization.slug})`
                : organizationSlug,
            },
            {
              label: copy.store,
              valid: isBranchValid,
              value: selectedBranch ? selectedBranch.name : storeCode,
            },
            {
              label: copy.register,
              valid: isTerminalValid,
              value: selectedTerminal ? selectedTerminal.code : registerId,
            },
          ].map((item) => (
            <div
              key={item.label}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold border ${
                item.valid
                  ? 'bg-white border-emerald-200 text-emerald-700'
                  : 'bg-white/60 border-slate-200 text-slate-400'
              }`}
            >
              <CheckCircle2
                className={`w-3.5 h-3.5 shrink-0 ${
                  item.valid ? 'text-emerald-500' : 'text-slate-300'
                }`}
              />
              <span className="truncate">{item.valid ? item.value : item.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Degraded / Connection Timeout Fallback Alert Banner */}
      {isDegraded && (
        <div
          role="alert"
          data-testid="firestore-fallback-alert"
          className="rounded-xl border border-amber-300 bg-amber-50/90 p-3.5 text-amber-950 space-y-1.5"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-xs font-black">
              <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{copy.timeoutBannerTitle}</span>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono text-amber-800">
              {fallbackReason && (
                <span className="px-2 py-0.5 rounded bg-amber-200/70 font-bold uppercase">
                  {isTimedOut ? 'TIMEOUT' : fallbackReason}
                </span>
              )}
              {cachedAt && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Cache: {new Date(cachedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
          <p className="text-[11px] font-medium text-amber-800 leading-relaxed">
            {copy.timeoutBannerDesc}
          </p>
          {fallbackErrorMsg && (
            <p className="text-[10px] font-mono text-amber-700/90 truncate">
              Diagnostic: {fallbackErrorMsg}
            </p>
          )}
        </div>
      )}

      {/* Mandatory Firestore-Backed Dropdowns for Organization, Branch, and Terminal */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
            {copy.terminal}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            {isFetching && (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-primary">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Firestore Sync…
              </span>
            )}
            <button
              type="button"
              data-testid="simulate-firestore-timeout-btn"
              onClick={() => void handleToggleSimulateTimeout()}
              disabled={isFetching}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 border rounded-lg text-[10px] font-black transition-all disabled:opacity-50 ${
                simulateTimeoutMode
                  ? 'bg-amber-100 border-amber-400 text-amber-900 hover:bg-amber-200'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-amber-400 hover:text-amber-800'
              }`}
            >
              <WifiOff className="w-3 h-3" />
              <span>
                {simulateTimeoutMode ? copy.restoreOnlineBtn : copy.simulateTimeoutBtn}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void loadFirestoreCatalog()}
              disabled={isFetching}
              title={copy.syncCatalog}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-black text-slate-600 hover:border-slate-400 hover:text-slate-900 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
              <span>{copy.syncCatalog}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          {/* Organization Select */}
          <div className="space-y-1.5">
            <label
              htmlFor="login-org-select"
              className="text-[11px] font-black uppercase tracking-wider text-slate-600 flex items-center justify-between"
            >
              <span className="flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-primary" /> {copy.organization}{' '}
                <span className="text-rose-500">*</span>
              </span>
              {isOrgValid && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
            </label>
            <div className="relative">
              <select
                id="login-org-select"
                required
                aria-required="true"
                value={organizationSlug}
                onChange={(e) => void handleOrganizationChange(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, organization: true }))}
                disabled={isFetching}
                aria-invalid={!isOrgValid}
                className={`w-full h-11 bg-white border-2 rounded-xl px-3 pr-8 text-xs font-bold text-slate-900 appearance-none outline-none transition-all disabled:opacity-50 ${
                  !isOrgValid && touched.organization
                    ? 'border-rose-300 focus:border-rose-500'
                    : isOrgValid
                    ? 'border-emerald-200 focus:border-primary'
                    : 'border-slate-200 focus:border-primary'
                }`}
              >
                <option value="">{copy.selectOrg}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.slug}>
                    {o.name} ({o.slug})
                  </option>
                ))}
              </select>
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 rotate-90" />
              </div>
            </div>
            {validationErrors.organization && (
              <p role="alert" className="text-[11px] font-bold text-rose-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {validationErrors.organization}
              </p>
            )}
          </div>

          {/* Branch Select */}
          <div className="space-y-1.5">
            <label
              htmlFor="login-branch-select"
              className="text-[11px] font-black uppercase tracking-wider text-slate-600 flex items-center justify-between"
            >
              <span className="flex items-center gap-1.5">
                <Store className="w-3.5 h-3.5 text-primary" /> {copy.store}{' '}
                <span className="text-rose-500">*</span>
              </span>
              {isBranchValid && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
            </label>
            <div className="relative">
              <select
                id="login-branch-select"
                required
                aria-required="true"
                value={storeCode}
                onChange={(e) => void handleBranchChange(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, store: true }))}
                disabled={!isOrgValid || isFetching}
                aria-invalid={isOrgValid && !isBranchValid}
                className={`w-full h-11 bg-white border-2 rounded-xl px-3 pr-8 text-xs font-bold text-slate-900 appearance-none outline-none transition-all disabled:opacity-50 ${
                  isOrgValid && !isBranchValid && touched.store
                    ? 'border-rose-300 focus:border-rose-500'
                    : isBranchValid
                    ? 'border-emerald-200 focus:border-primary'
                    : 'border-slate-200 focus:border-primary'
                }`}
              >
                <option value="">{copy.selectBranch}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.name}>
                    {b.name} {b.address ? `— ${b.address}` : ''}
                  </option>
                ))}
              </select>
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 rotate-90" />
              </div>
            </div>
            {validationErrors.store && (
              <p role="alert" className="text-[11px] font-bold text-rose-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {validationErrors.store}
              </p>
            )}
          </div>

          {/* Terminal Select */}
          <div className="space-y-1.5">
            <label
              htmlFor="login-terminal-select"
              className="text-[11px] font-black uppercase tracking-wider text-slate-600 flex items-center justify-between"
            >
              <span className="flex items-center gap-1.5">
                <Monitor className="w-3.5 h-3.5 text-primary" /> {copy.register}{' '}
                <span className="text-rose-500">*</span>
              </span>
              {isTerminalValid && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />}
            </label>
            <div className="relative">
              <select
                id="login-terminal-select"
                required
                aria-required="true"
                value={registerId}
                onChange={(e) => {
                  setRegisterId(e.target.value);
                  setTouched((prev) => ({ ...prev, register: true }));
                }}
                onBlur={() => setTouched((prev) => ({ ...prev, register: true }))}
                disabled={!isBranchValid || isFetching}
                aria-invalid={isBranchValid && !isTerminalValid}
                className={`w-full h-11 bg-white border-2 rounded-xl px-3 pr-8 text-xs font-bold text-slate-900 appearance-none outline-none transition-all disabled:opacity-50 ${
                  isBranchValid && !isTerminalValid && touched.register
                    ? 'border-rose-300 focus:border-rose-500'
                    : isTerminalValid
                    ? 'border-emerald-200 focus:border-primary'
                    : 'border-slate-200 focus:border-primary'
                }`}
              >
                <option value="">{copy.selectTerminal}</option>
                {terminals.map((t) => (
                  <option key={t.id} value={t.code}>
                    {t.name} ({t.code})
                  </option>
                ))}
              </select>
              <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 rotate-90" />
              </div>
            </div>
            {validationErrors.register && (
              <p role="alert" className="text-[11px] font-bold text-rose-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {validationErrors.register}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
