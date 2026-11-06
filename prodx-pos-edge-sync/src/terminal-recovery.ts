import { createHash } from "node:crypto";
import { Client } from "pg";
import type { QueueSale, TerminalCheckpoint, TerminalFailureCheckpoint } from "./contracts";
import { canonicalize, sha256Hex, assertSaleShape } from "./canonical";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;

export type FailedSequenceDisposition = "RETRY" | "VOID";

export interface TerminalSequenceRecoveryInput {
  tenantId: string;
  terminalId: string;
  terminalSeqNo: number;
  disposition: FailedSequenceDisposition;
  requestId: string;
  actorSubject: string;
  reason: string;
}

export interface TerminalSequenceRecoveryResult {
  resolution_id: string | null;
  outcome: "RETRY" | "VOIDED" | "COMMITTED";
  checkpoint: TerminalCheckpoint;
}

function actorUuidForSubject(tenantId: string, subject: string): string {
  const bytes = createHash("sha256")
    .update("prodx-pos:cloudflare-access-actor:v1:" + tenantId + ":" + subject)
    .digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x80; // UUIDv8: deterministic, tenant-scoped server surrogate.
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) +
    "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}

function safeInteger(value: unknown, min = 0): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min;
}

function normalizedFailureCode(value: string): string {
  const code = value.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 100);
  if (!code) throw new Error("INVALID_TERMINAL_FAILURE_CODE");
  return code;
}

/**
 * Read the authoritative origin checkpoint and all durable failed-sequence
 * outcomes for one tenant/terminal. The caller must already have set RLS context.
 */
