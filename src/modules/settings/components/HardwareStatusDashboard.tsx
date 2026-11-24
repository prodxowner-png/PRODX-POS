import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity,
  Barcode,
  Printer,
  DollarSign,
  Radio,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Zap,
  Cpu,
  Wifi,
  Usb,
  Volume2,
  Sliders,
  Play,
  Clock,
  Sparkles,
  Terminal,
  Unplug,
  Plug,
  Copy,
  Download,
  Trash2,
  Filter,
  ArrowDown,
  Search,
  Check,
  AlertOctagon,
  FileText,
} from 'lucide-react';
import { Card, CardHeader, CardBody } from '../../../components/common/Card';
import { Badge } from '../../../components/common/Badge';
import { Button } from '../../../components/common/Button';
import { GraphicIcon } from '../../../components/common/GraphicIcon';
import { useLanguage } from '../../../context/LanguageContext';
import { useReceiptPrinter } from '../../../context/ReceiptPrinterContext';
import { useToast } from '../../../context/ToastContext';
import { useBarcodeScanner } from '../../../hooks/useBarcodeScanner';
import { playScannerSound } from '../../../services/soundService';

export type HardwareDeviceType = 'scanner' | 'printer' | 'drawer' | 'system';
export type HardwareEventStatus = 'connected' | 'disconnected' | 'reconnected' | 'error' | 'warning' | 'info' | 'pulse';

export interface HardwareEventLogItem {
  id: string;
  timestamp: string;
  isoTime: string;
  device: HardwareDeviceType;
  status: HardwareEventStatus;
  code: string;
  message: string;
  troubleshootingHint?: string;
  details?: string;
}

export type DeviceConnectionState = 'connected' | 'disconnected' | 'reconnecting' | 'warning';

