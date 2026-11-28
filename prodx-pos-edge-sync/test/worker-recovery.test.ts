import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueSale } from "../src/contracts";

const {
  commitSaleMock,
  recordFailedSequenceMock,
  resolveFailedSequenceMock,
  authenticateRecoveryOperatorMock,
} = vi.hoisted(() => ({
  commitSaleMock: vi.fn(),
  recordFailedSequenceMock: vi.fn(),
  resolveFailedSequenceMock: vi.fn(),
  authenticateRecoveryOperatorMock: vi.fn(),
}));

vi.mock("../src/postgres", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/postgres")>();
  return {
    ...actual,
    commitSale: commitSaleMock,
  };
});

vi.mock("../src/terminal-recovery", () => ({
  recordFailedSequence: recordFailedSequenceMock,
  resolveFailedSequence: resolveFailedSequenceMock,
}));

vi.mock("../src/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth")>();
  return {
    ...actual,
    authenticateRecoveryOperator: authenticateRecoveryOperatorMock,
  };
});

import worker from "../src/index";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TERMINAL = "22222222-2222-4222-8222-222222222222";
const STORE = "33333333-3333-4333-8333-333333333333";

function makeQueueSale(seq = 2): QueueSale {
  return {
    tenant_id: TENANT,
    terminal_id: TERMINAL,
    store_id: STORE,
    idempotency_key: `queue-recovery-key-${seq}-000001`,
    payload_hash: "a".repeat(64),
    do_name: `${TENANT}:${TERMINAL}`,
    edge_received_at: "2026-11-28T00:00:00.000Z",
    receipt_id: "44444444-4444-4444-8444-444444444444",
    sale: {
      idempotency_key: `queue-recovery-key-${seq}-000001`,
      payload_hash: "a".repeat(64),
      sale_id: "55555555-5555-4555-8555-555555555555",
      terminal_seq_no: seq,
      hlc: { physical_ms: 1700000000000 + seq, logical: 0 },
      catalog_version: 1,
      signed_price_proofs: [],
      client_recorded_at: "2026-11-28T00:00:00.000Z",
      currency: "THB",
      lines: [{ product_id: "66666666-6666-4666-8666-666666666666", quantity: 1, unit_price_minor: 1000, tax_bps: 700 }],
    },
  };
}

function makeStub() {
  return {
    markCommitted: vi.fn(async () => undefined),
    markVoided: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    verifyDurableOutboxRetention: vi.fn(async () => true),
    applyOriginCheckpoint: vi.fn(async () => undefined),
  };
}

function makeEnv(stub: ReturnType<typeof makeStub>) {
  return {
    POS_INGEST_DLQ_QUEUE: "prodx-pos-ingest-dlq",
    POS_INGEST_DLQ: { send: vi.fn(async () => undefined) },
    IDEMPOTENCY: {
      idFromName: vi.fn((name: string) => name),
      get: vi.fn(() => stub),
    },
  } as unknown as Env;
}

