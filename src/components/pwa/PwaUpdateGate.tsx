import React, { useCallback, useSyncExternalStore, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '../common/Button';
import { useLanguage } from '../../context/LanguageContext';
import { useOffline } from '../../context/OfflineContext';
import { useShift } from '../../context/ShiftContext';
import { canApplyPwaUpdate, getPwaUpdateBlockers } from '../../services/pwaUpdatePolicy';
import { applyPwaUpdate, getPwaUpdateSnapshot, subscribePwaUpdate } from '../../services/pwaUpdateService';

const blockerMessages = {
  offline: { th: 'รอการเชื่อมต่ออินเทอร์เน็ต', en: 'Waiting for an online connection' },
  'outbox-loading': { th: 'กำลังตรวจสอบ Durable Outbox', en: 'Checking the durable outbox' },
  syncing: { th: 'กำลังซิงก์ข้อมูล รอให้เสร็จก่อน', en: 'Data synchronization is in progress' },
  'outbox-unresolved': { th: 'มีรายการซิงก์ค้างหรือข้อขัดแย้ง ต้องจัดการให้เสร็จก่อน', en: 'Pending or conflicted outbox items must be resolved first' },
  'shift-loading': { th: 'กำลังตรวจสอบสถานะกะ', en: 'Checking the current shift' },
  'shift-unknown': { th: 'ยังยืนยันสถานะกะจากเซิร์ฟเวอร์ไม่ได้', en: 'The shift state is not authoritatively confirmed' },
  'active-shift': { th: 'มีกะขายเปิดอยู่ ต้องปิดกะก่อนอัปเดต', en: 'An active shift must be closed before updating' },
} as const;

export const PwaUpdateGate: React.FC = () => {
  const update = useSyncExternalStore(subscribePwaUpdate, getPwaUpdateSnapshot, getPwaUpdateSnapshot);
  const { language } = useLanguage();
  const { isOnline, isOutboxReady, hasUnresolvedOutbox, isSyncing } = useOffline();
  const { currentShift, isLoading: isShiftLoading, isShiftStateKnown } = useShift();
  const [applyError, setApplyError] = useState<string | null>(null);
  const isThai = language === 'th';

  const safetyState = {
    isOnline,
    isOutboxReady,
    isSyncing,
    hasUnresolvedOutbox,
    isShiftLoading,
    isShiftStateKnown,
    hasActiveShift: currentShift !== null,
  };
  const blockers = getPwaUpdateBlockers(safetyState);
  const isSafeToUpdate = canApplyPwaUpdate(safetyState);
  const blockerMessage = blockers.length > 0
    ? blockerMessages[blockers[0]][isThai ? 'th' : 'en']
    : null;

  const handleApplyUpdate = useCallback(async () => {
    // Recheck the current render's operational state immediately before SKIP_WAITING.
    if (!update.updateAvailable || !canApplyPwaUpdate(safetyState)) return;
    setApplyError(null);
    const appRoot = document.getElementById('root');
    // Lock the POS UI synchronously so a new shift/transaction cannot start during activation.
    appRoot?.setAttribute('inert', '');
    try {
      await applyPwaUpdate();
    } catch (error) {
      appRoot?.removeAttribute('inert');
      setApplyError(error instanceof Error ? error.message : 'Unable to apply the update.');
    }
  }, [safetyState, update.updateAvailable]);

  if (!update.updateAvailable) return null;

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
              ? (isThai ? 'ตรวจสอบแล้ว: ปิดกะแล้ว, Outbox พร้อมและไม่มีรายการค้าง สามารถอัปเดตได้อย่างปลอดภัย' : 'Verified safe: no active shift, durable outbox is ready, and no unresolved items remain')
              : (blockerMessage ?? (isThai ? 'รอให้ระบบอยู่ในสถานะปลอดภัยก่อนอัปเดต' : 'Waiting for a safe update window'))}
          </p>
          {applyError && <p role="alert" className="mt-1 text-xs font-medium text-danger">{applyError}</p>}
        </div>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={!isSafeToUpdate || update.isApplying}
          isLoading={update.isApplying}
          onClick={handleApplyUpdate}
          className="ml-auto shrink-0 sm:ml-0"
          aria-label={
            update.isApplying
              ? (isThai ? 'กำลังอัปเดต PRODX POS' : 'Updating PRODX POS')
              : (isThai ? 'อัปเดต PRODX POS เมื่อปลอดภัย' : 'Update PRODX POS when safe')
          }
        >
          {update.isApplying
            ? (isThai ? 'กำลังอัปเดต' : 'Updating')
            : (isThai ? 'อัปเดต' : 'Update')}
        </Button>
      </div>
      </section>
    </>,
    document.body,
  );
};
