import React, { useState } from 'react';
import { Bot, CheckCircle2, RefreshCw, Send, ShieldCheck, Sliders } from 'lucide-react';
import { Card, CardHeader, CardBody, CardTitle, CardDescription } from '../../../components/common/Card';
import { Button } from '../../../components/common/Button';
import { Badge } from '../../../components/common/Badge';
import { useToast } from '../../../context/ToastContext';
import { useLanguage } from '../../../context/LanguageContext';
import { aiService, AiConfig, DEFAULT_AI_CONFIG, AI_BACKEND_CHAT_PATH } from '../../../services/aiService';

export const AiAssistantSettingsTab: React.FC = () => {
  const { addToast } = useToast();
  const { language } = useLanguage();
  const isThai = language === 'th';
  const [config, setConfig] = useState<AiConfig>(() => aiService.getConfig());
  const [prompt, setPrompt] = useState(isThai ? 'สรุปแนวโน้มยอดขายของร้านแบบสั้นๆ' : 'Summarize the store sales trend briefly.');
  const [response, setResponse] = useState('');
  const [testing, setTesting] = useState(false);
  const save = () => { aiService.saveConfig(config); addToast({ title: isThai ? 'บันทึกสำเร็จ' : 'Saved', message: isThai ? 'บันทึกการตั้งค่าผู้ช่วย AI แล้ว' : 'AI assistant settings saved.', type: 'success' }); };
  const reset = () => { setConfig(DEFAULT_AI_CONFIG); aiService.saveConfig(DEFAULT_AI_CONFIG); addToast({ title: isThai ? 'รีเซ็ตแล้ว' : 'Reset', message: isThai ? 'คืนค่าเริ่มต้นแล้ว' : 'Defaults restored.', type: 'info' }); };
  const testConnection = async () => {
    setTesting(true); setResponse('');
    try {
      const result = await aiService.chatCompletion([{ role: 'system', content: 'You are a helpful assistant for a retail POS system.' }, { role: 'user', content: prompt }], config);
      setResponse(result); addToast({ title: isThai ? 'เชื่อมต่อสำเร็จ' : 'Connected', message: isThai ? 'Backend AI ตอบกลับสำเร็จ' : 'Backend AI responded successfully.', type: 'success' });
    } catch (error) {
      setResponse(error instanceof Error ? error.message : String(error)); addToast({ title: isThai ? 'เชื่อมต่อล้มเหลว' : 'Connection failed', message: error instanceof Error ? error.message : String(error), type: 'error' });
    } finally { setTesting(false); }
  };
  return <div className="space-y-6">
    <Card><CardHeader><div className="flex items-center justify-between gap-4"><div><CardTitle>{isThai ? 'ผู้ช่วย AI' : 'AI Assistant'}</CardTitle><CardDescription>{isThai ? 'เรียกผ่าน backend ที่ยืนยันตัวตนแล้วเท่านั้น' : 'Served only through the authenticated backend'}</CardDescription></div><Badge variant="success">{isThai ? 'Backend-managed' : 'Backend-managed'}</Badge></div></CardHeader><CardBody className="space-y-4">
      <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <div>
          <p className="font-medium">{isThai ? 'ไม่มีการเก็บ API key ในเบราว์เซอร์' : 'No API key is stored in the browser'}</p>
          <p className="mt-0.5 opacity-80">{isThai ? `คำขอทั้งหมดถูกส่งไปที่ ${AI_BACKEND_CHAT_PATH} โดยใช้ session ปัจจุบัน เซิร์ฟเวอร์เป็นผู้ถือ credential ของผู้ให้บริการ ตรวจสิทธิ์ ai:use จำกัดขอบเขตร้าน และบันทึก audit log` : `All requests go to ${AI_BACKEND_CHAT_PATH} with your current session. The server holds the provider credential, enforces the ai:use permission, applies store scoping, and writes audit logs.`}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><div><label className="mb-1 flex items-center gap-1.5 text-sm font-medium"><Bot className="h-4 w-4" />{isThai ? 'โมเดลที่ร้องขอ' : 'Requested model'}</label><input value={config.model} readOnly className="w-full rounded-lg border px-3 py-2 font-mono text-sm bg-slate-50 dark:bg-slate-900" /><p className="mt-1 text-xs opacity-70">{isThai ? 'ระบบใช้ Google Gemini เท่านั้น' : 'PRODX uses Google Gemini only.'}</p></div><div><label className="mb-1 flex items-center gap-1.5 text-sm font-medium"><Sliders className="h-4 w-4" />Temperature: {config.temperature}</label><input type="range" min="0" max="1" step="0.1" value={config.temperature} onChange={(e) => setConfig({ ...config, temperature: Number(e.target.value) })} className="w-full" /></div></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={reset}><RefreshCw className="mr-1.5 h-4 w-4" />{isThai ? 'ค่าเริ่มต้น' : 'Defaults'}</Button><Button variant="primary" size="sm" onClick={save}><CheckCircle2 className="mr-1.5 h-4 w-4" />{isThai ? 'บันทึก' : 'Save'}</Button></div>
    </CardBody></Card>
    <Card><CardHeader><CardTitle>{isThai ? 'ทดสอบผู้ช่วย AI' : 'Test AI assistant'}</CardTitle><CardDescription>{isThai ? 'ต้องเข้าสู่ระบบและมีสิทธิ์ ai:use' : 'Requires an authenticated session with the ai:use permission'}</CardDescription></CardHeader><CardBody className="space-y-3"><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className="w-full rounded-lg border px-3 py-2 text-sm" /><Button variant="outline" size="sm" onClick={testConnection} disabled={testing}><Send className="mr-1.5 h-4 w-4" />{testing ? (isThai ? 'กำลังทดสอบ...' : 'Testing...') : (isThai ? 'ทดสอบการเชื่อมต่อ' : 'Test connection')}</Button>{response && <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900">{response}</pre>}</CardBody></Card>
  </div>;
};
