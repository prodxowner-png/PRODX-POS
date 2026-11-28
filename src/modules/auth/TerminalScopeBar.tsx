import React from 'react';
import { Building2, CheckCircle2, ChevronDown, Monitor, RefreshCw, Store } from 'lucide-react';
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

const DRAWER_ID = 'terminal-scope-drawer';

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
  const showDrawer = isExpanded || !terminalReady;

  const branchLabel =
    organizationContext?.branchName ||
    (isInitialLoading
      ? isThai
        ? 'กำลังโหลดสาขา...'
        : 'Loading branch...'
      : isThai
        ? 'เลือกสาขา'
        : 'Select Branch');

  const terminalLabel =
    organizationContext?.terminalCode ||
    (isThai ? 'เครื่อง POS' : 'POS Terminal');

  return (
    <div className="space-y-2.5">
      {/* Compact Reference Pill Bar */}
      <div className="rounded-2xl border border-brand-border bg-brand-surface-muted/85 px-2 py-1.5 flex flex-wrap items-center justify-between gap-1.5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-1 min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={showDrawer}
            aria-controls={DRAWER_ID}
            onClick={onToggleExpand}
            title={
              organizationContext
                ? `${organizationContext.organizationName} · ${organizationContext.branchName}`
                : undefined
            }
            className="min-h-[44px] px-2.5 py-1.5 rounded-xl hover:bg-brand-surface-hover text-xs font-bold text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta transition-colors inline-flex items-center gap-1.5 min-w-0 max-w-full cursor-pointer"
          >
            <Store className="w-3.5 h-3.5 text-brand-text-accent shrink-0" aria-hidden="true" />
            <span className="truncate max-w-[140px] sm:max-w-[160px]">{branchLabel}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-brand-text-secondary shrink-0 transition-transform duration-200 ${
                showDrawer ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            />
          </button>

          <span className="text-brand-border-strong select-none" aria-hidden="true">
            |
          </span>

          <button
            type="button"
            aria-expanded={showDrawer}
            aria-controls={DRAWER_ID}
            onClick={onToggleExpand}
            className="min-h-[44px] px-2.5 py-1.5 rounded-xl hover:bg-brand-surface-hover text-xs font-mono font-black tabular-nums text-brand-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta transition-colors inline-flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            <Monitor className="w-3.5 h-3.5 text-brand-text-secondary shrink-0" aria-hidden="true" />
            <span>{terminalLabel}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-brand-text-secondary shrink-0 transition-transform duration-200 ${
                showDrawer ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            />
          </button>
        </div>

        {/* Status Badge */}
        {terminalReady ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success-subtle px-2.5 py-1 text-[11px] font-black text-success-text shrink-0">
            <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" aria-hidden="true" />
            <span>{isThai ? 'พร้อมใช้งาน' : 'Ready'}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning-subtle px-2.5 py-1 text-[11px] font-black text-warning-text shrink-0">
            <Building2 className="w-3.5 h-3.5 text-warning shrink-0" aria-hidden="true" />
            <span>{isThai ? 'เลือกจุดขาย' : 'Setup'}</span>
          </span>
        )}
      </div>

      {/* Expandable Operational Scope Drawer (always open when !terminalReady) */}
      {showDrawer && (
        <div
          id={DRAWER_ID}
          className="rounded-2xl border border-brand-border bg-brand-surface-muted p-3.5 space-y-3 shadow-2xs"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-black uppercase tracking-wider text-brand-text flex items-center gap-1.5 leading-snug">
              <Building2 className="w-3.5 h-3.5 text-brand-primary shrink-0" aria-hidden="true" />
              <span>{isThai ? 'กำหนดขอบเขตเครื่อง POS' : 'POS Terminal Scope'}</span>
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {terminalReady && organizationContext && (
                <button
                  type="button"
                  aria-expanded={true}
                  aria-controls={DRAWER_ID}
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
                title={isThai ? 'ซิงค์ข้อมูลสาขา' : 'Sync terminal catalog'}
                aria-label={isThai ? 'ซิงค์ข้อมูลสาขา' : 'Sync terminal catalog'}
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-brand-surface-hover text-brand-text-secondary transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta cursor-pointer"
              >
                <RefreshCw
                  className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
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
                {isOrgValid && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-success" aria-hidden="true" />
                )}
              </label>
              <select
                id="terminal-scope-org"
                name="organizationId"
                value={selectedOrgId}
                onChange={(e) => onOrganizationChange(e.target.value)}
                disabled={isFetching || isInitialLoading}
                className="w-full min-h-[44px] bg-brand-surface border-2 border-brand-border-strong rounded-xl px-2.5 py-2 text-base sm:text-sm font-bold text-brand-text outline-none focus:border-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta transition-all disabled:opacity-50"
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
                {isBranchValid && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-success" aria-hidden="true" />
                )}
              </label>
              <select
                id="terminal-scope-branch"
                name="branchId"
                value={selectedBranchId}
                onChange={(e) => onBranchChange(e.target.value)}
                disabled={!isOrgValid || isFetching || isInitialLoading}
                className="w-full min-h-[44px] bg-brand-surface border-2 border-brand-border-strong rounded-xl px-2.5 py-2 text-base sm:text-sm font-bold text-brand-text outline-none focus:border-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta transition-all disabled:opacity-50"
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
                {isTerminalValid && (
                  <CheckCircle2 className="w-3.5 h-3.5 text-success" aria-hidden="true" />
                )}
              </label>
              <select
                id="terminal-scope-register"
                name="terminalId"
                value={selectedTerminalId}
                onChange={(e) => onTerminalChange(e.target.value)}
                disabled={!isBranchValid || isFetching || isInitialLoading}
                className="w-full min-h-[44px] bg-brand-surface border-2 border-brand-border-strong rounded-xl px-2.5 py-2 text-base sm:text-sm font-bold text-brand-text outline-none focus:border-cta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cta transition-all disabled:opacity-50"
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
      )}
    </div>
  );
};
