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
  isTerminalValid,
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
      <div className="bg-white/95 border border-[#E2E8F0] rounded-2xl px-3 sm:px-4 py-2 flex items-center justify-between gap-1.5 sm:gap-2 shadow-2xs">
        {/* Branch Selector Button */}
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex items-center gap-1.5 text-xs font-bold text-[#183D32] hover:text-[#0F2A22] transition-colors cursor-pointer truncate"
          title={isThai ? 'เปลี่ยนสาขา' : 'Change Branch'}
          aria-expanded={isExpanded}
        >
          <Store className="w-3.5 h-3.5 text-[#183D32] shrink-0" />
          <span className="truncate">
            {isThai ? 'สาขา: ' : 'Branch: '}
            <span className="font-black">{currentBranchName}</span>
          </span>
          <ChevronDown className={`w-3.5 h-3.5 text-[#64748B] shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </button>

        {/* Terminal Selector Button */}
        <button
          type="button"
          onClick={onToggleExpand}
          className="flex items-center gap-1.5 text-xs font-bold text-[#183D32] hover:text-[#0F2A22] transition-colors cursor-pointer shrink-0"
          title={isThai ? 'เปลี่ยนเครื่อง POS' : 'Change POS Terminal'}
          aria-expanded={isExpanded}
        >
          <Monitor className="w-3.5 h-3.5 text-[#183D32] shrink-0" />
          <span className="font-mono font-black">{currentTerminalCode}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-[#64748B] shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
        </button>

        {/* Ready Status Badge (#E8F3EA) */}
        <div
          className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-black flex items-center gap-1 shadow-2xs ${
            terminalReady
              ? 'bg-[#E8F3EA] text-[#183D32] border border-emerald-300/50'
              : 'bg-amber-50 text-amber-800 border border-amber-300/70'
          }`}
        >
          <CheckCircle2 className={`w-3.5 h-3.5 ${terminalReady ? 'text-[#183D32]' : 'text-amber-600'}`} />
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
        <div className="rounded-2xl border border-[#F5E1D0] bg-[#FFFDF9] p-3.5 space-y-3 shadow-md animate-in fade-in duration-200">
          <div className="flex items-center justify-between pb-1 border-b border-[#F5E1D0]">
            <span className="text-[11px] font-black uppercase tracking-wider text-[#183D32] flex items-center gap-1.5">
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
                className="p-1 rounded-lg hover:bg-[#F5E1D0] text-[#64748B] transition-colors disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin text-[#F97316]' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onToggleExpand}
                className="text-[11px] font-bold text-[#64748B] hover:text-[#183D32] underline cursor-pointer flex items-center gap-0.5"
              >
                <span>{isThai ? 'ซ่อน' : 'Collapse'}</span>
                <ChevronUp className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {/* Organization Select */}
            <div className="space-y-1">
              <label htmlFor="scope-org" className="text-[10px] font-black uppercase text-[#64748B] block cursor-pointer">
                {isThai ? 'องค์กร' : 'Organization'}
              </label>
              <select
                id="scope-org"
                value={selectedOrgId}
                onChange={(e) => onOrganizationChange(e.target.value)}
                disabled={isFetching || isInitialLoading}
                className="w-full h-9 bg-white border border-[#CBD5E1] rounded-xl px-2 text-xs font-bold text-[#183D32] outline-none focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/30 transition-all disabled:opacity-50"
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
              <label htmlFor="scope-branch" className="text-[10px] font-black uppercase text-[#64748B] block cursor-pointer">
                {isThai ? 'สาขา' : 'Branch'}
              </label>
              <select
                id="scope-branch"
                value={selectedBranchId}
                onChange={(e) => onBranchChange(e.target.value)}
                disabled={!isOrgValid || isFetching || isInitialLoading}
                className="w-full h-9 bg-white border border-[#CBD5E1] rounded-xl px-2 text-xs font-bold text-[#183D32] outline-none focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/30 transition-all disabled:opacity-50"
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
              <label htmlFor="scope-terminal" className="text-[10px] font-black uppercase text-[#64748B] block cursor-pointer">
                {isThai ? 'เครื่อง POS' : 'Terminal'}
              </label>
              <select
                id="scope-terminal"
                value={selectedTerminalId}
                onChange={(e) => onTerminalChange(e.target.value)}
                disabled={!isBranchValid || isFetching || isInitialLoading}
                className="w-full h-9 bg-white border border-[#CBD5E1] rounded-xl px-2 text-xs font-bold text-[#183D32] outline-none focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/30 transition-all disabled:opacity-50"
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
