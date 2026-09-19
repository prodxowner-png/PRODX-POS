import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResultRow } from "pg";
import { createApp } from "./createApp";
import { registerRefundRoute } from "./refund-route";
import type { TransactionalSqlExecutor } from "../db/transaction";

const principal = {
  userId: "server-user",
  organizationId: "org-1",
  storeId: "store-1",
  sessionId: "session-1",
};

const start = async (app: ReturnType<typeof createApp>) => {
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
};

test("refund route derives the authorizing user from the authenticated principal", async () => {
  let refundInsertParameters: readonly unknown[] | undefined;
  const query = async <T extends QueryResultRow>(
    sql: string,
    parameters: readonly unknown[] = [],
  ) => {
    if (sql.includes("FROM prodx_refunds r JOIN"))
      return { rows: [] as unknown as T[] };
    if (sql.includes("FROM prodx_orders")) {
      return {
        rows: [
          {
            id: "order-1",
            organization_id: principal.organizationId,
            store_id: principal.storeId,
            order_number: "ORD-1",
            register_id: "register-1",
            shift_id: "shift-1",
            status: "server_confirmed",
            currency: "THB",
            grand_total_amount: "10.00",
          },
        ] as unknown as T[],
      };
    }
    if (sql.includes("UPDATE prodx_supervisor_authorizations"))
      return { rows: [{ supervisorUserId: "supervisor-1" }] as unknown as T[] };
    if (sql.includes("FROM prodx_store_memberships"))
      return { rows: [{ id: "membership-1" }] as unknown as T[] };
    if (sql.includes("FROM prodx_payments"))
      return {
        rows: [
          { amount: "10.00", mismatched_currency_count: 0 },
        ] as unknown as T[],
      };
    if (sql.includes("SELECT COALESCE(SUM(amount)"))
      return { rows: [{ amount: "0.00" }] as unknown as T[] };
    if (sql.includes("FROM prodx_shifts"))
      return { rows: [{ id: "shift-1" }] as unknown as T[] };
    if (sql.startsWith("INSERT INTO prodx_refunds")) {
      refundInsertParameters = parameters;
      return {
        rows: [
          { id: "refund-1", order_id: "order-1", amount: "10.00" },
        ] as unknown as T[],
      };
    }
    if (sql.includes("INSERT INTO prodx_cash_movements"))
      return { rows: [] as unknown as T[] };
    if (sql.startsWith("UPDATE prodx_orders"))
      return { rows: [] as unknown as T[] };
    if (sql.includes("INSERT INTO prodx_audit_log"))
      return { rows: [] as unknown as T[] };
    throw new Error(`Unexpected SQL in refund route test: ${sql}`);
  };
  const db: TransactionalSqlExecutor = {
    query,
    transaction: async (work) => work({ query }),
  };

  const app = createApp({
    authenticateRequest: () => principal,
    authorizeRequest: () => false,
    configureRoutes: (configuredApp) => registerRefundRoute(configuredApp, db),
  });
  const server = await start(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/v1/orders/refund`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orderId: "order-1",
        refundAmount: { amountInCents: 1000, currency: "thb" },
        reason: "Customer return",
        refundMethod: "cash",
        itemsToRestock: [],
        idempotencyKey: "refund-route-test",
        supervisorAuthorizationToken: "server-issued-token",
        authorizedByUserId: "browser-supplied-attacker",
        authorizedByName: "Untrusted Browser User",
      }),
    });

    assert.equal(response.status, 201);
    assert.equal((await response.json()).success, true);
    assert.ok(refundInsertParameters);
    assert.equal(refundInsertParameters?.[9], "supervisor-1");
    assert.equal(refundInsertParameters?.[10], principal.userId);
    assert.notEqual(refundInsertParameters?.[9], "browser-supplied-attacker");
  } finally {
    await server.close();
  }
});
