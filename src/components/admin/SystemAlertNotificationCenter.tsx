import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  CheckCircle2,
  Printer,
  RefreshCw,
  RotateCcw,
  Scan,
  ShieldAlert,
  Volume2,
  VolumeX,
  Wrench,
  Zap,
  Banknote,
  CreditCard,
  Radio,
  Check,
  Clock,
  WifiOff,
} from 'lucide-react';
import { HardwarePeripheralStatus } from '../../types/hardware';
import { useToast } from '../../context/ToastContext';
import { triggerHaptic } from '../../services/hapticService';

export interface SystemHardwareAlertItem {
  id: string;
  peripheralId: string;
  deviceName: string;
  category: 'printer' | 'scanner' | 'drawer' | 'edc' | 'display' | 'scale' | 'system';
  port: string;
  interfaceType: string;
  locationTag: string;
  severity: 'critical' | 'error';
  errorTitle: string;
  errorDetail: string;
  recommendedAction: string;
  detectedAt: string;
  errorCountToday: number;
  peripheral?: HardwarePeripheralStatus;
}

export interface SystemAlertNotificationCenterProps {
  peripherals: HardwarePeripheralStatus[];
  getPeripheralPulseState: (peripheral: HardwarePeripheralStatus) => 'idle' | 'active' | 'error';
  onAutoReconnect: (peripheral: HardwarePeripheralStatus) => void;
  onRemoteReboot: (peripheral: HardwarePeripheralStatus) => void;
  onRunDiagnostics: (peripheral: HardwarePeripheralStatus) => void;
  onClearError: (peripheralId: string) => void;
  onSimulateDeviceError: (peripheralId?: string) => void;
  onSimulateDeviceOffline?: (peripheralId?: string) => void;
  onSelfHealAll: () => void;
  reconnectingPeripheralId: string | null;
  rebootingPeripheralId: string | null;
  diagnosingPeripheralId: string | null;
  healingAll: boolean;
}

/**
 * Synthesizes an urgent, unmistakable multi-tone hardware error acoustic alarm
 * using the browser's native Web Audio API (zero external audio files required).
 */
export function playHardwareErrorSiren(pattern: 'critical' | 'test' = 'critical'): void {
  triggerHaptic('error');
  try {
    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();

    const playPulse = (
      freqStart: number,
      freqEnd: number,
      startOffset: number,
      duration: number,
      volume: number,
      waveType: OscillatorType = 'sawtooth',
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = waveType;
      osc.frequency.setValueAtTime(freqStart, ctx.currentTime + startOffset);
      osc.frequency.linearRampToValueAtTime(freqEnd, ctx.currentTime + startOffset + duration);

      gain.gain.setValueAtTime(0.001, ctx.currentTime + startOffset);
      gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + startOffset);
      osc.stop(ctx.currentTime + startOffset + duration + 0.03);
    };

    if (pattern === 'critical') {
      // Urgent 3-pulse hardware error siren (880Hz -> 659Hz -> 987Hz)
      playPulse(880, 659.25, 0, 0.16, 0.2, 'sawtooth');
      playPulse(880, 659.25, 0.2, 0.16, 0.2, 'sawtooth');
      playPulse(987.77, 587.33, 0.4, 0.28, 0.24, 'sawtooth');
    } else {
      // Test alert double chime
      playPulse(783.99, 659.25, 0, 0.14, 0.16, 'triangle');
      playPulse(987.77, 783.99, 0.18, 0.22, 0.18, 'triangle');
    }
  } catch (err) {
    console.warn('[SystemAlertNotification] Web Audio API playback blocked or unsupported:', err);
  }
}

