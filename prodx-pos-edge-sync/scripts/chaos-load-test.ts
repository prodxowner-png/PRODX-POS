import { webcrypto, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Agent } from "undici";
import { Client } from "pg";
import { canonicalize, sha256Hex } from "../src/canonical.js";
import { signCatalogPriceProofs } from "../src/catalog-crypto.js";
import { commitSale } from "../src/postgres.js";
import type { OfflineSale, QueueSale } from "../src/contracts.js";

async function runPool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
}

const DB_WRITE_CONCURRENCY = 80;
let activeDbWrites = 0;
const dbWriteWaiters: Array<() => void> = [];
async function withDbWritePermit<T>(operation: () => Promise<T>): Promise<T> {
  if (activeDbWrites >= DB_WRITE_CONCURRENCY) {
    // The current permit is handed directly to this waiter by the releasing
    // operation. Do not increment again after waking, or the semaphore leaks.
    await new Promise<void>((resolve) => dbWriteWaiters.push(resolve));
  } else {
    activeDbWrites++;
  }
  try { return await operation(); }
  finally {
    const next = dbWriteWaiters.shift();
    if (next) next(); // transfer the existing permit without changing the count
    else activeDbWrites--;
  }
}

async function runCiMode(): Promise<void> {
  const adminUrl = process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
  const runtimeUrl = process.env.RUNTIME_DATABASE_URL;
  const signingKey = process.env.CATALOG_SIGNING_KEY;
  if (!adminUrl || !runtimeUrl || !signingKey || signingKey.length < 32) {
    throw new Error("CI chaos mode requires ADMIN_DATABASE_URL, RUNTIME_DATABASE_URL and a CI-only CATALOG_SIGNING_KEY");
  }

  const tenantId = randomUUID();
  const storeId = randomUUID();
  const productId = randomUUID();
  const admin = new Client({ connectionString: adminUrl });
  const runtimeEnv = {
    HYPERDRIVE_DIRECT: { connectionString: runtimeUrl },
    CATALOG_SIGNING_KEY: signingKey
  } as unknown as Env;
  const terminalIds = Array.from({ length: 300 }, () => randomUUID());
  const firstMessages: QueueSale[] = [];
  const startedAt = Date.now();

  try {
    await admin.connect();
    await admin.query("BEGIN");
    await admin.query("SELECT set_config('app.current_tenant_id',$1,true)", [tenantId]);
    await admin.query(
      `INSERT INTO pos_stores(id,tenant_id,name,is_default) VALUES($1,$2,'CI Chaos Store',true)`,
      [storeId,tenantId]
    );
    await admin.query(
      `INSERT INTO store_inventory_settings(tenant_id,store_id,allow_negative_stock) VALUES($1,$2,false)`,
      [tenantId,storeId]
    );
    await admin.query(
      `INSERT INTO products(id,tenant_id,sku,name,unit_price_minor,tax_bps,version,active)
       VALUES($1,$2,$3,'CI chaos fixture',10000,700,1,true)`,
      [productId, tenantId, `CI-${productId.slice(0, 12)}`]
    );
    const versionResult = await admin.query(
      "SELECT catalog_version FROM tenant_catalog_versions WHERE tenant_id=$1", [tenantId]
    );
    if (versionResult.rowCount !== 1) throw new Error("CI_CATALOG_VERSION_FIXTURE_MISSING");
    const catalogVersion = Number(versionResult.rows[0]!.catalog_version);
    // Opening stock is recorded through the immutable ledger; its trigger updates balances.
    await admin.query(
      `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
       VALUES($1,$2,$3,$4,15000,'OPENING_BALANCE')`,
      [tenantId, storeId, productId, randomUUID()]
    );
    for (const terminalId of terminalIds) {
      const fingerprint = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 32);
      await admin.query(
        `INSERT INTO terminal_devices(tenant_id,terminal_id,store_id,cert_fingerprint_sha256,active)
         VALUES($1,$2,$3,$4,true)`, [tenantId,terminalId,storeId,fingerprint]
      );
    }
    await admin.query("COMMIT");

    const proofs = await signCatalogPriceProofs(catalogVersion, [
      { product_id: productId, unit_price_minor: 10000, tax_bps: 700 }
    ], signingKey, 86400);
    const basePhysical = Date.now();

    const terminalJobs = terminalIds.map((terminalId, terminalIndex) => ({ terminalId, terminalIndex }));
    await runPool(terminalJobs, 300, async ({ terminalId, terminalIndex }) => {
      for (let seq = 1; seq <= 50; seq++) {
        const sale: OfflineSale = {
          idempotency_key: `ci-chaos-${terminalIndex}-${seq}-${randomUUID()}`,
          payload_hash: "0".repeat(64),
          sale_id: randomUUID(),
          terminal_seq_no: seq,
          hlc: { physical_ms: basePhysical + seq, logical: 0 },
          catalog_version: catalogVersion,
          signed_price_proofs: proofs,
          client_recorded_at: new Date().toISOString(),
          currency: "THB",
          lines: [{ product_id: productId, quantity: 1, unit_price_minor: 10000, tax_bps: 700 }]
        };
        const { payload_hash: _ignored, ...hashableSale } = sale;
        sale.payload_hash = await sha256Hex(canonicalize({
          tenant_id: tenantId, terminal_id: terminalId, sale: hashableSale
        }));
        const message: QueueSale = {
          tenant_id: tenantId,
          terminal_id: terminalId,
          store_id: storeId,
          idempotency_key: sale.idempotency_key,
          payload_hash: sale.payload_hash,
          do_name: `${tenantId}:${terminalId}`,
          sale,
          edge_received_at: new Date().toISOString(),
          receipt_id: randomUUID()
        };
        const result = await withDbWritePermit(() => commitSale(runtimeEnv, message));
        if (result !== "committed") throw new Error(`CI_UNIQUE_SALE_NOT_COMMITTED:${terminalIndex}:${seq}:${result}`);
        if (seq === 1) firstMessages.push(message);
      }
    });

    // Ten concurrent exact replays per terminal: PostgreSQL must report duplicate,
    // and must not create a second sale, line, audit record or inventory delta.
    const duplicateJobs = firstMessages.flatMap((message) => Array.from({ length: 10 }, () => message));
    let duplicateCount = 0;
    await runPool(duplicateJobs, DB_WRITE_CONCURRENCY, async (message) => {
      const result = await withDbWritePermit(() => commitSale(runtimeEnv, message));
      if (result !== "duplicate") throw new Error(`CI_DUPLICATE_STORM_NOT_IDEMPOTENT:${message.idempotency_key}:${result}`);
      duplicateCount++;
    });

    const checks = await admin.query(
      `SELECT
         (SELECT COUNT(*) FROM sales WHERE tenant_id=$1) AS sales,
         (SELECT COUNT(*) FROM pos_idempotency WHERE tenant_id=$1 AND status='COMMITTED') AS idempotency,
         (SELECT COUNT(*) FROM sale_lines WHERE tenant_id=$1) AS sale_lines,
         (SELECT COUNT(*) FROM audit_logs WHERE tenant_id=$1 AND action='POS_SALE_COMMITTED') AS audit_rows,
         (SELECT COUNT(*) FROM inventory_ledger WHERE tenant_id=$1 AND reason='POS_SALE') AS sale_ledger_rows,
         (SELECT quantity FROM inventory_balances WHERE tenant_id=$1 AND store_id=$3 AND product_id=$2) AS stock_balance`,
      [tenantId, productId, storeId]
    );
    const row = checks.rows[0]!;
    const expected = { sales: 15000, idempotency: 15000, sale_lines: 15000, audit_rows: 15000, sale_ledger_rows: 15000, stock_balance: 0 };
    for (const [key, value] of Object.entries(expected)) {
      if (Number(row[key]) !== value) throw new Error(`CI_CHAOS_RECONCILIATION_FAILED:${key}:expected=${value}:actual=${row[key]}`);
    }

    console.log(JSON.stringify({
      result: "PASS", mode: "postgres-ci", terminals: 300, sales_per_terminal: 50,
      unique_sales: 15000, duplicate_replays: duplicateCount,
      concurrent_terminal_workflows: 300, max_concurrent_postgres_writes: DB_WRITE_CONCURRENCY,
      postgres_statements_for_unique_sales: 15000,
      postgres_statements_for_duplicate_replays: duplicateCount,
      postgres_statements_total: 15000 + duplicateCount,
      expected: { sales: 15000, idempotency: 15000, sale_lines: 15000, audit_rows: 15000, sale_ledger_rows: 15000, stock_balance: 0 },
      actual: Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value)])),
      elapsed_ms: Date.now() - startedAt
    }, null, 2));
  } catch (error) {
    await admin.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await admin.end().catch(() => undefined);
  }
}

