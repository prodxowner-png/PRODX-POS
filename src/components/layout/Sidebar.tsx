import React, { useState } from 'react';
import {
  LayoutGrid,
  ShoppingCart,
  ReceiptText,
  Boxes,
  Users,
  Banknote,
  ShieldCheck,
  Settings,
  ChevronRight,
  LogOut,
  X,
  Shield,
  Lock,
  ChefHat,
  Zap,
  Globe,
  Building2,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useShift } from '../../context/ShiftContext';
import { useLanguage } from '../../context/LanguageContext';
import { formatMoney } from '../../domain/money';
import { ProdxLogo } from '../common/ProdxLogo';
import { Badge } from '../common/Badge';
import { GraphicIcon, GraphicIconColor } from '../common/GraphicIcon';
import { RbacGuard, useRbac } from '../auth/RbacGuard';
import type { NavRoute } from '../../domain/routes';
export type { NavRoute };

export interface SidebarProps {
  currentRoute: NavRoute;
  onNavigate: (route: NavRoute) => void;
  onOpenAdminConsole?: () => void;
  onCloseMobile?: () => void;
}

interface NavItemConfig {
  id: NavRoute;
  label: string;
  icon: any;
  color: GraphicIconColor;
  shortcut?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentRoute,
  onNavigate,
  onOpenAdminConsole,
  onCloseMobile,
}) => {
  const { session, logout } = useAuth();
  const { canAccessModule, isAdmin, isGeneralUser } = useRbac();
  const { currentShift } = useShift();
  const { language, setLanguage, t } = useLanguage();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const navItems: NavItemConfig[] = [
    {
      id: 'pos',
      label: t.nav.pos,
      icon: ShoppingCart,
      color: 'primary',
      shortcut: 'F1',
    },
    {
      id: 'dashboard',
      label: t.nav.dashboard,
      icon: LayoutGrid,
      color: 'indigo',
      shortcut: 'F2',
    },
    {
      id: 'kds',
      label: (t.nav as any).kds || (language === 'th' ? 'จอแสดงในครัว (KDS)' : 'Kitchen Display'),
      icon: ChefHat,
      color: 'amber',
      shortcut: 'F10',
    },
    {
      id: 'orders',
      label: t.nav.orders,
      icon: ReceiptText,
      color: 'blue',
      shortcut: 'F3',
    },
    {
      id: 'inventory',
      label: t.nav.inventory,
      icon: Boxes,
      color: 'emerald',
      shortcut: 'F4',
    },
    {
      id: 'shift',
      label: t.nav.shift,
      icon: Banknote,
      color: 'amber',
      shortcut: 'F5',
    },
    {
      id: 'customers',
      label: t.nav.customers,
      icon: Users,
      color: 'purple',
      shortcut: 'F6',
    },
    {
      id: 'audit',
      label: t.nav.audit,
      icon: ShieldCheck,
      color: 'rose',
      shortcut: 'F7',
    },
    {
      id: 'infrastructure',
      label: language === 'th' ? 'ระบบ AI และอุปกรณ์ (Antigravity)' : 'Antigravity AI & PnP',
      icon: Zap,
      color: 'indigo',
    },
    {
      id: 'tasks',
      label: language === 'th' ? 'รายการงาน (Tasks)' : 'Task Manager',
      icon: LayoutGrid,
      color: 'indigo',
    },
    {
      id: 'settings',
      label: t.nav.settings,
      icon: Settings,
      color: 'cyan',
      shortcut: 'F8',
    },
  ];

  const handleNav = (route: NavRoute) => {
    onNavigate(route);
    if (onCloseMobile) onCloseMobile();
  };

  const handleConfirmLogout = () => {
    setShowLogoutConfirm(false);
    logout();
  };

  const currentRole = session?.currentUser?.role;

  return (
    <>
      <aside className="w-[280px] min-w-[280px] max-w-[280px] h-full min-h-full bg-card border-r border-border text-text flex flex-col justify-between shrink-0 select-none">
        {/* ส่วนบน: โลโก้ และ รายการเมนู */}
        <div className="flex flex-col min-h-0 flex-1">
          <div className="h-16 px-4 flex items-center justify-between border-b border-border shrink-0">
            <ProdxLogo variant="horizontal" size="sm" showTagline={true} />
            {currentRole && (
              <Badge
                variant={currentRole === 'admin' ? 'primary' : currentRole === 'manager' ? 'warning' : 'neutral'}
                size="sm"
                className="font-mono uppercase text-[9px] font-black px-2 py-0.5 tracking-wider"
              >
                {currentRole === 'cashier' ? 'POS ONLY' : currentRole}
              </Badge>
            )}
          </div>

          {/* RBAC Policy Tier Banner */}
          <div className="px-3 pt-2.5 pb-1 shrink-0">
            {isGeneralUser ? (
              <div className="px-2.5 py-2 rounded-xl border border-amber-500/25 bg-amber-500/10 flex items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-bold truncate">
                  <Lock className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {language === 'th' ? 'สิทธิ์ User ทั่วไป: เฉพาะหน้า POS' : 'General User: POS-Only Access'}
                  </span>
                </div>
                <span className="font-mono text-[9px] uppercase font-black px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 shrink-0">
                  RBAC
                </span>
              </div>
            ) : isAdmin && onOpenAdminConsole ? (
              <button
                type="button"
                onClick={() => {
                  onOpenAdminConsole();
                  if (onCloseMobile) onCloseMobile();
                }}
                className="w-full px-3 py-2 rounded-xl border border-primary/35 bg-primary/10 hover:bg-primary/15 text-primary flex items-center justify-between gap-2 text-xs font-bold transition-all cursor-pointer active:scale-95"
              >
                <span className="flex items-center gap-2 truncate">
                  <Building2 className="w-4 h-4 shrink-0" />
                  <span className="truncate">
                    {language === 'th' ? 'ตั้งค่าระดับองค์กร (Admin Console)' : 'Org Admin Console (/admin)'}
                  </span>
                </span>
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              </button>
            ) : null}
          </div>

          <nav className="p-3 space-y-1.5 overflow-y-auto overflow-x-hidden min-h-0 flex-1 w-full max-w-full no-scrollbar">
            {navItems
              .filter((item) => (isGeneralUser ? item.id === 'pos' : true))
              .map((item) => {
                const isRestricted = !canAccessModule(item.id);
                const isActive = currentRoute === item.id;
                const IconComp = item.icon;

                return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNav(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 min-h-[48px] rounded-xl text-sm transition-all duration-150 cursor-pointer active:scale-95 ${
                    isActive
                      ? 'bg-primary/10 border border-primary/40 text-primary font-black shadow-xs'
                      : 'border border-transparent text-text/70 hover:text-text hover:bg-background/80 font-semibold'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <GraphicIcon
                      icon={IconComp}
                      color={item.color}
                      variant={isActive ? 'badge' : 'flat'}
                      size="sm"
                      animateHover={false}
                    />
                    <span className="font-bold text-xs truncate whitespace-nowrap text-left flex items-center gap-1.5">
                      {item.label}
                      {isRestricted && (
                        <Lock className={`w-3 h-3 ${isActive ? 'text-primary' : 'text-amber-500/80'} shrink-0`} />
                      )}
                    </span>
                  </div>
                  {item.shortcut && (
                    <kbd
                      className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ml-2 ${
                        isActive
                          ? 'bg-primary/20 text-primary font-bold border border-primary/30'
                          : 'bg-background border border-border text-text/40'
                      }`}
                    >
                      {item.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* ส่วนล่าง: Active Shift Card และ Action Dock */}
        <div className="p-3.5 border-t border-border space-y-2.5 shrink-0 bg-card">
          {/* การ์ด Active Shift จัดข้อความให้อ่านง่าย ชัดเจน (ซ่อนเมื่อไม่มีสิทธิ์เข้าถึงโมดูล shift) */}
          <RbacGuard module="shift" hideMode="hidden">
            <div
              onClick={() => handleNav('shift')}
              className="p-3 rounded-xl border border-border bg-background hover:border-primary/50 transition-all cursor-pointer shadow-2xs active:scale-95"
            >
              <div className="flex items-center justify-between text-xs font-bold mb-1">
                <span className="text-text/70">
                  {language === 'th' ? 'กะที่กำลังทำงาน' : 'Active Shift'}
                </span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    currentShift ? 'bg-emerald-500 animate-pulse' : 'bg-text/30'
                  }`}
                />
              </div>
              {currentShift ? (
                <div className="space-y-1">
                  <div className="text-xs font-bold text-text leading-tight truncate">
                    {currentShift.registerId} · {currentShift.cashierName}
                  </div>
                  <div className="text-[11px] font-medium text-text/60 flex items-center justify-between gap-2">
                    <span className="shrink-0">{t.shift.expectedInDrawer}:</span>
                    <span className="font-mono font-bold text-text truncate text-right tabular-nums">
                      {formatMoney(currentShift.expectedCashInDrawer)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-amber-600 dark:text-amber-500 font-bold flex items-center justify-between">
                  <span>{t.shift.noActiveShift}</span>
                  <ChevronRight className="h-4 w-4 shrink-0" />
                </div>
              )}
            </div>
          </RbacGuard>

          {/* ปุ่มสลับภาษา, ตั้งค่า และ ออกจากระบบ */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                const nextLang = language === 'th' ? 'en' : 'th';
                setLanguage(nextLang);
              }}
              className="flex-1 min-h-[44px] px-3 rounded-xl border border-border bg-background text-xs font-bold text-text hover:bg-background/80 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all shadow-2xs"
              title={language === 'th' ? 'Switch to English' : 'เปลี่ยนเป็นภาษาไทย'}
            >
              <Globe className="h-3.5 w-3.5 text-indigo-500" />
              <span>{language === 'th' ? 'EN' : 'TH'}</span>
            </button>
            <RbacGuard module="settings" hideMode="hidden">
              <button
                type="button"
                onClick={() => handleNav('settings')}
                className="flex-1 min-h-[44px] px-3 rounded-xl border border-border bg-background text-xs font-bold text-text hover:bg-background/80 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all shadow-2xs"
              >
                <GraphicIcon
                  icon={Settings}
                  color="cyan"
                  variant="flat"
                  size="sm"
                  animateHover={false}
                />
                <span className="truncate">{language === 'th' ? 'ตั้งค่า' : 'Settings'}</span>
              </button>
            </RbacGuard>
          </div>
          
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className="w-full min-h-[44px] px-3 rounded-xl border border-rose-500/20 bg-rose-500/10 text-xs font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 transition-all shadow-2xs"
          >
            <GraphicIcon
              icon={LogOut}
              color="rose"
              variant="flat"
              size="sm"
              animateHover={false}
            />
            <span className="truncate">{language === 'th' ? 'ออกจากระบบ' : 'Sign Out'}</span>
          </button>
        </div>
      </aside>

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm transition-opacity animate-in fade-in duration-150">
          <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-xl animate-in zoom-in-95 duration-150">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-text/50 hover:text-text hover:bg-background transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="my-2 flex items-center justify-center">
              <GraphicIcon
                icon={LogOut}
                color="rose"
                variant="glow"
                size="lg"
              />
            </div>
            <h3 className="text-base font-bold text-text tracking-tight mt-3">
              {language === 'th' ? 'ต้องการออกจากระบบหรือไม่?' : 'Sign out of POS Terminal?'}
            </h3>
            <p className="text-xs text-text/60 mt-1.5 leading-relaxed font-normal">
              {language === 'th'
                ? `คุณกำลังออกจากระบบในนาม ${session?.currentUser.name || ''} (${session?.registerId || ''}) ระบบจะล็อกหน้าจอเพื่อความปลอดภัย`
                : `You are signed in as ${session?.currentUser.name || ''} on ${session?.registerId || ''}. Session will be safely closed.`}
            </p>
            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="h-12 min-h-[48px] px-4 rounded-xl border border-border bg-card text-text/80 hover:bg-background text-xs font-bold cursor-pointer transition-colors active:scale-95"
              >
                {language === 'th' ? 'ยกเลิก' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleConfirmLogout}
                className="h-12 min-h-[48px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer transition-colors active:scale-95"
              >
                {language === 'th' ? 'ยืนยันออกระบบ' : 'Confirm Sign Out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
