import type { IShiftApi } from './types';
import type { CashMovement, Shift, TimeclockRecord } from '../domain/shift';

type ApiRequestResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false };

export interface ProductionShiftApiOptions {
  readonly apiBaseUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_API_BASE_URL =
  typeof import.meta !== 'undefined' && import.meta.env
    ? import.meta.env.VITE_AUTH_API_BASE_URL
    : undefined;

const normalizeBaseUrl = (apiBaseUrl?: string) => {
  if (!apiBaseUrl) return '';
  return apiBaseUrl.replace(/\/$/, '');
};

export function createProductionShiftApi(
  token: string,
  options?: ProductionShiftApiOptions,
): IShiftApi {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const host = normalizeBaseUrl(options?.apiBaseUrl ?? DEFAULT_API_BASE_URL);

  const request = async <T>(path: string, init?: RequestInit): Promise<ApiRequestResult<T>> => {
    if (!host) return { ok: false };
    try {
      const res = await fetchImpl(host + path, {
        ...init,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + (token || '').trim(),
          ...(init?.headers ?? {}),
        },
      });
      if (!res.ok) return { ok: false };
      const data = (await res.json()) as T;
      return { ok: true, data };
    } catch {
      return { ok: false };
    }
  };

  return {
    getCurrentShift: async (_storeId, registerId) => {
      const res = await request<Shift | null>(
        '/api/v1/shifts/current?registerId=' + encodeURIComponent(registerId),
      );
      if (
        res.ok &&
        (res.data === null || (typeof res.data === 'object' && 'id' in res.data))
      ) {
        return res.data;
      }
      throw new Error('Failed to retrieve current shift from production API.');
    },
    openShift: async (_storeId, registerId, openingFloat, cashier, idempotencyKey = crypto.randomUUID()) => {
      const res = await request<Shift>('/api/v1/shifts/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registerId,
          openingFloat,
          cashierId: cashier.id,
          cashierName: cashier.name,
          idempotencyKey,
        }),
      });
      if (res.ok && res.data) return res.data;
      throw new Error('Failed to open shift on production API.');
    },
    closeShift: async (shiftId, actualCountedCash, notes, idempotencyKey = crypto.randomUUID()) => {
      const res = await request<Shift>(
        '/api/v1/shifts/' + encodeURIComponent(shiftId) + '/close',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actualCountedCash, notes, idempotencyKey }),
        },
      );
      if (res.ok && res.data) return res.data;
      throw new Error('Failed to close shift on production API.');
    },
    recordCashMovement: async (shiftId, type, amount, reason, _userId, idempotencyKey = crypto.randomUUID()) => {
      const res = await request<CashMovement>(
        '/api/v1/shifts/' + encodeURIComponent(shiftId) + '/cash-movements',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, amount, reason, idempotencyKey }),
        },
      );
      if (res.ok && res.data) return res.data;
      throw new Error('Failed to record cash movement on production API.');
    },
    clockIn: async (pin, _storeId, idempotencyKey = crypto.randomUUID()) => {
      const res = await request<TimeclockRecord>('/api/v1/timeclock/clock-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, idempotencyKey }),
      });
      if (res.ok && res.data) return res.data;
      throw new Error('Clock-in failed on production API.');
    },
    clockOut: async (pin, _storeId, idempotencyKey = crypto.randomUUID()) => {
      const res = await request<TimeclockRecord>('/api/v1/timeclock/clock-out', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, idempotencyKey }),
      });
      if (res.ok && res.data) return res.data;
      throw new Error('Clock-out failed on production API.');
    },
    getTimeclockRecords: async (_storeId) => {
      const res = await request<TimeclockRecord[]>('/api/v1/timeclock/records');
      if (res.ok && Array.isArray(res.data)) return res.data;
      throw new Error('Failed to retrieve timeclock records from production API.');
    },
  };
}