/**
 * PRODX POS - Shift & Cash Drawer Context
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Shift, CashMovement, CashMovementType } from '../domain/shift';
import { Money, createMoney } from '../domain/money';
import { createShiftApi } from '../adapters/productionShiftApiFactory';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

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
  const [currentShift, setCurrentShift] = useState<Shift | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

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

  const openShift = async (openingFloat: Money): Promise<Shift | undefined> => {
    if (!session) return undefined;
    try {
      const shift = await shiftApi!.openShift(
        session.currentStore.id,
        session.registerId,
        openingFloat,
        session.currentUser
      );
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
      const closed = await shiftApi!.closeShift(currentShift.id, actualCountedCash, notes);
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
      await shiftApi!.recordCashMovement(
        currentShift.id,
        type,
        amount,
        reason,
        session.currentUser.id
      );
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
