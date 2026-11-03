import { HardwarePeripheralStatus } from '../types/hardware';
import { triggerHaptic } from './hapticService';
import { auditService } from './auditService';

export type PeripheralConnectivityAlertState = 'online' | 'error' | 'offline' | 'maintenance';

export type SystemNotificationStatusType = 'error' | 'offline' | 'recovered';

export interface SystemNotificationToastItem {
  id: string;
  peripheralId: string;
  deviceName: string;
  category: HardwarePeripheralStatus['category'] | 'system';
  port: string;
  interfaceType: string;
  locationTag: string;
  previousStatus: string;
  status: SystemNotificationStatusType;
  severity: 'critical' | 'error' | 'warning' | 'resolved';
  title: string;
  message: string;
  recommendedAction: string;
  timestamp: string;
  createdAtMs: number;
  durationMs: number;
  acknowledged: boolean;
  peripheral?: HardwarePeripheralStatus;
}

export interface SystemNotificationListenerPayload {
  notifications: SystemNotificationToastItem[];
  history: SystemNotificationToastItem[];
  latestTriggered?: SystemNotificationToastItem;
}

type SystemNotificationListener = (payload: SystemNotificationListenerPayload) => void;

export interface EvaluatePeripheralsOptions {
  /**
   * When true, peripherals that are already in 'error' or 'offline' on the first evaluation
   * will also emit an initial corner toast notification so the admin is immediately alerted.
   */
  notifyOnInitialFault?: boolean;
  /**
   * When true, emits a brief recovery toast when a peripheral transitions from 'error'/'offline' back to 'online'.
   */
  notifyOnRecovery?: boolean;
}

/**
 * Synthesizes an acoustic notification tone via Web Audio API when a peripheral transitions
 * to 'Error' or 'Offline' (safe no-op in non-browser/SSR environments).
 */
export function playSystemNotificationTone(type: SystemNotificationStatusType): void {
  if (typeof window === 'undefined') return;

  try {
    const savedMute = window.localStorage?.getItem('prodx_infra_alert_sound');
    if (savedMute === 'false') return;
  } catch {
    // ignore storage access issues
  }

  triggerHaptic(type === 'recovered' ? 'light' : 'error');

  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();

    const playTone = (
      freqStart: number,
      freqEnd: number,
      startOffset: number,
      duration: number,
      volume: number,
      wave: OscillatorType,
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = wave;
      osc.frequency.setValueAtTime(freqStart, ctx.currentTime + startOffset);
      osc.frequency.linearRampToValueAtTime(freqEnd, ctx.currentTime + startOffset + duration);

      gain.gain.setValueAtTime(0.001, ctx.currentTime + startOffset);
      gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + startOffset);
      osc.stop(ctx.currentTime + startOffset + duration + 0.02);
    };

    if (type === 'error') {
      // Urgent 3-pulse hardware error siren
      playTone(880, 659.25, 0, 0.14, 0.18, 'sawtooth');
      playTone(880, 659.25, 0.18, 0.14, 0.18, 'sawtooth');
      playTone(987.77, 587.33, 0.36, 0.24, 0.22, 'sawtooth');
    } else if (type === 'offline') {
      // Descending 2-tone connectivity loss alert
      playTone(740, 523.25, 0, 0.18, 0.18, 'triangle');
      playTone(523.25, 370, 0.22, 0.26, 0.2, 'sawtooth');
    } else {
      // Ascending recovery chime
      playTone(523.25, 659.25, 0, 0.12, 0.12, 'sine');
      playTone(659.25, 880, 0.14, 0.18, 0.14, 'sine');
    }
  } catch {
    // Ignore Web Audio API restrictions if user hasn't interacted yet
  }
}

/**
 * Derives the normalized connectivity/health state for a peripheral.
 * Priority:
 * 1. 'maintenance' if `isMaintenanceMode` is true
 * 2. 'offline' if `connectivity.state === 'disconnected'`
 * 3. 'error' if pulseState === 'error', driverHealth is degraded/patch_required, or errorCountToday > 0
 * 4. 'online' otherwise
 */
