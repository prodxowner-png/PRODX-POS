import type { SyncBatch, QueueSale } from "./contracts";
import { canonicalize, sha256Hex, assertSaleShape, isUuid } from "./canonical";
import { authenticate, authenticateTenantOperator, verifyTerminalCertificate } from "./auth";
import { commitSale, PermanentDataError } from "./postgres";
import { verifySalePrices, signCatalogSnapshot, signCatalogPriceProofs } from "./catalog-crypto";
import { catalogSigningKey } from "./secrets";
export { IdempotencyGate } from "./idempotency-do";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const MAX_BODY_BYTES = 1_000_000;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function getDoName(tenantId: string, terminalId: string): string {
  // One shard per tenant + terminal: one RPC for the complete 10-50 sale batch.
  return `${tenantId}:${terminalId}`;
}

async function handleSync(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const auth = await authenticate(request, env);
  const originCheckpoint = await verifyTerminalCertificate(request,env,auth);
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) return json({ error: "PAYLOAD_TOO_LARGE" }, 413);

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return json({ error: "PAYLOAD_TOO_LARGE" }, 413);
  }

  let batch: SyncBatch;
  try {
    batch = JSON.parse(raw) as SyncBatch;
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  if (!batch || typeof batch.batch_id !== "string" ||
      !Array.isArray(batch.sales) || batch.sales.length < 10 || batch.sales.length > 50) {
    return json({ error: "BATCH_MUST_CONTAIN_10_TO_50_SALES" }, 400);
  }

  const edgeReceivedAt = new Date().toISOString();
  const prepared = [];
  try {
    // Validate and hash the entire batch before the single DO RPC.
    for (const sale of batch.sales) {
      assertSaleShape(sale);
      if (new TextEncoder().encode(JSON.stringify(sale)).byteLength > 100_000) {
        return json({ batch_id: batch.batch_id, error: "SALE_EXCEEDS_QUEUE_MESSAGE_BUDGET",
          idempotency_key: sale.idempotency_key }, 413);
      }
      const { payload_hash: claimedHash, ...payload } = sale;
      const canonicalPayload = canonicalize(payload);
      const actualHash = await sha256Hex(canonicalPayload);
      if (actualHash !== claimedHash.toLowerCase()) {
        return json({
          batch_id: batch.batch_id,
          error: "PAYLOAD_HASH_MISMATCH",
          idempotency_key: sale.idempotency_key
        }, 422);
      }
      if (!(await verifySalePrices(sale, catalogSigningKey(env)))) {
        return json({ batch_id: batch.batch_id, error: "SIGNED_CATALOG_INVALID_OR_EXPIRED",
          idempotency_key: sale.idempotency_key }, 422);
      }
      prepared.push({
        sale,
        payloadHash: actualHash,
        edgeReceivedAt,
        receiptId: crypto.randomUUID()
      });
    }

    const doName = getDoName(auth.tenantId, auth.terminalId);
    const stub = env.IDEMPOTENCY.get(env.IDEMPOTENCY.idFromName(doName));
    const results = await stub.submitBatch({
      tenantId: auth.tenantId,
      terminalId: auth.terminalId,
      doName,
      sales: prepared
    }, originCheckpoint);

    return json({
      batch_id: batch.batch_id,
      edge_received_at: edgeReceivedAt,
      accepted_count: results.results.filter((r) => r.status === "accepted").length,
      duplicate_count: results.results.filter((r) => r.status === "duplicate").length,
      committed_count: results.results.filter((r) => r.status === "committed").length,
      has_sequence_gaps: results.sequence_gaps.length > 0,
      sequence_gaps: results.sequence_gaps,
      last_contiguous_seq_no: results.last_contiguous_seq_no,
      last_hlc: results.last_hlc,
      results: results.results
    }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = message === "IDEMPOTENCY_PAYLOAD_MISMATCH" ? 422 :
      message === "IDEMPOTENCY_PREVIOUSLY_FAILED" || message.startsWith("TERMINAL_") ? 409 :
      message.startsWith("INVALID_") ? 400 : 503;
    return json({ batch_id: batch.batch_id, error: message }, status);
  }

}

async function handleTerminalDiagnostics(request: Request, env: Env): Promise<Response> {
  const operator = await authenticateTenantOperator(request, env);
  const terminalId = new URL(request.url).searchParams.get("terminal_id");
  if (!terminalId || !isUuid(terminalId)) return json({ error: "INVALID_TERMINAL_ID" }, 400);
  const doName = getDoName(operator.tenantId, terminalId);
  const stub = env.IDEMPOTENCY.get(env.IDEMPOTENCY.idFromName(doName));
  return json({ tenant_id: operator.tenantId, terminal_id: terminalId,
    exported_at: new Date().toISOString(), ...(await stub.getDiagnostics(operator.tenantId, terminalId)) });
}

async function handleReceiptStatus(request: Request, env: Env): Promise<Response> {
  const auth = await authenticate(request, env);
  const url = new URL(request.url);
  const key = url.searchParams.get("idempotency_key");
  if (!key || key.length < 16 || key.length > 200) {
    return json({ error: "INVALID_IDEMPOTENCY_KEY" }, 400);
  }
  const doName = getDoName(auth.tenantId, auth.terminalId);
  const stub = env.IDEMPOTENCY.get(env.IDEMPOTENCY.idFromName(doName));
  const result = await stub.getStatus(auth.tenantId, auth.terminalId, key);
  if (result.status === "not_found") return json(result, 404);
  if (result.status === "failed") return json(result, 409);
  return json(result, result.status === "committed" ? 200 : 202);
}

async function handleCatalog(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const auth = await authenticate(request, env);
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  if (cursor && !isUuid(cursor)) return json({ error: "INVALID_CATALOG_CURSOR" }, 400);
  const requestedLimit = Number(url.searchParams.get("limit") ?? "100");
  const limit = Number.isFinite(requestedLimit) ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 500) : 100;
  const { Client } = await import("pg");
  const direct = new Client({ connectionString: env.HYPERDRIVE_DIRECT.connectionString });
  try {
    await direct.connect();
    await direct.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    await direct.query("SELECT set_config('app.current_tenant_id', $1, true)", [auth.tenantId]);
    // Read the authoritative version through uncached Hyperdrive first. A cached
    // product page is usable only when its embedded version matches this snapshot.
    const versionResult = await direct.query(
      `SELECT catalog_version FROM tenant_catalog_versions WHERE tenant_id=$1`, [auth.tenantId]
    );
    const catalogVersion = Number(versionResult.rows[0]?.catalog_version ?? 1);
    if (!Number.isSafeInteger(catalogVersion) || catalogVersion < 1) throw new Error("INVALID_CATALOG_VERSION");

    const cacheUrl = new URL(request.url);
    cacheUrl.pathname = `/__prodx_cache/catalog/${auth.tenantId}/${catalogVersion}`;
    cacheUrl.search = `?cursor=${encodeURIComponent(cursor ?? "")}&limit=${limit}`;
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
    const cache = caches.default;
    const cachedResponse = await cache.match(cacheKey).catch(() => undefined);
    if (cachedResponse) {
      const cachedData = await cachedResponse.clone().json().catch(() => null) as { catalog_version?: number } | null;
      if (cachedData?.catalog_version === catalogVersion) {
        await direct.query("COMMIT");
        return new Response(cachedResponse.body, {
          status: cachedResponse.status, statusText: cachedResponse.statusText,
          headers: { ...Object.fromEntries(cachedResponse.headers), "cache-control": "private, no-store" }
        });
      }
    }

    type CatalogRow = { id:string; sku:string; name:string; unit_price_minor:string; tax_bps:number; version:string };
    let rows: CatalogRow[] | undefined;
    const cachedClient = new Client({ connectionString: env.HYPERDRIVE_CACHED.connectionString });
    try {
      await cachedClient.connect();
      await cachedClient.query("BEGIN");
      await cachedClient.query("SELECT set_config('app.current_tenant_id', $1, true)", [auth.tenantId]);
      // The version and page are returned by one statement so the cached page is
      // self-identifying. If Hyperdrive serves a stale page, fall back to DIRECT.
      const page = await cachedClient.query(
        `WITH v AS (
           SELECT catalog_version FROM tenant_catalog_versions WHERE tenant_id=$1
         ), p AS (
           SELECT id,sku,name,unit_price_minor,tax_bps,version
             FROM products WHERE tenant_id=$1 AND active=true
               AND ($2::uuid IS NULL OR id > $2::uuid)
            ORDER BY id LIMIT $3
         )
         SELECT v.catalog_version,p.id,p.sku,p.name,p.unit_price_minor,p.tax_bps,p.version
           FROM v LEFT JOIN p ON true ORDER BY p.id`,
        [auth.tenantId,cursor,limit]
      );
      const pageVersion = Number(page.rows[0]?.catalog_version);
      if (pageVersion === catalogVersion) rows = page.rows.filter((row) => row.id !== null) as CatalogRow[];
      await cachedClient.query("COMMIT");
    } catch {
      await cachedClient.query("ROLLBACK").catch(() => undefined);
    } finally {
      await cachedClient.end().catch(() => undefined);
    }

    if (!rows) {
      const directPage = await direct.query(
        `SELECT id,sku,name,unit_price_minor,tax_bps,version
           FROM products WHERE tenant_id=$1 AND active=true
             AND ($2::uuid IS NULL OR id > $2::uuid)
          ORDER BY id LIMIT $3`, [auth.tenantId,cursor,limit]
      );
      rows = directPage.rows as CatalogRow[];
    }
    if (!versionResult.rows[0] && rows.length > 0) throw new Error("TENANT_CATALOG_VERSION_MISSING");
    await direct.query("COMMIT");
    const items = rows.map((row) => ({
      product_id: row.id, sku: row.sku, name: row.name, product_version: Number(row.version),
      unit_price_minor: Number(row.unit_price_minor), tax_bps: row.tax_bps
    }));
    const signingKey = catalogSigningKey(env);
    const signed_catalog = await signCatalogSnapshot(catalogVersion, items, signingKey, 86400);
    const signed_price_proofs = await signCatalogPriceProofs(catalogVersion, items, signingKey, 86400);
    const response = json({
      items: rows, catalog_version: catalogVersion, signed_catalog, signed_price_proofs,
      next_cursor: rows.length === limit ? rows[rows.length - 1].id : null
    });
    const cacheable = response.clone();
    cacheable.headers.set("cache-control", "public, max-age=15");
    ctx.waitUntil(cache.put(cacheKey, cacheable).catch(() => undefined));
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    await direct.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { await direct.end().catch(() => undefined); }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/api/v1/pos/sync-batch") {
        return await handleSync(request, env, ctx);
      }
      if (request.method === "GET" && url.pathname === "/api/v1/catalog") {
        return await handleCatalog(request, env, ctx);
      }
      if (request.method === "GET" && url.pathname === "/api/v1/pos/receipt-status") {
        return await handleReceiptStatus(request, env);
      }
      if (request.method === "GET" && url.pathname === "/api/v1/ops/terminal-sync-diagnostics") {
        return await handleTerminalDiagnostics(request, env);
      }
      return json({ error: "NOT_FOUND" }, 404);
    } catch (error) {
      if (error instanceof Response) return error;
      console.error("request_failed", error);
      return json({ error: "INTERNAL_ERROR" }, 500);
    }
  },

  async queue(batch: MessageBatch<QueueSale>, env: Env): Promise<void> {
    if (batch.queue === "prodx-pos-ingest-dlq") {
      for (const message of batch.messages) {
        const failed = message.body as QueueSale & { failure_code?: string };
        try {
          const doName = getDoName(failed.tenant_id,failed.terminal_id);
          const stub = env.IDEMPOTENCY.get(env.IDEMPOTENCY.idFromName(doName));
          await stub.markFailed(failed.tenant_id,failed.terminal_id,failed.idempotency_key,
            failed.failure_code ?? "QUEUE_RETRY_EXHAUSTED");
          message.ack();
        } catch (error) {
          console.error("dlq_receipt_finalization_failed",error);
          message.retry({delaySeconds:60});
        }
      }
      return;
    }
    for (const message of batch.messages) {
      try {
        await commitSale(env, message.body);
        const id = env.IDEMPOTENCY.idFromName(message.body.do_name);
        const stub = env.IDEMPOTENCY.get(id);
        await stub.markCommitted(message.body.tenant_id, message.body.terminal_id, message.body.idempotency_key);
        message.ack();
      } catch (error) {
        const reason = error instanceof Error ? error.message : "UNKNOWN";
        const mustDeadLetter = error instanceof PermanentDataError || Number(message.attempts ?? 0) >= 90;
        if (mustDeadLetter) {
          // Finalize the DO receipt only after the DLQ accepted the failure.
          // DLQ consumers deduplicate by tenant_id + idempotency_key.
          try {
            await env.POS_INGEST_DLQ.send({
              ...message.body,
              failure_code: reason,
              failed_at: new Date().toISOString()
            });
            const doName = getDoName(message.body.tenant_id,message.body.terminal_id);
            const stub = env.IDEMPOTENCY.get(env.IDEMPOTENCY.idFromName(doName));
            await stub.markFailed(message.body.tenant_id,message.body.terminal_id,message.body.idempotency_key,reason);
            message.ack();
          } catch (dlqError) {
            console.error("dead_letter_enqueue_or_finalize_failed", dlqError);
            message.retry({ delaySeconds: 60 });
          }
        } else {
          console.error("sale_commit_retry", { receipt_id:message.body.receipt_id,error:reason });
          // Missing earlier terminal sequence numbers are recoverable when the
          // POS replays its missing outbox entries; retry with a longer delay.
          message.retry({ delaySeconds: reason.startsWith("TERMINAL_SEQUENCE_GAP") ? 60 : 15 });
        }
      }
    }
  }
} satisfies ExportedHandler<Env>;
