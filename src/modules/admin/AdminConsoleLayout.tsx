import React from 'react';
import {
  Activity,
  ArrowLeft,
  Building2,
  FileSearch,
  Globe2,
  LayoutGrid,
  Lock,
  LogOut,
  Monitor,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Store,
  UserCheck,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { ProdxVectorMark } from '../../components/common/ProdxLogo';
import { AdminSyncStatusIndicator } from '../../components/admin/AdminSyncStatusIndicator';
import { AdminLoginScreen } from './AdminLoginScreen';
import { useAdminInactivityTimeout } from '../../hooks/useAdminInactivityTimeout';
import { AdminContentSkeleton, AdminConsoleSkeleton } from './AdminConsoleSkeleton';
import type { AdminConsoleSection } from '../../domain/routes';
export type { AdminConsoleSection };
export { AdminContentSkeleton, AdminConsoleSkeleton };

export interface AdminConsoleLayoutProps {
  activeSection: AdminConsoleSection;
  onSelectSection: (section: AdminConsoleSection) => void;
  onExitAdminMode?: () => void;
  children: React.ReactNode;
}

export const AdminConsoleLayout: React.FC<AdminConsoleLayoutProps> = ({
  activeSection,
  onSelectSection,
  onExitAdminMode,
  children,
}) => {
  const { session, logout } = useAuth();
  const { language, setLanguage } = useLanguage();
  const isThai = language === 'th';

  // 15 minutes inactivity timeout for admin session security
  useAdminInactivityTimeout({ timeoutMinutes: 15, warningMinutes: 14 });

  const handleReturnToPos = () => {
    if (onExitAdminMode) {
      onExitAdminMode();
      return;
    }
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  // 1. Unauthenticated guard: render dedicated AdminLoginScreen
  if (!session) {
    return <AdminLoginScreen onBackToPos={handleReturnToPos} />;
  }

  const currentUser = session.currentUser;
  const isAdmin = currentUser.role === 'admin';

  // 2. Strict 'admin' role enforcement guard
  if (!isAdmin) {
    return (
      <div className="min-h-[100svh] bg-brand-bg text-brand-text flex flex-col items-center justify-center p-6 font-sans">
        <div className="w-full max-w-lg rounded-2xl border border-brand-border bg-brand-surface p-8 shadow-2xl space-y-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400">
            <ShieldAlert className="h-7 w-7" />
          </div>

          <div className="inline-flex items-center gap-2 rounded-full bg-rose-500/10 border border-rose-500/20 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-rose-400">
            <Lock className="h-3.5 w-3.5" />
            {isThai ? 'จำกัดสิทธิ์เฉพาะผู้ดูแลระบบ (Admin Only)' : 'Administrator Role Required'}
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-black tracking-tight text-brand-text">
              {isThai
                ? 'ปฏิเสธการเข้าถึง Administrator Console'
                : 'Administrator Console Access Denied'}
            </h1>
            <p className="text-sm text-brand-text-secondary leading-relaxed">
              {isThai
                ? 'ชุดเครื่องมือตั้งค่าองค์กร สาขา เครื่อง POS และการจัดการระบบ สงวนไว้สำหรับผู้ใช้งานที่ได้รับสิทธิ์ระดับผู้ดูแลระบบ (admin) เท่านั้น'
                : 'Full console access for managing organizations, branches, POS terminals, RBAC permissions, and audit trails is strictly restricted to authenticated users with the "admin" role.'}
            </p>
          </div>

          <div className="rounded-xl border border-brand-border bg-brand-surface-muted p-4 text-left text-xs space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-brand-text-secondary">
                {isThai ? 'บัญชีผู้ใช้งานปัจจุบัน:' : 'Authenticated User:'}
              </span>
              <span className="font-bold text-brand-text">
                {currentUser.name} ({currentUser.email})
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-brand-text-secondary">
                {isThai ? 'บทบาทปัจจุบัน (Current Role):' : 'Current Role:'}
              </span>
              <span className="rounded-md bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-amber-300">
                {currentUser.role}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-brand-text-secondary">
                {isThai ? 'บทบาทที่ต้องการ (Required Role):' : 'Required Role:'}
              </span>
              <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 font-mono text-[11px] font-bold uppercase text-emerald-300">
                admin
              </span>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <button
              type="button"
              onClick={handleReturnToPos}
              className="flex-1 h-12 rounded-xl border border-brand-border bg-brand-surface hover:bg-brand-surface-hover text-xs font-black text-brand-text flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              {isThai ? 'กลับสู่หน้า POS ปกติ' : 'Return to POS Console'}
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="flex-1 h-12 rounded-xl bg-cta hover:bg-cta-hover text-xs font-black text-cta-text flex items-center justify-center gap-2 transition-all cursor-pointer shadow-md shadow-cta/20"
            >
              <LogOut className="h-4 w-4" />
              {isThai ? 'ออกจากระบบเพื่อเข้าสู่ระบบ Admin' : 'Sign Out & Switch to Admin Account'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const navItems: {
    id: AdminConsoleSection;
    label: string;
    sublabel: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    {
      id: 'overview',
      label: isThai ? 'ภาพรวมโครงสร้างทั้งหมด' : 'Configuration Suite',
      sublabel: isThai ? 'จัดการทั้งองค์กร สาขา และเครื่องขาย' : 'All entities in one workspace',
      icon: LayoutGrid,
    },
    {
      id: 'organizations',
      label: isThai ? 'องค์กร (Organizations)' : 'Organizations',
      sublabel: isThai ? 'หน่วยธุรกิจและรหัสอ้างอิง (Slug)' : 'Tenant entities & slugs',
      icon: Building2,
    },
    {
      id: 'branches',
      label: isThai ? 'สาขา (Store Branches)' : 'Store Branches',
      sublabel: isThai ? 'สาขาและที่ตั้งหน้าร้าน' : 'Locations per organization',
      icon: Store,
    },
    {
      id: 'terminals',
      label: isThai ? 'เครื่องขาย (POS Terminals)' : 'POS Terminals',
      sublabel: isThai ? 'จุดชำระเงินประจำสาขา' : 'Registers & checkout counters',
      icon: Monitor,
    },
    {
      id: 'rbac',
      label: isThai ? 'สิทธิ์ RBAC และตั้งค่าระบบ' : 'RBAC & System Settings',
      sublabel: isThai ? 'จัดการพนักงาน สิทธิ์ และพารามิเตอร์' : 'Staff directory, roles & store policies',
      icon: Settings,
    },
    {
      id: 'audit',
      label: isThai ? 'บันทึกความปลอดภัย (Audit)' : 'Security & Audit Logs',
      sublabel: isThai ? 'ประวัติการทำรายการและเหตุการณ์สำคัญ' : 'Immutable operational & security trail',
      icon: FileSearch,
    },
    {
      id: 'infrastructure',
      label: isThai ? 'โครงสร้างพื้นฐานและฐานข้อมูล' : 'Infrastructure & Health',
      sublabel: isThai ? 'ตรวจสอบสถานะระบบและการซิงค์' : 'Database, sync & runtime diagnostics',
      icon: Activity,
    },
    {
      id: 'bundle_trends',
      label: isThai ? 'แนวโน้มขนาด Bundle' : 'Bundle Size Trends',
      sublabel: isThai ? 'วิเคราะห์ข้อมูล metafile และประวัติขนาด' : 'Metafile chunk growth & size history',
      icon: TrendingUp,
    },
  ];

  return (
    <div className="min-h-[100svh] bg-brand-bg text-brand-text flex flex-col font-sans">
      {/* Top Executive Admin Header */}
      <header className="sticky top-0 z-30 h-14 sm:h-16 bg-brand-primary text-brand-primary-text border-b border-brand-border/60 px-3 sm:px-6 lg:px-8 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 sm:gap-3.5 min-w-0">
          <ProdxVectorMark size={36} className="shadow-lg shadow-cta/15 rounded-xl shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-black tracking-tight text-sm sm:text-base lg:text-lg truncate text-white">
                PRODX <span className="text-cta">ADMIN CONSOLE</span>
              </span>
              <span className="hidden md:inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-500/40 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-emerald-300 shrink-0">
                <ShieldCheck className="h-3 w-3" />
                RBAC: ADMIN VERIFIED
              </span>
            </div>
            <p className="text-[11px] text-slate-200 hidden sm:block truncate">
              {isThai
                ? 'ระบบบริหารจัดการระดับองค์กร (แยกจากหน้าจอขาย POS มาตรฐาน)'
                : 'Enterprise Administration & Full Configuration Console · Isolated from POS Navigation'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {/* Live Firestore Write Queue & Synchronization Conflict Indicator */}
          <AdminSyncStatusIndicator variant="header" />

          {/* Active Admin Identity Badge */}
          <div className="hidden xl:flex items-center gap-2.5 rounded-xl bg-white/10 border border-white/20 px-3 py-1.5">
            <UserCheck className="h-4 w-4 text-emerald-300" />
            <div className="text-xs">
              <div className="font-bold text-white leading-none">{currentUser.name}</div>
              <div className="text-[10px] text-slate-200 font-mono mt-0.5">
                {currentUser.email} · {currentUser.role.toUpperCase()}
              </div>
            </div>
          </div>

          {/* Language Toggle */}
          <button
            type="button"
            onClick={() => setLanguage(isThai ? 'en' : 'th')}
            className="min-h-[44px] px-3 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 text-xs font-bold text-white flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-colors cursor-pointer"
          >
            <Globe2 className="h-4 w-4 text-slate-200" />
            <span>{isThai ? 'EN' : 'ไทย'}</span>
          </button>

          {/* Return to POS Terminal */}
          <button
            type="button"
            onClick={handleReturnToPos}
            className="min-h-[44px] px-3.5 rounded-xl border border-white/20 bg-white/10 hover:bg-white/20 text-xs font-black text-white flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 transition-colors cursor-pointer"
          >
            <ArrowLeft className="h-4 w-4 text-cta" />
            <span className="hidden min-[420px]:inline">{isThai ? 'สลับไปหน้า POS' : 'POS Terminal'}</span>
            <span className="min-[420px]:hidden">POS</span>
          </button>

          {/* Sign Out */}
          <button
            type="button"
            onClick={() => void logout()}
            className="min-h-[44px] px-3.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-xs font-black text-white flex items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 transition-colors cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">{isThai ? 'ออกจากระบบ' : 'Sign Out'}</span>
          </button>
        </div>
      </header>

      {/* Main Console Body with Responsive Mobile/Tablet Top Bar & Desktop Admin Rail */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        <aside className="sticky top-14 sm:top-16 lg:static z-20 w-full lg:w-72 bg-brand-surface text-brand-text border-b lg:border-b-0 lg:border-r border-brand-border px-3 py-2.5 sm:p-3.5 lg:p-5 flex flex-col justify-between shrink-0">
          <div className="space-y-2 lg:space-y-4">
            <div className="hidden lg:block px-2">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-text-secondary">
                {isThai ? 'หมวดหมู่การตั้งค่าผู้ดูแลระบบ' : 'Admin Console Modules'}
              </div>
            </div>

            <nav
              aria-label="Administrator Console Navigation"
              className="flex lg:grid lg:grid-cols-1 gap-2 overflow-x-auto no-scrollbar pb-0.5 lg:pb-0"
            >
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectSection(item.id)}
                    className={`shrink-0 lg:w-full text-left rounded-xl px-3 py-2 lg:p-3 transition-all flex items-center lg:items-start gap-2.5 lg:gap-3 border cursor-pointer focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 ${
                      active
                        ? 'bg-cta text-cta-text border-cta shadow-lg shadow-cta/25'
                        : 'bg-brand-surface-muted text-brand-text-secondary border-brand-border hover:bg-brand-surface-hover hover:text-brand-text'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 lg:h-5 lg:w-5 shrink-0 lg:mt-0.5 ${
                        active ? 'text-cta-text' : 'text-cta'
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-xs font-black leading-tight whitespace-nowrap lg:whitespace-normal lg:truncate">
                        {item.label}
                      </div>
                      <div
                        className={`text-[10px] mt-0.5 leading-snug hidden lg:block ${
                          active ? 'text-cta-text font-bold' : 'text-brand-text-secondary'
                        }`}
                      >
                        {item.sublabel}
                      </div>
                    </div>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Security Policy Footer */}
          <div className="hidden lg:block mt-8 rounded-xl border border-brand-border bg-brand-surface-muted p-3.5 text-[11px] text-brand-text-secondary space-y-1.5">
            <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold">
              <ShieldCheck className="h-4 w-4" />
              <span>{isThai ? 'บังคับใช้สิทธิ์ RBAC' : 'Strict RBAC Enforced'}</span>
            </div>
            <p className="leading-relaxed">
              {isThai
                ? 'การเปลี่ยนแปลงโครงสร้างองค์กร สาขา เครื่องขาย และสิทธิ์พนักงาน จะซิงค์เข้ากับ Firestore และหน้าเข้าสู่ระบบ POS ทันที'
                : 'Changes to Organizations, Branches, Terminals, and RBAC policies synchronize directly with Firestore and POS Login.'}
            </p>
          </div>
        </aside>

        {/* Workspace Content with Skeleton Screen Loading Animation during component lazy-loading */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          <React.Suspense fallback={<AdminContentSkeleton />}>
            {children}
          </React.Suspense>
        </main>
      </div>
    </div>
  );
};
