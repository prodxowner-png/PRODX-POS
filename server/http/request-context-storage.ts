import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext } from './types.ts';

// Each authenticated HTTP request gets its own async-local context. Database
// code reads this only on the server; no client-supplied tenant header is used.
const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(
  context: RequestContext,
  callback: () => T,
): T => requestContextStorage.run(context, callback);

export const getCurrentRequestContext = (): RequestContext | undefined =>
  requestContextStorage.getStore();
