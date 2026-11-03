import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueryResultRow } from 'pg';
import { createApp } from './createApp';
import { registerTasksRoute } from './tasks-route';
import type { SqlQueryExecutor } from '../db/transaction';

const principal = {
  userId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  storeId: '33333333-3333-4333-8333-333333333333',
};
const taskRow = {
  id: '44444444-4444-4444-8444-444444444444',
  user_id: principal.userId,
  title: 'Count stock',
  description: 'Check aisle 2',
  completed: false,
  created_at: '2026-10-28T08:00:00.000Z',
  updated_at: '2026-10-28T08:00:00.000Z',
};
const start = async (app: ReturnType<typeof createApp>) => {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
};
const makeApp = (db: SqlQueryExecutor, authorized = true) => createApp({
  authenticateRequest: () => principal,
  authorizeRequest: (_context, permission) => authorized && permission === 'dashboard.read',
  configureRoutes: (app) => registerTasksRoute(app, db),
});
const rows = <T extends QueryResultRow>(items: unknown[]) => ({ rows: items as T[] });

test('GET /api/v1/tasks returns only the authenticated user/store scope', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db: SqlQueryExecutor = {
    query: async <T extends QueryResultRow>(sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ sql, parameters });
      return rows<T>([taskRow]);
    },
  };
  const server = await start(makeApp(db));
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/tasks`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [{
      id: taskRow.id, ownerId: principal.userId, title: taskRow.title, description: taskRow.description,
      completed: false, createdAt: Date.parse(taskRow.created_at), updatedAt: Date.parse(taskRow.updated_at),
    }]);
    assert.deepEqual(calls[0].parameters, [principal.organizationId, principal.storeId, principal.userId]);
    assert.match(calls[0].sql, /organization_id = \$1 AND store_id = \$2 AND user_id = \$3/);
  } finally { await server.close(); }
});

test('POST /api/v1/tasks validates input and persists server-scoped owner fields idempotently', async () => {
  const calls: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  const db: SqlQueryExecutor = {
    query: async <T extends QueryResultRow>(sql: string, parameters: readonly unknown[] = []) => {
      calls.push({ sql, parameters });
      return rows<T>(sql.startsWith('SELECT') ? [taskRow] : []);
    },
  };
  const server = await start(makeApp(db));
  try {
    const invalid = await fetch(`${server.baseUrl}/api/v1/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: '   ' }),
    });
    assert.equal(invalid.status, 400);
    assert.equal(calls.length, 0);
    const created = await fetch(`${server.baseUrl}/api/v1/tasks`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: taskRow.id, title: taskRow.title, description: taskRow.description, ownerId: 'untrusted-owner' }),
    });
    assert.equal(created.status, 201);
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /ON CONFLICT \(id\) DO NOTHING/);
    assert.deepEqual(calls[0].parameters, [taskRow.id, principal.organizationId, principal.storeId, principal.userId, taskRow.title, taskRow.description]);
    assert.equal((await created.json()).ownerId, principal.userId);
  } finally { await server.close(); }
});

test('PATCH /api/v1/tasks/:taskId fails closed for tasks outside the authenticated user scope', async () => {
  const db: SqlQueryExecutor = { query: async <T extends QueryResultRow>() => rows<T>([]) };
  const server = await start(makeApp(db));
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/tasks/${taskRow.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: true }),
    });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'TASK_NOT_FOUND');
  } finally { await server.close(); }
});

test('task API rejects unauthorized callers before querying PostgreSQL', async () => {
  let queried = false;
  const db: SqlQueryExecutor = {
    query: async <T extends QueryResultRow>() => { queried = true; return rows<T>([]); },
  };
  const server = await start(makeApp(db, false));
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/tasks`);
    assert.equal(response.status, 403);
    assert.equal(queried, false);
  } finally { await server.close(); }
});
