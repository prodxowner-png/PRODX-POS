import React, { useCallback, useEffect, useState } from 'react';
import { Fingerprint, KeyRound, Laptop, Loader2, Pencil, Plus, ShieldCheck, Smartphone, Trash2, X, Check } from 'lucide-react';
import { startRegistration } from '@simplewebauthn/browser';
import { useAuth } from '../../../context/AuthContext';
import { useLanguage } from '../../../context/LanguageContext';
import { useToast } from '../../../context/ToastContext';
import { checkWebAuthnCapability, type WebAuthnCapability } from '../../../services/webauthnService';
import { webauthnApi, type WebAuthnCredential, type WebAuthnRevocationReason, type WebAuthnServerStatus } from '../../../adapters/webauthnApi';

export const ManageRegisteredDevicesSection: React.FC = () => {
  const { session } = useAuth();
  const { language } = useLanguage();
  const { addToast } = useToast();
  const isThai = language === 'th';
  const token = session?.token ?? '';
  const [credentials, setCredentials] = useState<WebAuthnCredential[]>([]);
  const [capability, setCapability] = useState<WebAuthnCapability | null>(null);
  const [serverStatus, setServerStatus] = useState<WebAuthnServerStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRegistering, setIsRegistering] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState<WebAuthnRevocationReason>('manual');

  const refresh = useCallback(async () => {
    if (!token) { setCredentials([]); setIsLoading(false); return; }
    setIsLoading(true);
    try {
      const [cap, status] = await Promise.all([checkWebAuthnCapability(), webauthnApi.status()]);
      setCapability(cap);
      setServerStatus(status);
      if (!status.enabled) { setCredentials([]); return; }
      setCredentials(await webauthnApi.listCredentials(token));
    } catch (error) {
      addToast({ title: isThai ? 'โหลด Passkey ไม่สำเร็จ' : 'Unable to Load Passkeys', message: error instanceof Error ? error.message : String(error), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  }, [token, addToast, isThai]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleRegister = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || !serverStatus?.enabled) return;
    setIsRegistering(true);
    try {
      const label = newLabel.trim() || 'This device';
      const ceremony = await webauthnApi.registrationOptions(token, label);
      const response = await startRegistration({ optionsJSON: ceremony.options });
      await webauthnApi.verifyRegistration(token, ceremony.challengeId, response, label);
      setNewLabel('');
      await refresh();
      addToast({ title: isThai ? 'ลงทะเบียน Passkey สำเร็จ' : 'Passkey Registered', message: isThai ? 'เพิ่ม Passkey ในบัญชีของคุณแล้ว' : 'The passkey is now linked to your account.', type: 'success' });
    } catch (error) {
      addToast({ title: isThai ? 'ลงทะเบียนไม่สำเร็จ' : 'Registration Failed', message: error instanceof Error ? error.message : String(error), type: 'error' });
    } finally {
      setIsRegistering(false);
    }
  };

  const handleRename = async (id: string) => {
    const label = editingLabel.trim();
    if (!token || !label) return;
    setBusyId(id);
    try {
      await webauthnApi.renameCredential(token, id, label);
      setEditingId(null);
      setEditingLabel('');
      await refresh();
      addToast({ title: isThai ? 'เปลี่ยนชื่อ Passkey แล้ว' : 'Passkey Renamed', message: label, type: 'success' });
    } catch (error) {
      addToast({ title: isThai ? 'เปลี่ยนชื่อไม่สำเร็จ' : 'Rename Failed', message: error instanceof Error ? error.message : String(error), type: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  const handleRevoke = async (id: string) => {
    const reasonLabels: Record<WebAuthnRevocationReason, string> = {
      lost_device: isThai ? 'อุปกรณ์สูญหาย' : 'Lost device',
      compromised: isThai ? 'สงสัยว่าถูกเจาะ' : 'Suspected compromise',
      replaced: isThai ? 'เปลี่ยนอุปกรณ์' : 'Device replaced',
      manual: isThai ? 'เพิกถอนด้วยตนเอง' : 'Manual revocation',
    };
    if (!token || !window.confirm(isThai ? `เพิกถอน Passkey นี้หรือไม่? เหตุผล: ${reasonLabels[revokeReason]}` : `Revoke this passkey? Reason: ${reasonLabels[revokeReason]}. This authenticator will no longer be able to sign in.`)) return;
    setBusyId(id);
    try {
      await webauthnApi.revokeCredential(token, id, revokeReason);
      await refresh();
      addToast({ title: isThai ? 'เพิกถอน Passkey แล้ว' : 'Passkey Revoked', message: isThai ? `เพิกถอนด้วยเหตุผล: ${reasonLabels[revokeReason]}` : `Reason: ${reasonLabels[revokeReason]}. This key can no longer authenticate.`, type: 'success' });
    } catch (error) {
      addToast({ title: isThai ? 'เพิกถอนไม่สำเร็จ' : 'Revoke Failed', message: error instanceof Error ? error.message : String(error), type: 'error' });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section id="manage-registered-devices-section" aria-labelledby="manage-registered-devices-heading" className="bg-card border border-border border-crisp rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Fingerprint className="w-5 h-5" /></div>
          <div>
            <h2 id="manage-registered-devices-heading" className="text-base font-black text-text">{isThai ? 'Passkey และอุปกรณ์ที่ลงทะเบียน' : 'Registered Passkeys & Devices'}</h2>
            <p className="text-xs text-text/60">{isThai ? 'จัดการ Passkey ของบัญชีนี้ในสาขาปัจจุบัน (ต้องลงทะเบียนแยกในแต่ละสาขา)' : 'Manage passkeys registered to your signed-in account for this store.'}</p>
          </div>
        </div>
        <div className="text-xs font-bold text-text/65">{credentials.length} {isThai ? 'คีย์' : 'keys'}</div>
      </header>

      <div className="rounded-xl border border-border bg-background p-3 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0">
          <div className="text-xs font-bold text-text">{serverStatus?.enabled ? (isThai ? 'Server-side WebAuthn เปิดใช้งาน' : 'Server-side WebAuthn enabled') : (isThai ? 'Server-side WebAuthn ยังไม่พร้อม' : 'Server-side WebAuthn unavailable')}</div>
          <div className="text-[11px] text-text/60 mt-0.5">{serverStatus?.error || capability?.platformSummary || (isThai ? 'กำลังตรวจสอบความสามารถของอุปกรณ์' : 'Checking authenticator capability')}</div>
        </div>
      </div>

      <form onSubmit={handleRegister} className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-text"><Plus className="w-4 h-4 text-primary" />{isThai ? 'ลงทะเบียน Passkey ใหม่บนอุปกรณ์นี้' : 'Register a Passkey on This Device'}</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={newLabel} onChange={(event) => setNewLabel(event.target.value)} maxLength={80} placeholder={isThai ? 'ชื่ออุปกรณ์ เช่น เครื่องแคชเชียร์หน้า' : 'Device label, e.g. Front Register'} className="flex-1 min-h-[42px] rounded-lg border border-border bg-card px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary" />
          <button type="submit" disabled={!serverStatus?.enabled || !capability?.isSupported || !capability?.hasPlatformAuthenticator || isRegistering} className="min-h-[42px] px-4 rounded-lg bg-primary text-primary-foreground text-xs font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40">
            {isRegistering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}{isThai ? 'ลงทะเบียน' : 'Register'}
          </button>
        </div>
        <p className="text-[11px] text-text/55">{isThai ? 'ต้องยืนยันตัวตนผ่านอุปกรณ์หรือ Password Manager และมีการตรวจสอบ attestation บน Server' : 'Your authenticator or password manager will prompt you; attestation is verified by the server.'}</p>
      </form>

      <div className="space-y-2">
        {isLoading ? <div className="py-8 flex items-center justify-center gap-2 text-xs text-text/60"><Loader2 className="w-4 h-4 animate-spin" />{isThai ? 'กำลังโหลด...' : 'Loading passkeys...'}</div> : credentials.length === 0 ? <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-text/60">{isThai ? 'ยังไม่มี Passkey ที่ลงทะเบียนในบัญชีนี้' : 'No passkeys are registered to this account yet.'}</div> : credentials.map((item) => (
          <article key={item.id} className="rounded-xl border border-border bg-background p-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-card border border-border flex items-center justify-center text-primary shrink-0">{item.device_type === 'multiDevice' ? <Smartphone className="w-4 h-4" /> : <Laptop className="w-4 h-4" />}</div>
            <div className="flex-1 min-w-0">
              {editingId === item.id ? <div className="flex gap-2"><input autoFocus value={editingLabel} onChange={(event) => setEditingLabel(event.target.value)} maxLength={80} className="min-h-[36px] min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-sm" /><button type="button" onClick={() => void handleRename(item.id)} disabled={!editingLabel.trim() || busyId === item.id} aria-label="Save label" className="p-2 rounded-md bg-primary text-primary-foreground disabled:opacity-40"><Check className="w-4 h-4" /></button><button type="button" onClick={() => setEditingId(null)} aria-label="Cancel rename" className="p-2 rounded-md border border-border"><X className="w-4 h-4" /></button></div> : <div className="font-bold text-sm text-text truncate">{item.label}</div>}
              <div className="text-[11px] text-text/55 mt-0.5">{item.device_type === 'multiDevice' ? (isThai ? 'ซิงค์ข้ามอุปกรณ์' : 'Synced passkey') : (isThai ? 'อุปกรณ์เครื่องเดียว' : 'Single-device passkey')} · {item.backed_up ? (isThai ? 'สำรองแล้ว' : 'Backed up') : (isThai ? 'ยังไม่สำรอง' : 'Not backed up')}</div>
              <div className="text-[10px] text-text/45 mt-0.5">{isThai ? 'สร้างเมื่อ' : 'Created'}: {new Date(item.created_at).toLocaleString()} · {isThai ? 'ใช้ล่าสุด' : 'Last used'}: {item.last_used_at ? new Date(item.last_used_at).toLocaleString() : (isThai ? 'ยังไม่เคย' : 'Never')}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <select aria-label={isThai ? 'เหตุผลในการเพิกถอน Passkey' : 'Passkey revocation reason'} value={revokeReason} onChange={(event) => setRevokeReason(event.target.value as WebAuthnRevocationReason)} className="min-h-[40px] max-w-[150px] rounded-lg border border-border bg-card px-2 text-[11px] text-text">
                <option value="manual">{isThai ? 'เพิกถอนทั่วไป' : 'Manual'}</option>
                <option value="lost_device">{isThai ? 'อุปกรณ์สูญหาย' : 'Lost device'}</option>
                <option value="compromised">{isThai ? 'สงสัยว่าถูกเจาะ' : 'Compromised'}</option>
                <option value="replaced">{isThai ? 'เปลี่ยนอุปกรณ์' : 'Replaced'}</option>
              </select>
              <button type="button" disabled={busyId === item.id} onClick={() => { setEditingId(item.id); setEditingLabel(item.label); }} className="min-h-[40px] px-3 rounded-lg border border-border text-xs font-bold text-text/70 hover:bg-card inline-flex items-center gap-1.5 disabled:opacity-40"><Pencil className="w-3.5 h-3.5" />{isThai ? 'เปลี่ยนชื่อ' : 'Rename'}</button>
              <button type="button" disabled={busyId === item.id} onClick={() => void handleRevoke(item.id)} className="min-h-[40px] px-3 rounded-lg border border-red-500/30 text-xs font-bold text-red-600 hover:bg-red-500/10 inline-flex items-center gap-1.5 disabled:opacity-40">{busyId === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}{isThai ? 'เพิกถอน' : 'Revoke'}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};
