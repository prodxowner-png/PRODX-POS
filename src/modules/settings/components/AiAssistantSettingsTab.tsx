import React, { useState } from 'react';
import { Bot, CheckCircle2, RefreshCw, Send, ShieldCheck, Sliders, Mail, BellRing } from 'lucide-react';
import { Card, CardHeader, CardBody, CardTitle, CardDescription } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Badge } from '../../../components/common/Badge';
import { useToast } from '../../../context/ToastContext';
import { useLanguage } from '../../../context/LanguageContext';
import { aiService, AiConfig, DEFAULT_AI_CONFIG, AI_BACKEND_CHAT_PATH } from '../../../services/aiService';
import { GmailIntegrationModal } from '../../../components/workspace/GmailIntegrationModal';
import { FcmNotificationWidget } from '../../../components/workspace/FcmNotificationWidget';

export const AiAssistantSettingsTab: React.FC = () => {
  const { addToast } = useToast();
  const { language } = useLanguage();
  const isThai = language === 'th';
  const [config, setConfig] = useState<AiConfig>(() => aiService.getConfig());
  const [prompt, setPrompt] = useState(isThai ? 'สรุปแนวโน้มยอดขายของร้านแบบสั้นๆ' : 'Summarize the store sales trend briefly.');
  const [response, setResponse] = useState('');
  const [testing, setTesting] = useState(false);
  const [isGmailModalOpen, setIsGmailModalOpen] = useState(false);

  const save = () => { aiService.saveConfig(config); addToast({ title: isThai ? 'บันทึกสำเร็จ' : 'Saved', message: isThai ? 'บันทึกการตั้งค่า PRODX AI แล้ว' : 'PRODX AI settings saved.', type: 'success' }); };
  const reset = () => { setConfig(DEFAULT_AI_CONFIG); aiService.saveConfig(DEFAULT_AI_CONFIG); addToast({ title: isThai ? 'รีเซ็ตแล้ว' : 'Reset', message: isThai ? 'คืนค่าการตั้งค่า AI เริ่มต้นแล้ว' : 'AI defaults restored.', type: 'info' }); };
  const testConnection = async () => {
    setTesting(true); setResponse('');
    try {
      const result = await aiService.chatCompletion([{ role: 'system', content: 'You are PRODX AI, a helpful assistant for a retail POS system.' }, { role: 'user', content: prompt }], config);
      setResponse(result); addToast({ title: isThai ? 'เชื่อมต่อ AI Gateway สำเร็จ' : 'AI Gateway connected', message: isThai ? 'PRODX AI backend responded successfully via Vercel AI Gateway.' : 'PRODX AI backend responded successfully via Vercel AI Gateway.', type: 'success' });
    } catch (error) {
      setResponse(error instanceof Error ? error.message : String(error)); addToast({ title: isThai ? 'เชื่อมต่อ AI Gateway ล้มเหลว' : 'AI Gateway connection failed', message: error instanceof Error ? error.message : String(error), type: 'error' });
    } finally { setTesting(false); }
  };
  return <div className="space-y-6">
    <Card><CardHeader><div className="flex items-center justify-between gap-4"><div><CardTitle>{isThai ? 'PRODX AI' : 'PRODX AI'}</CardTitle><CardDescription>{isThai ? 'Google Gemini ทำงานผ่าน Vercel AI Gateway และ backend ที่ยืนยันตัวตนแล้วเท่านั้น' : 'Google Gemini is served through Vercel AI Gateway and the authenticated backend'}</CardDescription></div><Badge variant="success">{isThai ? 'Vercel AI Gateway' : 'Vercel AI Gateway'}</Badge></div></CardHeader><CardBody className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div>
          <p className="font-medium">{isThai ? 'ไม่มีการเก็บ API key ของ AI provider ในเบราว์เซอร์' : 'No AI provider API key is stored in the browser'}</p>
          <p className="mt-0.5 opacity-80">{isThai ? `คำขอทั้งหมดถูกส่งไปที่ ${AI_BACKEND_CHAT_PATH} ด้วย session ปัจจุบัน เซิร์ฟเวอร์เรียก Vercel AI Gateway ผ่าน OIDC ตรวจสิทธิ์ ai:use จำกัดขอบเขตร้าน และบันทึก audit log` : `All requests go to ${AI_BACKEND_CHAT_PATH} with the current session. The server authenticates to Vercel AI Gateway with OIDC, enforces ai:use, scopes the store, and writes an audit log.`}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><label className="mb-1 flex items-center gap-1.5 text-sm font-medium"><Bot className="h-4 w-4" />{isThai ? 'Vercel AI Gateway model' : 'Vercel AI Gateway model'}</label><input value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value })} placeholder="google/gemini-3.8-flash" className="w-full rounded-lg border px-3 py-2 font-mono text-sm" /><p className="mt-1 text-xs opacity-70">{isThai ? 'เซิร์ฟเวอร์เป็นผู้กำหนด allowlist ของโมเดล' : 'The server enforces the model allowlist.'}</p></div><div><label className="mb-1 flex items-center gap-1.5 text-sm font-medium"><Sliders className="h-4 w-4" />Temperature: {config.temperature}</label><input type="range" min="0" max="1" step="0.1" value={config.temperature} onChange={(e) => setConfig({ ...config, temperature: Number(e.target.value) })} className="w-full" /></div></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={reset}><RefreshCw className="mr-1.5 h-4 w-4" />{isThai ? 'ค่า AI เริ่มต้น' : 'AI defaults'}</Button><Button variant="primary" size="sm" onClick={save}><CheckCircle2 className="mr-1.5 h-4 w-4" />{isThai ? 'บันทึก' : 'Save'}</Button></div>
    </CardBody></Card>

    {/* Firebase Cloud Messaging (FCM) Widget */}
    <FcmNotificationWidget />

    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle>{isThai ? 'Google Workspace Gmail' : 'Google Workspace Gmail'}</CardTitle>
            <CardDescription>{isThai ? 'เชื่อมต่อ Gmail เพื่อส่งใบเสร็จ รายงานยอดขาย และอีเมลแจ้งเตือน' : 'Connect Gmail to send receipts, reports, and alerts directly'}</CardDescription>
          </div>
          <Badge variant="primary">{isThai ? 'Google Workspace' : 'Google Workspace'}</Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div className="flex items-center justify-between p-4 rounded-xl bg-slate-900/50 border border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-red-500/10 text-red-400">
              <Mail className="w-6 h-6" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">{isThai ? 'บูรณาการ Gmail API' : 'Gmail API Integration'}</h4>
              <p className="text-xs text-slate-400 mt-0.5">{isThai ? 'ส่งอีเมลใบเสร็จ, สรุปกะ, และแจ้งเตือนสต็อกผ่านบัญชี Gmail ของคุณ' : 'Send thermal receipts and end-of-day shift reports using Gmail OAuth.'}</p>
            </div>
          </div>
          <Button variant="primary" size="sm" onClick={() => setIsGmailModalOpen(true)}>
            <Mail className="w-4 h-4 mr-2" />
            {isThai ? 'เปิดใช้งาน Gmail' : 'Open Gmail Integration'}
          </Button>
        </div>
      </CardBody>
    </Card>

    <Card><CardHeader><CardTitle>{isThai ? 'ทดสอบ PRODX AI' : 'Test PRODX AI'}</CardTitle><CardDescription>{isThai ? 'ต้องเข้าสู่ระบบและมีสิทธิ์ ai:use' : 'Requires an authenticated session with the ai:use permission'}</CardDescription></CardHeader><CardBody className="space-y-3"><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className="w-full rounded-lg border px-3 py-2 text-sm" /><Button variant="outline" size="sm" onClick={testConnection} disabled={testing}><Send className="mr-1.5 h-4 w-4" />{testing ? (isThai ? 'กำลังทดสอบ...' : 'Testing...') : (isThai ? 'ทดสอบ AI Gateway' : 'Test AI Gateway')}</Button>{response && <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900">{response}</pre>}</CardBody></Card>

    <GmailIntegrationModal isOpen={isGmailModalOpen} onClose={() => setIsGmailModalOpen(false)} />
  </div>;
};


