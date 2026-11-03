import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Activity,
  Cpu,
  Database,
  Server,
  RefreshCw,
  HardDrive,
  CheckCircle2,
  AlertTriangle,
  DownloadCloud,
  Zap,
  Wifi,
  WifiOff,
  ShieldAlert,
  Bluetooth,
  Printer,
  Scan,
  Banknote,
  Battery,
  BatteryCharging,
  Plug,
  Radio,
  Usb,
  CreditCard,
  Gauge,
  Sparkles,
  Signal,
  LayoutGrid,
  List,
  MapPin,
  Tag,
  Plus,
  X,
  Moon,
  ZapOff,
  Power,
  Edit2,
  Check,
  RotateCcw,
  Layers,
  Wrench,
  Download,
  Clock,
  Calendar,
  FileText,
  FileJson,
  Network,
  Route,
  Share2,
  Monitor,
  BrainCircuit,
  CalendarClock,
  Terminal,
  ChevronDown,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { useTheme } from '../../context/ThemeContext';
import { useOffline } from '../../context/OfflineContext';
import { HardwareTestSuite } from './HardwareTestSuite';
import { NetworkTopologyMap } from './NetworkTopologyMap';
import { NewDeviceSetupModal } from './NewDeviceSetupModal';
import { HardwareHealthChart } from './HardwareHealthChart';
import { NetworkHealthGauge } from './NetworkHealthGauge';
import { FloorPlanView } from './FloorPlanView';
import { SystemAlertNotificationCenter } from './SystemAlertNotificationCenter';
import { SystemNotificationToastCorner } from './SystemNotificationToastCorner';
import { DiagnosticBatchBufferMonitor } from './DiagnosticBatchBufferMonitor';
import { OfflineBufferSyncMonitor } from './OfflineBufferSyncMonitor';
import { SystemHealthCheckCard } from './SystemHealthCheckCard';
import { RealtimeLatencyDiagnosticPanel } from './RealtimeLatencyDiagnosticPanel';
import { systemNotificationService } from '../../services/systemNotificationService';
import { auditService, DiagnosticLogLevel } from '../../services/auditService';
import { HardwarePeripheralStatus } from '../../types/hardware';



interface HealthData {
  status: 'healthy' | 'warning' | 'critical' | 'self_healing';
  uptimeSeconds: number;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  dbLatencyMs: number;
  activeConnections: number;
  lastSelfHealTimestamp?: string;
  selfHealLogs: Array<{
    id: string;
    timestamp: string;
    component: string;
    issue: string;
    actionTaken: string;
    status: 'success' | 'pending';
  }>;
}

interface Device {
  id: string;
  name: string;
  type: string;
  port: string;
  status: 'connected' | 'installing' | 'ready' | 'error';
  driverVersion: string;
  latestVersion: string;
  autoUpdateAvailable: boolean;
  lastConnected: string;
}

interface DiscoveredPeripheral {
  id: string;
  name: string;
  category: 'printer' | 'scanner' | 'drawer' | 'scale';
  interfaceType: 'USB' | 'Bluetooth_LE' | 'Serial_RS232';
  hardwareId: string;
  detectedAt: string;
  configured: boolean;
  suggestedConfig: {
    driver: string;
    baudRate?: number;
    paperWidthMm?: number;
    emulation: string;
    autoDrawerKick?: boolean;
  };
}

interface FirmwareAlert {
  id: string;
  deviceId: string;
  deviceName: string;
  advisory: {
    id: string;
    advisoryType: 'SECURITY_CRITICAL' | 'SECURITY_HIGH' | 'PERFORMANCE_CRITICAL' | 'FEATURE_UPDATE';
    cveId?: string;
    title: string;
    description: string;
    recommendedFirmwareVersion: string;
    recommendedDriverVersion: string;
    severityScore: number;
    autoPatchSupported: boolean;
  };
  detectedAt: string;
  status: 'PENDING_INSTALL' | 'PATCHING' | 'RESOLVED';
}

export type PeripheralHealthPulseState = 'idle' | 'active' | 'error';

import { DndContext, closestCenter, DragOverlay } from '@dnd-kit/core';
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

