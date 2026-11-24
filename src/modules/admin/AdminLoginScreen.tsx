import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Delete,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  Monitor,
  Moon,
  ShieldAlert,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { getSystemConfigCatalog } from '../../services/systemConfigService';
import { auditService } from '../../services/auditService';
import { Organization } from '../settings/types';
import { ProdxVectorMark } from '../../components/common/ProdxLogo';

export interface AdminLoginScreenProps {
  onBackToPos?: () => void;
  onLoginSuccess?: () => void;
}

export const AdminLoginScreen: React.FC<AdminLoginScreenProps> = ({
  onBackToPos,
  onLoginSuccess,
}) => {
  const { login, isLoading } = useAuth();
  const { language, setLanguage } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { addToast } = useToast();
  const isThai = language === 'th';
  const isDark = theme === 'dark';

  const [authMode, setAuthMode] = useState<'credentials' | 'pin'>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrgSlug, setSelectedOrgSlug] = useState('prodx');
  const [rbacError, setRbacError] = useState<string | null>(null);

  /**
   * Diagnostic log script to trace the exact lifecycle of the authentication request.
   */
  const traceAdminLoginLifecycle = (stage: 'SUBMIT' | 'SUCCESS' | 'ERROR', data: Record<string, unknown> = {}) => {
    const timestamp = Date.now();
    const traceId = `admin-trace-${timestamp}-${Math.random().toString(36).substring(2, 9)}`;
    // Only allow non-sensitive diagnostic fields. Never log credentials, identity, or raw errors.
    const logPayload = {
      traceId,
      stage,
      timestamp: new Date(timestamp).toISOString(),
      selectedOrgSlug,
      authMode,
      ...(typeof data.reason === 'string' ? { reason: data.reason } : {}),
      ...(typeof data.method === 'string' ? { method: data.method } : {}),
    };

    console.log(`%c[ADMIN_AUTH_TRACE][${stage}]`, 'color: #ff6b1a; font-weight: bold;', logPayload);

    auditService.logDiagnosticEvent({
      category: 'system',
      level: stage === 'ERROR' ? 'ERROR' : 'DEBUG',
      event: `ADMIN_AUTH_LIFECYCLE_${stage}`,
      message: `Tracing admin login stage: ${stage}`,
      metadata: logPayload,
    });

    return traceId;
  };

  useEffect(() => {
    let active = true;
    const fetchOrgs = async () => {
      try {
        const catalog = await getSystemConfigCatalog();
        if (!active) return;
        setOrgs(catalog.organizations);
        if (catalog.organizations.length > 0) {
          const matched =
            catalog.organizations.find((o) => o.slug === selectedOrgSlug) ||
            catalog.organizations[0];
          setSelectedOrgSlug(matched.slug);
        }
      } catch {
        // Keep default fallback slug
      }
    };
    void fetchOrgs();
    return () => {
      active = false;
    };
  }, []);

  const handleAdminLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setRbacError(null);

    const identity = authMode === 'pin' ? adminPin.trim() : email.trim();
    const secret = authMode === 'pin' ? adminPin.trim() : password;

    traceAdminLoginLifecycle('SUBMIT', { method: authMode });

    if (!identity || !secret) {
      traceAdminLoginLifecycle('ERROR', { reason: 'MISSING_CREDENTIALS' });
      const msg = isThai
        ? 'กรุณาระบุข้อมูลยืนยันตัวตนของผู้ดูแลระบบให้ครบถ้วน'
        : 'Please provide valid administrator credentials.';
      setRbacError(msg);
      addToast({
        title: isThai ? 'เข้าสู่ระบบผู้ดูแลระบบ' : 'Admin Login',
        message: msg,
        type: 'error',
      });
      return;
    }

    const activeOrg = orgs.find((o) => o.slug === selectedOrgSlug) || orgs[0];

    try {
      await login({
        organizationSlug: activeOrg?.slug || selectedOrgSlug || 'prodx',
        storeCode: 'STR-01',
        registerId: 'ADMIN-CONSOLE',
        emailOrPin: identity,
        passwordOrPin: secret,
        requireAdminRole: true,
        organizationContext: activeOrg
          ? {
              organizationId: activeOrg.id,
              organizationName: activeOrg.name,
              organizationSlug: activeOrg.slug,
              branchId: 'br-str-01',
              branchName: 'STR-01 Central World',
              branchCode: 'STR-01',
              branchAddress: 'Enterprise HQ Console',
              terminalId: 'term-admin',
              terminalName: 'Administrator Console',
              terminalCode: 'ADMIN-CONSOLE',
            }
          : undefined,
      });

      traceAdminLoginLifecycle('SUCCESS', { method: authMode });

      if (typeof window !== 'undefined') {
        window.history.pushState({}, '', '/admin');
      }
      onLoginSuccess?.();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : isThai
          ? 'ปฏิเสธการเข้าถึง: เฉพาะบัญชีที่มีบทบาทผู้ดูแลระบบ (admin) เท่านั้น'
          : 'Access Denied: Only accounts with the "admin" role can access the Administrator Console.';

      traceAdminLoginLifecycle('ERROR', {
        reason: 'AUTH_SERVICE_REJECTED',
        error: message,
      });

      setRbacError(message);
      addToast({
        title: isThai ? 'การยืนยันสิทธิ์ล้มเหลว' : 'Admin RBAC Verification Failed',
        message,
        type: 'error',
      });
    }
  };

  const handlePinDigit = (digit: string) => {
    if (adminPin.length < 8) {
      setAdminPin((prev) => prev + digit);
    }
  };

  return (
    <div className="min-h-[100svh] bg-[#FFF7ED] dark:bg-[#0F172A] text-[#183D32] dark:text-[#F8FAFC] font-sans flex flex-col lg:grid lg:grid-cols-[44%_56%] transition-colors duration-200">
      {/* Left Executive Branding Column (Visible on Desktop / Large Landscape POS) */}
      <section className="relative hidden lg:flex flex-col justify-between overflow-hidden border-r border-[#183D32]/20 dark:border-slate-800 bg-[#183D32] dark:bg-[#0B201A] text-[#FFFFFF] p-10 xl:p-14">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(249,115,22,0.22),transparent_48%),radial-gradient(circle_at_85%_80%,rgba(11,32,26,0.65),transparent_50%)]"
        />
        <div className="relative z-10 flex items-center gap-3.5">
          <ProdxVectorMark size={48} className="rounded-2xl shadow-xl" />
          <div>
            <div className="text-2xl font-black tracking-tight text-[#FFFFFF]">
              PRODX<span className="font-light text-[#F97316]">ADMIN</span>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.35em] text-[#FDBA74]">
              Enterprise Control Plane
            </div>
          </div>
        </div>

        <div className="relative z-10 my-auto max-w-md space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#FFFFFF]/20 bg-[#FFFFFF]/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-wider text-[#FFFFFF]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#FDBA74]" />
            <span>{isThai ? 'บังคับใช้สิทธิ์ RBAC ระดับสูงสุด' : 'Strict RBAC Role Gate Active'}</span>
          </div>

          <h2 className="text-4xl xl:text-5xl font-black tracking-tight leading-[1.08] text-[#FFFFFF]">
            {isThai ? (
              <>
                ศูนย์ควบคุมระบบ
                <br />
                <span className="text-[#F97316]">ระดับองค์กร.</span>
              </>
            ) : (
              <>
                Enterprise
                <br />
                <span className="text-[#F97316]">Admin Console.</span>
              </>
            )}
          </h2>

          <p className="text-sm text-[#E2E8F0] leading-relaxed">
            {isThai
              ? 'จัดการโครงสร้างองค์กร สาขา เครื่องขาย POS สิทธิ์การเข้าถึงของพนักงาน (RBAC) และตรวจสอบบันทึกความปลอดภัยแบบเรียลไทม์'
              : 'Configure multi-branch organizations, POS terminal stations, staff RBAC permissions, and immutable security audit trails.'}
          </p>

          <div className="rounded-2xl border border-[#FFFFFF]/15 bg-[#FFFFFF]/10 p-4 space-y-2.5 text-xs backdrop-blur-xs">
            <div className="flex items-center justify-between text-[#E2E8F0]">
              <span className="text-[#CBD5E1] font-bold">
                {isThai ? 'เส้นทางความปลอดภัย:' : 'Security Route:'}
              </span>
              <span className="font-mono font-bold text-[#FDBA74]">/admin/login</span>
            </div>
            <div className="flex items-center justify-between text-[#E2E8F0]">
              <span className="text-[#CBD5E1] font-bold">
                {isThai ? 'เงื่อนไขสิทธิ์ (RBAC):' : 'Required Role:'}
              </span>
              <span className="rounded bg-emerald-500/20 border border-emerald-400/40 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-200">
                role === &apos;admin&apos;
              </span>
            </div>
            <div className="flex items-center justify-between text-[#E2E8F0]">
              <span className="text-[#CBD5E1] font-bold">
                {isThai ? 'รองรับอุปกรณ์:' : 'Device Ergonomics:'}
              </span>
              <span className="font-semibold text-[#FFFFFF]">Mobile · Tablet · POS · Desktop</span>
            </div>
          </div>
        </div>

        <div className="relative z-10 pt-6 border-t border-[#FFFFFF]/15 flex items-center justify-between text-[11px] text-[#CBD5E1] font-bold">
          <span className="text-[#E2E8F0]">PostgreSQL &amp; RBAC Security Gate</span>
          <span>PRODX Enterprise v2.0</span>
        </div>
      </section>

      {/* Right Authentication Workspace (Responsive across Mobile, Tablet, POS & Desktop) */}
      <section className="flex-1 flex flex-col justify-between overflow-y-auto p-3.5 sm:p-6 md:p-8 lg:p-10">
        {/* Top Utility Bar */}
        <header className="w-full max-w-xl mx-auto flex items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2.5 lg:hidden">
            <ProdxVectorMark size={36} className="rounded-xl shadow-xs" />
            <div>
              <div className="text-sm font-black tracking-tight text-[#183D32] dark:text-[#F8FAFC]">
                PRODX <span className="text-[#F97316]">ADMIN</span>
              </div>
              <div className="text-[10px] text-[#5F6C65] dark:text-[#94A3B8] font-mono">/admin/login</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {onBackToPos && (
              <button
                type="button"
                onClick={onBackToPos}
                className="min-h-[40px] px-3 py-1.5 rounded-xl border border-[#F0E1D3] dark:border-slate-700 bg-[#FFFFFF] dark:bg-[#1E293B] hover:bg-[#FFF7ED] dark:hover:bg-background text-xs font-bold text-[#183D32] dark:text-[#F8FAFC] flex items-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316]"
              >
                <ArrowLeft className="h-3.5 w-3.5 text-[#F97316]" />
                <span>{isThai ? 'หน้า POS' : 'POS Login'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? (isThai ? 'สลับเป็นโหมดสว่าง' : 'Switch to light mode') : (isThai ? 'สลับเป็นโหมดมืด' : 'Switch to dark mode')}
              className="min-h-[40px] min-w-[40px] px-2.5 py-1.5 rounded-xl border border-[#F0E1D3] dark:border-slate-700 bg-[#FFFFFF] dark:bg-[#1E293B] hover:bg-[#FFF7ED] dark:hover:bg-background text-[#183D32] dark:text-[#F8FAFC] flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316]"
            >
              {isDark ? <Sun className="h-4 w-4 text-[#F97316]" /> : <Moon className="h-4 w-4 text-[#183D32]" />}
            </button>
            <button
              type="button"
              onClick={() => setLanguage(isThai ? 'en' : 'th')}
              className="min-h-[40px] px-3 py-1.5 rounded-xl border border-[#F0E1D3] dark:border-slate-700 bg-[#FFFFFF] dark:bg-[#1E293B] hover:bg-[#FFF7ED] dark:hover:bg-background text-xs font-bold text-[#183D32] dark:text-[#F8FAFC] flex items-center gap-1.5 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316]"
            >
              <Globe2 className="h-3.5 w-3.5 text-[#5F6C65] dark:text-[#94A3B8]" />
              <span>{isThai ? 'English' : 'ไทย'}</span>
            </button>
          </div>
        </header>

        {/* Main Card Container */}
        <div className="w-full max-w-xl mx-auto my-auto rounded-2xl sm:rounded-3xl border border-[#F0E1D3] dark:border-slate-700 bg-[#FFFFFF] dark:bg-[#1E293B] p-4 sm:p-7 md:p-8 shadow-xl shadow-[#183D32]/5 dark:shadow-black/30 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-2xl bg-[#FFF7ED] dark:bg-[#F97316]/15 border border-[#F97316]/30 flex items-center justify-center shrink-0">
                <ShieldCheck className="h-5 w-5 sm:h-6 sm:w-6 text-[#F97316]" />
              </div>
              <div>
                <div className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-[#EA580C] dark:text-[#FB923C]">
                  <span>PRODX ENTERPRISE · /ADMIN/LOGIN</span>
                </div>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-[#183D32] dark:text-[#F8FAFC]">
                  {isThai ? 'เข้าสู่ระบบผู้ดูแลระบบ' : 'Administrator Console Login'}
                </h1>
                <p className="text-xs text-[#5F6C65] dark:text-[#94A3B8] mt-0.5">
                  {isThai
                    ? 'เส้นทางเข้าสู่ระบบแยกเฉพาะสำหรับผู้ดูแลระบบ (RBAC Enforced)'
                    : 'Dedicated RBAC-enforced authentication path for enterprise administrators'}
                </p>
              </div>
            </div>
          </div>

          {/* Compact RBAC Enforcement Notice (WCAG AA High-Contrast Light & Dark) */}
          <div className="rounded-xl border border-[#C6E5CC] dark:border-emerald-700/60 bg-[#E8F3EA] dark:bg-emerald-950/60 p-3 sm:p-3.5 flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2 font-bold text-[#183D32] dark:text-emerald-200">
              <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span>
                {isThai
                  ? 'ตรวจสอบสิทธิ์ผู้ดูแลระบบ (Admin Role Gate)'
                  : 'Strict Administrator Role Gate Active'}
              </span>
            </span>
            <span className="rounded-md bg-[#FFFFFF]/80 dark:bg-emerald-900/60 border border-emerald-700/20 dark:border-emerald-500/40 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-[#183D32] dark:text-emerald-200 shrink-0">
              role === &apos;admin&apos;
            </span>
          </div>

          {/* RBAC Error Banner (WCAG AA High-Contrast Light & Dark) */}
          {rbacError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-300 dark:border-rose-700/70 bg-rose-50 dark:bg-rose-950/80 p-3.5 flex items-start gap-3 text-rose-900 dark:text-rose-100"
            >
              <ShieldAlert className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <div className="font-black uppercase tracking-wider text-rose-800 dark:text-rose-200">
                  {isThai ? 'ปฏิเสธการเข้าถึงตามนโยบาย RBAC' : 'RBAC Authorization Denied'}
                </div>
                <p className="font-medium text-rose-900 dark:text-rose-200/90 leading-relaxed">{rbacError}</p>
              </div>
            </div>
          )}

          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#F5E1D0]/60 dark:bg-[#0F172A] rounded-xl border border-[#F0E1D3] dark:border-slate-700">
            <button
              type="button"
              onClick={() => {
                setAuthMode('credentials');
                setRbacError(null);
              }}
              className={`min-h-[44px] py-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] ${
                authMode === 'credentials'
                  ? 'bg-[#183D32] dark:bg-[#F97316] text-[#FFFFFF] shadow-sm'
                  : 'text-[#5F6C65] dark:text-[#94A3B8] hover:text-[#183D32] dark:hover:text-[#F8FAFC]'
              }`}
            >
              <Mail className="h-3.5 w-3.5" />
              <span>{isThai ? 'อีเมลผู้ดูแลระบบ' : 'Admin Email & Key'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode('pin');
                setRbacError(null);
              }}
              className={`min-h-[44px] py-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] ${
                authMode === 'pin'
                  ? 'bg-[#183D32] dark:bg-[#F97316] text-[#FFFFFF] shadow-sm'
                  : 'text-[#5F6C65] dark:text-[#94A3B8] hover:text-[#183D32] dark:hover:text-[#F8FAFC]'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>{isThai ? 'รหัส PIN ผู้ดูแลระบบ' : 'Admin Master PIN'}</span>
            </button>
          </div>

          <form onSubmit={handleAdminLogin} className="space-y-4">
            {/* Organization Scope Selector */}
            <div>
              <label htmlFor="admin-org-scope" className="block text-xs font-bold text-[#183D32] dark:text-[#F8FAFC] cursor-pointer">
                <span className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-[#F97316]" />
                  {isThai ? 'องค์กรหลักที่ต้องการจัดการ' : 'Primary Organization Scope'}
                </span>
              </label>
              <select
                id="admin-org-scope"
                name="organizationScope"
                value={selectedOrgSlug}
                onChange={(e) => setSelectedOrgSlug(e.target.value)}
                className="w-full h-12 mt-1.5 rounded-xl bg-[#FFF7ED]/50 dark:bg-[#0F172A] border border-[#E6D3C1] dark:border-slate-700 px-3.5 text-xs sm:text-sm font-bold text-[#183D32] dark:text-[#F8FAFC] focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/30 outline-none transition-colors"
              >
                {orgs.length === 0 ? (
                  <option value="prodx">PRODX Retail Group (prodx)</option>
                ) : (
                  orgs.map((o) => (
                    <option key={o.id} value={o.slug}>
                      {o.name} ({o.slug})
                    </option>
                  ))
                )}
              </select>
            </div>

            {authMode === 'credentials' ? (
              <div className="space-y-3.5">
                <div>
                  <label htmlFor="admin-email" className="block text-xs font-bold text-[#183D32] dark:text-[#F8FAFC] cursor-pointer">
                    <span className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-[#5F6C65] dark:text-[#94A3B8]" />
                      {isThai ? 'อีเมลผู้ดูแลระบบ (Admin Email)' : 'Administrator Email'}
                    </span>
                  </label>
                  <input
                    id="admin-email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="kamkokaewthodsawat@gmail.com"
                    required
                    autoComplete="username"
                    spellCheck={false}
                    enterKeyHint="next"
                    className="w-full h-12 mt-1.5 rounded-xl bg-[#FFF7ED]/50 dark:bg-[#0F172A] border border-[#E6D3C1] dark:border-slate-700 px-4 text-sm font-bold text-[#183D32] dark:text-[#F8FAFC] placeholder:text-[#8E9B94] dark:placeholder:text-slate-500 focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/30 outline-none transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="admin-password" className="block text-xs font-bold text-[#183D32] dark:text-[#F8FAFC] cursor-pointer">
                    <span className="flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5 text-[#5F6C65] dark:text-[#94A3B8]" />
                      {isThai ? 'รหัสผ่าน / รหัส PIN ผู้ดูแลระบบ' : 'Admin Password / Security PIN'}
                    </span>
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      id="admin-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={isThai ? 'กรอกรหัสผ่านหรือ PIN ผู้ดูแลระบบ' : 'Enter admin password or PIN'}
                      required
                      autoComplete="current-password"
                      enterKeyHint="done"
                      className="w-full h-12 rounded-xl bg-[#FFF7ED]/50 dark:bg-[#0F172A] border border-[#E6D3C1] dark:border-slate-700 pl-4 pr-12 text-sm font-bold text-[#183D32] dark:text-[#F8FAFC] placeholder:text-[#8E9B94] dark:placeholder:text-slate-500 focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/30 outline-none transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-[#5F6C65] dark:text-[#94A3B8] hover:text-[#183D32] dark:hover:text-[#F8FAFC] rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] cursor-pointer"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3.5">
                <div>
                  <label htmlFor="admin-pin" className="block text-xs font-bold text-[#183D32] dark:text-[#F8FAFC] cursor-pointer">
                    <span className="flex items-center gap-1.5">
                      <KeyRound className="h-3.5 w-3.5 text-[#F97316]" />
                      {isThai
                        ? 'รหัส PIN สำหรับผู้ดูแลระบบ (รองรับหน้าจอสัมผัส POS)'
                        : 'Administrator Security PIN (Touch POS Ready)'}
                    </span>
                  </label>
                  <input
                    id="admin-pin"
                    name="pin"
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="current-password"
                    value={adminPin}
                    onChange={(e) => setAdminPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                    placeholder="••••••"
                    maxLength={8}
                    required
                    enterKeyHint="done"
                    className="w-full h-12 mt-1.5 rounded-xl bg-[#FFF7ED]/50 dark:bg-[#0F172A] border border-[#E6D3C1] dark:border-slate-700 px-4 text-center tracking-[0.4em] text-lg font-black text-[#183D32] dark:text-[#F8FAFC] placeholder:text-[#8E9B94] dark:placeholder:text-slate-500 focus:border-[#F97316] focus:ring-2 focus:ring-[#F97316]/30 outline-none transition-colors"
                  />
                  {/* Tactile PIN Progress Dots */}
                  <div className="flex items-center justify-center gap-2 pt-2.5" aria-hidden="true">
                    {Array.from({ length: Math.max(6, adminPin.length) }).map((_, idx) => {
                      const filled = idx < adminPin.length;
                      return (
                        <span
                          key={idx}
                          className={`h-2.5 w-2.5 rounded-full transition-all duration-150 ${
                            filled
                              ? 'bg-[#F97316] scale-110 shadow-xs shadow-[#F97316]/40'
                              : 'bg-[#E6D3C1] dark:bg-slate-700'
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Touch-friendly 48px Numpad for POS Screens & Tablets */}
                <div className="grid grid-cols-3 gap-2.5">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => handlePinDigit(digit)}
                      className="min-h-[48px] rounded-xl border border-[#F0E1D3] dark:border-slate-700 bg-[#FFF7ED]/70 dark:bg-[#0F172A] hover:border-[#F97316] hover:bg-[#FFF7ED] dark:hover:bg-background text-base font-black text-[#183D32] dark:text-[#F8FAFC] transition-all active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316]"
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAdminPin('')}
                    className="min-h-[48px] rounded-xl border border-[#F0E1D3] dark:border-slate-700 bg-[#F5E1D0]/60 dark:bg-[#0F172A] hover:bg-rose-50 dark:hover:bg-rose-950/60 hover:text-rose-700 dark:hover:text-rose-300 text-xs font-black uppercase text-[#5F6C65] dark:text-[#94A3B8] transition-all active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                  >
                    {isThai ? 'ล้าง' : 'Clear'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePinDigit('0')}
                    className="min-h-[48px] rounded-xl border border-[#F0E1D3] dark:border-slate-700 bg-[#FFF7ED]/70 dark:bg-[#0F172A] hover:border-[#F97316] hover:bg-[#FFF7ED] dark:hover:bg-background text-base font-black text-[#183D32] dark:text-[#F8FAFC] transition-all active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316]"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    aria-label={isThai ? 'ลบตัวเลขล่าสุด' : 'Backspace'}
                    onClick={() => setAdminPin((prev) => prev.slice(0, -1))}
                    className="min-h-[48px] rounded-xl bg-gradient-to-b from-[#FA812F] to-[#F97316] hover:brightness-105 text-[#FFFFFF] flex items-center justify-center shadow-sm shadow-[#F97316]/30 transition-all active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2"
                  >
                    <Delete className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            <button
              disabled={isLoading}
              type="submit"
              className="w-full min-h-[48px] mt-2 bg-gradient-to-b from-[#FA812F] to-[#EA580C] hover:brightness-105 text-[#FFFFFF] rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 shadow-lg shadow-[#F97316]/30 cursor-pointer active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316] focus-visible:ring-offset-2"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isThai ? (
                'ยืนยันสิทธิ์และเข้าสู่ Admin Console'
              ) : (
                'Authenticate & Open Admin Console'
              )}
              {!isLoading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>

          {onBackToPos && (
            <button
              type="button"
              onClick={onBackToPos}
              className="w-full min-h-[44px] rounded-xl border border-[#F0E1D3] dark:border-slate-700 bg-[#FFF7ED]/50 dark:bg-[#0F172A] hover:bg-[#FFF7ED] dark:hover:bg-background text-xs font-bold text-[#183D32] dark:text-[#F8FAFC] flex items-center justify-center gap-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F97316]"
            >
              <Monitor className="h-3.5 w-3.5 text-[#5F6C65] dark:text-[#94A3B8]" />
              <span>
                {isThai
                  ? 'กลับสู่หน้าเข้าสู่ระบบพนักงานขาย POS'
                  : 'Return to Standard POS Operator Login'}
              </span>
            </button>
          )}
        </div>

        <footer className="w-full max-w-xl mx-auto pt-4 text-center text-[11px] text-[#5F6C65] dark:text-[#94A3B8] font-semibold">
          {isThai
            ? 'ป้องกันด้วยระบบตรวจสอบสิทธิ์ RBAC และบันทึก Audit Trail อัตโนมัติ'
            : 'Protected by Enterprise RBAC Verification & Immutable Audit Logging'}
        </footer>
      </section>
    </div>
  );
};
