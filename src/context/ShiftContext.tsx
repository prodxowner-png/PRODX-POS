/**
 * PRODX POS - Shift & Cash Drawer Context
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Shift, CashMovement, CashMovementType } from '../domain/shift';
import { Money, createMoney } from '../domain/money';
import { createShiftApi } from '../adapters/productionShiftApiFactory';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { getShiftScopeKey, isShiftStateKnownForScope } from '../services/shiftStatePolicy';

interface ShiftContextType {
  currentShift: Shift | null;
  isLoading: boolean;
  isShiftStateKnown: boolean;
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
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadedShiftScopeKey, setLoadedShiftScopeKey] = useState<string | null>(null);
  const refreshSequence = useRef(0);
  const shiftScopeKey = getShiftScopeKey(session ? {
    storeId: session.currentStore.id,
    registerId: session.registerId,
    userId: session.currentUser.id,
  } : null);
  const isShiftStateKnown = isShiftStateKnownForScope(shiftScopeKey, loadedShiftScopeKey);
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
    const requestSequence = ++refreshSequence.current;
    if (!session) {
      setCurrentShift(null);
      setLoadedShiftScopeKey(null);
      setIsLoading(false);
      return;
    }
    try {
      setIsLoading(true);
      const shift = await shiftApi!.getCurrentShift(session.currentStore.id, session.registerId);
      // Ignore stale responses when the authenticated scope changed during the request.
      if (requestSequence !== refreshSequence.current) return;
      setCurrentShift(shift);
      setLoadedShiftScopeKey(shiftScopeKey);
    } catch (err) {
      // A failed authoritative read must never be interpreted as a closed shift.
      if (requestSequence !== refreshSequence.current) return;
      setLoadedShiftScopeKey(null);
      console.error('[ShiftContext] Error loading shift:', err);
    } finally {
      if (requestSequence === refreshSequence.current) setIsLoading(false);
    }
  }, [session]);

  useEffect(() => {
    refreshShift();
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
      setLoadedShiftScopeKey(shiftScopeKey);
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
      setLoadedShiftScopeKey(shiftScopeKey);
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
        isShiftStateKnown,
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
