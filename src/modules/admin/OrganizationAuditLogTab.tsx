import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  Filter,
  Layers,
  Monitor,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Store,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { OrganizationAuditLog } from '../settings/types';
import { subscribeToAuditLogs } from '../../services/organizationService';
import { Button } from '../../components/common/Button';

export interface OrganizationAuditLogTabProps {
  initialOrgId?: string;
  compact?: boolean;
}

export const OrganizationAuditLogTab: React.FC<OrganizationAuditLogTabProps> = ({
  initialOrgId,
  compact = false,
}) => {
  const { language } = useLanguage();
  const { addToast } = useToast();
  const isThai = language === 'th';

  const [logs, setLogs] = useState<OrganizationAuditLog[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [entityFilter, setEntityFilter] = useState<'all' | 'organization' | 'branch' | 'terminal'>('all');
  const [actionFilter, setActionFilter] = useState<'all' | 'create' | 'update' | 'delete' | 'cascade_delete'>('all');
  const [selectedLog, setSelectedLog] = useState<OrganizationAuditLog | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Subscribe to real-time audit logs from Firestore
  useEffect(() => {
    setIsLoading(true);
    const unsubscribe = subscribeToAuditLogs(
      (newLogs) => {
        setLogs(newLogs);
        setIsLoading(false);
      },
      {
        orgId: initialOrgId,
        limitCount: 150,
        onError: (err) => {
          console.warn('[AuditLogTab] Firestore listener error:', err);
          setIsLoading(false);
        },
      },
    );

    return () => {
      unsubscribe();
    };
  }, [initialOrgId]);

  // Filter logs by search, entity, and action
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (entityFilter !== 'all' && log.entityType !== entityFilter) return false;
      if (actionFilter !== 'all' && log.action !== actionFilter) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const matchName = log.entityName?.toLowerCase().includes(q) ?? false;
      const matchId = log.entityId.toLowerCase().includes(q);
      const matchActor = log.actor?.name?.toLowerCase().includes(q) ?? false;
      const matchActorEmail = log.actor?.email?.toLowerCase().includes(q) ?? false;
      const matchDetails = JSON.stringify(log.details || {}).toLowerCase().includes(q);

      return matchName || matchId || matchActor || matchActorEmail || matchDetails;
    });
  }, [logs, entityFilter, actionFilter, searchQuery]);

  // Metric counts
  const totalCount = logs.length;
  const createCount = logs.filter((l) => l.action === 'create').length;
  const updateCount = logs.filter((l) => l.action === 'update').length;
  const deleteCount = logs.filter((l) => l.action === 'delete' || l.action === 'cascade_delete').length;

  const copyJson = (data: unknown) => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopied(true);
    addToast({
      title: isThai ? 'คัดลอก JSON สำเร็จ' : 'Copied JSON',
      message: isThai ? 'คัดลอกรายละเอียดลงในคลิปบอร์ดแล้ว' : 'Audit entry payload copied to clipboard.',
      type: 'info',
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const formatTimestamp = (ts: number) => {
    if (!ts) return '-';
    const date = new Date(ts);
    return date.toLocaleString(isThai ? 'th-TH' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getEntityIcon = (type: 'organization' | 'branch' | 'terminal') => {
    switch (type) {
      case 'organization':
        return <Building2 className="h-4 w-4 text-[#ff6b1a]" />;
      case 'branch':
        return <Store className="h-4 w-4 text-emerald-600" />;
      case 'terminal':
        return <Monitor className="h-4 w-4 text-blue-600" />;
      default:
        return <Layers className="h-4 w-4 text-slate-500" />;
    }
  };

  const getActionBadge = (action: 'create' | 'update' | 'delete' | 'cascade_delete') => {
    switch (action) {
      case 'create':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-emerald-100 text-emerald-800 border border-emerald-200">
            <CheckCircle2 className="h-3 w-3" />
            CREATE
          </span>
        );
      case 'update':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-amber-100 text-amber-800 border border-amber-200">
            <RefreshCw className="h-3 w-3" />
            UPDATE
          </span>
        );
      case 'delete':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-rose-100 text-rose-800 border border-rose-200">
            <Trash2 className="h-3 w-3" />
            DELETE
          </span>
        );
      case 'cascade_delete':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase bg-purple-100 text-purple-800 border border-purple-200">
            <ShieldAlert className="h-3 w-3" />
            CASCADE DELETE
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-slate-100 text-slate-800">
            {action}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Header Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-[11px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
              {isThai ? 'เรียลไทม์ (Firestore onSnapshot)' : 'Live Real-time onSnapshot'}
            </span>
          </div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight mt-1 flex items-center gap-2.5">
            <Shield className="h-6 w-6 text-purple-600" />
            {isThai ? 'บันทึกประวัติการเปลี่ยนแปลง (Organization Audit Logs)' : 'Organization & Multi-Store Audit Trail'}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {isThai
              ? 'ตรวจสอบประวัติการทำ CRUD ทั้งหมดบนองค์กร สาขา และเครื่องขาย POS จากคอลเลกชัน audit_logs แบบทันที'
              : 'Immutable real-time audit logs of all create, update, delete, and cascade operations on organizations, branches, and terminals.'}
          </p>
        </div>

        {/* Real-time Status Badge */}
        <div className="flex items-center gap-2 self-start md:self-auto">
          <div className="text-right">
            <div className="text-[11px] font-bold text-slate-500">
              {isThai ? 'บันทึกทั้งหมด' : 'Total Entries'}
            </div>
            <div className="text-lg font-black text-slate-900 font-mono">{totalCount}</div>
          </div>
        </div>
      </div>

      {/* KPI Stats Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase">
            <span>{isThai ? 'บันทึกทั้งหมด' : 'All Events'}</span>
            <ShieldCheck className="h-4 w-4 text-purple-600" />
          </div>
          <div className="mt-2 text-2xl font-black font-mono text-slate-900">{totalCount}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold text-emerald-600 uppercase">
            <span>{isThai ? 'สร้างใหม่ (Create)' : 'Created'}</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-black font-mono text-emerald-700">{createCount}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold text-amber-600 uppercase">
            <span>{isThai ? 'แก้ไขข้อมูล (Update)' : 'Updated'}</span>
            <RefreshCw className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-2 text-2xl font-black font-mono text-amber-700">{updateCount}</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold text-rose-600 uppercase">
            <span>{isThai ? 'ลบข้อมูล (Delete)' : 'Deleted'}</span>
            <Trash2 className="h-4 w-4 text-rose-600" />
          </div>
          <div className="mt-2 text-2xl font-black font-mono text-rose-700">{deleteCount}</div>
        </div>
      </div>

      {/* Controls & Filter Strip */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-2xs space-y-3">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Universal Search */}
          <div className="relative w-full md:w-80">
            <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={isThai ? 'ค้นหาชื่อ ID ผู้ทำรายการ หรือ JSON...' : 'Search name, ID, actor, or details...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:border-purple-600 text-slate-900"
            />
          </div>

          {/* Entity Filters */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-black uppercase text-slate-400 mr-1">
              {isThai ? 'ประเภท:' : 'Entity:'}
            </span>
            <button
              type="button"
              onClick={() => setEntityFilter('all')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                entityFilter === 'all'
                  ? 'bg-purple-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {isThai ? 'ทั้งหมด' : 'All'}
            </button>
            <button
              type="button"
              onClick={() => setEntityFilter('organization')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                entityFilter === 'organization'
                  ? 'bg-[#ff6b1a] text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Building2 className="h-3 w-3" />
              {isThai ? 'องค์กร' : 'Org'}
            </button>
            <button
              type="button"
              onClick={() => setEntityFilter('branch')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                entityFilter === 'branch'
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Store className="h-3 w-3" />
              {isThai ? 'สาขา' : 'Branch'}
            </button>
            <button
              type="button"
              onClick={() => setEntityFilter('terminal')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                entityFilter === 'terminal'
                  ? 'bg-blue-600 text-white shadow-2xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              <Monitor className="h-3 w-3" />
              {isThai ? 'เครื่องขาย' : 'Terminal'}
            </button>
          </div>

          {/* Action Filters */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-black uppercase text-slate-400 mr-1">
              {isThai ? 'คำสั่ง:' : 'Action:'}
            </span>
            <button
              type="button"
              onClick={() => setActionFilter('all')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                actionFilter === 'all'
                  ? 'bg-slate-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {isThai ? 'ทั้งหมด' : 'All'}
            </button>
            <button
              type="button"
              onClick={() => setActionFilter('create')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                actionFilter === 'create'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              CREATE
            </button>
            <button
              type="button"
              onClick={() => setActionFilter('update')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                actionFilter === 'update'
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              UPDATE
            </button>
            <button
              type="button"
              onClick={() => setActionFilter('delete')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${
                actionFilter === 'delete'
                  ? 'bg-rose-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              DELETE
            </button>
          </div>
        </div>
      </div>

      {/* Logs Table / Card List */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-400">
            <RefreshCw className="h-8 w-8 mx-auto animate-spin text-purple-600 mb-2" />
            <p className="text-xs font-bold">
              {isThai ? 'กำลังเชื่อมต่อและดึงข้อมูล Audit Logs จาก Firestore...' : 'Connecting to Firestore audit_logs collection...'}
            </p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Shield className="h-10 w-10 mx-auto text-slate-300 mb-2" />
            <p className="text-sm font-bold text-slate-700">
              {isThai ? 'ไม่พบบันทึกประวัติ CRUD ที่ตรงกับเงื่อนไข' : 'No matching CRUD audit logs found.'}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              {isThai
                ? 'เมื่อมีการสร้าง แก้ไข หรือลบองค์กร สาขา หรือเครื่องขาย บันทึกจะแสดงที่นี่แบบ Real-time ทันที'
                : 'Any create, update, or delete operations on organizations, branches, or terminals will stream here in real-time.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 font-black border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">{isThai ? 'เวลา' : 'Timestamp'}</th>
                  <th className="py-3 px-4">{isThai ? 'คำสั่ง' : 'Action'}</th>
                  <th className="py-3 px-4">{isThai ? 'ประเภท' : 'Entity'}</th>
                  <th className="py-3 px-4">{isThai ? 'เป้าหมาย / รายละเอียด' : 'Target & Name'}</th>
                  <th className="py-3 px-4">{isThai ? 'ผู้ดำเนินการ' : 'Actor'}</th>
                  <th className="py-3 px-4 text-right">{isThai ? 'การกระทำ' : 'Actions'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-sans">
                {filteredLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="hover:bg-slate-50/80 transition-colors group cursor-pointer"
                    onClick={() => setSelectedLog(log)}
                  >
                    <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px] text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        {formatTimestamp(log.timestamp)}
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      {getActionBadge(log.action)}
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5 font-bold capitalize text-slate-900">
                        {getEntityIcon(log.entityType)}
                        {log.entityType}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div>
                        <div className="font-bold text-slate-900">
                          {log.entityName || log.entityId}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          id: {log.entityId} {log.orgId ? `· org: ${log.orgId}` : ''}
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <div className="h-6 w-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center font-black text-[10px]">
                          {(log.actor?.name || 'A').charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <div className="font-bold text-slate-800 text-[11px]">
                            {log.actor?.name || 'Admin'}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {log.actor?.role || 'admin'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedLog(log);
                        }}
                        className="px-2.5 py-1 text-[11px] font-bold text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors flex items-center gap-1 ml-auto"
                      >
                        <Eye className="h-3 w-3" />
                        {isThai ? 'ดูข้อมูล' : 'Details'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Log Detail Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-xl border border-slate-200 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
                  <Shield className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base">
                    {isThai ? 'รายละเอียดบันทึกการดำเนินการ' : 'Audit Entry Details'}
                  </h3>
                  <p className="text-xs font-mono text-slate-400">ID: {selectedLog.id}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="py-4 space-y-4 overflow-y-auto flex-1 text-xs">
              {/* Primary metadata grid */}
              <div className="grid grid-cols-2 gap-3 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block">
                    {isThai ? 'ประเภท' : 'Entity Type'}
                  </span>
                  <div className="font-bold text-slate-800 capitalize flex items-center gap-1.5 mt-0.5">
                    {getEntityIcon(selectedLog.entityType)}
                    {selectedLog.entityType}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block">
                    {isThai ? 'คำสั่ง' : 'Action'}
                  </span>
                  <div className="mt-0.5">{getActionBadge(selectedLog.action)}</div>
                </div>

                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block">
                    {isThai ? 'ชื่อเป้าหมาย' : 'Target Entity Name'}
                  </span>
                  <div className="font-bold text-slate-800 mt-0.5">{selectedLog.entityName || '-'}</div>
                </div>

                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block">
                    {isThai ? 'รหัสเป้าหมาย' : 'Entity ID'}
                  </span>
                  <div className="font-mono text-slate-800 mt-0.5">{selectedLog.entityId}</div>
                </div>

                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block">
                    {isThai ? 'วันเวลาบันทึก' : 'Timestamp'}
                  </span>
                  <div className="font-mono text-slate-800 mt-0.5">
                    {formatTimestamp(selectedLog.timestamp)}
                  </div>
                </div>

                <div>
                  <span className="text-[10px] font-black uppercase text-slate-400 block">
                    {isThai ? 'ผู้ดำเนินการ' : 'Operator / Actor'}
                  </span>
                  <div className="font-bold text-slate-800 mt-0.5">
                    {selectedLog.actor?.name || 'Admin'} ({selectedLog.actor?.role || 'admin'})
                  </div>
                </div>
              </div>

              {/* Payload JSON View */}
              <div>
                <div className="flex items-center justify-between pb-1.5">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-600">
                    {isThai ? 'ข้อมูล Payload และการเปลี่ยนแปลง (JSON)' : 'Raw Audit Payload & State Diffs'}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyJson(selectedLog)}
                    className="flex items-center gap-1 text-[11px] py-1 h-7"
                  >
                    {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                    {copied ? (isThai ? 'คัดลอกแล้ว' : 'Copied') : isThai ? 'คัดลอก JSON' : 'Copy JSON'}
                  </Button>
                </div>
                <pre className="p-3 bg-slate-950 text-emerald-400 rounded-xl font-mono text-[11px] overflow-x-auto max-h-60 leading-relaxed">
                  {JSON.stringify(selectedLog, null, 2)}
                </pre>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <Button size="sm" onClick={() => setSelectedLog(null)}>
                {isThai ? 'ปิด' : 'Close'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