async function runRemoteMode(): Promise<void> {
const endpoint = process.env.POS_SYNC_URL;
const tokenJson = process.env.POS_LOAD_TOKENS;
const certJson = process.env.POS_LOAD_CLIENT_CERTS;
if (!endpoint || !tokenJson || !certJson) {
  throw new Error("Set POS_SYNC_URL, POS_LOAD_TOKENS (300 Access JWTs), and POS_LOAD_CLIENT_CERTS (300 cert/key file pairs)");
}
const tokens = JSON.parse(tokenJson) as string[];
if (tokens.length < 300) throw new Error("POS_LOAD_TOKENS must contain at least 300 terminal JWTs");
const claims=tokens.slice(0,300).map((token)=>{
  const segment=token.split(".")[1];
  if(!segment) throw new Error("POS_LOAD_TOKENS must contain Access JWTs");
  const payload=JSON.parse(Buffer.from(segment,"base64url").toString("utf8")) as {tenant_id?:string;terminal_id?:string};
  if(!payload.tenant_id||!payload.terminal_id) throw new Error("Every load JWT needs tenant_id and terminal_id claims");
  return payload;
});
if(new Set(claims.map((c)=>c.terminal_id)).size!==300) throw new Error("The first 300 tokens must represent 300 distinct terminal_id claims");
if(new Set(claims.map((c)=>c.tenant_id)).size!==1) throw new Error("This harness expects 300 terminals in one tenant; run once per tenant");
const certFiles=JSON.parse(certJson) as Array<{cert_path:string;key_path:string}>;
if(certFiles.length<300||certFiles.slice(0,300).some((pair)=>!pair.cert_path||!pair.key_path)) throw new Error("POS_LOAD_CLIENT_CERTS must contain 300 {cert_path,key_path} entries in the same order as POS_LOAD_TOKENS");
const agents=await Promise.all(certFiles.slice(0,300).map(async(pair)=>new Agent({connect:{
  cert:await readFile(pair.cert_path,"utf8"),key:await readFile(pair.key_path,"utf8"),rejectUnauthorized:true
}})));
const encoder = new TextEncoder();
async function sha256(value: string): Promise<string> {
  const digest = await webcrypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2,"0")).join("");
}
async function getCatalog(token: string) {
  const response = await fetch(new URL("/api/v1/catalog?limit=50", endpoint), {
    headers: { "cf-access-jwt-assertion": token }
  });
  if (!response.ok) throw new Error(`catalog failed: ${response.status}`);
  return await response.json() as { items: Array<{id:string;unit_price_minor:string;tax_bps:number}>; catalog_version:number; signed_price_proofs: any[] };
}

