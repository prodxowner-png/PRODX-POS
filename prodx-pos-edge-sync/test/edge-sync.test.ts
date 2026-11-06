import { describe, it, expect } from "vitest";
import { env } from "cloudflare:workers";
import { runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { IdempotencyGate } from "../src/idempotency-do";
import { signCatalogPriceProofs, signCatalogSnapshot, verifyCatalogSnapshot, verifySalePrices } from "../src/catalog-crypto";
import type { PreparedSale, IdempotencySubmission, OfflineSale } from "../src/contracts";

const TENANT = "11111111-1111-4111-8111-111111111111";
const TERMINAL = "22222222-2222-4222-8222-222222222222";
const SECRET = "test-only-signing-secret-at-least-32-characters";
const runInDO = runInDurableObject as unknown as (
  stub: unknown,
  callback: (instance: any, state: DurableObjectState) => void | Promise<void>
) => Promise<void>;


function prepared(key: string, hash: string, seq: number): PreparedSale {
  const sale: OfflineSale = {
    idempotency_key: key, payload_hash: hash,
    sale_id: `33333333-3333-4333-8333-${String(seq).padStart(12,"0")}`,
    terminal_seq_no: seq, hlc: { physical_ms: Date.now() + seq, logical: 0 },
    catalog_version: 7,
    signed_price_proofs: [{
      algorithm: "HMAC-SHA256", catalog_version: 7,
      issued_at: new Date().toISOString(), expires_at: new Date(Date.now()+86400_000).toISOString(),
      product_id: "44444444-4444-4444-8444-444444444444", unit_price_minor: 1250, tax_bps: 700,
      signature: "test-signature"
    }],
    client_recorded_at: "2026-11-01T00:00:00.000Z", currency: "THB",
    lines: [{ product_id: "44444444-4444-4444-8444-444444444444", quantity: 1, unit_price_minor: 1250, tax_bps: 700 }]
  };
  return { sale, payloadHash: hash, edgeReceivedAt: new Date().toISOString(), receiptId: crypto.randomUUID() };
}
function submission(sales: PreparedSale[]): IdempotencySubmission {
  return { tenantId: TENANT, terminalId: TERMINAL, doName: `${TENANT}:${TERMINAL}`, sales };
}
function getStub(label: string) {
  const id = env.IDEMPOTENCY.idFromName(`${TENANT}:${TERMINAL}:${label}`);
  return env.IDEMPOTENCY.get(id);
}

describe("PRODX Edge sync Durable Object", () => {
  it("rejects an existing-key hash mismatch atomically across a 50-sale batch", async () => {
    const stub = getStub("atomicity");
    const batch = Array.from({length:50},(_,i)=>prepared(
      i===0 ? "existing-idempotency-key-0001" : `new-idempotency-key-${String(i).padStart(4,"0")}`,
      i===0 ? "b".repeat(64) : String(i).padStart(64,"0"), i+1
    ));
    await runInDO(stub, async (instance: IdempotencyGate, state) => {
      const queue=(instance as any).env.POS_INGEST_QUEUE;
      Object.defineProperty(queue,"sendBatch",{configurable:true,value:async()=>{throw new Error("QUEUE_MUST_NOT_BE_CALLED");}});
      state.storage.sql.exec(
        `INSERT INTO idempotency(idempotency_key,tenant_id,terminal_id,payload_hash,canonical_payload,
         receipt_id,queue_payload,state,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
        "existing-idempotency-key-0001", TENANT, TERMINAL, "a".repeat(64), "{}",
        "receipt-seed", "{}", "QUEUED", new Date().toISOString(), new Date().toISOString()
      );
      let mismatch: unknown;
      try {
        await instance.submitBatch(submission(batch));
      } catch (error) {
        mismatch = error;
      }
      expect(mismatch).toBeInstanceOf(Error);
      expect((mismatch as Error).message).toContain("IDEMPOTENCY_PAYLOAD_MISMATCH");
      const count=state.storage.sql.exec("SELECT COUNT(*) AS count FROM idempotency").toArray()[0]!.count;
      expect(count).toBe(1);
      expect(state.storage.sql.exec("SELECT idempotency_key FROM idempotency WHERE idempotency_key LIKE 'new-%'").toArray()).toHaveLength(0);
      expect(state.storage.sql.exec("SELECT seq_no FROM terminal_sequence_seen").toArray()).toHaveLength(0);
      expect(state.storage.sql.exec("SELECT gap_from_seq_no FROM terminal_sequence_gaps").toArray()).toHaveLength(0);
    });
  });

  it("recovers ENQUEUE_PENDING through a real DO alarm after Queue.sendBatch fails", async () => {
    const stub = getStub("alarm-recovery");
    let recoveredQueueCalls=0;
    await runInDO(stub, async (instance, state) => {
      const queue=(instance as any).env.POS_INGEST_QUEUE;
      Object.defineProperty(queue,"sendBatch",{ configurable:true, value:async()=>{ throw new Error("injected queue outage"); } });
      const item=prepared("alarm-idempotency-key-0001","c".repeat(64),1);
      await expect((instance as any).submitBatch(submission([item]))).rejects.toThrow("injected queue outage");
      const pending=state.storage.sql.exec("SELECT COUNT(*) AS count FROM idempotency WHERE state='ENQUEUE_PENDING'").toArray()[0]!.count;
      expect(pending).toBe(1);
      Object.defineProperty(queue,"sendBatch",{ configurable:true, value:async(messages:unknown[])=>{
        recoveredQueueCalls++; expect(messages).toHaveLength(1);
      } });
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(recoveredQueueCalls).toBe(1);
    await runInDO(stub, async (instance, state) => {
      const queued=state.storage.sql.exec("SELECT COUNT(*) AS count FROM idempotency WHERE state='QUEUED'").toArray()[0]!.count;
      expect(queued).toBe(1);
    });
  });

  it("re-enqueues QUEUED outbox entries until PostgreSQL marks them committed", async () => {
    const stub=getStub("queued-retry");
    const item=prepared("queued-retry-idempotency-key","9".repeat(64),1);
    await stub.submitBatch(submission([item]));
    let resent=0;
    await runInDO(stub as any,(instance:any)=>{
      const queue=instance.env.POS_INGEST_QUEUE;
      const original=queue.sendBatch.bind(queue);
      Object.defineProperty(queue,"sendBatch",{configurable:true,value:async(messages:any[])=>{
        resent+=messages.length;
        return original(messages);
      }});
      instance.ctx.storage.sql.exec(
        `UPDATE idempotency SET next_retry_at=? WHERE idempotency_key=?`,
        new Date(Date.now()-1_000).toISOString(),item.sale.idempotency_key
      );
    });
    await runDurableObjectAlarm(stub);
    expect(resent).toBe(1);
    await stub.markCommitted(TENANT,TERMINAL,item.sale.idempotency_key);
    // A delayed DLQ delivery must never overwrite PostgreSQL's committed result.
    await stub.markFailed(TENANT,TERMINAL,item.sale.idempotency_key,"LATE_DLQ_REPLAY");
    const status=await stub.getStatus(TENANT,TERMINAL,item.sale.idempotency_key);
    expect(status.status).toBe("committed");
    await runDurableObjectAlarm(stub);
    expect(resent).toBe(1);
  });

  it("finalizes permanent failures so the DO sweeper does not re-enqueue them", async () => {
    const stub=getStub("failed-state");
    const item=prepared("permanent-failure-idempotency-key","8".repeat(64),1);
    await stub.submitBatch(submission([item]));
    await stub.markFailed(TENANT,TERMINAL,item.sale.idempotency_key,"PRODUCT_NOT_FOUND_IN_TENANT");
    const status=await stub.getStatus(TENANT,TERMINAL,item.sale.idempotency_key);
    expect(status.status).toBe("failed");
    expect(status.failure_code).toBe("PRODUCT_NOT_FOUND_IN_TENANT");
    await runInDO(stub, async (instance: IdempotencyGate, state) => {
      (instance as any).pruneStorage(Date.now() + 31 * 86400_000);
      const retained=state.storage.sql.exec(
        `SELECT COUNT(*) AS count FROM idempotency WHERE idempotency_key=? AND failure_code IS NOT NULL`,
        item.sale.idempotency_key
      ).toArray()[0]!.count;
      expect(retained).toBe(1);
    });
    await runInDO(stub, async (instance: IdempotencyGate) => {
      let failure: unknown;
      try {
        await instance.submitBatch(submission([item]));
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toContain("IDEMPOTENCY_PREVIOUSLY_FAILED");
    });
  });

  it("reconciles a restored DO checkpoint forward from PostgreSQL before accepting the next sequence", async () => {
    const stub=getStub("origin-checkpoint-recovery");
    await runInDO(stub,(_instance:any,state:any)=>{
      state.storage.sql.exec(
        `UPDATE terminal_sequence_state SET last_contiguous_seq_no=8,last_hlc_physical_ms=1000,last_hlc_logical=2 WHERE singleton=1`
      );
    });
    const next=prepared("checkpoint-recovery-key","7".repeat(64),11);
    const result=await stub.submitBatch(submission([next]),{
      last_committed_seq_no:10,last_hlc_physical_ms:1000,last_hlc_logical:2,
      last_resolved_seq_no:10,last_resolved_hlc_physical_ms:1000,last_resolved_hlc_logical:2,terminal_failures:[]
    });
    expect(result.last_contiguous_seq_no).toBe(11);
    expect(result.sequence_gaps).toHaveLength(0);
  });

  it("reports sequence gaps and later closes them without rejecting an earlier HLC", async () => {
    const stub=getStub("sequence-gap");
    const base=Date.now()+1_000;
    const later=prepared("sequence-later-idempotency-key","e".repeat(64),2);
    later.sale.hlc={physical_ms:base+2,logical:0};
    const laterResult=await stub.submitBatch(submission([later]));
    expect(laterResult.last_contiguous_seq_no).toBe(0);
    expect(laterResult.sequence_gaps).toEqual([{from_seq_no:1,to_seq_no:1}]);

    const earlier=prepared("sequence-earlier-idempotency-key","f".repeat(64),1);
    earlier.sale.hlc={physical_ms:base+1,logical:0};
    const earlierResult=await stub.submitBatch(submission([earlier]));
    expect(earlierResult.last_contiguous_seq_no).toBe(2);
    expect(earlierResult.sequence_gaps).toHaveLength(0);
  });

  it("accepts a valid signed offline price snapshot after current catalog price changes and rejects tampering", async () => {
    const productId="44444444-4444-4444-8444-444444444444";
    const proofs=await signCatalogPriceProofs(42,[{product_id:productId,unit_price_minor:1250,tax_bps:700}],SECRET,86400);
    const sale:OfflineSale={
      idempotency_key:"signed-catalog-idempotency-01",payload_hash:"d".repeat(64),
      sale_id:"33333333-3333-4333-8333-333333333333",terminal_seq_no:1,
      hlc:{physical_ms:Date.now(),logical:0},catalog_version:42,signed_price_proofs:proofs,
      client_recorded_at:new Date().toISOString(),currency:"THB",
      lines:[{product_id:productId,quantity:1,unit_price_minor:1250,tax_bps:700}]
    };
    const currentDatabasePrice=1990; // Simulates back-office price changing after offline catalog issuance.
    expect(currentDatabasePrice).not.toBe(sale.lines[0]!.unit_price_minor);
    expect(await verifySalePrices(sale,SECRET)).toBe(true);
    const forged={...sale,lines:[{...sale.lines[0]!,unit_price_minor:1}]};
    expect(await verifySalePrices(forged,SECRET)).toBe(false);
  });

  it("blocks later sequences behind an unresolved permanent failure", async () => {
    const stub=getStub("failed-sequence-blocks-following");
    const failed=prepared("failed-sequence-owner-key","e".repeat(64),1);
    await stub.submitBatch(submission([failed]));
    await stub.markFailed(TENANT,TERMINAL,failed.sale.idempotency_key,"INSUFFICIENT_STOCK");
    const later=prepared("sale-after-failed-sequence-key","f".repeat(64),2);
    await runInDO(stub,async (instance:IdempotencyGate) => {
      let failure:unknown;
      try {
        await instance.submitBatch(submission([later]),{
          last_committed_seq_no:0,last_hlc_physical_ms:0,last_hlc_logical:0,
          last_resolved_seq_no:0,last_resolved_hlc_physical_ms:0,last_resolved_hlc_logical:0,terminal_failures:[]
        });
      } catch (error) { failure=error; }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("TERMINAL_SEQUENCE_BLOCKED_BY_FAILED_RECEIPT");
    });
  });

  it("re-enqueues the exact original receipt after an origin-authorized RETRY", async () => {
    const stub=getStub("origin-retry-recovery");
    const item=prepared("origin-retry-idempotency-key","a".repeat(64),1);
    await stub.submitBatch(submission([item]));
    await stub.markFailed(TENANT,TERMINAL,item.sale.idempotency_key,"INSUFFICIENT_STOCK");
    let resent=0;
    const retryCheckpoint={
      last_committed_seq_no:0,last_hlc_physical_ms:0,last_hlc_logical:0,
      last_resolved_seq_no:0,last_resolved_hlc_physical_ms:0,last_resolved_hlc_logical:0,
      terminal_failures:[{
        terminal_seq_no:1,sale_id:item.sale.sale_id,idempotency_key:item.sale.idempotency_key,
        receipt_id:item.receiptId,payload_hash:item.payloadHash,failure_code:"INSUFFICIENT_STOCK",
        edge_received_at:item.edgeReceivedAt,outcome:"RETRY" as const
      }]
    };
    await runInDO(stub as any,async(instance:any)=>{
      const queue=instance.env.POS_INGEST_QUEUE;
      const original=queue.sendBatch.bind(queue);
      Object.defineProperty(queue,"sendBatch",{configurable:true,value:async(messages:any[])=>{
        resent+=messages.length;
        expect(messages[0]?.body.receipt_id).toBe(item.receiptId);
        expect(messages[0]?.body.edge_received_at).toBe(item.edgeReceivedAt);
        expect(messages[0]?.body.payload_hash).toBe(item.payloadHash);
      }});
      try { await instance.applyOriginCheckpoint(retryCheckpoint); }
      finally { Object.defineProperty(queue,"sendBatch",{configurable:true,value:original}); }
    });
    expect(resent).toBe(1);
    expect((await stub.getStatus(TENANT,TERMINAL,item.sale.idempotency_key)).status).toBe("queued");
  });

  it("reconciles an origin-authorized VOID without reporting a committed sale", async () => {
    const stub=getStub("origin-void-recovery");
    const item=prepared("origin-void-idempotency-key","b".repeat(64),1);
    await stub.submitBatch(submission([item]));
    await stub.markFailed(TENANT,TERMINAL,item.sale.idempotency_key,"INSUFFICIENT_STOCK");
    let resent=0;
    const checkpoint={
      last_committed_seq_no:0,last_hlc_physical_ms:0,last_hlc_logical:0,
      last_resolved_seq_no:1,last_resolved_hlc_physical_ms:item.sale.hlc.physical_ms,
      last_resolved_hlc_logical:item.sale.hlc.logical,
      terminal_failures:[{
        terminal_seq_no:1,sale_id:item.sale.sale_id,idempotency_key:item.sale.idempotency_key,
        receipt_id:item.receiptId,payload_hash:item.payloadHash,failure_code:"INSUFFICIENT_STOCK",
        edge_received_at:item.edgeReceivedAt,outcome:"VOIDED" as const
      }]
    };
    await runInDO(stub as any,async(instance:any)=>{
      const queue=instance.env.POS_INGEST_QUEUE;
      const original=queue.sendBatch.bind(queue);
      Object.defineProperty(queue,"sendBatch",{
        configurable:true,value:async(messages:any[])=>{resent+=messages.length;}
      });
      try { await instance.applyOriginCheckpoint(checkpoint); }
      finally { Object.defineProperty(queue,"sendBatch",{configurable:true,value:original}); }
    });
    expect(resent).toBe(0);
    expect((await stub.getStatus(TENANT,TERMINAL,item.sale.idempotency_key)).status).toBe("voided");
    const replay=await stub.submitBatch(submission([item]),checkpoint);
    expect(replay.results[0]?.status).toBe("voided");
    expect(replay.last_contiguous_seq_no).toBe(1);
  });

  it("rejects a different idempotency key that reuses a locally accepted sequence", async () => {
    const stub=getStub("sequence-reuse-after-local-accept");
    const first=prepared("sequence-owner-idempotency-key","a".repeat(64),1);
    await stub.submitBatch(submission([first]));
    const reused=prepared("sequence-reuse-new-idempotency-key","b".repeat(64),1);
    await runInDO(stub,async (instance:IdempotencyGate) => {
      let failure:unknown;
      try {
        await instance.submitBatch(submission([reused]));
      } catch (error) { failure=error; }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("TERMINAL_SEQUENCE_ALREADY_ACCEPTED");
    });
  });

  it("forwards expired exact replays only after the origin checkpoint confirms commit", async () => {
    const stub=getStub("expired-exact-replay-origin-checkpoint");
    const original=prepared("expired-origin-replay-key","c".repeat(64),1);
    await stub.submitBatch(submission([original]));

    await runInDO(stub,async (instance:any,state:any) => {
      // Simulate an origin-committed receipt whose Edge cache is older than retention.
      state.storage.sql.exec(
        "UPDATE idempotency SET state='COMMITTED',updated_at=? WHERE idempotency_key=?",
        new Date(Date.now()-31*86400_000).toISOString(),original.sale.idempotency_key
      );
      instance.pruneStorage(Date.now());
      const retained=state.storage.sql.exec(
        "SELECT COUNT(*) AS count FROM idempotency WHERE idempotency_key=?",
        original.sale.idempotency_key
      ).toArray()[0]!.count;
      expect(retained).toBe(0);
    });

    // Local sequence memory alone is insufficient proof that PostgreSQL committed.
    const replay:PreparedSale={...original,receiptId:crypto.randomUUID()};
    await runInDO(stub,async (instance:IdempotencyGate) => {
      let failure:unknown;
      try {
        await instance.submitBatch(submission([replay]),{
          last_committed_seq_no:0,last_hlc_physical_ms:0,last_hlc_logical:0,
          last_resolved_seq_no:0,last_resolved_hlc_physical_ms:0,last_resolved_hlc_logical:0,terminal_failures:[]
        });
      } catch (error) { failure=error; }
      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).message).toBe("TERMINAL_SEQUENCE_ALREADY_ACCEPTED");
    });

    const accepted=await stub.submitBatch(submission([replay]),{
      last_committed_seq_no:1,
      last_hlc_physical_ms:original.sale.hlc.physical_ms,
      last_hlc_logical:original.sale.hlc.logical,
      last_resolved_seq_no:1,
      last_resolved_hlc_physical_ms:original.sale.hlc.physical_ms,
      last_resolved_hlc_logical:original.sale.hlc.logical,
      terminal_failures:[]
    });
    expect(accepted.results[0]?.status).toBe("accepted");
    await runInDO(stub,async (instance:IdempotencyGate) => {
      expect(instance.getStatus(TENANT,TERMINAL,original.sale.idempotency_key).status).toBe("queued");
    });
  });

  it("retains sequence ownership until PostgreSQL confirms the origin checkpoint", async () => {
    const stub=getStub("sequence-claim-origin-retention");
    const first=prepared("sequence-retention-owner-key","c".repeat(64),1);
    await stub.submitBatch(submission([first]));
    await runInDO(stub,async (instance:any,state:any) => {
      instance.pruneStorage(Date.now() + 31 * 86400_000);
      const retained=state.storage.sql.exec(
        "SELECT COUNT(*) AS count FROM terminal_sequence_seen WHERE seq_no=1"
      ).toArray()[0]!.count;
      expect(retained).toBe(1);
    });
    const next=prepared("sequence-retention-next-key","d".repeat(64),2);
    await stub.submitBatch(submission([next]),{
      last_committed_seq_no:1,
      last_hlc_physical_ms:first.sale.hlc.physical_ms,
      last_hlc_logical:first.sale.hlc.logical,
      last_resolved_seq_no:1,
      last_resolved_hlc_physical_ms:first.sale.hlc.physical_ms,
      last_resolved_hlc_logical:first.sale.hlc.logical,
      terminal_failures:[]
    });
    await runInDO(stub,async (_instance:any,state:any) => {
      const retained=state.storage.sql.exec(
        "SELECT COUNT(*) AS count FROM terminal_sequence_seen WHERE seq_no=1"
      ).toArray()[0]!.count;
      expect(retained).toBe(0);
    });
  });
});
