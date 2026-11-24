import React from 'react';
import { Store, Monitor, CheckCircle2, ChevronDown, RefreshCw, Building2, ChevronUp } from 'lucide-react';
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
  onOrganizationChange,
  onBranchChange,
  onTerminalChange,
  onSyncCatalog,
  isExpanded,
  onToggleExpand,
}) => {
  const currentBranchName =
    branches.find((b) => b.id === selectedBranchId || b.name === selectedBranchId)?.name ||
    organizationContext?.branchName ||
    'Main Store';

  const currentTerminalCode =
    terminals.find((t) => t.id === selectedTerminalId || t.code === selectedTerminalId)?.code ||
    organizationContext?.terminalCode ||
    'POS-01';

  return (
    <div className="w-full space-y-2">
      {/* Scope Status Bar Matching Reference Mockup */}
      <div className="bg-[#FFFFFF] dark:bg-[#0F172A] border border-[#E2E8F0] dark:border-[#334155] rounded-2xl px-3 sm:px-4 py-2 flex items-center justify-between gap-1.5 sm:gap-2 shadow-2xs transition-colors">
        {/* Branch Selector Button */}
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex items-center gap-1.5 text-xs font-bold text-[#183D32] dark:text-[#F8FAFC] hover:text-[#0F2A22] dark:hover:text-[#38BDF8] transition-colors cursor-pointer truncate"
          title={isThai ? 'เปลี่ยนสาขา' : 'Change Branch'}
          aria-expanded={isExpanded}
        >
          <Store className="w-3.5 h-3.5 text-[#183D32] dark:text-[#F97316] shrink-0" />
          <span className="truncate">
            {isThai ? 'สาขา: ' : 'Branch: '}
            <span className="font-black">{currentBranchName}</span>
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-[#64748B] dark:text-[#94A3B8] shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </button>

        {/* Terminal Selector Button */}
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex items-center gap-1.5 text-xs font-bold text-[#183D32] dark:text-[#F8FAFC] hover:text-[#0F2A22] dark:hover:text-[#38BDF8] transition-colors cursor-pointer shrink-0"
          title={isThai ? 'เปลี่ยนเครื่อง POS' : 'Change POS Terminal'}
          aria-expanded={isExpanded}
        >
          <Monitor className="w-3.5 h-3.5 text-[#183D32] dark:text-[#F97316] shrink-0" />
          <span className="font-mono font-black">{currentTerminalCode}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-[#64748B] dark:text-[#94A3B8] shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </button>

        {/* Ready Status Badge (#E8F3EA in Light, #064E3B in Dark) */}
        <div
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black flex items-center gap-1 shadow-2xs ${
            terminalReady
              ? 'bg-[#E8F3EA] dark:bg-[#064E3B] text-[#183D32] dark:text-[#A7F3D0] border border-emerald-300/50 dark:border-emerald-600/50'
              : 'bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-300/70 dark:border-amber-700/60'
          }`}
        >
          <CheckCircle2 className={`w-3.5 h-3.5 ${terminalReady ? 'text-[#183D32] dark:text-[#34D399]' : 'text-amber-600'}`} />
          <span className="whitespace-nowrap">
            {terminalReady
              ? isThai
                ? 'พร้อมใช้งาน'
                : 'Ready'
              : isThai
                ? 'เลือกจุดขาย'
                : 'Setup'}
          </span>
        </div>
      </div>

      {/* Expanded Operational Scope Configuration Drawer */}
      {isExpanded && (
        <div className="rounded-2xl border border-[#F5E1D0] dark:border-[#334155] bg-[#FFFDF9] dark:bg-[#0F172A] p-3.5 space-y-3 shadow-md animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-1 border-b border-[#F5E1D0] dark:border-[#334155]">
            <span className="text-[11px] font-black uppercase tracking-wider text-[#183D32] dark:text-[#F8FAFC] flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-[#F97316]" />
              <span>{isThai ? 'กำหนดขอบเขตจุดขาย POS' : 'POS Operational Scope'}</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onSyncCatalog}
                disabled={isFetching}
                title={isThai ? 'ซิงค์ข้อมูลสาขา' : 'Sync Catalog'}
                aria-label={isThai ? 'ซิงค์ข้อมูลสาขา' : 'Sync Catalog'}
                className="p-1 rounded-lg hover:bg-[#F5E1D0] dark:hover:bg-background text-[#64748B] dark:text-[#94A3B8] transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin text-[#F97316]' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onToggleExpand}
                className="text-[11px] font-bold text-[#64748B] dark:text-[#94A3B8] hover:text-[#183D32] dark:hover:text-[#F8FAFC] underline cursor-pointer flex items-center gap-0.5"
              >
                <span>{isThai ? 'ซ่อน' : 'Collapse'}</span>
                <ChevronUp className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* Organization Select */}
            <div className="space-y-1">
              <label htmlFor="scope-org" className="text-[10px] font-black uppercase text-[#64748B] dark:text-[#94A3B8] block cursor-pointer">
                {isThai ? 'องค์กร' : 'Organization'}
              </label>
              <select
                id="scope-org"
                value={selectedOrgId}
                onChange={(e) => onOrganizationChange(e.target.value)}
                disabled={isFetching || isInitialLoading}
                className="w-full h-9 bg-[#FFFFFF] dark:bg-[#1E293B] border border-[#CBD5E1] dark:border-[#475569] rounded-xl px-2 text-xs font-bold text-[#183D32] dark:text-[#F8FAFC] outline-none focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/30 transition-all disabled:opacity-50"
              >
                <option value="">{isThai ? '-- เลือกองค์กร --' : '-- Select Org --'}</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Branch Select */}
            <div className="space-y-1">
              <label htmlFor="scope-branch" className="text-[10px] font-black uppercase text-[#64748B] dark:text-[#94A3B8] block cursor-pointer">
                {isThai ? 'สาขา' : 'Branch'}
              </label>
              <select
                id="scope-branch"
                value={selectedBranchId}
                onChange={(e) => onBranchChange(e.target.value)}
                disabled={!isOrgValid || isFetching || isInitialLoading}
                className="w-full h-9 bg-[#FFFFFF] dark:bg-[#1E293B] border border-[#CBD5E1] dark:border-[#475569] rounded-xl px-2 text-xs font-bold text-[#183D32] dark:text-[#F8FAFC] outline-none focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/30 transition-all disabled:opacity-50"
              >
                <option value="">{isThai ? '-- เลือกสาขา --' : '-- Select Branch --'}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Terminal Select */}
            <div className="space-y-1">
              <label htmlFor="scope-terminal" className="text-[10px] font-black uppercase text-[#64748B] dark:text-[#94A3B8] block cursor-pointer">
                {isThai ? 'เครื่อง POS' : 'Terminal'}
              </label>
              <select
                id="scope-terminal"
                value={selectedTerminalId}
                onChange={(e) => onTerminalChange(e.target.value)}
                disabled={!isBranchValid || isFetching || isInitialLoading}
                className="w-full h-9 bg-[#FFFFFF] dark:bg-[#1E293B] border border-[#CBD5E1] dark:border-[#475569] rounded-xl px-2 text-xs font-bold text-[#183D32] dark:text-[#F8FAFC] outline-none focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/30 transition-all disabled:opacity-50"
              >
                <option value="">{isThai ? '-- เลือกเครื่อง --' : '-- Select Terminal --'}</option>
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