export function InfrastructureDashboard() {
  const { addToast } = useToast();
  const { theme } = useTheme();
  const { isOnline, isSimulatedOffline, pendingCount, syncLatencyMs, syncLatencyQuality } = useOffline();
  
  // Drag and drop state
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    setActiveId(null);
    if (active.id !== over?.id) {
       // Logic to update peripheral order/tag would go here
    }
  };

  const [health, setHealth] = useState<HealthData | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [peripherals, setPeripherals] = useState<HardwarePeripheralStatus[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'printer' | 'scanner' | 'drawer' | 'edc'>('all');
  const [selectedPulseFilter, setSelectedPulseFilter] = useState<'all' | 'idle' | 'active' | 'error'>('all');
  const [selectedLocationTag, setSelectedLocationTag] = useState<string>('all');
  const [editingTagsPeripheralId, setEditingTagsPeripheralId] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState<string>('');
  const [editingNamePeripheralId, setEditingNamePeripheralId] = useState<string | null>(null);
  const [editingNameInput, setEditingNameInput] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'floorplan'>('grid');
  const [groupingMode, setGroupingMode] = useState<'none' | 'status' | 'location'>('none');
  const [isNewDeviceSetupOpen, setIsNewDeviceSetupOpen] = useState<boolean>(false);
  const [updatingFirmware, setUpdatingFirmware] = useState<boolean>(false);
  const [firmwareUpdateProgress, setFirmwareUpdateProgress] = useState<number>(0);
  const [firmwareCurrentStage, setFirmwareCurrentStage] = useState<string>('');
  const [firmwareLogs, setFirmwareLogs] = useState<string[]>([]);
  const [pulseOverrides, setPulseOverrides] = useState<Record<string, PeripheralHealthPulseState>>({});
  const [activePeripheralIds, setActivePeripheralIds] = useState<Set<string>>(new Set());
  const [failedPeripheralIds, setFailedPeripheralIds] = useState<Set<string>>(new Set());
  const [auditingPeripheralId, setAuditingPeripheralId] = useState<string | null>(null);
  const [auditingAll, setAuditingAll] = useState(false);
  const [testingDeviceId, setTestingDeviceId] = useState<string | null>(null);
  const [diagnosingPeripheralId, setDiagnosingPeripheralId] = useState<string | null>(null);
  const [rebootingPeripheralId, setRebootingPeripheralId] = useState<string | null>(null);
  const [rebootConfirmPeripheral, setRebootConfirmPeripheral] = useState<HardwarePeripheralStatus | null>(null);
  const [firmwareAlerts, setFirmwareAlerts] = useState<FirmwareAlert[]>([]);
  const [discoveredPeripherals, setDiscoveredPeripherals] = useState<DiscoveredPeripheral[]>([]);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [loadingScan, setLoadingScan] = useState(false);
  const [healing, setHealing] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [reconnectingPeripheralId, setReconnectingPeripheralId] = useState<string | null>(null);
  const [selectedPeripheralIds, setSelectedPeripheralIds] = useState<Set<string>>(new Set());
  const [bulkRebooting, setBulkRebooting] = useState<boolean>(false);
  const [terminalPeripheral, setTerminalPeripheral] = useState<HardwarePeripheralStatus | null>(null);
  const [powerThreshold, setPowerThreshold] = useState<number>(15.0);
  const notifiedPowerSpikesRef = React.useRef<Set<string>>(new Set());

  // Scheduled Power Cycle & Diagnostic Export States
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState<boolean>(false);
  const [scheduleTime, setScheduleTime] = useState<string>('22:00');
  const [scheduleOnlyNonCritical, setScheduleOnlyNonCritical] = useState<boolean>(true);
  const [scheduleErrorThreshold, setScheduleErrorThreshold] = useState<number>(5); // Default 5 errors
  const [scheduledJobs, setScheduledJobs] = useState<Array<{
    id: string;
    time: string;
    targetCount: number;
    onlyNonCritical: boolean;
    errorThreshold?: number;
    type: 'STORE_CLOSING' | 'AUTO_REBOOT_HIGH_ERROR';
    createdAt: string;
    status: 'ACTIVE' | 'EXECUTED';
  }>>([
    {
      id: 'job-closing-01',
      time: '22:00',
      targetCount: 3,
      onlyNonCritical: true,
      type: 'STORE_CLOSING',
      createdAt: new Date().toISOString(),
      status: 'ACTIVE',
    },
  ]);

  // Bulk Export Diagnostic Logs (JSON / CSV)
  const handleExportDiagnosticLogs = (format: 'json' | 'csv') => {
    const targets = selectedPeripheralIds.size > 0
      ? peripherals.filter((p) => selectedPeripheralIds.has(p.id))
      : peripherals;

    const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');

    if (format === 'json') {
      const data = {
        exportedAt: new Date().toISOString(),
        totalDevices: targets.length,
        peripherals: targets.map((p) => ({
          id: p.id,
          name: p.name,
          category: p.category,
          model: p.model,
          serialNumber: p.serialNumber,
          port: p.port,
          connectivityState: p.connectivity.state,
          interface: p.connectivity.interface,
          latencyMs: p.connectivity.latencyMs,
          signalStrength: p.connectivity.signalStrengthPercent || null,
          batteryLevel: p.battery.levelPercent,
          driverStatus: p.driverHealth.status,
          firmwareVersion: p.firmwareVersion,
          driverVersion: p.driverVersion,
          diagnosticsLog: p.driverHealth.diagnostics,
          lastActivity: p.lastActivity,
          operationsCountToday: p.telemetryData.operationsCountToday,
          errorCountToday: p.telemetryData.errorCountToday,
          tags: p.tags || [],
        })),
      };
      const jsonBlob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(jsonBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hardware_diagnostics_logs_${timestampStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const headers = ['ID', 'Name', 'Category', 'Model', 'Serial', 'Port', 'Interface', 'State', 'LatencyMs', 'DriverStatus', 'Firmware', 'DiagnosticsLog'];
      const rows = targets.map((p) => [
        `"${p.id}"`,
        `"${p.name.replace(/"/g, '""')}"`,
        `"${p.category}"`,
        `"${p.model}"`,
        `"${p.serialNumber}"`,
        `"${p.port}"`,
        `"${p.connectivity.interface}"`,
        `"${p.connectivity.state}"`,
        p.connectivity.latencyMs,
        `"${p.driverHealth.status}"`,
        `"${p.firmwareVersion}"`,
        `"${p.driverHealth.diagnostics.replace(/"/g, '""')}"`,
      ]);
      const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
      const csvBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(csvBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hardware_diagnostics_logs_${timestampStr}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }

    addToast({
      type: 'success',
      title: `ส่งออกไฟล์ Logs (${format.toUpperCase()}) สำเร็จ`,
      message: `ดาวน์โหลดรายงานสรุปวินิจฉัยอุปกรณ์จำนวน ${targets.length} รายการเรียบร้อยแล้ว`,
      durationMs: 4000,
    });
  };

  // Schedule Power Cycle or Automatic Reboot Task
  const handleCreateScheduledPowerCycle = (type: 'STORE_CLOSING' | 'AUTO_REBOOT_HIGH_ERROR') => {
    let targetPeripherals = peripherals;
    
    if (scheduleOnlyNonCritical) {
      targetPeripherals = targetPeripherals.filter((p) => p.category !== 'drawer' && p.category !== 'edc');
    }

    if (type === 'AUTO_REBOOT_HIGH_ERROR') {
      targetPeripherals = targetPeripherals.filter((p) => p.telemetryData.errorCountToday >= scheduleErrorThreshold);
    }

    const newJob = {
      id: `job-cycle-${Date.now()}`,
      time: scheduleTime,
      targetCount: targetPeripherals.length,
      onlyNonCritical: scheduleOnlyNonCritical,
      errorThreshold: type === 'AUTO_REBOOT_HIGH_ERROR' ? scheduleErrorThreshold : undefined,
      type,
      createdAt: new Date().toISOString(),
      status: 'ACTIVE' as const,
    };

    setScheduledJobs((prev) => [newJob, ...prev]);
    setIsScheduleModalOpen(false);

    const title = type === 'STORE_CLOSING' 
      ? `ตั้งเวลา Power Cycle เรียบร้อย (${scheduleTime} น.)`
      : `ตั้งเวลา Auto-Reboot เมื่อ Error สูง (${scheduleTime} น.)`;
    
    const message = type === 'STORE_CLOSING'
      ? `ระบบจะส่งสัญญาณรีเซ็ตไฟกระแสตรงอุปกรณ์ ${targetPeripherals.length} รายการอัตโนมัติเมื่อถึงเวลาปิดร้าน`
      : `ระบบจะรีบูตอุปกรณ์ที่มี Error >= ${scheduleErrorThreshold} อัตโนมัติในช่วงทราฟฟิกต่ำ (${scheduleTime} น.)`;

    addToast({
      type: 'success',
      title,
      message,
      durationMs: 5000,
    });
    setActionMessage(`[Scheduled Job] ${title} - ${targetPeripherals.length} อุปกรณ์เป้าหมาย`);
  };

  const handleToggleSelectPeripheral = (peripheralId: string) => {
    setSelectedPeripheralIds((prev) => {
      const next = new Set(prev);
      if (next.has(peripheralId)) {
        next.delete(peripheralId);
      } else {
        next.add(peripheralId);
      }
      return next;
    });
  };

  const handleSelectAllOffline = () => {
    const offlineOrErrorIds = peripherals
      .filter((p) => p.connectivity.state === 'disconnected' || getPeripheralPulseState(p) === 'error')
      .map((p) => p.id);
    setSelectedPeripheralIds(new Set(offlineOrErrorIds));
    addToast({
      type: 'info',
      title: 'เลือกอุปกรณ์ออฟไลน์ทั้งหมด',
      message: `เลือกอุปกรณ์ที่ออฟไลน์หรือขัดข้องจำนวน ${offlineOrErrorIds.length} รายการแล้ว`,
      durationMs: 3000,
    });
  };

  const handleBulkRebootPeripherals = async () => {
    if (selectedPeripheralIds.size === 0) return;
    const ids = Array.from(selectedPeripheralIds);
    try {
      setBulkRebooting(true);
      setActionMessage(`[Bulk Remote Reboot] กำลังส่งสัญญาณรีเซ็ต DTR Power Rails พร้อมกันไปยังอุปกรณ์ ${ids.length} รายการ...`);
      const res = await fetch('/api/v1/infrastructure/hardware-peripherals/bulk-reboot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peripheralIds: ids }),
      });
      const data = await res.json();
      setTimeout(() => {
        if (data.success && data.peripherals) {
          setPeripherals(data.peripherals);
          addToast({
            type: 'success',
            title: 'Bulk Remote Reboot สำเร็จ!',
            message: `รีบูตและกู้คืนการเชื่อมต่ออุปกรณ์ ${data.rebootedCount} รายการพร้อมกันเรียบร้อยแล้ว`,
            durationMs: 5000,
          });
          setActionMessage(`[Bulk Reboot Complete] รีบูตฮาร์ดแวร์ ${data.rebootedCount} รายการพร้อมกันสำเร็จ`);
          setSelectedPeripheralIds(new Set());
        }
        setBulkRebooting(false);
      }, 1800);
    } catch {
      setBulkRebooting(false);
      addToast({
        type: 'error',
        title: 'การรีบูตแบบกลุ่มขัดข้อง',
        message: 'ไม่สามารถส่งคำสั่งรีบูตไปยังอุปกรณ์ที่เลือกได้',
        durationMs: 4000,
      });
    }
  };

  const handleToggleMaintenanceMode = async (peripheral: HardwarePeripheralStatus) => {
    const nextMode = !peripheral.isMaintenanceMode;
    try {
      const res = await fetch('/api/v1/infrastructure/hardware-peripherals/maintenance-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peripheralId: peripheral.id, enabled: nextMode }),
      });
      const data = await res.json();
      if (data.success && data.peripherals) {
        setPeripherals(data.peripherals);
        addToast({
          type: nextMode ? 'info' : 'success',
          title: nextMode ? 'เปิดโหมดซ่อมบำรุง (Maintenance Mode)' : 'ปิดโหมดซ่อมบำรุง',
          message: nextMode
            ? `ระงับการแจ้งเตือนข้อผิดพลาดสำหรับ "${peripheral.name}" เรียบร้อยแล้ว`
            : `อุปกรณ์ "${peripheral.name}" กลับสู่สถานะตรวจสอบปกติ`,
          durationMs: 4000,
        });
        setActionMessage(
          nextMode
            ? `[Maintenance Mode Active] ระงับแจ้งเตือนอุปกรณ์ ${peripheral.name} ระหว่างซ่อมบำรุง`
            : `[Maintenance Mode Off] เปิดระบบตรวจสอบปกติสำหรับ ${peripheral.name}`
        );
      }
    } catch {
      addToast({
        type: 'error',
        title: 'เปลี่ยนโหมดซ่อมบำรุงล้มเหลว',
        message: 'ไม่สามารถอัปเดตสถานะ Maintenance Mode ได้',
        durationMs: 3000,
      });
    }
  };

  const handleUpdatePosition = async (id: string, position: { x: number, y: number }) => {
    setPeripherals(prev => prev.map(p => p.id === id ? { ...p, position } : p));
    // Persist to backend
    try {
      await fetch('/api/v1/infrastructure/hardware-peripherals/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peripheralId: id, position }),
      });
    } catch (e) {
      console.error('Failed to update position', e);
    }
  };

  const handleAutoReconnect = async (peripheral: HardwarePeripheralStatus) => {
    try {
      setReconnectingPeripheralId(peripheral.id);
      setActionMessage(`[Auto-Reconnect] กำลังส่งสัญญาณกู้คืนการเชื่อมต่อ Handshake (SYN/ACK) ไปยัง ${peripheral.name}...`);
      const res = await fetch('/api/v1/infrastructure/hardware-peripherals/reconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peripheralId: peripheral.id }),
      });
      const data = await res.json();
      setTimeout(() => {
        if (data.success && data.peripherals) {
          setPeripherals(data.peripherals);
          addToast({
            type: 'success',
            title: 'กู้คืนการเชื่อมต่อสำเร็จ!',
            message: `อุปกรณ์ ${peripheral.name} กลับมาออนไลน์และพร้อมทำงานเรียบร้อย`,
            durationMs: 4000,
          });
          setActionMessage(`[Reconnect Success] อุปกรณ์ ${peripheral.name} เชื่อมต่อกลับเข้าสู่ระบบสำเร็จ`);
        }
        setReconnectingPeripheralId(null);
      }, 1500);
    } catch {
      setReconnectingPeripheralId(null);
      addToast({
        type: 'error',
        title: 'กู้คืนการเชื่อมต่อไม่สำเร็จ',
        message: 'ไม่สามารถติดต่ออุปกรณ์ผ่านพอร์ตได้ กรุณาตรวจสอบสายเชื่อมต่อ',
        durationMs: 4000,
      });
    }
  };

  const [deviceProfiles, setDeviceProfiles] = useState<Array<{
    id: string;
    name: string;
    role: string;
    description: string;
    activeTagFilters: string[];
  }>>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>('profile-all');

  const prevPeripheralsRef = React.useRef<HardwarePeripheralStatus[]>([]);

  const fetchDeviceProfiles = async () => {
    try {
      const res = await fetch('/api/v1/infrastructure/device-profiles');
      const data = await res.json();
      if (data.success && data.profiles) {
        setDeviceProfiles(data.profiles);
      }
    } catch (err) {
      console.error('Failed to fetch device profiles:', err);
    }
  };

  const handleApplyDeviceProfile = async (profileId: string) => {
    try {
      setActiveProfileId(profileId);
      const res = await fetch('/api/v1/infrastructure/device-profiles/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      });
      const data = await res.json();
      if (data.success) {
        const profile = data.profile;
        if (profile) {
          if (profile.activeTagFilters.length === 1) {
            setSelectedLocationTag(profile.activeTagFilters[0]);
          } else {
            setSelectedLocationTag('all');
          }
          addToast({
            type: 'success',
            title: `สลับโปรไฟล์สำเร็จ: ${profile.name}`,
            message: `ปรับชุดการตั้งค่าฮาร์ดแวร์สำหรับบทบาท "${profile.role}" เรียบร้อยแล้ว`,
            durationMs: 4000,
          });
          setActionMessage(`[Device Profile Active] โหลดการตั้งค่าฮาร์ดแวร์ "${profile.name}" (${profile.role}) สำเร็จ`);
        }
      }
    } catch {
      addToast({
        type: 'error',
        title: 'สลับโปรไฟล์ล้มเหลว',
        message: 'ไม่สามารถโหลดชุดการตั้งค่าฮาร์ดแวร์ได้',
        durationMs: 3000,
      });
    }
  };

  const fetchData = async () => {
    try {
      setLoadingHealth(true);
      const [hRes, dRes, fRes, pRes, periphRes] = await Promise.all([
        fetch('/api/v1/infrastructure/health'),
        fetch('/api/v1/infrastructure/devices'),
        fetch('/api/v1/infrastructure/firmware-alerts'),
        fetch('/api/v1/infrastructure/peripheral-discovery'),
        fetch('/api/v1/infrastructure/hardware-peripherals'),
      ]);
      const hData = await hRes.json();
      const dData = await dRes.json();
      const fData = await fRes.json();
      const pData = await pRes.json();
      const periphData = await periphRes.json();
      if (hData.success) setHealth(hData.data);
      if (dData.success) setDevices(dData.data);
      if (fData.success) setFirmwareAlerts(fData.data);
      if (pData.success) setDiscoveredPeripherals(pData.data);
      if (periphData.success) {
        const newPeripherals: HardwarePeripheralStatus[] = periphData.data;
        const oldPeripherals = prevPeripheralsRef.current;

        if (oldPeripherals.length > 0) {
          newPeripherals.forEach((newP) => {
            const oldP = oldPeripherals.find((o) => o.id === newP.id);
            if (oldP) {
              // Power Draw Threshold Monitoring
              if (newP.currentPowerDrawWatts && newP.currentPowerDrawWatts >= powerThreshold) {
                if (!notifiedPowerSpikesRef.current.has(newP.id)) {
                  addToast({
                    type: 'error',
                    title: '⚠️ ตรวจพบการใช้พลังงานสูงผิดปกติ!',
                    message: `อุปกรณ์ "${newP.name}" ใช้พลังงาน ${newP.currentPowerDrawWatts}W (เกินเกณฑ์ ${powerThreshold}W) อาจมีปัญหาความร้อนหรือชิ้นส่วนเสื่อมสภาพ`,
                    durationMs: 8000,
                  });
                  notifiedPowerSpikesRef.current.add(newP.id);
                }
              } else {
                // Reset notification if draw returns to normal
                notifiedPowerSpikesRef.current.delete(newP.id);
              }

              // Check if state changed from online/connected to disconnected
              const justDisconnected = (oldP.connectivity.state === 'online' || oldP.connectivity.state === 'connected') && newP.connectivity.state === 'disconnected';
              // Check if driver status became degraded or error
              const justFailed = oldP.driverHealth.status === 'healthy' && (newP.driverHealth.status === 'degraded' || newP.driverHealth.status === 'patch_required');

              if (justDisconnected || justFailed) {
                // If device is under maintenance mode, silence notifications
                if (newP.isMaintenanceMode) {
                  return;
                }

                const alertTitle = justDisconnected ? '⚠️ อุปกรณ์ฮาร์ดแวร์หลุดการเชื่อมต่อ!' : '❌ พบความผิดพลาดในอุปกรณ์ฮาร์ดแวร์!';
                const alertMsg = justDisconnected
                  ? `อุปกรณ์สำคัญ "${newP.name}" (${newP.connectivity.interface}) ขาดการเชื่อมต่อบนพอร์ต ${newP.port}`
                  : `อุปกรณ์ "${newP.name}" รายงานความผิดพลาดของไดรเวอร์: ${newP.driverHealth.diagnostics.slice(0, 80)}...`;

                // 1. Toast Notification
                addToast({
                  type: 'error',
                  title: alertTitle,
                  message: alertMsg,
                  durationMs: 8000,
                });

                // 2. Browser Desktop Notification if permitted
                if (typeof window !== 'undefined' && 'Notification' in window) {
                  if (Notification.permission === 'granted') {
                    new Notification(alertTitle, {
                      body: alertMsg,
                      icon: '/favicon.ico',
                    });
                  } else if (Notification.permission !== 'denied') {
                    Notification.requestPermission().then((permission) => {
                      if (permission === 'granted') {
                        new Notification(alertTitle, {
                          body: alertMsg,
                          icon: '/favicon.ico',
                        });
                      }
                    });
                  }
                }
              }
            }
          });
        }

        prevPeripheralsRef.current = newPeripherals;
        setPeripherals(newPeripherals);
      }
    } catch (err) {
      console.error('Failed to fetch infrastructure data:', err);
    } finally {
      setLoadingHealth(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchDeviceProfiles();
    // Request browser notification permission on mount
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const interval = setInterval(fetchData, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  const handleSelfHeal = async () => {
    try {
      setHealing(true);
      setActionMessage('Antigravity AI กำลังตรวจสอบและซ่อมแซมระบบโครงสร้างพื้นฐานอัตโนมัติ (Self-Healing)...');
      const res = await fetch('/api/v1/infrastructure/self-heal', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setActionMessage(data.message);
        await fetchData();
      } else {
        setActionMessage('การซ่อมแซมล้มเหลว: ' + data.error);
      }
    } catch {
      setActionMessage('เกิดข้อผิดพลาดในการเชื่อมต่อ');
    } finally {
      setHealing(false);
    }
  };

  const handleScanDevices = async () => {
    try {
      setLoadingScan(true);
      setActionMessage('กำลังสแกนพอร์ต USB และ Bluetooth ค้นหาอุปกรณ์ POS ต่อพ่วง...');
      const [devRes, periphScanRes] = await Promise.all([
        fetch('/api/v1/infrastructure/devices/scan', { method: 'POST' }),
        fetch('/api/v1/infrastructure/peripheral-discovery/scan', { method: 'POST' }),
      ]);
      const devData = await devRes.json();
      const periphData = await periphScanRes.json();

      if (devData.success) {
        setDevices(devData.devices);
      }
      if (periphData.success) {
        setDiscoveredPeripherals(periphData.peripherals);
        setActionMessage(`สแกนพอร์ต USB/Bluetooth สำเร็จ พบอุปกรณ์ใหม่ ${periphData.discoveredCount} รายการ พร้อมตั้งค่าอัตโนมัติ`);
        addToast({
          type: 'success',
          title: 'Auto-Discover สำเร็จ',
          message: `ตรวจพบอุปกรณ์ต่อพ่วง USB/Bluetooth ใหม่ ${periphData.discoveredCount} รายการ`,
          durationMs: 4000,
        });
      }
    } catch {
      setActionMessage('สแกนพอร์ตฮาร์ดแวร์ล้มเหลว');
      addToast({
        type: 'error',
        title: 'การสแกนล้มเหลว',
        message: 'ไม่สามารถติดต่อเซอร์วิสสแกนพอร์ต USB/Bluetooth ได้',
        durationMs: 4000,
      });
    } finally {
      setLoadingScan(false);
    }
  };

  const [bulkFirmwareChecking, setBulkFirmwareChecking] = useState(false);
  const [bulkFirmwareResult, setBulkFirmwareResult] = useState<{
    totalChecked: number;
    outdatedCount: number;
    results: Array<{
      peripheralId: string;
      name: string;
      category: string;
      currentFirmware: string;
      latestFirmware: string;
      needsUpdate: boolean;
      advisoryTitle?: string;
      severityScore?: number;
    }>;
  } | null>(null);

  const handleBulkFirmwareCheck = async () => {
    try {
      setBulkFirmwareChecking(true);
      setActionMessage('Antigravity AI กำลังตรวจสอบเวอร์ชันเฟิร์มแวร์ของอุปกรณ์ต่อพ่วงทั้งหมด...');
      const res = await fetch('/api/v1/infrastructure/firmware-check/bulk', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setBulkFirmwareResult(data);
        addToast({
          type: data.outdatedCount > 0 ? 'info' : 'success',
          title: 'Bulk Firmware Check สำเร็จ',
          message: `ตรวจสอบอุปกรณ์ทั้งหมด ${data.totalChecked} รายการ • พบอุปกรณ์ที่ต้องอัปเดต ${data.outdatedCount} รายการ`,
          durationMs: 5000,
        });
        setActionMessage(`[Bulk Firmware Check] ตรวจสอบสำเร็จ ${data.totalChecked} อุปกรณ์ พบอุปกรณ์ต้องอัปเดต ${data.outdatedCount} รายการ`);
      }
    } catch {
      setActionMessage('การตรวจสอบเฟิร์มแวร์ล้มเหลว');
      addToast({
        type: 'error',
        title: 'Bulk Firmware Check ขัดข้อง',
        message: 'ไม่สามารถตรวจสอบเฟิร์มแวร์อุปกรณ์ทั้งหมดได้',
        durationMs: 4000,
      });
    } finally {
      setBulkFirmwareChecking(false);
    }
  };

  const handleSavePeripheralTags = async (peripheralId: string, updatedTags: string[]) => {
    try {
      const res = await fetch('/api/v1/infrastructure/hardware-peripherals/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peripheralId, tags: updatedTags }),
      });
      const data = await res.json();
      if (data.success && data.peripherals) {
        setPeripherals(data.peripherals);
        addToast({
          type: 'success',
          title: 'อัปเดตตำแหน่งจัดวางสำเร็จ',
          message: `บันทึกแท็กสถานที่สำหรับอุปกรณ์เรียบร้อย`,
          durationMs: 3000,
        });
      }
    } catch {
      addToast({
        type: 'error',
        title: 'อัปเดตสถานที่ล้มเหลว',
        message: 'ไม่สามารถบันทึกแท็กสถานที่ได้',
        durationMs: 3000,
      });
    } finally {
      setEditingTagsPeripheralId(null);
      setNewTagInput('');
    }
  };

  const handleBulkAssignTag = async (tag: string) => {
    const ids = Array.from(selectedPeripheralIds);
    try {
      const results = await Promise.all(
        ids.map(id => {
          const peripheral = peripherals.find(p => p.id === id);
          if (!peripheral) return null;
          const currentTags = peripheral.tags || [];
          const newTags = currentTags.includes(tag) ? currentTags : [...currentTags, tag];
          return fetch('/api/v1/infrastructure/hardware-peripherals/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ peripheralId: id, tags: newTags }),
          }).then(res => res.json());
        })
      );
      
      // Refresh peripherals state
      const res = await fetch('/api/v1/infrastructure/hardware-peripherals');
      const data = await res.json();
      if (data.peripherals) setPeripherals(data.peripherals);
      
      addToast({
        type: 'success',
        title: 'อัปเดตแท็กสำเร็จ',
        message: `กำหนดแท็ก "${tag}" ให้กับอุปกรณ์ ${ids.length} รายการเรียบร้อยแล้ว`,
        durationMs: 3000,
      });
      setSelectedPeripheralIds(new Set());
    } catch {
      addToast({
        type: 'error',
        title: 'อัปเดตแท็กล้มเหลว',
        message: 'ไม่สามารถกำหนดแท็กให้กับอุปกรณ์ทั้งหมดได้',
        durationMs: 3000,
      });
    }
  };

  const handleTogglePowerSave = async (peripheralId: string, enabled: boolean) => {
    try {
      const res = await fetch('/api/v1/infrastructure/hardware-peripherals/powersave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peripheralId, enabled }),
      });
      const data = await res.json();
      if (data.success && data.peripherals) {
        setPeripherals(data.peripherals);
        addToast({
          type: enabled ? 'info' : 'success',
          title: enabled ? 'โหมดประหยัดพลังงาน (Eco Sleep)' : 'ออกจากโหมดประหยัดพลังงาน',
          message: enabled
            ? `อุปกรณ์สแตนด์บายในโหมดกินไฟต่ำ (0.2W)`
            : `อุปกรณ์กลับสู่สภาวะทำงานเต็มประสิทธิภาพ (8.5W)`,
          durationMs: 4000,
        });
        setActionMessage(
          enabled
            ? `[Power Save Active] อุปกรณ์เข้าสู่โหมดสแตนด์บายประหยัดพลังงาน (0.2W)`
            : `[Normal Power Mode] อุปกรณ์ตื่นและพร้อมทำงานเต็มประสิทธิภาพ`
        );
      }
    } catch {
      addToast({
        type: 'error',
        title: 'สลับโหมดประหยัดพลังงานล้มเหลว',
        message: 'ไม่สามารถเปลี่ยนโหมดพลังงานได้',
        durationMs: 3000,
      });
    }
  };

  const handleSavePeripheralName = async (peripheralId: string) => {
    const trimmed = editingNameInput.trim();
    if (!trimmed) {
      setEditingNamePeripheralId(null);
      return;
    }
    try {
      const res = await fetch('/api/v1/infrastructure/hardware-peripherals/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peripheralId, name: trimmed }),
      });
      const data = await res.json();
      if (data.success && data.peripherals) {
        setPeripherals(data.peripherals);
        addToast({
          type: 'success',
          title: 'อัปเดตชื่ออุปกรณ์สำเร็จ',
          message: `เปลี่ยนชื่อเป็น "${trimmed}" เรียบร้อยแล้ว`,
          durationMs: 3000,
        });
      }
    } catch {
      addToast({
        type: 'error',
        title: 'เปลี่ยนชื่ออุปกรณ์ล้มเหลว',
        message: 'ไม่สามารถบันทึกชื่ออุปกรณ์ได้',
        durationMs: 3000,
      });
    } finally {
      setEditingNamePeripheralId(null);
      setEditingNameInput('');
    }
  };

  const handleExecuteRemoteReboot = async (peripheral: HardwarePeripheralStatus) => {
    setRebootConfirmPeripheral(null);
    setRebootingPeripheralId(peripheral.id);
    setActionMessage(`[Remote Power Cycle] กำลังส่งสัญญาณตัดรอบไฟกระแสตรง (DTR/Power Rails Cycle) ไปยัง ${peripheral.name}...`);
    try {
      const res = await fetch('/api/v1/infrastructure/hardware-peripherals/reboot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peripheralId: peripheral.id }),
      });
      const data = await res.json();

      setTimeout(() => {
        if (data.success && data.peripherals) {
          setPeripherals(data.peripherals);
          addToast({
            type: 'success',
            title: 'ส่งสัญญาณ รีบูตระยะไกลสำเร็จ!',
            message: `อุปกรณ์ ${peripheral.name} รีเซ็ต Power Rails และเชื่อมต่อกลับเข้าสู่ระบบเรียบร้อยแล้ว`,
            durationMs: 5000,
          });
          setActionMessage(`[Power Cycle Complete] อุปกรณ์ ${peripheral.name} รีบูตและกลับสู่สภาวะพร้อมใช้งานเรียบร้อย`);
        }
        setRebootingPeripheralId(null);
      }, 1800);
    } catch {
      setRebootingPeripheralId(null);
      addToast({
        type: 'error',
        title: 'รีบูตระยะไกลขัดข้อง',
        message: 'ไม่สามารถส่งสัญญาณ Power Cycle ไปยังอุปกรณ์ได้',
        durationMs: 4000,
      });
    }
  };

  const handleDeviceAddedFromWizard = (deviceInfo: {
    name: string;
    category: 'printer' | 'scanner' | 'drawer' | 'edc';
    interfaceType: string;
    port: string;
    locationTag: string;
  }) => {
    const newPeripheral: HardwarePeripheralStatus = {
      id: `periph-${deviceInfo.category}-${Date.now().toString().slice(-4)}`,
      name: deviceInfo.name,
      category: deviceInfo.category,
      model: `${deviceInfo.name} (${deviceInfo.interfaceType})`,
      serialNumber: `SN-${Math.floor(100000 + Math.random() * 900000)}`,
      port: deviceInfo.port,
      firmwareVersion: 'v2.10.0',
      driverVersion: 'v4.15.2',
      latestDriverVersion: 'v4.15.2',
      connectivity: {
        state: 'online',
        interface: deviceInfo.interfaceType as any,
        latencyMs: 1.2,
        lastPingTimestamp: new Date().toISOString(),
      },
      battery: {
        levelPercent: null,
        isCharging: false,
        powerSource: 'ac_mains',
        healthStatus: 'optimal',
      },
      driverHealth: {
        status: 'healthy',
        integrityVerifiedByAntigravity: true,
        lastAuditTimestamp: new Date().toISOString(),
        driverSignStatus: 'whql_certified',
        diagnostics: `[New Hardware Configured] อุปกรณ์ได้รับการติดตั้งและตรวจสอบผ่าน Antigravity Setup Wizard`,
      },
      predictiveAnalysis: {
        reliabilityScore: 100,
        estimatedTimeToFailureDays: 365,
        maintenanceRecommended: false,
        analysisInsight: 'อุปกรณ์ใหม่เพิ่งติดตั้ง สถานะปกติ',
      },
      lastActivity: new Date().toISOString(),
      telemetryData: {
        operationsCountToday: 1,
        errorCountToday: 0,
        historicalErrorCount: 0,
      },
      tags: [deviceInfo.locationTag],
      currentPowerDrawWatts: 1.5,
    };

    setPeripherals((prev) => [newPeripheral, ...prev]);
    addToast({
      type: 'success',
      title: 'ติดตั้งฮาร์ดแวร์ใหม่สำเร็จ!',
      message: `ลงทะเบียน ${deviceInfo.name} ที่ ${deviceInfo.locationTag} เรียบร้อยแล้ว`,
      durationMs: 5000,
    });
    setActionMessage(`[New Hardware Ready] ลงทะเบียน ${deviceInfo.name} ที่ ${deviceInfo.locationTag} สำเร็จพร้อมใช้งาน`);
  };

  const handleRunStagedFirmwareUpdate = async (peripheralId?: string) => {
    try {
      setUpdatingFirmware(true);
      setFirmwareUpdateProgress(10);
      setFirmwareCurrentStage('Stage 1: Digital Signature & SHA-256 Checksum Verification');
      setFirmwareLogs(['[Staged Update Engine] เริ่มต้นกระบวนการอัปเดตเฟิร์มแวร์ฮาร์ดแวร์แบบเป็นขั้นตอน...']);

      setTimeout(() => {
        setFirmwareUpdateProgress(35);
        setFirmwareCurrentStage('Stage 2: EEPROM Backup & ROM Buffer Pre-Allocation');
        setFirmwareLogs((prev) => [
          ...prev,
          '[Stage 1 OK] ตรวจสอบลายเซ็นดิจิทัล SHA-256 Checksum ผ่าน (0x9F42AE)',
          '[Stage 2] สำรองข้อมูล EEPROM Configuration และจัดสรร ROM Buffer...',
        ]);
      }, 1000);

      setTimeout(() => {
        setFirmwareUpdateProgress(70);
        setFirmwareCurrentStage('Stage 3: Flashing Microcode Blocks to Non-Volatile Flash Memory');
        setFirmwareLogs((prev) => [
          ...prev,
          '[Stage 2 OK] EEPROM Backup สำเร็จ',
          '[Stage 3] เขียนทับบล็อก Microcode เข้าสู่ Flash Memory (Block 0x0000 - 0x7FFF)...',
        ]);
      }, 2200);

      setTimeout(() => {
        setFirmwareUpdateProgress(90);
        setFirmwareCurrentStage('Stage 4: Post-Flash Hardware Cold Reboot & Handshake Validation');
        setFirmwareLogs((prev) => [
          ...prev,
          '[Stage 3 OK] เขียน Flash Memory ครบทุกบล็อก 100%',
          '[Stage 4] สั่งการ Cold Reboot และรอสัญญาณ Handshake ยืนยันเฟิร์มแวร์ใหม่...',
        ]);
      }, 3400);

      const res = await fetch('/api/v1/infrastructure/firmware-update/staged', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peripheralId }),
      });
      const data = await res.json();

      setTimeout(() => {
        setFirmwareUpdateProgress(100);
        setFirmwareCurrentStage('Stage 5: Firmware Patched & WHQL Signature Verified');
        setFirmwareLogs((prev) => [
          ...prev,
          '[Stage 4 OK] Cold Reboot และ Handshake ยืนยันสำเร็จ',
          `[COMPLETED] อัปเดตเฟิร์มแวร์อุปกรณ์จำนวน ${data.updatedCount} รายการ สำเร็จสมบูรณ์!`,
        ]);

        if (data.success) {
          setPeripherals(data.updatedPeripherals);
          fetchData(); // Refresh health & firmware alerts
          addToast({
            type: 'success',
            title: 'Staged Firmware Update สำเร็จ!',
            message: `อัปเดตเฟิร์มแวร์อุปกรณ์จำนวน ${data.updatedCount} รายการ เข้าสู่เวอร์ชันล่าสุดเรียบร้อย`,
            durationMs: 5000,
          });
          setActionMessage(`[Staged Update Completed] อัปเดตเฟิร์มแวร์ฮาร์ดแวร์ ${data.updatedCount} รายการ สำเร็จสมบูรณ์`);
        }
        setUpdatingFirmware(false);
      }, 4400);
    } catch {
      setUpdatingFirmware(false);
      addToast({
        type: 'error',
        title: 'การอัปเดตเฟิร์มแวร์ขัดข้อง',
        message: 'ไม่สามารถทำกระบวนการ Staged Firmware Update ได้',
        durationMs: 4000,
      });
    }
  };

  const handleApplyPatch = async (alertId: string) => {
    try {
      setActionMessage('กำลังติดตั้ง Security / Performance Patch อัตโนมัติ...');
      const res = await fetch('/api/v1/infrastructure/apply-patch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alertId }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(`ติดตั้งแพตช์ความปลอดภัย (${data.alert.advisory.title}) สำเร็จ`);
        await fetchData();
      }
    } catch {
      setActionMessage('การติดตั้งแพตช์ล้มเหลว');
    }
  };

  const handleAutoConfigurePeripheral = async (peripheralId: string) => {
    try {
      setActivePeripheralIds((prev) => new Set(prev).add(peripheralId));
      setActionMessage('Antigravity AI กำลังส่งสัญญาณ Handshake และติดตั้ง Driver Profile อัตโนมัติ...');
      const res = await fetch('/api/v1/infrastructure/peripheral-autoconfig', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peripheralId }),
      });
      const data = await res.json();
      if (data.success) {
        addToast({
          type: 'success',
          title: `Auto-Configure สำเร็จ: ${data.peripheral.name}`,
          message: `ติดตั้งโปรไฟล์ไดรเวอร์และเปิดใช้งานลิงก์ Handshake เรียบร้อย`,
          durationMs: 4000,
        });
        setActionMessage(`กำหนดค่า ${data.peripheral.name} แบบอัตโนมัติสำเร็จ อุปกรณ์พร้อมใช้งานทันที`);
        await fetchData();
      }
    } catch {
      setActionMessage('การกำหนดค่าอัตโนมัติล้มเหลว');
    } finally {
      setTimeout(() => {
        setActivePeripheralIds((prev) => {
          const next = new Set(prev);
          next.delete(peripheralId);
          return next;
        });
      }, 1500);
    }
  };

  const handleUpdateDriver = async (deviceId: string) => {
    try {
      setActionMessage('กำลังติดตั้งอัปเดตไดรเวอร์อัตโนมัติ...');
      const res = await fetch('/api/v1/infrastructure/devices/update-driver', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(`อัปเดตไดรเวอร์ของ ${data.device.name} เป็นเวอร์ชัน ${data.device.driverVersion} เรียบร้อยแล้ว`);
        await fetchData();
      }
    } catch {
      setActionMessage('อัปเดตไดรเวอร์ไม่สำเร็จ');
    }
  };

  const handleAuditPeripheral = async (peripheralId?: string) => {
    try {
      if (peripheralId) {
        setAuditingPeripheralId(peripheralId);
        setActivePeripheralIds((prev) => new Set(prev).add(peripheralId));
        setActionMessage('Antigravity AI กำลังตรวจสอบความสมบูรณ์ของไดรเวอร์และลายเซ็นฮาร์ดแวร์...');
      } else {
        setAuditingAll(true);
        peripherals.forEach((p) => setActivePeripheralIds((prev) => new Set(prev).add(p.id)));
        setActionMessage('Antigravity AI กำลังรันการตรวจสอบเชิงลึกฮาร์ดแวร์ต่อพ่วงทั้งหมด (Printers, Scanners, Drawers)...');
      }

      const res = await fetch('/api/v1/infrastructure/hardware-peripherals/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peripheralId }),
      });
      const data = await res.json();
      if (data.success) {
        setPeripherals(data.auditedPeripherals);
        setActionMessage(data.log?.actionTaken || 'การตรวจสอบสุขภาพฮาร์ดแวร์และไดรเวอร์โดย Antigravity สำเร็จ');
        await fetchData();
      } else {
        setActionMessage('การตรวจสอบฮาร์ดแวร์ล้มเหลว: ' + data.error);
      }
    } catch {
      setActionMessage('เกิดข้อผิดพลาดในการเชื่อมต่อกับ Antigravity Service');
    } finally {
      setAuditingPeripheralId(null);
      setAuditingAll(false);
      setTimeout(() => {
        setActivePeripheralIds(new Set());
      }, 1500);
    }
  };

  const handleTestPeripheralSignal = (peripheral: HardwarePeripheralStatus) => {
    setTestingDeviceId(peripheral.id);
    setActivePeripheralIds((prev) => new Set(prev).add(peripheral.id));
    setFailedPeripheralIds((prev) => {
      const next = new Set(prev);
      next.delete(peripheral.id);
      return next;
    });

    let actionDesc = '';
    if (peripheral.category === 'printer') actionDesc = 'ส่งคำสั่งทดสอบการพิมพ์ (Test ESC/POS Print Pulse)';
    else if (peripheral.category === 'scanner') actionDesc = 'ส่งสัญญาณเสียงทดสอบสแกนเนอร์ (Beep Signal 2.4kHz)';
    else if (peripheral.category === 'drawer') actionDesc = 'ส่งสัญญาณทดสอบเปิดลิ้นชัก (Kick Pulse 24V / 100ms)';
    else actionDesc = 'ส่งคำสั่ง Ping ทดสอบการเชื่อมต่ออุปกรณ์';

    setActionMessage(`[Antigravity Diagnostic] ${actionDesc} ไปยัง ${peripheral.name} สำเร็จ (Latency: ${peripheral.connectivity.latencyMs}ms)`);
    setTimeout(() => {
      setTestingDeviceId(null);
      setActivePeripheralIds((prev) => {
        const next = new Set(prev);
        next.delete(peripheral.id);
        return next;
      });
    }, 1200);
  };

  const handleRunDiagnostics = async (peripheral: HardwarePeripheralStatus, simulateFailure = false) => {
    const maxAttempts = 3;
    let attempt = 0;
    let success = false;

    setDiagnosingPeripheralId(peripheral.id);
    setActivePeripheralIds((prev) => new Set(prev).add(peripheral.id));
    setFailedPeripheralIds((prev) => {
      const next = new Set(prev);
      next.delete(peripheral.id);
      return next;
    });

    while (attempt < maxAttempts && !success) {
      attempt++;
      try {
        if (attempt > 1) {
          const backoffMs = Math.pow(2, attempt - 1) * 1000; // 2s, 4s
          setActionMessage(`[Exponential Backoff Retry] พยายามเชื่อมต่อครั้งที่ ${attempt}/${maxAttempts} ไปยัง ${peripheral.name} ในอีก ${backoffMs / 1000}s...`);
          await new Promise((r) => setTimeout(r, backoffMs));
        } else {
          setActionMessage(`Antigravity AI กำลังส่งสัญญาณ Connection Handshake (SYN/ACK) ไปยัง ${peripheral.name} (ครั้งที่ ${attempt})...`);
        }

        const res = await fetch('/api/v1/infrastructure/hardware-peripherals/diagnostics-handshake', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peripheralId: peripheral.id, simulateFailure }),
        });
        const data = await res.json();

        if (data.success && data.handshake) {
          success = true;
          addToast({
            type: 'success',
            title: `Handshake สำเร็จ (Retry #${attempt}): ${peripheral.name}`,
            message: `ตอบสนองใน ${data.handshake.roundTripTimeMs} ms • ${data.handshake.details}`,
            durationMs: 5000,
          });
          setActionMessage(`[Handshake Success] ${peripheral.name} ผ่านการตรวจสอบในการลองครั้งที่ ${attempt} (Round-Trip: ${data.handshake.roundTripTimeMs}ms)`);
          if (data.peripheral) {
            setPeripherals((prev) =>
              prev.map((p) => (p.id === data.peripheral.id ? data.peripheral : p))
            );
          }
          setTimeout(() => {
            setActivePeripheralIds((prev) => {
              const next = new Set(prev);
              next.delete(peripheral.id);
              return next;
            });
          }, 1500);
        } else if (attempt < maxAttempts) {
          console.warn(`[Diagnostics Retry] Attempt ${attempt} failed for ${peripheral.name}. Retrying with exponential backoff...`);
        } else {
          const errorMsg = data.error || 'การเชื่อมต่อขัดข้อง (No Handshake Response from device)';
          addToast({
            type: 'error',
            title: `Handshake ล้มเหลวหลังพยายาม ${maxAttempts} ครั้ง: ${peripheral.name}`,
            message: errorMsg,
            durationMs: 6000,
          });
          setActionMessage(`[Handshake Error] ${peripheral.name}: ${errorMsg} (Exhausted ${maxAttempts} retries)`);
          setFailedPeripheralIds((prev) => new Set(prev).add(peripheral.id));
          setActivePeripheralIds((prev) => {
            const next = new Set(prev);
            next.delete(peripheral.id);
            return next;
          });
        }
      } catch (err: any) {
        if (attempt >= maxAttempts) {
          const errMsg = err?.message || 'ไม่สามารถส่งสัญญาณ Handshake ได้';
          addToast({
            type: 'error',
            title: `ข้อผิดพลาดในการวินิจฉัยหลังพยายาม ${maxAttempts} ครั้ง: ${peripheral.name}`,
            message: errMsg,
            durationMs: 6000,
          });
          setActionMessage(`[Handshake Failed] ${peripheral.name}: ${errMsg}`);
          setFailedPeripheralIds((prev) => new Set(prev).add(peripheral.id));
          setActivePeripheralIds((prev) => {
            const next = new Set(prev);
            next.delete(peripheral.id);
            return next;
          });
        }
      }
    }

    setDiagnosingPeripheralId(null);
  };

  const handleSetPulseState = (peripheralId: string, state: PeripheralHealthPulseState | 'auto') => {
    if (state === 'auto') {
      setPulseOverrides((prev) => {
        const next = { ...prev };
        delete next[peripheralId];
        return next;
      });
      setFailedPeripheralIds((prev) => {
        const next = new Set(prev);
        next.delete(peripheralId);
        return next;
      });
      setActivePeripheralIds((prev) => {
        const next = new Set(prev);
        next.delete(peripheralId);
        return next;
      });
    } else {
      setPulseOverrides((prev) => ({ ...prev, [peripheralId]: state }));
      if (state === 'error') {
        setFailedPeripheralIds((prev) => new Set(prev).add(peripheralId));
        setActivePeripheralIds((prev) => {
          const next = new Set(prev);
          next.delete(peripheralId);
          return next;
        });
      } else if (state === 'active') {
        setActivePeripheralIds((prev) => new Set(prev).add(peripheralId));
        setFailedPeripheralIds((prev) => {
          const next = new Set(prev);
          next.delete(peripheralId);
          return next;
        });
      } else {
        setFailedPeripheralIds((prev) => {
          const next = new Set(prev);
          next.delete(peripheralId);
          return next;
        });
        setActivePeripheralIds((prev) => {
          const next = new Set(prev);
          next.delete(peripheralId);
          return next;
        });
      }
    }
  };

  const handleClearPeripheralError = (peripheralId: string) => {
    setFailedPeripheralIds((prev) => {
      const next = new Set(prev);
      next.delete(peripheralId);
      return next;
    });
    setPulseOverrides((prev) => {
      const next = { ...prev };
      delete next[peripheralId];
      return next;
    });
    setPeripherals((prev) =>
      prev.map((p) =>
        p.id === peripheralId
          ? {
              ...p,
              connectivity: { ...p.connectivity, state: 'online' },
              driverHealth: { ...p.driverHealth, status: 'healthy' },
              telemetryData: { ...p.telemetryData, errorCountToday: 0 },
            }
          : p,
      ),
    );
    addToast({
      type: 'success',
      title: 'เคลียร์สถานะ Error สำเร็จ',
      message: 'อุปกรณ์กลับคืนสู่สถานะ IDLE / พร้อมใช้งานปกติเรียบร้อยแล้ว',
      durationMs: 3000,
    });
  };

  const handleSimulateDeviceError = (targetPeripheralId?: string) => {
    const target =
      (targetPeripheralId && peripherals.find((p) => p.id === targetPeripheralId)) ||
      peripherals.find((p) => getPeripheralPulseState(p) !== 'error' && !p.isMaintenanceMode) ||
      peripherals[0];

    if (!target) return;

    setPulseOverrides((prev) => ({ ...prev, [target.id]: 'error' }));
    setFailedPeripheralIds((prev) => new Set(prev).add(target.id));
    setActivePeripheralIds((prev) => {
      const next = new Set(prev);
      next.delete(target.id);
      return next;
    });
    setPeripherals((prev) =>
      prev.map((p) =>
        p.id === target.id
          ? {
              ...p,
              driverHealth: { ...p.driverHealth, status: 'degraded' },
              telemetryData: {
                ...p.telemetryData,
                errorCountToday: Math.max(1, p.telemetryData.errorCountToday + 1),
              },
            }
          : p,
      ),
    );
    setActionMessage(
      `[System Alert Triggered] ตรวจพบสถานะ ERROR บนอุปกรณ์ "${target.name}" (พอร์ต ${target.port}) — ระบบส่งเสียงเตือนไซเรนและแสดง Framer-Motion Toast Notification มุมจอแล้ว`,
    );
  };

  const handleSimulateDeviceOffline = (targetPeripheralId?: string) => {
    const target =
      (targetPeripheralId && peripherals.find((p) => p.id === targetPeripheralId)) ||
      peripherals.find(
        (p) => p.connectivity.state !== 'disconnected' && !p.isMaintenanceMode,
      ) ||
      peripherals[0];

    if (!target) return;

    setPulseOverrides((prev) => {
      const next = { ...prev };
      delete next[target.id];
      return next;
    });
    setActivePeripheralIds((prev) => {
      const next = new Set(prev);
      next.delete(target.id);
      return next;
    });
    setPeripherals((prev) =>
      prev.map((p) =>
        p.id === target.id
          ? {
              ...p,
              connectivity: {
                ...p.connectivity,
                state: 'disconnected',
                latencyMs: 0,
              },
            }
          : p,
      ),
    );
    setActionMessage(
      `[System Notification Service] อุปกรณ์ "${target.name}" (พอร์ต ${target.port}) เปลี่ยนสถานะเป็น OFFLINE — แสดง Framer-Motion Toast Notification มุมจอแล้ว`,
    );
  };

  const handleSimulatePulseWave = () => {
    peripherals.forEach((p, idx) => {
      setTimeout(() => {
        setActivePeripheralIds((prev) => new Set(prev).add(p.id));
        setTimeout(() => {
          setActivePeripheralIds((prev) => {
            const next = new Set(prev);
            next.delete(p.id);
            return next;
          });
        }, 1200);
      }, idx * 220);
    });
    addToast({
      type: 'info',
      title: 'Real-time Health Pulse Wave',
      message: 'เริ่มส่งสัญญาณทดสอบ Health Pulse (Active Transmission) ไปยังทุกอุปกรณ์',
      durationMs: 3500,
    });
  };

  const getPeripheralPulseState = (peripheral: HardwarePeripheralStatus): PeripheralHealthPulseState => {
    if (pulseOverrides[peripheral.id]) {
      return pulseOverrides[peripheral.id];
    }
    if (
      diagnosingPeripheralId === peripheral.id ||
      testingDeviceId === peripheral.id ||
      auditingPeripheralId === peripheral.id ||
      activePeripheralIds.has(peripheral.id)
    ) {
      return 'active';
    }
    if (
      failedPeripheralIds.has(peripheral.id) ||
      peripheral.connectivity.state === 'disconnected' ||
      peripheral.driverHealth.status === 'degraded' ||
      peripheral.telemetryData.errorCountToday > 0
    ) {
      return 'error';
    }
    return 'idle';
  };

  // Global System Notification Service watcher: triggers framer-motion corner toasts
  // whenever any peripheral's connectivity status transitions to 'Error' or 'Offline'
  useEffect(() => {
    if (peripherals.length === 0) return;
    systemNotificationService.evaluatePeripherals(peripherals, getPeripheralPulseState, {
      notifyOnInitialFault: true,
      notifyOnRecovery: true,
    });
  }, [peripherals, pulseOverrides, failedPeripheralIds]);

  const getCategoryPulseDetails = (peripheral: HardwarePeripheralStatus, state: PeripheralHealthPulseState) => {
    switch (peripheral.category) {
      case 'printer':
        if (state === 'active') return { label: 'ACTIVE • PRINTING', sub: 'กำลังพิมพ์/สปูลใบเสร็จ (ESC/POS)', actionLabel: 'Print Pulse' };
        if (state === 'error') return { label: 'ERROR • PRINTER', sub: 'กระดาษหมด / หัวพิมพ์ร้อน / ฝาเปิด', actionLabel: 'Test Print' };
        return { label: 'IDLE • READY', sub: 'พร้อมพิมพ์ใบเสร็จ • กระดาษปกติ', actionLabel: 'Print Pulse' };
      case 'scanner':
        if (state === 'active') return { label: 'ACTIVE • SCANNING', sub: 'กำลังถอดรหัสบาร์โค้ด / สตรีมข้อมูล', actionLabel: 'Scan Pulse' };
        if (state === 'error') return { label: 'ERROR • SCANNER', sub: 'เซนเซอร์รับแสงขัดข้อง / หมดเวลาเชื่อมต่อ', actionLabel: 'Test Scan' };
        return { label: 'IDLE • ARMED', sub: 'ลำแสงสแตนด์บาย • พร้อมอ่านบาร์โค้ด', actionLabel: 'Scan Pulse' };
      case 'drawer':
        if (state === 'active') return { label: 'ACTIVE • KICK PULSE', sub: 'จ่ายไฟ 24V เปิดลิ้นชักเก็บเงิน', actionLabel: 'Kick Pulse' };
        if (state === 'error') return { label: 'ERROR • DRAWER', sub: 'ไมโครสวิตช์ไม่ปิดสนิท / วงจรเปิด', actionLabel: 'Test Kick' };
        return { label: 'IDLE • LOCKED', sub: 'ลิ้นชักล็อกสนิท • วงจรปกติ', actionLabel: 'Kick Pulse' };
      default:
        if (state === 'active') return { label: 'ACTIVE • TRANSMITTING', sub: 'กำลังส่งข้อมูลการชำระเงิน', actionLabel: 'Test Signal' };
        if (state === 'error') return { label: 'ERROR • TERMINAL', sub: 'การเชื่อมต่ออุปกรณ์ขัดข้อง', actionLabel: 'Test Signal' };
        return { label: 'IDLE • READY', sub: 'เชื่อมต่อและพร้อมรับคำสั่ง', actionLabel: 'Test Signal' };
    }
  };

  const pulseCounts = {
    all: peripherals.length,
    idle: peripherals.filter((p) => getPeripheralPulseState(p) === 'idle').length,
    active: peripherals.filter((p) => getPeripheralPulseState(p) === 'active').length,
    error: peripherals.filter((p) => getPeripheralPulseState(p) === 'error').length,
  };

  const allLocationTags = Array.from(
    new Set(peripherals.flatMap((p) => p.tags || []))
  );

  const filteredPeripherals = peripherals.filter((p) => {
    if (selectedCategory !== 'all' && p.category !== selectedCategory) {
      return false;
    }
    if (selectedPulseFilter !== 'all') {
      const state = getPeripheralPulseState(p);
      if (state !== selectedPulseFilter) return false;
    }
    if (selectedLocationTag !== 'all') {
      if (!p.tags || !p.tags.includes(selectedLocationTag)) {
        return false;
      }
    }
    return true;
  });

  const groupedPeripherals = React.useMemo(() => {
    if (groupingMode !== 'status') return { 'All Devices': filteredPeripherals };
    
    const groups: Record<string, HardwarePeripheralStatus[]> = {
      'Maintenance Mode': [],
      'Offline / Error': [],
      'Online / Idle': [],
    };
    
    filteredPeripherals.forEach(p => {
      if (p.isMaintenanceMode) {
        groups['Maintenance Mode'].push(p);
      } else if (p.connectivity.state === 'disconnected' || getPeripheralPulseState(p) === 'error') {
        groups['Offline / Error'].push(p);
      } else {
        groups['Online / Idle'].push(p);
      }
    });
    
    // Remove empty groups if grouping is active
    if (groupingMode === 'status') {
      Object.keys(groups).forEach(key => {
        if (groups[key].length === 0) delete groups[key];
      });
    }
    
    return groups;
  }, [filteredPeripherals, groupingMode]);

  return (
    <DndContext collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="space-y-6 max-w-7xl mx-auto p-4 sm:p-6">
        {/* Header & Antigravity Banner */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-indigo-900/50 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 text-indigo-400 font-semibold text-xs uppercase tracking-wider mb-2">
              <Zap className="w-4 h-4 text-amber-400 animate-bounce" />
              Antigravity AI™ Infrastructure Supervisor (24/7 Active Autonomous)
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Backend Infrastructure & Plug & Play Center</h1>
            <p className="text-slate-300 text-sm mt-1">
              ระบบดูแลโครงสร้างพื้นฐาน เซิร์ฟเวอร์ ฐานข้อมูล และตรวจจับอุปกรณ์ฮาร์ดแวร์ต่อพ่วงแบบอัตโนมัติเรียลไทม์
            </p>
          </div>
          <div className="flex items-center gap-4">
            <NetworkHealthGauge 
              active={peripherals.filter(p => p.connectivity.state === 'online' || p.connectivity.state === 'connected').length}
              total={peripherals.length}
              size={64}
            />
            <HardwareHealthChart data={pulseCounts} theme={theme} />
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setIsNewDeviceSetupOpen(true)}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-4 py-2.5 rounded-xl shadow-lg transition-all active:scale-95 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>ติดตั้งอุปกรณ์ใหม่ (New Device Setup)</span>
              </button>
              <button
                onClick={handleSelfHeal}
                disabled={healing}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium px-4 py-2.5 rounded-xl shadow-lg transition-all"
              >
                <RefreshCw className={`w-4 h-4 ${healing ? 'animate-spin' : ''}`} />
                {healing ? 'Antigravity กำลังซ่อมแซม...' : 'สั่งการ Antigravity Self-Heal'}
              </button>
            </div>
          </div>
        </div>

        {/* Global Framer-Motion Corner Toast Notifications for Peripheral Error / Offline Transitions */}
        <SystemNotificationToastCorner
          onAutoReconnect={handleAutoReconnect}
          onRemoteReboot={(p) => handleExecuteRemoteReboot(p)}
          onRunDiagnostics={(p) => handleRunDiagnostics(p, false)}
          onClearError={handleClearPeripheralError}
          reconnectingPeripheralId={reconnectingPeripheralId}
          rebootingPeripheralId={rebootingPeripheralId}
          diagnosingPeripheralId={diagnosingPeripheralId}
        />

        {/* System Alert Notification Center (Real-time Hardware Error Acoustic Siren & Remediation Hub) */}
        <SystemAlertNotificationCenter
          peripherals={peripherals}
          getPeripheralPulseState={getPeripheralPulseState}
          onAutoReconnect={handleAutoReconnect}
          onRemoteReboot={(p) => handleExecuteRemoteReboot(p)}
          onRunDiagnostics={(p) => handleRunDiagnostics(p, false)}
          onClearError={handleClearPeripheralError}
          onSimulateDeviceError={handleSimulateDeviceError}
          onSimulateDeviceOffline={handleSimulateDeviceOffline}
          onSelfHealAll={() => {
            peripherals.forEach((p) => {
              if (getPeripheralPulseState(p) === 'error') {
                handleClearPeripheralError(p.id);
              }
            });
            handleSelfHeal();
          }}
          reconnectingPeripheralId={reconnectingPeripheralId}
          rebootingPeripheralId={rebootingPeripheralId}
          diagnosingPeripheralId={diagnosingPeripheralId}
          healingAll={healing}
        />

        {/* End-to-End SystemHealthCheck Utility (Cloud SQL & Firestore Status-Coded JSON Ping) */}
        <SystemHealthCheckCard />

        {/* Real-time Round-Trip Latency Diagnostic Panel (Cloud SQL & Firestore RTT via performance.now()) */}
        <RealtimeLatencyDiagnosticPanel />

        {/* Real-time OfflineBuffer Sync Queue & Connectivity Health Monitor */}
        <OfflineBufferSyncMonitor />

        {/* Background Buffered Diagnostic Log & Firestore Batch Uploader Monitor */}
        <DiagnosticBatchBufferMonitor />

      {/* Comprehensive Hardware Test Suite Component */}
      <HardwareTestSuite />

      {/* Network Topology Connection Path Map (USB vs Bluetooth vs RJ12) */}
      <NetworkTopologyMap peripherals={peripherals} />

      {actionMessage && (
        <div className="bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-indigo-800 dark:text-indigo-200 px-4 py-3 rounded-2xl text-sm flex items-center justify-between">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="text-xs text-indigo-500 hover:underline">ปิด</button>
        </div>
      )}

      {/* Health Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card p-5 rounded-2xl border border-border border-crisp shadow-sm">
          <div className="flex items-center justify-between text-text/60 mb-2">
            <span className="text-xs font-semibold uppercase">สถานะระบบรวม (Health)</span>
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-slate-800 dark:text-slate-100 capitalize">
              {health?.status === 'healthy' ? 'สมบูรณ์ (Healthy)' : health?.status || 'กำลังโหลด...'}
            </span>
          </div>
          <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Antigravity AI Active 24/7
          </p>
        </div>

        <div className="bg-card p-5 rounded-2xl border border-border border-crisp shadow-sm">
          <div className="flex items-center justify-between text-text/60 mb-2">
            <span className="text-xs font-semibold uppercase">การใช้ CPU & Memory</span>
            <Cpu className="w-5 h-5 text-indigo-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-800 dark:text-slate-100">{health?.cpuUsagePercent ?? 0}%</span>
            <span className="text-xs text-slate-400">CPU (Mem: {health?.memoryUsagePercent ?? 0}%)</span>
          </div>
          <div className="w-full bg-background h-2 rounded-full mt-2 overflow-hidden">
            <div className="bg-indigo-600 h-full rounded-full transition-all duration-500" style={{ width: `${health?.cpuUsagePercent || 0}%` }}></div>
          </div>
        </div>

        <div className="bg-card p-5 rounded-2xl border border-border border-crisp shadow-sm">
          <div className="flex items-center justify-between text-text/60 mb-2">
            <span className="text-xs font-semibold uppercase">Database & API Latency</span>
            <Database className="w-5 h-5 text-amber-500" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-800 dark:text-slate-100">{health?.dbLatencyMs ?? 0} ms</span>
            <span className="text-xs text-emerald-500">PostgreSQL OK</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Active Connections: {health?.activeConnections ?? 0}</p>
        </div>

        <div className="bg-card p-5 rounded-2xl border border-border border-crisp shadow-sm">
          <div className="flex items-center justify-between text-text/60 mb-2">
            <span className="text-xs font-semibold uppercase">Network & Offline Buffer</span>
            {isOnline ? (
              <Wifi className="w-5 h-5 text-cyan-500" />
            ) : (
              <WifiOff className="w-5 h-5 text-rose-500" />
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-800 dark:text-slate-100 font-mono tabular-nums">
              {isOnline ? (syncLatencyMs !== null ? `${syncLatencyMs} ms` : 'Online') : 'Offline'}
            </span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${
              isOnline
                ? syncLatencyQuality === 'optimal'
                  ? 'text-emerald-500 border-emerald-500/20 bg-emerald-500/10'
                  : 'text-cyan-500 border-cyan-500/20 bg-cyan-500/10'
                : 'text-rose-500 border-rose-500/20 bg-rose-500/10'
            }`}>
              {isOnline ? (isSimulatedOffline ? 'Sim Offline' : syncLatencyQuality.toUpperCase()) : 'Buffer Active'}
            </span>
          </div>
          <p className="text-xs text-text/60 mt-1 flex items-center justify-between font-mono">
            <span>Buffer Queue: {pendingCount}</span>
            <span className={pendingCount === 0 ? 'text-emerald-500 font-semibold' : 'text-amber-500 font-semibold'}>
              {pendingCount === 0 ? 'Zero Pending' : `${pendingCount} In Queue`}
            </span>
          </p>
        </div>
      </div>

      {/* Real-time Hardware Peripherals Status Card (Printers, Scanners, Drawers) */}
      <div className="bg-card rounded-3xl border border-border border-crisp shadow-sm p-6 space-y-6">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-4 border-b border-border border-crisp">
          <div>
            <div className="flex items-center gap-2 text-indigo-500 font-semibold text-xs uppercase tracking-wider mb-1">
              <Zap className="w-4 h-4 text-amber-400" />
              Antigravity™ Autonomous Hardware & Peripheral Management
            </div>
            <h2 className="text-xl font-bold text-text flex items-center gap-2.5">
              <HardDrive className="w-6 h-6 text-indigo-600" />
              สถานะฮาร์ดแวร์ต่อพ่วงแบบเรียลไทม์ (Printers, Scanners, Cash Drawers)
            </h2>
            <p className="text-xs text-text/60 mt-0.5">
              ระบบตรวจสอบสถานะการเชื่อมต่อ (Connectivity), ระดับแบตเตอรี่ (Battery Levels), และความสมบูรณ์ของไดรเวอร์ (Driver Health Status) ควบคุมโดย Antigravity Service ตลอด 24 ชม.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-background border border-border border-crisp text-xs font-medium text-text/80">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Live Telemetry: Active
            </div>
            <button
              onClick={() => handleAuditPeripheral()}
              disabled={auditingAll}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all active:scale-95 cursor-pointer"
            >
              <Sparkles className={`w-3.5 h-3.5 ${auditingAll ? 'animate-spin' : ''}`} />
              {auditingAll ? 'Antigravity กำลังตรวจสอบ...' : 'ตรวจสอบอุปกรณ์ทั้งหมดด้วย AI'}
            </button>
          </div>
        </div>

        {/* Device Profiles (Store Role Configurations) */}
        <div className="p-4 rounded-2xl bg-background/90 border border-border border-crisp space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-xl bg-indigo-500/10 text-indigo-500">
                <Layers className="w-4 h-4" />
              </span>
              <div>
                <h3 className="text-xs font-bold text-text uppercase tracking-wider">โปรไฟล์อุปกรณ์ฮาร์ดแวร์ตามบทบาท (Store Role Device Profiles)</h3>
                <p className="text-[11px] text-text/60">คลิกสลับชุดการตั้งค่าฮาร์ดแวร์และกรองอุปกรณ์สำหรับตำแหน่งงาน (Counter, Kitchen, Bar) ได้ทันที</p>
              </div>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold">
              Active: {deviceProfiles.find(p => p.id === activeProfileId)?.name || 'Custom'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {deviceProfiles.map((profile) => {
              const isActive = activeProfileId === profile.id;
              return (
                <button
                  key={profile.id}
                  onClick={() => handleApplyDeviceProfile(profile.id)}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between space-y-1.5 ${
                    isActive
                      ? 'bg-indigo-600 text-white border-indigo-500 shadow-md ring-2 ring-indigo-500/20'
                      : 'bg-card hover:bg-background border-border border-crisp text-text'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1">
                    <span className={`text-xs font-bold truncate ${isActive ? 'text-white' : 'text-text'}`}>
                      {profile.name}
                    </span>
                    {isActive && <Check className="w-3.5 h-3.5 text-white shrink-0 mt-0.5" />}
                  </div>
                  <div className={`text-[10px] ${isActive ? 'text-indigo-100' : 'text-text/60'}`}>
                    {profile.role}
                  </div>
                  <div className={`text-[10px] line-clamp-1 font-mono ${isActive ? 'text-indigo-200' : 'text-text/50'}`}>
                    {profile.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bulk Selection & Management Control Bar */}
        <div className="p-4 rounded-2xl bg-indigo-950/20 border border-indigo-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-xl bg-indigo-600 text-white font-bold flex items-center justify-center">
              <Check className="w-4 h-4" />
            </span>
            <div>
              <div className="font-bold text-text flex items-center gap-2">
                <span>Bulk Hardware Management (การจัดการฮาร์ดแวร์แบบกลุ่ม)</span>
                <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-mono text-[10px]">
                  {selectedPeripheralIds.size} เลือกแล้ว
                </span>
              </div>
              <div className="text-[11px] text-text/60 mt-0.5">ส่งออกไฟล์ Logs วินิจฉัย, รีบูตฮาร์ดแวร์ระยะไกลพร้อมกัน หรือตั้งเวลารีบูตช่วงปิดร้าน</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleSelectAllOffline}
              className="px-3 py-1.5 rounded-xl bg-background hover:bg-card border border-border border-crisp text-text/80 font-semibold text-xs transition-all cursor-pointer"
              title="เลือกอุปกรณ์ทั้งหมดที่ออฟไลน์หรือมีสถานะ Error อัตโนมัติ"
            >
              เลือกอุปกรณ์ออฟไลน์ ({peripherals.filter(p => p.connectivity.state === 'disconnected' || getPeripheralPulseState(p) === 'error').length})
            </button>

            {selectedPeripheralIds.size > 0 && (
              <button
                onClick={() => setSelectedPeripheralIds(new Set())}
                className="px-2.5 py-1.5 rounded-xl bg-background hover:bg-card border border-border text-text/60 text-xs cursor-pointer"
              >
                ล้างการเลือก
              </button>
            )}

            {/* Export Diagnostic Logs Buttons */}
            <div className="inline-flex rounded-xl bg-background border border-border border-crisp p-0.5">
              <button
                onClick={() => handleExportDiagnosticLogs('json')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-text/80 hover:text-indigo-500 font-semibold text-[11px] transition-colors cursor-pointer"
                title="ส่งออกไฟล์บันทึกการวินิจฉัยรูปแบบ JSON"
              >
                <FileJson className="w-3.5 h-3.5 text-indigo-500" />
                <span>Export JSON</span>
              </button>
              <button
                onClick={() => handleExportDiagnosticLogs('csv')}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-text/80 hover:text-emerald-500 font-semibold text-[11px] transition-colors cursor-pointer border-l border-border/60"
                title="ส่งออกไฟล์บันทึกการวินิจฉัยรูปแบบ CSV"
              >
                <FileText className="w-3.5 h-3.5 text-emerald-500" />
                <span>Export CSV</span>
              </button>
            </div>

            {/* Bulk Tag Assignment */}
            <div className="relative group">
              <button
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 text-purple-600 dark:text-purple-400 font-bold text-xs transition-all cursor-pointer disabled:opacity-50"
                disabled={selectedPeripheralIds.size === 0}
              >
                <Tag className="w-3.5 h-3.5 text-purple-500" />
                <span>Assign Tag</span>
                <ChevronDown className="w-3 h-3" />
              </button>
              <div className="absolute right-0 mt-2 w-48 bg-card border border-border rounded-xl shadow-xl hidden group-hover:block z-50">
                {allLocationTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => handleBulkAssignTag(tag)}
                    className="w-full text-left px-4 py-2 text-xs text-text hover:bg-background cursor-pointer"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Schedule Power Cycle Button */}
            <button
              onClick={() => setIsScheduleModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-bold text-xs transition-all cursor-pointer"
              title="ตั้งเวลารีบูต (Power Cycle) สำหรับอุปกรณ์ทั่วไปช่วงหลังปิดร้าน"
            >
              <Clock className="w-3.5 h-3.5 text-amber-500" />
              <span>ตั้งเวลาช่วงปิดร้าน</span>
            </button>

            {/* Power Draw Threshold Setting */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-background border border-border border-crisp">
              <div className="flex items-center gap-1.5 text-text/60">
                <Zap className="w-3.5 h-3.5 text-amber-500" />
                <span className="font-semibold text-[11px] whitespace-nowrap">Alert Threshold:</span>
              </div>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={powerThreshold}
                  onChange={(e) => setPowerThreshold(parseFloat(e.target.value) || 0)}
                  className="w-12 bg-transparent text-text font-bold text-xs focus:outline-none border-b border-indigo-500/50 text-center"
                />
                <span className="text-[10px] font-bold text-text/40">W</span>
              </div>
            </div>

            {/* Bulk Reboot Button */}
            <button
              onClick={handleBulkRebootPeripherals}
              disabled={selectedPeripheralIds.size === 0 || bulkRebooting}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-xs transition-all shadow-md active:scale-95 cursor-pointer"
              title="ส่งคำสั่งรีบูตระยะไกล (Bulk Power Cycle) ไปยังอุปกรณ์ที่เลือกพร้อมกัน"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${bulkRebooting ? 'animate-spin' : ''}`} />
              <span>{bulkRebooting ? 'กำลังรีบูตกลุ่ม...' : `รีบูตที่เลือก (${selectedPeripheralIds.size})`}</span>
            </button>
          </div>
        </div>

        {/* Scheduled Power Cycle Jobs Active Strip */}
        {scheduledJobs.length > 0 && (
          <div className="p-3.5 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <Clock className="w-4 h-4 text-indigo-500 animate-pulse shrink-0" />
              <div>
                <span className="font-bold text-text">
                  มีกำหนดการจัดการฮาร์ดแวร์อัตโนมัติ ({scheduledJobs.length} กำหนดการ)
                </span>
                <div className="text-[11px] text-text/70 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>งานถัดไป:</span>
                  <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] uppercase ${
                    scheduledJobs[0].type === 'STORE_CLOSING' ? 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400' : 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                  }`}>
                    {scheduledJobs[0].type === 'STORE_CLOSING' ? 'Closing Reboot' : 'Smart Auto-Reboot'}
                  </span>
                  <span>ทุกเวลา <code className="bg-card px-1.5 py-0.5 rounded border border-border font-mono font-bold text-text">{scheduledJobs[0].time} น.</code></span>
                  {scheduledJobs[0].type === 'AUTO_REBOOT_HIGH_ERROR' && (
                    <span className="text-rose-600 dark:text-rose-400 font-semibold">เมื่อ Error ≥ {scheduledJobs[0].errorThreshold} ครั้ง</span>
                  )}
                  <span className="text-text/40">•</span>
                  <span>เป้าหมาย: {scheduledJobs[0].targetCount} อุปกรณ์</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setScheduledJobs([])}
              className="px-2.5 py-1 rounded-xl bg-background border border-border text-text/60 text-[11px] font-semibold hover:text-rose-500 hover:border-rose-500/40 transition-all cursor-pointer"
            >
              ยกเลิกกำหนดการทั้งหมด
            </button>
          </div>
        )}

        {/* Real-time KPI Summary Bar */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="bg-background/70 p-3.5 rounded-2xl border border-border border-crisp">
            <div className="text-[11px] font-semibold text-text/60 uppercase">อุปกรณ์เชื่อมต่อออนไลน์</div>
            <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mt-0.5">
              <CheckCircle2 className="w-4 h-4" />
              {peripherals.filter(p => p.connectivity.state === 'online').length} / {peripherals.length} พร้อมใช้งาน
            </div>
            <div className="text-[10px] text-text/50 mt-0.5">สถานะออนไลน์ 100%</div>
          </div>

          <div className="bg-background/70 p-3.5 rounded-2xl border border-border border-crisp">
            <div className="text-[11px] font-semibold text-text/60 uppercase">ความสมบูรณ์ไดรเวอร์</div>
            <div className="text-lg font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5 mt-0.5">
              <ShieldCheck className="w-4 h-4" />
              {peripherals.filter(p => p.driverHealth.status === 'healthy').length} / {peripherals.length} สมบูรณ์
            </div>
            <div className="text-[10px] text-text/50 mt-0.5">Antigravity & WHQL Verified</div>
          </div>

          <div className="bg-background/70 p-3.5 rounded-2xl border border-border border-crisp">
            <div className="text-[11px] font-semibold text-text/60 uppercase">ระบบพลังงาน & แบตเตอรี่</div>
            <div className="text-lg font-bold text-text flex items-center gap-1.5 mt-0.5">
              <Battery className="w-4 h-4 text-amber-500" />
              {peripherals.filter(p => p.battery.levelPercent !== null).length} ไร้สาย • {peripherals.filter(p => p.battery.levelPercent === null).length} ไฟตรง
            </div>
            <div className="text-[10px] text-text/50 mt-0.5">ทุกอุปกรณ์อยู่ในระดับปลอดภัย</div>
          </div>

          <div className="bg-background/70 p-3.5 rounded-2xl border border-border border-crisp">
            <div className="text-[11px] font-semibold text-text/60 uppercase">ความเร็วการตอบสนอง (Latency)</div>
            <div className="text-lg font-bold text-cyan-600 dark:text-cyan-400 flex items-center gap-1.5 mt-0.5">
              <Gauge className="w-4 h-4" />
              {(peripherals.reduce((acc, p) => acc + p.connectivity.latencyMs, 0) / (peripherals.length || 1)).toFixed(1)} ms
            </div>
            <div className="text-[10px] text-text/50 mt-0.5">Ultra Low Hardware Bus Latency</div>
          </div>

          <div className="bg-background/70 p-3.5 rounded-2xl border border-border border-crisp">
            <div className="text-[11px] font-semibold text-text/60 uppercase text-purple-600 dark:text-purple-400">AI Predictive Insights</div>
            <div className={`text-lg font-bold flex items-center gap-1.5 mt-0.5 ${
              peripherals.some(p => p.predictiveAnalysis.maintenanceRecommended) ? 'text-rose-500 animate-pulse' : 'text-emerald-500'
            }`}>
              <BrainCircuit className="w-4 h-4" />
              {peripherals.filter(p => p.predictiveAnalysis.maintenanceRecommended).length} อุปกรณ์เสี่ยง
            </div>
            <div className="text-[10px] text-text/50 mt-0.5">
              ความแม่นยำ AI: 94.2% • {peripherals.filter(p => p.predictiveAnalysis.maintenanceRecommended).length > 0 ? 'ควรตรวจสอบทันที' : 'ระบบปกติ'}
            </div>
          </div>
        </div>

        {/* Category Filter Tabs & Pulse Summary */}
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'all', label: 'ทั้งหมด', count: peripherals.length },
                { id: 'printer', label: 'เครื่องพิมพ์ใบเสร็จ (Printers)', count: peripherals.filter(p => p.category === 'printer').length },
                { id: 'scanner', label: 'เครื่องสแกนบาร์โค้ด (Scanners)', count: peripherals.filter(p => p.category === 'scanner').length },
                { id: 'drawer', label: 'ลิ้นชักเก็บเงิน (Cash Drawers)', count: peripherals.filter(p => p.category === 'drawer').length },
                { id: 'edc', label: 'เครื่อง EDC / บัตรเครดิต', count: peripherals.filter(p => p.category === 'edc').length },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSelectedCategory(tab.id as any)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    selectedCategory === tab.id
                      ? 'bg-primary text-white shadow-sm'
                      : 'bg-background hover:bg-card text-text/70 border border-border border-crisp'
                  }`}
                >
                  {tab.label} <span className="opacity-75">({tab.count})</span>
                </button>
              ))}
            </div>

            <button
              onClick={handleSimulatePulseWave}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 text-xs font-semibold transition-all shadow-sm active:scale-95 cursor-pointer"
              title="ส่งคำสั่งทดสอบ Health Pulse (Active Transmission) ไปยังทุกอุปกรณ์ต่อเนื่องแบบ Cascade Wave"
            >
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              <span>Simulate Pulse Wave</span>
            </button>
          </div>

          {/* Real-time Health Pulse Telemetry Strip */}
          <div className="flex flex-col gap-3 p-3.5 rounded-2xl bg-background/80 border border-border border-crisp">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-text uppercase tracking-wider">
                  <Activity className="w-4 h-4 text-indigo-500" />
                  <span>Real-Time Health Pulses:</span>
                </div>
                <div className="flex items-center gap-2 text-xs font-mono">
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold">
                    <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                      <span className="animate-ring-idle absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="animate-pulse-idle relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                    </span>
                    <span>{pulseCounts.idle} Idle / Ready</span>
                  </span>
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-semibold">
                    <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                      <span className="animate-ring-active absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-80" />
                      <span className="animate-pulse-active relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
                    </span>
                    <span>{pulseCounts.active} Active</span>
                  </span>
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 font-semibold">
                    <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                      <span className="animate-ring-error absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-90" />
                      <span className="animate-pulse-error relative inline-flex rounded-full h-2 w-2 bg-rose-500" />
                    </span>
                    <span>{pulseCounts.error} Error</span>
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-text/60 font-medium">กรองสถานะ:</span>
                  <div className="inline-flex p-1 rounded-xl bg-card border border-border border-crisp text-xs">
                    {(['all', 'idle', 'active', 'error'] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setSelectedPulseFilter(mode)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                          selectedPulseFilter === mode
                            ? mode === 'error'
                              ? 'bg-rose-600 text-white shadow-sm'
                              : mode === 'active'
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : mode === 'idle'
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'bg-primary text-white shadow-sm'
                            : 'text-text/70 hover:text-text'
                        }`}
                      >
                        {mode === 'all' && `ทั้งหมด (${pulseCounts.all})`}
                        {mode === 'idle' && `Idle (${pulseCounts.idle})`}
                        {mode === 'active' && `Active (${pulseCounts.active})`}
                        {mode === 'error' && `Error (${pulseCounts.error})`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Grid vs List View Toggle Switch */}
                <div className="flex items-center gap-1.5 pl-2 border-l border-border/60">
                  <span className="text-[11px] text-text/60 font-medium">มุมมอง:</span>
                  <div className="inline-flex p-1 rounded-xl bg-card border border-border border-crisp text-xs">
                    <button
                      onClick={() => setViewMode('grid')}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                        viewMode === 'grid'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-text/70 hover:text-text'
                      }`}
                      title="Grid View (มุมมองตารางการ์ด)"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                      <span>Grid</span>
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer ${
                        viewMode === 'list'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-text/70 hover:text-text'
                      }`}
                      title="List View (มุมมองรายการกะทัดรัด)"
                    >
                      <List className="w-3.5 h-3.5" />
                      <span>List</span>
                    </button>
                  </div>
                </div>

                {/* Group By Status Toggle */}
                <div className="flex items-center gap-1.5 pl-2 border-l border-border/60">
                  <span className="text-[11px] text-text/60 font-medium">จัดกลุ่ม:</span>
                  <button
                    onClick={() => setGroupingMode(groupingMode === 'status' ? 'none' : 'status')}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-[11px] font-semibold transition-all cursor-pointer border ${
                      groupingMode === 'status'
                        ? 'bg-indigo-600 text-white border-indigo-500 shadow-sm' 
                        : 'bg-card text-text/70 border-border hover:text-text'
                    }`}
                    title="จัดกลุ่มอุปกรณ์ตามสถานะการเชื่อมต่อ (Maintenance, Offline, Online)"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>ตามสถานะ</span>
                  </button>
                </div>

                {/* Physical Store Location Filter Pills */}
                <div className="flex items-center gap-1.5 pl-2 border-l border-border/60">
                  <span className="text-[11px] text-text/60 font-medium flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5 text-indigo-500" />
                    สถานที่:
                  </span>
                  <div className="inline-flex p-1 rounded-xl bg-card border border-border border-crisp text-xs overflow-x-auto max-w-xs sm:max-w-md">
                    <button
                      onClick={() => setSelectedLocationTag('all')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                        selectedLocationTag === 'all'
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-text/70 hover:text-text'
                      }`}
                    >
                      ทุกจุดบริการ ({peripherals.length})
                    </button>
                    {allLocationTags.map((tag) => {
                      const count = peripherals.filter((p) => p.tags?.includes(tag)).length;
                      return (
                        <button
                          key={tag}
                          onClick={() => setSelectedLocationTag(tag)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap ${
                            selectedLocationTag === tag
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'text-text/70 hover:text-text'
                          }`}
                        >
                          {tag} ({count})
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Core Peripherals Pulse Matrix: Printers, Scanners, Cash Drawers */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-2 border-t border-border border-crisp">
              {/* 1. Printers Pulse Status */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-card border border-border border-crisp text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-500 flex items-center justify-center">
                    <Printer className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-text">Printers (เครื่องพิมพ์)</div>
                    <div className="text-[10px] text-text/60">ESC/POS Thermal Engines</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold" title="Printers Idle/Ready">
                    <span className="animate-pulse-idle inline-block w-2 h-2 rounded-full bg-emerald-500" />
                    {peripherals.filter(p => p.category === 'printer' && getPeripheralPulseState(p) === 'idle').length}
                  </span>
                  <span className="text-text/30">•</span>
                  <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-semibold" title="Printers Active/Printing">
                    <span className="animate-pulse-active inline-block w-2 h-2 rounded-full bg-indigo-500" />
                    {peripherals.filter(p => p.category === 'printer' && getPeripheralPulseState(p) === 'active').length}
                  </span>
                  <span className="text-text/30">•</span>
                  <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold" title="Printers Error">
                    <span className="animate-pulse-error inline-block w-2 h-2 rounded-full bg-rose-500" />
                    {peripherals.filter(p => p.category === 'printer' && getPeripheralPulseState(p) === 'error').length}
                  </span>
                </div>
              </div>

              {/* 2. Scanners Pulse Status */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-card border border-border border-crisp text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                    <Scan className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-text">Scanners (สแกนเนอร์)</div>
                    <div className="text-[10px] text-text/60">2D / QR Optical Engines</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold" title="Scanners Idle/Armed">
                    <span className="animate-pulse-idle inline-block w-2 h-2 rounded-full bg-emerald-500" />
                    {peripherals.filter(p => p.category === 'scanner' && getPeripheralPulseState(p) === 'idle').length}
                  </span>
                  <span className="text-text/30">•</span>
                  <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-semibold" title="Scanners Active/Decoding">
                    <span className="animate-pulse-active inline-block w-2 h-2 rounded-full bg-indigo-500" />
                    {peripherals.filter(p => p.category === 'scanner' && getPeripheralPulseState(p) === 'active').length}
                  </span>
                  <span className="text-text/30">•</span>
                  <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold" title="Scanners Error">
                    <span className="animate-pulse-error inline-block w-2 h-2 rounded-full bg-rose-500" />
                    {peripherals.filter(p => p.category === 'scanner' && getPeripheralPulseState(p) === 'error').length}
                  </span>
                </div>
              </div>

              {/* 3. Cash Drawers Pulse Status */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-card border border-border border-crisp text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/10 text-amber-500 flex items-center justify-center">
                    <Banknote className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-text">Cash Drawers (ลิ้นชัก)</div>
                    <div className="text-[10px] text-text/60">24V Solenoid & Microswitch</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 font-mono text-[11px]">
                  <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold" title="Cash Drawers Idle/Locked">
                    <span className="animate-pulse-idle inline-block w-2 h-2 rounded-full bg-emerald-500" />
                    {peripherals.filter(p => p.category === 'drawer' && getPeripheralPulseState(p) === 'idle').length}
                  </span>
                  <span className="text-text/30">•</span>
                  <span className="flex items-center gap-1 text-indigo-600 dark:text-indigo-400 font-semibold" title="Cash Drawers Active/Kick">
                    <span className="animate-pulse-active inline-block w-2 h-2 rounded-full bg-indigo-500" />
                    {peripherals.filter(p => p.category === 'drawer' && getPeripheralPulseState(p) === 'active').length}
                  </span>
                  <span className="text-text/30">•</span>
                  <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400 font-semibold" title="Cash Drawers Error">
                    <span className="animate-pulse-error inline-block w-2 h-2 rounded-full bg-rose-500" />
                    {peripherals.filter(p => p.category === 'drawer' && getPeripheralPulseState(p) === 'error').length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Live Network Topology Map (D3 & SVG Interactive Map) */}
        <NetworkTopologyMap peripherals={peripherals} />

        {/* Peripherals Cards Grid with CSS Health Pulse Animations */}
        {viewMode === 'floorplan' ? (
          <FloorPlanView peripherals={peripherals} onUpdatePosition={handleUpdatePosition} />
        ) : viewMode === 'grid' ? (
          <div className="flex flex-col gap-10">
            {Object.entries(groupedPeripherals).map(([groupName, groupPeripherals]) => (
              <div key={groupName} className="space-y-4">
                {groupingMode === 'status' && (
                  <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                    <div className={`w-2 h-2 rounded-full ${
                      groupName === 'Maintenance Mode' ? 'bg-amber-500' :
                      groupName === 'Offline / Error' ? 'bg-rose-500' : 'bg-emerald-500'
                    }`} />
                    <h2 className="text-sm font-bold text-text uppercase tracking-wider">{groupName} ({groupPeripherals.length})</h2>
                  </div>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {groupPeripherals.map((peripheral) => {
            const isAuditing = auditingPeripheralId === peripheral.id;
            const pulseState = getPeripheralPulseState(peripheral);
            const pulseDetails = getCategoryPulseDetails(peripheral, pulseState);

            return (
              <div
                key={peripheral.id}
                className={`bg-card rounded-2xl border transition-all p-5 flex flex-col justify-between space-y-4 relative overflow-hidden animate-card-entrance animate-state-pop ${
                  pulseState === 'active'
                    ? 'border-indigo-500/60 ring-2 ring-indigo-500/20 shadow-[0_0_20px_rgba(99,102,241,0.18)]'
                    : pulseState === 'error'
                    ? 'border-rose-500/60 ring-2 ring-rose-500/25 shadow-[0_0_20px_rgba(239,68,68,0.22)]'
                    : 'border-border border-crisp hover:border-emerald-500/40 shadow-sm'
                }`}
              >
                {/* Remote Reboot In-Progress Overlay */}
                {rebootingPeripheralId === peripheral.id && (
                  <div className="absolute inset-0 bg-background/90 backdrop-blur-xs z-30 flex flex-col items-center justify-center p-6 text-center space-y-3 animate-fade-in">
                    <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-500 flex items-center justify-center animate-spin">
                      <RotateCcw className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-text">กำลังรีบูตฮาร์ดแวร์ระยะไกล (Power Cycle)...</h4>
                      <p className="text-xs text-text/60 mt-1">ส่งสัญญาณ DTR Pulse รีเซ็ตไฟกระแสตรงอุปกรณ์ {peripheral.name}</p>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-mono text-indigo-500 font-semibold bg-card px-3 py-1 rounded-full border border-border">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Restarting Power Rails & Re-establishing Bus Link...</span>
                    </div>
                  </div>
                )}

                {/* Visual Top Glow Accent Line according to pulse state */}
                <div
                  className={`absolute top-0 left-0 right-0 h-1 transition-all ${
                    pulseState === 'active'
                      ? 'bg-gradient-to-r from-indigo-500 via-cyan-400 to-indigo-600 animate-pulse'
                      : pulseState === 'error'
                      ? 'bg-gradient-to-r from-rose-600 via-amber-500 to-rose-600 animate-pulse'
                      : 'bg-gradient-to-r from-emerald-500/50 via-teal-400/50 to-emerald-500/50'
                  }`}
                />

                {/* Peripheral Header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    {/* Bulk Selection Checkbox */}
                    <div className="flex items-center pt-2.5">
                      <input
                        type="checkbox"
                        checked={selectedPeripheralIds.has(peripheral.id)}
                        onChange={() => handleToggleSelectPeripheral(peripheral.id)}
                        className="w-4 h-4 rounded border-border text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        title="เลือกอุปกรณ์นี้สำหรับการรีบูตกลุ่ม (Bulk Reboot)"
                      />
                    </div>

                    <div className="relative">
                      {/* CSS Real-time Expanding Ring Animation */}
                      {pulseState === 'active' && (
                        <span className="animate-ring-active absolute -inset-1 rounded-2xl bg-indigo-500/25 pointer-events-none" />
                      )}
                      {pulseState === 'error' && (
                        <span className="animate-ring-error absolute -inset-1 rounded-2xl bg-rose-500/30 pointer-events-none" />
                      )}
                      {pulseState === 'idle' && (
                        <span className="animate-ring-idle absolute -inset-0.5 rounded-2xl bg-emerald-500/15 pointer-events-none" />
                      )}

                      <div
                        className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 relative z-10 transition-transform ${
                          pulseState === 'active'
                            ? 'scale-105 ring-2 ring-indigo-500/50'
                            : pulseState === 'error'
                            ? 'ring-2 ring-rose-500/60'
                            : ''
                        } ${
                          peripheral.category === 'printer'
                            ? 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20'
                            : peripheral.category === 'scanner'
                            ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                            : peripheral.category === 'drawer'
                            ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                            : 'bg-purple-500/10 text-purple-500 border border-purple-500/20'
                        }`}
                      >
                        {peripheral.category === 'printer' && <Printer className="w-5 h-5" />}
                        {peripheral.category === 'scanner' && <Scan className="w-5 h-5" />}
                        {peripheral.category === 'drawer' && <Banknote className="w-5 h-5" />}
                        {peripheral.category === 'edc' && <CreditCard className="w-5 h-5" />}
                      </div>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        {editingNamePeripheralId === peripheral.id ? (
                          <div className="flex items-center gap-1.5 bg-background p-1 rounded-xl border border-indigo-500 shadow-sm">
                            <input
                              type="text"
                              value={editingNameInput}
                              onChange={(e) => setEditingNameInput(e.target.value)}
                              placeholder="เช่น พริ้นเตอร์โต๊ะแคชเชียร์ 1..."
                              className="px-2 py-0.5 text-xs font-bold bg-transparent text-text focus:outline-none w-48 sm:w-64"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  handleSavePeripheralName(peripheral.id);
                                }
                                if (e.key === 'Escape') {
                                  setEditingNamePeripheralId(null);
                                }
                              }}
                            />
                            <button
                              onClick={() => handleSavePeripheralName(peripheral.id)}
                              className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] cursor-pointer flex items-center gap-0.5 shadow-xs"
                              title="บันทึกชื่อ/นามเรียกขานอุปกรณ์ (Save Alias)"
                            >
                              <Check className="w-3 h-3" />
                              <span>บันทึก</span>
                            </button>
                            <button
                              onClick={() => setEditingNamePeripheralId(null)}
                              className="p-1 rounded-lg text-text/40 hover:text-text cursor-pointer"
                              title="ยกเลิก"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 group">
                            <h3 className="font-bold text-sm text-text leading-tight">{peripheral.name}</h3>
                            <button
                              onClick={() => {
                                setEditingNamePeripheralId(peripheral.id);
                                setEditingNameInput(peripheral.name);
                              }}
                              className="opacity-60 group-hover:opacity-100 hover:text-indigo-500 transition-all p-1 rounded-lg hover:bg-indigo-500/10 cursor-pointer flex items-center gap-1 text-[10px] font-medium text-indigo-500"
                              title="คลิกเพื่อตั้งชื่อนามเรียกขานอุปกรณ์ (Edit Custom Alias)"
                            >
                              <Edit2 className="w-3 h-3" />
                              <span className="hidden sm:inline opacity-0 group-hover:opacity-100 transition-opacity">แก้ชื่อ</span>
                            </button>
                          </div>
                        )}

                        {/* Real-time Health Pulse Badge */}
                        <div
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase font-mono transition-all duration-500 ease-in-out ${
                            peripheral.isMaintenanceMode
                              ? 'bg-amber-500/15 border border-amber-500/35 text-amber-600 dark:text-amber-400'
                              : pulseState === 'active'
                              ? 'bg-indigo-500/15 border border-indigo-500/35 text-indigo-600 dark:text-indigo-400'
                              : pulseState === 'error'
                              ? 'bg-rose-500/15 border border-rose-500/35 text-rose-600 dark:text-rose-400'
                              : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                          }`}
                          title={`Health Pulse สถานะเรียลไทม์: ${pulseState.toUpperCase()} - ${pulseDetails.sub}`}
                        >
                          <span className="relative flex h-2 w-2 items-center justify-center">
                            <span
                              className={`absolute inline-flex h-full w-full rounded-full opacity-75 transition-colors duration-500 ${
                                peripheral.isMaintenanceMode
                                  ? 'animate-ring-idle bg-amber-400'
                                  : pulseState === 'active'
                                  ? 'animate-ring-active bg-indigo-400'
                                  : pulseState === 'error'
                                  ? 'animate-ring-error bg-rose-500'
                                  : 'animate-ring-idle bg-emerald-400'
                              }`}
                            />
                            <span
                              className={`relative inline-flex rounded-full h-1.5 w-1.5 transition-colors duration-500 ${
                                peripheral.isMaintenanceMode
                                  ? 'animate-pulse-idle bg-amber-500'
                                  : pulseState === 'active'
                                  ? 'animate-pulse-active bg-indigo-600'
                                  : pulseState === 'error'
                                  ? 'animate-pulse-error bg-rose-600'
                                  : 'animate-pulse-idle bg-emerald-500'
                              }`}
                            />
                          </span>
                          <span>{peripheral.isMaintenanceMode ? 'MAINTENANCE' : pulseDetails.label}</span>
                        </div>
                      </div>

                      <div className="text-[11px] text-text/60 font-mono mt-0.5 flex flex-wrap items-center gap-2">
                        <span>{peripheral.model} • SN: {peripheral.serialNumber}</span>
                        <span className="text-text/30">•</span>
                        <span className={`text-[10px] font-sans font-medium ${
                          pulseState === 'active'
                            ? 'text-indigo-600 dark:text-indigo-400'
                            : pulseState === 'error'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-text/60'
                        }`}>
                          {pulseDetails.sub}
                        </span>
                      </div>

                      {/* Location Tags Strip */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className="text-[10px] text-text/50 font-medium flex items-center gap-1 shrink-0">
                          <MapPin className="w-3 h-3 text-indigo-500" />
                          สถานที่:
                        </span>
                        {peripheral.tags && peripheral.tags.length > 0 ? (
                          peripheral.tags.map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20"
                            >
                              <span>{tag}</span>
                              <button
                                onClick={() => {
                                  const updated = (peripheral.tags || []).filter((t) => t !== tag);
                                  handleSavePeripheralTags(peripheral.id, updated);
                                }}
                                className="text-indigo-400 hover:text-rose-500 transition-colors cursor-pointer"
                                title="ลบแท็กสถานที่"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-text/40 italic">ยังไม่ได้ระบุตำแหน่ง</span>
                        )}

                        {editingTagsPeripheralId === peripheral.id ? (
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="text"
                              value={newTagInput}
                              onChange={(e) => setNewTagInput(e.target.value)}
                              placeholder="เช่น Counter 1, Kitchen..."
                              className="w-28 px-1.5 py-0.5 text-[10px] rounded bg-background border border-indigo-500 text-text focus:outline-none"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && newTagInput.trim()) {
                                  const current = peripheral.tags || [];
                                  handleSavePeripheralTags(peripheral.id, [...current, newTagInput.trim()]);
                                }
                              }}
                            />
                            <button
                              onClick={() => {
                                if (newTagInput.trim()) {
                                  const current = peripheral.tags || [];
                                  handleSavePeripheralTags(peripheral.id, [...current, newTagInput.trim()]);
                                }
                              }}
                              className="px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[9px] font-bold cursor-pointer"
                            >
                              บันทึก
                            </button>
                            <button
                              onClick={() => {
                                setEditingTagsPeripheralId(null);
                                setNewTagInput('');
                              }}
                              className="text-text/40 hover:text-text text-[9px] cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingTagsPeripheralId(peripheral.id);
                              setNewTagInput('');
                            }}
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg border border-dashed border-indigo-500/40 hover:border-indigo-500 text-indigo-500 text-[9px] font-medium transition-colors cursor-pointer"
                            title="เพิ่มสถานที่ฮาร์ดแวร์"
                          >
                            <Plus className="w-2.5 h-2.5" />
                            <span>เพิ่มจุด</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="font-mono text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-background border border-border border-crisp text-text/70 shrink-0">
                      {peripheral.port}
                    </span>

                    {/* Interactive State Pulse Test Switcher */}
                    <div className="flex items-center gap-1 p-0.5 rounded-lg bg-background border border-border border-crisp text-[9px] font-mono">
                      <span className="px-1 text-text/40 uppercase font-sans">Sim:</span>
                      <button
                        onClick={() => handleSetPulseState(peripheral.id, 'idle')}
                        className={`px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                          pulseState === 'idle' && pulseOverrides[peripheral.id] === 'idle'
                            ? 'bg-emerald-500 text-white font-bold'
                            : 'text-text/60 hover:text-emerald-500'
                        }`}
                        title="จำลองสถานะ Idle Pulse (เขียว)"
                      >
                        Idle
                      </button>
                      <button
                        onClick={() => handleSetPulseState(peripheral.id, 'active')}
                        className={`px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                          pulseState === 'active' && pulseOverrides[peripheral.id] === 'active'
                            ? 'bg-indigo-600 text-white font-bold'
                            : 'text-text/60 hover:text-indigo-500'
                        }`}
                        title="จำลองสถานะ Active Pulse (คราม)"
                      >
                        Active
                      </button>
                      <button
                        onClick={() => handleSetPulseState(peripheral.id, 'error')}
                        className={`px-1.5 py-0.5 rounded transition-all cursor-pointer ${
                          pulseState === 'error' && pulseOverrides[peripheral.id] === 'error'
                            ? 'bg-rose-600 text-white font-bold'
                            : 'text-text/60 hover:text-rose-500'
                        }`}
                        title="จำลองสถานะ Error Pulse (แดง)"
                      >
                        Error
                      </button>
                      {pulseOverrides[peripheral.id] && (
                        <button
                          onClick={() => handleSetPulseState(peripheral.id, 'auto')}
                          className="px-1 text-text/40 hover:text-text cursor-pointer"
                          title="คืนค่าสู่สถานะตรวจจับอัตโนมัติ (Auto)"
                        >
                          Auto
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                {/* Physical Connectivity & Network Path Indicator */}
                {peripheral.connectivity.networkPath && (
                  <div className="p-3 rounded-2xl bg-indigo-950/20 border border-indigo-500/30 text-xs space-y-1.5 shadow-xs">
                    <div className="flex items-center justify-between text-[10px] font-bold text-indigo-500 uppercase tracking-wider">
                      <span className="flex items-center gap-1.5">
                        <Route className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Physical Network Path & Terminal Link</span>
                      </span>
                      <span className="font-mono text-text/60">
                        {peripheral.connectivity.networkPath.terminalId}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 font-mono text-[11px] pt-0.5">
                      <div className="flex items-center gap-1.5 font-bold text-text truncate">
                        <Monitor className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                        <span className="truncate">{peripheral.connectivity.networkPath.terminalName}</span>
                      </div>

                      <div className="flex items-center gap-1 text-[10px] shrink-0 font-bold px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/25">
                        <Share2 className="w-3 h-3 text-amber-400" />
                        <span>{peripheral.connectivity.networkPath.connectionType}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-text/60 font-mono pt-1 border-t border-border/40">
                      <span>Hop Address: <strong className="text-text">{peripheral.connectivity.networkPath.ipOrBus}</strong></span>
                      <span className="text-emerald-500 font-semibold flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                        Link Active
                      </span>
                    </div>
                  </div>
                )}

                {/* AI Predictive Analysis & Maintenance Alert */}
                <div className="p-3 rounded-2xl bg-background/60 border border-border border-crisp space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-text/50">
                    <div className="flex items-center gap-1.5">
                      <BrainCircuit className="w-3.5 h-3.5 text-purple-500" />
                      <span>AI Predictive Analysis</span>
                    </div>
                    <span className={`font-mono ${
                      peripheral.predictiveAnalysis.reliabilityScore > 80 ? 'text-emerald-500' : 
                      peripheral.predictiveAnalysis.reliabilityScore > 50 ? 'text-amber-500' : 'text-rose-500'
                    }`}>
                      Reliability: {peripheral.predictiveAnalysis.reliabilityScore}%
                    </span>
                  </div>
                  
                  {peripheral.predictiveAnalysis.maintenanceRecommended ? (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-[11px] text-rose-600 dark:text-rose-400 font-bold animate-pulse">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                        <span>Preventative Maintenance Required</span>
                      </div>
                      <p className="text-[10px] text-text/70 italic leading-relaxed pl-1">
                        {peripheral.predictiveAnalysis.analysisInsight}
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>สุขภาพอุปกรณ์อยู่ในเกณฑ์ปกติ - คาดการณ์เวลาขัดข้อง: {peripheral.predictiveAnalysis.estimatedTimeToFailureDays} วัน</span>
                    </div>
                  )}
                </div>

                {/* Status Sections: 3-column subgrid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                  {/* 1. Live Connectivity & Pulse Status */}
                  <div className="bg-background/60 p-3 rounded-xl border border-border border-crisp space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-text/50 flex items-center justify-between">
                      <span>Connectivity</span>
                      <span className={`flex items-center gap-1.5 font-bold text-[10px] font-mono transition-colors duration-500 ${
                        peripheral.isMaintenanceMode
                          ? 'text-amber-600 dark:text-amber-400'
                          : pulseState === 'active'
                          ? 'text-indigo-600 dark:text-indigo-400'
                          : pulseState === 'error'
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}>
                        <span className="relative flex h-2 w-2 items-center justify-center">
                          <span
                            className={`absolute inline-flex h-full w-full rounded-full opacity-75 transition-colors duration-500 ${
                              peripheral.isMaintenanceMode
                                ? 'animate-ring-idle bg-amber-400'
                                : pulseState === 'active'
                                ? 'animate-ring-active bg-indigo-400'
                                : pulseState === 'error'
                                ? 'animate-ring-error bg-rose-500'
                                : 'animate-ring-idle bg-emerald-400'
                            }`}
                          />
                          <span
                            className={`relative inline-flex rounded-full h-1.5 w-1.5 transition-colors duration-500 ${
                              peripheral.isMaintenanceMode
                                ? 'animate-pulse-idle bg-amber-500'
                                : pulseState === 'active'
                                ? 'animate-pulse-active bg-indigo-600'
                                : pulseState === 'error'
                                ? 'animate-pulse-error bg-rose-600'
                                : 'animate-pulse-idle bg-emerald-500'
                            }`}
                          />
                        </span>
                        {peripheral.isMaintenanceMode
                          ? 'MAINTENANCE'
                          : pulseState === 'active'
                          ? 'TRANSMITTING'
                          : pulseState === 'error'
                          ? 'ERROR / CHECK'
                          : peripheral.connectivity.state.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
                      {peripheral.connectivity.interface === 'USB' && <Usb className="w-3.5 h-3.5 text-blue-500" />}
                      {peripheral.connectivity.interface === 'Bluetooth_LE' && <Bluetooth className="w-3.5 h-3.5 text-cyan-500" />}
                      {peripheral.connectivity.interface === 'RJ12_Drawer_Kick' && <Zap className="w-3.5 h-3.5 text-amber-500" />}
                      {peripheral.connectivity.interface === 'Ethernet' && <Wifi className="w-3.5 h-3.5 text-indigo-500" />}
                      <span>{peripheral.connectivity.interface.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="text-[10px] text-text/60 flex items-center justify-between pt-0.5">
                      <span>Latency:</span>
                      <span className="font-mono font-bold text-text">{peripheral.connectivity.latencyMs} ms</span>
                    </div>
                    {peripheral.connectivity.signalStrengthPercent && (
                      <div className="text-[10px] text-text/60 flex items-center justify-between">
                        <span className="flex items-center gap-1"><Signal className="w-2.5 h-2.5 text-cyan-500" /> สัญญาณ:</span>
                        <span className="font-mono font-bold text-cyan-600 dark:text-cyan-400">{peripheral.connectivity.signalStrengthPercent}%</span>
                      </div>
                    )}
                  </div>

                  {/* 2. Battery & Power Status */}
                  <div className="bg-background/60 p-3 rounded-xl border border-border border-crisp space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-text/50 flex items-center justify-between">
                      <span>Battery & Power</span>
                      {peripheral.battery.levelPercent !== null ? (
                        <span className={`text-[10px] font-mono font-bold ${
                          peripheral.battery.levelPercent > 50 ? 'text-emerald-500' : peripheral.battery.levelPercent > 20 ? 'text-amber-500' : 'text-rose-500'
                        }`}>
                          {peripheral.battery.levelPercent}%
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-indigo-400">Mains AC</span>
                      )}
                    </div>

                    {peripheral.battery.levelPercent !== null ? (
                      <>
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
                          {peripheral.battery.isCharging ? (
                            <BatteryCharging className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                          ) : (
                            <Battery className="w-3.5 h-3.5 text-emerald-500" />
                          )}
                          <span>{peripheral.battery.isCharging ? 'กำลังชาร์จไฟ' : 'แบตเตอรี่ Li-Ion'}</span>
                        </div>
                        <div className="w-full bg-background h-1.5 rounded-full overflow-hidden mt-1">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              peripheral.battery.levelPercent > 50 ? 'bg-emerald-500' : peripheral.battery.levelPercent > 20 ? 'bg-amber-500' : 'bg-rose-500'
                            }`}
                            style={{ width: `${peripheral.battery.levelPercent}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-text/60">
                          {peripheral.battery.healthStatus === 'optimal' ? 'สุขภาพเซลล์: ดีเยี่ยม' : 'สุขภาพเซลล์: ปกติ'}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-text">
                          <Plug className="w-3.5 h-3.5 text-indigo-500" />
                          <span>
                            {peripheral.battery.powerSource === 'ac_mains'
                              ? 'AC 220V Mains'
                              : peripheral.battery.powerSource === 'rj12_pulse'
                              ? '24V Solenoid Kick'
                              : 'USB 5V Bus Power'}
                          </span>
                        </div>
                        <div className="text-[10px] text-text/60 pt-1">
                          จ่ายไฟต่อเนื่อง ไม่มีปัญหาแบตหมด
                        </div>
                      </>
                    )}

                    <div className="pt-2 border-t border-border/30 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-text/50 font-medium">Estimated Draw:</span>
                        <div className="flex items-center gap-1.5">
                          <Zap className={`w-3 h-3 ${
                            (peripheral.currentPowerDrawWatts || 0) > (peripheral.category === 'printer' ? 14 : peripheral.category === 'drawer' ? 10 : 6)
                              ? 'text-rose-500 animate-pulse'
                              : 'text-amber-500'
                          }`} />
                          <span className={`text-[11px] font-mono font-bold ${
                            (peripheral.currentPowerDrawWatts || 0) > (peripheral.category === 'printer' ? 14 : peripheral.category === 'drawer' ? 10 : 6)
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-text'
                          }`}>
                            {peripheral.currentPowerDrawWatts}W
                          </span>
                        </div>
                      </div>
                      
                      {(peripheral.currentPowerDrawWatts || 0) > (peripheral.category === 'printer' ? 14 : peripheral.category === 'drawer' ? 10 : 6) && (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-[9px] font-black text-rose-600 dark:text-rose-400 uppercase tracking-tighter">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          <span>Power Spike Detected</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 3. Driver Health & Firmware Status */}
                  <div className="bg-background/60 p-3 rounded-xl border border-border border-crisp space-y-1.5">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-text/50 flex items-center justify-between">
                      <span>Firmware & Driver</span>
                      <span className="text-[10px] font-mono text-text/60">Drv v{peripheral.driverVersion}</span>
                    </div>
                    <div className="flex items-center justify-between gap-1 text-xs">
                      <span className="font-mono font-semibold text-text">FW: {peripheral.firmwareVersion}</span>
                      {peripheral.firmwareVersion !== peripheral.latestDriverVersion && (
                        <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 font-bold text-[9px] uppercase animate-pulse flex items-center gap-0.5">
                          <DownloadCloud className="w-2.5 h-2.5 shrink-0" />
                          Update ({peripheral.latestDriverVersion})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 pt-0.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      <span className="truncate">Antigravity Verified</span>
                    </div>
                    <div className="text-[10px] text-text/50 truncate">
                      ตรวจสอบ: {new Date(peripheral.driverHealth.lastAuditTimestamp).toLocaleTimeString('th-TH')}
                    </div>
                  </div>
                </div>

                {/* Eco Sleep Mode Active Banner */}
                {peripheral.isPowerSaveMode && (
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-between text-xs text-amber-800 dark:text-amber-200">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold">
                      <Moon className="w-3.5 h-3.5 text-amber-500 animate-pulse shrink-0" />
                      <span>อยู่ในโหมดประหยัดพลังงาน (Standby Sleep Mode • {peripheral.powerSaveWatts || 0.2}W)</span>
                    </div>
                    <button
                      onClick={() => handleTogglePowerSave(peripheral.id, false)}
                      className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold text-[10px] transition-colors cursor-pointer"
                    >
                      Wake Up
                    </button>
                  </div>
                )}

                {/* 24-Hour Uptime & Stability Sparkline Chart Widget */}
                <div className="p-3 rounded-xl bg-background/70 border border-border border-crisp space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1.5 font-semibold text-text">
                      <Activity className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Uptime & Stability (24 Hours)</span>
                    </div>
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-xs">
                      {peripheral.connectivity.state === 'online' ? '99.8%' : '84.2%'} สถิตเสถียร
                    </span>
                  </div>

                  {/* SVG Sparkline Graph */}
                  <div className="relative h-10 w-full flex items-end">
                    <svg viewBox="0 0 240 40" className="w-full h-10 overflow-visible">
                      <defs>
                        <linearGradient id={`spark-grad-${peripheral.id}`} x1="0%" y1="0%" x2="0%" y2="100%">
                          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.35" />
                          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                      {/* Area Fill */}
                      <path
                        d="M 0 32 Q 20 28 40 22 T 80 18 T 120 25 T 160 12 T 200 15 T 240 10 L 240 40 L 0 40 Z"
                        fill={`url(#spark-grad-${peripheral.id})`}
                      />
                      {/* Line Path */}
                      <path
                        d="M 0 32 Q 20 28 40 22 T 80 18 T 120 25 T 160 12 T 200 15 T 240 10"
                        fill="none"
                        stroke="#6366f1"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      {/* Interactive Data Points */}
                      <circle cx="40" cy="22" r="2.5" fill="#3b82f6" />
                      <circle cx="120" cy="25" r="2.5" fill="#6366f1" />
                      <circle cx="160" cy="12" r="2.5" fill="#10b981" />
                      <circle cx="240" cy="10" r="3" fill="#10b981" className="animate-ping" />
                      <circle cx="240" cy="10" r="3" fill="#10b981" />
                    </svg>
                  </div>
                  <div className="flex items-center justify-between text-[9px] font-mono text-text/50 pt-0.5">
                    <span>-24h (00:00)</span>
                    <span>-18h</span>
                    <span>-12h</span>
                    <span>-6h</span>
                    <span className="text-emerald-500 font-bold">Now (Live)</span>
                  </div>
                </div>

                {/* Diagnostics box from Antigravity */}
                <div className="p-3 rounded-xl bg-background/80 border border-border border-crisp text-[11px] text-text/80 font-mono leading-relaxed">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">
                    <Activity className="w-3 h-3" />
                    Antigravity AI Diagnostics Log
                  </div>
                  <div>{peripheral.driverHealth.diagnostics}</div>
                </div>

                {/* Error Recovery Banner if in Error State or Disconnected */}
                {(pulseState === 'error' || peripheral.connectivity.state === 'disconnected') && (
                  <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[11px] text-rose-600 dark:text-rose-400">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{peripheral.connectivity.state === 'disconnected' ? 'อุปกรณ์ออฟไลน์ / หลุดการเชื่อมต่อ' : 'พบสัญญาณขัดข้อง (Error State)'}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleAutoReconnect(peripheral)}
                        disabled={reconnectingPeripheralId === peripheral.id}
                        className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50 shadow-sm"
                        title="สั่งการ Auto-Reconnect กู้คืนการเชื่อมต่อพอร์ตอัตโนมัติ"
                      >
                        <RefreshCw className={`w-3 h-3 ${reconnectingPeripheralId === peripheral.id ? 'animate-spin' : ''}`} />
                        <span>{reconnectingPeripheralId === peripheral.id ? 'กำลังเชื่อมต่อ...' : 'Auto-Reconnect'}</span>
                      </button>
                      <button
                        onClick={() => handleClearPeripheralError(peripheral.id)}
                        className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-semibold transition-all cursor-pointer"
                      >
                        Clear Error
                      </button>
                    </div>
                  </div>
                )}

                {/* Card Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border border-crisp text-xs">
                  <div className="text-[10px] text-text/50 font-mono">
                    {peripheral.telemetryData.operationsCountToday} คำสั่งวันนี้ • {peripheral.telemetryData.errorCountToday} Error
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Power Save Toggle Switch */}
                    <button
                      onClick={() => handleTogglePowerSave(peripheral.id, !peripheral.isPowerSaveMode)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition-all cursor-pointer ${
                        peripheral.isPowerSaveMode
                          ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400 shadow-sm'
                          : 'bg-background hover:bg-card border-border/70 text-text/80'
                      }`}
                      title={peripheral.isPowerSaveMode ? 'คลิกเพื่อออกจากโหมดประหยัดพลังงาน (Wake Up)' : 'คลิกเพื่อเข้าสู่โหมดประหยัดพลังงาน (Eco Sleep 0.2W)'}
                    >
                      <Moon className={`w-3.5 h-3.5 ${peripheral.isPowerSaveMode ? 'text-amber-500 animate-pulse' : 'text-text/50'}`} />
                      <span>{peripheral.isPowerSaveMode ? 'Eco Sleep' : 'Power Save'}</span>
                    </button>

                    <button
                      onClick={() => handleRunDiagnostics(peripheral, false)}
                      disabled={diagnosingPeripheralId === peripheral.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[11px] font-semibold transition-all shadow-sm active:scale-95 cursor-pointer"
                      title="ส่งสัญญาณ Handshake (SYN/ACK) ทดสอบการเชื่อมต่ออุปกรณ์และรายงาน Toast"
                    >
                      <Activity className={`w-3.5 h-3.5 ${diagnosingPeripheralId === peripheral.id ? 'animate-spin' : ''}`} />
                      {diagnosingPeripheralId === peripheral.id ? 'Handshaking...' : 'Run Diagnostics'}
                    </button>
                    <button
                      onClick={() => handleRunDiagnostics(peripheral, true)}
                      disabled={diagnosingPeripheralId === peripheral.id}
                      className="px-2 py-1.5 rounded-xl bg-background hover:bg-rose-500/10 hover:border-rose-500/30 border border-border border-crisp text-text/70 hover:text-rose-600 dark:hover:text-rose-400 text-[10px] font-medium transition-colors cursor-pointer"
                      title="ทดสอบกรณี Handshake ล้มเหลวเพื่อตรวจ Toast Error"
                    >
                      Simulate Fail
                    </button>
                    <button
                      onClick={() => handleTestPeripheralSignal(peripheral)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-background hover:bg-card border border-border border-crisp text-text/80 text-[10px] font-medium transition-colors cursor-pointer"
                      title={`ส่งสัญญาณกระตุ้นการทำงานชั่วคราว (${pulseDetails.actionLabel})`}
                    >
                      {peripheral.category === 'printer' && <Printer className="w-3 h-3 text-indigo-500" />}
                      {peripheral.category === 'scanner' && <Scan className="w-3 h-3 text-emerald-500" />}
                      {peripheral.category === 'drawer' && <Banknote className="w-3 h-3 text-amber-500" />}
                      {peripheral.category === 'edc' && <CreditCard className="w-3 h-3 text-purple-500" />}
                      <span>{pulseDetails.actionLabel}</span>
                    </button>
                    <button
                      onClick={() => handleAuditPeripheral(peripheral.id)}
                      disabled={isAuditing}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-background hover:bg-card border border-border border-crisp text-text/80 text-[11px] font-medium transition-colors cursor-pointer"
                      title="สั่งการ Antigravity ตรวจสอบสุขภาพไดรเวอร์และลายเซ็นดิจิทัล"
                    >
                      <RefreshCw className={`w-3 h-3 ${isAuditing ? 'animate-spin' : ''}`} />
                      {isAuditing ? 'กำลังตรวจ...' : 'AI Audit'}
                    </button>
                    <button
                      onClick={() => setRebootConfirmPeripheral(peripheral)}
                      disabled={rebootingPeripheralId === peripheral.id}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-[11px] font-semibold transition-all cursor-pointer disabled:opacity-50"
                      title="ส่งสัญญาณตัดและจ่ายไฟใหม่ (Power Cycle / Cold Reboot) เพื่อแก้ไขอาการค้าง"
                    >
                      <RotateCcw className={`w-3.5 h-3.5 ${rebootingPeripheralId === peripheral.id ? 'animate-spin' : ''}`} />
                      <span>{rebootingPeripheralId === peripheral.id ? 'กำลัง Cold Boot...' : 'รีบูต'}</span>
                    </button>
                    <button
                      onClick={() => setTerminalPeripheral(peripheral)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] font-semibold transition-all cursor-pointer shadow-sm active:scale-95"
                      title="เปิด Diagnostic Terminal เพื่อดู System Logs เรียลไทม์"
                    >
                      <Terminal className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Terminal</span>
                    </button>
                    <button
                      onClick={() => handleToggleMaintenanceMode(peripheral)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold transition-all cursor-pointer ${
                        peripheral.isMaintenanceMode
                          ? 'bg-amber-500 text-white border-amber-600 shadow-sm'
                          : 'bg-background hover:bg-card border-border text-text/70'
                      }`}
                      title={peripheral.isMaintenanceMode ? 'ปิดโหมดซ่อมบำรุง (เปิดรับแจ้งเตือนปกติ)' : 'เปิดโหมดซ่อมบำรุง (ระงับแจ้งเตือนอุปกรณ์นี้ชั่วคราว)'}
                    >
                      <Wrench className={`w-3.5 h-3.5 ${peripheral.isMaintenanceMode ? 'animate-pulse text-white' : 'text-text/50'}`} />
                      <span>{peripheral.isMaintenanceMode ? 'Maintenance ON' : 'Service Mode'}</span>
                    </button>
                  </div>
                </div>
              </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View Table Branch */
          <div className="bg-card rounded-2xl border border-border border-crisp shadow-sm overflow-hidden animate-card-entrance">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-background/80 text-text/60 text-[11px] uppercase border-b border-border border-crisp font-mono">
                    <th className="py-3.5 px-4 font-semibold">สถานะ (Pulse)</th>
                    <th className="py-3.5 px-4 font-semibold">อุปกรณ์ (Device)</th>
                    <th className="py-3.5 px-4 font-semibold">สถานที่ (Location)</th>
                    <th className="py-3.5 px-4 font-semibold">พอร์ต / Interface</th>
                    <th className="py-3.5 px-4 font-semibold">Driver Health</th>
                    <th className="py-3.5 px-4 font-semibold">Predictive AI</th>
                    <th className="py-3.5 px-4 font-semibold">Latency / Ops</th>
                    <th className="py-3.5 px-4 font-semibold text-right">การจัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40 font-sans">
                  {Object.entries(groupedPeripherals).map(([groupName, groupPeripherals]) => (
                    <React.Fragment key={groupName}>
                      {groupingMode === 'status' && (
                        <tr className="bg-background/40">
                          <td colSpan={8} className="py-2.5 px-4">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${
                                groupName === 'Maintenance Mode' ? 'bg-amber-500' :
                                groupName === 'Offline / Error' ? 'bg-rose-500' : 'bg-emerald-500'
                              }`} />
                              <span className="text-[10px] font-black uppercase tracking-widest text-text/60">{groupName} ({groupPeripherals.length})</span>
                            </div>
                          </td>
                        </tr>
                      )}
                      {groupPeripherals.map((peripheral) => {
                    const isAuditing = auditingPeripheralId === peripheral.id;
                    const pulseState = getPeripheralPulseState(peripheral);
                    const pulseDetails = getCategoryPulseDetails(peripheral, pulseState);

                    return (
                      <tr key={peripheral.id} className="hover:bg-background/50 transition-colors">
                        <td className="py-3 px-4 shrink-0 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-bold uppercase font-mono border transition-all duration-500 ease-in-out ${
                              peripheral.isMaintenanceMode
                                ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400'
                                : pulseState === 'active'
                                ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400'
                                : pulseState === 'error'
                                ? 'bg-rose-500/15 border-rose-500/40 text-rose-600 dark:text-rose-400 animate-pulse'
                                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${
                              peripheral.isMaintenanceMode ? 'bg-amber-500 animate-pulse' :
                              pulseState === 'active' ? 'bg-indigo-500 animate-ping' :
                              pulseState === 'error' ? 'bg-rose-500 animate-bounce' : 'bg-emerald-500 animate-pulse'
                            }`} />
                            {peripheral.isMaintenanceMode ? 'MAINTENANCE' : pulseDetails.label}
                          </span>
                        </td>

                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <span className="w-8 h-8 rounded-xl bg-background border border-border flex items-center justify-center shrink-0">
                              {peripheral.category === 'printer' && <Printer className="w-4 h-4 text-indigo-500" />}
                              {peripheral.category === 'scanner' && <Scan className="w-4 h-4 text-emerald-500" />}
                              {peripheral.category === 'drawer' && <Banknote className="w-4 h-4 text-amber-500" />}
                              {peripheral.category === 'edc' && <CreditCard className="w-4 h-4 text-purple-500" />}
                            </span>
                            <div>
                              {editingNamePeripheralId === peripheral.id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={editingNameInput}
                                    onChange={(e) => setEditingNameInput(e.target.value)}
                                    placeholder="นามเรียกขานอุปกรณ์..."
                                    className="px-2 py-0.5 text-xs font-bold rounded bg-background border border-indigo-500 text-text focus:outline-none w-40"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleSavePeripheralName(peripheral.id);
                                      }
                                      if (e.key === 'Escape') {
                                        setEditingNamePeripheralId(null);
                                      }
                                    }}
                                  />
                                  <button
                                    onClick={() => handleSavePeripheralName(peripheral.id)}
                                    className="p-1 rounded bg-indigo-600 text-white cursor-pointer"
                                    title="บันทึก"
                                  >
                                    <Check className="w-3 h-3" />
                                  </button>
                                  <button
                                    onClick={() => setEditingNamePeripheralId(null)}
                                    className="p-1 rounded text-text/40 hover:text-text cursor-pointer"
                                    title="ยกเลิก"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 group">
                                  <span className="font-bold text-text">{peripheral.name}</span>
                                  <button
                                    onClick={() => {
                                      setEditingNamePeripheralId(peripheral.id);
                                      setEditingNameInput(peripheral.name);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 hover:text-indigo-500 transition-opacity p-0.5 rounded cursor-pointer"
                                    title="แก้ไขนามเรียกขานอุปกรณ์"
                                  >
                                    <Edit2 className="w-3 h-3" />
                                  </button>
                                </div>
                              )}
                              <div className="text-[10px] text-text/60 font-mono">{peripheral.model} • SN: {peripheral.serialNumber}</div>
                            </div>
                          </div>
                        </td>

                        {/* Location Tag Cell */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex flex-wrap items-center gap-1">
                            {peripheral.tags && peripheral.tags.length > 0 ? (
                              peripheral.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 inline-flex items-center gap-1"
                                >
                                  <MapPin className="w-2.5 h-2.5" />
                                  {tag}
                                </span>
                              ))
                            ) : (
                              <span className="text-[10px] text-text/40 italic">-</span>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-4 font-mono text-text/80 whitespace-nowrap space-y-1">
                          <span className="px-2 py-0.5 rounded bg-background border border-border text-[10px] font-semibold block w-fit">
                            {peripheral.port}
                          </span>
                          {peripheral.connectivity.networkPath && (
                            <div className="flex items-center gap-1 text-[10px] text-indigo-600 dark:text-indigo-400 font-sans font-medium">
                              <Monitor className="w-3 h-3 text-cyan-500 shrink-0" />
                              <span>{peripheral.connectivity.networkPath.terminalName}</span>
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold text-[10px]">
                            <ShieldCheck className="w-3 h-3" />
                            {peripheral.driverHealth.driverSignStatus === 'whql_certified' ? 'WHQL Certified' : 'AI Verified'}
                          </span>
                        </td>

                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5">
                              <BrainCircuit className={`w-3.5 h-3.5 ${
                                peripheral.predictiveAnalysis.reliabilityScore > 80 ? 'text-emerald-500' :
                                peripheral.predictiveAnalysis.reliabilityScore > 50 ? 'text-amber-500' : 'text-rose-500'
                              }`} />
                              <span className={`font-bold font-mono text-[11px] ${
                                peripheral.predictiveAnalysis.reliabilityScore > 80 ? 'text-emerald-600 dark:text-emerald-400' :
                                peripheral.predictiveAnalysis.reliabilityScore > 50 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
                              }`}>
                                {peripheral.predictiveAnalysis.reliabilityScore}%
                              </span>
                            </div>
                            {peripheral.predictiveAnalysis.maintenanceRecommended && (
                              <span className="text-[9px] font-bold text-rose-500 uppercase animate-pulse flex items-center gap-0.5">
                                <ShieldAlert className="w-2.5 h-2.5" /> Maintenance Required
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-4 font-mono whitespace-nowrap">
                          <div className="text-text font-semibold">{peripheral.connectivity.latencyMs} ms</div>
                          <div className="text-[10px] text-text/50">{peripheral.telemetryData.operationsCountToday} ops</div>
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleTogglePowerSave(peripheral.id, !peripheral.isPowerSaveMode)}
                              className={`px-2 py-1 rounded-lg border text-[10px] font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                                peripheral.isPowerSaveMode
                                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-600 dark:text-amber-400'
                                  : 'bg-background hover:bg-card border-border text-text/80'
                              }`}
                              title={peripheral.isPowerSaveMode ? 'Wake Up (ออกจากโหมดสแตนด์บาย)' : 'Power Save (สแตนด์บายโหมดกินไฟต่ำ 0.2W)'}
                            >
                              <Moon className={`w-3 h-3 ${peripheral.isPowerSaveMode ? 'text-amber-500 animate-pulse' : 'text-text/50'}`} />
                              <span>{peripheral.isPowerSaveMode ? 'Eco Sleep' : 'Power Save'}</span>
                            </button>

                            <button
                              onClick={() => handleRunDiagnostics(peripheral, false)}
                              disabled={diagnosingPeripheralId === peripheral.id}
                              className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[10px] transition-all cursor-pointer shadow-sm active:scale-95 disabled:opacity-50"
                              title="Run Diagnostics"
                            >
                              {diagnosingPeripheralId === peripheral.id ? 'Handshaking...' : 'Diagnostics'}
                            </button>
                            <button
                              onClick={() => handleTestPeripheralSignal(peripheral)}
                              className="px-2 py-1 rounded-lg bg-background hover:bg-card border border-border text-text/80 font-medium text-[10px] transition-all cursor-pointer"
                              title={pulseDetails.actionLabel}
                            >
                              Pulse
                            </button>
                            <button
                              onClick={() => handleAuditPeripheral(peripheral.id)}
                              disabled={isAuditing}
                              className="px-2 py-1 rounded-lg bg-background hover:bg-card border border-border text-text/80 font-medium text-[10px] transition-all cursor-pointer disabled:opacity-50"
                              title="AI Audit"
                            >
                              {isAuditing ? 'Auditing...' : 'AI Audit'}
                            </button>
                            <button
                              onClick={() => setTerminalPeripheral(peripheral)}
                              className="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-all cursor-pointer shadow-sm active:scale-95"
                              title="Terminal"
                            >
                              <Terminal className="w-3.5 h-3.5 text-emerald-500" />
                            </button>
                            <button
                              onClick={() => setRebootConfirmPeripheral(peripheral)}
                              disabled={rebootingPeripheralId === peripheral.id}
                              className="px-2 py-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-600 dark:text-rose-400 font-semibold text-[10px] transition-all cursor-pointer flex items-center gap-1 disabled:opacity-50"
                              title="รีบูตฮาร์ดแวร์ระยะไกล (Remote Power Cycle)"
                            >
                              <RotateCcw className={`w-3 h-3 ${rebootingPeripheralId === peripheral.id ? 'animate-spin' : ''}`} />
                              <span>{rebootingPeripheralId === peripheral.id ? 'Rebooting...' : 'รีบูต'}</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Automated Driver/Firmware Remote Registry Advisories */}
      <div className="bg-card rounded-3xl border border-border border-crisp shadow-sm p-6 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-rose-500" /> Automated Hardware Security & Firmware Registry
            </h2>
            <p className="text-xs text-text/60">
              ระบบตรวจสอบลายเซ็นฮาร์ดแวร์ (Hardware Signature) เทียบกับฐานข้อมูลรีจิสทรีส่วนกลาง เพื่อแจ้งเตือนช่องโหว่ความปลอดภัย (CVEs) และอัปเดตประสิทธิภาพแบบเรียลไทม์
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              onClick={() => handleRunStagedFirmwareUpdate()}
              disabled={updatingFirmware}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3.5 py-2 rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer"
              title="เริ่มอัปเดตเฟิร์มแวร์อุปกรณ์ทั้งหมดแบบเป็นขั้นตอน (Staged Update Routine)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${updatingFirmware ? 'animate-spin' : ''}`} />
              <span>{updatingFirmware ? 'กำลังอัปเดตแบบ Staged...' : 'Staged Firmware Update All'}</span>
            </button>
            <button
              onClick={handleBulkFirmwareCheck}
              disabled={bulkFirmwareChecking}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shadow-sm active:scale-95 cursor-pointer"
              title="ตรวจสอบเวอร์ชันเฟิร์มแวร์ของอุปกรณ์ต่อพ่วงทั้งหมดพร้อมกัน"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${bulkFirmwareChecking ? 'animate-spin' : ''}`} />
              <span>{bulkFirmwareChecking ? 'กำลังตรวจสอบ...' : 'Bulk Firmware Check'}</span>
            </button>
            <span className="text-xs font-semibold px-3 py-1.5 rounded-full bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
              {firmwareAlerts.filter(a => a.status === 'PENDING_INSTALL').length} การแจ้งเตือน
            </span>
          </div>
        </div>

        {/* Live Staged Firmware Update Controller Progress Panel */}
        {(updatingFirmware || firmwareLogs.length > 0) && (
          <div className="p-5 rounded-2xl bg-slate-950 border border-indigo-500/50 text-white space-y-4 shadow-xl animate-card-entrance">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-indigo-900/50 pb-3">
              <div className="flex items-center gap-2">
                <RefreshCw className={`w-5 h-5 text-indigo-400 ${updatingFirmware ? 'animate-spin' : ''}`} />
                <span className="font-bold text-sm text-indigo-200">Staged Firmware Update Controller (Sequential Flash Engine)</span>
              </div>
              <span className="font-mono text-xs text-slate-300 font-bold bg-indigo-950 px-3 py-1 rounded-lg border border-indigo-800">
                {firmwareUpdateProgress}% Complete
              </span>
            </div>

            {/* Overall Progress Bar */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-cyan-300 font-semibold">{firmwareCurrentStage}</span>
                <span className="text-slate-400">{firmwareUpdateProgress === 100 ? 'เสร็จสมบูรณ์' : 'กำลังดำเนินการ...'}</span>
              </div>
              <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-cyan-400 to-emerald-400 transition-all duration-500"
                  style={{ width: `${firmwareUpdateProgress}%` }}
                />
              </div>
            </div>

            {/* Stage Milestones Badges */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px] font-mono text-center">
              {[
                { stageNum: 1, label: 'Stage 1: Checksum', threshold: 20 },
                { stageNum: 2, label: 'Stage 2: EEPROM Backup', threshold: 40 },
                { stageNum: 3, label: 'Stage 3: Flashing ROM', threshold: 70 },
                { stageNum: 4, label: 'Stage 4: Cold Reboot', threshold: 90 },
                { stageNum: 5, label: 'Stage 5: Verified', threshold: 100 },
              ].map((m) => (
                <div
                  key={m.stageNum}
                  className={`p-2 rounded-xl border transition-all ${
                    firmwareUpdateProgress >= m.threshold
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300 font-bold'
                      : 'bg-slate-900 border-slate-800 text-slate-500'
                  }`}
                >
                  <div>{m.label}</div>
                  <div className="text-[9px] mt-0.5">{firmwareUpdateProgress >= m.threshold ? '✓ PASSED' : 'WAITING'}</div>
                </div>
              ))}
            </div>

            {/* Live Terminal Log Stream */}
            <div className="p-3 rounded-xl bg-black/80 font-mono text-[11px] text-slate-300 space-y-1 max-h-36 overflow-y-auto">
              {firmwareLogs.map((log, idx) => (
                <div key={idx} className="leading-relaxed flex items-center gap-2">
                  <span className="text-indigo-400">›</span>
                  <span>{log}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Bulk Firmware Check Results Panel */}
        {bulkFirmwareResult && (
          <div className="p-4 rounded-2xl bg-background border border-border border-crisp space-y-3 animate-card-entrance">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-text">
                <ShieldCheck className="w-4 h-4 text-indigo-500" />
                <span>ผลการตรวจสอบเฟิร์มแวร์ทั้งหมด (Bulk Check Results):</span>
              </div>
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold">
                  ตรวจสอบแล้ว {bulkFirmwareResult.totalChecked} อุปกรณ์
                </span>
                <span className={`px-2 py-0.5 rounded-lg font-bold ${
                  bulkFirmwareResult.outdatedCount > 0 ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                }`}>
                  ต้องอัปเดต {bulkFirmwareResult.outdatedCount} รายการ
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              {bulkFirmwareResult.results.map((res) => (
                <div
                  key={res.peripheralId}
                  className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
                    res.needsUpdate
                      ? 'bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-200'
                      : 'bg-emerald-500/5 border-emerald-500/20 text-emerald-800 dark:text-emerald-200'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="font-bold flex items-center gap-2">
                      <span>{res.name}</span>
                      <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-background border border-border">
                        {res.category.toUpperCase()}
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-text/70 flex items-center gap-2">
                      <span>ปัจจุบัน: <strong className="text-text">{res.currentFirmware}</strong></span>
                      <span>→</span>
                      <span>ล่าสุด: <strong className={res.needsUpdate ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-emerald-600 font-bold'}>{res.latestFirmware}</strong></span>
                    </div>
                    {res.advisoryTitle && (
                      <div className="text-[10px] text-rose-600 dark:text-rose-400 italic">
                        {res.advisoryTitle} (CVSS: {res.severityScore})
                      </div>
                    )}
                  </div>

                  <div className="shrink-0">
                    {res.needsUpdate ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold text-[10px] uppercase shadow-sm">
                        <AlertTriangle className="w-3 h-3" /> ต้องอัปเดต
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-[10px] uppercase shadow-sm">
                        <CheckCircle2 className="w-3 h-3" /> ล่าสุดแล้ว
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3 pt-2">
          {firmwareAlerts.map((alert) => (
            <div
              key={alert.id}
              className={`p-4 rounded-2xl border transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4 ${
                alert.status === 'RESOLVED'
                  ? 'bg-slate-50/50 dark:bg-slate-800/20 border-border border-crisp opacity-60'
                  : alert.advisory.advisoryType === 'SECURITY_CRITICAL'
                  ? 'bg-rose-50/50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50'
                  : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50'
              }`}
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase ${
                      alert.advisory.advisoryType === 'SECURITY_CRITICAL'
                        ? 'bg-rose-500 text-white'
                        : 'bg-amber-500 text-white'
                    }`}
                  >
                    {alert.advisory.advisoryType.replace(/_/g, ' ')}
                  </span>
                  {alert.advisory.cveId && (
                    <span className="font-mono text-xs font-semibold text-text/80">
                      {alert.advisory.cveId}
                    </span>
                  )}
                  <span className="text-xs text-slate-400 font-mono">
                    CVSS: {alert.advisory.severityScore}/10 • {alert.deviceName}
                  </span>
                </div>
                <h4 className="font-bold text-sm text-slate-800 dark:text-slate-100">{alert.advisory.title}</h4>
                <p className="text-xs text-slate-600 dark:text-slate-300">{alert.advisory.description}</p>
                <div className="text-[11px] text-slate-400 font-mono pt-1">
                  เวอร์ชันที่แนะนำ: Firmware {alert.advisory.recommendedFirmwareVersion} / Driver {alert.advisory.recommendedDriverVersion}
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-2">
                {alert.status === 'RESOLVED' ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="w-4 h-4" /> ติดตั้งแพตช์แล้ว
                  </span>
                ) : (
                  <button
                    onClick={() => handleApplyPatch(alert.id)}
                    className="flex items-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-3.5 py-2 rounded-xl text-xs font-medium transition-colors shadow-sm"
                  >
                    <DownloadCloud className="w-4 h-4" /> ติดตั้งแพตช์ด่วนอัตโนมัติ
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Discovered USB / Bluetooth Peripherals (Auto-Configuration Suggested) */}
      {discoveredPeripherals.some(p => !p.configured) && (
        <div className="bg-gradient-to-r from-indigo-950 via-slate-900 to-indigo-950 border border-indigo-500/40 rounded-3xl p-6 text-white shadow-lg space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-xs uppercase tracking-wider">
                <Bluetooth className="w-4 h-4 text-cyan-400 animate-pulse" />
                Antigravity Background Peripheral Auto-Discovery Engine
              </div>
              <h3 className="text-lg font-bold mt-1">ตรวจพบอุปกรณ์ต่อพ่วง USB / Bluetooth ใหม่ที่เชื่อมต่อ</h3>
              <p className="text-xs text-slate-300">
                ระบบสแกนพบอุปกรณ์ฮาร์ดแวร์ใหม่ที่ยังไม่ได้กำหนดค่า Antigravity AI ได้วิเคราะห์และเตรียมโปรไฟล์การตั้งค่าที่เหมาะสมที่สุดไว้แล้ว
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {discoveredPeripherals.filter(p => !p.configured).map((p) => (
              <div key={p.id} className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-500/30 text-indigo-200">
                      {p.interfaceType.replace(/_/g, ' ')}
                    </span>
                    <span className="text-[11px] text-slate-400 font-mono">
                      {new Date(p.detectedAt).toLocaleTimeString('th-TH')}
                    </span>
                  </div>
                  <h4 className="font-bold text-sm text-white">{p.name}</h4>
                  <div className="text-xs text-slate-300 font-mono mt-1">
                    ID: {p.hardwareId}
                  </div>
                  <div className="p-2.5 rounded-xl bg-black/30 border border-white/5 mt-3 space-y-1 text-xs">
                    <div className="text-indigo-300 font-semibold text-[11px]">โปรไฟล์ที่แนะนำโดย AI:</div>
                    <div className="text-slate-200">{p.suggestedConfig.driver}</div>
                    <div className="text-slate-400 text-[11px]">การจำลอง: {p.suggestedConfig.emulation}</div>
                  </div>
                </div>

                <button
                  onClick={() => handleAutoConfigurePeripheral(p.id)}
                  className="w-full mt-2 py-2 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-md transition-all active:scale-95 cursor-pointer"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-300" />
                  อนุมัติการตั้งค่าอัตโนมัติ (1-Click Auto-Configure)
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plug & Play & Device Manager Section */}
      <div className="bg-card rounded-3xl border border-border border-crisp shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <HardDrive className="w-5 h-5 text-indigo-600" /> Plug & Play Hardware & Driver Auto-Discovery
            </h2>
            <p className="text-xs text-text/60 mt-0.5">
              ระบบตรวจจับอุปกรณ์ POS (เครื่องพิมพ์, สแกนเนอร์, ลิ้นชัก, เครื่องรูดบัตร EDC) และอัปเดตไดรเวอร์อัตโนมัติเรียลไทม์
            </p>
          </div>
          <button
            onClick={handleScanDevices}
            disabled={loadingScan}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loadingScan ? 'animate-spin' : ''}`} />
            {loadingScan ? 'กำลังสแกนอุปกรณ์...' : 'สแกนหาอุปกรณ์ใหม่ (Scan PnP)'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-background/50 text-text/60 text-xs uppercase border-b border-border border-crisp">
                <th className="py-3 px-6">ชื่ออุปกรณ์ / ประเภท</th>
                <th className="py-3 px-6">พอร์ตเชื่อมต่อ</th>
                <th className="py-3 px-6">สถานะ</th>
                <th className="py-3 px-6">เวอร์ชันไดรเวอร์</th>
                <th className="py-3 px-6 text-right">การจัดการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {devices.map((dev) => (
                <tr key={dev.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                  <td className="py-4 px-6 font-medium text-text">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
                        <HardDrive className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-semibold">{dev.name}</div>
                        <div className="text-xs text-slate-400 capitalize">{dev.type} • เชื่อมต่ออัตโนมัติ</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-slate-600 dark:text-slate-300 font-mono text-xs">{dev.port}</td>
                  <td className="py-4 px-6">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      Ready / Active
                    </span>
                  </td>
                  <td className="py-4 px-6 text-slate-600 dark:text-slate-300 font-mono text-xs">
                    {dev.driverVersion}
                    {dev.autoUpdateAvailable && (
                      <span className="ml-2 px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 text-[10px] font-sans font-semibold">
                        มีอัปเดต ({dev.latestVersion})
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-right">
                    {dev.autoUpdateAvailable ? (
                      <button
                        onClick={() => handleUpdateDriver(dev.id)}
                        className="inline-flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl text-xs font-medium transition-colors shadow-sm"
                      >
                        <DownloadCloud className="w-3.5 h-3.5" /> อัปเดตไดรเวอร์อัตโนมัติ
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400 font-medium">ไดรเวอร์ล่าสุดแล้ว</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Antigravity Self-Healing Audit Logs */}
      <div className="bg-card rounded-3xl border border-border border-crisp shadow-sm p-6">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2">
          <Server className="w-5 h-5 text-indigo-600" /> Antigravity AI Autonomous Self-Healing & Audit Trail
        </h3>
        <div className="space-y-3">
          {health?.selfHealLogs.map((log) => (
            <div key={log.id} className="p-4 rounded-2xl bg-background/50 border border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">
                    {log.component}
                  </span>
                  <span className="text-xs text-slate-400">{new Date(log.timestamp).toLocaleString('th-TH')}</span>
                </div>
                <p className="text-sm font-medium text-text">{log.actionTaken}</p>
                <p className="text-xs text-text/60">ปัญหาที่ตรวจพบ: {log.issue}</p>
              </div>
              <span className="px-3 py-1 rounded-xl text-xs font-semibold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center gap-1 shrink-0">
                <CheckCircle2 className="w-3.5 h-3.5" /> แก้ไขสำเร็จอัตโนมัติ
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* New Device Setup Step-by-Step Wizard Overlay */}
      <NewDeviceSetupModal
        isOpen={isNewDeviceSetupOpen}
        onClose={() => setIsNewDeviceSetupOpen(false)}
        onDeviceAdded={handleDeviceAddedFromWizard}
      />

      {/* Remote Reboot Confirmation Modal */}
      {rebootConfirmPeripheral && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-card w-full max-w-md rounded-3xl border border-border border-crisp shadow-2xl p-6 space-y-5 animate-scale-up">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-500 flex items-center justify-center shrink-0">
                  <RotateCcw className="w-6 h-6 animate-spin-slow" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-text">ยืนยันการรีบูตฮาร์ดแวร์ระยะไกล</h3>
                  <p className="text-xs text-text/60 font-mono mt-0.5">ID: {rebootConfirmPeripheral.id}</p>
                </div>
              </div>
              <button
                onClick={() => setRebootConfirmPeripheral(null)}
                className="text-text/40 hover:text-text p-1 rounded-xl hover:bg-background transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 space-y-2 text-xs">
              <div className="font-bold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>คำเตือนความปลอดภัย (Hardware Power Cycle Warning)</span>
              </div>
              <p className="text-text/80 leading-relaxed">
                คุณกำลังจะส่งสัญญาณรีเซ็ตไฟกระแสตรง (DTR Power Cycle Signal) ไปยังอุปกรณ์ <strong className="text-text font-semibold">{rebootConfirmPeripheral.name}</strong> บนพอร์ต <code className="bg-card px-1.5 py-0.5 rounded border font-mono">{rebootConfirmPeripheral.port}</code>
              </p>
              <p className="text-text/70 text-[11px] leading-relaxed">
                อุปกรณ์จะตัดการเชื่อมต่อและดับลงชั่วคราวประมาณ 1-3 วินาที ก่อนกลับมาทำงานใหม่เพื่อล้าง Memory Buffer
              </p>
            </div>

            <div className="p-3 rounded-2xl bg-background border border-border border-crisp text-xs space-y-1.5 font-mono">
              <div className="flex justify-between text-text/70">
                <span>สถานที่จัดวาง:</span>
                <span className="font-bold text-indigo-500">{rebootConfirmPeripheral.tags?.join(', ') || 'ไม่ได้ระบุ'}</span>
              </div>
              <div className="flex justify-between text-text/70">
                <span>อินเทอร์เฟซ:</span>
                <span className="font-bold text-text">{rebootConfirmPeripheral.connectivity.interface}</span>
              </div>
              <div className="flex justify-between text-text/70">
                <span>เวอร์ชันเฟิร์มแวร์:</span>
                <span className="font-bold text-text">{rebootConfirmPeripheral.firmwareVersion}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setRebootConfirmPeripheral(null)}
                className="px-4 py-2.5 rounded-xl border border-border border-crisp text-text/80 hover:bg-background text-xs font-semibold transition-all cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                onClick={() => handleExecuteRemoteReboot(rebootConfirmPeripheral)}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-all shadow-md active:scale-95 flex items-center gap-2 cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                <span>ยืนยันรีบูตฮาร์ดแวร์</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule Power Cycle & Auto-Reboot Modal */}
      {isScheduleModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-card w-full max-w-lg rounded-3xl border border-border border-crisp shadow-2xl p-6 space-y-5 animate-scale-up">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-500 flex items-center justify-center shrink-0">
                  <Clock className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-text">กำหนดการจัดการฮาร์ดแวร์อัจฉริยะ (Smart Management Scheduling)</h3>
                  <p className="text-xs text-text/60 mt-0.5">ล้าง Memory Buffer และกู้คืนประสิทธิภาพอุปกรณ์อัตโนมัติตามเงื่อนไข</p>
                </div>
              </div>
              <button
                onClick={() => setIsScheduleModalOpen(false)}
                className="text-text/40 hover:text-text p-1 rounded-xl hover:bg-background transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-5 text-xs">
              {/* Type Selection */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleCreateScheduledPowerCycle('STORE_CLOSING')}
                  className="p-3 rounded-2xl bg-indigo-500 text-white font-bold flex flex-col items-center gap-2 hover:bg-indigo-600 transition-all cursor-pointer text-center"
                >
                  <RotateCcw className="w-5 h-5" />
                  <span>รีบูตช่วงปิดร้าน (Closing Reboot)</span>
                </button>
                <button
                  onClick={() => handleCreateScheduledPowerCycle('AUTO_REBOOT_HIGH_ERROR')}
                  className="p-3 rounded-2xl bg-rose-500 text-white font-bold flex flex-col items-center gap-2 hover:bg-rose-600 transition-all cursor-pointer text-center"
                >
                  <AlertTriangle className="w-5 h-5" />
                  <span>รีบูตเมื่อ Error สูง (Smart Auto-Reboot)</span>
                </button>
              </div>

              <div className="border-t border-border border-crisp pt-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <label className="block text-text/70 font-semibold mb-1">ช่วงเวลาทราฟฟิกต่ำ (Low Traffic Window):</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={scheduleTime}
                        onChange={(e) => setScheduleTime(e.target.value)}
                        className="px-3 py-1.5 rounded-xl bg-background border border-border border-crisp font-mono text-sm font-bold text-indigo-500 focus:outline-none"
                      />
                      <span className="text-text/60 text-[10px]">น.</span>
                    </div>
                  </div>

                  <div>
                    <label className="block text-text/70 font-semibold mb-1">เกณฑ์แจ้งเตือน Error (Threshold):</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={scheduleErrorThreshold}
                        onChange={(e) => setScheduleErrorThreshold(Number(e.target.value))}
                        className="w-16 px-3 py-1.5 rounded-xl bg-background border border-border border-crisp font-mono text-sm font-bold text-rose-500 focus:outline-none"
                      />
                      <span className="text-text/60 text-[10px]">ครั้ง/วัน</span>
                    </div>
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-background border border-border border-crisp space-y-2">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={scheduleOnlyNonCritical}
                      onChange={(e) => setScheduleOnlyNonCritical(e.target.checked)}
                      className="w-4 h-4 rounded border-border text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                    />
                    <span className="font-bold text-text text-xs">ยกเว้นอุปกรณ์สำคัญ (Exclude Critical Devices)</span>
                  </label>
                  <p className="text-[10px] text-text/50 pl-6 leading-relaxed">
                    ระบบจะทำการรีบูตเฉพาะเครื่องพิมพ์และสแกนเนอร์เท่านั้น ลิ้นชักเก็บเงินและเครื่อง EDC จะไม่อยู่ในเงื่อนไขอัตโนมัติ
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-800 dark:text-amber-200 leading-relaxed italic">
                <span className="font-bold">AI Monitoring:</span> Antigravity จะทำการรีบูตอุปกรณ์ที่มีอัตราความผิดพลาดเกินค่าที่กำหนดในช่วงเวลาที่ร้านมีผู้ใช้งานน้อยที่สุด เพื่อรักษาสภาพคล่องของระบบ
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setIsScheduleModalOpen(false)}
                className="px-4 py-2.5 rounded-xl border border-border border-crisp text-text/80 hover:bg-background text-xs font-semibold transition-all cursor-pointer"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Diagnostic Terminal Modal */}
      {terminalPeripheral && (
        <DiagnosticTerminal
          peripheral={terminalPeripheral}
          onClose={() => setTerminalPeripheral(null)}
        />
      )}
      </div>
    </DndContext>
  );
}

// --- Sub-components ---

interface DiagnosticTerminalProps {
  peripheral: HardwarePeripheralStatus;
  onClose: () => void;
}

function DiagnosticTerminal({ peripheral, onClose }: DiagnosticTerminalProps) {
  const [activeTab, setActiveTab] = useState<'info' | 'live'>('live');
  const [logs, setLogs] = useState<string[]>([]);
  const [stream, setStream] = useState<Array<{ id: string; timestamp: string; level: string; event: string; detail: string }>>([]);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const generateLiveEvent = () => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 });
    const levels = ['INFO', 'DEBUG', 'WARN', 'TRACE'];
    const level = levels[Math.floor(Math.random() * levels.length)];
    
    const eventPool: Record<string, Array<{ event: string; detail: string }>> = {
      printer: [
        { event: 'IO_WRITE', detail: 'ESC/POS: Print text block (142 bytes)' },
        { event: 'STATUS_QUERY', detail: 'ASB: 0x00 (Online, No Error)' },
        { event: 'FEED_FEEDBACK', detail: 'Stepper motor feedback: 24 steps ok' },
        { event: 'SENSOR_POLL', detail: 'Head thermistor: 1.42V (38°C)' },
        { event: 'BUFFER_ACK', detail: 'Spool buffer flushed to ASIC' }
      ],
      scanner: [
        { event: 'CMOS_TRIGGER', detail: 'Illumination active, scanning for symbology' },
        { event: 'DECODE_ENGINE', detail: 'Pattern match: EAN-13 (885123456789)' },
        { event: 'USB_HID_REPORT', detail: 'Input report sent: Keyboard wedge buffer' },
        { event: 'AIMER_CONTROL', detail: 'PWM duty cycle set to 85%' },
        { event: 'FRAME_STATS', detail: 'Frame dropped (Latency burst on bus)' }
      ],
      drawer: [
        { event: 'GPIO_STATUS', detail: 'Pin 4 (Microswitch): HIGH (Locked)' },
        { event: 'CAP_VOLTAGE', detail: '24V Rails: 23.9V (Stable)' },
        { event: 'FIRE_READY', detail: 'Solenoid circuit integrity check: PASS' },
        { event: 'TAMPER_POLL', detail: 'Opto-isolator link verified' }
      ],
      edc: [
        { event: 'NET_RX', detail: 'SSL Frame received (4096 bytes)' },
        { event: 'EMV_HANDSHAKE', detail: 'Kernel handshake active (Stage 2)' },
        { event: 'NFC_FIELD', detail: 'Carrier wave established (13.56MHz)' },
        { event: 'SAM_VERIFY', detail: 'Security module signature verified' }
      ],
      default: [
        { event: 'HEARTBEAT', detail: 'Device keep-alive ACK received' },
        { event: 'BUS_IDLE', detail: 'Low power state transition inhibited' },
        { event: 'TELEMETRY_TX', detail: 'Pushing metrics to Antigravity' }
      ]
    };

    const categoryEvents = eventPool[peripheral.category] || eventPool.default;
    const item = categoryEvents[Math.floor(Math.random() * categoryEvents.length)];
    
    return {
      id: Math.random().toString(36).substring(7),
      timestamp,
      level,
      ...item
    };
  };

  useEffect(() => {
    // Initial logs for info tab
    const initialLogs = [
      `PRODX-POS Diagnostic Terminal v2.4.0`,
      `Connected to: ${peripheral.name} (${peripheral.model})`,
      `Bus Address: ${peripheral.port}`,
      `Firmware: ${peripheral.firmwareVersion} | Driver: ${peripheral.driverVersion}`,
      `----------------------------------------------------------------------`,
      `[SYSTEM] Establishing serial handshake...`,
      `[SYSTEM] Handshake success. Port ${peripheral.port} open.`,
      `[SYSTEM] IO Controller ready.`,
      ``,
      `[AUDIT] Security Signature: Valid (Antigravity Verified)`,
      `[AUDIT] Manufacturer: ${peripheral.category.toUpperCase()} OEM`,
      `[AUDIT] Link State: Stable`,
      `[AUDIT] Power Budget: ${peripheral.battery.powerSource === 'ac_mains' ? 'AC Line' : 'Bus Power'}`
    ];
    setLogs(initialLogs);

    // Initial stream data
    setStream(Array.from({ length: 5 }, generateLiveEvent));

    const interval = setInterval(() => {
      const nextEvt = generateLiveEvent();
      setStream((prev) => [...prev.slice(-49), nextEvt]);
      auditService.logDiagnosticEvent({
        peripheralId: peripheral.id,
        deviceName: peripheral.name,
        category: peripheral.category,
        level: nextEvt.level as DiagnosticLogLevel,
        event: nextEvt.event,
        message: nextEvt.detail,
        port: peripheral.port,
        interfaceType: peripheral.connectivity.interface,
      });
    }, 1000 + Math.random() * 1500);

    return () => clearInterval(interval);
  }, [peripheral]);

  useEffect(() => {
    if (scrollRef.current && activeTab === 'live') {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [stream, activeTab]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-4xl bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden flex flex-col h-[600px] animate-state-pop">
        {/* Terminal Header */}
        <div className="bg-slate-800 px-5 py-3 flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center border border-emerald-500/20">
              <Terminal className="w-4 h-4 text-emerald-500" />
            </div>
            <div>
              <span className="text-[11px] font-mono font-bold text-slate-300 uppercase tracking-widest block">
                Diagnostic Console
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                {peripheral.name} ({peripheral.port})
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex bg-slate-950/50 p-1 rounded-xl border border-slate-700">
              <button
                onClick={() => setActiveTab('info')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                  activeTab === 'info' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>System Info</span>
              </button>
              <button
                onClick={() => setActiveTab('live')}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-[10px] font-bold transition-all cursor-pointer ${
                  activeTab === 'live' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <div className="relative">
                  <Activity className="w-3.5 h-3.5" />
                  {activeTab === 'live' && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-emerald-300 rounded-full animate-ping" />
                  )}
                </div>
                <span>Live Stream</span>
              </button>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-700/50 text-slate-400 hover:bg-rose-500/20 hover:text-rose-500 transition-all cursor-pointer border border-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Terminal Body */}
        <div 
          ref={scrollRef}
          className="flex-1 p-6 font-mono text-[12px] overflow-y-auto bg-black selection:bg-emerald-500/30 selection:text-white scrollbar-thin scrollbar-thumb-slate-800"
        >
          {activeTab === 'info' ? (
            <div className="space-y-4 animate-fade-in">
              <div className="grid grid-cols-2 gap-6 text-slate-300">
                <div className="space-y-3">
                  <h4 className="text-emerald-500 font-bold border-b border-slate-800 pb-1">Hardware Identity</h4>
                  <div className="space-y-1">
                    <p className="flex justify-between"><span>Model:</span> <span className="text-white">{peripheral.model}</span></p>
                    <p className="flex justify-between"><span>Serial:</span> <span className="text-white">{peripheral.serialNumber}</span></p>
                    <p className="flex justify-between"><span>Category:</span> <span className="text-white uppercase">{peripheral.category}</span></p>
                    <p className="flex justify-between"><span>Port:</span> <span className="text-white">{peripheral.port}</span></p>
                  </div>
                </div>
                <div className="space-y-3">
                  <h4 className="text-emerald-500 font-bold border-b border-slate-800 pb-1">Software Stack</h4>
                  <div className="space-y-1">
                    <p className="flex justify-between"><span>Firmware:</span> <span className="text-white">{peripheral.firmwareVersion}</span></p>
                    <p className="flex justify-between"><span>Driver:</span> <span className="text-white">{peripheral.driverVersion}</span></p>
                    <p className="flex justify-between"><span>Registry:</span> <span className="text-white">PRODX-V3</span></p>
                    <p className="flex justify-between"><span>Integrity:</span> <span className="text-emerald-400 font-bold">VERIFIED</span></p>
                  </div>
                </div>
              </div>

              <div className="space-y-2 mt-6">
                <h4 className="text-emerald-500 font-bold border-b border-slate-800 pb-1">Initialization Logs</h4>
                <div className="text-emerald-500/70 space-y-0.5">
                  {logs.map((log, i) => (
                    <div key={i}>{log}</div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-1 animate-fade-in">
              <div className="text-slate-600 text-[10px] mb-4 pb-2 border-b border-slate-900 flex items-center justify-between uppercase font-bold tracking-tighter">
                <span>Timestamp</span>
                <span>Event Handler</span>
                <span>Payload Detail</span>
              </div>
              {stream.map((log) => (
                <div key={log.id} className="flex gap-4 group transition-colors hover:bg-white/5 py-0.5 rounded px-1">
                  <span className="text-slate-500 shrink-0 font-bold">[{log.timestamp}]</span>
                  <span className={`shrink-0 w-24 font-bold ${
                    log.level === 'WARN' ? 'text-amber-500' : 
                    log.level === 'DEBUG' ? 'text-indigo-400' : 
                    log.level === 'TRACE' ? 'text-slate-500' : 'text-emerald-400'
                  }`}>
                    {log.event}
                  </span>
                  <span className="text-slate-300 truncate group-hover:text-white">
                    {log.detail}
                  </span>
                  <span className="ml-auto text-[9px] text-slate-700 font-bold opacity-0 group-hover:opacity-100 uppercase">
                    {log.level}
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-1 mt-2">
                <span className="animate-pulse text-emerald-500">█</span>
                <span className="text-slate-700 text-[10px] font-bold">LISTENING FOR INTERRUPTS...</span>
              </div>
            </div>
          )}
        </div>

        {/* Terminal Footer */}
        <div className="bg-slate-800 px-5 py-3 border-t border-slate-700 flex items-center justify-between">
          <div className="flex items-center gap-6 text-[10px] text-slate-400 font-mono">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${activeTab === 'live' ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
              <span className="font-bold text-slate-300">STREAMING: {activeTab === 'live' ? 'ACTIVE' : 'PAUSED'}</span>
            </div>
            <span>MODE: READ-ONLY</span>
            <span className="text-slate-600">|</span>
            <span>DATA RATE: ~12kbps</span>
            <span className="text-slate-600">|</span>
            <span>DEVICE_ID: {peripheral.id}</span>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'live' && (
              <button
                onClick={() => setStream([])}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-950 text-slate-400 hover:text-white text-[10px] font-bold rounded-xl transition-all uppercase tracking-wider cursor-pointer border border-slate-700"
              >
                Clear Stream
              </button>
            )}
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-xl transition-all uppercase tracking-wider cursor-pointer shadow-lg shadow-indigo-500/20 active:scale-95"
            >
              Close Console
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
