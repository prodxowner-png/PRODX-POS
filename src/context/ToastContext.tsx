/**
 * PRODX POS - Persistent & Transient Toast Notification System
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import {
  toastNotificationService,
  ToastItem,
  ToastType,
  AddToastInput,
} from '../services/toastNotificationService';

export type { ToastType, ToastItem, AddToastInput };

interface ToastContextType {
  toasts: ToastItem[];
  addToast: (toast: AddToastInput) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>(() =>
    toastNotificationService.getToasts()
  );

  useEffect(() => {
    const unsubscribe = toastNotificationService.subscribe((updatedToasts) => {
      setToasts(updatedToasts);
    });
    return unsubscribe;
  }, []);

  const removeToast = useCallback((id: string) => {
    toastNotificationService.dismissToast(id);
  }, []);

  const addToast = useCallback((toast: AddToastInput): string => {
    return toastNotificationService.showToast(toast);
  }, []);

  const clearToasts = useCallback(() => {
    toastNotificationService.clearAll();
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, clearToasts }}>
      {children}
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      toasts: [],
      addToast: (toast: AddToastInput) => toastNotificationService.showToast(toast),
      removeToast: (id: string) => toastNotificationService.dismissToast(id),
      clearToasts: () => toastNotificationService.clearAll(),
    };
  }
  return ctx;
}