export function resolvePeripheralAlertState(
  peripheral: HardwarePeripheralStatus,
  pulseState?: 'idle' | 'active' | 'error',
): PeripheralConnectivityAlertState {
  if (peripheral.isMaintenanceMode) {
    return 'maintenance';
  }
  if (peripheral.connectivity.state === 'disconnected') {
    return 'offline';
  }
  if (
    pulseState === 'error' ||
    peripheral.driverHealth.status === 'degraded' ||
    peripheral.driverHealth.status === 'patch_required' ||
    peripheral.telemetryData.errorCountToday > 0
  ) {
    return 'error';
  }
  return 'online';
}

function buildPeripheralNotificationContent(
  peripheral: HardwarePeripheralStatus,
  targetStatus: SystemNotificationStatusType,
  previousStatus: string,
  customReason?: string,
): Omit<
  SystemNotificationToastItem,
  'id' | 'timestamp' | 'createdAtMs' | 'acknowledged'
> {
  const locationTag = peripheral.tags?.[0] || 'Main POS Terminal';

  if (targetStatus === 'offline') {
    return {
      peripheralId: peripheral.id,
      deviceName: peripheral.name,
      category: peripheral.category,
      port: peripheral.port,
      interfaceType: peripheral.connectivity.interface,
      locationTag,
      previousStatus,
      status: 'offline',
      severity: 'critical',
      title: `📡 อุปกรณ์หลุดการเชื่อมต่อ (OFFLINE): ${peripheral.name}`,
      message:
        customReason ||
        `สถานะการเชื่อมต่อเปลี่ยนจาก ${previousStatus.toUpperCase()} เป็น OFFLINE (Disconnected) บนพอร์ต ${peripheral.port} (${peripheral.connectivity.interface})`,
      recommendedAction:
        'กด "Auto-Reconnect" เพื่อส่งสัญญาณ Handshake กู้คืนพอร์ต หรือตรวจสอบสายเชื่อมต่อฮาร์ดแวร์',
      durationMs: 10000,
      peripheral,
    };
  }

  if (targetStatus === 'error') {
    let defaultDetail =
      peripheral.driverHealth.diagnostics ||
      `ตรวจพบสถานะ ERROR บนพอร์ต ${peripheral.port} (${peripheral.connectivity.interface})`;

    if (peripheral.category === 'printer') {
      defaultDetail = `เครื่องพิมพ์ใบเสร็จรายงานสถานะ ERROR บนพอร์ต ${peripheral.port} — กระดาษหมด / หัวพิมพ์ความร้อนสูง หรือคิวพิมพ์ค้าง`;
    } else if (peripheral.category === 'scanner') {
      defaultDetail = `สแกนเนอร์บาร์โค้ดรายงานสถานะ ERROR บนพอร์ต ${peripheral.port} — เซนเซอร์อ่านค่าไม่ตอบสนองหรือเกิด Bus Timeout`;
    } else if (peripheral.category === 'drawer') {
      defaultDetail = `ลิ้นชักเก็บเงินรายงานสถานะ ERROR บนพอร์ต ${peripheral.port} — โซลินอยด์ 24V หรือไมโครสวิตช์ขัดข้อง`;
    } else if (peripheral.category === 'edc') {
      defaultDetail = `เครื่องรูดบัตร EDC รายงานสถานะ ERROR บนพอร์ต ${peripheral.port} — การเชื่อมต่อเกตเวย์ชำระเงินขัดข้อง`;
    }

    return {
      peripheralId: peripheral.id,
      deviceName: peripheral.name,
      category: peripheral.category,
      port: peripheral.port,
      interfaceType: peripheral.connectivity.interface,
      locationTag,
      previousStatus,
      status: 'error',
      severity: 'error',
      title: `🚨 อุปกรณ์เกิดข้อผิดพลาด (ERROR): ${peripheral.name}`,
      message: customReason || defaultDetail,
      recommendedAction:
        'กด "รีบูตอุปกรณ์" หรือ "วินิจฉัย & ซ่อมแซม" เพื่อให้แอดมินกู้คืนการทำงานได้ทันที',
      durationMs: 9500,
      peripheral,
    };
  }

  return {
    peripheralId: peripheral.id,
    deviceName: peripheral.name,
    category: peripheral.category,
    port: peripheral.port,
    interfaceType: peripheral.connectivity.interface,
    locationTag,
    previousStatus,
    status: 'recovered',
    severity: 'resolved',
    title: `✅ กู้คืนสถานะออนไลน์สำเร็จ: ${peripheral.name}`,
    message:
      customReason ||
      `อุปกรณ์บนพอร์ต ${peripheral.port} กลับเข้าสู่สถานะ ONLINE / พร้อมใช้งานปกติเรียบร้อยแล้ว`,
    recommendedAction: 'ระบบกลับมาเฝ้าระวังสถานะฮาร์ดแวร์แบบเรียลไทม์ตามปกติ',
    durationMs: 4500,
    peripheral,
  };
}

