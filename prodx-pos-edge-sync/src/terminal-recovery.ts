import { createHash } from "node:crypto";
import { Client } from "pg";
import { MAX_TERMINAL_CHECKPOINT_FAILURES, MAX_TERMINAL_FAILURE_LOOKUP } from "./contracts";
import type { QueueSale, TerminalCheckpoint, TerminalFailureCheckpoint, TerminalFailureLookup } from "./contracts";
import { canonicalize, sha256Hex, assertSaleShape } from "./canonical";
import { recoveryReplayOutcome } from "./recovery-outcome";

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
  outcome: "FAILED" | "RETRY" | "VOIDED" | "COMMITTED";
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

async function resolveAuthoritativeTerminalStoreId(
  client: Client,
  tenantId: string,
  terminalId: string,
  expectedStoreId?: string
): Promise<string> {
  if (expectedStoreId !== undefined && !UUID.test(expectedStoreId)) {
    throw new Error("TERMINAL_STORE_MAPPING_MISMATCH");
  }
  const mapped = await client.query<{ store_id: string }>(
    `SELECT DISTINCT d.store_id::text AS store_id
       FROM terminal_devices d
       JOIN pos_stores st
         ON st.tenant_id = d.tenant_id
        AND st.id = d.store_id
        AND st.active = true
      WHERE d.tenant_id = $1 AND d.terminal_id = $2`,
    [tenantId, terminalId]
  );
  if (mapped.rows.length !== 1) {
    throw new Error("TERMINAL_STORE_MAPPING_MISMATCH");
  }
  const resolvedStoreId = mapped.rows[0]!.store_id;
  if (expectedStoreId !== undefined && resolvedStoreId !== expectedStoreId) {
    throw new Error("TERMINAL_STORE_MAPPING_MISMATCH");
  }
  return resolvedStoreId;
}

/**
 * Read a bounded recovery checkpoint: active failures plus only historical failures
 * matching this request's idempotency keys or terminal sequence numbers. The caller
 * must already have set RLS context inside the same transaction as the terminal state read.
 */
