import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '../common/Button';
import { useCart } from '../../context/CartContext';
import { useLanguage } from '../../context/LanguageContext';
import { useOffline } from '../../context/OfflineContext';
import { useShift } from '../../context/ShiftContext';
import { canApplyPwaUpdate, getPwaUpdateBlockers } from '../../services/pwaUpdatePolicy';
import { applyPwaUpdate, getPwaUpdateSnapshot, subscribePwaUpdate } from '../../services/pwaUpdateService';
import { getActiveInventoryMutationCount, subscribeInventoryMutations } from '../../services/inventoryMutationTracker';
import { getActiveCheckoutMutationCount, subscribeCheckoutMutations } from '../../services/checkoutMutationTracker';

const blockerMessages = {
  offline: { th: 'รอการเชื่อมต่ออินเทอร์เน็ต', en: 'Waiting for an online connection' },
  'outbox-loading': { th: 'กำลังตรวจสอบ Durable Outbox', en: 'Checking the durable outbox' },
  syncing: { th: 'กำลังซิงก์ข้อมูล รอให้เสร็จก่อน', en: 'Data synchronization is in progress' },
  'outbox-unresolved': { th: 'มีรายการซิงก์ค้างหรือข้อขัดแย้ง ต้องจัดการให้เสร็จก่อน', en: 'Pending or conflicted outbox items must be resolved first' },
  'shift-loading': { th: 'กำลังตรวจสอบสถานะกะ', en: 'Checking the current shift' },
  'shift-unknown': { th: 'ยังยืนยันสถานะกะจากเซิร์ฟเวอร์ไม่ได้', en: 'The shift state is not authoritatively confirmed' },
  'active-shift': { th: 'มีกะขายเปิดอยู่ ต้องปิดกะก่อนอัปเดต', en: 'An active shift must be closed before updating' },
  'inventory-mutation': { th: 'กำลังบันทึกการปรับสต็อก รอให้รายการเสร็จก่อน', en: 'An inventory write is in progress; wait for it to finish' },
  'checkout-in-flight': { th: 'กำลังส่งรายการชำระเงินไปยังเซิร์ฟเวอร์ รอให้เสร็จก่อน', en: 'A live checkout request is in flight; wait for confirmation' },
  'draft-cart': { th: 'มีรายการในตะกร้าหรือบิลที่พักไว้ ต้องชำระเงินหรือล้างก่อนอัปเดต', en: 'Active or held cart drafts must be completed or cleared before updating' },
} as const;

interface PreApplyVerificationResult {
  readonly safe: boolean;
  readonly reason?: string;
}

interface PwaUpdateBannerProps {
  readonly isSafeToUpdate: boolean;
  readonly safeMessage: string;
  readonly blockerMessage: string | null;
  readonly verifyBeforeApply?: () => Promise<PreApplyVerificationResult>;
}