export async function readTerminalCheckpoint(
  client: Client,
  tenantId: string,
  terminalId: string
): Promise<TerminalCheckpoint> {
  const stateResult = await client.query<{
    last_committed_seq_no: string;
    last_hlc_physical_ms: string;
    last_hlc_logical: number;
    last_resolved_seq_no: string;
    last_resolved_hlc_physical_ms: string;
    last_resolved_hlc_logical: number;
  }>(
    `SELECT COALESCE(last_committed_seq_no,0)::text AS last_committed_seq_no,
            COALESCE(last_hlc_physical_ms,0)::text AS last_hlc_physical_ms,
            COALESCE(last_hlc_logical,0) AS last_hlc_logical,
            COALESCE(last_resolved_seq_no,last_committed_seq_no,0)::text AS last_resolved_seq_no,
            COALESCE(last_resolved_hlc_physical_ms,last_hlc_physical_ms,0)::text AS last_resolved_hlc_physical_ms,
            COALESCE(last_resolved_hlc_logical,last_hlc_logical,0) AS last_resolved_hlc_logical
       FROM terminal_sync_state
      WHERE tenant_id=$1 AND terminal_id=$2`,
    [tenantId, terminalId]
  );
  const state = stateResult.rows[0];
  const failureResult = await client.query<{
    terminal_seq_no: string;
    sale_id: string;
    idempotency_key: string;
    receipt_id: string;
    payload_hash: string;
    failure_code: string;
    edge_received_at: string | null;
    matched_sale_id: string | null;
    latest_disposition: string | null;
  }>(
    `SELECT f.terminal_seq_no::text AS terminal_seq_no,
            f.sale_id::text AS sale_id,
            f.idempotency_key,
            f.receipt_id::text AS receipt_id,
            f.payload_hash,
            f.failure_code,
            f.failure_metadata->>'edge_received_at' AS edge_received_at,
            s.sale_id::text AS matched_sale_id,
            r.disposition AS latest_disposition
       FROM terminal_sequence_failures f
       LEFT JOIN LATERAL (
         SELECT disposition
           FROM terminal_sequence_resolutions
          WHERE failure_id=f.id
          ORDER BY created_at DESC,resolution_id DESC
          LIMIT 1
       ) r ON true
       LEFT JOIN sales s
         ON s.tenant_id=f.tenant_id AND s.terminal_id=f.terminal_id
        AND s.terminal_seq_no=f.terminal_seq_no
      WHERE f.tenant_id=$1 AND f.terminal_id=$2
      ORDER BY f.terminal_seq_no
      LIMIT 5001`,
    [tenantId, terminalId]
  );
  if (failureResult.rows.length > 5000) throw new Error("TERMINAL_FAILURE_RECONCILIATION_LIMIT");
  const failures: TerminalFailureCheckpoint[] = failureResult.rows.map((row) => {
    if (row.matched_sale_id && row.matched_sale_id !== row.sale_id) {
      throw new Error("TERMINAL_FAILURE_SALE_ID_CONFLICT");
    }
    const outcome: TerminalFailureCheckpoint["outcome"] = row.matched_sale_id
      ? "COMMITTED"
      : row.latest_disposition === "VOID"
        ? "VOIDED"
        : row.latest_disposition === "RETRY"
          ? "RETRY"
          : "FAILED";
    if (!row.edge_received_at || !Number.isFinite(Date.parse(row.edge_received_at))) {
      throw new Error("TERMINAL_FAILURE_ORIGINAL_RECEIPT_TIME_MISSING");
    }
    return {
      terminal_seq_no: Number(row.terminal_seq_no),
      sale_id: row.sale_id,
      idempotency_key: row.idempotency_key,
      receipt_id: row.receipt_id,
      payload_hash: row.payload_hash.trim(),
      failure_code: row.failure_code,
      edge_received_at: row.edge_received_at,
      outcome
    };
  });
  const checkpoint: TerminalCheckpoint = {
    last_committed_seq_no: Number(state?.last_committed_seq_no ?? 0),
    last_hlc_physical_ms: Number(state?.last_hlc_physical_ms ?? 0),
    last_hlc_logical: Number(state?.last_hlc_logical ?? 0),
    last_resolved_seq_no: Number(state?.last_resolved_seq_no ?? 0),
    last_resolved_hlc_physical_ms: Number(state?.last_resolved_hlc_physical_ms ?? 0),
    last_resolved_hlc_logical: Number(state?.last_resolved_hlc_logical ?? 0),
    terminal_failures: failures
  };
  if (!safeInteger(checkpoint.last_committed_seq_no) ||
      !safeInteger(checkpoint.last_resolved_seq_no) ||
      checkpoint.last_resolved_seq_no < checkpoint.last_committed_seq_no ||
      !safeInteger(checkpoint.last_resolved_hlc_physical_ms) ||
      !safeInteger(checkpoint.last_resolved_hlc_logical)) {
    throw new Error("INVALID_ORIGIN_TERMINAL_CHECKPOINT");
  }
  return checkpoint;
}

/**
 * Persist a permanent queue failure in PostgreSQL before the DO is marked failed.
 * The queue envelope is revalidated; only a contiguous next sequence can be recorded.
 */
