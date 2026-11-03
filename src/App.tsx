/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider } from './context/LanguageContext';
import { SoundProvider } from './context/SoundContext';
import { HapticProvider } from './context/HapticContext';
import { ToastProvider } from './context/ToastContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { OfflineProvider } from './context/OfflineContext';
import { ShiftProvider } from './context/ShiftContext';
import { CartProvider } from './context/CartContext';
import { ReceiptPrinterProvider } from './context/ReceiptPrinterContext';
import { VisualInspectorProvider } from './context/VisualInspectorContext';
import { BreadcrumbProvider } from './context/BreadcrumbContext';
import { SettingsProvider } from './context/SettingsContext';
import { ConfirmationDialogProvider } from './context/ConfirmationDialogContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { GlobalErrorRecoveryProvider } from './context/GlobalErrorRecoveryProvider';
import { AppShell } from './components/layout/AppShell';
import { CustomerDisplayView } from './modules/customerDisplay/CustomerDisplayView';
import { NavRoute } from './components/layout/Sidebar';
import { LoginScreen } from './modules/auth/LoginScreen';
import { AdminConsoleSection, AdminConsoleSkeleton } from './modules/admin/AdminConsoleLayout';

// Optimized Lazy-Loaded Admin Components (Reduced main-bundle impact for standard staff)
const AdminLoginScreen = React.lazy(() => import('./modules/admin/AdminLoginScreen').then(m => ({ default: m.AdminLoginScreen })));
const AdminConfigDashboard = React.lazy(() => import('./modules/admin/AdminConfigDashboard').then(m => ({ default: m.AdminConfigDashboard })));
const OrganizationManagementModule = React.lazy(() => import('./modules/admin/OrganizationManagementModule').then(m => ({ default: m.OrganizationManagementModule })));
const AdminConsoleLayout = React.lazy(() => import('./modules/admin/AdminConsoleLayout').then(m => ({ default: m.AdminConsoleLayout })));
const InfrastructureDashboard = React.lazy(() => import('./components/admin/InfrastructureDashboard').then(m => ({ default: m.InfrastructureDashboard })));
const BundleSizeTrendsModule = React.lazy(() => import('./components/admin/BundleSizeTrendsModule').then(m => ({ default: m.BundleSizeTrendsModule })));
// Optimized Lazy-Loaded Operational Screens
const PosScreen = React.lazy(() => import('./modules/pos/PosScreen').then(m => ({ default: m.PosScreen })));
const DashboardScreen = React.lazy(() => import('./modules/dashboard/DashboardScreen').then(m => ({ default: m.DashboardScreen })));
const OrdersScreen = React.lazy(() => import('./modules/orders/OrdersScreen').then(m => ({ default: m.OrdersScreen })));
const InventoryScreen = React.lazy(() => import('./modules/inventory/InventoryScreen').then(m => ({ default: m.InventoryScreen })));
const ShiftScreen = React.lazy(() => import('./modules/shift/ShiftScreen').then(m => ({ default: m.ShiftScreen })));
const CustomersScreen = React.lazy(() => import('./modules/customers/CustomersScreen').then(m => ({ default: m.CustomersScreen })));
const AuditScreen = React.lazy(() => import('./modules/audit/AuditScreen').then(m => ({ default: m.AuditScreen })));
const SettingsScreen = React.lazy(() => import('./modules/settings/SettingsScreen').then(m => ({ default: m.SettingsScreen })));
const KitchenDisplayScreen = React.lazy(() => import('./modules/kds/KitchenDisplayScreen').then(m => ({ default: m.KitchenDisplayScreen })));
import { ReceiptValidationPortal } from './components/receipt/ReceiptValidationPortal';
import { ShortcutsOverlay } from './components/common/ShortcutsOverlay';
import { DevPerformanceOverlay } from './components/dev/DevPerformanceOverlay';
import { RbacGuard } from './components/auth/RbacGuard';

import { FrontendAssistant } from './components/ai/FrontendAssistant';
import { useShift } from './context/ShiftContext';
import { StartShiftModal } from './components/shift/StartShiftModal';

