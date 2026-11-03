import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { useCart } from '../../context/CartContext';
import { useShift } from '../../context/ShiftContext';
import { useOffline } from '../../context/OfflineContext';
import {
  Sun,
  Moon,
  Clock,
  Store as StoreIcon,
  ChevronDown,
  LogOut,
  Menu,
  Globe,
  Check,
  Search,
  Settings,
  X,
  Tv,
  Lock,
  Cloud,
  RefreshCw,
  ShoppingCart,
  Eye,
  Building2,
  ShieldCheck,
} from 'lucide-react';
import { ProdxLogo } from '../common/ProdxLogo';
import { StaffAvatar } from '../common/StaffAvatar';
import { NavRoute } from './Sidebar';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { ConnectivityStatusIndicator } from './ConnectivityStatusIndicator';
import { CustomerDisplayLauncherModal } from '../customerDisplay/CustomerDisplayLauncherModal';
import { GlobalSearchInput } from './GlobalSearchInput';
import { LanguageSwitcher } from '../common/LanguageSwitcher';
import { getZIndexClass } from '../../utils/ZIndexManager';
import { AVAILABLE_LANGUAGES, SupportedLanguage } from '../../i18n/types';
import { useVisualInspector } from '../../context/VisualInspectorContext';

export interface TopNavProps {
  currentRoute?: NavRoute;
  onNavigate?: (route: NavRoute) => void;
  onOpenAdminConsole?: () => void;
  onOpenMobileMenu: () => void;
  onOpenHoldModal: () => void;
  onOpenCommandPalette: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  currentRoute,
  onNavigate,
  onOpenAdminConsole,
  onOpenMobileMenu,
  onOpenHoldModal,
  onOpenCommandPalette,
}) => {
  const { session, logout, switchStore, switchCurrency, switchDemoRole, lockSystem, staffUsers, switchActiveUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage, t } = useLanguage();
  const { heldCarts } = useCart();
  const { currentShift } = useShift();
  const { isOnline, pendingCount, isSyncing } = useOffline();
  const { isInspectorActive, toggleInspector } = useVisualInspector();

  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isCurrencyMenuOpen, setIsCurrencyMenuOpen] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isCustomerDisplayModalOpen, setIsCustomerDisplayModalOpen] = useState(false);

  const getCurrentCurrencySymbol = () => {
    const cur = session?.currentStore?.currency || 'THB';
    if (cur === 'THB') return '฿';
    if (cur === 'USD') return '$';
    if (cur === 'EUR') return '€';
    if (cur === 'JPY') return '¥';
    if (cur === 'GBP') return '£';
    if (cur === 'AUD') return 'A$';
    return '$';
  };

  if (!session) return null;

  const handleConfirmLogout = () => {
    setShowLogoutModal(false);
    logout();
  };

  return (
    <>
      {/* Backdrop for closing open dropdowns */}
      {(isStoreMenuOpen || isUserMenuOpen || isCurrencyMenuOpen) && (
        <div
          className={`fixed inset-0 ${getZIndexClass('dropdownBackdrop')} bg-transparent`}
          onClick={() => {
            setIsStoreMenuOpen(false);
            setIsUserMenuOpen(false);
            setIsCurrencyMenuOpen(false);
          }}
        />
      )}

      <header className={`relative ${getZIndexClass('header')} bg-card border-b border-border h-14 sm:h-16 lg:h-16 w-full max-w-full px-2 sm:px-4 lg:px-6 flex items-center justify-between shrink-0 select-none overflow-x-clip sm:overflow-visible`}>
        {/* ========================================================================= */}
        {/* ZONE 1: Context & Navigation (Mobile Menu, Brand, Store, Register, Shift) */}
        {/* ========================================================================= */}
        <div className="flex items-center gap-1 sm:gap-2 lg:gap-3 shrink-0 min-w-0">
          {/* Mobile Drawer Trigger */}
          <button
            type="button"
            onClick={onOpenMobileMenu}
            className="lg:hidden p-2 min-h-[44px] min-w-[44px] rounded-xl text-text/70 hover:text-text hover:bg-background/80 transition-all duration-150 cursor-pointer flex items-center justify-center shrink-0 active:scale-95"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Brand Logo - Hide on very small screens to save space */}
          <div className="hidden min-[400px]:flex items-center shrink-0 pr-1 sm:pr-2">
            <ProdxLogo variant="horizontal" size="sm" showTagline={false} />
          </div>

          {/* Desktop Brand Logo fallback for very small screens */}
          <div className="flex min-[400px]:hidden items-center shrink-0 pr-1">
            <ProdxLogo variant="mark" size="sm" />
          </div>

          {/* Divider on larger screens */}
          <div className="hidden md:block h-5 w-[1px] bg-border shrink-0" />

          {/* Store Selector Dropdown */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setIsStoreMenuOpen(!isStoreMenuOpen);
                setIsCurrencyMenuOpen(false);
                setIsUserMenuOpen(false);
              }}
              className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-3 py-1.5 sm:py-2 min-h-[44px] rounded-xl border border-border border-crisp bg-background/80 hover:bg-background text-xs font-bold text-text transition-all duration-150 cursor-pointer active:scale-95"
            >
              <StoreIcon className="h-3.5 w-3.5 text-text/60 shrink-0" />
              <span className="max-w-[60px] min-[360px]:max-w-[85px] sm:max-w-[130px] md:max-w-[170px] lg:max-w-[200px] truncate">
                {session.currentStore.name}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-text/50 shrink-0" />
            </button>

            {isStoreMenuOpen && (
              <div
                className={`${getZIndexClass('dropdown')} absolute left-0 mt-2 w-72 sm:w-80 max-w-[95vw] rounded-2xl border border-border border-crisp bg-card shadow-2xl py-2 animate-in fade-in zoom-in-95 duration-100`}
              >
                <div className="px-3 py-1.5 text-[10px] font-bold text-text/50 uppercase tracking-wider">
                  {t.topNav.selectStore}
                </div>
                {session.organization.stores.map((store) => (
                  <button
                    key={store.id}
                    type="button"
                    onClick={() => {
                      switchStore(store);
                      setIsStoreMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 min-h-[44px] text-xs flex items-center justify-between hover:bg-background/80 transition-all duration-150 cursor-pointer ${
                      store.id === session.currentStore.id
                        ? 'text-primary font-bold bg-primary/10'
                        : 'text-text/70'
                    }`}
                  >
                    <div>
                      <div className="font-bold">{store.name}</div>
                      <div className="text-[11px] text-text/50 font-mono mt-0.5">{store.code} · {store.timezone}</div>
                    </div>
                    {store.id === session.currentStore.id && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Terminal / POS Register Tag */}
          <div className="hidden xl:flex items-center px-2.5 py-1.5 min-h-[44px] rounded-xl bg-background/80 border border-border border-crisp text-text/70 text-[11px] font-mono shrink-0">
            {session.registerId}
          </div>

          {/* Active Shift Indicator */}
          <div className="hidden 2xl:flex items-center gap-2 px-2.5 py-1.5 min-h-[44px] rounded-xl border border-border border-crisp bg-background/80 shrink-0">
             <div className={`w-2 h-2 rounded-full ${currentShift ? 'bg-emerald-500' : 'bg-amber-500'}`} />
             <span className="text-[10px] font-bold text-text/70 uppercase">
                {currentShift ? t.topNav.shiftOpen : t.topNav.noShift}
             </span>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* ZONE 2: Search, Utilities & Actions (Hidden or compact on mobile) */}
        {/* ========================================================================= */}
        <div className="flex items-center gap-1 sm:gap-2 lg:gap-2.5 shrink-0 ml-auto pr-0 sm:pr-1">
          {/* Global Search Input (Hidden on mobile) */}
          <div className="hidden lg:block w-48 xl:w-64">
            <GlobalSearchInput onNavigate={onNavigate} />
          </div>

          {/* Command Palette Trigger Shortcut Button */}
          <button
            type="button"
            onClick={onOpenCommandPalette}
            className="flex items-center justify-center p-2 min-h-[44px] min-w-[44px] rounded-xl border border-border border-crisp bg-background/80 hover:bg-background text-text/70 hover:text-text text-xs font-semibold transition-all duration-150 cursor-pointer active:scale-95 shrink-0"
            title="Search Products, Customers, Orders (Ctrl+K / ⌘K)"
            aria-label="Search Products, Customers, Orders (Ctrl+K)"
          >
            <Search className="h-4 w-4 text-text/60" />
            <span className="hidden sm:inline-flex ml-1.5 font-mono text-[10px] bg-card px-1.5 py-0.5 rounded border border-border/60">
              Ctrl+K
            </span>
          </button>

          {/* Held Orders Quick Access Button (Hidden on mobile) */}
          <button
            type="button"
            onClick={onOpenHoldModal}
            className="hidden lg:flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl border border-border border-crisp bg-background/80 hover:bg-background text-xs font-bold text-text transition-all duration-150 cursor-pointer active:scale-95 relative"
            title="Held Orders / Suspended Carts"
          >
            <ShoppingCart className="h-4 w-4 text-text/70" />
            <span className="hidden xl:inline">{language === 'th' ? 'พักบิล' : 'Held'}</span>
            {heldCarts.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 bg-primary text-white text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center shadow-xs">
                {heldCarts.length}
              </span>
            )}
          </button>

          {/* Customer Facing Display 2nd Monitor Launcher (Hidden on mobile) */}
          <button
            type="button"
            onClick={() => setIsCustomerDisplayModalOpen(true)}
            className="hidden lg:flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl border border-border border-crisp bg-background/80 hover:bg-background text-text/80 text-xs font-bold transition-all duration-150 cursor-pointer active:scale-95 justify-center"
            title="เปิดหน้าจอลูกค้า (Customer-Facing Display 2nd Monitor)"
          >
            <Tv className="h-4 w-4 shrink-0 text-text/60" />
            <span className="hidden xl:inline">{language === 'th' ? 'จอลูกค้า (CFD)' : 'Customer Display'}</span>
          </button>

          <button
            type="button"
            onClick={toggleInspector}
            className={`hidden xl:flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-xl border border-border transition-all duration-150 cursor-pointer active:scale-95 justify-center ${
              isInspectorActive
                ? 'bg-destructive text-destructive-foreground font-bold shadow-md animate-pulse border-destructive'
                : 'bg-background/80 hover:bg-background text-text/70 text-text text-xs font-semibold'
            }`}
            title="Visual Inspector Mode"
          >
            <Eye className={`h-4 w-4 shrink-0 ${isInspectorActive ? 'text-white' : 'text-text/60'}`} />
            <span className="hidden 2xl:inline">Inspector</span>
          </button>

          {/* Base Currency Switcher Dropdown */}
          <div className="relative hidden lg:block">
            <button
              type="button"
              onClick={() => {
                setIsCurrencyMenuOpen(!isCurrencyMenuOpen);
                setIsStoreMenuOpen(false);
                setIsUserMenuOpen(false);
              }}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-2 min-h-[44px] min-w-[44px] justify-center rounded-xl border border-border border-crisp bg-background/80 hover:bg-background text-text/80 hover:text-text text-xs font-bold transition-all duration-150 cursor-pointer active:scale-95"
              title={language === 'th' ? 'เปลี่ยนสกุลเงินหลัก' : 'Switch Base Currency'}
            >
              <span className="text-text font-mono">{getCurrentCurrencySymbol()}</span>
              <span className="font-mono hidden sm:inline">{session.currentStore.currency || 'THB'}</span>
              <ChevronDown className="h-3 w-3 text-text/50" />
            </button>

            {isCurrencyMenuOpen && (
              <div
                className={`${getZIndexClass('dropdown')} absolute right-0 mt-2 w-48 max-w-[90vw] overflow-x-hidden rounded-2xl border border-border border-crisp bg-card shadow-2xl py-2 animate-in fade-in zoom-in-95 duration-100`}
                onMouseLeave={() => setIsCurrencyMenuOpen(false)}
              >
                <div className="px-3 py-1.5 text-[10px] font-bold text-text/50 uppercase tracking-wider">
                  {language === 'th' ? 'สกุลเงินหลัก' : 'Base Currency'}
                </div>
                {[
                  { code: 'THB', symbol: '฿', name: 'THB (฿)' },
                  { code: 'USD', symbol: '$', name: 'USD ($)' },
                  { code: 'EUR', symbol: '€', name: 'EUR (€)' },
                  { code: 'JPY', symbol: '¥', name: 'JPY (¥)' },
                  { code: 'GBP', symbol: '£', name: 'GBP (£)' },
                  { code: 'AUD', symbol: 'A$', name: 'AUD (A$)' },
                ].map((cur) => (
                  <button
                    key={cur.code}
                    type="button"
                    onClick={() => {
                      switchCurrency(cur.code);
                      setIsCurrencyMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2.5 min-h-[44px] text-xs flex items-center justify-between hover:bg-background/80 transition-all duration-150 cursor-pointer ${
                      (session.currentStore.currency || 'THB') === cur.code
                        ? 'text-primary font-bold bg-primary/10'
                        : 'text-text/70'
                    }`}
                  >
                    <span>{cur.name}</span>
                    {(session.currentStore.currency || 'THB') === cur.code && (
                      <Check className="h-4 w-4 text-primary" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Language Switcher Dropdown */}
          <LanguageSwitcher />

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className="hidden lg:flex min-w-[44px] min-h-[44px] items-center justify-center p-2 rounded-xl border border-border border-crisp hover:bg-background text-text/70 transition-all duration-150 cursor-pointer active:scale-95"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-primary" />}
          </button>

          {/* OfflineProvider Real-Time Connectivity Status Indicator (Online/Offline) */}
          <div className="flex items-center shrink-0">
            <ConnectivityStatusIndicator />
          </div>

          {/* Cashier / User Profile & Comprehensive Account Menu (Far Right) */}
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => {
                setIsUserMenuOpen(!isUserMenuOpen);
                setIsStoreMenuOpen(false);
                setIsCurrencyMenuOpen(false);
              }}
              className="flex items-center justify-center gap-1.5 sm:gap-2 p-1.5 min-h-[44px] min-w-[44px] rounded-xl border border-border border-crisp bg-background/80 hover:bg-background transition-all duration-150 cursor-pointer active:scale-95 shrink-0"
            >
              <div className="flex flex-col items-end hidden xl:flex">
                <span className="text-xs font-bold text-text leading-tight">{session.currentUser.name}</span>
                <span className="text-[10px] font-bold text-text/50 uppercase leading-tight">{session.currentUser.role}</span>
              </div>
              {/* User Profile Avatar with Online Status Indicator Dot */}
              <StaffAvatar
                name={session.currentUser.name}
                size="sm"
                showStatusIndicator
                isOnline={isOnline}
              />
            </button>

            {isUserMenuOpen && (
              <div
                className={`${getZIndexClass('dropdown')} absolute right-0 mt-2 w-64 max-w-[90vw] overflow-x-hidden rounded-2xl border border-border border-crisp bg-card shadow-2xl py-2 animate-in fade-in zoom-in-95 duration-100`}
                onMouseLeave={() => setIsUserMenuOpen(false)}
              >
                {/* User Details */}
                <div className="px-4 pb-3 border-b border-border border-crisp">
                  <div className="text-sm font-bold text-text">
                    {session.currentUser.name}
                  </div>
                  <div className="text-xs text-text/60">{session.currentUser.email}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-background border border-border text-[10px] font-bold text-text/70 uppercase">
                      {session.currentUser.role}
                    </span>
                    <span className="text-[10px] text-text/50 font-mono">
                      {session.currentUser.employeeCode}
                    </span>
                  </div>
                </div>

                {/* Mobile Extra Controls */}
                <div className="lg:hidden px-3 py-2 border-b border-border border-crisp grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const sequence: SupportedLanguage[] = ['th', 'en', 'zh', 'ja'];
                      const next = sequence[(sequence.indexOf(language as SupportedLanguage) + 1) % sequence.length];
                      setLanguage(next);
                    }}
                    className="flex items-center justify-center gap-2 py-2 min-h-[44px] rounded-xl border border-border border-crisp text-xs font-bold text-text/80 hover:bg-background cursor-pointer active:scale-95"
                  >
                    <Globe className="h-4 w-4" />
                    <span>{AVAILABLE_LANGUAGES[language as SupportedLanguage]?.flag || '🌐'} {language.toUpperCase()}</span>
                  </button>
                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="flex items-center justify-center gap-2 py-2 min-h-[44px] rounded-xl border border-border border-crisp text-xs font-bold text-text/80 hover:bg-background cursor-pointer active:scale-95"
                  >
                    {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-primary" />}
                    <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
                  </button>
                </div>

                {/* Quick Navigation to Settings & Organization Admin Console from User Menu */}
                <div className="py-1 px-2 space-y-1">
                  {session.currentUser.role === 'cashier' ? (
                    <div className="w-full px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] font-bold text-amber-600 dark:text-amber-400 flex items-center gap-2">
                      <Lock className="h-3.5 w-3.5 shrink-0" />
                      <span>
                        {language === 'th'
                          ? 'สิทธิ์ User ทั่วไป: เฉพาะหน้า POS'
                          : 'General User: POS-Only Access'}
                      </span>
                    </div>
                  ) : (
                    onNavigate && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onNavigate('settings');
                        }}
                        className="w-full px-3 py-2.5 min-h-[44px] rounded-xl text-left text-xs font-bold text-text/80 hover:bg-background flex items-center justify-between gap-2 cursor-pointer transition-colors active:scale-95"
                      >
                        <span className="flex items-center gap-2">
                          <Settings className="h-4 w-4 text-text/60" />
                          <span>
                            {session.currentUser.role === 'admin'
                              ? language === 'th'
                                ? 'ตั้งค่าระดับองค์กรและระบบ'
                                : 'Organization & System Settings'
                              : language === 'th'
                              ? 'ตั้งค่าระดับสาขา'
                              : 'Store Settings'}
                          </span>
                        </span>
                        <span className="font-mono text-[9px] uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          {session.currentUser.role === 'admin' ? 'FULL ORG' : 'STORE'}
                        </span>
                      </button>
                    )
                  )}

                  {session.currentUser.role === 'admin' && onOpenAdminConsole && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsUserMenuOpen(false);
                        onOpenAdminConsole();
                      }}
                      className="w-full px-3 py-2.5 min-h-[44px] rounded-xl text-left text-xs font-bold text-primary bg-primary/10 hover:bg-primary/15 border border-primary/25 flex items-center justify-between gap-2 cursor-pointer transition-colors active:scale-95"
                    >
                      <span className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 shrink-0" />
                        <span>
                          {language === 'th'
                            ? 'จัดการองค์กร สาขา และเครื่อง POS'
                            : 'Organization Admin Console'}
                        </span>
                      </span>
                      <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                    </button>
                  )}
                </div>

                {/* Lock Terminal Option */}
                <div className="py-1 px-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      lockSystem();
                    }}
                    className="w-full px-3 py-2.5 min-h-[44px] rounded-xl text-left text-xs font-bold text-text/80 hover:bg-background flex items-center gap-2 cursor-pointer transition-colors active:scale-95"
                  >
                    <Lock className="h-4 w-4 text-text/60" />
                    <span>{language === 'th' ? 'ล็อกหน้าจอ' : 'Lock Terminal'}</span>
                  </button>
                </div>

                {/* Quick Staff User Switcher */}
                <div className="py-2 px-3 border-t border-border border-crisp">
                  <div className="text-[10px] font-bold text-text/50 uppercase tracking-wider mb-2 flex items-center justify-between">
                    <span>{language === 'th' ? 'สลับบัญชีผู้ใช้งาน' : 'Switch Staff'}</span>
                    <span className="font-mono text-[9px] text-text/40">{staffUsers.length}</span>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-1 pr-0.5">
                    {staffUsers.map((user) => {
                      const isCurrent = session.currentUser.id === user.id;
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => {
                            switchActiveUser(user);
                            setIsUserMenuOpen(false);
                          }}
                          className={`w-full px-2.5 py-1.5 rounded-lg text-left text-xs flex items-center justify-between transition-colors cursor-pointer ${
                            isCurrent
                              ? 'bg-primary/10 text-primary font-bold border border-primary/20'
                              : 'hover:bg-background text-text/80'
                          }`}
                        >
                          <div className="truncate pr-2">
                            <span className="truncate block font-medium">{user.name}</span>
                            <span className="text-[10px] text-text/50 font-mono block">
                              {user.employeeCode} • {user.role}
                            </span>
                          </div>
                          {isCurrent && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Quick Role Switcher for testing RBAC boundaries */}
                <div className="py-2 px-3 border-t border-border border-crisp">
                  <div className="text-[10px] font-bold text-text/50 uppercase tracking-wider mb-2">
                    {t.topNav.testRbac}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['cashier', 'manager', 'admin'] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => {
                          switchDemoRole(r);
                          setIsUserMenuOpen(false);
                        }}
                        className={`text-[10px] py-2 min-h-[40px] rounded-lg font-bold text-center capitalize cursor-pointer transition-colors active:scale-95 ${
                          session.currentUser.role === r
                            ? 'bg-primary text-white shadow-xs'
                            : 'bg-background border border-border text-text/70 hover:text-text'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* High-visibility Logout button in dropdown */}
                <div className="p-2 border-t border-border border-crisp">
                  <button
                    type="button"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      setShowLogoutModal(true);
                    }}
                    className="w-full px-3 py-2.5 min-h-[44px] rounded-xl text-left text-xs font-bold text-red-600 dark:text-red-400 bg-red-500/10 hover:bg-red-500/20 flex items-center gap-2 cursor-pointer transition-colors active:scale-95"
                  >
                    <LogOut className="h-4 w-4 shrink-0" />
                    <span>{t.topNav.signOut}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className={`fixed inset-0 ${getZIndexClass('modal')} flex items-center justify-center p-4 bg-zinc-950/60 dark:bg-black/80 backdrop-blur-sm transition-opacity animate-in fade-in duration-150`}>
          <div className="w-full max-w-sm rounded-2xl border border-border border-crisp bg-card p-6 text-center shadow-xl animate-in zoom-in-95 duration-150">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowLogoutModal(false)}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-text/50 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-background transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="my-2 flex items-center justify-center">
              <div className="h-12 w-12 rounded-xl bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 flex items-center justify-center border border-rose-200/60 dark:border-rose-900/60">
                <LogOut className="h-6 w-6" />
              </div>
            </div>
            <h3 className="text-base font-semibold text-text tracking-tight mt-3">
              {language === 'th' ? 'ต้องการออกจากระบบหรือไม่?' : 'Sign out of POS Terminal?'}
            </h3>
            <p className="text-xs text-text/60 mt-1.5 leading-relaxed">
              {language === 'th'
                ? `คุณกำลังออกจากระบบในนาม ${session?.currentUser.name || ''} (${session?.registerId || ''}) สาขา ${session?.currentStore.name || ''}`
                : `You are signed in as ${session?.currentUser.name || ''} on ${session?.registerId || ''} (${session?.currentStore.name || ''}).`}
            </p>
            <div className="grid grid-cols-2 gap-3 mt-6">
              <button
                type="button"
                onClick={() => setShowLogoutModal(false)}
                className="h-12 min-h-[48px] px-4 rounded-xl border border-border border-crisp bg-card text-text/80 hover:bg-background text-xs font-semibold cursor-pointer transition-colors active:scale-95"
              >
                {language === 'th' ? 'ยกเลิก' : 'Cancel'}
              </button>
              <button
                type="button"
                onClick={handleConfirmLogout}
                className="h-12 min-h-[48px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer transition-colors shadow-2xs active:scale-95"
              >
                {language === 'th' ? 'ยืนยันออกระบบ' : 'Confirm Sign Out'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Display Launcher Modal */}
      <CustomerDisplayLauncherModal
        isOpen={isCustomerDisplayModalOpen}
        onClose={() => setIsCustomerDisplayModalOpen(false)}
      />
    </>
  );
};
