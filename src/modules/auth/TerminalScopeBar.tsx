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
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-2.5 flex items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-7 w-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex items-center gap-2 text-xs font-bold text-emerald-950 truncate">
            <span className="truncate">{organizationContext.organizationName}</span>
            <span className="text-emerald-700 font-bold" aria-hidden="true">›</span>
            <span className="truncate">{organizationContext.branchName}</span>
            <span className="text-emerald-700 font-bold" aria-hidden="true">›</span>
            <span className="font-mono text-emerald-800 font-black">{organizationContext.terminalCode}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleExpand}
          className="shrink-0 text-xs font-bold text-emerald-800 hover:text-emerald-950 underline focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-1 rounded-md cursor-pointer inline-flex items-center gap-1"
        >
          <span>{isThai ? 'เปลี่ยนจุด POS' : 'Change Station'}</span>
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-300 bg-slate-50/95 p-3.5 space-y-3 shadow-2xs">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
          <Building2 className="w-3.5 h-3.5 text-primary" />
          <span>{isThai ? '1. กำหนดขอบเขตเครื่อง POS (Operational Scope)' : '1. POS Terminal Operational Scope'}</span>
        </span>
        <div className="flex items-center gap-2">
          {terminalReady && organizationContext && (
            <button
              type="button"
              onClick={onToggleExpand}
              className="text-[11px] font-bold text-slate-700 hover:text-slate-950 underline focus-visible:ring-2 focus-visible:ring-[#ff6b1a] rounded-md cursor-pointer"
            >
              {isThai ? 'ซ่อน' : 'Collapse'}
            </button>
          )}
          <button
            type="button"
            onClick={onSyncCatalog}
            disabled={isFetching}
            title={isThai ? 'ซิงค์ Firestore' : 'Sync Firestore'}
            className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-700 transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[#ff6b1a] cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {/* Organization Select */}
        <div className="space-y-1">
          <label className="text-[11px] font-black uppercase text-slate-700 flex items-center justify-between">
            <span>{isThai ? 'องค์กร' : 'Organization'} *</span>
            {isOrgValid && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />}
          </label>
          <select
            value={selectedOrgId}
            onChange={(e) => onOrganizationChange(e.target.value)}
            disabled={isFetching || isInitialLoading}
            className="w-full h-10 bg-white border-2 border-slate-300 rounded-lg px-2.5 text-xs font-bold text-slate-900 outline-none focus:border-[#ff6b1a] focus:ring-2 focus:ring-[#ff6b1a]/30 transition-all disabled:opacity-50"
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
          <label className="text-[11px] font-black uppercase text-slate-700 flex items-center justify-between">
            <span>{isThai ? 'สาขา' : 'Branch'} *</span>
            {isBranchValid && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />}
          </label>
          <select
            value={selectedBranchId}
            onChange={(e) => onBranchChange(e.target.value)}
            disabled={!isOrgValid || isFetching || isInitialLoading}
            className="w-full h-10 bg-white border-2 border-slate-300 rounded-lg px-2.5 text-xs font-bold text-slate-900 outline-none focus:border-[#ff6b1a] focus:ring-2 focus:ring-[#ff6b1a]/30 transition-all disabled:opacity-50"
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
          <label className="text-[11px] font-black uppercase text-slate-700 flex items-center justify-between">
            <span>{isThai ? 'เครื่อง POS' : 'POS Register'} *</span>
            {isTerminalValid && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />}
          </label>
          <select
            value={selectedTerminalId}
            onChange={(e) => onTerminalChange(e.target.value)}
            disabled={!isBranchValid || isFetching || isInitialLoading}
            className="w-full h-10 bg-white border-2 border-slate-300 rounded-lg px-2.5 text-xs font-bold text-slate-900 outline-none focus:border-[#ff6b1a] focus:ring-2 focus:ring-[#ff6b1a]/30 transition-all disabled:opacity-50"
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
