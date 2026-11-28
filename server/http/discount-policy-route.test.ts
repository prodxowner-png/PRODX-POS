import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './createApp';
import { registerDiscountPolicyRoute } from './discount-policy-route';
import type { TransactionalSqlExecutor } from '../db/transaction';

const principal = { userId: 'owner-1', organizationId: 'org-1', storeId: 'store-1', sessionId: 'session-1' };
const start = async (app: ReturnType<typeof createApp>) => {
  const server = await new Promise<import('node:http').Server>((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { baseUrl: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
};

test('discount policy GET returns the tenant/store policy from PostgreSQL', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db: TransactionalSqlExecutor = {
    query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ sql, parameters });
      return { rows: [{ require_supervisor_approval: true, max_discount_without_approval_bps: 1500 }] as unknown as T[] };
    },
    transaction: async () => { throw new Error('GET must not open a write transaction'); },
  };
  const app = createApp({ authenticateRequest: () => principal, authorizeRequest: (_context, permission) => permission === 'pos.discount' || permission === 'settings.manage', configureRoutes: (configuredApp) => registerDiscountPolicyRoute(configuredApp, db) });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/security/discount-policy`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { requireSupervisorApproval: true, maxDiscountWithoutApprovalBps: 1500 });
    assert.deepEqual(calls[0].parameters, [principal.organizationId, principal.storeId]);
  } finally { await server.close(); }
});

test('discount policy PUT persists policy and audit event atomically', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db: TransactionalSqlExecutor = {
    query: async () => { throw new Error('PUT must use a transaction'); },
    transaction: async (work) => work({ query: async <T extends Record<string, unknown>>(sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ sql, parameters });
      if (sql.startsWith('UPDATE prodx_discount_policies')) return { rows: [{ require_supervisor_approval: true, max_discount_without_approval_bps: 1750 }] as unknown as T[] };
      return { rows: [] as T[] };
    } }),
  };
  const app = createApp({ authenticateRequest: () => principal, authorizeRequest: (_context, permission) => permission === 'pos.discount' || permission === 'settings.manage', configureRoutes: (configuredApp) => registerDiscountPolicyRoute(configuredApp, db) });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/security/discount-policy`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requireSupervisorApproval: true, maxDiscountWithoutApprovalBps: 1750 }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { requireSupervisorApproval: true, maxDiscountWithoutApprovalBps: 1750 });
    assert.ok(calls.some(({ sql }) => sql.includes('UPDATE prodx_discount_policies')));
    assert.ok(calls.some(({ sql }) => sql.includes('prodx_record_security_audit_event')));
    assert.equal(calls[0].parameters[0], principal.organizationId);
    assert.equal(calls[0].parameters[1], principal.storeId);
  } finally { await server.close(); }
});

test('discount policy PUT rejects malformed thresholds before database work', async () => {
  let databaseReached = false;
  const db: TransactionalSqlExecutor = { query: async () => { databaseReached = true; return { rows: [] }; }, transaction: async <T>(work: (tx: import('../db/transaction').SqlQueryExecutor) => Promise<T>): Promise<T> => { databaseReached = true; return work({ query: async () => ({ rows: [] }) }); } };
  const app = createApp({ authenticateRequest: () => principal, authorizeRequest: (_context, permission) => permission === 'pos.discount' || permission === 'settings.manage', configureRoutes: (configuredApp) => registerDiscountPolicyRoute(configuredApp, db) });
  const server = await start(app);
  try {
    const invalid = await fetch(`${server.baseUrl}/api/v1/security/discount-policy`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requireSupervisorApproval: true, maxDiscountWithoutApprovalBps: 15000 }) });
    assert.equal(invalid.status, 400);
    assert.equal(databaseReached, false);
  } finally { await server.close(); }
});

test('discount policy GET and PUT require an authorized POS or settings capability', async () => {
  let databaseReached = false;
  const db: TransactionalSqlExecutor = {
    query: async () => { databaseReached = true; return { rows: [] }; },
    transaction: async <T>(work: (tx: import('../db/transaction').SqlQueryExecutor) => Promise<T>): Promise<T> => { databaseReached = true; return work({ query: async () => ({ rows: [] }) }); },
  };
  const app = createApp({ authenticateRequest: () => principal, authorizeRequest: () => false, configureRoutes: (configuredApp) => registerDiscountPolicyRoute(configuredApp, db) });
  const server = await start(app);
  try {
    const get = await fetch(`${server.baseUrl}/api/v1/security/discount-policy`);
    const put = await fetch(`${server.baseUrl}/api/v1/security/discount-policy`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requireSupervisorApproval: true, maxDiscountWithoutApprovalBps: 1500 }) });
    assert.equal(get.status, 403);
    assert.equal(put.status, 403);
    assert.equal(databaseReached, false);
  } finally { await server.close(); }
});
