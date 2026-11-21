import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Activity, ArrowUpRight, Building2, Fingerprint, LogOut, ShieldCheck, Store, Users } from 'lucide-react';
import {
  enrollOwnerTotp,
  evaluateOwnerSession,
  signOutOwner,
  type OwnerAuthState,
} from './lib/authFlow.ts';
import { shouldReevaluateOnAuthEvent } from './lib/authEvents.ts';
import { supabase, supabaseConfigReady } from './lib/supabase.ts';

export default function App() {
  const [authState, setAuthState] = useState<OwnerAuthState>(
    supabaseConfigReady ? 'loading' : 'misconfigured',
  );
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [factorId, setFactorId] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const authStateRef = useRef<OwnerAuthState>(authState);
  const pendingMfaUserId = useRef<string | null>(null);

  useEffect(() => {
    authStateRef.current = authState;
  }, [authState]);

  const resetMfaInputs = useCallback(() => {
    setFactorId('');
    setChallengeId('');
    setQrCode('');
    setTotpSecret('');
    setCode('');
  }, []);

  const evaluateSession = useCallback(
    async (next: Session | null) => {
      const current = ++sequence.current;
      setCode('');
      setChallengeId('');
      pendingMfaUserId.current = null;
      if (!next) {
        setSession(null);
        resetMfaInputs();
        setAuthState('signed-out');
        return;
      }
      if (!supabase) {
        setSession(null);
        setAuthState('misconfigured');
        return;
      }

      // Clear authorized UI while re-verifying so revoked/downgraded sessions never linger.
      setSession(null);
      setAuthState('loading');

      const result = await evaluateOwnerSession(supabase, next);
      if (current !== sequence.current) return;

      switch (result.state) {
        case 'signed-out':
          setSession(null);
          resetMfaInputs();
          setError('');
          setAuthState('signed-out');
          return;
        case 'mfa-challenge':
          pendingMfaUserId.current = next.user.id;
          setSession(null);
          setFactorId(result.factorId);
          setQrCode('');
          setTotpSecret('');
          setError('');
          setAuthState('mfa-challenge');
          return;
        case 'mfa-enroll':
          pendingMfaUserId.current = next.user.id;
          setSession(null);
          resetMfaInputs();
          setError('');
          setAuthState('mfa-enroll');
          return;
        case 'denied':
          setSession(null);
          resetMfaInputs();
          setError(result.error);
          setAuthState('denied');
          return;
        case 'signed-in':
          setSession(result.session);
          resetMfaInputs();
          setError('');
          setAuthState('signed-in');
          return;
      }
    },
    [resetMfaInputs],
  );

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    void supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!mounted) return;
        if (sessionError) {
          setSession(null);
          setError('ไม่สามารถกู้คืนเซสชันได้');
          setAuthState('signed-out');
          return;
        }
        void evaluateSession(data.session);
      })
      .catch(() => {
        if (!mounted) return;
        setSession(null);
        setError('ไม่สามารถกู้คืนเซสชันได้');
        setAuthState('signed-out');
      });

    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      // Passive re-emits (tab refocus, token refresh) must not wipe an in-progress MFA step.
      if (
        !shouldReevaluateOnAuthEvent({
          event,
          state: authStateRef.current,
          pendingMfaUserId: pendingMfaUserId.current,
          nextUserId: next?.user.id ?? null,
        })
      ) {
        return;
      }
      window.setTimeout(() => {
        if (mounted) void evaluateSession(next);
      }, 0);
    });

    return () => {
      mounted = false;
      sequence.current += 1;
      listener.subscription.unsubscribe();
    };
  }, [evaluateSession]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setError('');
    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (loginError || !data.session) {
        setError('เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบข้อมูล');
        return;
      }
      await evaluateSession(data.session);
    } catch {
      setError('เกิดข้อผิดพลาดระหว่างยืนยันตัวตน');
    } finally {
      setPassword('');
      setBusy(false);
    }
  }

  async function startEnrollment() {
    if (!supabase || busy) return;
    setBusy(true);
    setError('');
    try {
      const enrolled = await enrollOwnerTotp(supabase);
      setFactorId(enrolled.factorId);
      setQrCode(enrolled.qrCodeSrc);
      setTotpSecret(enrolled.secret);
    } catch {
      setError('สร้าง TOTP enrollment ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !factorId || busy) return;
    setBusy(true);
    setError('');
    try {
      let challenge = challengeId;
      if (!challenge) {
        const result = await supabase.auth.mfa.challenge({ factorId });
        if (result.error) throw result.error;
        challenge = result.data.id;
        setChallengeId(challenge);
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge,
        code: code.trim(),
      });
      if (verifyError) throw verifyError;
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !data.session) {
        throw sessionError ?? new Error('Missing session');
      }
      await evaluateSession(data.session);
    } catch {
      setError('รหัส Authenticator ไม่ถูกต้องหรือหมดอายุ กรุณาลองใหม่');
      setChallengeId('');
    } finally {
      setCode('');
      setBusy(false);
    }
  }

  async function logout() {
    if (!supabase || busy) return;
    sequence.current += 1;
    setBusy(true);
    setSession(null);
    resetMfaInputs();
    setPassword('');
    try {
      const { remoteRevoked } = await signOutOwner(supabase);
      setError(
        remoteRevoked
          ? ''
          : 'ล้างเซสชันในเบราว์เซอร์แล้ว แต่ไม่สามารถยืนยันการออกจากระบบกับเซิร์ฟเวอร์ได้',
      );
    } finally {
      setSession(null);
      resetMfaInputs();
      setAuthState('signed-out');
      setBusy(false);
    }
  }

  if (authState === 'loading') {
    return (
      <main className="center-screen">
        <div className="loader" />
        <p>กำลังตรวจสอบ Owner Session…</p>
      </main>
    );
  }
  if (authState === 'misconfigured') {
    return (
      <main className="center-screen">
        <section className="notice">
          <ShieldCheck />
          <h1>Owner Auth ยังไม่พร้อม</h1>
          <p>กำหนด VITE_SUPABASE_URL และ VITE_SUPABASE_PUBLISHABLE_KEY ใน Vercel</p>
        </section>
      </main>
    );
  }

  if (authState === 'signed-out') {
    return (
      <main className="auth-shell">
        <section className="auth-brand">
          <div className="brand-mark">P</div>
          <p className="eyebrow">PRODX · ENTERPRISE CONTROL PLANE</p>
          <h1>
            One control plane.
            <br />
            <span>Every operation.</span>
          </h1>
          <p className="muted">ศูนย์ควบคุมเจ้าของแพลตฟอร์ม แยก Authentication จาก POS Staff</p>
          <div className="security-note">
            <Fingerprint size={18} /> Dedicated Owner Identity · TOTP MFA
          </div>
        </section>
        <section className="auth-card">
          <div className="card-icon">
            <ShieldCheck />
          </div>
          <p className="eyebrow">OWNER ACCESS</p>
          <h2>เข้าสู่ระบบเจ้าของแพลตฟอร์ม</h2>
          <p className="muted">ใช้บัญชีที่ได้รับสิทธิ์ Owner เท่านั้น</p>
          <form onSubmit={login}>
            <label htmlFor="owner-email">อีเมล</label>
            <input
              id="owner-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="owner@example.com"
            />
            <label htmlFor="owner-password">รหัสผ่าน</label>
            <input
              id="owner-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button" type="submit" disabled={busy}>
              {busy ? 'กำลังตรวจสอบ…' : 'เข้าสู่ Owner Console'} <ArrowUpRight size={17} />
            </button>
          </form>
          <p className="footnote">
            ปิดการสมัครสมาชิกสาธารณะ · Owner accounts ต้อง provision ผ่านช่องทางที่เชื่อถือได้
          </p>
        </section>
      </main>
    );
  }

  if (authState === 'mfa-enroll' || authState === 'mfa-challenge') {
    return (
      <main className="center-screen">
        <section className="notice" style={{ width: 'min(100%, 480px)', textAlign: 'left' }}>
          <Fingerprint />
          <p className="eyebrow">MANDATORY OWNER MFA</p>
          <h1>{authState === 'mfa-enroll' ? 'ตั้งค่า Authenticator' : 'ยืนยันตัวตนอีกขั้น'}</h1>
          <p className="muted">
            {authState === 'mfa-enroll'
              ? 'บัญชี Owner ต้องลงทะเบียน TOTP ก่อนเข้าใช้งาน สแกน QR Code ด้วยแอป Authenticator'
              : 'กรอกรหัส 6 หลักจาก Authenticator เพื่อยืนยัน Owner Session'}
          </p>
          {authState === 'mfa-enroll' && !qrCode ? (
            <button
              className="primary-button"
              onClick={() => void startEnrollment()}
              disabled={busy}
            >
              {busy ? 'กำลังเตรียม…' : 'สร้าง QR Code'}
            </button>
          ) : (
            <>
              {qrCode && (
                <img
                  src={qrCode}
                  alt="TOTP enrollment QR code"
                  style={{
                    display: 'block',
                    width: 220,
                    height: 220,
                    padding: 12,
                    margin: '20px auto',
                    background: '#fff',
                    borderRadius: 14,
                  }}
                />
              )}
              {totpSecret && (
                <p className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                  Manual setup key: <code>{totpSecret}</code>
                </p>
              )}
              <form onSubmit={verifyMfa} style={{ display: 'grid', gap: 10, marginTop: 20 }}>
                <label htmlFor="owner-totp">รหัส 6 หลักจาก Authenticator</label>
                <input
                  id="owner-totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  className="primary-button"
                  type="submit"
                  disabled={busy || code.length !== 6}
                >
                  {busy ? 'กำลังยืนยัน…' : 'ยืนยัน MFA'}
                </button>
              </form>
            </>
          )}
          {error && !qrCode && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button
            className="secondary-button"
            onClick={() => void logout()}
            disabled={busy}
          >
            ออกจากระบบ
          </button>
        </section>
      </main>
    );
  }

  if (authState === 'denied') {
    return (
      <main className="center-screen">
        <section className="notice">
          <ShieldCheck />
          <h1>ไม่มีสิทธิ์ Owner</h1>
          <p>{error || 'บัญชีนี้ยังไม่ได้รับ Owner role หรือไม่สามารถยืนยัน MFA ได้'}</p>
          <button
            className="secondary-button"
            onClick={() => void logout()}
            disabled={busy}
          >
            ออกจากระบบ
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="console-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark small">P</div>
          <div>
            <strong>
              PRODX <span>OWNER</span>
            </strong>
            <small>PLATFORM CONTROL PLANE</small>
          </div>
        </div>
        <div className="account">
          <span>{session?.user.email}</span>
          <button
            className="icon-button"
            onClick={() => void logout()}
            disabled={busy}
            aria-label="Sign out"
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>
      <section className="welcome">
        <p className="eyebrow">OWNER WORKSPACE · AAL2</p>
        <h1>ยินดีต้อนรับสู่ศูนย์ควบคุม PRODX</h1>
        <p className="muted">ยืนยัน Owner identity และ TOTP MFA สำเร็จแล้ว</p>
      </section>
      <section className="metric-grid">
        <article className="metric-card">
          <Building2 />
          <span>Organizations</span>
          <strong>—</strong>
          <small>รอเชื่อม Owner API</small>
        </article>
        <article className="metric-card">
          <Store />
          <span>Branches</span>
          <strong>—</strong>
          <small>รอเชื่อม Owner API</small>
        </article>
        <article className="metric-card">
          <Users />
          <span>Staff identities</span>
          <strong>—</strong>
          <small>รอเชื่อม Owner API</small>
        </article>
        <article className="metric-card">
          <Activity />
          <span>Platform health</span>
          <strong>Pending</strong>
          <small>ยังไม่อ่านข้อมูล Production</small>
        </article>
      </section>
      <section className="empty-state">
        <ShieldCheck />
        <div>
          <h2>Owner identity verified · AAL2</h2>
          <p>
            Dashboard นี้ยังไม่เรียกข้อมูลธุรกิจจนกว่า Server-side authorization และ RLS
            จะผ่านการตรวจสอบ
          </p>
        </div>
      </section>
      <footer>
        PRODX OWNER CONSOLE · AUTHENTICATION ISOLATED · {session?.user.id.slice(0, 8)}
      </footer>
    </main>
  );
}