export async function readTerminalCheckpoint(
  client: Client,
  tenantId: string,
  terminalId: string,
  authoritativeStoreId?: string,
  lookup: readonly TerminalFailureLookup[] = []
): Promise<TerminalCheckpoint> {
  if (lookup.length > MAX_TERMINAL_FAILURE_LOOKUP || lookup.some((item) =>
    (item.idempotency_key !== undefined &&
      (typeof item.idempotency_key !== "string" || item.idempotency_key.length < 16 || item.idempotency_key.length > 200)) ||
    !safeInteger(item.terminal_seq_no, 1)
  )) throw new Error("INVALID_TERMINAL_FAILURE_LOOKUP");
  const lookupKeys = [...new Set(lookup.flatMap((item) => item.idempotency_key ? [item.idempotency_key] : []))];
  const lookupSequences = [...new Set(lookup.map((item) => item.terminal_seq_no))];
  const stateResult = await client.query<{
    store_id: string;
    last_committed_seq_no: string;
    last_hlc_physical_ms: string;
    last_hlc_logical: number;
    last_resolved_seq_no: string;
    last_resolved_hlc_physical_ms: string;
    last_resolved_hlc_logical: number;
  }>(
    `SELECT store_id::text AS store_id,
            COALESCE(last_committed_seq_no,0)::text AS last_committed_seq_no,
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
  if (authoritativeStoreId !== undefined && state?.store_id && state.store_id !== authoritativeStoreId) {
    throw new Error("TERMINAL_STORE_MAPPING_MISMATCH");
  }
  const storeId = authoritativeStoreId
    ?? state?.store_id
    ?? (await resolveAuthoritativeTerminalStoreId(client, tenantId, terminalId));
  const failureResult = await client.query<{
    terminal_seq_no: string;
    sale_id: string;
    idempotency_key: string;
    receipt_id: string;
    payload_hash: string;
    failure_code: string;
    edge_received_at: string | null;
    store_id: string;
    do_name: string | null;
    sale_snapshot: QueueSale["sale"] | null;
    matched_sale_id: string | null;
    latest_disposition: string | null;
    latest_resolution_id: string | null;
    retry_failure_id: string | null;
    retry_failure_code: string | null;
  }>(
    `WITH candidate_ids AS MATERIALIZED (
       SELECT id FROM terminal_sequence_failures
        WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=$5::bigint + 1
       UNION
       SELECT id FROM terminal_sequence_failures
        WHERE tenant_id=$1 AND terminal_id=$2 AND idempotency_key=ANY($3::text[])
       UNION
       SELECT id FROM terminal_sequence_failures
        WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=ANY($4::bigint[])
     )
     SELECT f.terminal_seq_no::text AS terminal_seq_no,
            f.sale_id::text AS sale_id,
            f.idempotency_key,
            f.receipt_id::text AS receipt_id,
            f.payload_hash,
            COALESCE(rf.failure_code,f.failure_code) AS failure_code,
            f.failure_metadata->>'edge_received_at' AS edge_received_at,
            f.store_id::text AS store_id,
            f.failure_metadata->>'do_name' AS do_name,
            CASE WHEN s.sale_id IS NULL AND COALESCE(r.disposition,'') <> 'VOID'
                 THEN f.sale_snapshot ELSE NULL END AS sale_snapshot,
            s.sale_id::text AS matched_sale_id,
            r.disposition AS latest_disposition,
            r.resolution_id::text AS latest_resolution_id,
            rf.retry_failure_id::text AS retry_failure_id,
            rf.failure_code AS retry_failure_code
       FROM candidate_ids c
       JOIN terminal_sequence_failures f ON f.id=c.id
       LEFT JOIN LATERAL (
         SELECT resolution_id,disposition
           FROM terminal_sequence_resolutions
          WHERE failure_id=f.id
          ORDER BY created_at DESC,resolution_id DESC
          LIMIT 1
       ) r ON true
       LEFT JOIN LATERAL (
         SELECT retry_failure_id,failure_code
           FROM terminal_sequence_retry_failures
          WHERE failure_id=f.id AND resolution_id=r.resolution_id
          ORDER BY failed_at DESC,retry_failure_id DESC
          LIMIT 1
       ) rf ON true
       LEFT JOIN sales s
         ON s.tenant_id=f.tenant_id AND s.terminal_id=f.terminal_id
        AND s.terminal_seq_no=f.terminal_seq_no
      WHERE f.tenant_id=$1 AND f.terminal_id=$2
        AND (
          (f.terminal_seq_no=$5::bigint + 1 AND s.sale_id IS NULL AND COALESCE(r.disposition,'') <> 'VOID')
          OR f.idempotency_key=ANY($3::text[])
          OR f.terminal_seq_no=ANY($4::bigint[])
        )
      ORDER BY f.terminal_seq_no
      LIMIT $6`,
    [tenantId, terminalId, lookupKeys, lookupSequences,
      state?.last_resolved_seq_no ?? state?.last_committed_seq_no ?? "0",
      MAX_TERMINAL_CHECKPOINT_FAILURES + 1]
  );
  if (failureResult.rows.length > MAX_TERMINAL_CHECKPOINT_FAILURES) {
    throw new Error("TERMINAL_FAILURE_CHECKPOINT_LIMIT");
  }
  const failures: TerminalFailureCheckpoint[] = failureResult.rows.map((row) => {
    if (row.matched_sale_id && row.matched_sale_id !== row.sale_id) {
      throw new Error("TERMINAL_FAILURE_SALE_ID_CONFLICT");
    }
    const outcome: TerminalFailureCheckpoint["outcome"] = row.matched_sale_id
      ? "COMMITTED"
      : row.latest_disposition === "VOID"
        ? "VOIDED"
        : row.latest_disposition === "RETRY" && !row.retry_failure_id
          ? "RETRY"
          : "FAILED";
    if (!row.edge_received_at || !Number.isFinite(Date.parse(row.edge_received_at))) {
      throw new Error("TERMINAL_FAILURE_ORIGINAL_RECEIPT_TIME_MISSING");
    }
    return {
      tenant_id: tenantId,
      terminal_id: terminalId,
      store_id: row.store_id,
      do_name: row.do_name ?? undefined,
      terminal_seq_no: Number(row.terminal_seq_no),
      sale_id: row.sale_id,
      idempotency_key: row.idempotency_key,
      receipt_id: row.receipt_id,
      payload_hash: row.payload_hash.trim(),
      failure_code: row.failure_code,
      edge_received_at: row.edge_received_at,
      sale_snapshot: row.sale_snapshot,
      resolution_id: row.latest_resolution_id,
      outcome
    };
  });
  const checkpoint: TerminalCheckpoint = {
    store_id: storeId,
    last_committed_seq_no: Number(state?.last_committed_seq_no ?? 0),
    last_hlc_physical_ms: Number(state?.last_hlc_physical_ms ?? 0),
    last_hlc_logical: Number(state?.last_hlc_logical ?? 0),
    last_resolved_seq_no: Number(state?.last_resolved_seq_no ?? 0),
    last_resolved_hlc_physical_ms: Number(state?.last_resolved_hlc_physical_ms ?? 0),
    last_resolved_hlc_logical: Number(state?.last_resolved_hlc_logical ?? 0),
    terminal_failures: failures
  };
  if (!UUID.test(checkpoint.store_id) ||
      !safeInteger(checkpoint.last_committed_seq_no) ||
      !safeInteger(checkpoint.last_resolved_seq_no) ||
      checkpoint.last_resolved_seq_no < checkpoint.last_committed_seq_no ||
      !safeInteger(checkpoint.last_resolved_hlc_physical_ms) ||
      !safeInteger(checkpoint.last_resolved_hlc_logical)) {
    throw new Error("INVALID_ORIGIN_TERMINAL_CHECKPOINT");
  }
  return checkpoint;
}

export interface TerminalFailureHistoryItem {
  terminal_seq_no: number;
  sale_id: string;
  idempotency_key: string;
  receipt_id: string;
  payload_hash: string;
  failure_code: string;
  failed_at: string;
  outcome: TerminalFailureCheckpoint["outcome"];
  resolution_id: string | null;
  resolution_at: string | null;
  retry_failure_code: string | null;
}

export interface TerminalFailureHistoryPage {
  items: TerminalFailureHistoryItem[];
  has_more: boolean;
  next_cursor: string | null;
}

/** Stable keyset pagination over immutable terminal failure history. */
export async function readTerminalFailureHistoryPage(
  client: Client,
  tenantId: string,
  terminalId: string,
  afterSeqNo: number,
  limit: number
): Promise<TerminalFailureHistoryPage> {
  if (!UUID.test(tenantId) || !UUID.test(terminalId) || !safeInteger(afterSeqNo) ||
      !safeInteger(limit, 1) || limit > 100) {
    throw new Error("INVALID_TERMINAL_FAILURE_PAGE");
  }
  const result = await client.query<{
    terminal_seq_no: string; sale_id: string; idempotency_key: string; receipt_id: string;
    payload_hash: string; failure_code: string; failed_at: string; matched_sale_id: string | null;
    disposition: string | null; resolution_id: string | null; resolution_at: string | null;
    retry_failure_id: string | null; retry_failure_code: string | null;
  }>(
    `SELECT f.terminal_seq_no::text AS terminal_seq_no,
            f.sale_id::text AS sale_id,
            f.idempotency_key,
            f.receipt_id::text AS receipt_id,
            f.payload_hash,
            f.failure_code,
            f.failed_at::text AS failed_at,
            s.sale_id::text AS matched_sale_id,
            r.disposition,
            r.resolution_id::text AS resolution_id,
            r.created_at::text AS resolution_at,
            rf.retry_failure_id::text AS retry_failure_id,
            rf.failure_code AS retry_failure_code
       FROM terminal_sequence_failures f
       LEFT JOIN LATERAL (
         SELECT resolution_id,disposition,created_at
           FROM terminal_sequence_resolutions
          WHERE failure_id=f.id
          ORDER BY created_at DESC,resolution_id DESC
          LIMIT 1
       ) r ON true
       LEFT JOIN LATERAL (
         SELECT retry_failure_id,failure_code
           FROM terminal_sequence_retry_failures
          WHERE failure_id=f.id AND resolution_id=r.resolution_id
          ORDER BY failed_at DESC,retry_failure_id DESC
          LIMIT 1
       ) rf ON true
       LEFT JOIN sales s
         ON s.tenant_id=f.tenant_id AND s.terminal_id=f.terminal_id
        AND s.terminal_seq_no=f.terminal_seq_no
      WHERE f.tenant_id=$1 AND f.terminal_id=$2 AND f.terminal_seq_no>$3
      ORDER BY f.terminal_seq_no ASC
      LIMIT $4`,
    [tenantId,terminalId,afterSeqNo,limit+1]
  );
  const hasMore = result.rows.length > limit;
  const rows = result.rows.slice(0,limit);
  const items: TerminalFailureHistoryItem[] = rows.map((row) => ({
    terminal_seq_no: Number(row.terminal_seq_no),
    sale_id: row.sale_id,
    idempotency_key: row.idempotency_key,
    receipt_id: row.receipt_id,
    payload_hash: row.payload_hash.trim(),
    failure_code: row.failure_code,
    failed_at: row.failed_at,
    outcome: row.matched_sale_id ? "COMMITTED" : row.disposition === "VOID" ? "VOIDED" :
      row.disposition === "RETRY" && !row.retry_failure_id ? "RETRY" : "FAILED",
    resolution_id: row.resolution_id,
    resolution_at: row.resolution_at,
    retry_failure_code: row.retry_failure_code
  }));
  return {
    items,
    has_more: hasMore,
    next_cursor: hasMore && items.length ? String(items[items.length-1]!.terminal_seq_no) : null
  };
}

/**
 * Persist a permanent queue failure in PostgreSQL before the DO is marked failed.
 * The queue envelope is revalidated; only a contiguous next sequence can be recorded.
 */
async function recordRetryAttemptFailure(
  client: Client,
  message: QueueSale,
  failureId: string,
  resolutionId: string,
  failureCode: string
): Promise<void> {
  const inserted = await client.query<{ retry_failure_id: string }>(
    `INSERT INTO terminal_sequence_retry_failures
       (tenant_id,terminal_id,terminal_seq_no,failure_id,resolution_id,idempotency_key,
        receipt_id,payload_hash,failure_code,failure_metadata,failed_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())
     ON CONFLICT (resolution_id,receipt_id) DO NOTHING
     RETURNING retry_failure_id::text AS retry_failure_id`,
    [message.tenant_id,message.terminal_id,message.sale.terminal_seq_no,failureId,resolutionId,
     message.idempotency_key,message.receipt_id,message.payload_hash,failureCode,
     JSON.stringify({edge_received_at:message.edge_received_at,do_name:message.do_name})]
  );
  if (inserted.rowCount === 1) {
    await client.query(
      `INSERT INTO audit_logs
         (tenant_id,actor_type,actor_id,action,entity_type,entity_id,payload_hash,
          catalog_version,metadata,created_at)
       VALUES($1,'POS_TERMINAL',$2,'POS_TERMINAL_SEQUENCE_RETRY_FAILED',
              'TERMINAL_SEQUENCE_RETRY_FAILURE',$3,$4,NULL,$5::jsonb,now())`,
      [message.tenant_id,message.terminal_id,inserted.rows[0]!.retry_failure_id,
       message.payload_hash,JSON.stringify({
         terminal_id:message.terminal_id,
         terminal_seq_no:message.sale.terminal_seq_no,
         sale_id:message.sale.sale_id,
         idempotency_key:message.idempotency_key,
         receipt_id:message.receipt_id,
         resolution_id:resolutionId,
         failure_code:failureCode
       })]
    );
  }
}

export async function recordFailedSequence(
  env: Env,
  message: QueueSale,
  rawFailureCode: string
): Promise<"recorded" | "committed" | "voided" | "retry" | "retry_failed"> {
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
    const storeId = await resolveAuthoritativeTerminalStoreId(
      client,
      message.tenant_id,
      message.terminal_id,
      message.store_id
    );
    await client.query(
      `INSERT INTO terminal_sync_state(tenant_id,terminal_id,store_id)
       VALUES($1,$2,$3) ON CONFLICT (tenant_id,terminal_id) DO NOTHING`,
      [message.tenant_id, message.terminal_id, storeId]
    );
    const stateResult = await client.query<{
      store_id: string;
      last_resolved_seq_no: string;
    }>(
      `SELECT store_id::text AS store_id, last_resolved_seq_no::text AS last_resolved_seq_no
         FROM terminal_sync_state
        WHERE tenant_id=$1 AND terminal_id=$2
        FOR UPDATE`,
      [message.tenant_id, message.terminal_id]
    );
    const stateRow = stateResult.rows[0];
    if (!stateRow || stateRow.store_id !== storeId) {
      throw new Error("TERMINAL_STORE_MAPPING_MISMATCH");
    }
    const lastResolved = Number(stateRow.last_resolved_seq_no ?? 0);

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
        id: string; store_id: string; sale_id: string; idempotency_key: string; receipt_id: string;
        payload_hash: string; hlc_physical_ms: string; hlc_logical: number;
        failure_metadata: { edge_received_at?: string };
      }>(
        `SELECT id::text AS id,store_id::text AS store_id,sale_id::text AS sale_id,idempotency_key,receipt_id::text AS receipt_id,
                payload_hash,hlc_physical_ms::text AS hlc_physical_ms,hlc_logical,failure_metadata
           FROM terminal_sequence_failures
          WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=$3`,
        [message.tenant_id, message.terminal_id, message.sale.terminal_seq_no]
      );
      const prior = priorFailure.rows[0];
      if (prior && prior.store_id === storeId &&
          prior.sale_id === message.sale.sale_id &&
          prior.idempotency_key === message.idempotency_key &&
          prior.receipt_id === message.receipt_id &&
          prior.payload_hash.trim() === message.payload_hash &&
          Number(prior.hlc_physical_ms) === message.sale.hlc.physical_ms &&
          prior.hlc_logical === message.sale.hlc.logical &&
          prior.failure_metadata?.edge_received_at === message.edge_received_at) {
        const latest = await client.query<{ resolution_id: string; disposition: string }>(
          `SELECT resolution_id::text AS resolution_id,disposition
             FROM terminal_sequence_resolutions
            WHERE failure_id=$1
            ORDER BY created_at DESC,resolution_id DESC LIMIT 1`,
          [prior.id]
        );
        const current = latest.rows[0];
        if (current?.disposition === "RETRY" &&
            message.recovery_resolution_id === current.resolution_id) {
          await recordRetryAttemptFailure(client,message,prior.id,current.resolution_id,failureCode);
          await client.query("COMMIT");
          return "retry_failed";
        }
        await client.query("COMMIT");
        if (current?.disposition === "VOID") return "voided";
        if (current?.disposition === "RETRY") return "retry";
        // The DLQ consumer can safely replay this exact durable failure record.
        return "recorded";
      }
      throw new Error("TERMINAL_SEQUENCE_ALREADY_RESOLVED");
    }
    if (lastResolved !== message.sale.terminal_seq_no - 1) {
      throw new Error("TERMINAL_SEQUENCE_FAILURE_NOT_NEXT");
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO terminal_sequence_failures
         (tenant_id,terminal_id,store_id,terminal_seq_no,sale_id,idempotency_key,receipt_id,
          payload_hash,hlc_physical_ms,hlc_logical,failure_code,sale_snapshot,failure_metadata,failed_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,now())
       ON CONFLICT (tenant_id,terminal_id,terminal_seq_no) DO NOTHING
       RETURNING id::text AS id`,
      [message.tenant_id,message.terminal_id,storeId,message.sale.terminal_seq_no,message.sale.sale_id,
       message.idempotency_key,message.receipt_id,message.payload_hash,message.sale.hlc.physical_ms,
       message.sale.hlc.logical,failureCode,JSON.stringify(message.sale),JSON.stringify({
         edge_received_at: message.edge_received_at,
         do_name: message.do_name,
         store_id: storeId
       })]
    );
    const failure = await client.query<{
      id: string; store_id: string; sale_id: string; idempotency_key: string; receipt_id: string;
      payload_hash: string; hlc_physical_ms: string; hlc_logical: number;
      failure_metadata: { edge_received_at?: string };
    }>(
      `SELECT id::text AS id,store_id::text AS store_id,sale_id::text AS sale_id,idempotency_key,receipt_id::text AS receipt_id,
              payload_hash,hlc_physical_ms::text AS hlc_physical_ms,hlc_logical,failure_metadata
         FROM terminal_sequence_failures
        WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=$3`,
      [message.tenant_id,message.terminal_id,message.sale.terminal_seq_no]
    );
    const row = failure.rows[0];
    if (!row || row.store_id !== storeId || row.sale_id !== message.sale.sale_id ||
        row.idempotency_key !== message.idempotency_key ||
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
           store_id: storeId,
           terminal_seq_no: message.sale.terminal_seq_no,
           sale_id: message.sale.sale_id,
           idempotency_key: message.idempotency_key,
           receipt_id: message.receipt_id,
           failure_code: failureCode
         })]
      );
    }
    const latestResolution = await client.query<{ resolution_id: string; disposition: string }>(
      `SELECT resolution_id::text AS resolution_id,disposition
         FROM terminal_sequence_resolutions
        WHERE failure_id=$1
        ORDER BY created_at DESC,resolution_id DESC LIMIT 1`,
      [row.id]
    );
    const current = latestResolution.rows[0];
    if (current?.disposition === "RETRY" &&
        message.recovery_resolution_id === current.resolution_id) {
      await recordRetryAttemptFailure(client,message,row.id,current.resolution_id,failureCode);
      await client.query("COMMIT");
      return "retry_failed";
    }
    await client.query("COMMIT");
    if (current?.disposition === "VOID") return "voided";
    if (current?.disposition === "RETRY") return "retry";
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
    const scopeExists = await client.query(
      `SELECT 1 FROM terminal_sequence_failures
        WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=$3
       UNION ALL
       SELECT 1 FROM terminal_sequence_resolutions
        WHERE tenant_id=$1 AND request_id=$4
       LIMIT 1`,
      [input.tenantId,input.terminalId,input.terminalSeqNo,input.requestId]
    );
    if (!scopeExists.rowCount) {
      throw new Error("TERMINAL_SEQUENCE_FAILURE_NOT_FOUND");
    }
    const storeId = await resolveAuthoritativeTerminalStoreId(
      client,
      input.tenantId,
      input.terminalId
    );
    await client.query(
      `INSERT INTO terminal_sync_state(tenant_id,terminal_id,store_id)
       VALUES($1,$2,$3) ON CONFLICT (tenant_id,terminal_id) DO NOTHING`,
      [input.tenantId,input.terminalId,storeId]
    );
    const stateResult = await client.query<{
      store_id: string;
      last_resolved_seq_no: string;
    }>(
      `SELECT store_id::text AS store_id, last_resolved_seq_no::text AS last_resolved_seq_no
         FROM terminal_sync_state
        WHERE tenant_id=$1 AND terminal_id=$2
        FOR UPDATE`,
      [input.tenantId,input.terminalId]
    );
    const state = stateResult.rows[0];
    if (!state) throw new Error("TERMINAL_SEQUENCE_STATE_MISSING");
    if (state.store_id !== storeId) throw new Error("TERMINAL_STORE_MAPPING_MISMATCH");

    const priorRequest = await client.query<{
      resolution_id: string; terminal_id: string; terminal_seq_no: string;
      failure_id: string; idempotency_key: string; payload_hash: string;
      disposition: string; actor_subject: string; reason: string;
    }>(
      `SELECT resolution_id::text AS resolution_id,terminal_id::text AS terminal_id,
              terminal_seq_no::text AS terminal_seq_no,failure_id::text AS failure_id,
              idempotency_key,payload_hash,disposition,actor_subject,reason
         FROM terminal_sequence_resolutions
        WHERE tenant_id=$1 AND request_id=$2`,
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
      const checkpoint = await readTerminalCheckpoint(client,input.tenantId,input.terminalId,storeId,[{terminal_seq_no:input.terminalSeqNo}]);
      const currentFailure = checkpoint.terminal_failures.find((failure) =>
        failure.terminal_seq_no === input.terminalSeqNo
      );
      const outcome = recoveryReplayOutcome(
        prior.disposition as "RETRY" | "VOID",
        currentFailure?.outcome
      );
      await client.query("COMMIT");
      return { resolution_id: prior.resolution_id, outcome, checkpoint };
    }

    const failureResult = await client.query<{
      id: string; store_id: string; sale_id: string; idempotency_key: string; receipt_id: string;
      payload_hash: string; hlc_physical_ms: string; hlc_logical: number; failure_code: string;
    }>(
      `SELECT id::text AS id,store_id::text AS store_id,sale_id::text AS sale_id,idempotency_key,receipt_id::text AS receipt_id,
              payload_hash,hlc_physical_ms::text AS hlc_physical_ms,hlc_logical,failure_code
         FROM terminal_sequence_failures
        WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=$3`,
      [input.tenantId,input.terminalId,input.terminalSeqNo]
    );
    const failure = failureResult.rows[0];
    if (!failure) throw new Error("TERMINAL_SEQUENCE_FAILURE_NOT_FOUND");
    if (failure.store_id !== storeId) throw new Error("TERMINAL_STORE_MAPPING_MISMATCH");

    const saleAtSequence = await client.query<{ sale_id: string }>(
      `SELECT sale_id::text AS sale_id FROM sales
        WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=$3`,
      [input.tenantId,input.terminalId,input.terminalSeqNo]
    );
    if (saleAtSequence.rowCount) {
      if (saleAtSequence.rows[0]!.sale_id !== failure.sale_id) {
        throw new Error("TERMINAL_SEQUENCE_COMMIT_CONFLICT");
      }
      const checkpoint = await readTerminalCheckpoint(client,input.tenantId,input.terminalId,storeId,[{terminal_seq_no:input.terminalSeqNo}]);
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
      const checkpoint = await readTerminalCheckpoint(client,input.tenantId,input.terminalId,storeId,[{terminal_seq_no:input.terminalSeqNo}]);
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
         store_id: storeId,
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
    const checkpoint = await readTerminalCheckpoint(client,input.tenantId,input.terminalId,storeId,[{terminal_seq_no:input.terminalSeqNo}]);
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