class SystemNotificationService {
  private notifications: SystemNotificationToastItem[] = [];
  private history: SystemNotificationToastItem[] = [];
  private listeners: Set<SystemNotificationListener> = new Set();
  private previousStates: Map<string, PeripheralConnectivityAlertState> = new Map();
  private hasInitializedBaseline = false;
  private maxVisibleToasts = 5;
  private maxHistoryItems = 30;

  public subscribe(listener: SystemNotificationListener): () => void {
    this.listeners.add(listener);
    listener({
      notifications: [...this.notifications],
      history: [...this.history],
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(latestTriggered?: SystemNotificationToastItem): void {
    const snapshot: SystemNotificationListenerPayload = {
      notifications: [...this.notifications],
      history: [...this.history],
      latestTriggered,
    };
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('[SystemNotificationService] Listener error:', err);
      }
    });
  }

  public getNotifications(): SystemNotificationToastItem[] {
    return [...this.notifications];
  }

  public getHistory(): SystemNotificationToastItem[] {
    return [...this.history];
  }

  public getPeripheralStatusMap(): Record<string, PeripheralConnectivityAlertState> {
    return Object.fromEntries(this.previousStates.entries());
  }

  /**
   * Pushes a new notification item to the global corner toast stack.
   * Deduplicates active notifications for the same peripheral + status.
   */
  public pushNotification(
    item: Omit<SystemNotificationToastItem, 'id' | 'timestamp' | 'createdAtMs' | 'acknowledged'>,
  ): SystemNotificationToastItem {
    const now = Date.now();
    const timestamp = new Date(now).toLocaleTimeString('th-TH', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const newItem: SystemNotificationToastItem = {
      ...item,
      id: `sys-notif-${item.peripheralId}-${item.status}-${now}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp,
      createdAtMs: now,
      acknowledged: false,
    };

    // Remove any existing active toast for the same peripheral so the latest state transition replaces it cleanly
    const filteredActive = this.notifications.filter(
      (existing) => existing.peripheralId !== item.peripheralId,
    );

    this.notifications = [newItem, ...filteredActive].slice(0, this.maxVisibleToasts);
    this.history = [newItem, ...this.history].slice(0, this.maxHistoryItems);

    playSystemNotificationTone(newItem.status);

    // Enqueue connectivity transition into the background diagnostic log buffer for batch Firestore upload
    auditService.logDiagnosticEvent({
      peripheralId: newItem.peripheralId,
      deviceName: newItem.deviceName,
      category: newItem.category,
      level:
        newItem.status === 'offline'
          ? 'CRITICAL'
          : newItem.status === 'error'
          ? 'ERROR'
          : 'INFO',
      event:
        newItem.status === 'offline'
          ? 'CONNECTIVITY_OFFLINE'
          : newItem.status === 'error'
          ? 'PERIPHERAL_ERROR'
          : 'CONNECTIVITY_RECOVERED',
      message: `${newItem.title} — ${newItem.message}`,
      port: newItem.port,
      interfaceType: newItem.interfaceType,
      metadata: {
        previousStatus: newItem.previousStatus,
        currentStatus: newItem.status,
        locationTag: newItem.locationTag,
      },
    });

    this.emit(newItem);

    return newItem;
  }

  /**
   * Explicitly triggers a peripheral connectivity/status transition notification ('error' | 'offline' | 'recovered').
   */
  public notifyPeripheralStatusChange(
    peripheral: HardwarePeripheralStatus,
    targetStatus: SystemNotificationStatusType,
    customReason?: string,
  ): SystemNotificationToastItem {
    const prevState = this.previousStates.get(peripheral.id) || 'online';
    const nextTrackedState: PeripheralConnectivityAlertState =
      targetStatus === 'recovered' ? 'online' : targetStatus;

    this.previousStates.set(peripheral.id, nextTrackedState);

    const content = buildPeripheralNotificationContent(
      peripheral,
      targetStatus,
      prevState,
      customReason,
    );

    return this.pushNotification(content);
  }

  /**
   * Evaluates a list of peripherals against their previously recorded states and automatically
   * dispatches framer-motion corner toast notifications whenever any peripheral transitions
   * to 'error' or 'offline' (or recovers back to 'online').
   */
  public evaluatePeripherals(
    peripherals: HardwarePeripheralStatus[],
    getPulseState?: (peripheral: HardwarePeripheralStatus) => 'idle' | 'active' | 'error',
    options: EvaluatePeripheralsOptions = {},
  ): SystemNotificationToastItem[] {
    const { notifyOnInitialFault = true, notifyOnRecovery = true } = options;
    const triggered: SystemNotificationToastItem[] = [];
    const isFirstEvaluation = !this.hasInitializedBaseline && this.previousStates.size === 0;

    for (const peripheral of peripherals) {
      const pulseState = getPulseState ? getPulseState(peripheral) : undefined;
      const currentState = resolvePeripheralAlertState(peripheral, pulseState);
      const previousState = this.previousStates.get(peripheral.id);

      // Update tracked state
      this.previousStates.set(peripheral.id, currentState);

      if (currentState === 'maintenance') {
        // Silence notifications and remove active toasts if placed into maintenance mode
        this.dismissByPeripheralId(peripheral.id);
        continue;
      }

      if (previousState === undefined) {
        // First time seeing this peripheral
        if (
          isFirstEvaluation &&
          notifyOnInitialFault &&
          (currentState === 'error' || currentState === 'offline')
        ) {
          const content = buildPeripheralNotificationContent(
            peripheral,
            currentState,
            'online',
          );
          triggered.push(this.pushNotification(content));
        }
        continue;
      }

      // If state did not change, keep peripheral reference fresh in any existing toast
      if (previousState === currentState) {
        this.notifications = this.notifications.map((n) =>
          n.peripheralId === peripheral.id ? { ...n, peripheral } : n,
        );
        continue;
      }

      // Transition to 'offline' or 'error'
      if (currentState === 'offline' || currentState === 'error') {
        const content = buildPeripheralNotificationContent(
          peripheral,
          currentState,
          previousState,
        );
        triggered.push(this.pushNotification(content));
      } else if (
        currentState === 'online' &&
        (previousState === 'offline' || previousState === 'error')
      ) {
        // Peripheral recovered from error/offline -> online
        if (notifyOnRecovery) {
          const content = buildPeripheralNotificationContent(
            peripheral,
            'recovered',
            previousState,
          );
          triggered.push(this.pushNotification(content));
        } else {
          this.dismissByPeripheralId(peripheral.id);
        }
      }
    }

    if (peripherals.length > 0) {
      this.hasInitializedBaseline = true;
    }

    return triggered;
  }

  public dismissNotification(id: string): void {
    const next = this.notifications.filter((n) => n.id !== id);
    if (next.length !== this.notifications.length) {
      this.notifications = next;
      this.emit();
    }
  }

  public dismissByPeripheralId(peripheralId: string): void {
    const next = this.notifications.filter((n) => n.peripheralId !== peripheralId);
    if (next.length !== this.notifications.length) {
      this.notifications = next;
      this.emit();
    }
  }

  public acknowledgeNotification(id: string): void {
    this.notifications = this.notifications.map((n) =>
      n.id === id ? { ...n, acknowledged: true } : n,
    );
    this.history = this.history.map((n) =>
      n.id === id ? { ...n, acknowledged: true } : n,
    );
    this.emit();
  }

  public clearAllNotifications(): void {
    if (this.notifications.length > 0) {
      this.notifications = [];
      this.emit();
    }
  }

  public resetState(): void {
    this.notifications = [];
    this.history = [];
    this.previousStates.clear();
    this.hasInitializedBaseline = false;
    this.emit();
  }
}

export const systemNotificationService = new SystemNotificationService();
