import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { Activity, ArrowUpRight, Building2, Fingerprint, LogOut, ShieldCheck, Store, Users } from 'lucide-react';
import { supabase, supabaseConfigReady } from './lib/supabase';

type AuthState = 'loading' | 'signed-out' | 'mfa-enroll' | 'mfa-challenge' | 'signed-in' | 'denied' | 'misconfigured';

function hasOwnerRole(user: User): boolean {
  return user.app_metadata?.owner_role === 'owner';
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>(supabaseConfigReady ? 'loading' : 'misconfigured');
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [factorId, setFactorId] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);

  const evaluateSession = useCallback(async (next: Session | null) => {
    const current = ++sequence.current;
    setSession(next);
    setCode('');
    setChallengeId('');
    if (!next) { setAuthState('signed-out'); return; }
    if (!supabase) { setAuthState('misconfigured'); return; }

    const [{ data: userData, error: userError }, { data: aal, error: aalError }] = await Promise.all([
      supabase.auth.getUser(next.access_token),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(next.access_token),
    ]);
    if (current !== sequence.current) return;
    if (userError || !userData.user || aalError) {
      setError('ไม่สามารถยืนยัน Owner identity หรือ MFA ได้');
      setAuthState('denied');
      return;
    }
    if (!hasOwnerRole(userData.user)) { setAuthState('denied'); return; }
    if (aal.currentLevel !== 'aal2') {
      const { data, error: factorError } = await supabase.auth.mfa.listFactors();
      if (current !== sequence.current) return;
      if (factorError) { setError('ตรวจสอบ MFA factors ไม่สำเร็จ'); setAuthState('denied'); return; }
      const verified = data.totp.find((factor) => factor.status === 'verified');
      if (verified) { setFactorId(verified.id); setAuthState('mfa-challenge'); }
      else { setFactorId(''); setQrCode(''); setAuthState('mfa-enroll'); }
      return;
    }

    const { data: authorization, error: authorizationError } = await supabase.functions.invoke<{
      authorized: boolean;
      assuranceLevel: string;
    }>('owner-authorize', {
      headers: { Authorization: `Bearer ${next.access_token}` },
    });
    if (current !== sequence.current) return;
    if (
      authorizationError ||
      authorization?.authorized !== true ||
      authorization.assuranceLevel !== 'aal2'
    ) {
      setError('Server ไม่สามารถยืนยัน Owner authorization ได้ จึงปฏิเสธการเข้าใช้งาน');
      setAuthState('denied');
      return;
    }

    setError('');
    setAuthState('signed-in');
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) { setError('ไม่สามารถกู้คืนเซสชันได้'); setAuthState('signed-out'); return; }
      void evaluateSession(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      window.setTimeout(() => { if (mounted) void evaluateSession(next); }, 0);
    });
    return () => { mounted = false; sequence.current += 1; listener.subscription.unsubscribe(); };
  }, [evaluateSession]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true); setError('');
    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (loginError || !data.session) { setError('เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบข้อมูล'); return; }
      await evaluateSession(data.session);
    } catch { setError('เกิดข้อผิดพลาดระหว่างยืนยันตัวตน'); }
    finally { setPassword(''); setBusy(false); }
  }

  async function startEnrollment() {
    if (!supabase || busy) return;
    setBusy(true); setError('');
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'PRODX Owner Authenticator' });
      if (enrollError) throw enrollError;
      setFactorId(data.id);
      setQrCode(data.totp.qr_code);
    } catch { setError('สร้าง TOTP enrollment ไม่สำเร็จ'); }
    finally { setBusy(false); }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !factorId || busy) return;
    setBusy(true); setError('');
    try {
      let challenge = challengeId;
      if (!challenge) {
        const result = await supabase.auth.mfa.challenge({ factorId });
        if (result.error) throw result.error;
        challenge = result.data.id;
        setChallengeId(challenge);
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge, code: code.trim() });
      if (verifyError) throw verifyError;
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) throw sessionError ?? new Error('Missing session');
      await evaluateSession(data.session);
    } catch { setError('รหัส Authenticator ไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่'); setChallengeId(''); }
    finally { setCode(''); setBusy(false); }
  }

  async function logout() {
    if (!supabase || busy) return;
    setBusy(true);
    try { await supabase.auth.signOut(); setSession(null); setAuthState('signed-out'); }
    finally { setBusy(false); }
  }

  if (authState === 'loading') return <main className="center-screen"><div className="loader" /><p>กำลังตรวจสอบ Owner Session…</p></main>;
  if (authState === 'misconfigured') return <main className="center-screen"><section className="notice"><ShieldCheck /><h1>Owner Auth ยังไม่พร้อม</h1><p>กำหนด VITE_SUPABASE_URL และ VITE_SUPABASE_PUBLISHABLE_KEY ใน Vercel</p></section></main>;

  if (authState === 'signed-out') return (
    <main className="auth-shell">
      <section className="auth-brand"><div className="brand-mark">P</div><p className="eyebrow">PRODX · ENTERPRISE CONTROL PLANE</p><h1>One control plane.<br /><span>Every operation.</span></h1><p className="muted">ศูนย์ควบคุมเจ้าของแพลตฟอร์ม แยก Authentication จาก POS Staff</p><div className="security-note"><Fingerprint size={18} /> Dedicated Owner Identity · TOTP MFA</div></section>
      <section className="auth-card"><div className="card-icon"><ShieldCheck /></div><p className="eyebrow">OWNER ACCESS</p><h2>เข้าสู่ระบบเจ้าของแพลตฟอร์ม</h2><p className="muted">ใช้บัญชีที่ได้รับสิทธิ์ Owner เท่านั้น</p>
        <form onSubmit={login}><label htmlFor="owner-email">อีเมล</label><input id="owner-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@example.com" /><label htmlFor="owner-password">รหัสผ่าน</label><input id="owner-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••" />{error && <p className="error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'กำลังตรวจสอบ…' : 'เข้าสู่ Owner Console'} <ArrowUpRight size={17} /></button></form>
        <p className="footnote">ปิดการสมัครสมาชิกสาธารณะ · Owner accounts ต้อง provision ผ่านช่องทางที่เชื่อถือได้</p>
      </section>
    </main>
  );

  if (authState === 'mfa-enroll' || authState === 'mfa-challenge') return (
    <main className="center-screen"><section className="notice" style={{ width: 'min(100%, 480px)', textAlign: 'left' }}>
      <Fingerprint /><p className="eyebrow">MANDATORY OWNER MFA</p><h1>{authState === 'mfa-enroll' ? 'ตั้งค่า Authenticator' : 'ยืนยันตัวตนอีกขั้น'}</h1>
      <p className="muted">{authState === 'mfa-enroll' ? 'บัญชี Owner ต้องลงทะเบียน TOTP ก่อนเข้าใช้งาน สแกน QR Code ด้วยแอป Authenticator' : 'กรอกรหัส 6 หลักจาก Authenticator เพื่อยืนยัน Owner Session'}</p>
      {authState === 'mfa-enroll' && !qrCode ? <button className="primary-button" onClick={() => void startEnrollment()} disabled={busy}>{busy ? 'กำลังเตรียม…' : 'สร้าง QR Code'}</button> : <>
        {qrCode && <img src={`data:image/svg+xml,${encodeURIComponent(qrCode)}`} alt="TOTP enrollment QR code" style={{ display: 'block', width: 220, height: 220, padding: 12, margin: '20px auto', background: '#fff', borderRadius: 14 }} />}
        <form onSubmit={verifyMfa} style={{ display: 'grid', gap: 10, marginTop: 20 }}><label htmlFor="owner-totp">รหัส 6 หลักจาก Authenticator</label><input id="owner-totp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />{error && <p className="error" role="alert">{error}</p>}<button className="primary-button" type="submit" disabled={busy || code.length !== 6}>{busy ? 'กำลังยืนยัน…' : 'ยืนยัน MFA'}</button></form>
      </>}
      {error && !qrCode && <p className="error" role="alert">{error}</p>}<button className="secondary-button" onClick={() => void logout()} disabled={busy}>ออกจากระบบ</button>
    </section></main>
  );

  if (authState === 'denied') return <main className="center-screen"><section className="notice"><ShieldCheck /><h1>ไม่มีสิทธิ์ Owner</h1><p>{error || 'บัญชีนี้ยังไม่ได้รับ Owner role หรือไม่สามารถยืนยัน MFA ได้'}</p><button className="secondary-button" onClick={() => void logout()}>ออกจากระบบ</button></section></main>;

  return <main className="console-shell">
    <header className="topbar"><div className="brand-lockup"><div className="brand-mark small">P</div><div><strong>PRODX <span>OWNER</span></strong><small>PLATFORM CONTROL PLANE</small></div></div><div className="account"><span>{session?.user.email}</span><button className="icon-button" onClick={() => void logout()} disabled={busy} aria-label="Sign out"><LogOut size={17} /></button></div></header>
    <section className="welcome"><p className="eyebrow">OWNER WORKSPACE · AAL2</p><h1>ยินดีต้อนรับสู่ศูนย์ควบคุม PRODX</h1><p className="muted">ยืนยัน Owner identity และ TOTP MFA สำเร็จแล้ว</p></section>
    <section className="metric-grid"><article className="metric-card"><Building2 /><span>Organizations</span><strong>—</strong><small>รอเชื่อม Owner API</small></article><article className="metric-card"><Store /><span>Branches</span><strong>—</strong><small>รอเชื่อม Owner API</small></article><article className="metric-card"><Users /><span>Staff identities</span><strong>—</strong><small>รอเชื่อม Owner API</small></article><article className="metric-card"><Activity /><span>Platform health</span><strong>Pending</strong><small>ยังไม่อ่านข้อมูล Production</small></article></section>
    <section className="empty-state"><ShieldCheck /><div><h2>Owner identity verified · AAL2</h2><p>Dashboard นี้ยังไม่เรียกข้อมูลธุรกิจจนกว่า Server-side authorization และ RLS จะผ่านการตรวจสอบ</p></div></section><footer>PRODX OWNER CONSOLE · AUTHENTICATION ISOLATED · {session?.user.id.slice(0, 8)}</footer>
  </main>;
}
