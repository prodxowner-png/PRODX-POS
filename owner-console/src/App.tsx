import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { Activity, ArrowUpRight, Building2, Fingerprint, LogOut, ShieldCheck, Store, Users } from 'lucide-react';
import { supabase, supabaseConfigReady } from './lib/supabase';

type AuthState = 'loading' | 'signed-out' | 'signed-in' | 'denied' | 'misconfigured';

function hasOwnerRole(user: User): boolean {
  // app_metadata is managed by trusted administrators, unlike user_metadata.
  return user.app_metadata?.owner_role === 'owner';
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>(supabaseConfigReady ? 'loading' : 'misconfigured');
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const verificationSequence = useRef(0);

  const evaluateSession = useCallback(async (nextSession: Session | null) => {
    const sequence = ++verificationSequence.current;
    setSession(nextSession);
    if (!nextSession) {
      setAuthState('signed-out');
      return;
    }
    const { data, error: userError } = await supabase!.auth.getUser(nextSession.access_token);
    if (sequence !== verificationSequence.current) return;
    if (userError || !data.user) {
      await supabase!.auth.signOut();
      if (sequence !== verificationSequence.current) return;
      setSession(null);
      setAuthState('signed-out');
      setError('ไม่สามารถตรวจสอบบัญชีกับ Owner Auth ได้ กรุณาเข้าสู่ระบบอีกครั้ง');
      return;
    }
    setAuthState(hasOwnerRole(data.user) ? 'signed-in' : 'denied');
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!mounted) return;
      if (sessionError) {
        setError('ไม่สามารถกู้คืนเซสชันได้');
        setAuthState('signed-out');
        return;
      }
      void evaluateSession(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) {
        // Defer network calls until the Supabase auth callback releases its internal lock.
        window.setTimeout(() => {
          if (mounted) void evaluateSession(nextSession);
        }, 0);
      }
    });
    return () => {
      mounted = false;
      verificationSequence.current += 1;
      listener.subscription.unsubscribe();
    };
  }, [evaluateSession]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setError('');
    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (loginError) {
        setError('เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบข้อมูลหรือยืนยันอีเมลก่อน');
        return;
      }
      await evaluateSession(data.session);
    } catch {
      setError('เกิดข้อผิดพลาดระหว่างยืนยันตัวตน กรุณาลองใหม่');
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  async function handleSignOut() {
    if (!supabase || busy) return;
    setBusy(true);
    try {
      await supabase.auth.signOut();
      setSession(null);
      setAuthState('signed-out');
    } finally {
      setBusy(false);
    }
  }

  if (authState === 'loading') return <main className="center-screen"><div className="loader" /><p>กำลังตรวจสอบ Owner Session…</p></main>;
  if (authState === 'misconfigured') return <main className="center-screen"><section className="notice"><ShieldCheck /><h1>Owner Auth ยังไม่พร้อม</h1><p>กำหนด VITE_SUPABASE_URL และ VITE_SUPABASE_PUBLISHABLE_KEY ของโปรเจกต์ PRODX-OWNER-AUTH ใน Vercel Environment Variables ก่อน Deploy</p></section></main>;

  if (authState === 'signed-out') return (
    <main className="auth-shell">
      <section className="auth-brand">
        <div className="brand-mark">P</div>
        <p className="eyebrow">PRODX · ENTERPRISE CONTROL PLANE</p>
        <h1>One control plane.<br /><span>Every operation.</span></h1>
        <p className="muted">ศูนย์ควบคุมสำหรับเจ้าของแพลตฟอร์ม แยก Authentication จาก POS Staff โดยสมบูรณ์</p>
        <div className="security-note"><Fingerprint size={18} /> Dedicated Owner Identity · Supabase Auth</div>
      </section>
      <section className="auth-card">
        <div className="card-icon"><ShieldCheck /></div>
        <p className="eyebrow">OWNER ACCESS</p>
        <h2>เข้าสู่ระบบเจ้าของแพลตฟอร์ม</h2>
        <p className="muted">ใช้บัญชีที่ได้รับสิทธิ์ Owner จากผู้ดูแลระบบเท่านั้น</p>
        <form onSubmit={handleLogin}>
          <label htmlFor="owner-email">อีเมล</label>
          <input id="owner-email" type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="owner@example.com" />
          <label htmlFor="owner-password">รหัสผ่าน</label>
          <input id="owner-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••••" />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary-button" type="submit" disabled={busy}>{busy ? 'กำลังตรวจสอบ…' : 'เข้าสู่ Owner Console'} <ArrowUpRight size={17} /></button>
        </form>
        <p className="footnote">ระบบปิดการสมัครสมาชิกสาธารณะ · Owner accounts ต้องถูก provision ผ่านช่องทางที่เชื่อถือได้</p>
      </section>
    </main>
  );

  if (authState === 'denied') return <main className="center-screen"><section className="notice"><ShieldCheck /><h1>ไม่มีสิทธิ์ Owner</h1><p>บัญชีนี้ยืนยันตัวตนสำเร็จ แต่ยังไม่ได้รับ Owner role จากระบบที่เชื่อถือได้</p><button className="secondary-button" onClick={() => void handleSignOut()}>ออกจากระบบ</button></section></main>;

  return (
    <main className="console-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark small">P</div><div><strong>PRODX <span>OWNER</span></strong><small>PLATFORM CONTROL PLANE</small></div></div>
        <div className="account"><span>{session?.user.email}</span><button className="icon-button" onClick={() => void handleSignOut()} disabled={busy} aria-label="Sign out"><LogOut size={17} /></button></div>
      </header>
      <section className="welcome"><p className="eyebrow">OWNER WORKSPACE</p><h1>ยินดีต้อนรับสู่ศูนย์ควบคุม PRODX</h1><p className="muted">แยกจากระบบปฏิบัติการ POS และพร้อมสำหรับเชื่อมต่อ Owner-only services ใน Milestone ถัดไป</p></section>
      <section className="metric-grid">
        <article className="metric-card"><Building2 /><span>Organizations</span><strong>—</strong><small>รอเชื่อม Owner API</small></article>
        <article className="metric-card"><Store /><span>Branches</span><strong>—</strong><small>รอเชื่อม Owner API</small></article>
        <article className="metric-card"><Users /><span>Staff identities</span><strong>—</strong><small>รอเชื่อม Owner API</small></article>
        <article className="metric-card"><Activity /><span>Platform health</span><strong>Pending</strong><small>ยังไม่อ่านข้อมูล Production</small></article>
      </section>
      <section className="empty-state"><ShieldCheck /><div><h2>Owner identity verified</h2><p>ยืนยันบัญชีผ่าน PRODX-OWNER-AUTH แล้ว หน้านี้ยังไม่เรียกข้อมูลธุรกิจหรือ API ที่มีสิทธิ์สูงจนกว่าจะมี Server-side Owner Authorization และ RLS policies ที่ผ่านการตรวจสอบ</p></div></section>
      <footer>PRODX OWNER CONSOLE · AUTHENTICATION ISOLATED · {session?.user.id.slice(0, 8)}</footer>
    </main>
  );
}