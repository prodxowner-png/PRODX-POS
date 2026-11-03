/**
 * PRODX POS - Admin Inactivity Timeout Hook
 *
 * Automatically tracks user activity in the Admin Console and triggers an
 * auto-logout after 15 minutes of inactivity to protect sensitive enterprise data.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export interface AdminInactivityTimeoutOptions {
  timeoutMinutes?: number;
  warningMinutes?: number;
  enabled?: boolean;
}

export function useAdminInactivityTimeout({
  timeoutMinutes = 15,
  warningMinutes = 14,
  enabled = true,
}: AdminInactivityTimeoutOptions = {}) {
  const { logout, session } = useAuth();
  const { addToast } = useToast();

  const timeoutMs = timeoutMinutes * 60 * 1000;
  const warningMs = warningMinutes * 60 * 1000;

  const warningTriggeredRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleLogout = useCallback(async () => {
    try {
      await logout();
      addToast({
        title: 'Session Expired / เซสชันหมดอายุ',
        message: 'Admin session automatically terminated due to 15 minutes of inactivity.',
        type: 'warning',
      });
    } catch (err) {
      console.error('[AdminInactivity] Auto-logout failed:', err);
    }
  }, [logout, addToast]);

  const resetTimers = useCallback(() => {
    if (!enabled || !session) return;

    warningTriggeredRef.current = false;

    if (timerRef.current) clearTimeout(timerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);

    // Warning timer (e.g. at 14 minutes)
    warningTimerRef.current = setTimeout(() => {
      if (!warningTriggeredRef.current) {
        warningTriggeredRef.current = true;
        addToast({
          title: 'Inactivity Warning / แจ้งเตือนการไม่มีกิจกรรม',
          message: 'Your admin session will expire in 1 minute due to inactivity.',
          type: 'warning',
        });
      }
    }, warningMs);

    // Final logout timer (at 15 minutes)
    timerRef.current = setTimeout(() => {
      void handleLogout();
    }, timeoutMs);
  }, [enabled, session, warningMs, timeoutMs, handleLogout, addToast]);

  useEffect(() => {
    if (!enabled || !session) return;

    const events = ['mousemove', 'mousedown', 'keypress', 'touchstart', 'scroll', 'click'];
    
    const handleActivity = () => {
      resetTimers();
    };

    resetTimers();

    events.forEach((ev) => {
      window.addEventListener(ev, handleActivity, { passive: true });
    });

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
      events.forEach((ev) => {
        window.removeEventListener(ev, handleActivity);
      });
    };
  }, [enabled, session, resetTimers]);
}
