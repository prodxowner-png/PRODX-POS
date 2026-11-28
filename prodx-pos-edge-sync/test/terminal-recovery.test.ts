import { describe, expect, it, vi } from "vitest";
import type { Client } from "pg";
import { readTerminalCheckpoint, readTerminalFailureHistoryPage } from "../src/terminal-recovery";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TERMINAL = "22222222-2222-4222-8222-222222222222";
const STORE = "33333333-3333-4333-8333-333333333333";
const KEY = "terminal-history-idempotency-key-0001";

function fakeClient(query: ReturnType<typeof vi.fn>): Client {
  return { query } as unknown as Client;
}

describe("bounded terminal recovery checkpoint", () => {
  it("loads active failures and only historical rows matching request key/sequence", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        store_id: STORE,
        last_committed_seq_no: "42",
        last_hlc_physical_ms: "1700000000000",
        last_hlc_logical: 2,
        last_resolved_seq_no: "42",
        last_resolved_hlc_physical_ms: "1700000000000",
        last_resolved_hlc_logical: 2
      }] })
      .mockResolvedValueOnce({ rows: [{
        terminal_seq_no: "41", sale_id: "44444444-4444-4444-8444-444444444444",
        idempotency_key: KEY, receipt_id: "55555555-5555-4555-8555-555555555555",
        payload_hash: "a".repeat(64), failure_code: "VOIDED_FAILURE",
        edge_received_at: "2026-11-01T00:00:00.000Z", store_id: STORE,
        do_name: `${TENANT}:${TERMINAL}`, sale_snapshot: null, matched_sale_id: null,
        latest_disposition: "VOID", latest_resolution_id: "66666666-6666-4666-8666-666666666666",
        retry_failure_id: null, retry_failure_code: null
      }] });

    const checkpoint = await readTerminalCheckpoint(fakeClient(query), TENANT, TERMINAL, STORE, [
      { idempotency_key: KEY, terminal_seq_no: 41 }
    ]);

    expect(checkpoint.last_resolved_seq_no).toBe(42);
    expect(checkpoint.terminal_failures).toHaveLength(1);
    expect(checkpoint.terminal_failures[0]?.outcome).toBe("VOIDED");
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("WITH candidate_ids AS MATERIALIZED");
    expect(sql).toContain("SELECT id FROM terminal_sequence_failures");
    expect(sql).toContain("f.terminal_seq_no=$5::bigint + 1 AND s.sale_id IS NULL AND COALESCE(r.disposition,'') <> 'VOID'");
    expect(sql).toContain("f.idempotency_key=ANY($3::text[])");
    expect(sql).toContain("f.terminal_seq_no=ANY($4::bigint[])");
    expect(sql).toContain("LIMIT $6");
    expect(params).toEqual([TENANT, TERMINAL, [KEY], [41], "42", 257]);
    expect(sql).not.toContain("LIMIT 5001");
  });

  it("fails closed if the bounded query still returns more than 256 rows", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{
        store_id: STORE, last_committed_seq_no: "0", last_hlc_physical_ms: "0", last_hlc_logical: 0,
        last_resolved_seq_no: "0", last_resolved_hlc_physical_ms: "0", last_resolved_hlc_logical: 0
      }] })
      .mockResolvedValueOnce({ rows: Array.from({ length: 257 }, () => ({})) });
    await expect(readTerminalCheckpoint(fakeClient(query), TENANT, TERMINAL, STORE))
      .rejects.toThrow("TERMINAL_FAILURE_CHECKPOINT_LIMIT");
  });

  it("rejects an oversized lookup before querying the database", async () => {
    const query = vi.fn();
    const lookup = Array.from({ length: 51 }, (_, index) => ({
      idempotency_key: `oversized-lookup-key-${String(index).padStart(8, "0")}`,
      terminal_seq_no: index + 1
    }));
    await expect(readTerminalCheckpoint(fakeClient(query), TENANT, TERMINAL, STORE, lookup))
      .rejects.toThrow("INVALID_TERMINAL_FAILURE_LOOKUP");
    expect(query).not.toHaveBeenCalled();
  });
});

describe("terminal failure history keyset pagination", () => {
  it("fetches limit+1 and returns a stable next sequence cursor", async () => {
    const rows = [1, 2, 3].map((sequence) => ({
      terminal_seq_no: String(sequence),
      sale_id: `44444444-4444-4444-8444-${String(sequence).padStart(12, "0")}`,
      idempotency_key: `history-idempotency-key-${String(sequence).padStart(4, "0")}`,
      receipt_id: `55555555-5555-4555-8555-${String(sequence).padStart(12, "0")}`,
      payload_hash: "b".repeat(64), failure_code: "QUEUE_RETRY_EXHAUSTED",
      failed_at: "2026-11-01T00:00:00.000Z", matched_sale_id: null,
      disposition: sequence === 1 ? "VOID" : null,
      resolution_id: sequence === 1 ? "66666666-6666-4666-8666-666666666666" : null,
      resolution_at: sequence === 1 ? "2026-11-01T00:01:00.000Z" : null,
      retry_failure_id: null, retry_failure_code: null
    }));
    const query = vi.fn().mockResolvedValue({ rows });

    const page = await readTerminalFailureHistoryPage(fakeClient(query), TENANT, TERMINAL, 0, 2);

    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.outcome).toBe("VOIDED");
    expect(page.items[1]?.outcome).toBe("FAILED");
    expect(page.has_more).toBe(true);
    expect(page.next_cursor).toBe("2");
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("f.terminal_seq_no>$3");
    expect(sql).toContain("ORDER BY f.terminal_seq_no ASC");
    expect(sql).toContain("LIMIT $4");
    expect(params).toEqual([TENANT, TERMINAL, 0, 3]);
  });

  it("rejects invalid page limits and cursors", async () => {
    const query = vi.fn();
    await expect(readTerminalFailureHistoryPage(fakeClient(query), TENANT, TERMINAL, -1, 20))
      .rejects.toThrow("INVALID_TERMINAL_FAILURE_PAGE");
    await expect(readTerminalFailureHistoryPage(fakeClient(query), TENANT, TERMINAL, 0, 101))
      .rejects.toThrow("INVALID_TERMINAL_FAILURE_PAGE");
    expect(query).not.toHaveBeenCalled();
  });
});