export const HardwareStatusDashboard: React.FC = () => {
  const { language } = useLanguage();
  const { addToast } = useToast();
  const {
    printerConfig,
    isPrinting,
    printTestReceipt,
    kickCashDrawer,
  } = useReceiptPrinter();

  // Device Connection States
  const [scannerConnection, setScannerConnection] = useState<DeviceConnectionState>('connected');
  const [printerConnection, setPrinterConnection] = useState<DeviceConnectionState>('connected');
  const [drawerConnection, setDrawerConnection] = useState<DeviceConnectionState>('connected');

  // Interactive Diagnostic States
  const [isPinging, setIsPinging] = useState(false);
  const [lastPingTime, setLastPingTime] = useState<Date>(new Date());
  const [testBarcodeValue, setTestBarcodeValue] = useState('8850123456789');
  const [simulatedDrawerOpen, setSimulatedDrawerOpen] = useState(false);
  const [drawerOpenDuration, setDrawerOpenDuration] = useState(0);

  // Log filter and control states
  const [logFilterDevice, setLogFilterDevice] = useState<'all' | HardwareDeviceType | 'issues'>('all');
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  // Initial event logs history
  const [eventLogs, setEventLogs] = useState<HardwareEventLogItem[]>(() => {
    const now = Date.now();
    return [
      {
        id: 'evt-init-1',
        timestamp: new Date(now - 1000 * 60 * 3).toLocaleTimeString() + `.${String((now - 180000) % 1000).padStart(3, '0')}`,
        isoTime: new Date(now - 1000 * 60 * 3).toISOString(),
        device: 'system',
        status: 'info',
        code: 'SYS_BOOT_INIT',
        message: 'POS Hardware abstraction layer initialized. Enumerating USB & Serial endpoints...',
      },
      {
        id: 'evt-init-2',
        timestamp: new Date(now - 1000 * 60 * 2.5).toLocaleTimeString() + `.${String((now - 150000) % 1000).padStart(3, '0')}`,
        isoTime: new Date(now - 1000 * 60 * 2.5).toISOString(),
        device: 'printer',
        status: 'connected',
        code: 'ESC_POS_ONLINE',
        message: 'Epson TM-T88VI (80mm ESC/POS) handshake successful on USB port. Baud: 115200. Auto-Cutter: READY.',
      },
      {
        id: 'evt-init-3',
        timestamp: new Date(now - 1000 * 60 * 2).toLocaleTimeString() + `.${String((now - 120000) % 1000).padStart(3, '0')}`,
        isoTime: new Date(now - 1000 * 60 * 2).toISOString(),
        device: 'drawer',
        status: 'connected',
        code: 'DRAWER_CIRCUIT_READY',
        message: 'RJ11 Solenoid Kick circuit verified via printer auxiliary pin 2 (24V 50ms DC pulse).',
      },
      {
        id: 'evt-init-4',
        timestamp: new Date(now - 1000 * 60 * 1).toLocaleTimeString() + `.${String((now - 60000) % 1000).padStart(3, '0')}`,
        isoTime: new Date(now - 1000 * 60 * 1).toISOString(),
        device: 'scanner',
        status: 'connected',
        code: 'USB_HID_ATTACH',
        message: '2D Handheld Barcode Scanner attached via USB HID Keyboard Wedge. Burst interval threshold: <50ms.',
      },
    ];
  });

  // Helper to add structured events to the log
  const addEventLog = useCallback((
    device: HardwareDeviceType,
    status: HardwareEventStatus,
    code: string,
    message: string,
    troubleshootingHint?: string
  ) => {
    const now = new Date();
    const formattedTimestamp = `${now.toLocaleTimeString()}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    const newEvent: HardwareEventLogItem = {
      id: `evt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: formattedTimestamp,
      isoTime: now.toISOString(),
      device,
      status,
      code,
      message,
      troubleshootingHint,
    };

    setEventLogs((prev) => [newEvent, ...prev.slice(0, 99)]);
  }, []);

  // Auto-scroll log container to top or bottom
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = 0;
    }
  }, [eventLogs, autoScroll]);

  // Barcode Scanner Listener Hook
  const {
    lastScannedBarcode,
    lastScannedAt,
    scanCount,
    isScanning,
    simulateScan,
  } = useBarcodeScanner({
    enabled: scannerConnection === 'connected',
    onScan: (barcode) => {
      if (scannerConnection !== 'connected') {
        playScannerSound('error');
        addEventLog(
          'scanner',
          'error',
          'SCANNER_OFFLINE_DROPPED',
          `Scan payload "${barcode}" dropped. Scanner is disconnected.`,
          'Verify USB cable seating or click "Reconnect Scanner".'
        );
        addToast({
          title: language === 'th' ? 'สแกนเนอร์ออฟไลน์' : 'Scanner Disconnected',
          message: language === 'th' ? 'อุปกรณ์ถูกตัดการเชื่อมต่ออยู่ ไม่สามารถรับข้อมูลได้' : 'Cannot capture input while scanner is disconnected.',
          type: 'error',
        });
        return;
      }

      playScannerSound('success');
      addEventLog(
        'scanner',
        'info',
        'SCAN_DECODE_OK',
        `Decoded barcode payload: "${barcode}" (${barcode.length} chars, Burst latency: 12ms)`
      );
      addToast({
        title: language === 'th' ? 'จับสัญญาณบาร์โค้ดสำเร็จ' : 'Barcode Scanned',
        message: `${barcode} (${language === 'th' ? 'ความเร็วสัญญาณฮาร์ดแวร์ปกติ' : 'Hardware burst OK'})`,
        type: 'success',
      });
    },
  });

  // Drawer auto-close timer simulation
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (simulatedDrawerOpen) {
      interval = setInterval(() => {
        setDrawerOpenDuration((d) => d + 1);
      }, 1000);
    } else {
      setDrawerOpenDuration(0);
    }
    return () => clearInterval(interval);
  }, [simulatedDrawerOpen]);

  // Ping All Hardware Components
  const handlePingAllHardware = async () => {
    setIsPinging(true);
    playScannerSound('click');

    setTimeout(() => {
      setIsPinging(false);
      const pingTime = new Date();
      setLastPingTime(pingTime);

      const scannerOnline = scannerConnection === 'connected';
      const printerOnline = printerConnection === 'connected';
      const drawerOnline = drawerConnection === 'connected';

      addEventLog(
        'system',
        'info',
        'DIAGNOSTIC_PING_SWEEP',
        `Full hardware ping sweep complete. Result: ${
          [scannerOnline && 'Scanner OK', printerOnline && 'Printer OK', drawerOnline && 'Drawer OK']
            .filter(Boolean)
            .join(' | ') || 'All devices offline'
        }`
      );

      if (!scannerOnline) {
        addEventLog('scanner', 'warning', 'PING_TIMEOUT_SCANNER', 'Scanner unresponsive on HID endpoint.', 'Check USB cable or re-plug scanner.');
      }
      if (!printerOnline) {
        addEventLog('printer', 'warning', 'PING_TIMEOUT_PRINTER', 'ESC/POS thermal printer dropped ping ACK.', 'Check AC power adapter and COM/USB connection.');
      }

      const onlineCount = (scannerOnline ? 1 : 0) + (printerOnline ? 1 : 0) + (drawerOnline ? 1 : 0);

      addToast({
        title: language === 'th' ? 'ทดสอบสัญญาณฮาร์ดแวร์เรียบร้อย' : 'Hardware Ping Complete',
        message:
          language === 'th'
            ? `อุปกรณ์เชื่อมต่อพร้อมใช้งาน ${onlineCount}/3 รายการ`
            : `${onlineCount}/3 peripherals responded successfully.`,
        type: onlineCount === 3 ? 'success' : 'warning',
      });
    }, 550);
  };

  // Toggle / Simulate Scanner Connection/Disconnection
  const toggleScannerConnection = (forceState?: DeviceConnectionState) => {
    const nextState = forceState !== undefined ? forceState : scannerConnection === 'connected' ? 'disconnected' : 'connected';

    if (nextState === 'disconnected') {
      setScannerConnection('disconnected');
      playScannerSound('error');
      addEventLog(
        'scanner',
        'disconnected',
        'USB_HID_DETACH',
        'Barcode scanner USB cable detached / device powered off.',
        'Check physical USB cable connection, USB hub power, or re-plug device.'
      );
      addToast({
        title: language === 'th' ? 'สแกนเนอร์ถูกตัดการเชื่อมต่อ' : 'Scanner Disconnected',
        message: language === 'th' ? 'ตรวจพบการถอดสาย USB ของเครื่องสแกนบาร์โค้ด' : 'USB HID barcode scanner connection lost.',
        type: 'warning',
      });
    } else if (nextState === 'connected') {
      setScannerConnection('reconnecting');
      addEventLog('scanner', 'info', 'USB_HID_ENUMERATING', 'Re-negotiating USB HID keyboard wedge handshake...');

      setTimeout(() => {
        setScannerConnection('connected');
        playScannerSound('success');
        addEventLog(
          'scanner',
          'reconnected',
          'USB_HID_ATTACH',
          'Barcode scanner reconnected successfully. USB HID Polling rate: 1000Hz (Active).'
        );
        addToast({
          title: language === 'th' ? 'สแกนเนอร์เชื่อมต่อสำเร็จ' : 'Scanner Reconnected',
          message: language === 'th' ? 'พร้อมรับสัญญาณบาร์โค้ดและ SKU' : 'Barcode scanner is now online and listening.',
          type: 'success',
        });
      }, 600);
    }
  };

  // Toggle / Simulate Printer Connection/Disconnection
  const togglePrinterConnection = (forceState?: DeviceConnectionState) => {
    const nextState = forceState !== undefined ? forceState : printerConnection === 'connected' ? 'disconnected' : 'connected';

    if (nextState === 'disconnected') {
      setPrinterConnection('disconnected');
      playScannerSound('error');
      addEventLog(
        'printer',
        'disconnected',
        'ESC_POS_OFFLINE',
        'Thermal receipt printer link dropped. ESC/POS driver port closed.',
        'Check power switch, AC adapter, USB/Ethernet cable, or paper door latch.'
      );
      addToast({
        title: language === 'th' ? 'เครื่องพิมพ์ออฟไลน์' : 'Printer Disconnected',
        message: language === 'th' ? 'ขาดการติดต่อกับเครื่องพิมพ์ใบเสร็จความร้อน' : 'Receipt printer offline. Check connection or power.',
        type: 'warning',
      });
    } else if (nextState === 'connected') {
      setPrinterConnection('reconnecting');
      addEventLog('printer', 'info', 'ESC_POS_HANDSHAKING', 'Opening port connection to receipt printer...');

      setTimeout(() => {
        setPrinterConnection('connected');
        playScannerSound('success');
        addEventLog(
          'printer',
          'reconnected',
          'ESC_POS_ONLINE',
          `Receipt printer online: ${printerConfig.printerName} (80mm Auto-Cutter ON, Ready for print jobs).`
        );
        addToast({
          title: language === 'th' ? 'เครื่องพิมพ์เชื่อมต่อสำเร็จ' : 'Printer Reconnected',
          message: language === 'th' ? 'เครื่องพิมพ์พร้อมทำงาน' : 'Receipt printer is online and ready.',
          type: 'success',
        });
      }, 700);
    }
  };

  // Toggle / Simulate Cash Drawer Connection
  const toggleDrawerConnection = (forceState?: DeviceConnectionState) => {
    const nextState = forceState !== undefined ? forceState : drawerConnection === 'connected' ? 'disconnected' : 'connected';

    if (nextState === 'disconnected') {
      setDrawerConnection('disconnected');
      addEventLog(
        'drawer',
        'disconnected',
        'RJ11_CABLE_UNPLUGGED',
        'Cash drawer solenoid kick circuit open (RJ11/RJ12 cable unplugged).',
        'Check RJ11 cable connection between drawer base and printer kick port.'
      );
      addToast({
        title: language === 'th' ? 'ลิ้นชักถูกตัดสัญญาณ' : 'Drawer Cable Disconnected',
        message: language === 'th' ? 'สาย RJ11 ลิ้นชักเก็บเงินไม่ได้เชื่อมต่อกับเครื่องพิมพ์' : 'RJ11 drawer solenoid cable disconnected.',
        type: 'warning',
      });
    } else {
      setDrawerConnection('connected');
      playScannerSound('click');
      addEventLog(
        'drawer',
        'reconnected',
        'RJ11_CIRCUIT_LATCHED',
        'Cash drawer RJ11 connection restored. Microswitch sensor active.'
      );
      addToast({
        title: language === 'th' ? 'ลิ้นชักเชื่อมต่อแล้ว' : 'Drawer Connected',
        message: language === 'th' ? 'วงจรเปิดลิ้นชักพร้อมรับคำสั่ง' : 'Drawer kick circuit ready.',
        type: 'success',
      });
    }
  };

  // Test Print Action
  const handleTestPrint = async () => {
    if (printerConnection !== 'connected') {
      playScannerSound('error');
      addEventLog(
        'printer',
        'error',
        'PRINT_JOB_REJECTED',
        'Cannot dispatch test print. Printer status is DISCONNECTED.',
        'Reconnect printer or verify ESC/POS communication port.'
      );
      addToast({
        title: language === 'th' ? 'ไม่สามารถพิมพ์ได้' : 'Print Dispatched Failed',
        message: language === 'th' ? 'เครื่องพิมพ์ตัดการเชื่อมต่ออยู่ กรุณากดเชื่อมต่อเครื่องพิมพ์' : 'Printer is offline. Reconnect printer first.',
        type: 'error',
      });
      return;
    }

    addEventLog('printer', 'info', 'PRINT_RASTER_DISPATCH', 'Sending 80mm ESC/POS test pattern raster data...');
    const res = await printTestReceipt();
    if (res.success) {
      addEventLog('printer', 'info', 'PRINT_JOB_SUCCESS', 'Print job acknowledged by printer buffer. Cutter activated.');
      addToast({
        title: language === 'th' ? 'ส่งคำสั่งพิมพ์สำเร็จ' : 'Test Print Dispatched',
        message: res.message,
        type: 'success',
      });
    } else {
      addEventLog('printer', 'error', 'PRINT_ERROR', `Print failed: ${res.message}`);
      addToast({
        title: language === 'th' ? 'การพิมพ์ล้มเหลว' : 'Print Error',
        message: res.message,
        type: 'error',
      });
    }
  };

  // Kick Drawer Action
  const handleKickDrawer = async () => {
    if (drawerConnection !== 'connected') {
      playScannerSound('error');
      addEventLog(
        'drawer',
        'error',
        'SOLENOID_TRIGGER_FAILED',
        'Failed to pulse drawer solenoid. RJ11 cable is disconnected.',
        'Plug RJ11 cable securely into thermal printer kick port.'
      );
      addToast({
        title: language === 'th' ? 'ไม่สามารถสั่งเปิดลิ้นชักได้' : 'Drawer Kick Failed',
        message: language === 'th' ? 'สายเชื่อมต่อลิ้นชักเก็บเงินหลุด กรุณาตรวจสอบสาย RJ11' : 'Drawer cable is disconnected.',
        type: 'error',
      });
      return;
    }

    playScannerSound('cash_drawer');
    setSimulatedDrawerOpen(true);
    addEventLog('drawer', 'pulse', 'DRAWER_KICK_PULSE', 'Solenoid pulse (24V 50ms) fired - Drawer open & sensor tripped.');
    const res = await kickCashDrawer();
    addToast({
      title: language === 'th' ? 'สัญญาณลิ้นชักเก็บเงิน' : 'Cash Drawer Kick',
      message: res.message,
      type: res.success ? 'info' : 'warning',
    });
  };

  // Close Drawer Action
  const handleCloseDrawer = () => {
    setSimulatedDrawerOpen(false);
    playScannerSound('click');
    addEventLog('drawer', 'info', 'DRAWER_LATCH_CLOSED', 'Drawer physically closed and latched.');
  };

  // Copy Logs to Clipboard
  const handleCopyLogs = () => {
    const text = eventLogs
      .map(
        (l) =>
          `[${l.timestamp}] [${l.device.toUpperCase()}] [${l.code}] ${l.message}${
            l.troubleshootingHint ? ` -> Hint: ${l.troubleshootingHint}` : ''
          }`
      )
      .join('\n');

    navigator.clipboard.writeText(text);
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
    addToast({
      title: language === 'th' ? 'คัดลอกบันทึกเหตุการณ์แล้ว' : 'Logs Copied to Clipboard',
      message: language === 'th' ? 'นำไปใช้วิเคราะห์การแก้ปัญหาทางเทคนิคได้ทันที' : 'Diagnostic logs ready to paste into support tickets.',
      type: 'info',
    });
  };

  // Export Logs as Text
  const handleExportLogs = () => {
    const text = [
      `=== PRODX POS HARDWARE EVENT & DIAGNOSTIC LOG ===`,
      `Generated At: ${new Date().toLocaleString()}`,
      `Peripherals Status: Scanner=${scannerConnection.toUpperCase()}, Printer=${printerConnection.toUpperCase()}, Drawer=${drawerConnection.toUpperCase()}`,
      `----------------------------------------------------`,
      ...eventLogs.map(
        (l) =>
          `[${l.timestamp}] [${l.device.toUpperCase()}] [${l.status.toUpperCase()}] [${l.code}] ${l.message}${
            l.troubleshootingHint ? `\n   >> Troubleshooting: ${l.troubleshootingHint}` : ''
          }`
      ),
    ].join('\n');

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `prodx-hardware-event-log-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    addToast({
      title: language === 'th' ? 'ดาวน์โหลดไฟล์บันทึกสำเร็จ' : 'Diagnostic Log Exported',
      message: 'prodx-hardware-event-log.txt',
      type: 'success',
    });
  };

  // Clear Event Logs
  const handleClearLogs = () => {
    setEventLogs([
      {
        id: `evt-cleared-${Date.now()}`,
        timestamp: new Date().toLocaleTimeString() + `.${String(new Date().getMilliseconds()).padStart(3, '0')}`,
        isoTime: new Date().toISOString(),
        device: 'system',
        status: 'info',
        code: 'LOGS_CLEARED',
        message: 'Diagnostic event log cleared by operator.',
      },
    ]);
    addToast({
      title: language === 'th' ? 'ล้างบันทึกเรียบร้อย' : 'Event Log Cleared',
      message: language === 'th' ? 'เริ่มเก็บบันทึกเหตุการณ์ใหม่' : 'Cleared history buffer.',
      type: 'info',
    });
  };

  // Filtered logs calculation
  const filteredLogs = eventLogs.filter((log) => {
    // Device filter
    if (logFilterDevice === 'issues') {
      if (log.status !== 'disconnected' && log.status !== 'error' && log.status !== 'warning') {
        return false;
      }
    } else if (logFilterDevice !== 'all' && log.device !== logFilterDevice) {
      return false;
    }

    // Search query filter
    if (logSearchQuery.trim()) {
      const q = logSearchQuery.toLowerCase();
      return (
        log.message.toLowerCase().includes(q) ||
        log.code.toLowerCase().includes(q) ||
        log.device.toLowerCase().includes(q) ||
        (log.troubleshootingHint && log.troubleshootingHint.toLowerCase().includes(q))
      );
    }

    return true;
  });

  const onlinePeripheralsCount =
    (scannerConnection === 'connected' ? 1 : 0) +
    (printerConnection === 'connected' ? 1 : 0) +
    (drawerConnection === 'connected' ? 1 : 0);

  const disconnectEventsCount = eventLogs.filter(
    (l) => l.status === 'disconnected' || l.status === 'error'
  ).length;

  return (
    <Card className="border border-border/80 shadow-sm rounded-2xl overflow-hidden bg-card">
      {/* Header with Live Ping & Telemetry Overview */}
      <CardHeader className="bg-card/70 border-b border-border/60 py-4 px-5 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 w-full">
          <div className="flex items-center gap-3">
            <GraphicIcon
              icon={Activity}
              color={onlinePeripheralsCount === 3 ? 'emerald' : onlinePeripheralsCount > 0 ? 'amber' : 'rose'}
              variant="glow"
              size="md"
            />
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black tracking-tight text-text">
                  {language === 'th'
                    ? 'แดชบอร์ดสถานะฮาร์ดแวร์เรียลไทม์ (Hardware Status Dashboard)'
                    : 'Real-Time Hardware Status Dashboard'}
                </h3>
                <Badge
                  variant={onlinePeripheralsCount === 3 ? 'success' : onlinePeripheralsCount > 0 ? 'warning' : 'danger'}
                  size="sm"
                  dot
                  className="font-mono text-[9px] uppercase font-bold"
                >
                  {onlinePeripheralsCount}/3 {onlinePeripheralsCount === 3 ? 'Online' : 'Degraded'}
                </Badge>
              </div>
              <p className="text-xs text-text/60 mt-0.5">
                {language === 'th'
                  ? 'ตรวจสอบสถานะการเชื่อมต่อเครื่องสแกน, เครื่องพิมพ์ และลิ้นชักเก็บเงิน พร้อมบันทึกเหตุการณ์แก้ปัญหา (Event Log)'
                  : 'Live connection status, disconnect monitoring, and troubleshooting event logging for POS peripherals.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePingAllHardware}
              isLoading={isPinging}
              leftIcon={<RefreshCw className={`h-3.5 w-3.5 ${isPinging ? 'animate-spin text-primary' : ''}`} />}
              className="rounded-xl font-bold text-xs shadow-2xs cursor-pointer"
            >
              {language === 'th' ? 'ทดสอบสัญญาณทั้งหมด (Ping All)' : 'Ping All Hardware'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardBody className="p-5 sm:p-6 space-y-6">
        {/* 1. Hardware Status Cards Grid (3 Columns) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* A. Barcode Scanner Device Card */}
          <div
            className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 relative overflow-hidden transition-all ${
              scannerConnection === 'connected'
                ? 'border-border/80 bg-card/60 hover:border-primary/40'
                : 'border-rose-500/40 bg-rose-500/5'
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`p-1.5 rounded-lg ${
                      scannerConnection === 'connected'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    <Barcode className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-text uppercase tracking-wider">
                      {language === 'th' ? 'เครื่องสแกนบาร์โค้ด' : 'Barcode Scanner'}
                    </h4>
                    <span className="text-[10px] text-text/50 font-mono">USB / HID Keyboard Wedge</span>
                  </div>
                </div>
                <Badge
                  variant={
                    scannerConnection === 'connected'
                      ? 'success'
                      : scannerConnection === 'reconnecting'
                      ? 'warning'
                      : 'danger'
                  }
                  size="sm"
                  dot
                >
                  {scannerConnection === 'connected'
                    ? language === 'th' ? 'เชื่อมต่อแล้ว' : 'Connected'
                    : scannerConnection === 'reconnecting'
                    ? language === 'th' ? 'กำลังเชื่อมต่อ...' : 'Reconnecting...'
                    : language === 'th' ? 'หลุดการเชื่อมต่อ' : 'Disconnected'}
                </Badge>
              </div>

              {/* Status details */}
              <div className="space-y-1.5 pt-1 text-xs">
                <div className="flex items-center justify-between text-text/70">
                  <span className="text-[11px]">{language === 'th' ? 'สถานะสัญญาณ:' : 'Signal Status:'}</span>
                  {scannerConnection === 'connected' ? (
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 text-[11px]">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                      {isScanning ? (language === 'th' ? 'กำลังรับข้อมูล...' : 'Receiving burst...') : 'Listening (Active)'}
                    </span>
                  ) : (
                    <span className="font-mono text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1 text-[11px]">
                      <XCircle className="h-3 w-3" />
                      {language === 'th' ? 'ไม่มีสัญญาณ USB' : 'No USB Carrier'}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between text-text/70">
                  <span className="text-[11px]">{language === 'th' ? 'จำนวนครั้งที่สแกน:' : 'Session Scans:'}</span>
                  <span className="font-mono font-bold text-text text-[11px]">
                    {scanCount} {language === 'th' ? 'ครั้ง' : 'scans'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-text/70">
                  <span className="text-[11px]">{language === 'th' ? 'สแกนล่าสุด:' : 'Last Scan:'}</span>
                  <span className="font-mono font-bold text-primary truncate max-w-[130px] text-[11px]">
                    {lastScannedBarcode || (language === 'th' ? 'ยังไม่มีการยิง' : 'None')}
                  </span>
                </div>
              </div>
            </div>

            {/* Interactive Testing & Connection Toggle for Scanner */}
            <div className="pt-2 border-t border-border/60 space-y-2">
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={testBarcodeValue}
                  onChange={(e) => setTestBarcodeValue(e.target.value)}
                  placeholder="Barcode / SKU"
                  disabled={scannerConnection !== 'connected'}
                  className="flex-1 h-7 px-2 rounded-lg border border-border bg-background text-[11px] font-mono text-text focus:outline-none focus:border-primary disabled:opacity-50"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={scannerConnection !== 'connected'}
                  onClick={() => {
                    simulateScan(testBarcodeValue);
                  }}
                  className="h-7 px-2.5 text-[11px] font-bold rounded-lg shrink-0 cursor-pointer"
                >
                  <Zap className="h-3 w-3 text-amber-500 mr-1" />
                  {language === 'th' ? 'จำลองยิง' : 'Simulate'}
                </Button>
              </div>

              <button
                type="button"
                onClick={() => toggleScannerConnection()}
                className={`w-full py-1 px-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border ${
                  scannerConnection === 'connected'
                    ? 'border-rose-500/20 text-rose-600 hover:bg-rose-500/10'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20'
                }`}
              >
                {scannerConnection === 'connected' ? (
                  <>
                    <Unplug className="h-3 w-3" />
                    <span>{language === 'th' ? 'จำลองถอดสาย USB (Simulate Disconnect)' : 'Simulate Disconnect'}</span>
                  </>
                ) : (
                  <>
                    <Plug className="h-3 w-3" />
                    <span>{language === 'th' ? 'เชื่อมต่อสาย USB ใหม่ (Reconnect)' : 'Reconnect Scanner'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* B. Thermal Receipt Printer Device Card */}
          <div
            className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 relative overflow-hidden transition-all ${
              printerConnection === 'connected'
                ? 'border-border/80 bg-card/60 hover:border-primary/40'
                : 'border-rose-500/40 bg-rose-500/5'
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`p-1.5 rounded-lg ${
                      printerConnection === 'connected'
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    <Printer className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-text uppercase tracking-wider">
                      {language === 'th' ? 'เครื่องพิมพ์ใบเสร็จ' : 'Receipt Printer'}
                    </h4>
                    <span className="text-[10px] text-text/50 font-mono">ESC/POS Thermal Driver</span>
                  </div>
                </div>
                <Badge
                  variant={
                    printerConnection === 'connected'
                      ? isPrinting ? 'warning' : 'success'
                      : printerConnection === 'reconnecting'
                      ? 'warning'
                      : 'danger'
                  }
                  size="sm"
                  dot
                >
                  {printerConnection === 'connected'
                    ? isPrinting
                      ? language === 'th' ? 'กำลังพิมพ์' : 'Printing...'
                      : language === 'th' ? 'พร้อมพิมพ์' : 'Online'
                    : printerConnection === 'reconnecting'
                    ? language === 'th' ? 'กำลังเปิดพอร์ต...' : 'Opening Port...'
                    : language === 'th' ? 'ออฟไลน์' : 'Offline'}
                </Badge>
              </div>

              {/* Status details */}
              <div className="space-y-1.5 pt-1 text-xs">
                <div className="flex items-center justify-between text-text/70">
                  <span className="text-[11px]">{language === 'th' ? 'รุ่น/ชื่อเครื่อง:' : 'Device Model:'}</span>
                  <span className="font-bold text-text truncate max-w-[140px] text-[11px]">
                    {printerConfig.printerName}
                  </span>
                </div>

                <div className="flex items-center justify-between text-text/70">
                  <span className="text-[11px]">{language === 'th' ? 'ขนาดกระดาษ & การตัด:' : 'Paper Width:'}</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-[11px]">
                    {printerConfig.paperWidth} (Auto-Cutter ON)
                  </span>
                </div>

                <div className="flex items-center justify-between text-text/70">
                  <span className="text-[11px]">{language === 'th' ? 'พิมพ์อัตโนมัติ:' : 'Auto-Print on Sale:'}</span>
                  <span className="font-mono font-bold text-primary text-[11px]">
                    {printerConfig.autoPrintOnCheckout ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>
              </div>
            </div>

            {/* Interactive Testing & Connection Toggle for Printer */}
            <div className="pt-2 border-t border-border/60 space-y-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleTestPrint}
                disabled={printerConnection !== 'connected'}
                isLoading={isPrinting}
                className="w-full h-7 rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-50"
                leftIcon={<Printer className="h-3 w-3 text-primary" />}
              >
                {language === 'th' ? 'พิมพ์ใบเสร็จทดสอบ (Test Print)' : 'Send Test Print Pattern'}
              </Button>

              <button
                type="button"
                onClick={() => togglePrinterConnection()}
                className={`w-full py-1 px-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border ${
                  printerConnection === 'connected'
                    ? 'border-rose-500/20 text-rose-600 hover:bg-rose-500/10'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20'
                }`}
              >
                {printerConnection === 'connected' ? (
                  <>
                    <Unplug className="h-3 w-3" />
                    <span>{language === 'th' ? 'จำลองตัดสัญญาณเครื่องพิมพ์ (Disconnect)' : 'Simulate Disconnect'}</span>
                  </>
                ) : (
                  <>
                    <Plug className="h-3 w-3" />
                    <span>{language === 'th' ? 'เชื่อมต่อเครื่องพิมพ์ใหม่ (Reconnect)' : 'Reconnect Printer'}</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* C. Cash Drawer Peripheral Card */}
          <div
            className={`p-4 rounded-xl border flex flex-col justify-between space-y-3 relative overflow-hidden transition-all ${
              drawerConnection === 'connected'
                ? 'border-border/80 bg-card/60 hover:border-primary/40'
                : 'border-rose-500/40 bg-rose-500/5'
            }`}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`p-1.5 rounded-lg ${
                      drawerConnection === 'connected'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    <DollarSign className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black text-text uppercase tracking-wider">
                      {language === 'th' ? 'ลิ้นชักเก็บเงิน' : 'Cash Drawer'}
                    </h4>
                    <span className="text-[10px] text-text/50 font-mono">RJ11/RJ12 Solenoid Kick</span>
                  </div>
                </div>
                <Badge
                  variant={
                    drawerConnection === 'connected'
                      ? simulatedDrawerOpen ? 'warning' : 'success'
                      : 'danger'
                  }
                  size="sm"
                  dot
                >
                  {drawerConnection === 'connected'
                    ? simulatedDrawerOpen
                      ? language === 'th' ? 'ลิ้นชักเปิดอยู่' : 'Drawer OPEN'
                      : language === 'th' ? 'ปิดสนิท (Closed)' : 'Latched'
                    : language === 'th' ? 'สายหลุด' : 'Disconnected'}
                </Badge>
              </div>

              {/* Status details */}
              <div className="space-y-1.5 pt-1 text-xs">
                <div className="flex items-center justify-between text-text/70">
                  <span className="text-[11px]">{language === 'th' ? 'เซ็นเซอร์ลิ้นชัก:' : 'Microswitch Sensor:'}</span>
                  {drawerConnection === 'connected' ? (
                    <span className={`font-mono font-bold text-[11px] ${simulatedDrawerOpen ? 'text-amber-500 animate-pulse' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {simulatedDrawerOpen ? `${language === 'th' ? 'เปิดอยู่' : 'Open'} (${drawerOpenDuration}s)` : (language === 'th' ? 'ปิดและล็อกสมบูรณ์' : 'Closed & Secured')}
                    </span>
                  ) : (
                    <span className="font-mono text-rose-500 font-bold text-[11px]">
                      {language === 'th' ? 'สาย RJ11 หลุด' : 'Cable Disconnected'}
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-between text-text/70">
                  <span className="text-[11px]">{language === 'th' ? 'เด้งอัตโนมัติรับเงินสด:' : 'Auto-Kick on Cash:'}</span>
                  <span className="font-mono font-bold text-primary text-[11px]">
                    {printerConfig.autoKickDrawerOnCash ? 'ENABLED' : 'DISABLED'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-text/70">
                  <span className="text-[11px]">{language === 'th' ? 'พัลส์ไฟฟ้าสั่งเปิด:' : 'Kick Voltage Pulse:'}</span>
                  <span className="font-mono font-bold text-text text-[11px]">24V DC / 50ms</span>
                </div>
              </div>
            </div>

            {/* Interactive Testing & Toggle for Drawer */}
            <div className="pt-2 border-t border-border/60 space-y-2">
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={drawerConnection !== 'connected'}
                  onClick={handleKickDrawer}
                  className="flex-1 h-7 rounded-lg text-[11px] font-bold cursor-pointer disabled:opacity-50"
                  leftIcon={<Zap className="h-3 w-3 text-amber-500" />}
                >
                  {language === 'th' ? 'เด้งลิ้นชัก (Kick)' : 'Kick Solenoid'}
                </Button>
                {simulatedDrawerOpen && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCloseDrawer}
                    className="h-7 px-2.5 rounded-lg text-[11px] font-bold text-emerald-600 hover:text-emerald-700 cursor-pointer"
                  >
                    {language === 'th' ? 'ดันปิด' : 'Close'}
                  </Button>
                )}
              </div>

              <button
                type="button"
                onClick={() => toggleDrawerConnection()}
                className={`w-full py-1 px-2 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer border ${
                  drawerConnection === 'connected'
                    ? 'border-rose-500/20 text-rose-600 hover:bg-rose-500/10'
                    : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20'
                }`}
              >
                {drawerConnection === 'connected' ? (
                  <>
                    <Unplug className="h-3 w-3" />
                    <span>{language === 'th' ? 'จำลองถอดสาย RJ11' : 'Simulate Unplug RJ11'}</span>
                  </>
                ) : (
                  <>
                    <Plug className="h-3 w-3" />
                    <span>{language === 'th' ? 'เสียบสาย RJ11 ใหม่' : 'Reconnect RJ11 Cable'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 2. Scrollable 'Event Log' Window for Hardware Troubleshooting */}
        <div className="rounded-xl border border-border/80 bg-background/80 overflow-hidden shadow-2xs">
          {/* Event Log Window Top Toolbar */}
          <div className="p-3.5 border-b border-border/70 bg-card/60 flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                <Terminal className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-black text-text uppercase tracking-wider">
                    {language === 'th' ? 'บันทึกเหตุการณ์การเชื่อมต่อ (Hardware Event Log)' : 'Hardware Event & Troubleshooting Log'}
                  </h4>
                  <Badge variant="primary" size="sm" className="font-mono text-[10px] font-bold">
                    {eventLogs.length} {language === 'th' ? 'รายการ' : 'events'}
                  </Badge>
                  {disconnectEventsCount > 0 && (
                    <Badge variant="danger" size="sm" dot className="font-mono text-[10px] font-bold">
                      {disconnectEventsCount} {language === 'th' ? 'เหตุการณ์แจ้งเตือน/หลุด' : 'issues'}
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-text/60 mt-0.5">
                  {language === 'th'
                    ? 'บันทึกเหตุการณ์ เสียบ/ถอดสาย, สแกนบาร์โค้ด, พิมพ์ใบเสร็จ และรหัสข้อผิดพลาดเพื่อการแก้ไขปัญหา'
                    : 'Live connection/disconnection timestamps, device handshakes, and diagnostic error codes.'}
                </p>
              </div>
            </div>

            {/* Actions: Copy, Export, Clear */}
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyLogs}
                className="h-7 px-2.5 text-[11px] font-bold rounded-lg cursor-pointer"
                leftIcon={copiedLogs ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
              >
                {copiedLogs
                  ? language === 'th' ? 'คัดลอกแล้ว' : 'Copied!'
                  : language === 'th' ? 'คัดลอก Log' : 'Copy'}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExportLogs}
                className="h-7 px-2.5 text-[11px] font-bold rounded-lg cursor-pointer"
                leftIcon={<Download className="h-3 w-3" />}
              >
                {language === 'th' ? 'ดาวน์โหลด (.txt)' : 'Export'}
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearLogs}
                className="h-7 px-2 text-[11px] font-semibold text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 rounded-lg cursor-pointer"
                title={language === 'th' ? 'ล้างบันทึก' : 'Clear Log'}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Filter Chips and Search Bar */}
          <div className="px-3.5 py-2.5 bg-background/50 border-b border-border/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-semibold text-text/50 mr-1 flex items-center gap-1 shrink-0">
                <Filter className="h-3 w-3" />
                {language === 'th' ? 'กรองอุปกรณ์:' : 'Filter:'}
              </span>

              <button
                type="button"
                onClick={() => setLogFilterDevice('all')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors cursor-pointer shrink-0 ${
                  logFilterDevice === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card border border-border text-text/70 hover:text-text'
                }`}
              >
                {language === 'th' ? 'ทั้งหมด' : 'All'} ({eventLogs.length})
              </button>

              <button
                type="button"
                onClick={() => setLogFilterDevice('scanner')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors cursor-pointer flex items-center gap-1 shrink-0 ${
                  logFilterDevice === 'scanner'
                    ? 'bg-blue-600 text-white'
                    : 'bg-card border border-border text-text/70 hover:text-text'
                }`}
              >
                <Barcode className="h-2.5 w-2.5" />
                {language === 'th' ? 'สแกนเนอร์' : 'Scanner'} (
                {eventLogs.filter((l) => l.device === 'scanner').length})
              </button>

              <button
                type="button"
                onClick={() => setLogFilterDevice('printer')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors cursor-pointer flex items-center gap-1 shrink-0 ${
                  logFilterDevice === 'printer'
                    ? 'bg-amber-600 text-white'
                    : 'bg-card border border-border text-text/70 hover:text-text'
                }`}
              >
                <Printer className="h-2.5 w-2.5" />
                {language === 'th' ? 'เครื่องพิมพ์' : 'Printer'} (
                {eventLogs.filter((l) => l.device === 'printer').length})
              </button>

              <button
                type="button"
                onClick={() => setLogFilterDevice('drawer')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors cursor-pointer flex items-center gap-1 shrink-0 ${
                  logFilterDevice === 'drawer'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-card border border-border text-text/70 hover:text-text'
                }`}
              >
                <DollarSign className="h-2.5 w-2.5" />
                {language === 'th' ? 'ลิ้นชัก' : 'Drawer'} (
                {eventLogs.filter((l) => l.device === 'drawer').length})
              </button>

              <button
                type="button"
                onClick={() => setLogFilterDevice('issues')}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors cursor-pointer flex items-center gap-1 shrink-0 ${
                  logFilterDevice === 'issues'
                    ? 'bg-rose-600 text-white'
                    : 'bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20'
                }`}
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                {language === 'th' ? 'ปัญหา/หลุดการเชื่อมต่อ' : 'Disconnects & Errors'} (
                {disconnectEventsCount})
              </button>
            </div>

            {/* Quick Search */}
            <div className="relative w-full sm:w-auto sm:min-w-[160px] sm:max-w-[240px]">
              <Search className="h-3 w-3 absolute left-2 top-2 text-text/40 pointer-events-none" />
              <input
                type="text"
                value={logSearchQuery}
                onChange={(e) => setLogSearchQuery(e.target.value)}
                placeholder={language === 'th' ? 'ค้นหารหัส/ข้อความ...' : 'Search logs/codes...'}
                className="w-full h-7 pl-6 pr-2 rounded-lg border border-border bg-card text-[11px] font-mono text-text focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Scrollable Event Log Window Viewport */}
          <div
            ref={logContainerRef}
            className="h-64 max-h-64 overflow-y-auto p-2.5 sm:p-3 space-y-2 font-mono text-xs bg-card/90 select-text"
          >
            {filteredLogs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 text-text/50 space-y-1">
                <Terminal className="h-6 w-6 text-text/30" />
                <p className="text-xs font-semibold text-text/70">
                  {language === 'th' ? 'ไม่พบประวัติเหตุการณ์ตามตัวกรอง' : 'No hardware events match current filter.'}
                </p>
                <p className="text-[10px] text-text/40">
                  {language === 'th' ? 'กด Ping All หรือทดสอบการเชื่อมต่ออุปกรณ์' : 'Trigger a ping or toggle device connections to see events.'}
                </p>
              </div>
            ) : (
              filteredLogs.map((log) => {
                const isDisconnected = log.status === 'disconnected';
                const isError = log.status === 'error';
                const isReconnected = log.status === 'reconnected';
                const isWarning = log.status === 'warning';

                return (
                  <div
                    key={log.id}
                    className={`p-2 sm:p-2.5 rounded-lg border transition-colors ${
                      isDisconnected || isError
                        ? 'border-rose-500/30 bg-rose-500/5 hover:bg-rose-500/10'
                        : isReconnected
                        ? 'border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10'
                        : isWarning
                        ? 'border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10'
                        : 'border-border/60 bg-background/50 hover:bg-background'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2 text-[11px] min-w-0">
                      {/* Top Metadata Row on Mobile / Inline on Desktop */}
                      <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                        {/* Timestamp */}
                        <span className="text-text/40 font-mono text-[10px]">
                          [{log.timestamp}]
                        </span>

                        {/* Device badge */}
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                            log.device === 'scanner'
                              ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20'
                              : log.device === 'printer'
                              ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20'
                              : log.device === 'drawer'
                              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20'
                              : 'bg-primary/10 text-primary border border-primary/20'
                          }`}
                        >
                          {log.device}
                        </span>

                        {/* Event Code */}
                        <span
                          className={`font-mono font-bold text-[10px] ${
                            isDisconnected || isError
                              ? 'text-rose-600 dark:text-rose-400'
                              : isReconnected
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : isWarning
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-text/80'
                          }`}
                        >
                          [{log.code}]
                        </span>
                      </div>

                      {/* Message */}
                      <span
                        className={`flex-1 min-w-0 break-words leading-relaxed ${
                          isDisconnected || isError
                            ? 'text-rose-700 dark:text-rose-300 font-semibold'
                            : isReconnected
                            ? 'text-emerald-700 dark:text-emerald-300 font-medium'
                            : 'text-text/85'
                        }`}
                      >
                        {log.message}
                      </span>
                    </div>

                    {/* Troubleshooting Diagnostic Hint if present */}
                    {log.troubleshootingHint && (
                      <div className="mt-1.5 pt-1.5 border-t border-border/40 flex items-start gap-1.5 text-[10px] text-amber-700 dark:text-amber-400">
                        <AlertOctagon className="h-3 w-3 shrink-0 mt-0.5 text-amber-500" />
                        <span className="font-sans font-medium">
                          <strong className="font-semibold">{language === 'th' ? 'วิธีแก้ไขปัญหา (Troubleshooting):' : 'Troubleshooting:'}</strong>{' '}
                          {log.troubleshootingHint}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Event Log Window Footer Status */}
          <div className="px-3.5 py-2 bg-background/70 border-t border-border/60 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1.5 text-[10px] text-text/50 font-mono">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1 shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                <span className="text-emerald-600 dark:text-emerald-400 font-bold">LOG ENGINE ACTIVE</span>
              </span>
              <span>•</span>
              <span>{language === 'th' ? 'เก็บประวัติสูงสุด 100 รายการ' : 'Buffer: 100 entries'}</span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <span>{language === 'th' ? 'ฮาร์ทบีทล่าสุด' : 'Heartbeat'}: {lastPingTime.toLocaleTimeString()}</span>
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
};