export async function recordFailedSequence(
  env: Env,
  message: QueueSale,
  rawFailureCode: string
): Promise<"recorded" | "committed" | "voided"> {
  if (!UUID.test(message.tenant_id) || !UUID.test(message.terminal_id) ||
      !UUID.test(message.receipt_id) || message.idempotency_key !== message.sale?.idempotency_key ||
      !HASH.test(message.payload_hash) || message.sale?.payload_hash !== message.payload_hash) {
    throw new Error("INVALID_TERMINAL_FAILURE_ENVELOPE");
  }
  try {
    assertSaleShape(message.sale);
  } catch {
    throw new Error("INVALID_TERMINAL_FAILURE_SALE");
  }
  if (!safeInteger(message.sale.terminal_seq_no, 1) || !UUID.test(message.sale.sale_id) ||
      !safeInteger(message.sale.hlc?.physical_ms) || !safeInteger(message.sale.hlc?.logical) ||
      typeof message.sale.idempotency_key !== "string" ||
      message.sale.idempotency_key.length < 16 || message.sale.idempotency_key.length > 200) {
    throw new Error("INVALID_TERMINAL_FAILURE_SEQUENCE");
  }
  const { payload_hash: _claimed, ...hashableSale } = message.sale;
  const computedHash = await sha256Hex(canonicalize({
    tenant_id: message.tenant_id,
    terminal_id: message.terminal_id,
    sale: hashableSale
  }));
  if (computedHash !== message.payload_hash) throw new Error("TERMINAL_FAILURE_PAYLOAD_HASH_MISMATCH");
  const failureCode = normalizedFailureCode(rawFailureCode);
  const client = new Client({ connectionString: env.HYPERDRIVE_DIRECT.connectionString });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id',$1,true)", [message.tenant_id]);
    await client.query(
      `INSERT INTO terminal_sync_state(tenant_id,terminal_id)
       VALUES($1,$2) ON CONFLICT (tenant_id,terminal_id) DO NOTHING`,
      [message.tenant_id, message.terminal_id]
    );
    const stateResult = await client.query<{
      last_resolved_seq_no: string;
    }>(
      `SELECT last_resolved_seq_no::text AS last_resolved_seq_no
         FROM terminal_sync_state
        WHERE tenant_id=$1 AND terminal_id=$2
        FOR UPDATE`,
      [message.tenant_id, message.terminal_id]
    );
    const lastResolved = Number(stateResult.rows[0]?.last_resolved_seq_no ?? 0);

    const saleAtSequence = await client.query<{ sale_id: string }>(
      `SELECT sale_id::text AS sale_id FROM sales
        WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=$3`,
      [message.tenant_id, message.terminal_id, message.sale.terminal_seq_no]
    );
    if (saleAtSequence.rowCount) {
      if (saleAtSequence.rows[0]!.sale_id !== message.sale.sale_id) {
        throw new Error("TERMINAL_SEQUENCE_ALREADY_OWNED");
      }
      const committed = await client.query<{ payload_hash: string; sale_id: string; status: string }>(
        `SELECT payload_hash,sale_id::text AS sale_id,status
           FROM pos_idempotency WHERE tenant_id=$1 AND idempotency_key=$2`,
        [message.tenant_id, message.idempotency_key]
      );
      if (committed.rows[0]?.payload_hash === message.payload_hash &&
          committed.rows[0]?.sale_id === message.sale.sale_id &&
          committed.rows[0]?.status === "COMMITTED") {
        await client.query("COMMIT");
        return "committed";
      }
      throw new Error("TERMINAL_SEQUENCE_COMMIT_CONFLICT");
    }

    const priorKey = await client.query<{ payload_hash: string; sale_id: string; status: string }>(
      `SELECT payload_hash,sale_id::text AS sale_id,status
         FROM pos_idempotency WHERE tenant_id=$1 AND idempotency_key=$2`,
      [message.tenant_id, message.idempotency_key]
    );
    if (priorKey.rowCount) {
      if (priorKey.rows[0]!.payload_hash === message.payload_hash &&
          priorKey.rows[0]!.sale_id === message.sale.sale_id &&
          priorKey.rows[0]!.status === "COMMITTED") {
        await client.query("COMMIT");
        return "committed";
      }
      throw new Error("TERMINAL_FAILURE_IDEMPOTENCY_CONFLICT");
    }

    if (lastResolved >= message.sale.terminal_seq_no) {
      const priorFailure = await client.query<{
        id: string; sale_id: string; idempotency_key: string; payload_hash: string;
      }>(
        `SELECT id::text AS id,sale_id::text AS sale_id,idempotency_key,payload_hash
           FROM terminal_sequence_failures
          WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=$3
          FOR UPDATE`,
        [message.tenant_id, message.terminal_id, message.sale.terminal_seq_no]
      );
      if (priorFailure.rowCount &&
          priorFailure.rows[0]!.sale_id === message.sale.sale_id &&
          priorFailure.rows[0]!.idempotency_key === message.idempotency_key &&
          priorFailure.rows[0]!.payload_hash.trim() === message.payload_hash) {
        const voided = await client.query(
          `SELECT 1 FROM terminal_sequence_resolutions
            WHERE failure_id=$1 AND disposition='VOID' LIMIT 1`,
          [priorFailure.rows[0]!.id]
        );
        if (voided.rowCount) {
          await client.query("COMMIT");
          return "voided";
        }
      }
      throw new Error("TERMINAL_SEQUENCE_ALREADY_RESOLVED");
    }
    if (lastResolved !== message.sale.terminal_seq_no - 1) {
      throw new Error("TERMINAL_SEQUENCE_FAILURE_NOT_NEXT");
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO terminal_sequence_failures
         (tenant_id,terminal_id,terminal_seq_no,sale_id,idempotency_key,receipt_id,
          payload_hash,hlc_physical_ms,hlc_logical,failure_code,failure_metadata,failed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now())
       ON CONFLICT (tenant_id,terminal_id,terminal_seq_no) DO NOTHING
       RETURNING id::text AS id`,
      [message.tenant_id,message.terminal_id,message.sale.terminal_seq_no,message.sale.sale_id,
       message.idempotency_key,message.receipt_id,message.payload_hash,message.sale.hlc.physical_ms,
       message.sale.hlc.logical,failureCode,JSON.stringify({
         edge_received_at: message.edge_received_at,
         do_name: message.do_name
       })]
    );
    const failure = await client.query<{
      id: string; sale_id: string; idempotency_key: string; receipt_id: string;
      payload_hash: string; hlc_physical_ms: string; hlc_logical: number;
      failure_metadata: { edge_received_at?: string };
    }>(
      `SELECT id::text AS id,sale_id::text AS sale_id,idempotency_key,receipt_id::text AS receipt_id,
              payload_hash,hlc_physical_ms::text AS hlc_physical_ms,hlc_logical,failure_metadata
         FROM terminal_sequence_failures
        WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=$3
        FOR UPDATE`,
      [message.tenant_id,message.terminal_id,message.sale.terminal_seq_no]
    );
    const row = failure.rows[0];
    if (!row || row.sale_id !== message.sale.sale_id || row.idempotency_key !== message.idempotency_key ||
        row.receipt_id !== message.receipt_id || row.payload_hash.trim() !== message.payload_hash ||
        Number(row.hlc_physical_ms) !== message.sale.hlc.physical_ms ||
        row.hlc_logical !== message.sale.hlc.logical ||
        row.failure_metadata?.edge_received_at !== message.edge_received_at) {
      throw new Error("TERMINAL_SEQUENCE_FAILURE_CONFLICT");
    }
    if (inserted.rowCount === 1) {
      await client.query(
        `INSERT INTO audit_logs
           (tenant_id,actor_type,actor_id,action,entity_type,entity_id,payload_hash,
            catalog_version,metadata,created_at)
         VALUES($1,'POS_TERMINAL',$2,'POS_TERMINAL_SEQUENCE_FAILED',
                'TERMINAL_SEQUENCE_FAILURE',$3,$4,$5,$6::jsonb,now())`,
        [message.tenant_id,message.terminal_id,row.id,message.payload_hash,message.sale.catalog_version,
         JSON.stringify({
           terminal_id: message.terminal_id,
           terminal_seq_no: message.sale.terminal_seq_no,
           sale_id: message.sale.sale_id,
           idempotency_key: message.idempotency_key,
           receipt_id: message.receipt_id,
           failure_code: failureCode
         })]
      );
    }
    await client.query("COMMIT");
    return "recorded";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function resolveFailedSequence(
  env: Env,
  input: TerminalSequenceRecoveryInput
): Promise<TerminalSequenceRecoveryResult> {
  if (!UUID.test(input.tenantId) || !UUID.test(input.terminalId) || !UUID.test(input.requestId) ||
      !safeInteger(input.terminalSeqNo, 1) || !input.actorSubject.trim() ||
      input.actorSubject.length > 255 || !input.reason.trim() || input.reason.trim().length > 1000 ||
      (input.disposition !== "RETRY" && input.disposition !== "VOID")) {
    throw new Error("INVALID_TERMINAL_SEQUENCE_RECOVERY_REQUEST");
  }
  const reason = input.reason.trim();
  const actorSubject = input.actorSubject.trim();
  const actorId = actorUuidForSubject(input.tenantId, actorSubject);
  const client = new Client({ connectionString: env.HYPERDRIVE_DIRECT.connectionString });
  try {
    await client.connect();
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_tenant_id',$1,true)", [input.tenantId]);
    await client.query(
      `INSERT INTO terminal_sync_state(tenant_id,terminal_id)
       VALUES($1,$2) ON CONFLICT (tenant_id,terminal_id) DO NOTHING`,
      [input.tenantId,input.terminalId]
    );
    const stateResult = await client.query<{
      last_resolved_seq_no: string;
    }>(
      `SELECT last_resolved_seq_no::text AS last_resolved_seq_no
         FROM terminal_sync_state
        WHERE tenant_id=$1 AND terminal_id=$2
        FOR UPDATE`,
      [input.tenantId,input.terminalId]
    );
    const state = stateResult.rows[0];
    if (!state) throw new Error("TERMINAL_SEQUENCE_STATE_MISSING");

    const priorRequest = await client.query<{
      resolution_id: string; terminal_id: string; terminal_seq_no: string;
      failure_id: string; idempotency_key: string; payload_hash: string;
      disposition: string; actor_subject: string; reason: string;
    }>(
      `SELECT resolution_id::text AS resolution_id,terminal_id::text AS terminal_id,
              terminal_seq_no::text AS terminal_seq_no,failure_id::text AS failure_id,
              idempotency_key,payload_hash,disposition,actor_subject,reason
         FROM terminal_sequence_resolutions
        WHERE tenant_id=$1 AND request_id=$2
        FOR UPDATE`,
      [input.tenantId,input.requestId]
    );
    if (priorRequest.rowCount) {
      const prior = priorRequest.rows[0]!;
      if (prior.terminal_id !== input.terminalId ||
          Number(prior.terminal_seq_no) !== input.terminalSeqNo ||
          prior.disposition !== input.disposition ||
          prior.actor_subject !== actorSubject || prior.reason !== reason) {
        throw new Error("TERMINAL_SEQUENCE_RECOVERY_REQUEST_ID_CONFLICT");
      }
      const checkpoint = await readTerminalCheckpoint(client,input.tenantId,input.terminalId);
      const currentFailure = checkpoint.terminal_failures.find((failure) =>
        failure.terminal_seq_no === input.terminalSeqNo
      );
      const outcome: TerminalSequenceRecoveryResult["outcome"] =
        currentFailure?.outcome === "COMMITTED" ? "COMMITTED" :
        currentFailure?.outcome === "VOIDED" ? "VOIDED" :
        prior.disposition === "VOID" ? "VOIDED" : "RETRY";
      await client.query("COMMIT");
      return { resolution_id: prior.resolution_id, outcome, checkpoint };
    }

    const failureResult = await client.query<{
      id: string; sale_id: string; idempotency_key: string; receipt_id: string;
      payload_hash: string; hlc_physical_ms: string; hlc_logical: number; failure_code: string;
    }>(
      `SELECT id::text AS id,sale_id::text AS sale_id,idempotency_key,receipt_id::text AS receipt_id,
              payload_hash,hlc_physical_ms::text AS hlc_physical_ms,hlc_logical,failure_code
         FROM terminal_sequence_failures
        WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=$3
        FOR UPDATE`,
      [input.tenantId,input.terminalId,input.terminalSeqNo]
    );
    const failure = failureResult.rows[0];
    if (!failure) throw new Error("TERMINAL_SEQUENCE_FAILURE_NOT_FOUND");

    const saleAtSequence = await client.query<{ sale_id: string }>(
      `SELECT sale_id::text AS sale_id FROM sales
        WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=$3`,
      [input.tenantId,input.terminalId,input.terminalSeqNo]
    );
    if (saleAtSequence.rowCount) {
      if (saleAtSequence.rows[0]!.sale_id !== failure.sale_id) {
        throw new Error("TERMINAL_SEQUENCE_COMMIT_CONFLICT");
      }
      const checkpoint = await readTerminalCheckpoint(client,input.tenantId,input.terminalId);
      await client.query("COMMIT");
      return { resolution_id: null, outcome: "COMMITTED", checkpoint };
    }

    const latest = await client.query<{ disposition: string }>(
      `SELECT disposition FROM terminal_sequence_resolutions
        WHERE failure_id=$1
        ORDER BY created_at DESC,resolution_id DESC
        LIMIT 1`,
      [failure.id]
    );
    if (latest.rows[0]?.disposition === "VOID") {
      if (input.disposition !== "VOID") throw new Error("TERMINAL_SEQUENCE_ALREADY_VOIDED");
      const checkpoint = await readTerminalCheckpoint(client,input.tenantId,input.terminalId);
      await client.query("COMMIT");
      return { resolution_id: null, outcome: "VOIDED", checkpoint };
    }
    const lastResolved = Number(state.last_resolved_seq_no);
    if (lastResolved !== input.terminalSeqNo - 1) {
      throw new Error(lastResolved >= input.terminalSeqNo
        ? "TERMINAL_SEQUENCE_ALREADY_RESOLVED"
        : "TERMINAL_SEQUENCE_RECOVERY_NOT_NEXT");
    }

    const inserted = await client.query<{ resolution_id: string }>(
      `INSERT INTO terminal_sequence_resolutions
         (tenant_id,terminal_id,terminal_seq_no,failure_id,idempotency_key,payload_hash,
          disposition,request_id,actor_id,actor_subject,reason,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
       RETURNING resolution_id::text AS resolution_id`,
      [input.tenantId,input.terminalId,input.terminalSeqNo,failure.id,failure.idempotency_key,
       failure.payload_hash.trim(),input.disposition,input.requestId,actorId,actorSubject,reason]
    );
    const resolutionId = inserted.rows[0]!.resolution_id;
    if (input.disposition === "VOID") {
      await client.query(
        `UPDATE terminal_sync_state
            SET last_resolved_seq_no=$3,
                last_resolved_hlc_physical_ms=CASE
                  WHEN (last_resolved_hlc_physical_ms,last_resolved_hlc_logical) < ($4::bigint,$5::integer)
                  THEN $4 ELSE last_resolved_hlc_physical_ms END,
                last_resolved_hlc_logical=CASE
                  WHEN (last_resolved_hlc_physical_ms,last_resolved_hlc_logical) < ($4::bigint,$5::integer)
                  THEN $5 ELSE last_resolved_hlc_logical END,
                updated_at=now()
          WHERE tenant_id=$1 AND terminal_id=$2`,
        [input.tenantId,input.terminalId,input.terminalSeqNo,
         Number(failure.hlc_physical_ms),failure.hlc_logical]
      );
    }
    await client.query(
      `INSERT INTO audit_logs
         (tenant_id,actor_type,actor_id,action,entity_type,entity_id,payload_hash,
          catalog_version,metadata,created_at)
       VALUES($1,'POS_SYNC_RECOVERY_OPERATOR',$2,$3,'TERMINAL_SEQUENCE_FAILURE',$4,$5,NULL,$6::jsonb,now())`,
      [input.tenantId,actorId,
       input.disposition === "VOID" ? "POS_TERMINAL_SEQUENCE_VOIDED" : "POS_TERMINAL_SEQUENCE_RETRY_AUTHORIZED",
       failure.id,failure.payload_hash.trim(),JSON.stringify({
         terminal_id: input.terminalId,
         terminal_seq_no: input.terminalSeqNo,
         sale_id: failure.sale_id,
         idempotency_key: failure.idempotency_key,
         receipt_id: failure.receipt_id,
         failure_code: failure.failure_code,
         disposition: input.disposition,
         request_id: input.requestId,
         resolution_id: resolutionId,
         actor_subject: actorSubject,
         reason
       })]
    );
    const checkpoint = await readTerminalCheckpoint(client,input.tenantId,input.terminalId);
    await client.query("COMMIT");
    return {
      resolution_id: resolutionId,
      outcome: input.disposition === "VOID" ? "VOIDED" : "RETRY",
      checkpoint
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}
