import React from 'react';
import { Building2, Store, Monitor, CheckCircle2, ChevronDown, RefreshCw } from 'lucide-react';
import { Organization, Branch, Terminal } from '../settings/types';
import { OrganizationLoginContext } from '../../adapters/types';

interface TerminalScopeBarProps {
  isThai: boolean;
  isInitialLoading: boolean;
  isFetching: boolean;
  terminalReady: boolean;
  organizationContext: OrganizationLoginContext | null;
  selectedOrgId: string;
  selectedBranchId: string;
  selectedTerminalId: string;
  orgs: Organization[];
  branches: Branch[];
  terminals: Terminal[];
  isOrgValid: boolean;
  isBranchValid: boolean;
  isTerminalValid: boolean;
  onOrganizationChange: (orgId: string) => void;
  onBranchChange: (branchId: string) => void;
  onTerminalChange: (terminalId: string) => void;
  onSyncCatalog: () => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export const TerminalScopeBar: React.FC<TerminalScopeBarProps> = ({
  isThai,
  isInitialLoading,
  isFetching,
  terminalReady,
  organizationContext,
  selectedOrgId,
  selectedBranchId,
  selectedTerminalId,
  orgs,
  branches,
  terminals,
  isOrgValid,
  isBranchValid,
  isTerminalValid,
  onOrganizationChange,
  onBranchChange,
  onTerminalChange,
  onSyncCatalog,
  isExpanded,
  onToggleExpand,
}) => {
  if (terminalReady && !isExpanded && organizationContext) {
    return (
      <div className="rounded-xl border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/80 dark:bg-emerald-950/50 px-3.5 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-3 shadow-2xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-7 w-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex flex-wrap sm:flex-nowrap items-center gap-x-2 gap-y-0.5 text-xs font-bold leading-snug text-emerald-950 dark:text-emerald-100">
            <span className="truncate">{organizationContext.organizationName}</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-bold" aria-hidden="true">›</span>
            <span className="truncate">{organizationContext.branchName}</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-bold" aria-hidden="true">›</span>
            <span className="font-mono tabular-nums text-emerald-800 dark:text-emerald-200 font-black shrink-0">{organizationContext.terminalCode}</span>
          </div>
        </div>
        <button
          type="button"
          aria-expanded={false}
          onClick={onToggleExpand}
          className="shrink-0 self-start sm:self-auto min-h-[44px] px-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:text-emerald-950 dark:hover:text-emerald-100 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta rounded-md cursor-pointer inline-flex items-center gap-1 active:scale-[0.98] transition-transform"
        >
          <span>{isThai ? 'เปลี่ยนจุด POS' : 'Change Station'}</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-brand-border bg-brand-surface-muted p-3.5 space-y-3 shadow-2xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black uppercase tracking-wider text-brand-text flex items-center gap-1.5 leading-snug">
          <Building2 className="w-3.5 h-3.5 text-brand-primary shrink-0" />
          <span>{isThai ? '1. กำหนดขอบเขตเครื่อง POS (Operational Scope)' : '1. POS Terminal Operational Scope'}</span>
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          {terminalReady && organizationContext && (
            <button
              type="button"
              aria-expanded={true}
              onClick={onToggleExpand}
              className="min-h-[44px] px-2.5 text-xs font-bold text-brand-text-secondary hover:text-brand-text underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta rounded-lg cursor-pointer inline-flex items-center"
            >
              {isThai ? 'ซ่อน' : 'Collapse'}
            </button>
          )}
          <button
            type="button"
            onClick={onSyncCatalog}
            disabled={isFetching}
            title={isThai ? 'ซิงค์ Firestore' : 'Sync Firestore'}
            aria-label={isThai ? 'ซิงค์ Firestore' : 'Sync Firestore'}
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-brand-surface-hover text-brand-text-secondary transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {/* Organization Select */}
        <div className="space-y-1">
          <label
            htmlFor="terminal-scope-org"
            className="text-xs font-black uppercase text-brand-text-secondary flex items-center justify-between cursor-pointer"
          >
            <span>{isThai ? 'องค์กร' : 'Organization'} *</span>
            {isOrgValid && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />}
          </label>
          <select
            id="terminal-scope-org"
            value={selectedOrgId}
            onChange={(e) => onOrganizationChange(e.target.value)}
            disabled={isFetching || isInitialLoading}
            className="w-full min-h-[44px] h-11 bg-brand-surface border-2 border-brand-border-strong rounded-lg px-2.5 text-base sm:text-xs font-bold text-brand-text outline-none focus:border-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta transition-all disabled:opacity-50"
          >
            <option value="">{isThai ? '-- เลือกองค์กร --' : '-- Select Org --'}</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.slug})
              </option>
            ))}
          </select>
        </div>

        {/* Branch Select */}
        <div className="space-y-1">
          <label
            htmlFor="terminal-scope-branch"
            className="text-xs font-black uppercase text-brand-text-secondary flex items-center justify-between cursor-pointer"
          >
            <span>{isThai ? 'สาขา' : 'Branch'} *</span>
            {isBranchValid && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />}
          </label>
          <select
            id="terminal-scope-branch"
            value={selectedBranchId}
            onChange={(e) => onBranchChange(e.target.value)}
            disabled={!isOrgValid || isFetching || isInitialLoading}
            className="w-full min-h-[44px] h-11 bg-brand-surface border-2 border-brand-border-strong rounded-lg px-2.5 text-base sm:text-xs font-bold text-brand-text outline-none focus:border-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta transition-all disabled:opacity-50"
          >
            <option value="">{isThai ? '-- เลือกสาขา --' : '-- Select Branch --'}</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} {b.code ? `(${b.code})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Terminal Select */}
        <div className="space-y-1">
          <label
            htmlFor="terminal-scope-register"
            className="text-xs font-black uppercase text-brand-text-secondary flex items-center justify-between cursor-pointer"
          >
            <span>{isThai ? 'เครื่อง POS' : 'POS Register'} *</span>
            {isTerminalValid && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />}
          </label>
          <select
            id="terminal-scope-register"
            value={selectedTerminalId}
            onChange={(e) => onTerminalChange(e.target.value)}
            disabled={!isBranchValid || isFetching || isInitialLoading}
            className="w-full min-h-[44px] h-11 bg-brand-surface border-2 border-brand-border-strong rounded-lg px-2.5 text-base sm:text-xs font-bold text-brand-text outline-none focus:border-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta transition-all disabled:opacity-50"
          >
            <option value="">{isThai ? '-- เลือกเครื่อง POS --' : '-- Select Register --'}</option>
            {terminals.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.code})
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
