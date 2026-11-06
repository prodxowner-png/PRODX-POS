import { DurableObject } from "cloudflare:workers";
import type {
  IdempotencyBatchResult, IdempotencyResultItem, IdempotencySubmission, QueueSale, TerminalCheckpoint
} from "./contracts";

const IDEMPOTENCY_RETENTION_MS = 30 * 86400_000;
const MAX_OUT_OF_ORDER_SEQUENCES = 1000;
const MAX_SEQUENCE_AHEAD = 10_000;

export class IdempotencyGate extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS idempotency (
        idempotency_key TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        terminal_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        canonical_payload TEXT NOT NULL,
        receipt_id TEXT NOT NULL,
        queue_payload TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('ENQUEUE_PENDING','QUEUED','COMMITTED','VOIDED')),
        failure_code TEXT,
        delivery_attempts INTEGER NOT NULL DEFAULT 0,
        next_retry_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_idempotency_pending ON idempotency(state, created_at);
      CREATE INDEX IF NOT EXISTS idx_idempotency_retention ON idempotency(state, updated_at);
      CREATE TABLE IF NOT EXISTS terminal_sequence_state (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        last_contiguous_seq_no INTEGER NOT NULL DEFAULT 0,
        last_hlc_physical_ms INTEGER NOT NULL DEFAULT 0,
        last_hlc_logical INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO terminal_sequence_state(singleton) VALUES (1);
      CREATE TABLE IF NOT EXISTS terminal_sequence_seen (
        seq_no INTEGER PRIMARY KEY, sale_id TEXT NOT NULL, seen_at TEXT NOT NULL,
        hlc_physical_ms INTEGER NOT NULL DEFAULT 0, hlc_logical INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS terminal_sequence_gaps (
        gap_from_seq_no INTEGER NOT NULL, gap_to_seq_no INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED')),
        detected_at TEXT NOT NULL, resolved_at TEXT,
        PRIMARY KEY(gap_from_seq_no, gap_to_seq_no)
      );
      CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const idempotencyColumns = this.ctx.storage.sql.exec<{name:string}>(`PRAGMA table_info(idempotency)`).toArray().map((column)=>column.name);
    if (!idempotencyColumns.includes("failure_code")) this.ctx.storage.sql.exec(`ALTER TABLE idempotency ADD COLUMN failure_code TEXT`);
    if (!idempotencyColumns.includes("delivery_attempts")) this.ctx.storage.sql.exec(`ALTER TABLE idempotency ADD COLUMN delivery_attempts INTEGER NOT NULL DEFAULT 0`);
    if (!idempotencyColumns.includes("next_retry_at")) this.ctx.storage.sql.exec(`ALTER TABLE idempotency ADD COLUMN next_retry_at TEXT`);
    const idempotencyTableSql = this.ctx.storage.sql.exec<{sql:string}>(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='idempotency'`
    ).toArray()[0]?.sql ?? "";
    if (!idempotencyTableSql.includes("'VOIDED'")) {
      // Existing DO databases have a CHECK constraint that predates VOIDED.
      // Rebuild the local cache table once; never translate a void into COMMITTED.
      this.ctx.storage.sql.exec(`
        DROP INDEX IF EXISTS idx_idempotency_pending;
        DROP INDEX IF EXISTS idx_idempotency_retention;
        DROP INDEX IF EXISTS idx_idempotency_retry;
        ALTER TABLE idempotency RENAME TO idempotency_before_voided;
        CREATE TABLE idempotency (
          idempotency_key TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          terminal_id TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          canonical_payload TEXT NOT NULL,
          receipt_id TEXT NOT NULL,
          queue_payload TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('ENQUEUE_PENDING','QUEUED','COMMITTED','VOIDED')),
          failure_code TEXT,
          delivery_attempts INTEGER NOT NULL DEFAULT 0,
          next_retry_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO idempotency
          (idempotency_key,tenant_id,terminal_id,payload_hash,canonical_payload,receipt_id,
           queue_payload,state,failure_code,delivery_attempts,next_retry_at,created_at,updated_at)
        SELECT idempotency_key,tenant_id,terminal_id,payload_hash,canonical_payload,receipt_id,
               queue_payload,state,failure_code,delivery_attempts,next_retry_at,created_at,updated_at
          FROM idempotency_before_voided;
        DROP TABLE idempotency_before_voided;
      `);
    }
    this.ctx.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_idempotency_pending ON idempotency(state, created_at);
      CREATE INDEX IF NOT EXISTS idx_idempotency_retention ON idempotency(state, updated_at);
      CREATE INDEX IF NOT EXISTS idx_idempotency_retry ON idempotency(state,next_retry_at);
    `);
    // Old QUEUED rows predate next_retry_at; re-enqueue them once after upgrade.
    this.ctx.storage.sql.exec(
      `UPDATE idempotency SET next_retry_at=? WHERE state='QUEUED' AND next_retry_at IS NULL AND failure_code IS NULL`,
      new Date(Date.now()-1_000).toISOString()
    );

    // One-time backfill for Durable Objects upgraded from the previous release.
    // Preserve accepted sequence numbers before enabling strict gap/HLC checks.
    const backfill = this.ctx.storage.sql.exec<{ value: string }>(
      `SELECT value FROM schema_meta WHERE key='sequence_backfill_v1'`
    ).toArray()[0];
    if (!backfill) {
      const rows = this.ctx.storage.sql.exec<{ queue_payload: string; updated_at: string }>(
        `SELECT queue_payload,updated_at FROM idempotency ORDER BY created_at`
      ).toArray();
      for (const row of rows) {
        try {
          const queued = JSON.parse(row.queue_payload) as QueueSale;
          const sale = queued.sale;
          if (Number.isSafeInteger(sale?.terminal_seq_no) && sale.terminal_seq_no > 0 && typeof sale.sale_id === "string") {
            this.ctx.storage.sql.exec(
              `INSERT OR IGNORE INTO terminal_sequence_seen
               (seq_no,sale_id,seen_at,hlc_physical_ms,hlc_logical) VALUES (?,?,?,?,?)`,
              sale.terminal_seq_no, sale.sale_id, row.updated_at,
              sale.hlc?.physical_ms ?? 0, sale.hlc?.logical ?? 0
            );
          }
        } catch { /* Keep malformed legacy outbox rows visible to recovery/operations. */ }
      }
      const seen = this.ctx.storage.sql.exec<{ seq_no: number }>(
        `SELECT seq_no FROM terminal_sequence_seen ORDER BY seq_no`
      ).toArray();
      let highestSeen = 0;
      const now = new Date().toISOString();
      for (const item of seen) {
        if (item.seq_no > highestSeen + 1) {
          this.ctx.storage.sql.exec(
            `INSERT OR IGNORE INTO terminal_sequence_gaps
             (gap_from_seq_no,gap_to_seq_no,status,detected_at) VALUES (?,?,'OPEN',?)`,
            highestSeen + 1, item.seq_no - 1, now
          );
        }
        highestSeen = Math.max(highestSeen, item.seq_no);
      }
      let contiguous = 0;
      let lastPhysical = 0;
      let lastLogical = 0;
      while (true) {
        const next = this.ctx.storage.sql.exec<{
          hlc_physical_ms: number; hlc_logical: number;
        }>(`SELECT hlc_physical_ms,hlc_logical FROM terminal_sequence_seen WHERE seq_no=?`, contiguous + 1).toArray()[0];
        if (!next) break;
        if (next.hlc_physical_ms < lastPhysical ||
            (next.hlc_physical_ms === lastPhysical && next.hlc_logical < lastLogical)) break;
        contiguous++;
        lastPhysical = next.hlc_physical_ms;
        lastLogical = next.hlc_logical;
      }
      this.trimResolvedGaps(contiguous, now);
      this.ctx.storage.sql.exec(
        `UPDATE terminal_sequence_state SET last_contiguous_seq_no=?,last_hlc_physical_ms=?,last_hlc_logical=? WHERE singleton=1`,
        contiguous, lastPhysical, lastLogical
      );
      this.ctx.storage.sql.exec(`INSERT INTO schema_meta(key,value) VALUES('sequence_backfill_v1','complete')`);
      this.pruneStorage(Date.now());
    }
  }

  private pruneStorage(now = Date.now()): void {
    const cutoff = new Date(now - IDEMPOTENCY_RETENTION_MS).toISOString();
    // PostgreSQL is the permanent idempotency authority. Expire only committed
    // receipt cache rows. Sequence ownership is retained until the PostgreSQL
    // checkpoint explicitly confirms the corresponding sequence numbers.
    // Failed receipts remain durable until an explicit origin-side resolution exists.
    this.ctx.storage.sql.exec(
      `DELETE FROM idempotency WHERE state='COMMITTED' AND updated_at < ?`,cutoff
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM terminal_sequence_gaps WHERE status='CLOSED' AND resolved_at < ?`,cutoff
    );
  }

  private reconcileOriginCheckpoint(checkpoint:TerminalCheckpoint,now:string):void {
    if (!Number.isSafeInteger(checkpoint.last_committed_seq_no) || checkpoint.last_committed_seq_no < 0 ||
        !Number.isSafeInteger(checkpoint.last_hlc_physical_ms) || checkpoint.last_hlc_physical_ms < 0 ||
        !Number.isSafeInteger(checkpoint.last_hlc_logical) || checkpoint.last_hlc_logical < 0 ||
        checkpoint.last_hlc_logical > 2147483647 ||
        !Number.isSafeInteger(checkpoint.last_resolved_seq_no) || checkpoint.last_resolved_seq_no < checkpoint.last_committed_seq_no ||
        !Number.isSafeInteger(checkpoint.last_resolved_hlc_physical_ms) || checkpoint.last_resolved_hlc_physical_ms < 0 ||
        !Number.isSafeInteger(checkpoint.last_resolved_hlc_logical) || checkpoint.last_resolved_hlc_logical < 0 ||
        checkpoint.last_resolved_hlc_logical > 2147483647 ||
        !Array.isArray(checkpoint.terminal_failures) || checkpoint.terminal_failures.length > 5000) {
      throw new Error("INVALID_ORIGIN_TERMINAL_CHECKPOINT");
    }
    const local=this.ctx.storage.sql.exec<{
      last_contiguous_seq_no:number;last_hlc_physical_ms:number;last_hlc_logical:number;
    }>(`SELECT last_contiguous_seq_no,last_hlc_physical_ms,last_hlc_logical
       FROM terminal_sequence_state WHERE singleton=1`).toArray()[0];
    if (!local) throw new Error("TERMINAL_SEQUENCE_STATE_MISSING");
    if (checkpoint.last_resolved_seq_no > local.last_contiguous_seq_no) {
      // PostgreSQL is the permanent authority after DO restore/recreation. A VOID
      // advances only the resolved checkpoint; it never becomes a committed sale.
      this.ctx.storage.sql.exec(
        `UPDATE terminal_sequence_state SET last_contiguous_seq_no=?,last_hlc_physical_ms=?,last_hlc_logical=?
         WHERE singleton=1`,
        checkpoint.last_resolved_seq_no,checkpoint.last_resolved_hlc_physical_ms,checkpoint.last_resolved_hlc_logical
      );
      this.ctx.storage.sql.exec(
        `UPDATE terminal_sequence_gaps SET status='CLOSED',resolved_at=?
         WHERE status='OPEN' AND gap_to_seq_no<=?`,now,checkpoint.last_resolved_seq_no
      );
      this.ctx.storage.sql.exec(
        `UPDATE terminal_sequence_gaps SET gap_from_seq_no=?
         WHERE status='OPEN' AND gap_from_seq_no<=? AND gap_to_seq_no>?`,
        checkpoint.last_resolved_seq_no+1,checkpoint.last_resolved_seq_no,checkpoint.last_resolved_seq_no
      );
    } else if (checkpoint.last_resolved_seq_no === local.last_contiguous_seq_no &&
      (checkpoint.last_resolved_hlc_physical_ms !== local.last_hlc_physical_ms ||
       checkpoint.last_resolved_hlc_logical !== local.last_hlc_logical)) {
      this.ctx.storage.sql.exec(
        `UPDATE terminal_sequence_state SET last_hlc_physical_ms=?,last_hlc_logical=? WHERE singleton=1`,
        checkpoint.last_resolved_hlc_physical_ms,checkpoint.last_resolved_hlc_logical
      );
    }
    // Remove only sequence claims the origin has authoritatively resolved.
    this.ctx.storage.sql.exec(
      `DELETE FROM terminal_sequence_seen WHERE seq_no<=?`,checkpoint.last_resolved_seq_no
    );

    for (const failure of checkpoint.terminal_failures) {
      if (!Number.isSafeInteger(failure.terminal_seq_no) || failure.terminal_seq_no < 1 ||
          !/^[0-9a-f-]{36}$/i.test(failure.sale_id) ||
          !/^[0-9a-f-]{36}$/i.test(failure.receipt_id) ||
          typeof failure.idempotency_key !== "string" ||
          failure.idempotency_key.length < 16 || failure.idempotency_key.length > 200 ||
          !/^[0-9a-f]{64}$/i.test(failure.payload_hash) ||
          (failure.resolution_id !== null && !/^[0-9a-f-]{36}$/i.test(failure.resolution_id)) ||
          (failure.outcome === "RETRY" && !failure.resolution_id) ||
          !["FAILED","RETRY","VOIDED","COMMITTED"].includes(failure.outcome)) {
        throw new Error("INVALID_ORIGIN_TERMINAL_FAILURE_RECORD");
      }
      const row=this.ctx.storage.sql.exec<{
        payload_hash:string;queue_payload:string;state:string;
      }>(`SELECT payload_hash,queue_payload,state FROM idempotency
         WHERE idempotency_key=?`,failure.idempotency_key).toArray()[0];
      if (!row) continue; // A restored DO may not have the old receipt cache.
      let queued:QueueSale;
      try { queued=JSON.parse(row.queue_payload) as QueueSale; }
      catch { throw new Error("ORIGIN_TERMINAL_FAILURE_OUTBOX_CORRUPT"); }
      if (row.payload_hash !== failure.payload_hash ||
          queued.sale?.sale_id !== failure.sale_id ||
          queued.sale?.terminal_seq_no !== failure.terminal_seq_no ||
          queued.receipt_id !== failure.receipt_id ||
          queued.edge_received_at !== failure.edge_received_at) {
        throw new Error("ORIGIN_TERMINAL_FAILURE_OUTBOX_MISMATCH");
      }
      if (failure.outcome === "FAILED") {
        if (row.state === "COMMITTED" || row.state === "VOIDED") {
          throw new Error("ORIGIN_FAILURE_OUTCOME_CONFLICT");
        }
        if (failure.resolution_id) {
          queued.recovery_resolution_id = failure.resolution_id;
          this.ctx.storage.sql.exec(
            `UPDATE idempotency SET queue_payload=?,failure_code=?,next_retry_at=NULL,updated_at=?
             WHERE idempotency_key=?`,
            JSON.stringify(queued),failure.failure_code,new Date(now).toISOString(),failure.idempotency_key
          );
        } else {
          this.ctx.storage.sql.exec(
            `UPDATE idempotency SET failure_code=?,next_retry_at=NULL,updated_at=? WHERE idempotency_key=?`,
            failure.failure_code,new Date(now).toISOString(),failure.idempotency_key
          );
        }
      } else if (failure.outcome === "RETRY") {
        if (row.state === "COMMITTED" || row.state === "VOIDED") {
          throw new Error("ORIGIN_RETRY_OUTCOME_CONFLICT");
        }
        queued.recovery_resolution_id = failure.resolution_id!;
        this.ctx.storage.sql.exec(
          `UPDATE idempotency SET queue_payload=?,state='ENQUEUE_PENDING',failure_code=NULL,next_retry_at=NULL,updated_at=?
           WHERE idempotency_key=?`,
          JSON.stringify(queued),new Date(now).toISOString(),failure.idempotency_key
        );
      } else if (failure.outcome === "VOIDED") {
        if (row.state === "COMMITTED") throw new Error("ORIGIN_VOID_COMMITTED_CONFLICT");
        this.ctx.storage.sql.exec(
          `UPDATE idempotency SET state='VOIDED',failure_code=NULL,next_retry_at=NULL,updated_at=?
           WHERE idempotency_key=?`,
          new Date(now).toISOString(),failure.idempotency_key
        );
      } else {
        if (row.state === "VOIDED") throw new Error("ORIGIN_COMMIT_VOID_CONFLICT");
        this.ctx.storage.sql.exec(
          `UPDATE idempotency SET state='COMMITTED',failure_code=NULL,next_retry_at=NULL,updated_at=?
           WHERE idempotency_key=?`,
          new Date(now).toISOString(),failure.idempotency_key
        );
      }
    }
  }

  async applyOriginCheckpoint(checkpoint:TerminalCheckpoint):Promise<void>{
    const now=new Date().toISOString();
    this.ctx.storage.transactionSync(()=>this.reconcileOriginCheckpoint(checkpoint,now));
    await this.flushPending();
  }

  private trimResolvedGaps(contiguous: number, now: string): void {
    const gaps = this.ctx.storage.sql.exec<{
      gap_from_seq_no: number; gap_to_seq_no: number; detected_at: string;
    }>(`SELECT gap_from_seq_no,gap_to_seq_no,detected_at FROM terminal_sequence_gaps WHERE status='OPEN'`).toArray();
    for (const gap of gaps) {
      if (gap.gap_from_seq_no <= contiguous && gap.gap_to_seq_no > contiguous) {
        this.ctx.storage.sql.exec(
          `DELETE FROM terminal_sequence_gaps WHERE gap_from_seq_no=? AND gap_to_seq_no=?`,
          gap.gap_from_seq_no, gap.gap_to_seq_no
        );
        this.ctx.storage.sql.exec(
          `INSERT OR IGNORE INTO terminal_sequence_gaps
           (gap_from_seq_no,gap_to_seq_no,status,detected_at) VALUES (?,?,'OPEN',?)`,
          contiguous + 1, gap.gap_to_seq_no, gap.detected_at
        );
      } else if (gap.gap_to_seq_no <= contiguous) {
        this.ctx.storage.sql.exec(
          `UPDATE terminal_sequence_gaps SET status='CLOSED',resolved_at=?
           WHERE gap_from_seq_no=? AND gap_to_seq_no=?`,
          now, gap.gap_from_seq_no, gap.gap_to_seq_no
        );
      }
    }
  }

  async submitBatch(input: IdempotencySubmission, originCheckpoint?: TerminalCheckpoint): Promise<IdempotencyBatchResult> {
    if (input.sales.length < 1 || input.sales.length > 50) throw new Error("INVALID_BATCH_SIZE");

    // Arm recovery before persisting the outbox. A crash after the SQLite commit
    // but before Queue delivery is recovered by alarm().
    await this.ctx.storage.setAlarm(Date.now() + 30_000);
    const now = new Date().toISOString();

    const result = this.ctx.storage.transactionSync(() => {
      if (originCheckpoint) this.reconcileOriginCheckpoint(originCheckpoint,now);
      const originFailures = originCheckpoint?.terminal_failures ?? [];
      // First pass: validate all known keys and origin failure ownership before any write.
      for (const item of input.sales) {
        const prior = this.ctx.storage.sql.exec<{ payload_hash: string; failure_code: string | null }>(
          `SELECT payload_hash,failure_code FROM idempotency WHERE idempotency_key=?`, item.sale.idempotency_key
        ).toArray()[0];
        if (prior && prior.payload_hash !== item.payloadHash) throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
        const originFailure = originFailures.find((failure) =>
          failure.idempotency_key === item.sale.idempotency_key ||
          failure.terminal_seq_no === item.sale.terminal_seq_no
        );
        if (originFailure && (originFailure.idempotency_key !== item.sale.idempotency_key ||
            originFailure.payload_hash !== item.payloadHash ||
            originFailure.sale_id !== item.sale.sale_id ||
            originFailure.terminal_seq_no !== item.sale.terminal_seq_no)) {
          throw new Error("TERMINAL_SEQUENCE_ALREADY_OWNED");
        }
        if (prior?.failure_code || originFailure?.outcome === "FAILED") {
          throw new Error("IDEMPOTENCY_PREVIOUSLY_FAILED");
        }
      }

      const sequenceState = this.ctx.storage.sql.exec<{
        last_contiguous_seq_no: number; last_hlc_physical_ms: number; last_hlc_logical: number;
      }>(`SELECT last_contiguous_seq_no,last_hlc_physical_ms,last_hlc_logical
           FROM terminal_sequence_state WHERE singleton=1`).toArray()[0]!;
      const failedRows = this.ctx.storage.sql.exec<{queue_payload:string}>(
        `SELECT queue_payload FROM idempotency
         WHERE failure_code IS NOT NULL`
      ).toArray();
      const failedSequences = failedRows.map((row) => {
        try {
          const sequence = (JSON.parse(row.queue_payload) as QueueSale).sale.terminal_seq_no;
          if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error();
          return sequence;
        } catch {
          throw new Error("TERMINAL_SEQUENCE_BLOCKED_BY_UNPARSEABLE_FAILED_RECEIPT");
        }
      });
      const originResolvedSeq = originCheckpoint?.last_resolved_seq_no ?? 0;
      const sorted = [...input.sales].sort((a, b) => a.sale.terminal_seq_no - b.sale.terminal_seq_no);
      const batchKeys = new Map<string, string>();
      const newSequences = new Set<number>();
      for (const item of sorted) {
        const key = item.sale.idempotency_key;
        const inBatchHash = batchKeys.get(key);
        if (inBatchHash !== undefined) {
          if (inBatchHash !== item.payloadHash) throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
          throw new Error("INVALID_DUPLICATE_IDEMPOTENCY_KEY_IN_BATCH");
        }
        batchKeys.set(key, item.payloadHash);
        const existingKey = this.ctx.storage.sql.exec<{ idempotency_key: string }>(
          `SELECT idempotency_key FROM idempotency WHERE idempotency_key=?`, key
        ).toArray()[0];
        if (existingKey) continue;
        const seq = item.sale.terminal_seq_no;
        const originFailure = originFailures.find((failure) => failure.terminal_seq_no === seq);
        if (originFailure) {
          if (originFailure.idempotency_key !== key || originFailure.payload_hash !== item.payloadHash ||
              originFailure.sale_id !== item.sale.sale_id) {
            throw new Error("TERMINAL_SEQUENCE_ALREADY_OWNED");
          }
          if (originFailure.outcome === "FAILED") throw new Error("TERMINAL_SEQUENCE_BLOCKED_BY_FAILED_RECEIPT");
          if (originFailure.outcome === "VOIDED" || originFailure.outcome === "COMMITTED") continue;
          if (originFailure.outcome === "RETRY") {
            const priorSeq = this.ctx.storage.sql.exec<{ sale_id:string }>(
              `SELECT sale_id FROM terminal_sequence_seen WHERE seq_no=?`,seq
            ).toArray()[0];
            if (priorSeq && priorSeq.sale_id !== item.sale.sale_id) throw new Error("INVALID_TERMINAL_SEQUENCE_REUSE");
            if (!priorSeq) {
              if (seq <= sequenceState.last_contiguous_seq_no) throw new Error("TERMINAL_SEQUENCE_RETRY_OWNERSHIP_MISSING");
              newSequences.add(seq);
            }
            if (item.sale.hlc.physical_ms > Date.now() + 300_000) throw new Error("INVALID_HLC_FUTURE_CLOCK");
            continue;
          }
        }
        if (failedSequences.some((failedSeq) => failedSeq > originResolvedSeq && failedSeq <= seq) ||
            originFailures.some((failure) =>
              (failure.outcome === "FAILED" || failure.outcome === "RETRY") &&
              failure.terminal_seq_no > originResolvedSeq && failure.terminal_seq_no < seq
            )) {
          throw new Error("TERMINAL_SEQUENCE_BLOCKED_BY_FAILED_RECEIPT");
        }
        if (newSequences.has(seq)) throw new Error("INVALID_DUPLICATE_TERMINAL_SEQUENCE");
        newSequences.add(seq);
        if (item.sale.hlc.physical_ms > Date.now() + 300_000) throw new Error("INVALID_HLC_FUTURE_CLOCK");
      }

      const outOfOrderCount = this.ctx.storage.sql.exec<{ count:number }>(
        `SELECT COUNT(*) AS count FROM terminal_sequence_seen WHERE seq_no > ?`,
        sequenceState.last_contiguous_seq_no
      ).toArray()[0]?.count ?? 0;
      const newOutOfOrderCount = [...newSequences].filter((seq) => seq > sequenceState.last_contiguous_seq_no).length;
      if (outOfOrderCount + newOutOfOrderCount > MAX_OUT_OF_ORDER_SEQUENCES) throw new Error("TERMINAL_OUT_OF_ORDER_WINDOW_FULL");
      if ([...newSequences].some((seq) => seq > sequenceState.last_contiguous_seq_no + MAX_SEQUENCE_AHEAD)) {
        throw new Error("TERMINAL_SEQUENCE_AHEAD_LIMIT");
      }

      const seenHigh = this.ctx.storage.sql.exec<{ high: number }>(
        `SELECT COALESCE(MAX(seq_no),0) AS high FROM terminal_sequence_seen`
      ).toArray()[0]?.high ?? sequenceState.last_contiguous_seq_no;
      let observedHigh = Math.max(seenHigh, sequenceState.last_contiguous_seq_no);

      // Record newly accepted sequences. Origin-resolved historical failures
      // (VOIDED/COMMITTED) and already-seen RETRY sequences never claim a new slot.
      for (const item of sorted) {
        const existingKey = this.ctx.storage.sql.exec<{ idempotency_key: string }>(
          `SELECT idempotency_key FROM idempotency WHERE idempotency_key=?`, item.sale.idempotency_key
        ).toArray()[0];
        if (existingKey) continue;
        const seq = item.sale.terminal_seq_no;
        const originFailure = originFailures.find((failure) => failure.terminal_seq_no === seq);
        if (originFailure && (originFailure.outcome === "VOIDED" || originFailure.outcome === "COMMITTED")) continue;
        if (originFailure?.outcome === "RETRY") {
          const priorSeq = this.ctx.storage.sql.exec<{ sale_id: string }>(
            `SELECT sale_id FROM terminal_sequence_seen WHERE seq_no=?`,seq
          ).toArray()[0];
          if (priorSeq) {
            if (priorSeq.sale_id !== item.sale.sale_id) throw new Error("INVALID_TERMINAL_SEQUENCE_REUSE");
            continue;
          }
        }
        if (seq <= sequenceState.last_contiguous_seq_no) {
          if (seq <= originResolvedSeq) continue;
          throw new Error("TERMINAL_SEQUENCE_ALREADY_ACCEPTED");
        }
        const priorSeq = this.ctx.storage.sql.exec<{ sale_id: string }>(
          `SELECT sale_id FROM terminal_sequence_seen WHERE seq_no=?`, seq
        ).toArray()[0];
        if (priorSeq) throw new Error("INVALID_TERMINAL_SEQUENCE_REUSE");
        if (seq > observedHigh + 1) {
          this.ctx.storage.sql.exec(
            `INSERT OR IGNORE INTO terminal_sequence_gaps
             (gap_from_seq_no,gap_to_seq_no,status,detected_at) VALUES (?,?,'OPEN',?)`,
            observedHigh + 1, seq - 1, now
          );
        }
        this.ctx.storage.sql.exec(
          `INSERT INTO terminal_sequence_seen
           (seq_no,sale_id,seen_at,hlc_physical_ms,hlc_logical) VALUES (?,?,?,?,?)`,
          seq, item.sale.sale_id, now, item.sale.hlc.physical_ms, item.sale.hlc.logical
        );
        observedHigh = Math.max(observedHigh, seq);
      }

      // Advance only the contiguous prefix. Out-of-order future HLC values must
      // not prevent a missing earlier sequence from arriving and closing a gap.
      let contiguous = sequenceState.last_contiguous_seq_no;
      let lastPhysical = sequenceState.last_hlc_physical_ms;
      let lastLogical = sequenceState.last_hlc_logical;
      while (true) {
        const next = this.ctx.storage.sql.exec<{
          hlc_physical_ms: number; hlc_logical: number;
        }>(`SELECT hlc_physical_ms,hlc_logical FROM terminal_sequence_seen WHERE seq_no=?`, contiguous + 1).toArray()[0];
        if (!next) break;
        if (next.hlc_physical_ms < lastPhysical ||
            (next.hlc_physical_ms === lastPhysical && next.hlc_logical < lastLogical)) {
          throw new Error("INVALID_HLC_REGRESSION");
        }
        contiguous++;
        lastPhysical = next.hlc_physical_ms;
        lastLogical = next.hlc_logical;
      }
      this.trimResolvedGaps(contiguous, now);
      this.ctx.storage.sql.exec(
        `UPDATE terminal_sequence_state SET last_contiguous_seq_no=?,last_hlc_physical_ms=?,last_hlc_logical=? WHERE singleton=1`,
        contiguous, lastPhysical, lastLogical
      );
      const openGaps = this.ctx.storage.sql.exec<{ gap_from_seq_no: number; gap_to_seq_no: number }>(
        `SELECT gap_from_seq_no,gap_to_seq_no FROM terminal_sequence_gaps WHERE status='OPEN' ORDER BY gap_from_seq_no`
      ).toArray().map((gap) => ({ from_seq_no: gap.gap_from_seq_no, to_seq_no: gap.gap_to_seq_no }));

      this.pruneStorage(Date.now());
      const output: IdempotencyResultItem[] = [];
      for (const item of input.sales) {
        const originFailure = originFailures.find((failure) => failure.terminal_seq_no === item.sale.terminal_seq_no);
        const prior = this.ctx.storage.sql.exec<{ state: string; receipt_id: string }>(
          `SELECT state,receipt_id FROM idempotency WHERE idempotency_key=?`, item.sale.idempotency_key
        ).toArray()[0];
        const receiptId = prior?.receipt_id ?? originFailure?.receipt_id ?? item.receiptId;
        const queueMessage: QueueSale = {
          tenant_id: input.tenantId, terminal_id: input.terminalId,
          idempotency_key: item.sale.idempotency_key, payload_hash: item.payloadHash,
          do_name: input.doName, sale: item.sale,
          edge_received_at: originFailure?.edge_received_at ?? item.edgeReceivedAt, receipt_id: receiptId
        };
        if (!prior) {
          if (originFailure && (originFailure.outcome === "VOIDED" || originFailure.outcome === "COMMITTED")) {
            const state = originFailure.outcome === "VOIDED" ? "VOIDED" : "COMMITTED";
            this.ctx.storage.sql.exec(
              `INSERT INTO idempotency
               (idempotency_key,tenant_id,terminal_id,payload_hash,canonical_payload,receipt_id,
                queue_payload,state,failure_code,delivery_attempts,next_retry_at,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?, ?,NULL,0,NULL,?,?)`,
              item.sale.idempotency_key,input.tenantId,input.terminalId,item.payloadHash,
              "",receiptId,JSON.stringify(queueMessage),state,now,now
            );
            output.push({
              idempotency_key:item.sale.idempotency_key,
              status:state === "VOIDED" ? "voided" : "committed",
              receipt_id:receiptId,payload_hash:item.payloadHash
            });
          } else {
            const failureCode = originFailure?.outcome === "FAILED" ? originFailure.failure_code : null;
            this.ctx.storage.sql.exec(
              `INSERT INTO idempotency
               (idempotency_key,tenant_id,terminal_id,payload_hash,canonical_payload,receipt_id,
                queue_payload,state,failure_code,delivery_attempts,next_retry_at,created_at,updated_at)
               VALUES (?,?,?,?,?,?,?,'ENQUEUE_PENDING',?,0,NULL,?,?)`,
              item.sale.idempotency_key,input.tenantId,input.terminalId,item.payloadHash,
              "",receiptId,JSON.stringify(queueMessage),failureCode,now,now
            );
            output.push({ idempotency_key:item.sale.idempotency_key,status:"accepted",receipt_id:receiptId,payload_hash:item.payloadHash });
          }
        } else {
          output.push({
            idempotency_key:item.sale.idempotency_key,
            status:prior.state === "VOIDED" ? "voided" : prior.state === "COMMITTED" ? "committed" : "duplicate",
            receipt_id:receiptId,payload_hash:item.payloadHash
          });
        }
      }
      return {
        results:output,
        sequence_gaps:openGaps,
        last_contiguous_seq_no:contiguous,
        last_hlc:{physical_ms:lastPhysical,logical:lastLogical}
      };
    });

    await this.flushPending();
    return result;
  }

  private async flushPending(): Promise<void> {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const rows = this.ctx.storage.sql.exec<{
      idempotency_key:string;queue_payload:string;state:string;delivery_attempts:number;
    }>(`SELECT idempotency_key,queue_payload,state,delivery_attempts FROM idempotency
       WHERE failure_code IS NULL AND (
         state='ENQUEUE_PENDING' OR (state='QUEUED' AND next_retry_at IS NOT NULL AND next_retry_at<=?)
       ) ORDER BY CASE WHEN state='ENQUEUE_PENDING' THEN 0 ELSE 1 END,created_at LIMIT 50`,now).toArray();
    if (rows.length === 0) return;

    // Queue sendBatch has both a message-count and aggregate-byte ceiling.
    const chunks: Array<Array<{idempotency_key:string;body:QueueSale;attempts:number}>> = [];
    let current: Array<{idempotency_key:string;body:QueueSale;attempts:number}> = [];
    let currentBytes = 0;
    for (const row of rows) {
      const body = JSON.parse(row.queue_payload) as QueueSale;
      const bytes = new TextEncoder().encode(JSON.stringify({body})).byteLength + 64;
      if (bytes > 120_000) throw new Error("OUTBOX_MESSAGE_EXCEEDS_QUEUE_LIMIT");
      if (current.length > 0 && (currentBytes + bytes > 240_000 || current.length >= 100)) {
        chunks.push(current); current = []; currentBytes = 0;
      }
      current.push({idempotency_key:row.idempotency_key,body,attempts:row.delivery_attempts});
      currentBytes += bytes;
    }
    if (current.length > 0) chunks.push(current);

    try {
      for (const chunk of chunks) {
        await this.env.POS_INGEST_QUEUE.sendBatch(chunk.map((item)=>({body:item.body})));
        const sentAt = Date.now();
        this.ctx.storage.transactionSync(() => {
          for (const item of chunk) {
            const delayMs = Math.min(60 * 60_000, 10 * 60_000 * (2 ** Math.min(item.attempts, 3)));
            const nextRetryAt = new Date(sentAt + delayMs).toISOString();
            this.ctx.storage.sql.exec(
              `UPDATE idempotency SET state='QUEUED',delivery_attempts=delivery_attempts+1,
                 next_retry_at=?,updated_at=?
               WHERE idempotency_key=? AND failure_code IS NULL AND state NOT IN ('COMMITTED','VOIDED')`,
              nextRetryAt,new Date(sentAt).toISOString(),item.idempotency_key
            );
          }
        });
      }
    } catch (error) {
      await this.ctx.storage.setAlarm(Date.now() + 30_000);
      throw error;
    }
  }

  async alarm(): Promise<void> {
    await this.flushPending();
    const pending = this.ctx.storage.sql.exec<{count:number}>(
      `SELECT COUNT(*) AS count FROM idempotency WHERE state='ENQUEUE_PENDING' AND failure_code IS NULL`
    ).toArray()[0]?.count ?? 0;
    const nextRetryAt = this.ctx.storage.sql.exec<{next_retry_at:string|null}>(
      `SELECT MIN(next_retry_at) AS next_retry_at FROM idempotency
       WHERE state='QUEUED' AND failure_code IS NULL AND next_retry_at IS NOT NULL`
    ).toArray()[0]?.next_retry_at;
    if (pending > 0) await this.ctx.storage.setAlarm(Date.now() + 30_000);
    else if (nextRetryAt) {
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1_000,Date.parse(nextRetryAt)));
    }
    this.ctx.storage.transactionSync(()=>this.pruneStorage(Date.now()));
  }

  getDiagnostics(tenantId:string,terminalId:string):{
    last_contiguous_seq_no:number;
    last_hlc_physical_ms:number;
    last_hlc_logical:number;
    pending_count:number;
    pending_truncated:boolean;
    pending_outbox:Array<{idempotency_key:string;state:string;failure_code:string|null;terminal_seq_no:number|null;updated_at:string}>;
    sequence_gaps:Array<{gap_from_seq_no:number;gap_to_seq_no:number;detected_at:string}>;
  }{
    const state=this.ctx.storage.sql.exec<{
      last_contiguous_seq_no:number;last_hlc_physical_ms:number;last_hlc_logical:number;
    }>(`SELECT last_contiguous_seq_no,last_hlc_physical_ms,last_hlc_logical
       FROM terminal_sequence_state WHERE singleton=1`).toArray()[0];
    const pendingCount=this.ctx.storage.sql.exec<{count:number}>(
      `SELECT COUNT(*) AS count FROM idempotency WHERE tenant_id=? AND terminal_id=?
       AND (state NOT IN ('COMMITTED','VOIDED') OR failure_code IS NOT NULL)`,
      tenantId,terminalId
    ).toArray()[0]?.count??0;
    const pending=this.ctx.storage.sql.exec<{
      idempotency_key:string;state:string;failure_code:string|null;queue_payload:string;updated_at:string;
    }>(`SELECT idempotency_key,state,failure_code,queue_payload,updated_at FROM idempotency
       WHERE tenant_id=? AND terminal_id=? AND (state NOT IN ('COMMITTED','VOIDED') OR failure_code IS NOT NULL)
       ORDER BY updated_at LIMIT 5000`,tenantId,terminalId).toArray().map((row)=>{
         let sequence:number|null=null;
         try{const value=Number((JSON.parse(row.queue_payload) as QueueSale).sale.terminal_seq_no);sequence=Number.isSafeInteger(value)?value:null;}catch{}
         return {idempotency_key:row.idempotency_key,state:row.failure_code?"FAILED":row.state,
           failure_code:row.failure_code,terminal_seq_no:sequence,updated_at:row.updated_at};
       });
    const gaps=this.ctx.storage.sql.exec<{
      gap_from_seq_no:number;gap_to_seq_no:number;detected_at:string;
    }>(`SELECT gap_from_seq_no,gap_to_seq_no,detected_at FROM terminal_sequence_gaps
       WHERE status='OPEN' ORDER BY gap_from_seq_no`).toArray();
    return {last_contiguous_seq_no:state?.last_contiguous_seq_no??0,
      last_hlc_physical_ms:state?.last_hlc_physical_ms??0,last_hlc_logical:state?.last_hlc_logical??0,
      pending_count:pendingCount,
      pending_truncated:pendingCount>pending.length,pending_outbox:pending,sequence_gaps:gaps};
  }

  getStatus(tenantId:string,terminalId:string,idempotencyKey:string):{
    status:"pending"|"queued"|"committed"|"voided"|"failed"|"not_found";receipt_id?:string;payload_hash?:string;failure_code?:string;
  }{
    const row=this.ctx.storage.sql.exec<{state:string;receipt_id:string;payload_hash:string;failure_code:string|null}>(
      `SELECT state,receipt_id,payload_hash,failure_code FROM idempotency
       WHERE tenant_id=? AND terminal_id=? AND idempotency_key=?`,tenantId,terminalId,idempotencyKey
    ).toArray()[0];
    if(!row)return {status:"not_found"};
    return {status:row.failure_code?"failed":row.state==="VOIDED"?"voided":row.state==="COMMITTED"?"committed":row.state==="QUEUED"?"queued":"pending",
      receipt_id:row.receipt_id,payload_hash:row.payload_hash,failure_code:row.failure_code??undefined};
  }

  markCommitted(tenantId:string,terminalId:string,idempotencyKey:string):void{
    this.ctx.storage.sql.exec(
      `UPDATE idempotency SET state='COMMITTED',failure_code=NULL,updated_at=?
       WHERE tenant_id=? AND terminal_id=? AND idempotency_key=? AND state<>'VOIDED'`,
      new Date().toISOString(),tenantId,terminalId,idempotencyKey
    );
  }
  markVoided(tenantId:string,terminalId:string,idempotencyKey:string):void{
    this.ctx.storage.sql.exec(
      `UPDATE idempotency SET state='VOIDED',failure_code=NULL,next_retry_at=NULL,updated_at=?
       WHERE tenant_id=? AND terminal_id=? AND idempotency_key=? AND state<>'COMMITTED'`,
      new Date().toISOString(),tenantId,terminalId,idempotencyKey
    );
  }
  markFailed(
    tenantId:string,terminalId:string,idempotencyKey:string,failureCode:string,
    expectedResolutionId?:string
  ):void{
    const row=this.ctx.storage.sql.exec<{queue_payload:string}>(
      `SELECT queue_payload FROM idempotency
        WHERE tenant_id=? AND terminal_id=? AND idempotency_key=?`,
      tenantId,terminalId,idempotencyKey
    ).toArray()[0];
    if(!row) return;
    let currentResolutionId:string|undefined;
    try {
      currentResolutionId=(JSON.parse(row.queue_payload) as QueueSale).recovery_resolution_id;
    } catch {
      throw new Error("IDEMPOTENCY_OUTBOX_CORRUPT");
    }
    // A late failure from an older delivery generation must not overwrite a
    // newer origin-authorized retry. The retry generation is carried in QueueSale.
    if((currentResolutionId ?? null)!==(expectedResolutionId ?? null)) return;
    this.ctx.storage.sql.exec(
      `UPDATE idempotency SET failure_code=?,next_retry_at=NULL,updated_at=?
       WHERE tenant_id=? AND terminal_id=? AND idempotency_key=? AND state NOT IN ('COMMITTED','VOIDED')`,
      failureCode.slice(0,200),new Date().toISOString(),tenantId,terminalId,idempotencyKey
    );
  }

}
