/**
 * PRODX POS — Persistent Toast Notification Service
 *
 * Provides a centralized, persistent-capable toast notification manager and
 * dedicated online/offline transition alerter bound to OfflineProvider.
 */

import { playScannerSound } from './soundService';
import { auditService } from './auditService';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  type: ToastType;
  /** Duration in ms. Set to 0 or omit when persistent=true to keep pinned. */
  durationMs?: number;
  /** When true, the toast does not auto-dismiss until resolved or closed by user. */
  persistent?: boolean;
  /** Optional status badge (e.g. 'OFFLINE • OUTBOX QUEUE', 'ONLINE • SYNCING') */
  badge?: string;
  /** Primary interactive action button label */
  actionLabel?: string;
  /** Primary interactive action callback */
  onAction?: () => void;
  /** Secondary interactive action button label */
  onSecondaryAction?: () => void;
  secondaryActionLabel?: string;
  createdAt?: string;
}

export type AddToastInput = Omit<ToastItem, 'id'> & { id?: string };

export interface ConnectivityTransitionPayload {
  isOnline: boolean;
  isSimulatedOffline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  language: 'th' | 'en' | 'zh' | string;
  onTriggerSync?: () => void;
  onToggleSimulatedOffline?: () => void;
  onOpenSyncActivity?: () => void;
  /** True when updating an already-active offline toast with a new pendingCount */
  silentUpdate?: boolean;
}

export const CONNECTIVITY_TOAST_ID = 'prodx-connectivity-status-toast';
const CONNECTIVITY_STATE_STORAGE_KEY = 'prodx.connectivity.toast_state';

type ToastListener = (toasts: ToastItem[]) => void;

class ToastNotificationService {
  private toasts: ToastItem[] = [];
  private listeners = new Set<ToastListener>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  public subscribe(listener: ToastListener): () => void {
    this.listeners.add(listener);
    listener(this.toasts);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snapshot = [...this.toasts];
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private clearTimer(id: string): void {
    const existing = this.timers.get(id);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(id);
    }
  }

  public getToasts(): ToastItem[] {
    return [...this.toasts];
  }