function makeMessage(body: unknown, attempts = 1) {
  return {
    id: "msg-1",
    timestamp: new Date(),
    body,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Worker Queue, Native DLQ & Recovery Error Sanitization", () => {
  it("main queue sequence-gap verifies durable DO outbox retention before ACK and refuses ACK if retention fails (HIGH #4)", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);
    const saleMsg = makeQueueSale(2);

    commitSaleMock.mockRejectedValue(new Error("TERMINAL_SEQUENCE_GAP:expected=1:got=2"));

    // Case 1: retention verified -> ACK without markFailed or DLQ send
    stub.verifyDurableOutboxRetention.mockResolvedValueOnce(true);
    const msgAcked = makeMessage(saleMsg, 95);
    await worker.queue({ queue: "prodx-pos-ingest", messages: [msgAcked] } as unknown as MessageBatch<unknown>, env);
    expect(stub.verifyDurableOutboxRetention).toHaveBeenCalledWith(TENANT, TERMINAL, saleMsg.idempotency_key);
    expect(msgAcked.ack).toHaveBeenCalledTimes(1);
    expect(msgAcked.retry).not.toHaveBeenCalled();
    expect(stub.markFailed).not.toHaveBeenCalled();
    expect((env.POS_INGEST_DLQ as unknown as { send: ReturnType<typeof vi.fn> }).send).not.toHaveBeenCalled();

    // Case 2: DO retention returns false -> refuse ACK and retry
    stub.verifyDurableOutboxRetention.mockResolvedValueOnce(false);
    const msgRetried = makeMessage(saleMsg, 95);
    await worker.queue({ queue: "prodx-pos-ingest", messages: [msgRetried] } as unknown as MessageBatch<unknown>, env);
    expect(msgRetried.ack).not.toHaveBeenCalled();
    expect(msgRetried.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(stub.markFailed).not.toHaveBeenCalled();

    // Case 3: DO retention/alarm RPC throws -> refuse ACK and retry
    stub.verifyDurableOutboxRetention.mockRejectedValueOnce(new Error("DO_ALARM_UNAVAILABLE"));
    const msgRpcErr = makeMessage(saleMsg, 95);
    await worker.queue({ queue: "prodx-pos-ingest", messages: [msgRpcErr] } as unknown as MessageBatch<unknown>, env);
    expect(msgRpcErr.ack).not.toHaveBeenCalled();
    expect(msgRpcErr.retry).toHaveBeenCalledWith({ delaySeconds: 60 });
  });

  it("native DLQ routes through recordFailedSequence, preserves NOT_NEXT without markFailed, and handles duplicate deliveries idempotently (HIGH #4)", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);
    const rawNativeDlqSale = makeQueueSale(2); // recovery_eligible === undefined

    // 1) TERMINAL_SEQUENCE_FAILURE_NOT_NEXT with durable retention -> ACK without markFailed
    recordFailedSequenceMock.mockRejectedValueOnce(new Error("TERMINAL_SEQUENCE_FAILURE_NOT_NEXT"));
    stub.verifyDurableOutboxRetention.mockResolvedValueOnce(true);
    const notNextAck = makeMessage(rawNativeDlqSale, 100);
    await worker.queue({ queue: "prodx-pos-ingest-dlq", messages: [notNextAck] } as unknown as MessageBatch<unknown>, env);
    expect(recordFailedSequenceMock).toHaveBeenCalledWith(env, rawNativeDlqSale, "QUEUE_RETRY_EXHAUSTED");
    expect(stub.markFailed).not.toHaveBeenCalled();
    expect(notNextAck.ack).toHaveBeenCalledTimes(1);

    // 2) TERMINAL_SEQUENCE_FAILURE_NOT_NEXT without durable retention -> retry (no ACK, no markFailed)
    recordFailedSequenceMock.mockRejectedValueOnce(new Error("TERMINAL_SEQUENCE_FAILURE_NOT_NEXT"));
    stub.verifyDurableOutboxRetention.mockResolvedValueOnce(false);
    const notNextRetry = makeMessage(rawNativeDlqSale, 100);
    await worker.queue({ queue: "prodx-pos-ingest-dlq", messages: [notNextRetry] } as unknown as MessageBatch<unknown>, env);
    expect(stub.markFailed).not.toHaveBeenCalled();
    expect(notNextRetry.ack).not.toHaveBeenCalled();
    expect(notNextRetry.retry).toHaveBeenCalledWith({ delaySeconds: 60 });

    // 3) Native DLQ recorded + duplicate DLQ delivery -> both idempotent and ACKed
    recordFailedSequenceMock.mockResolvedValue("recorded");
    const firstDlq = makeMessage(rawNativeDlqSale, 100);
    const dupDlq = makeMessage(rawNativeDlqSale, 100);
    await worker.queue({ queue: "prodx-pos-ingest-dlq", messages: [firstDlq, dupDlq] } as unknown as MessageBatch<unknown>, env);
    expect(stub.markFailed).toHaveBeenCalledTimes(2);
    expect(firstDlq.ack).toHaveBeenCalledTimes(1);
    expect(dupDlq.ack).toHaveBeenCalledTimes(1);

    // 4) Explicit recovery_eligible === false (malformed/non-eligible envelope) -> markFailed directly without PG record
    vi.clearAllMocks();
    const nonEligible = { ...rawNativeDlqSale, failure_code: "MALFORMED_ENVELOPE", recovery_eligible: false };
    const nonEligibleMsg = makeMessage(nonEligible, 1);
    await worker.queue({ queue: "prodx-pos-ingest-dlq", messages: [nonEligibleMsg] } as unknown as MessageBatch<unknown>, env);
    expect(recordFailedSequenceMock).not.toHaveBeenCalled();
    expect(stub.markFailed).toHaveBeenCalledWith(TENANT, TERMINAL, nonEligible.idempotency_key, "MALFORMED_ENVELOPE", undefined);
    expect(nonEligibleMsg.ack).toHaveBeenCalledTimes(1);
  });

  it("sanitizes unexpected 503 errors in handleTerminalSequenceRecovery without leaking internals (MEDIUM #7)", async () => {
    const stub = makeStub();
    const env = makeEnv(stub);
    authenticateRecoveryOperatorMock.mockResolvedValue({ tenantId: TENANT, subject: "ops@prodx.test" });
    resolveFailedSequenceMock.mockRejectedValueOnce(
      new Error('password authentication failed for user "prodx_pos_worker" at postgres://10.0.0.5:5432/prod')
    );

    const req = new Request(
      `https://prodx-edge.test/api/v1/ops/terminal-sequence-recovery?terminal_id=${TERMINAL}&terminal_seq_no=2`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "VOID",
          request_id: "77777777-7777-4777-8777-777777777777",
          reason: "Operator test",
        }),
      }
    );

    const res = await worker.fetch(req, env, {} as ExecutionContext);
    expect(res.status).toBe(503);
    const body = await res.json() as { error: string };
    expect(body).toEqual({ error: "TERMINAL_SEQUENCE_RECOVERY_UNAVAILABLE" });
    expect(JSON.stringify(body)).not.toContain("prodx_pos_worker");
    expect(JSON.stringify(body)).not.toContain("10.0.0.5");

    // Allowlisted error codes still map cleanly to 404/409
    resolveFailedSequenceMock.mockRejectedValueOnce(new Error("TERMINAL_SEQUENCE_FAILURE_NOT_FOUND"));
    const res404 = await worker.fetch(
      new Request(req.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "VOID",
          request_id: "88888888-8888-4888-8888-888888888888",
          reason: "Operator test",
        }),
      }),
      env,
      {} as ExecutionContext
    );
    expect(res404.status).toBe(404);
    expect(await res404.json()).toEqual({ error: "TERMINAL_SEQUENCE_FAILURE_NOT_FOUND" });
  });
});
