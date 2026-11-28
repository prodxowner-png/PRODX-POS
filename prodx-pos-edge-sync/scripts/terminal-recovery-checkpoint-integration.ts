import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { assertDisposableCiDatabasePair } from "./test-database-guard.js";
import { readTerminalCheckpoint, readTerminalFailureHistoryPage } from "../src/terminal-recovery.js";

const { adminUrl, runtimeUrl } = assertDisposableCiDatabasePair(
  process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
  process.env.RUNTIME_DATABASE_URL,
  "terminal-recovery-checkpoint-integration.ts",
);

const tenantId = randomUUID();
const terminalId = randomUUID();
const storeId = randomUUID();
const actorId = randomUUID();
const productId = randomUUID();
const fingerprint = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 32);
const payloadHash = "a".repeat(64);
const activeSequence = 5002;
const historicalKey = `terminal-checkpoint-5000-${tenantId}`;
const doName = `${tenantId}:${terminalId}`;
const receivedAt = new Date().toISOString();
const admin = new Client({ connectionString: adminUrl });
const runtime = new Client({ connectionString: runtimeUrl });
let adminConnected = false;
let adminInTransaction = false;
let runtimeConnected = false;
let runtimeInTransaction = false;
let stage = "connect-admin";

try {
  await admin.connect();
  adminConnected = true;
  await admin.query("SET statement_timeout = '60000ms'");
  await admin.query("SET lock_timeout = '15000ms'");
  await admin.query("BEGIN");
  adminInTransaction = true;
  stage = "seed-tenant-store-terminal";
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)", [tenantId]);
  await admin.query(
    `INSERT INTO pos_stores(id,tenant_id,name,is_default,active)
     VALUES($1,$2,'Bounded checkpoint CI fixture',true,true)`, [storeId,tenantId]
  );
  await admin.query(
    `INSERT INTO terminal_devices(tenant_id,terminal_id,store_id,cert_fingerprint_sha256,active)
     VALUES($1,$2,$3,$4,true)`, [tenantId,terminalId,storeId,fingerprint]
  );
  await admin.query(
    `INSERT INTO terminal_sync_state
       (tenant_id,terminal_id,store_id,last_resolved_seq_no,last_resolved_hlc_physical_ms,last_resolved_hlc_logical)
     VALUES($1,$2,$3,5001,5001,0)`, [tenantId,terminalId,storeId]
  );

  // 5,001 historical VOID outcomes plus one active failure. The active receipt
  // has a valid immutable snapshot so cold-restore remains possible.
  stage = "seed-5002-failures";
  await admin.query(
    `WITH sequence_rows AS (
       SELECT seq,
              gen_random_uuid() AS sale_id,
              gen_random_uuid() AS receipt_id,
              'terminal-checkpoint-' || seq::text || '-' || $1::uuid::text AS idempotency_key
         FROM generate_series(1,5002) AS g(seq)
     )
     INSERT INTO terminal_sequence_failures
       (tenant_id,terminal_id,store_id,terminal_seq_no,sale_id,idempotency_key,receipt_id,
        payload_hash,hlc_physical_ms,hlc_logical,failure_code,sale_snapshot,failure_metadata,failed_at)
     SELECT $1::uuid,$2::uuid,$3::uuid,seq,sale_id,idempotency_key,receipt_id,$4::text,seq,0,'SYNTHETIC_CI_FAILURE',
       CASE WHEN seq=5002 THEN jsonb_build_object(
         'idempotency_key',idempotency_key,'payload_hash',$4::text,'sale_id',sale_id::text,
         'terminal_seq_no',seq,'hlc',jsonb_build_object('physical_ms',seq,'logical',0),
         'catalog_version',1,'signed_price_proofs',jsonb_build_array(jsonb_build_object(
           'algorithm','HMAC-SHA256','catalog_version',1,'issued_at',$5::text,
           'expires_at',(($5::text)::timestamptz + interval '1 day')::text,'product_id',$6::uuid::text,
           'unit_price_minor',100,'tax_bps',700,'signature',repeat('b',64)
         )),
         'client_recorded_at',$5::text,'currency','THB',
         'lines',jsonb_build_array(jsonb_build_object('product_id',$6::uuid::text,'quantity',1,'unit_price_minor',100,'tax_bps',700))
       ) ELSE NULL END,
       jsonb_build_object('edge_received_at',$5::text,'do_name',$7::text,'store_id',$3::uuid::text),now()
       FROM sequence_rows`,
    [tenantId,terminalId,storeId,payloadHash,receivedAt,productId,doName]
  );

  stage = "seed-5001-resolutions";
  await admin.query(
    `INSERT INTO terminal_sequence_resolutions
       (tenant_id,terminal_id,terminal_seq_no,failure_id,idempotency_key,payload_hash,
        disposition,request_id,actor_id,actor_subject,reason,created_at)
     SELECT f.tenant_id,f.terminal_id,f.terminal_seq_no,f.id,f.idempotency_key,f.payload_hash,
            'VOID',gen_random_uuid(),$3,'ci-terminal-checkpoint',
            'Synthetic append-only history fixture for bounded pagination',now()
       FROM terminal_sequence_failures f
      WHERE f.tenant_id=$1 AND f.terminal_id=$2 AND f.terminal_seq_no<=5001`,
    [tenantId,terminalId,actorId]
  );
  stage = "seed-5001-audit-events";
  await admin.query(
    `INSERT INTO audit_logs
       (tenant_id,actor_type,actor_id,action,entity_type,entity_id,payload_hash,catalog_version,metadata,created_at)
     SELECT f.tenant_id,'POS_SYNC_RECOVERY_OPERATOR',$3,'POS_TERMINAL_SEQUENCE_VOIDED',
            'TERMINAL_SEQUENCE_FAILURE',f.id,f.payload_hash,NULL,
            jsonb_build_object('terminal_id',f.terminal_id,'terminal_seq_no',f.terminal_seq_no,
              'idempotency_key',f.idempotency_key,'resolution_id',r.resolution_id::text,'ci_fixture',true),now()
       FROM terminal_sequence_failures f
       JOIN terminal_sequence_resolutions r
         ON r.tenant_id=f.tenant_id AND r.terminal_id=f.terminal_id
        AND r.terminal_seq_no=f.terminal_seq_no AND r.failure_id=f.id AND r.disposition='VOID'
      WHERE f.tenant_id=$1 AND f.terminal_id=$2 AND f.terminal_seq_no<=5001`,
    [tenantId,terminalId,actorId]
  );
  stage = "commit-fixtures";
  await admin.query("COMMIT");
  adminInTransaction = false;
  stage = "analyze-fixtures";
  await admin.query("ANALYZE terminal_sequence_failures");
  await admin.query("ANALYZE terminal_sequence_resolutions");
  await admin.query("ANALYZE terminal_sequence_retry_failures");
  console.log("FIXTURE_READY: 5,002 failure rows, 5,001 immutable VOID resolutions and audit events committed.");

  stage = "connect-runtime";
  await runtime.connect();
  runtimeConnected = true;
  await runtime.query("SET statement_timeout = '60000ms'");
  await runtime.query("SET lock_timeout = '15000ms'");
  await runtime.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
  runtimeInTransaction = true;
  await runtime.query("SELECT set_config('app.current_tenant_id',$1,true)", [tenantId]);

  stage = "targeted-history-checkpoint";
  const byHistoricalKey = await readTerminalCheckpoint(runtime,tenantId,terminalId,storeId,[
    { idempotency_key: historicalKey, terminal_seq_no: 7000 }
  ]);
  if (byHistoricalKey.terminal_failures.length !== 2 ||
      !byHistoricalKey.terminal_failures.some((row) => row.terminal_seq_no === 5000 && row.outcome === "VOIDED") ||
      !byHistoricalKey.terminal_failures.some((row) => row.terminal_seq_no === activeSequence && row.outcome === "FAILED")) {
    throw new Error("BOUNDED_CHECKPOINT_HISTORICAL_KEY_LOOKUP_FAILED");
  }

  stage = "active-only-checkpoint";
  const activeOnly = await readTerminalCheckpoint(runtime,tenantId,terminalId,storeId);
  if (activeOnly.terminal_failures.length !== 1 || activeOnly.terminal_failures[0]?.terminal_seq_no !== activeSequence) {
    throw new Error("BOUNDED_CHECKPOINT_TRANSFERRED_HISTORICAL_ROWS");
  }
  console.log("CHECKPOINT_READY: historical key lookup and active-only checkpoint both returned bounded rows.");

  stage = "history-keyset-pagination";
  const firstPage = await readTerminalFailureHistoryPage(runtime,tenantId,terminalId,4998,2);
  const secondPage = await readTerminalFailureHistoryPage(runtime,tenantId,terminalId,Number(firstPage.next_cursor),2);
  if (firstPage.items.map((row) => row.terminal_seq_no).join(",") !== "4999,5000" ||
      !firstPage.has_more || firstPage.next_cursor !== "5000" ||
      secondPage.items.map((row) => row.terminal_seq_no).join(",") !== "5001,5002" ||
      secondPage.has_more || secondPage.next_cursor !== null) {
    throw new Error("TERMINAL_FAILURE_KEYSET_PAGINATION_ASSERTION_FAILED");
  }

  await runtime.query("COMMIT");
  runtimeInTransaction = false;
  console.log("PASS: 5,001 historical failures + one active failure; checkpoint returned only active + targeted history under NOBYPASSRLS; stable keyset pages verified.");
} catch (error) {
  if (runtimeConnected && runtimeInTransaction) await runtime.query("ROLLBACK").catch(() => undefined);
  if (adminConnected && adminInTransaction) await admin.query("ROLLBACK").catch(() => undefined);
  console.error("terminal_recovery_checkpoint_integration_failed", {
    stage,
    error_name: error instanceof Error ? error.name : "UNKNOWN",
    error_message: error instanceof Error ? error.message : String(error)
  });
  throw error;
} finally {
  if (runtimeConnected) await runtime.end().catch(() => undefined);
  if (adminConnected) await admin.end().catch(() => undefined);
}