  /**
   * Adds or updates a toast notification. If an `id` is provided and already exists,
   * replaces the existing toast in-place (preserving position or moving to top).
   */
  public showToast(
    input: AddToastInput,
    options?: { suppressSound?: boolean }
  ): string {
    const id =
      input.id ||
      `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const isPersistent = Boolean(input.persistent) || input.durationMs === 0;
    const durationMs = isPersistent ? 0 : (input.durationMs ?? 4000);

    this.clearTimer(id);

    const item: ToastItem = {
      ...input,
      id,
      persistent: isPersistent,
      durationMs,
      createdAt: input.createdAt || new Date().toISOString(),
    };

    const existingIndex = this.toasts.findIndex((t) => t.id === id);
    if (existingIndex >= 0) {
      const updated = [...this.toasts];
      updated[existingIndex] = item;
      this.toasts = updated;
    } else {
      this.toasts = [...this.toasts, item];
    }

    if (!options?.suppressSound) {
      this.triggerSoundFeedback(item);
    }

    if (!isPersistent && durationMs > 0) {
      const timer = setTimeout(() => {
        this.dismissToast(id);
      }, durationMs);
      this.timers.set(id, timer);
    }

    this.emit();
    return id;
  }

  public dismissToast(id: string): void {
    this.clearTimer(id);
    const next = this.toasts.filter((t) => t.id !== id);
    if (next.length !== this.toasts.length) {
      this.toasts = next;
      this.emit();
    }
  }

  public clearAll(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.toasts = [];
    this.emit();
  }

  private triggerSoundFeedback(item: ToastItem): void {
    try {
      if (item.type === 'error') {
        playScannerSound('error');
      } else if (item.type === 'warning') {
        playScannerSound('warning');
      } else if (item.type === 'success') {
        const isCheckoutSuccess =
          item.title.includes('ชำระเงิน') ||
          item.title.includes('Payment') ||
          item.title.includes('พิมพ์ใบเสร็จ');
        if (!isCheckoutSuccess) {
          playScannerSound('success');
        }
      } else if (item.type === 'info') {
        playScannerSound('click');
      }
    } catch {
      // Ignore audio errors on restricted autoplay contexts
    }
  }

  /**
   * Alerts the operator with a persistent toast notification when transitioning
   * to Offline mode, and replaces it with an online synchronization confirmation
   * when transitioning back to Online mode.
   */
  public notifyConnectivityTransition(payload: ConnectivityTransitionPayload): string {
    const {
      isOnline,
      isSimulatedOffline,
      pendingCount,
      isSyncing,
      language,
      onTriggerSync,
      onToggleSimulatedOffline,
      onOpenSyncActivity,
      silentUpdate = false,
    } = payload;

    const isThai = language === 'th';

    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(
          CONNECTIVITY_STATE_STORAGE_KEY,
          JSON.stringify({
            isOnline,
            isSimulatedOffline,
            pendingCount,
            updatedAt: new Date().toISOString(),
          })
        );
      }
    } catch {}

    if (!silentUpdate) {
      auditService.logDiagnosticEvent({
        category: 'network',
        level: isOnline ? 'INFO' : 'WARN',
        event: isOnline ? 'NETWORK_TRANSITION_ONLINE' : 'NETWORK_TRANSITION_OFFLINE',
        message: isOnline
          ? `Application transitioned to ONLINE mode (pending outbox items: ${pendingCount})`
          : `Application transitioned to OFFLINE mode (${isSimulatedOffline ? 'simulated' : 'network drop'}, pending outbox items: ${pendingCount})`,
        metadata: {
          isOnline,
          isSimulatedOffline,
          pendingCount,
        },
      });
    }

    if (!isOnline) {
      const queueNote =
        pendingCount > 0
          ? isThai
            ? ` • มีรายการรอซิงก์ ${pendingCount} รายการใน Local Outbox`
            : ` • ${pendingCount} transaction(s) queued in Local Outbox`
          : '';

      return this.showToast(
        {
          id: CONNECTIVITY_TOAST_ID,
          type: 'warning',
          persistent: true,
          durationMs: 0,
          badge: isSimulatedOffline
            ? isThai
              ? 'OFFLINE SIMULATION • PINNED'
              : 'OFFLINE SIMULATION • PERSISTENT'
            : isThai
            ? 'OFFLINE MODE • PINNED'
            : 'OFFLINE MODE • PERSISTENT',
          title: isThai
            ? 'ระบบทำงานในโหมดออฟไลน์ (Offline Mode Active)'
            : 'Offline Mode Active — Local Outbox Enabled',
          message: isThai
            ? `สัญญาณเครือข่ายถูกตัดหรือจำลองออฟไลน์ ยอดขายและธุรกรรมจะถูกบันทึกใน IndexedDB อัตโนมัติ${queueNote}`
            : `Network connection interrupted. Sales are safely queued in local IndexedDB until connection returns${queueNote}.`,
          actionLabel: isSimulatedOffline
            ? isThai
              ? 'สลับกลับออนไลน์'
              : 'Reconnect Online'
            : onOpenSyncActivity
            ? isThai
              ? 'ดูคิวซิงก์ (Outbox)'
              : 'View Outbox'
            : undefined,
          onAction: isSimulatedOffline ? onToggleSimulatedOffline : onOpenSyncActivity,
          secondaryActionLabel:
            isSimulatedOffline && onOpenSyncActivity
              ? isThai
                ? 'ดูคิวซิงก์'
                : 'View Outbox'
              : undefined,
          onSecondaryAction:
            isSimulatedOffline && onOpenSyncActivity ? onOpenSyncActivity : undefined,
        },
        { suppressSound: silentUpdate }
      );
    }

    // Transitioned back to Online mode
    const hasPending = pendingCount > 0 || isSyncing;
    return this.showToast(
      {
        id: CONNECTIVITY_TOAST_ID,
        type: 'success',
        persistent: false,
        durationMs: 6500,
        badge: isThai ? 'ONLINE • เชื่อมต่อสำเร็จ' : 'ONLINE • RECONNECTED',
        title: isThai
          ? 'กลับมาออนไลน์แล้ว (Back Online)'
          : 'Back Online — Cloud Connection Restored',
        message: hasPending
          ? isThai
            ? `เชื่อมต่อเซิร์ฟเวอร์สำเร็จ กำลังซิงก์ข้อมูลคงค้าง ${pendingCount} รายการจาก Local Outbox อัตโนมัติ...`
            : `Reconnected to cloud server. Automatically synchronizing ${pendingCount} pending outbox transaction(s)...`
          : isThai
          ? 'ระบบเชื่อมต่อฐานข้อมูลคลาวด์ตามปกติ ข้อมูลทั้งหมดเป็นปัจจุบัน'
          : 'Cloud database connection is active and all local transactions are synchronized.',
        actionLabel:
          hasPending && onTriggerSync
            ? isThai
              ? 'ซิงก์ทันที'
              : 'Sync Now'
            : onOpenSyncActivity
            ? isThai
              ? 'ดูประวัติซิงก์'
              : 'Sync Log'
            : undefined,
        onAction: hasPending && onTriggerSync ? onTriggerSync : onOpenSyncActivity,
      },
      { suppressSound: silentUpdate }
    );
  }
}

export const toastNotificationService = new ToastNotificationService();
