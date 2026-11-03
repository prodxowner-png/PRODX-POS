import React, { useState, useEffect } from 'react';
import {
  ShoppingCart,
  ReceiptText,
  Boxes,
  Banknote,
  Menu,
} from 'lucide-react';
import { TopNav } from './TopNav';
import { Sidebar, NavRoute } from './Sidebar';
import { StatusBar } from './StatusBar';
import { OfflineBanner } from './OfflineBanner';
import { BackgroundLayer } from './BackgroundLayer';
import { Drawer } from '../common/Drawer';
import { ToastContainer } from '../common/ToastContainer';
import { HoldOrdersModal } from '../../modules/pos/HoldOrdersModal';
import { CommandPalette } from '../common/CommandPalette';
import { LockScreenModal } from '../auth/LockScreenModal';
import { GlobalBreadcrumb } from './GlobalBreadcrumb';
import { SyncActivityPanel } from '../sync/SyncActivityPanel';
import { useOffline } from '../../context/OfflineContext';
import { useLanguage } from '../../context/LanguageContext';

export interface AppShellProps {
  currentRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
  onOpenAdminConsole?: () => void;
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentRoute,
  onNavigate,
  onOpenAdminConsole,
  children,
}) => {
  const { isSyncActivityOpen, closeSyncActivity, toggleSyncActivity } = useOffline();
  const { language } = useLanguage();
  const isThai = language === 'th';
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isHoldModalOpen, setIsHoldModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  
  // Health Monitoring & Recovery State
  const [hasRenderError, setHasRenderError] = useState(false);
  const [loadingStartTime] = useState(Date.now());
  const [isStuck, setIsStuck] = useState(false);
  const [isFirstRenderDone, setIsFirstRenderDone] = useState(false);

  // Monitor for "stuck" loading or empty content
  useEffect(() => {
    if (!children) {
      const timer = setTimeout(() => {
        console.error(`[AppShell Health] UI Hang Detected: Route '${currentRoute}' failed to provide content for 5 seconds.`);
        setIsStuck(true);
      }, 5000);
      return () => clearTimeout(timer);
    } else {
      setIsStuck(false);
      if (!isFirstRenderDone) {
        setIsFirstRenderDone(true);
        const bootTime = Date.now() - loadingStartTime;
        console.info(`[AppShell Health] UI Ready: Route '${currentRoute}' rendered successfully in ${bootTime}ms.`);
      }
    }
  }, [children, currentRoute, isFirstRenderDone, loadingStartTime]);

  // Global accelerators: Ctrl+K / Cmd+K (Palette) and Alt+S / Ctrl+Shift+S (Sync Activity)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if (
        (e.altKey && (e.key === 's' || e.key === 'S')) ||
        ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 's' || e.key === 'S'))
      ) {
        e.preventDefault();
        toggleSyncActivity();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSyncActivity]);

  return (
    <div className="relative flex h-[100dvh] w-screen overflow-hidden bg-background text-text font-sans select-none">
      {/* High-Tech Enterprise Persistent Background Mesh */}
      <BackgroundLayer />

      {/* Desktop Persistent Sidebar */}
      <div className="hidden lg:block h-full shrink-0 relative z-10 w-[280px] border-r border-border bg-card">
        <Sidebar
          currentRoute={currentRoute}
          onNavigate={onNavigate}
          onOpenAdminConsole={onOpenAdminConsole}
        />
      </div>

      {/* Mobile Drawer Navigation */}
      <Drawer
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        title="PRODX POS Navigation"
        side="left"
        width="w-[280px]"
        noPadding={true}
      >
        <div className="h-full flex flex-col overflow-y-auto no-scrollbar w-full">
          <Sidebar
            currentRoute={currentRoute}
            onNavigate={onNavigate}
            onOpenAdminConsole={onOpenAdminConsole}
            onCloseMobile={() => setIsMobileMenuOpen(false)}
          />
        </div>
      </Drawer>

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative z-10">
        {/* Top Navigation */}
        <TopNav
          currentRoute={currentRoute}
          onNavigate={onNavigate}
          onOpenAdminConsole={onOpenAdminConsole}
          onOpenMobileMenu={() => setIsMobileMenuOpen(true)}
          onOpenHoldModal={() => setIsHoldModalOpen(true)}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        />

        {/* Global Navigation Breadcrumb Bar */}
        <GlobalBreadcrumb currentRoute={currentRoute} onNavigate={onNavigate} />

        {/* Offline & Outbox Notice Banner */}
        <OfflineBanner />

        {/* Dynamic Route Content */}
        <main className="flex-1 min-h-0 relative flex flex-col min-w-0 overflow-hidden w-full max-w-full">
          {isStuck ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-500">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mb-4">
                <div className="w-8 h-8 rounded-full border-4 border-amber-500 border-t-transparent animate-spin" />
              </div>
              <h2 className="text-lg font-bold text-text mb-2">กำลังรอการโหลดข้อมูล...</h2>
              <p className="text-sm text-text/60 max-w-md mb-6">
                ระบบกำลังพยายามโหลดหน้า <span className="font-mono font-bold text-amber-500 uppercase">{currentRoute}</span> หากค้างนานเกินไป โปรดลองกดปุ่มรีเซ็ตด้านล่าง
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => window.location.reload()}
                  className="px-6 py-2.5 rounded-xl bg-primary text-white font-bold text-sm shadow-md hover:bg-primary-dark transition-all cursor-pointer active:scale-95"
                >
                  โหลดหน้าเว็บใหม่ (Reload)
                </button>
                <button
                  onClick={() => onNavigate('pos')}
                  className="px-6 py-2.5 rounded-xl border border-border bg-card text-text/80 font-bold text-sm hover:bg-background transition-all cursor-pointer active:scale-95"
                >
                  กลับหน้าขาย (POS)
                </button>
              </div>
            </div>
          ) : (
            children
          )}
        </main>

        {/* Mobile & Tablet Touch Quick Navigation Bar (< lg, hidden on POS portrait where PosMobileSwipeDrawer is active) */}
        <nav
          aria-label="Mobile Quick Navigation"
          className={`${
            currentRoute === 'pos' ? 'hidden md:landscape:flex lg:hidden' : 'flex lg:hidden'
          } h-14 bg-card/95 backdrop-blur-md border-t border-border px-2 items-center justify-around shrink-0 z-20`}
        >
          {(
            [
              {
                id: 'pos' as NavRoute,
                label: isThai ? 'ขาย (POS)' : 'POS',
                icon: ShoppingCart,
              },
              {
                id: 'orders' as NavRoute,
                label: isThai ? 'บิลขาย' : 'Orders',
                icon: ReceiptText,
              },
              {
                id: 'inventory' as NavRoute,
                label: isThai ? 'สต็อก' : 'Stock',
                icon: Boxes,
              },
              {
                id: 'shift' as NavRoute,
                label: isThai ? 'กะเงินสด' : 'Shift',
                icon: Banknote,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = currentRoute === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onNavigate(tab.id)}
                className={`flex-1 min-h-[44px] py-1 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer active:scale-95 ${
                  active
                    ? 'text-primary font-black bg-primary/10'
                    : 'text-text/60 hover:text-text font-semibold'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="text-[10px] leading-tight truncate max-w-[70px]">
                  {tab.label}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(true)}
            className="flex-1 min-h-[44px] py-1 rounded-xl flex flex-col items-center justify-center gap-0.5 text-text/60 hover:text-text font-semibold transition-all cursor-pointer active:scale-95"
          >
            <Menu className="h-4 w-4 shrink-0" />
            <span className="text-[10px] leading-tight">
              {isThai ? 'เมนูทั้งหมด' : 'More'}
            </span>
          </button>
        </nav>

        {/* Bottom Diagnostics Bar */}
        <StatusBar />
      </div>

      {/* Global Command Palette (Ctrl+K / ⌘K) */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        currentRoute={currentRoute}
        onNavigate={onNavigate}
        onOpenHoldModal={() => setIsHoldModalOpen(true)}
      />

      {/* Held Orders Modal */}
      <HoldOrdersModal
        isOpen={isHoldModalOpen}
        onClose={() => setIsHoldModalOpen(false)}
      />

      {/* Secure Lock Screen / Screensaver Modal */}
      <LockScreenModal />

      {/* Real-time Sync Activity Panel (Local POS Cache <-> Cloud DB) */}
      <SyncActivityPanel
        isOpen={isSyncActivityOpen}
        onClose={closeSyncActivity}
      />

      {/* Global Toast Notifications Container */}
      <ToastContainer />
    </div>
  );
};
