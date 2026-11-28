import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authenticateTenantOperatorMock,
  clientConnectMock,
  clientQueryMock,
  clientEndMock,
  ClientMock
} = vi.hoisted(() => ({
  authenticateTenantOperatorMock: vi.fn(),
  clientConnectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  clientEndMock: vi.fn(),
  ClientMock: vi.fn()
}));

vi.mock("pg", () => ({
  Client: ClientMock
}));
vi.mock("../src/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth")>();
  return { ...actual, authenticateTenantOperator: authenticateTenantOperatorMock };
});

import worker from "../src/index";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TERMINAL = "22222222-2222-4222-8222-222222222222";
const STORE = "33333333-3333-4333-8333-333333333333";

function makeEnv(): Env {
  return { HYPERDRIVE_DIRECT: { connectionString: "postgres://test-only" } } as unknown as Env;
}

function makeRequest(query = "") {
  return new Request(`https://edge.example/api/v1/ops/terminal-sequence-failures?terminal_id=${TERMINAL}${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  authenticateTenantOperatorMock.mockResolvedValue({ tenantId: TENANT, subject: "auditor-subject" });
  clientConnectMock.mockResolvedValue(undefined);
  clientEndMock.mockResolvedValue(undefined);
  ClientMock.mockImplementation(function () {
    return {
      connect: clientConnectMock,
      query: clientQueryMock,
      end: clientEndMock
    };
  });
  clientQueryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT DISTINCT d.store_id")) return { rows: [{ store_id: STORE }], rowCount: 1 };
    if (sql.includes("FROM terminal_sequence_failures f")) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  });
});

describe("GET /api/v1/ops/terminal-sequence-failures", () => {
  it("uses tenant RLS context and returns stable keyset page metadata", async () => {
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT DISTINCT d.store_id")) return { rows: [{ store_id: STORE }], rowCount: 1 };
      if (sql.includes("FROM terminal_sequence_failures f")) return { rows: [
        {
          terminal_seq_no: "5", sale_id: "44444444-4444-4444-8444-444444444444",
          idempotency_key: "history-idempotency-key-0005", receipt_id: "55555555-5555-4555-8555-555555555555",
          payload_hash: "a".repeat(64), failure_code: "QUEUE_RETRY_EXHAUSTED",
          failed_at: "2026-11-01T00:00:00.000Z", matched_sale_id: null, disposition: "VOID",
          resolution_id: "66666666-6666-4666-8666-666666666666", resolution_at: "2026-11-01T00:01:00.000Z",
          retry_failure_id: null, retry_failure_code: null
        },
        {
          terminal_seq_no: "6", sale_id: "77777777-7777-4777-8777-777777777777",
          idempotency_key: "history-idempotency-key-0006", receipt_id: "88888888-8888-4888-8888-888888888888",
          payload_hash: "b".repeat(64), failure_code: "STOCK_CONFLICT",
          failed_at: "2026-11-02T00:00:00.000Z", matched_sale_id: null, disposition: null,
          resolution_id: null, resolution_at: null, retry_failure_id: null, retry_failure_code: null
        }
      ], rowCount: 2 };
      return { rows: [], rowCount: 0 };
    });

    const response = await worker.fetch(makeRequest("&after_seq_no=4&limit=1"), makeEnv(), {} as ExecutionContext);
    const body = await response.json() as { items: Array<{ outcome: string }>; has_more: boolean; next_cursor: string | null };

    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.outcome).toBe("VOIDED");
    expect(body.has_more).toBe(true);
    expect(body.next_cursor).toBe("5");
    const calls = clientQueryMock.mock.calls as Array<[string, unknown[]?]>;
    const tenantContextIndex = calls.findIndex(([sql]) => sql.includes("set_config('app.current_tenant_id'"));
    const historyQueryIndex = calls.findIndex(([sql]) => sql.includes("FROM terminal_sequence_failures f"));
    expect(tenantContextIndex).toBeGreaterThan(-1);
    expect(historyQueryIndex).toBeGreaterThan(tenantContextIndex);
    expect(calls[historyQueryIndex]?.[1]).toEqual([TENANT, TERMINAL, 4, 2]);
  });

  it("rejects an oversized page before opening a database connection", async () => {
    const response = await worker.fetch(makeRequest("&limit=101"), makeEnv(), {} as ExecutionContext);
    expect(response.status).toBe(400);
    expect(ClientMock).not.toHaveBeenCalled();
  });

  it("requires an authenticated tenant auditor before reading history", async () => {
    authenticateTenantOperatorMock.mockRejectedValue(new Response("Forbidden", { status: 403 }));
    const response = await worker.fetch(makeRequest(), makeEnv(), {} as ExecutionContext);
    expect(response.status).toBe(403);
    expect(ClientMock).not.toHaveBeenCalled();
  });
});
