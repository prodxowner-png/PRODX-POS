import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";
import { createApp } from "./createApp";
import { registerVoidRoute } from "./void-route";
import type { TransactionalSqlExecutor } from "../db/transaction";

const principal = { userId: "server-user", organizationId: "org-1", storeId: "store-1", sessionId: "session-1" };
const start = async (app: ReturnType<typeof createApp>) => {
  const server = await new Promise<import("node:http").Server>((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  return { baseUrl: `http://127.0.0.1:${address.port}`, close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
};

test("void route is permissioned and uses server-authorized supervisor plus atomic reversal path", async () => {
  let voidInsertParameters: readonly unknown[] | undefined;
  const query = async <T extends QueryResultRow>(sql: string, parameters: readonly unknown[] = []) => {
    if (sql.includes("FROM prodx_orders") && sql.includes("FOR UPDATE")) return { rows: [{ id: "order-1", organization_id: principal.organizationId, store_id: principal.storeId, order_number: "ORD-1", register_id: "register-1", shift_id: "shift-1", status: "server_confirmed", currency: "THB", grand_total_amount: "10.00" }] as unknown as T[] };
    if (sql.includes("FROM prodx_voids")) return { rows: [] as unknown as T[] };
    if (sql.includes("UPDATE prodx_supervisor_authorizations")) return { rows: [{ supervisorUserId: "supervisor-1" }] as unknown as T[] };
    if (sql.includes("FROM prodx_store_memberships")) return { rows: [{ id: "membership-1" }] as unknown as T[] };
    if (sql.includes("FROM prodx_payments")) return { rows: [{ method: "cash", amount: "10.00", currency: "THB", status: "captured" }] as unknown as T[] };
    if (sql.includes("FROM prodx_shifts")) return { rows: [{ id: "shift-1" }] as unknown as T[] };
    if (sql.startsWith("INSERT INTO prodx_voids")) { voidInsertParameters = parameters; return { rows: [{ id: "void-1" }] as unknown as T[] }; }
    if (sql.includes("FROM prodx_order_items")) return { rows: [{ id: "item-1", product_id: "product-1", quantity: 2 }] as unknown as T[] };
    if (sql.includes("UPDATE prodx_products")) return { rows: [{ current_stock: 12 }] as unknown as T[] };
    if (sql.includes("INSERT INTO prodx_inventory_ledger")) return { rows: [] as unknown as T[] };
    if (sql.includes("INSERT INTO prodx_cash_movements")) return { rows: [] as unknown as T[] };
    if (sql.startsWith("UPDATE prodx_orders")) return { rows: [] as unknown as T[] };
    if (sql.includes("INSERT INTO prodx_audit_log")) return { rows: [] as unknown as T[] };
        if (sql.includes("prodx_record_security_audit_event")) return { rows: [] as unknown as T[] };
throw new Error(`Unexpected SQL in void route test: ${sql}`);
  };
  const db: TransactionalSqlExecutor = { query, transaction: async (work) => work({ query }) };
  const app = createApp({ authenticateRequest: () => principal, authorizeRequest: (_context, permission) => permission === "pos.void", configureRoutes: (configuredApp) => registerVoidRoute(configuredApp, db) });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/orders/void`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId: "order-1", reason: "Supervisor approved correction", idempotencyKey: "void-route-test", supervisorAuthorizationToken: "server-issued-token" }),
    });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).success, true);
    assert.ok(voidInsertParameters);
    assert.equal(voidInsertParameters?.[5], "supervisor-1");
    assert.equal(voidInsertParameters?.[6], principal.userId);
  } finally { await server.close(); }
});

test("void route fails closed without pos.void permission", async () => {
  const db: TransactionalSqlExecutor = { query: async () => { throw new Error("database must not be reached"); }, transaction: async () => { throw new Error("transaction must not be reached"); } };
  const app = createApp({ authenticateRequest: () => principal, authorizeRequest: () => false, configureRoutes: (configuredApp) => registerVoidRoute(configuredApp, db) });
  const server = await start(app);
  try {
    const response = await fetch(`${server.baseUrl}/api/v1/orders/void`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    assert.equal(response.status, 403);
  } finally { await server.close(); }
});


test("card and QR voids fail closed before recording void or inventory/cash reversal effects", async () => {
  let transactionCalls = 0;
  let activeMethod: "card" | "qr_digital" = "card";
  const sideEffectStatements: string[] = [];
  const query = async <T extends QueryResultRow>(sql: string) => {
    if (sql.includes("FROM prodx_orders") && sql.includes("FOR UPDATE")) {
      return { rows: [{ id: "order-1", organization_id: principal.organizationId, store_id: principal.storeId, order_number: "ORD-1", register_id: "register-1", shift_id: "shift-1", status: "server_confirmed", currency: "THB", grand_total_amount: "10.00" }] as unknown as T[] };
    }
    if (sql.includes("FROM prodx_voids")) return { rows: [] as unknown as T[] };
    if (sql.includes("UPDATE prodx_supervisor_authorizations")) return { rows: [{ supervisorUserId: "supervisor-1" }] as unknown as T[] };
    if (sql.includes("FROM prodx_store_memberships")) return { rows: [{ id: "membership-1" }] as unknown as T[] };
    if (sql.includes("FROM prodx_payments")) {
      return { rows: [{ method: activeMethod, amount: "10.00", currency: "THB", status: "captured" }] as unknown as T[] };
    }
    if (sql.startsWith("INSERT INTO prodx_voids") || sql.includes("INSERT INTO prodx_inventory_ledger") || sql.includes("INSERT INTO prodx_cash_movements") || sql.startsWith("UPDATE prodx_products") || sql.startsWith("UPDATE prodx_orders")) {
      sideEffectStatements.push(sql);
      return { rows: [] as unknown as T[] };
    }
        if (sql.includes("prodx_record_security_audit_event")) return { rows: [] as unknown as T[] };
throw new Error(`Unexpected SQL in unsupported void-provider test: ${sql}`);
  };
  const db: TransactionalSqlExecutor = {
    query,
    transaction: async (work) => {
      transactionCalls += 1;
      return work({ query });
    },
  };
  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: (_context, permission) => permission === "pos.void",
    configureRoutes: (configuredApp) => registerVoidRoute(configuredApp, db),
  });
  const server = await start(app);

  try {
    for (const method of ["card", "qr_digital"] as const) {
      activeMethod = method;
      const response = await fetch(`${server.baseUrl}/api/v1/orders/void`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: "order-1",
          reason: "Supervisor approved correction",
          idempotencyKey: `unsupported-provider-void-${method}`,
          supervisorAuthorizationToken: "server-issued-token",
        }),
      });
      assert.equal(response.status, 503, `${method} void must report provider unavailable`);
      const body = (await response.json()) as { error?: { code?: string } };
      assert.equal(body.error?.code, "VOID_PROVIDER_UNAVAILABLE");
    }
    assert.equal(transactionCalls, 2, "each request must run the provider guard inside the transaction");
    assert.deepEqual(sideEffectStatements, [], "unsupported provider voids must not record financial or inventory reversal effects");
  } finally {
    await server.close();
  }
});
