import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useOffline } from '../../context/OfflineContext';
import { useSettings } from '../../context/SettingsContext';
import { Terminal, Shield, Database, Cpu, Keyboard } from 'lucide-react';
import { SyncLatencyIndicator } from './SyncLatencyIndicator';

export const StatusBar: React.FC = () => {
  const { session, operationalScope } = useAuth();
  const { isOnline, pendingCount, openSyncActivity } = useOffline();
  const { config } = useSettings();

  if (!session) return null;

  const activeScope = session.operationalScope ?? operationalScope;

  return (
    <footer className="h-8 w-full max-w-full overflow-x-hidden border-t border-border border-crisp bg-card/80 px-3 sm:px-6 flex items-center justify-between text-[10px] text-text/60 font-mono shrink-0 select-none z-20">
      {/* Left items */}
      <div className="flex items-center gap-2.5 sm:gap-4 uppercase tracking-wider font-semibold">
        <span
          className="flex items-center gap-1.5"
          title={
            activeScope
              ? `${activeScope.organizationName} (${activeScope.organizationSlug}) · ${activeScope.branchName} · ${activeScope.terminalName} (${activeScope.terminalCode})`
              : undefined
          }
        >
          <Terminal className="h-3 w-3 text-text/40" />
          <span className="text-text/60">
            {activeScope?.organizationSlug || session.organization.slug}
          </span>
          <span className="text-text/30">/</span>
          <span className="text-text font-bold">
            {activeScope?.branchName || session.currentStore.code}
          </span>
        </span>

        <span className="hidden sm:inline-flex items-center gap-1.5">
          <Shield className="h-3 w-3 text-emerald-600 dark:text-emerald-500" />
          <span className="text-text/60">ROLE:</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-bold">{session.currentUser.role}</span>
        </span>

        <span className="hidden md:inline-flex items-center gap-1">
          <span className="text-text/60">REG:</span>
          <span className="text-text/80">
            {activeScope?.terminalCode || session.registerId}
          </span>
        </span>
      </div>

      {/* Right items */}
      <div className="flex items-center gap-2 sm:gap-3.5 uppercase tracking-wider font-semibold">
        <span className="hidden 2xl:inline-flex items-center gap-1 text-text/60 border border-border border-crisp px-1.5 py-0.5 rounded bg-background/80">
          <span>
            ADAPTER: {import.meta.env.DEV ? 'CLIENT-HYBRID (DEV)' : 'PRODUCTION EDGE'}
          </span>
        </span>

        <span className="hidden lg:inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <Cpu className="h-3 w-3" />
          <span>DECIMAL-SAFE FINANCIAL CORE</span>
        </span>

        {/* Keyboard Focus Status Indicator */}
        <span className="hidden md:inline-flex items-center gap-1.5" title="Keyboard Focus Strategy">
          <Keyboard className="h-3 w-3 text-text/40" />
          <span className="text-text/60">KBD:</span>
          <span className={config.hardware?.keyboardFocusCapture !== false ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-amber-600 dark:text-amber-400 font-bold'}>
            {config.hardware?.keyboardFocusCapture !== false ? 'CAPTURE' : 'PASSTHROUGH'}
          </span>
        </span>

        {/* Real-Time Sync Latency (Round-Trip Time between local operations and cloud database) */}
        <SyncLatencyIndicator />

        {/* Sync Activity Quick Trigger Button */}
        <button
          type="button"
          onClick={openSyncActivity}
          className="flex items-center gap-2 px-2 py-0.5 rounded-lg border border-border border-crisp bg-background hover:bg-card text-text/80 hover:text-text transition-all duration-150 cursor-pointer active:scale-95"
          title="Open Sync Activity Panel (ประวัติการซิงก์ข้อมูล Local Cache ↔ Cloud DB) [Alt+S]"
        >
          <Database className="h-3 w-3 text-primary" />
          <span className="hidden sm:inline text-text/60">OUTBOX:</span>
          <span className={`font-bold ${pendingCount > 0 ? 'text-amber-600 dark:text-amber-400 animate-pulse' : 'text-text/80'}`}>
            {pendingCount}
          </span>
          <span className="text-text/30">|</span>
          <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span className={isOnline ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'text-amber-600 dark:text-amber-400 font-bold'}>
            {isOnline ? 'LIVE' : 'OFFLINE'}
          </span>
        </button>
      </div>
    </footer>
  );
};
