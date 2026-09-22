import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { createAuditApi } from '../../adapters/auditApiFactory';
import { AuditLogEntry } from '../../domain/audit';
import { Card } from '../../components/common/Card';
import { Badge } from '../../components/common/Badge';
import { Button } from '../../components/common/Button';
import { SearchInput } from '../../components/common/SearchInput';
import { Tabs } from '../../components/common/Tabs';
import { Modal } from '../../components/common/Modal';
import { Shield, RefreshCw, AlertTriangle, AlertOctagon, CheckCircle, Terminal, Copy, Check } from 'lucide-react';

export const AuditScreen: React.FC = () => {
  const { session } = useAuth();
  const auditApi = session ? createAuditApi(session.token) : null;
  const { t, language } = useLanguage();
  const [logs, setLogs] = useState<readonly AuditLogEntry[]>([]);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<'all' | 'critical' | 'warn' | 'info'>('all');
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const fetchLogs = async () => {
    if (!session) return;
    setIsLoading(true);
    try {
      const data = await auditApi!.getLogs(session.currentStore.id, 50);
      setLogs(data);
    } catch (err) {
      console.error('[AuditScreen] Error fetching audit logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [session, auditApi]);

  const filtered = logs.filter((l) => {
    const matchesSeverity = severityFilter === 'all' || l.severity === severityFilter;
    const q = search.toLowerCase().trim();
    const matchesSearch =
      !q ||
      l.action.toLowerCase().includes(q) ||
      l.userName.toLowerCase().includes(q) ||
      l.registerId.toLowerCase().includes(q) ||
      JSON.stringify(l.details).toLowerCase().includes(q);

    return matchesSeverity && matchesSearch;
  });

  const criticalCount = logs.filter((l) => l.severity === 'critical').length;
  const warnCount = logs.filter((l) => l.severity === 'warn').length;
  const infoCount = logs.filter((l) => l.severity === 'info' || !l.severity).length;

  const handleCopyJson = (details: Record<string, unknown>) => {
    navigator.clipboard.writeText(JSON.stringify(details, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 bg-background text-text no-scrollbar">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-6 pb-4 sm:pb-6 border-b border-border/50">
        <div>
          <h1 className="text-heading-1 text-text flex items-center gap-2.5">
            <Shield className="h-6 w-6 text-primary" />
            <span>{t.audit.title}</span>
          </h1>
          <p className="text-caption text-text/70 mt-1">
            {t.audit.subtitle}
          </p>
        </div>

        <Button
          variant="secondary"
          size="md"
          onClick={fetchLogs}
          isLoading={isLoading}
          leftIcon={<RefreshCw className="h-4 w-4" />}
        >
          {t.audit.refreshLogs}
        </Button>
      </div>

      {/* Audit KPI Overview Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{language === 'th' ? 'บันทึกเหตุการณ์ทั้งหมด' : 'Total Audit Logs'}</span>
            <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
              <Shield className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tracking-tight text-text">
            {logs.length} <span className="text-xs font-sans font-medium text-text/60">{language === 'th' ? 'รายการ' : 'events'}</span>
          </div>
          <div className="mt-1.5 text-[11px] text-text/60">
            {language === 'th' ? 'เก็บบันทึกระบบความปลอดภัย' : 'Security audit trail'}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{language === 'th' ? 'วิกฤต (Critical)' : 'Critical Events'}</span>
            <div className={`p-1.5 rounded-lg ${criticalCount > 0 ? 'bg-rose-500/15 text-rose-500' : 'bg-text/5 text-text/40'}`}>
              <AlertOctagon className="h-4 w-4" />
            </div>
          </div>
          <div className={`mt-2 text-2xl font-black font-mono tracking-tight ${criticalCount > 0 ? 'text-rose-500' : 'text-text'}`}>
            {criticalCount} <span className="text-xs font-sans font-medium text-text/60">{language === 'th' ? 'รายการ' : 'critical'}</span>
          </div>
          <div className="mt-1.5 text-[11px] text-text/60">
            {criticalCount > 0 ? (language === 'th' ? 'ต้องการการตรวจสอบทันที' : 'Immediate attention') : (language === 'th' ? 'ไม่มีการละเมิดความปลอดภัย' : 'No critical alerts')}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{language === 'th' ? 'แจ้งเตือน (Warnings)' : 'Warnings'}</span>
            <div className={`p-1.5 rounded-lg ${warnCount > 0 ? 'bg-amber-500/15 text-amber-500' : 'bg-text/5 text-text/40'}`}>
              <AlertTriangle className="h-4 w-4" />
            </div>
          </div>
          <div className={`mt-2 text-2xl font-black font-mono tracking-tight ${warnCount > 0 ? 'text-amber-500' : 'text-text'}`}>
            {warnCount} <span className="text-xs font-sans font-medium text-text/60">{language === 'th' ? 'รายการ' : 'warnings'}</span>
          </div>
          <div className="mt-1.5 text-[11px] text-text/60">
            {language === 'th' ? 'เหตุการณ์แจ้งเตือนทั่วไป' : 'Operational warnings'}
          </div>
        </div>

        <div className="p-4 rounded-xl border border-border border-crisp bg-card shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs font-semibold text-text/60 uppercase tracking-wider">
            <span>{language === 'th' ? 'ข้อมูลปกติ (Info)' : 'Routine Logs'}</span>
            <div className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-black font-mono tracking-tight text-emerald-600 dark:text-emerald-400">
            {infoCount} <span className="text-xs font-sans font-medium text-text/60">{language === 'th' ? 'รายการ' : 'routine'}</span>
          </div>
          <div className="mt-1.5 text-[11px] text-text/60">
            {language === 'th' ? 'การล็อกอินและคำสั่งซื้อปกติ' : 'Standard app operations'}
          </div>
        </div>
      </div>

      {/* Search & Severity Filter Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex-1 max-w-md">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch('')}
            placeholder={t.audit.filterPlaceholder}
          />
        </div>

        <div className="overflow-x-auto no-scrollbar py-0.5">
          <Tabs
            tabs={[
              { id: 'all', label: language === 'th' ? 'ทั้งหมด' : 'All Events' },
              { id: 'critical', label: language === 'th' ? 'วิกฤต (Critical)' : 'Critical' },
              { id: 'warn', label: language === 'th' ? 'แจ้งเตือน (Warn)' : 'Warnings' },
              { id: 'info', label: language === 'th' ? 'ปกติ (Info)' : 'Info' },
            ]}
            activeTab={severityFilter}
            onChange={(tab) => setSeverityFilter(tab as any)}
          />
        </div>
      </div>

      {/* Master Table and Side Inspector */}
      <div className="flex flex-col lg:flex-row gap-6 items-start flex-1 min-h-0">
        <div className={`flex flex-col gap-4 min-h-0 transition-all duration-200 ${selectedLog ? 'w-full lg:w-[60%]' : 'w-full'}`}>
          <Card className="bg-card border-border border-crisp rounded-xl shadow-2xs flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="w-full overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full text-left text-xs border-collapse min-w-[620px]">
                <thead>
                  <tr className="border-b border-border text-text/70 bg-card font-semibold">
                    <th className="py-3.5 px-5">{t.audit.timestamp}</th>
                    <th className="py-3.5 px-4">{t.audit.action}</th>
                    <th className="py-3.5 px-4">{t.audit.user}</th>
                    <th className="py-3.5 px-4">{t.audit.severity}</th>
                    <th className="py-3.5 px-4">{t.audit.terminal}</th>
                    <th className="py-3.5 px-5">{t.audit.details}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border font-mono">
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-text/50 font-sans">
                        <Shield className="h-8 w-8 mx-auto text-text/30 mb-2" />
                        <p className="text-xs font-semibold text-text">
                          {language === 'th' ? 'ไม่พบบันทึกเหตุการณ์' : 'No audit entries match filter'}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    filtered.map((log) => {
                      const isSelected = selectedLog?.id === log.id;
                      return (
                        <tr
                          key={log.id}
                          onClick={() => setSelectedLog(log)}
                          className={`odd:bg-card even:bg-background/30 hover:bg-primary/5 cursor-pointer transition-colors ${
                            isSelected ? 'bg-primary/10 border-l-4 border-primary font-semibold' : ''
                          }`}
                        >
                          <td className="py-3 px-5 text-text/70 whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </td>
                          <td className="py-3 px-4 font-bold text-text">
                            {log.action}
                          </td>
                          <td className="py-3 px-4 font-sans font-medium text-text">
                            {log.userName}
                          </td>
                          <td className="py-3 px-4 font-sans">
                            <Badge
                              variant={
                                log.severity === 'critical'
                                  ? 'danger'
                                  : log.severity === 'warn'
                                  ? 'warning'
                                  : 'neutral'
                              }
                              size="sm"
                              dot
                            >
                              {log.severity}
                            </Badge>
                          </td>
                          <td className="py-3 px-4 text-text/70 font-mono">{log.registerId}</td>
                          <td className="py-3 px-5 font-mono text-[11px] text-text/70 truncate max-w-xs">
                            {JSON.stringify(log.details)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Selected Log Inspector Panel (Desktop) */}
        {selectedLog && (
          <div className="hidden lg:flex w-full lg:w-[40%] flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-sm sticky top-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-bold text-text">
                  {language === 'th' ? 'การตรวจสอบบันทึกเชิงลึก' : 'Audit Log Inspector'}
                </h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedLog(null)}
                className="h-8 px-2 text-text/50 hover:text-text"
              >
                ✕
              </Button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-text/60 font-sans">{language === 'th' ? 'ระดับความรุนแรง:' : 'Severity:'}</span>
                <Badge
                  variant={
                    selectedLog.severity === 'critical'
                      ? 'danger'
                      : selectedLog.severity === 'warn'
                      ? 'warning'
                      : 'neutral'
                  }
                  size="sm"
                >
                  {selectedLog.severity.toUpperCase()}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-text/60 font-sans">{t.audit.action}:</span>
                <span className="font-bold font-mono text-text">{selectedLog.action}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-text/60 font-sans">{t.audit.user}:</span>
                <span className="font-medium font-sans text-text">{selectedLog.userName}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-text/60 font-sans">{t.audit.terminal}:</span>
                <span className="font-mono text-text">{selectedLog.registerId}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-text/60 font-sans">{t.audit.timestamp}:</span>
                <span className="font-mono text-text/80">{new Date(selectedLog.timestamp).toLocaleString()}</span>
              </div>
            </div>

            <div className="pt-3 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-text">
                  {language === 'th' ? 'ข้อมูลเพย์โหลด (Payload JSON):' : 'Payload Details (JSON):'}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleCopyJson(selectedLog.details)}
                  leftIcon={copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3 text-text/50" />}
                  className="h-7 text-[11px] px-2"
                >
                  {copied ? (language === 'th' ? 'คัดลอกแล้ว' : 'Copied') : (language === 'th' ? 'คัดลอก' : 'Copy JSON')}
                </Button>
              </div>
              <pre className="p-3 rounded-lg bg-background border border-border text-[11px] font-mono text-text overflow-x-auto max-h-64 no-scrollbar">
                {JSON.stringify(selectedLog.details, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Selected Log Inspector Modal for Mobile */}
      {selectedLog && (
        <div className="block lg:hidden">
          <Modal
            isOpen={Boolean(selectedLog)}
            onClose={() => setSelectedLog(null)}
            title={language === 'th' ? `รายละเอียดเหตุการณ์: ${selectedLog.action}` : `Audit Details: ${selectedLog.action}`}
            maxWidth="md"
            footer={
              <div className="flex justify-end w-full">
                <Button variant="secondary" size="md" onClick={() => setSelectedLog(null)}>
                  {language === 'th' ? 'ปิด' : 'Close'}
                </Button>
              </div>
            }
          >
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-border">
                <span className="text-text/60">{t.audit.severity}:</span>
                <Badge
                  variant={
                    selectedLog.severity === 'critical'
                      ? 'danger'
                      : selectedLog.severity === 'warn'
                      ? 'warning'
                      : 'neutral'
                  }
                  size="sm"
                >
                  {selectedLog.severity.toUpperCase()}
                </Badge>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-border">
                <span className="text-text/60">{t.audit.user}:</span>
                <span className="font-semibold text-text">{selectedLog.userName}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-border">
                <span className="text-text/60">{t.audit.terminal}:</span>
                <span className="font-mono text-text">{selectedLog.registerId}</span>
              </div>
              <div className="flex items-center justify-between pb-2 border-b border-border">
                <span className="text-text/60">{t.audit.timestamp}:</span>
                <span className="font-mono text-text">{new Date(selectedLog.timestamp).toLocaleString()}</span>
              </div>
              <div className="pt-2">
                <span className="block font-semibold mb-1 text-text">Payload:</span>
                <pre className="p-3 rounded-lg bg-background border border-border text-[11px] font-mono text-text overflow-x-auto max-h-56 no-scrollbar">
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              </div>
            </div>
          </Modal>
        </div>
      )}
    </div>
  );
};
