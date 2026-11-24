import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
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
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
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
  const { addToast } = useToast();
  const isThai = language === 'th';

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

    if (import.meta.env.DEV) {
      console.log(`%c[ADMIN_AUTH_TRACE][${stage}]`, 'color: #ff6b1a; font-weight: bold;', logPayload);
    }

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
    <div className="min-h-[100svh] bg-brand-bg text-brand-text font-sans flex flex-col lg:grid lg:grid-cols-[44%_56%]">
      {/* Left Executive Branding Column (Visible on Desktop / Large Landscape POS) */}
      <section className="relative hidden lg:flex flex-col justify-between overflow-hidden border-r border-brand-border/60 bg-brand-primary text-brand-primary-text p-10 xl:p-14">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(232,137,74,0.18),transparent_45%),radial-gradient(circle_at_85%_80%,rgba(15,42,34,0.38),transparent_45%)]" />
        <div className="relative z-10 flex items-center gap-3.5">
          <ProdxVectorMark size={48} className="rounded-2xl shadow-xl" />
          <div>
            <div className="text-2xl font-black tracking-tight">
              PRODX<span className="font-light text-cta">ADMIN</span>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-[0.35em] text-brand-gold-500">
              Enterprise Control Plane
            </div>
          </div>
        </div>

        <div className="relative z-10 my-auto max-w-md space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-brand-primary-text">
            <ShieldCheck className="h-3.5 w-3.5 text-brand-gold-500" />
            <span>{isThai ? 'บังคับใช้สิทธิ์ RBAC ระดับสูงสุด' : 'Strict RBAC Role Gate Active'}</span>
          </div>

          <h2 className="text-4xl xl:text-5xl font-black tracking-tight leading-[1.05] text-brand-primary-text">
            {isThai ? (
              <>
                ศูนย์ควบคุมระบบ
                <br />
                <span className="text-cta">ระดับองค์กร.</span>
              </>
            ) : (
              <>
                Enterprise
                <br />
                <span className="text-cta">Admin Console.</span>
              </>
            )}
          </h2>

          <p className="text-sm text-brand-primary-text/80 leading-relaxed">
            {isThai
              ? 'จัดการโครงสร้างองค์กร สาขา เครื่องขาย POS สิทธิ์การเข้าถึงของพนักงาน (RBAC) และตรวจสอบบันทึกความปลอดภัยแบบเรียลไทม์'
              : 'Configure multi-branch organizations, POS terminal stations, staff RBAC permissions, and immutable security audit trails.'}
          </p>

          <div className="rounded-2xl border border-white/15 bg-white/10 p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between text-brand-primary-text/80">
              <span className="text-brand-primary-text/80 font-bold">
                {isThai ? 'เส้นทางความปลอดภัย:' : 'Security Route:'}
              </span>
              <span className="font-mono font-bold text-cta">/admin/login</span>
            </div>
            <div className="flex items-center justify-between text-brand-primary-text/80">
              <span className="text-brand-primary-text/80 font-bold">
                {isThai ? 'เงื่อนไขสิทธิ์ (RBAC):' : 'Required Role:'}
              </span>
              <span className="rounded bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 font-mono [font-variant-ligatures:none] text-[10px] font-bold text-emerald-300">
                role === &apos;admin&apos;
              </span>
            </div>
            <div className="flex items-center justify-between text-brand-primary-text/80">
              <span className="text-brand-primary-text/80 font-bold">
                {isThai ? 'รองรับอุปกรณ์:' : 'Device Ergonomics:'}
              </span>
              <span className="font-semibold text-brand-primary-text">Mobile · Tablet · POS · Desktop</span>
            </div>
          </div>
        </div>

        <div className="relative z-10 pt-6 border-t border-white/15 flex items-center justify-between text-[11px] text-brand-primary-text/80 font-bold">
          <span>PostgreSQL &amp; RBAC Security Gate</span>
          <span>PRODX Enterprise v2.0</span>
        </div>
      </section>

      {/* Right Authentication Workspace (Responsive across Mobile, Tablet, POS & Desktop) */}
      <section className="flex-1 flex flex-col justify-between overflow-y-auto p-3.5 sm:p-6 md:p-8 lg:p-10">
        {/* Top Utility Bar */}
        <header className="w-full max-w-xl mx-auto flex items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2.5 lg:hidden">
            <ProdxVectorMark size={36} className="rounded-xl" />
            <div>
              <div className="text-sm font-black tracking-tight text-brand-text">
                PRODX <span className="text-cta">ADMIN</span>
              </div>
              <div className="text-[10px] text-brand-text-secondary font-mono">/admin/login</div>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {onBackToPos && (
              <button
                type="button"
                onClick={onBackToPos}
                className="min-h-[44px] px-3 py-1.5 rounded-xl border border-brand-border bg-brand-surface hover:bg-brand-surface-hover text-xs font-bold text-brand-text flex items-center gap-1.5 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2"
              >
                <ArrowLeft className="h-3.5 w-3.5 text-cta" />
                <span>{isThai ? 'หน้า POS' : 'POS Login'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setLanguage(isThai ? 'en' : 'th')}
              className="min-h-[44px] px-3 py-1.5 rounded-xl border border-brand-border bg-brand-surface hover:bg-brand-surface-hover text-xs font-bold text-brand-text flex items-center gap-1.5 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2"
            >
              <Globe2 className="h-3.5 w-3.5 text-brand-text-secondary" />
              <span>{isThai ? 'English' : 'ไทย'}</span>
            </button>
          </div>
        </header>

        {/* Main Card Container */}
        <div className="w-full max-w-xl mx-auto my-auto rounded-2xl sm:rounded-3xl border border-brand-border bg-brand-surface p-4 sm:p-7 md:p-8 shadow-2xl space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 sm:h-12 sm:w-12 rounded-2xl bg-cta-subtle border border-cta/30 flex items-center justify-center shrink-0">
                <ShieldCheck className="h-5 w-5 sm:h-6 sm:w-6 text-cta" />
              </div>
              <div>
                <div className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-cta">
                  <span>PRODX ENTERPRISE · /ADMIN/LOGIN</span>
                </div>
                <h1 className="text-xl sm:text-2xl font-black tracking-tight text-brand-text">
                  {isThai ? 'เข้าสู่ระบบผู้ดูแลระบบ' : 'Administrator Console Login'}
                </h1>
                <p className="text-xs text-brand-text-secondary mt-0.5">
                  {isThai
                    ? 'เส้นทางเข้าสู่ระบบแยกเฉพาะสำหรับผู้ดูแลระบบ (RBAC Enforced)'
                    : 'Dedicated RBAC-enforced authentication path for enterprise administrators'}
                </p>
              </div>
            </div>
          </div>

          {/* Compact RBAC Enforcement Notice */}
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 sm:p-3.5 flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
              <span>
                {isThai
                  ? 'ตรวจสอบสิทธิ์ผู้ดูแลระบบ (Admin Role Gate)'
                  : 'Strict Administrator Role Gate Active'}
              </span>
            </span>
            <span className="rounded-md bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 font-mono [font-variant-ligatures:none] text-[10px] font-bold uppercase text-emerald-800 dark:text-emerald-300 shrink-0">
              role === &apos;admin&apos;
            </span>
          </div>

          {/* RBAC Error Banner */}
          {rbacError && (
            <div
              role="alert"
              className="rounded-xl border border-danger/40 bg-danger-subtle p-3.5 flex items-start gap-3 text-danger"
            >
              <ShieldAlert className="h-5 w-5 text-danger shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <div className="font-black uppercase tracking-wider text-danger">
                  {isThai ? 'ปฏิเสธการเข้าถึงตามนโยบาย RBAC' : 'RBAC Authorization Denied'}
                </div>
                <p className="font-medium text-danger leading-relaxed">{rbacError}</p>
              </div>
            </div>
          )}

          {/* Mode Switcher */}
          <div
            role="tablist"
            aria-label={isThai ? 'วิธีเข้าสู่ระบบผู้ดูแลระบบ' : 'Administrator authentication method'}
            className="grid grid-cols-2 gap-1.5 p-1 bg-brand-surface-muted rounded-xl border border-brand-border"
          >
            <button
              type="button"
              role="tab"
              aria-selected={authMode === 'credentials'}
              onClick={() => {
                setAuthMode('credentials');
                setRbacError(null);
              }}
              className={`min-h-[44px] py-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer focus-visible:ring-2 focus-visible:ring-cta ${
                authMode === 'credentials'
                  ? 'bg-brand-primary text-brand-primary-text shadow'
                  : 'text-brand-text-secondary hover:text-brand-text'
              }`}
            >
              <Mail className="h-3.5 w-3.5" />
              <span>{isThai ? 'อีเมลผู้ดูแลระบบ' : 'Admin Email & Key'}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMode === 'pin'}
              onClick={() => {
                setAuthMode('pin');
                setRbacError(null);
              }}
              className={`min-h-[44px] py-2 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer focus-visible:ring-2 focus-visible:ring-cta ${
                authMode === 'pin'
                  ? 'bg-brand-primary text-brand-primary-text shadow'
                  : 'text-brand-text-secondary hover:text-brand-text'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>{isThai ? 'รหัส PIN ผู้ดูแลระบบ' : 'Admin Master PIN'}</span>
            </button>
          </div>

          <form onSubmit={handleAdminLogin} className="space-y-4">
            {/* Organization Scope Selector */}
            <label className="block">
              <span className="text-xs font-bold text-brand-text flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-cta" />
                {isThai ? 'องค์กรหลักที่ต้องการจัดการ' : 'Primary Organization Scope'}
              </span>
              <select
                value={selectedOrgSlug}
                onChange={(e) => setSelectedOrgSlug(e.target.value)}
                className="w-full h-11 sm:h-12 mt-1.5 rounded-xl bg-brand-surface border border-brand-border px-3.5 text-base sm:text-sm font-bold text-brand-text focus:border-cta focus:ring-2 focus:ring-cta/40 outline-none"
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
            </label>

            {authMode === 'credentials' ? (
              <div className="space-y-3.5">
                <label className="block">
                  <span className="text-xs font-bold text-brand-text flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" />
                    {isThai ? 'อีเมลผู้ดูแลระบบ (Admin Email)' : 'Administrator Email'}
                  </span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@company.com"
                    autoComplete="username"
                    spellCheck={false}
                    className="w-full h-11 sm:h-12 mt-1.5 rounded-xl bg-brand-surface border border-brand-border px-4 text-base sm:text-sm font-bold text-brand-text placeholder:text-brand-text-muted focus:border-cta focus:ring-2 focus:ring-cta/40 outline-none"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-bold text-brand-text flex items-center gap-1.5">
                    <Lock className="h-3.5 w-3.5" />
                    {isThai ? 'รหัสผ่าน / รหัส PIN ผู้ดูแลระบบ' : 'Admin Password / Security PIN'}
                  </span>
                  <div className="relative mt-1.5">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter admin password or PIN"
                      autoComplete="current-password"
                      className="w-full h-11 sm:h-12 rounded-xl bg-brand-surface border border-brand-border pl-4 pr-12 text-base sm:text-sm font-bold text-brand-text placeholder:text-brand-text-muted focus:border-cta focus:ring-2 focus:ring-cta/40 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-brand-text-secondary hover:text-brand-text rounded-lg focus-visible:ring-2 focus-visible:ring-cta cursor-pointer"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </label>
              </div>
            ) : (
              <div className="space-y-3.5">
                <label className="block">
                  <span className="text-xs font-bold text-brand-text flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" />
                    {isThai
                      ? 'รหัส PIN สำหรับผู้ดูแลระบบ (รองรับหน้าจอสัมผัส POS)'
                      : 'Administrator Security PIN (Touch POS Ready)'}
                  </span>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={adminPin}
                    onChange={(e) => setAdminPin(e.target.value)}
                    placeholder="••••"
                    maxLength={8}
                    className="w-full h-12 mt-1.5 rounded-xl bg-brand-surface border border-brand-border px-4 text-center tracking-[0.4em] text-lg font-black tabular-nums text-brand-text focus:border-cta focus:ring-2 focus:ring-cta/40 outline-none"
                  />
                </label>

                {/* Touch-friendly Numpad for POS Screens & Tablets */}
                <div className="grid grid-cols-3 gap-2">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                    <button
                      key={digit}
                      type="button"
                      onClick={() => handlePinDigit(digit)}
                      className="h-12 sm:h-13 rounded-xl border border-brand-border bg-brand-surface hover:border-cta hover:bg-brand-surface-hover text-base font-black tabular-nums text-brand-text transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-cta cursor-pointer"
                    >
                      {digit}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAdminPin('')}
                    className="h-12 sm:h-13 rounded-xl border border-brand-border bg-brand-surface-muted hover:bg-danger-subtle hover:text-danger text-xs font-black uppercase text-brand-text-secondary transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-danger"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePinDigit('0')}
                    className="h-12 sm:h-13 rounded-xl border border-brand-border bg-brand-surface hover:border-cta hover:bg-brand-surface-hover text-base font-black tabular-nums text-brand-text transition-all active:scale-95 focus-visible:ring-2 focus-visible:ring-cta cursor-pointer"
                  >
                    0
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminPin((prev) => prev.slice(0, -1))}
                    aria-label={isThai ? 'ลบตัวเลขล่าสุด' : 'Delete last digit'}
                    className="h-12 sm:h-13 rounded-xl border border-brand-border bg-brand-surface hover:bg-brand-surface-hover text-brand-text flex items-center justify-center transition-all cursor-pointer focus-visible:ring-2 focus-visible:ring-cta"
                  >
                    <Delete className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            <button
              disabled={isLoading}
              type="submit"
              className={`w-full h-12 mt-2 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all focus-visible:ring-2 focus-visible:ring-cta focus-visible:ring-offset-2 ${
                isLoading
                  ? 'bg-brand-surface-muted border border-brand-border text-brand-text-muted shadow-none cursor-not-allowed'
                  : 'bg-cta text-cta-text hover:bg-cta-hover shadow-lg shadow-cta/30 cursor-pointer active:scale-[0.99]'
              }`}
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
              className="w-full min-h-[44px] rounded-xl border border-brand-border bg-brand-surface hover:bg-brand-surface-hover text-xs font-bold text-brand-text flex items-center justify-center gap-2 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-cta"
            >
              <Monitor className="h-3.5 w-3.5 text-brand-text-secondary" />
              <span>
                {isThai
                  ? 'กลับสู่หน้าเข้าสู่ระบบพนักงานขาย POS'
                  : 'Return to Standard POS Operator Login'}
              </span>
            </button>
          )}
        </div>

        <footer className="w-full max-w-xl mx-auto pt-4 text-center text-[11px] text-brand-text-secondary font-semibold">
          {isThai
            ? 'ป้องกันด้วยระบบตรวจสอบสิทธิ์ RBAC และบันทึก Audit Trail อัตโนมัติ'
            : 'Protected by Enterprise RBAC Verification & Immutable Audit Logging'}
        </footer>
      </section>
    </div>
  );
};
