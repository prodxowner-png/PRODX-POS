import { resolveProductionApiBaseUrl } from './apiBaseUrl';
import type { IShiftApi } from './types';
import type { CashMovement, Shift, TimeclockRecord } from '../domain/shift';


const API_BASE_URL = import.meta.env.VITE_AUTH_API_BASE_URL;
const base = () => resolveProductionApiBaseUrl(API_BASE_URL);

export function createProductionShiftApi(token: string): IShiftApi {
  const request = async <T>(path: string, init?: RequestInit): Promise<T | null> => {
    const host = base();
    try {
      const res = await fetch(host + path, {
        ...init,
        credentials: 'include',
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + (token || '').trim(), ...(init?.headers ?? {}) },
      });
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      return body as T;
    } catch {
      return null;
    }
  };

  return {
    getCurrentShift: async (storeId, registerId) => {
      const res = await request<Shift>('/api/v1/shifts/current?registerId=' + encodeURIComponent(registerId));
      if (res) return res;
      throw new Error('Failed to retrieve current shift from production API.');
    },
    openShift: async (storeId, registerId, openingFloat, cashier, idempotencyKey = crypto.randomUUID()) => {
      const res = await request<Shift>('/api/v1/shifts/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registerId, openingFloat, cashierId: cashier.id, cashierName: cashier.name, idempotencyKey }) });
      if (res) return res;
      throw new Error('Failed to open shift on production API.');
    },
    closeShift: async (shiftId, actualCountedCash, notes, idempotencyKey = crypto.randomUUID()) => {
      const res = await request<Shift>('/api/v1/shifts/' + encodeURIComponent(shiftId) + '/close', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actualCountedCash, notes, idempotencyKey }) });
      if (res) return res;
      throw new Error('Failed to close shift on production API.');
    },
    recordCashMovement: async (shiftId, type, amount, reason, userId, idempotencyKey = crypto.randomUUID()) => {
      const res = await request<CashMovement>('/api/v1/shifts/' + encodeURIComponent(shiftId) + '/cash-movements', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type, amount, reason, idempotencyKey }) });
      if (res) return res;
      throw new Error('Failed to record cash movement on production API.');
    },
    clockIn: async (pin, storeId, idempotencyKey = crypto.randomUUID()) => {
      const res = await request<TimeclockRecord>('/api/v1/timeclock/clock-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, idempotencyKey }) });
      if (res) return res;
      throw new Error('Clock-in failed on production API.');
    },
    clockOut: async (pin, storeId, idempotencyKey = crypto.randomUUID()) => {
      const res = await request<TimeclockRecord>('/api/v1/timeclock/clock-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin, idempotencyKey }) });
      if (res) return res;
      throw new Error('Clock-out failed on production API.');
    },
    getTimeclockRecords: async (storeId) => {
      const res = await request<TimeclockRecord[]>('/api/v1/timeclock/records');
      if (res && Array.isArray(res)) return res;
      throw new Error('Failed to retrieve timeclock records from production API.');
    },
  };
}