const TaskManagementScreen = React.lazy(() => import('./modules/tasks/TaskManagementScreen'));

const checkIsAdminPath = () => {
  if (typeof window === 'undefined') return false;
  return (
    window.location.pathname.startsWith('/admin') ||
    window.location.hash.startsWith('#admin') ||
    window.location.search.includes('mode=admin')
  );
};

const checkIsDedicatedAdminLoginPath = () => {
  if (typeof window === 'undefined') return false;
  return (
    window.location.pathname.startsWith('/admin/login') ||
    window.location.hash.startsWith('#admin-login') ||
    window.location.search.includes('mode=admin-login')
  );
};

const MainApplication: React.FC = () => {
  const { session } = useAuth();
  const { currentShift, isLoading: isShiftLoading } = useShift();
  const [isStartShiftModalOpen, setIsStartShiftModalOpen] = useState(false);
  const autoShiftPromptKeyRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (session && !isShiftLoading && !currentShift) {
      const promptKey = `${session.currentUser.id}-${session.registerId}-${session.currentStore.id}`;
      if (autoShiftPromptKeyRef.current !== promptKey) {
        autoShiftPromptKeyRef.current = promptKey;
        setIsStartShiftModalOpen(true);
      }
    }
  }, [session, isShiftLoading, currentShift]);

  const [currentRoute, setCurrentRoute] = useState<NavRoute>('pos');
  const [isShortcutsOverlayOpen, setIsShortcutsOverlayOpen] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState<boolean>(checkIsAdminPath);
  const [isAdminLoginRoute, setIsAdminLoginRoute] = useState<boolean>(
    checkIsDedicatedAdminLoginPath,
  );
  const [adminSection, setAdminSection] = useState<AdminConsoleSection>('overview');

  useEffect(() => {
    const syncAdminMode = () => {
      setIsAdminMode(checkIsAdminPath());
      setIsAdminLoginRoute(checkIsDedicatedAdminLoginPath());
    };
    window.addEventListener('popstate', syncAdminMode);
    window.addEventListener('hashchange', syncAdminMode);
    return () => {
      window.removeEventListener('popstate', syncAdminMode);
      window.removeEventListener('hashchange', syncAdminMode);
    };
  }, []);

  // Ensure POS-only cashier users remain on the 'pos' route
  useEffect(() => {
    if (session?.currentUser.role === 'cashier' && currentRoute !== 'pos') {
      setCurrentRoute('pos');
    }
  }, [session, currentRoute]);

  const enterAdminLogin = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/admin/login');
    }
    setIsAdminLoginRoute(true);
    setIsAdminMode(true);
  };

  const exitAdminMode = () => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/');
    }
    setIsAdminLoginRoute(false);
    setIsAdminMode(false);
  };

  // Register operational keyboard shortcuts (F1 = POS, F2 = Dashboard, F9 = Shortcuts Overlay, etc.)
  useEffect(() => {
    if (isAdminMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      // Allow F9 to toggle the shortcuts overlay from anywhere
      if (e.key === 'F9') {
        e.preventDefault();
        setIsShortcutsOverlayOpen((prev) => !prev);
        return;
      }

      const activeEl = document.activeElement;
      const isInputFocused =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable) ||
        (activeEl &&
          (activeEl.tagName === 'INPUT' ||
            activeEl.tagName === 'TEXTAREA' ||
            activeEl.tagName === 'SELECT' ||
            (activeEl instanceof HTMLElement && activeEl.isContentEditable)));

      if (isInputFocused) {
        return;
      }

      if (e.key === 'F1') {
        e.preventDefault();
        setCurrentRoute('pos');
        return;
      }

      // POS-only cashier accounts cannot use F2-F10 to navigate to back-office routes
      if (session?.currentUser.role === 'cashier') {
        return;
      }

      if (e.key === 'F2') {
        e.preventDefault();
        setCurrentRoute('dashboard');
      } else if (e.key === 'F3') {
        e.preventDefault();
        setCurrentRoute('orders');
      } else if (e.key === 'F4') {
        e.preventDefault();
        setCurrentRoute('shift');
      } else if (e.key === 'F5') {
        e.preventDefault();
        setCurrentRoute('inventory');
      } else if (e.key === 'F6') {
        e.preventDefault();
        setCurrentRoute('customers');
      } else if (e.key === 'F7') {
        e.preventDefault();
        setCurrentRoute('audit');
      } else if (e.key === 'F8') {
        e.preventDefault();
        setCurrentRoute('settings');
      } else if (e.key === 'F10') {
        e.preventDefault();
        setCurrentRoute('kds');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAdminMode, session]);

  const enterAdminConsole = (section: AdminConsoleSection = 'overview') => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/admin');
    }
    setAdminSection(section);
    setIsAdminLoginRoute(false);
    setIsAdminMode(true);
  };

  if (isAdminMode || isAdminLoginRoute) {
    // If explicitly on /admin/login and not authenticated as admin yet, show the dedicated AdminLoginScreen
    if (isAdminLoginRoute && (!session || session.currentUser.role !== 'admin')) {
      return (
        <ErrorBoundary moduleName="Administrator Login">
          <React.Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-primary h-8 w-8" /></div>}>
            <AdminLoginScreen
              onBackToPos={exitAdminMode}
              onLoginSuccess={() => {
                setIsAdminLoginRoute(false);
                setIsAdminMode(true);
              }}
            />
          </React.Suspense>
        </ErrorBoundary>
      );
    }

    return (
      <ErrorBoundary moduleName="Administrator Console">
        <React.Suspense fallback={<AdminConsoleSkeleton />}>
          <AdminConsoleLayout
            activeSection={adminSection}
            onSelectSection={setAdminSection}
            onExitAdminMode={exitAdminMode}
          >
            <RbacGuard
              isOrganizationLevel={true}
              allowedRoles={['admin']}
              requiredPermissions={['org:manage', 'settings:manage']}
              hideMode="denied-card"
              onRedirectToPos={exitAdminMode}
            >
              {adminSection === 'rbac' ? (
                <SettingsScreen />
              ) : adminSection === 'audit' ? (
                <AuditScreen />
              ) : adminSection === 'infrastructure' ? (
                <InfrastructureDashboard />
              ) : adminSection === 'bundle_trends' ? (
                <BundleSizeTrendsModule />
              ) : (
                <OrganizationManagementModule
                  initialTab={
                    adminSection === 'branches'
                      ? 'branches'
                      : adminSection === 'terminals'
                      ? 'terminals'
                      : 'organizations'
                  }
                  onNavigateSection={(section) => setAdminSection(section)}
                />
              )}
            </RbacGuard>
          </AdminConsoleLayout>
        </React.Suspense>
      </ErrorBoundary>
    );
  }

  if (!session) {
    return (
      <ErrorBoundary moduleName="Authentication Terminal">
        <LoginScreen onOpenAdminLogin={enterAdminLogin} />
      </ErrorBoundary>
    );
  }

  return (
    <>
      <AppShell
        currentRoute={currentRoute}
        onNavigate={setCurrentRoute}
        onOpenAdminConsole={() => enterAdminConsole('overview')}
      >
        {currentRoute === 'pos' && (
          <ErrorBoundary moduleName="POS Cash Register & Checkout">
            <React.Suspense fallback={<div className="flex-1 flex items-center justify-center bg-slate-950/50"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
              <PosScreen />
            </React.Suspense>
          </ErrorBoundary>
        )}
        {currentRoute === 'dashboard' && (
          <ErrorBoundary moduleName="Sales & Analytics Dashboard">
            <RbacGuard
              module="dashboard"
              allowedRoles={['manager', 'admin']}
              hideMode="denied-card"
              onRedirectToPos={() => setCurrentRoute('pos')}
            >
              <React.Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
                <DashboardScreen onNavigate={setCurrentRoute} />
              </React.Suspense>
            </RbacGuard>
          </ErrorBoundary>
        )}
        {currentRoute === 'kds' && (
          <ErrorBoundary moduleName="Kitchen Display System (KDS)">
            <RbacGuard
              module="kds"
              allowedRoles={['manager', 'admin']}
              hideMode="denied-card"
              onRedirectToPos={() => setCurrentRoute('pos')}
            >
              <React.Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
                <KitchenDisplayScreen />
              </React.Suspense>
            </RbacGuard>
          </ErrorBoundary>
        )}
        {currentRoute === 'orders' && (
          <ErrorBoundary moduleName="Orders & Receipts Management">
            <RbacGuard
              module="orders"
              allowedRoles={['manager', 'admin']}
              hideMode="denied-card"
              onRedirectToPos={() => setCurrentRoute('pos')}
            >
              <React.Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
                <OrdersScreen onNavigate={setCurrentRoute} />
              </React.Suspense>
            </RbacGuard>
          </ErrorBoundary>
        )}
        {currentRoute === 'inventory' && (
          <ErrorBoundary moduleName="Inventory & Stock Tracking">
            <RbacGuard
              module="inventory"
              allowedRoles={['manager', 'admin']}
              hideMode="denied-card"
              onRedirectToPos={() => setCurrentRoute('pos')}
            >
              <React.Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
                <InventoryScreen />
              </React.Suspense>
            </RbacGuard>
          </ErrorBoundary>
        )}
        {currentRoute === 'tasks' && (
          <ErrorBoundary moduleName="Personal Task Management">
            <React.Suspense fallback={<div className="p-8 flex justify-center"><Loader2 className="animate-spin text-primary" /></div>}>
              <TaskManagementScreen />
            </React.Suspense>
          </ErrorBoundary>
        )}
        {currentRoute === 'shift' && (
          <ErrorBoundary moduleName="Cash Drawer & Shift Management">
            <RbacGuard
              module="shift"
              allowedRoles={['manager', 'admin']}
              hideMode="denied-card"
              onRedirectToPos={() => setCurrentRoute('pos')}
            >
              <React.Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
                <ShiftScreen />
              </React.Suspense>
            </RbacGuard>
          </ErrorBoundary>
        )}
        {currentRoute === 'customers' && (
          <ErrorBoundary moduleName="Customer Loyalty & CRM">
            <RbacGuard
              module="customers"
              allowedRoles={['manager', 'admin']}
              hideMode="denied-card"
              onRedirectToPos={() => setCurrentRoute('pos')}
            >
              <React.Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
                <CustomersScreen />
              </React.Suspense>
            </RbacGuard>
          </ErrorBoundary>
        )}
        {currentRoute === 'audit' && (
          <ErrorBoundary moduleName="Security & Audit Trail">
            <RbacGuard
              module="audit"
              allowedRoles={['manager', 'admin']}
              isOrganizationLevel={true}
              hideMode="denied-card"
              onRedirectToPos={() => setCurrentRoute('pos')}
            >
              <React.Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
                <AuditScreen />
              </React.Suspense>
            </RbacGuard>
          </ErrorBoundary>
        )}
        {currentRoute === 'infrastructure' && (
          <ErrorBoundary moduleName="Antigravity AI & Plug & Play Infrastructure">
            <RbacGuard
              module="infrastructure"
              allowedRoles={['admin']}
              isOrganizationLevel={true}
              hideMode="denied-card"
              onRedirectToPos={() => setCurrentRoute('pos')}
            >
              <InfrastructureDashboard />
            </RbacGuard>
          </ErrorBoundary>
        )}
        {currentRoute === 'settings' && (
          <ErrorBoundary moduleName="System & Hardware Settings">
            <RbacGuard
              module="settings"
              allowedRoles={['manager', 'admin']}
              isOrganizationLevel={true}
              hideMode="denied-card"
              onRedirectToPos={() => setCurrentRoute('pos')}
            >
              <React.Suspense fallback={<div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin text-primary h-10 w-10" /></div>}>
                <SettingsScreen />
              </React.Suspense>
            </RbacGuard>
          </ErrorBoundary>
        )}
      </AppShell>

      {/* Global Application Keyboard Shortcuts Modal Overlay (F9) */}
      <ShortcutsOverlay
        isOpen={isShortcutsOverlayOpen}
        onClose={() => setIsShortcutsOverlayOpen(false)}
        onNavigate={(route) => {
          setCurrentRoute(route);
          setIsShortcutsOverlayOpen(false);
        }}
      />

      {/* Auto-Triggered Start Shift Modal on Login */}
      <StartShiftModal
        isOpen={isStartShiftModalOpen}
        onClose={() => setIsStartShiftModalOpen(false)}
      />

      {/* Hidden Developer HUD Overlay for Real-Time FPS, DB Latency & Memory (Ctrl+Shift+D) */}
      <DevPerformanceOverlay />

      {/* Gemini AI Front-End Assistant Widget */}
      <FrontendAssistant />
    </>
  );
};

export default function App() {

  const isCustomerDisplayMode =
    typeof window !== 'undefined' &&
    (window.location.search.includes('mode=customer_display') ||
      window.location.search.includes('display=customer') ||
      window.location.hash.includes('customer-display'));

  const isReceiptValidationMode =
    typeof window !== 'undefined' &&
    (window.location.search.includes('validate_receipt=true') ||
      window.location.search.includes('receipt=') ||
      window.location.hash.includes('validate-receipt'));

  const isKdsMode =
    typeof window !== 'undefined' &&
    (window.location.search.includes('mode=kds') ||
      window.location.search.includes('display=kds') ||
      window.location.hash.includes('kds'));

  if (isKdsMode) {
    return (
      <GlobalErrorRecoveryProvider>
        <ErrorBoundary isGlobal moduleName="PRODX Kitchen Display System (KDS)">
          <AuthProvider>
            <ThemeProvider>
              <LanguageProvider>
                <React.Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-primary h-12 w-12" /></div>}>
                  <KitchenDisplayScreen />
                </React.Suspense>
              </LanguageProvider>
            </ThemeProvider>
          </AuthProvider>
        </ErrorBoundary>
      </GlobalErrorRecoveryProvider>
    );
  }

  if (isReceiptValidationMode) {
    return (
      <GlobalErrorRecoveryProvider>
        <ErrorBoundary isGlobal moduleName="PRODX Receipt Validation Portal">
          <ThemeProvider>
            <LanguageProvider>
              <ReceiptValidationPortal />
            </LanguageProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </GlobalErrorRecoveryProvider>
    );
  }

  if (isCustomerDisplayMode) {
    return (
      <GlobalErrorRecoveryProvider>
        <ErrorBoundary isGlobal moduleName="PRODX Customer-Facing Display">
          <ThemeProvider>
            <LanguageProvider>
              <CustomerDisplayView />
            </LanguageProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </GlobalErrorRecoveryProvider>
    );
  }

  return (
    <GlobalErrorRecoveryProvider>
      <ErrorBoundary isGlobal moduleName="PRODX POS Core Engine">
        <SettingsProvider>
          <ThemeProvider>
            <LanguageProvider>
              <SoundProvider>
                <HapticProvider>
                  <ToastProvider>
                    <AuthProvider>
                      <OfflineProvider>
                        <ShiftProvider>
                          <CartProvider>
                            <ReceiptPrinterProvider>
                              <VisualInspectorProvider>
                                <BreadcrumbProvider>
                                  <ConfirmationDialogProvider>
                                    <MainApplication />
                                  </ConfirmationDialogProvider>
                                </BreadcrumbProvider>
                              </VisualInspectorProvider>
                            </ReceiptPrinterProvider>
                          </CartProvider>
                        </ShiftProvider>
                      </OfflineProvider>
                    </AuthProvider>
                  </ToastProvider>
                </HapticProvider>
              </SoundProvider>
            </LanguageProvider>
          </ThemeProvider>
        </SettingsProvider>
      </ErrorBoundary>
    </GlobalErrorRecoveryProvider>
  );
}

