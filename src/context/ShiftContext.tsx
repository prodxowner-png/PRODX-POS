/**
 * PRODX POS - Shift & Cash Drawer Context
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Shift, CashMovement, CashMovementType } from '../domain/shift';
import { Money, createMoney } from '../domain/money';
import { createShiftApi } from '../adapters/productionShiftApiFactory';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { OfflineContext } from './OfflineContext';

interface ShiftContextType {
  currentShift: Shift | null;
  isLoading: boolean;
  openShift: (openingFloat: Money) => Promise<Shift | undefined>;
  closeShift: (actualCountedCash: Money, notes?: string) => Promise<Shift>;
  recordCashMovement: (type: CashMovementType, amount: Money, reason: string) => Promise<void>;
  refreshShift: () => Promise<void>;
}

const ShiftContext = createContext<ShiftContextType | undefined>(undefined);

export const ShiftProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session } = useAuth();
  const shiftApi = session ? createShiftApi(session.token) : null;
  const { addToast } = useToast();
  const offlineContext = useContext(OfflineContext);
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const pendingIdempotency = useRef(new Map<string, { fingerprint: string; key: string }>());
  const getIdempotencyKey = (operation: string, fingerprint: string) => {
    const existing = pendingIdempotency.current.get(operation);
    if (existing?.fingerprint === fingerprint) return existing.key;
    const key = crypto.randomUUID();
    pendingIdempotency.current.set(operation, { fingerprint, key });
    return key;
  };
  const clearIdempotencyKey = (operation: string) => pendingIdempotency.current.delete(operation);

  const refreshShift = useCallback(async () => {
    if (!session) {
      setCurrentShift(null);
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      const shift = await shiftApi!.getCurrentShift(session.currentStore.id, session.registerId);
      setCurrentShift(shift);
    } catch (err) {
      console.error('[ShiftContext] Error loading shift:', err);
    } finally {
      setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    refreshShift();
  }, [refreshShift]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleShiftUpdated = () => {
      void refreshShift();
    };
    window.addEventListener('prodx:shift-updated', handleShiftUpdated);
    return () => {
      window.removeEventListener('prodx:shift-updated', handleShiftUpdated);
    };
  }, [refreshShift]);

  const openShift = async (openingFloat: Money): Promise<Shift | undefined> => {
    if (!session) return undefined;
    try {
      const key = getIdempotencyKey('open-shift', JSON.stringify([session.currentStore.id, session.registerId, openingFloat.amountInCents, openingFloat.currency, session.currentUser.id]));
      const shift = await shiftApi!.openShift(
        session.currentStore.id,
        session.registerId,
        openingFloat,
        session.currentUser,
        key
      );
      clearIdempotencyKey('open-shift');
      setCurrentShift(shift);
      addToast({
        title: 'Shift Opened',
        message: `Register ${session.registerId} active with opening float of $${(openingFloat.amountInCents / 100).toFixed(2)}`,
        type: 'success',
      });
      return shift;
    } catch (err: any) {
      addToast({
        title: 'Failed to Open Shift',
        message: err?.message || 'Error occurred while opening shift.',
        type: 'error',
      });
      throw err;
    }
  };

  const closeShift = async (actualCountedCash: Money, notes?: string): Promise<Shift> => {
    if (!currentShift) throw new Error('No active shift to close');
    try {
      const key = getIdempotencyKey('close-shift', JSON.stringify([currentShift.id, actualCountedCash.amountInCents, actualCountedCash.currency, notes ?? '']));
      const closed = await shiftApi!.closeShift(currentShift.id, actualCountedCash, notes, key);
      clearIdempotencyKey('close-shift');
      setCurrentShift(null);
      addToast({
        title: 'Shift Closed & Reconciled',
        message: `Actual cash: $${(actualCountedCash.amountInCents / 100).toFixed(2)}`,
        type: 'info',
      });
      return closed;
    } catch (err: any) {
      addToast({
        title: 'Failed to Close Shift',
        message: err?.message || 'Error occurred while closing shift.',
        type: 'error',
      });
      throw err;
    }
  };

  const recordCashMovement = async (type: CashMovementType, amount: Money, reason: string) => {
    if (!currentShift || !session) return;
    try {
      const key = getIdempotencyKey('cash-movement', JSON.stringify([currentShift.id, type, amount.amountInCents, amount.currency, reason]));
      if (offlineContext && !offlineContext.isOnline) {
        if (type === 'cash_sale' || type === 'cash_refund' || type === 'opening_float') {
          throw new Error('This cash movement type is server-generated and cannot be manually posted.');
        }
        await offlineContext.queueOutboxItem('shift_movement', key, {
          idempotencyKey: key,
          storeId: session.currentStore.id,
          shiftId: currentShift.id,
          type,
          amount: { amountInCents: amount.amountInCents, currency: amount.currency },
          reason: reason.trim(),
          performedByUserId: session.currentUser.id,
        });
        clearIdempotencyKey('cash-movement');
        addToast({
          title: 'Cash Drawer Movement Queued Offline',
          message: `${type.replace('_', ' ').toUpperCase()}: $${(amount.amountInCents / 100).toFixed(2)} saved to local outbox. Will sync when online.`,
          type: 'warning',
        });
        return;
      }
      await shiftApi!.recordCashMovement(
        currentShift.id,
        type,
        amount,
        reason,
        session.currentUser.id,
        key
      );
      clearIdempotencyKey('cash-movement');
      await refreshShift();
      addToast({
        title: 'Cash Drawer Movement Recorded',
        message: `${type.replace('_', ' ').toUpperCase()}: $${(amount.amountInCents / 100).toFixed(2)}`,
        type: 'info',
      });
    } catch (err: any) {
      addToast({
        title: 'Drawer Movement Error',
        message: err?.message || 'Failed to record cash movement.',
        type: 'error',
      });
    }
  };

  return (
    <ShiftContext.Provider
      value={{
        currentShift,
        isLoading,
        openShift,
        closeShift,
        recordCashMovement,
        refreshShift,
      }}
    >
      {children}
    </ShiftContext.Provider>
  );
};

export function useShift(): ShiftContextType {
  const ctx = useContext(ShiftContext);
  if (!ctx) {
    throw new Error('useShift must be used within a ShiftProvider');
  }
  return ctx;
}