const start = Date.now();
const initialRequests: Array<Promise<{ terminal: number; status: number; body: any }>> = [];
const duplicateRequests: Array<Promise<{ terminal: number; status: number; body: any }>> = [];
const outcomes: Array<{terminal:number;status:number;body:any}> = [];

async function send(token: string, agent: Agent, body: unknown, terminal: number) {
  const response = await fetch(new URL("/api/v1/pos/sync-batch", endpoint), {
    method: "POST", headers: { "content-type":"application/json", "cf-access-jwt-assertion":token },
    body: JSON.stringify(body), dispatcher:agent
  } as RequestInit & {dispatcher:Agent});
  const payload = await response.json().catch(() => ({}));
  return { terminal, status: response.status, body: payload };
}

for (let terminal=0; terminal<300; terminal++) {
  const token=tokens[terminal]!;
  const agent=agents[terminal]!;
  initialRequests.push((async()=>{
    const catalog=await getCatalog(token);
    if (!catalog.items.length) throw new Error(`terminal ${terminal}: catalog empty`);
    const item=catalog.items[0]!;
    const sales=[];
    const physical=Date.now();
    for (let i=1;i<=50;i++) {
      const sale:any={
        idempotency_key:`chaos-${terminal}-${i}-${randomUUID()}`,
        sale_id:randomUUID(), terminal_seq_no:i,
        hlc:{physical_ms:physical+i,logical:0}, catalog_version:catalog.catalog_version,
        signed_price_proofs:[catalog.signed_price_proofs[0]], client_recorded_at:new Date().toISOString(),
        currency:"THB", lines:[{product_id:item.id,quantity:1,unit_price_minor:Number(item.unit_price_minor),tax_bps:item.tax_bps}]
      };
      const { payload_hash:_ignored, ...hashableSale } = sale;
      sale.payload_hash=await sha256(canonicalize({tenant_id:claims[terminal]!.tenant_id,terminal_id:claims[terminal]!.terminal_id,sale:hashableSale}));
      sales.push(sale);
    }
    const body={batch_id:`chaos-batch-${terminal}-${randomUUID()}`,sales};
    const first=await send(token,agent,body,terminal);
    outcomes.push(first);
    // Ten exact replays per terminal: same keys and same hashes/payload bytes.
    for(let n=0;n<10;n++) duplicateRequests.push(send(token,agent,body,terminal));
    return first;
  })());
}
try {
  await Promise.all(initialRequests);
  const duplicateResults=await Promise.all(duplicateRequests);
  outcomes.push(...duplicateResults);
} finally {
  await Promise.all(agents.map((agent)=>agent.close()));
}
const summary={
  terminals:300, sales_per_terminal:50, original_sales:15000,
  duplicate_replays:3000, requests:outcomes.length,
  status_counts:outcomes.reduce((acc,r)=>{acc[String(r.status)]=(acc[String(r.status)]??0)+1;return acc;},{} as Record<string,number>),
  edge_accepted:outcomes.filter(r=>r.status===202).length,
  failures:outcomes.filter(r=>r.status>=400).map(r=>({terminal:r.terminal,status:r.status,body:r.body})).slice(0,30),
  elapsed_ms:Date.now()-start
};
console.log(JSON.stringify(summary,null,2));
if(summary.failures.length) process.exitCode=1;

}

if (process.env.POS_CI_MODE === "true") {
  await runCiMode();
} else {
  await runRemoteMode();
}