export const SystemAlertNotificationCenter: React.FC<SystemAlertNotificationCenterProps> = ({
  peripherals,
  getPeripheralPulseState,
  onAutoReconnect,
  onRemoteReboot,
  onRunDiagnostics,
  onClearError,
  onSimulateDeviceError,
  onSimulateDeviceOffline,
  onSelfHealAll,
  reconnectingPeripheralId,
  rebootingPeripheralId,
  diagnosingPeripheralId,
  healingAll,
}) => {
  const { addToast } = useToast();

  const [audioAlertEnabled, setAudioAlertEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('prodx_infra_alert_sound');
    return saved !== null ? saved === 'true' : true;
  });
  const [repeatAlarmEnabled, setRepeatAlarmEnabled] = useState<boolean>(true);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());
  const [alertHistory, setAlertHistory] = useState<
    Array<{
      id: string;
      deviceName: string;
      port: string;
      message: string;
      timestamp: string;
      status: 'ACTIVE_ERROR' | 'ACKNOWLEDGED' | 'RESOLVED';
    }>
  >([]);

  const prevErrorIdsRef = useRef<Set<string>>(new Set());
  const detectedTimestampsRef = useRef<Record<string, string>>({});

  const toggleAudioAlert = () => {
    const next = !audioAlertEnabled;
    setAudioAlertEnabled(next);
    localStorage.setItem('prodx_infra_alert_sound', String(next));
    if (next) {
      playHardwareErrorSiren('test');
    }
    addToast({
      type: 'info',
      title: next ? '🔊 เปิดเสียงแจ้งเตือน System Alert แล้ว' : '🔇 ปิดเสียงแจ้งเตือน System Alert ชั่วคราว',
      message: next
        ? 'ระบบจะส่งเสียงไซเรนเตือนทันทีเมื่อตรวจพบอุปกรณ์ในระบบมีสถานะ Error'
        : 'ระบบจะแสดงเฉพาะแบนเนอร์และข้อความแจ้งเตือนบนหน้าจอโดยไม่ส่งเสียง',
      durationMs: 3500,
    });
  };

  // Build active hardware error list from peripherals
  const activeErrorAlerts = useMemo<SystemHardwareAlertItem[]>(() => {
    return peripherals
      .filter((p) => {
        if (p.isMaintenanceMode) return false;
        const pulseState = getPeripheralPulseState(p);
        return (
          pulseState === 'error' ||
          p.connectivity.state === 'disconnected' ||
          p.driverHealth.status === 'degraded' ||
          p.driverHealth.status === 'patch_required'
        );
      })
      .map((p) => {
        if (!detectedTimestampsRef.current[p.id]) {
          detectedTimestampsRef.current[p.id] = new Date().toLocaleTimeString('th-TH', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
        }

        const isDisconnected = p.connectivity.state === 'disconnected';
        const isDriverIssue =
          p.driverHealth.status === 'degraded' || p.driverHealth.status === 'patch_required';

        let errorTitle = 'ตรวจพบสถานะ Error บนอุปกรณ์ฮาร์ดแวร์';
        let errorDetail = p.driverHealth.diagnostics || 'การตอบสนองของอุปกรณ์ผิดปกติ ต้องได้รับการตรวจสอบ';
        let recommendedAction = 'กด "วินิจฉัย & ซ่อมแซม" หรือ "รีบูตอุปกรณ์" เพื่อกู้คืนการทำงาน';

        if (isDisconnected) {
          errorTitle = `อุปกรณ์ขาดการเชื่อมต่อ (Disconnected on ${p.port})`;
          errorDetail = `ไม่สามารถติดต่อ ${p.name} ผ่านอินเทอร์เฟซ ${p.connectivity.interface} บนพอร์ต ${p.port} ได้`;
          recommendedAction = 'ตรวจสอบสายเชื่อมต่อ หรือกดปุ่ม "กู้คืนการเชื่อมต่อ (Auto-Reconnect)" ทันที';
        } else if (isDriverIssue) {
          errorTitle = `ไดรเวอร์หรือเฟิร์มแวร์ทำงานผิดปกติ (${p.driverHealth.status.toUpperCase()})`;
          errorDetail = p.driverHealth.diagnostics;
          recommendedAction = 'กด "วินิจฉัย & ซ่อมแซม" เพื่อให้ Antigravity AI รีเซ็ตไดรเวอร์อัตโนมัติ';
        } else if (p.category === 'printer') {
          errorTitle = 'เครื่องพิมพ์ใบเสร็จขัดข้อง (Printer Error State)';
          errorDetail = 'ตรวจพบสัญญาณแจ้งเตือนจากหัวพิมพ์ความร้อน / เซนเซอร์กระดาษ หรือคิวสปูลค้าง';
          recommendedAction = 'ตรวจสอบกระดาษความร้อน หรือสั่ง "รีบูตอุปกรณ์" เพื่อล้างบัฟเฟอร์พิมพ์';
        } else if (p.category === 'scanner') {
          errorTitle = 'เครื่องสแกนบาร์โค้ดขัดข้อง (Scanner Read Error)';
          errorDetail = 'เซนเซอร์รับแสงไม่ตอบสนอง หรือเกิด Timeout ระหว่างส่งข้อมูล HID/Serial';
          recommendedAction = 'กด "กู้คืนการเชื่อมต่อ" หรือ "รีบูตอุปกรณ์" เพื่อรีเซ็ตพอร์ตสแกนเนอร์';
        } else if (p.category === 'drawer') {
          errorTitle = 'ลิ้นชักเก็บเงินขัดข้อง (Cash Drawer Solenoid Error)';
          errorDetail = 'ไมโครสวิตช์รายงานสถานะค้าง หรือสัญญาณ Kick Pulse 24V ไม่ครบวงจร';
          recommendedAction = 'ตรวจสอบสิ่งกีดขวางรางลิ้นชัก และกด "เคลียร์สถานะ Error"';
        }

        return {
          id: `sys-alert-${p.id}`,
          peripheralId: p.id,
          deviceName: p.name,
          category: p.category,
          port: p.port,
          interfaceType: p.connectivity.interface,
          locationTag: p.tags?.[0] || 'Main POS Terminal',
          severity: isDisconnected || isDriverIssue ? 'critical' : 'error',
          errorTitle,
          errorDetail,
          recommendedAction,
          detectedAt: detectedTimestampsRef.current[p.id],
          errorCountToday: Math.max(1, p.telemetryData.errorCountToday),
          peripheral: p,
        };
      });
  }, [peripherals, getPeripheralPulseState]);

  // Detect newly transitioned Error devices -> trigger acoustic siren & toast alert immediately
  useEffect(() => {
    const currentErrorIds = new Set(activeErrorAlerts.map((a) => a.peripheralId));
    const prevErrorIds = prevErrorIdsRef.current;

    const newlyEnteredErrors = activeErrorAlerts.filter((a) => !prevErrorIds.has(a.peripheralId));
    const resolvedErrorIds = Array.from(prevErrorIds).filter((id) => !currentErrorIds.has(id));

    if (newlyEnteredErrors.length > 0) {
      // Un-acknowledge newly failed devices
      setAcknowledgedIds((prev) => {
        const next = new Set(prev);
        newlyEnteredErrors.forEach((item) => next.delete(item.peripheralId));
        return next;
      });

      // Trigger acoustic siren if enabled
      if (audioAlertEnabled) {
        playHardwareErrorSiren('critical');
      }

      // Add to alert log history & dispatch urgent Toast notification
      newlyEnteredErrors.forEach((alertItem) => {
        setAlertHistory((prev) => [
          {
            id: `${alertItem.peripheralId}-${Date.now()}`,
            deviceName: alertItem.deviceName,
            port: alertItem.port,
            message: `${alertItem.errorTitle} — ${alertItem.errorDetail}`,
            timestamp: alertItem.detectedAt,
            status: 'ACTIVE_ERROR',
          },
          ...prev.slice(0, 14),
        ]);

        addToast({
          type: 'error',
          title: `🚨 SYSTEM ALERT: ${alertItem.deviceName} (ERROR)`,
          message: `${alertItem.errorTitle} บนพอร์ต ${alertItem.port} (${alertItem.locationTag}) กรุณาตรวจสอบและแก้ไขทันที`,
          durationMs: 7000,
        });
      });
    }

    if (resolvedErrorIds.length > 0) {
      resolvedErrorIds.forEach((resolvedId) => {
        delete detectedTimestampsRef.current[resolvedId];
      });
      setAlertHistory((prev) =>
        prev.map((entry) =>
          resolvedErrorIds.some((id) => entry.id.startsWith(id))
            ? { ...entry, status: 'RESOLVED' }
            : entry,
        ),
      );
    }

    prevErrorIdsRef.current = currentErrorIds;
  }, [activeErrorAlerts, audioAlertEnabled, addToast]);

  // Periodic acoustic reminder every 15s if there are unacknowledged active error alerts
  const unacknowledgedErrorAlerts = useMemo(
    () => activeErrorAlerts.filter((a) => !acknowledgedIds.has(a.peripheralId)),
    [activeErrorAlerts, acknowledgedIds],
  );

  useEffect(() => {
    if (!audioAlertEnabled || !repeatAlarmEnabled || unacknowledgedErrorAlerts.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      playHardwareErrorSiren('critical');
    }, 15000);

    return () => clearInterval(interval);
  }, [audioAlertEnabled, repeatAlarmEnabled, unacknowledgedErrorAlerts.length]);

  const handleAcknowledgeAlert = (peripheralId: string, deviceName: string) => {
    setAcknowledgedIds((prev) => new Set(prev).add(peripheralId));
    setAlertHistory((prev) =>
      prev.map((entry) =>
        entry.id.startsWith(peripheralId) && entry.status === 'ACTIVE_ERROR'
          ? { ...entry, status: 'ACKNOWLEDGED' }
          : entry,
      ),
    );
    addToast({
      type: 'info',
      title: `รับทราบแจ้งเตือน: ${deviceName}`,
      message: 'ปิดเสียงเตือนซ้ำสำหรับอุปกรณ์นี้แล้ว กรุณาดำเนินการแก้ไขสถานะ Error',
      durationMs: 3000,
    });
  };

  const handleAcknowledgeAll = () => {
    setAcknowledgedIds(new Set(activeErrorAlerts.map((a) => a.peripheralId)));
    setAlertHistory((prev) =>
      prev.map((entry) =>
        entry.status === 'ACTIVE_ERROR' ? { ...entry, status: 'ACKNOWLEDGED' } : entry,
      ),
    );
    addToast({
      type: 'info',
      title: 'รับทราบการแจ้งเตือนทั้งหมดแล้ว',
      message: `ปิดเสียงเตือนซ้ำสำหรับอุปกรณ์ที่เกิด Error ทั้ง ${activeErrorAlerts.length} รายการ`,
      durationMs: 3500,
    });
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'printer':
        return <Printer className="w-5 h-5" />;
      case 'scanner':
        return <Scan className="w-5 h-5" />;
      case 'drawer':
        return <Banknote className="w-5 h-5" />;
      case 'edc':
        return <CreditCard className="w-5 h-5" />;
      default:
        return <Radio className="w-5 h-5" />;
    }
  };

  const hasActiveErrors = activeErrorAlerts.length > 0;

  return (
    <section
      aria-label="System Alert Notification Center"
      className={`rounded-3xl border transition-all duration-300 overflow-hidden shadow-md ${
        hasActiveErrors
          ? 'bg-rose-950/95 border-rose-500/70 text-white shadow-rose-950/30 ring-2 ring-rose-500/40'
          : 'bg-card border-border border-crisp text-text'
      }`}
    >
      {/* Top Control & Status Bar */}
      <div
        className={`px-5 py-4 sm:px-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b ${
          hasActiveErrors
            ? 'border-rose-500/30 bg-gradient-to-r from-rose-950 via-red-950 to-rose-950'
            : 'border-border/60 bg-background/60'
        }`}
      >
        <div className="flex items-start sm:items-center gap-3.5">
          <div
            className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
              hasActiveErrors
                ? 'bg-rose-500/20 border-rose-400/50 text-rose-300 animate-pulse'
                : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-500'
            }`}
          >
            {hasActiveErrors ? (
              <ShieldAlert className="w-6 h-6 text-rose-400" />
            ) : (
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
            )}
          </div>

          <div className="space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`text-[11px] font-mono uppercase font-black tracking-wider ${
                  hasActiveErrors ? 'text-rose-300' : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {hasActiveErrors
                  ? `🚨 SYSTEM ALERT NOTIFICATION • ACTIVE HARDWARE ERROR (${activeErrorAlerts.length})`
                  : 'SYSTEM ALERT NOTIFICATION • REAL-TIME WATCHDOG ARMED'}
              </span>
              <span aria-hidden="true" className="opacity-40">
                ·
              </span>
              <span
                className={`text-xs font-medium ${
                  hasActiveErrors ? 'text-rose-200/90' : 'text-text/60'
                }`}
              >
                {audioAlertEnabled ? 'เปิดเสียงไซเรนแจ้งเตือนอัตโนมัติ' : 'ปิดเสียงเตือนชั่วคราว (Muted)'}
              </span>
            </div>

            <h2
              className={`text-lg sm:text-xl font-black tracking-tight ${
                hasActiveErrors ? 'text-white' : 'text-text'
              }`}
            >
              {hasActiveErrors
                ? `ตรวจพบอุปกรณ์ในระบบมีสถานะ Error จำนวน ${activeErrorAlerts.length} รายการ — กรุณาดำเนินการแก้ไขทันที!`
                : 'ระบบแจ้งเตือนสถานะอุปกรณ์ขัดข้อง (System Alert Notification & Acoustic Siren)'}
            </h2>
            <p
              className={`text-xs ${
                hasActiveErrors ? 'text-rose-200/80' : 'text-text/60'
              }`}
            >
              {hasActiveErrors
                ? 'ระบบกำลังส่งเสียงเตือนและแสดงคำสั่งกู้คืนด่วน เพื่อให้แอดมินสามารถสั่ง Auto-Reconnect, รีบูตระยะไกล หรือซ่อมแซมด้วย AI ได้ทันที'
                : 'เฝ้าระวังสถานะเครื่องพิมพ์ใบเสร็จ สแกนเนอร์ ลิ้นชักเก็บเงิน และเครื่อง EDC แบบเรียลไทม์ พร้อมส่งเสียงเตือนทันทีเมื่อเกิดสถานะ Error'}
            </p>
          </div>
        </div>

        {/* Acoustic & Simulation Action Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={toggleAudioAlert}
            className={`px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold flex items-center gap-2 border transition-all cursor-pointer active:scale-95 ${
              hasActiveErrors
                ? audioAlertEnabled
                  ? 'bg-rose-500 text-white border-rose-400 shadow-sm'
                  : 'bg-rose-900/60 text-rose-200 border-rose-700/60 hover:bg-rose-900'
                : audioAlertEnabled
                ? 'bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/30 hover:bg-indigo-600/20'
                : 'bg-background text-text/60 border-border hover:text-text'
            }`}
          >
            {audioAlertEnabled ? (
              <>
                <Volume2 className="w-4 h-4 shrink-0" />
                <span>เสียงเตือน: เปิด (ON)</span>
              </>
            ) : (
              <>
                <VolumeX className="w-4 h-4 shrink-0" />
                <span>เสียงเตือน: ปิด (MUTE)</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              playHardwareErrorSiren('critical');
              addToast({
                type: 'info',
                title: '🔊 ทดสอบเสียงเตือน System Alert',
                message: 'ส่งสัญญาณเสียงเตือนไซเรน 3 จังหวะ (Web Audio API Hardware Error Siren) สำเร็จ',
                durationMs: 3000,
              });
            }}
            className={`px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer active:scale-95 ${
              hasActiveErrors
                ? 'bg-white/10 hover:bg-white/15 text-white border-white/20'
                : 'bg-background hover:bg-background text-text border-border'
            }`}
          >
            <Bell className="w-3.5 h-3.5 shrink-0" />
            <span>ทดสอบเสียงเตือน</span>
          </button>

          <button
            type="button"
            onClick={() => onSimulateDeviceError()}
            className={`px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer active:scale-95 ${
              hasActiveErrors
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-300 shadow-sm'
                : 'bg-rose-600 hover:bg-rose-500 text-white border-rose-500 shadow-xs'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span>จำลองอุปกรณ์เกิด Error</span>
          </button>

          {onSimulateDeviceOffline && (
            <button
              type="button"
              onClick={() => onSimulateDeviceOffline()}
              className={`px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer active:scale-95 ${
                hasActiveErrors
                  ? 'bg-slate-900/90 hover:bg-slate-800 text-amber-300 border-amber-400/50 shadow-sm'
                  : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-300 border-amber-500/40'
              }`}
            >
              <WifiOff className="w-3.5 h-3.5 shrink-0" />
              <span>จำลองอุปกรณ์ Offline</span>
            </button>
          )}

          {hasActiveErrors && (
            <button
              type="button"
              onClick={onSelfHealAll}
              disabled={healingAll}
              className="px-4 py-2 min-h-[40px] rounded-xl text-xs font-black bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 shadow-sm"
            >
              <Zap className={`w-4 h-4 ${healingAll ? 'animate-spin' : ''}`} />
              <span>{healingAll ? 'กำลังซ่อมแซม...' : 'ซ่อมแซมทั้งหมดอัตโนมัติ (Self-Heal)'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Active Hardware Error Incident Queue */}
      {hasActiveErrors ? (
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-rose-500/25">
            <div className="flex items-center gap-2 text-xs text-rose-200 font-semibold">
              <span>รายการอุปกรณ์ที่ต้องได้รับการแก้ไขด่วน ({activeErrorAlerts.length} อุปกรณ์)</span>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => setRepeatAlarmEnabled((prev) => !prev)}
                className="underline hover:text-white cursor-pointer"
              >
                {repeatAlarmEnabled ? 'เตือนซ้ำทุก 15 วินาที: เปิด' : 'เตือนซ้ำทุก 15 วินาที: ปิด'}
              </button>
            </div>

            {unacknowledgedErrorAlerts.length > 0 && (
              <button
                type="button"
                onClick={handleAcknowledgeAll}
                className="text-xs font-bold text-rose-200 hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-900/70 border border-rose-400/30 cursor-pointer self-start sm:self-auto"
              >
                <BellOff className="w-3.5 h-3.5" />
                <span>รับทราบและหยุดเสียงเตือนซ้ำทั้งหมด ({unacknowledgedErrorAlerts.length})</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {activeErrorAlerts.map((alert) => {
              const isAck = acknowledgedIds.has(alert.peripheralId);
              const isReconnecting = reconnectingPeripheralId === alert.peripheralId;
              const isRebooting = rebootingPeripheralId === alert.peripheralId;
              const isDiagnosing = diagnosingPeripheralId === alert.peripheralId;

              return (
                <div
                  key={alert.id}
                  className={`rounded-2xl p-4 sm:p-5 border transition-all flex flex-col justify-between gap-4 ${
                    isAck
                      ? 'bg-rose-950/70 border-rose-500/40'
                      : 'bg-rose-900/45 border-rose-400/80 shadow-lg'
                  }`}
                >
                  <div className="space-y-3">
                    {/* Device Header & Metadata */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-rose-500/25 border border-rose-400/40 flex items-center justify-center text-rose-200 shrink-0">
                          {getCategoryIcon(alert.category)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-rose-200/90">
                            <span className="font-black uppercase text-rose-300">
                              {alert.severity === 'critical' ? 'CRITICAL ERROR' : 'HARDWARE ERROR'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>พอร์ต {alert.port}</span>
                            <span aria-hidden="true">·</span>
                            <span>{alert.locationTag}</span>
                            <span aria-hidden="true">·</span>
                            <span className="inline-flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {alert.detectedAt}
                            </span>
                          </div>
                          <h3 className="text-base font-black text-white truncate mt-0.5">
                            {alert.deviceName}
                          </h3>
                        </div>
                      </div>

                      {!isAck ? (
                        <button
                          type="button"
                          onClick={() => handleAcknowledgeAlert(alert.peripheralId, alert.deviceName)}
                          className="px-2.5 py-1.5 rounded-lg bg-rose-800/80 hover:bg-rose-700 text-[11px] font-bold text-rose-100 border border-rose-400/30 flex items-center gap-1 shrink-0 cursor-pointer"
                          title="รับทราบและปิดเสียงเตือนซ้ำสำหรับรายการนี้"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>รับทราบ</span>
                        </button>
                      ) : (
                        <span className="text-[11px] font-mono text-rose-300/80 shrink-0">
                          ✓ รับทราบแล้ว
                        </span>
                      )}
                    </div>

                    {/* Diagnostic Cause & Recommended Action */}
                    <div className="rounded-xl bg-black/30 border border-rose-500/30 p-3 space-y-1.5 text-xs">
                      <div className="font-bold text-rose-200 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span>{alert.errorTitle}</span>
                      </div>
                      <p className="text-rose-100/85 leading-relaxed">{alert.errorDetail}</p>
                      <p className="text-[11px] text-amber-300/95 font-medium pt-1 border-t border-rose-500/20">
                        💡 คำแนะนำการแก้ไข: {alert.recommendedAction}
                      </p>
                    </div>
                  </div>

                  {/* Quick Remediation Action Bar for Admin */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {alert.peripheral && (
                      <>
                        <button
                          type="button"
                          onClick={() => onAutoReconnect(alert.peripheral!)}
                          disabled={isReconnecting}
                          className="px-3 py-2 min-h-[38px] rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-black text-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isReconnecting ? 'animate-spin' : ''}`} />
                          <span>
                            {isReconnecting ? 'กำลังเชื่อมต่อ...' : 'กู้คืนการเชื่อมต่อ (Reconnect)'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onRunDiagnostics(alert.peripheral!)}
                          disabled={isDiagnosing}
                          className="px-3 py-2 min-h-[38px] rounded-xl bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                        >
                          <Wrench className={`w-3.5 h-3.5 ${isDiagnosing ? 'animate-spin' : ''}`} />
                          <span>{isDiagnosing ? 'กำลังวินิจฉัย...' : 'วินิจฉัย & ซ่อมแซม'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onRemoteReboot(alert.peripheral!)}
                          disabled={isRebooting}
                          className="px-3 py-2 min-h-[38px] rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-95"
                        >
                          <RotateCcw className={`w-3.5 h-3.5 ${isRebooting ? 'animate-spin' : ''}`} />
                          <span>{isRebooting ? 'กำลังรีบูต...' : 'รีบูตอุปกรณ์'}</span>
                        </button>
                      </>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        onClearError(alert.peripheralId);
                        setAcknowledgedIds((prev) => {
                          const next = new Set(prev);
                          next.delete(alert.peripheralId);
                          return next;
                        });
                      }}
                      className="px-3 py-2 min-h-[38px] rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs border border-white/20 flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 ml-auto"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                      <span>เคลียร์สถานะ Error</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* Healthy / Zero-Error Summary Bar + Recent Alert Log */
        <div className="px-5 py-3.5 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-text/70">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              ✓ อุปกรณ์ต่อพ่วงทั้งหมด ({peripherals.length} รายการ) ทำงานปกติ ไม่พบสถานะ Error
            </span>
            {alertHistory.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-text/60">
                  ประวัติแจ้งเตือนล่าสุด: {alertHistory[0].deviceName} ({alertHistory[0].timestamp}) — แก้ไขแล้ว
                </span>
              </>
            )}
          </div>
          <span className="font-mono text-[11px] text-text/50">
            Web Audio API Siren: {audioAlertEnabled ? 'READY (880Hz/987Hz)' : 'MUTED'}
          </span>
        </div>
      )}
    </section>
  );
};