const PwaUpdateBanner: React.FC<PwaUpdateBannerProps> = ({
  isSafeToUpdate,
  safeMessage,
  blockerMessage,
  verifyBeforeApply,
}) => {
  const update = useSyncExternalStore(subscribePwaUpdate, getPwaUpdateSnapshot, getPwaUpdateSnapshot);
  const { language } = useLanguage();
  const [applyError, setApplyError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const isThai = language === 'th';

  const handleApplyUpdate = useCallback(async () => {
    // Recheck the current render's operational state immediately before SKIP_WAITING.
    if (
      !update.updateAvailable ||
      !isSafeToUpdate ||
      isVerifying ||
      getActiveInventoryMutationCount() > 0 ||
      getActiveCheckoutMutationCount() > 0
    ) {
      return;
    }
    setApplyError(null);
    setIsVerifying(true);
    const appRoot = document.getElementById('root');
    // Lock the UI synchronously so no new action starts during verification or activation.
    appRoot?.setAttribute('inert', '');
    try {
      if (verifyBeforeApply) {
        const verification = await verifyBeforeApply();
        if (!verification.safe) {
          appRoot?.removeAttribute('inert');
          setApplyError(
            verification.reason ??
              (isThai
                ? 'สถานะระบบเปลี่ยนแปลงระหว่างตรวจสอบ กรุณารอช่วงที่ปลอดภัยก่อนอัปเดต'
                : 'Operational state changed during verification. Wait for a safe window before updating.'),
          );
          return;
        }
      }
      if (getActiveInventoryMutationCount() > 0 || getActiveCheckoutMutationCount() > 0) {
        appRoot?.removeAttribute('inert');
        setApplyError(
          getActiveCheckoutMutationCount() > 0
            ? blockerMessages['checkout-in-flight'][isThai ? 'th' : 'en']
            : blockerMessages['inventory-mutation'][isThai ? 'th' : 'en'],
        );
        return;
      }
      await applyPwaUpdate();
    } catch (error) {
      appRoot?.removeAttribute('inert');
      setApplyError(error instanceof Error ? error.message : 'Unable to apply the update.');
    } finally {
      setIsVerifying(false);
    }
  }, [isSafeToUpdate, isThai, isVerifying, update.updateAvailable, verifyBeforeApply]);

  if (!update.updateAvailable) return null;
  const isBusy = update.isApplying || isVerifying;

  return createPortal(
    <>
      {update.isApplying && (
        <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div role="status" aria-live="assertive" className="flex max-w-sm items-center gap-3 rounded-2xl border border-primary/30 bg-card p-5 text-text shadow-2xl">
            <RefreshCw className="h-6 w-6 shrink-0 animate-spin text-primary" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold">{isThai ? 'กำลังอัปเดต PRODX POS' : 'Updating PRODX POS'}</p>
              <p className="mt-1 text-xs text-text/70">{isThai ? 'ระบบกำลังเปลี่ยนเวอร์ชัน โปรดรอสักครู่และอย่าปิดหน้านี้' : 'Switching application versions. Please wait and keep this page open.'}</p>
            </div>
          </div>
        </div>
      )}
      <section
        role="region"
        aria-label={isThai ? 'การอัปเดตแอป PRODX POS' : 'PRODX POS application update'}
        aria-live="polite"
        className="fixed top-3 left-1/2 z-[10000] w-[min(94vw,42rem)] -translate-x-1/2 rounded-2xl border border-primary/30 bg-card/95 p-3 shadow-2xl backdrop-blur-xl sm:p-4"
      >
        <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {isSafeToUpdate ? <ShieldCheck className="h-5 w-5" aria-hidden="true" /> : <RefreshCw className="h-5 w-5" aria-hidden="true" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-text">
              {isThai ? 'มี PRODX POS เวอร์ชันใหม่พร้อมอัปเดต' : 'A new PRODX POS version is ready'}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-text/70">
              {isSafeToUpdate
                ? safeMessage
                : (blockerMessage ?? (isThai ? 'รอให้ระบบอยู่ในสถานะปลอดภัยก่อนอัปเดต' : 'Waiting for a safe update window'))}
            </p>
            {applyError && <p role="alert" className="mt-1 text-xs font-medium text-danger">{applyError}</p>}
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!isSafeToUpdate || isBusy}
            isLoading={isBusy}
            onClick={handleApplyUpdate}
            className="ml-auto shrink-0 sm:ml-0"
            aria-label={
              isBusy
                ? (isThai ? 'กำลังอัปเดต PRODX POS' : 'Updating PRODX POS')
                : (isThai ? 'อัปเดต PRODX POS เมื่อปลอดภัย' : 'Update PRODX POS when safe')
            }
          >
            {isBusy
              ? (isThai ? 'กำลังอัปเดต' : 'Updating')
              : (isThai ? 'อัปเดต' : 'Update')}
          </Button>
        </div>
      </section>
    </>,
    document.body,
  );
};

export const PwaUpdateGate: React.FC = () => {
  const { language } = useLanguage();
  const { isOnline, isOutboxReady, hasUnresolvedOutbox, isSyncing } = useOffline();
  const { currentShift, isLoading: isShiftLoading, isShiftStateKnown, refreshShift } = useShift();
  const { items, heldCarts, stagedPayments } = useCart();
  const activeInventoryMutations = useSyncExternalStore(
    subscribeInventoryMutations,
    getActiveInventoryMutationCount,
    getActiveInventoryMutationCount,
  );
  const activeCheckoutMutations = useSyncExternalStore(
    subscribeCheckoutMutations,
    getActiveCheckoutMutationCount,
    getActiveCheckoutMutationCount,
  );
  const isThai = language === 'th';
  const hasDraftCart = items.length > 0 || heldCarts.length > 0 || stagedPayments.length > 0;

  const safetyState = {
    isOnline,
    isOutboxReady,
    isSyncing,
    hasUnresolvedOutbox,
    isShiftLoading,
    isShiftStateKnown,
    hasActiveShift: currentShift !== null,
    hasInventoryMutationInFlight: activeInventoryMutations > 0,
    hasCheckoutInFlight: activeCheckoutMutations > 0,
    hasDraftCart,
  };
  const blockers = getPwaUpdateBlockers(safetyState);
  const isSafeToUpdate = canApplyPwaUpdate(safetyState);
  const blockerMessage = blockers.length > 0
    ? blockerMessages[blockers[0]][isThai ? 'th' : 'en']
    : null;

  const verifyBeforeApply = useCallback(async (): Promise<PreApplyVerificationResult> => {
    const lang = isThai ? 'th' : 'en';
    if (hasDraftCart) {
      return { safe: false, reason: blockerMessages['draft-cart'][lang] };
    }
    if (getActiveCheckoutMutationCount() > 0) {
      return { safe: false, reason: blockerMessages['checkout-in-flight'][lang] };
    }
    if (getActiveInventoryMutationCount() > 0) {
      return { safe: false, reason: blockerMessages['inventory-mutation'][lang] };
    }
    // Revalidate authoritative shift state from the server so another tab/device
    // opening a shift after the initial read cannot be missed.
    const shiftResult = await refreshShift();
    if (!shiftResult.known) {
      return { safe: false, reason: blockerMessages['shift-unknown'][lang] };
    }
    if (shiftResult.shift !== null) {
      return { safe: false, reason: blockerMessages['active-shift'][lang] };
    }
    return { safe: true };
  }, [hasDraftCart, isThai, refreshShift]);

  return (
    <PwaUpdateBanner
      isSafeToUpdate={isSafeToUpdate}
      safeMessage={
        isThai
          ? 'ตรวจสอบแล้ว: ปิดกะแล้ว, ไม่มีบิลค้างในตะกร้า, Outbox พร้อมและไม่มีรายการซิงก์ค้าง สามารถอัปเดตได้อย่างปลอดภัย'
          : 'Verified safe: no active shift, no draft carts, durable outbox is ready, and no unresolved items remain'
      }
      blockerMessage={blockerMessage}
      verifyBeforeApply={verifyBeforeApply}
    />
  );
};

/**
 * Lightweight user-triggered update gate for dedicated display modes
 * (KDS, Receipt Validation Portal, Customer-Facing Display) that do not
 * hold a register shift or checkout durable outbox.
 */
export const StandalonePwaUpdateGate: React.FC = () => {
  const { language } = useLanguage();
  const activeInventoryMutations = useSyncExternalStore(
    subscribeInventoryMutations,
    getActiveInventoryMutationCount,
    getActiveInventoryMutationCount,
  );
  const activeCheckoutMutations = useSyncExternalStore(
    subscribeCheckoutMutations,
    getActiveCheckoutMutationCount,
    getActiveCheckoutMutationCount,
  );
  const [isOnline, setIsOnline] = useState<boolean>(
    () => (typeof navigator !== 'undefined' ? navigator.onLine : true),
  );
  const isThai = language === 'th';

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const blockerMessage = !isOnline
    ? blockerMessages.offline[isThai ? 'th' : 'en']
    : activeInventoryMutations > 0
      ? blockerMessages['inventory-mutation'][isThai ? 'th' : 'en']
      : activeCheckoutMutations > 0
        ? blockerMessages['checkout-in-flight'][isThai ? 'th' : 'en']
        : null;

  return (
    <PwaUpdateBanner
      isSafeToUpdate={isOnline && activeInventoryMutations === 0 && activeCheckoutMutations === 0}
      safeMessage={
        isThai
          ? 'พร้อมอัปเดตหน้าจอแสดงผลเป็นเวอร์ชันล่าสุดอย่างปลอดภัย'
          : 'Ready to safely update this display to the latest version'
      }
      blockerMessage={blockerMessage}
    />
  );
};
