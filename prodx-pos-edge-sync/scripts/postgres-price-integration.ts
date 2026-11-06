import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { canonicalize, sha256Hex } from "../src/canonical.js";
import { signCatalogPriceProofs } from "../src/catalog-crypto.js";
import { commitSale, PermanentDataError } from "../src/postgres.js";
import { recordFailedSequence, resolveFailedSequence } from "../src/terminal-recovery.js";
import { verifyTerminalCertificate } from "../src/auth.js";
import type { OfflineSale, QueueSale } from "../src/contracts.js";

const adminUrl=process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
const runtimeUrl=process.env.RUNTIME_DATABASE_URL;
const signingKey=process.env.CATALOG_SIGNING_KEY;
if(!adminUrl||!runtimeUrl||!signingKey||signingKey.length<32){
  throw new Error("Set ADMIN_DATABASE_URL (or DATABASE_URL), RUNTIME_DATABASE_URL (NOBYPASSRLS runtime role), and CATALOG_SIGNING_KEY");
}

const tenantId=randomUUID();
const terminalId=randomUUID();
const productId=randomUUID();
const saleId=randomUUID();
const certificateFingerprint=randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32);
const idempotencyKey=`pg-offline-price-${randomUUID()}`;
const admin=new Client({connectionString:adminUrl});
const runtimeEnv={HYPERDRIVE_DIRECT:{connectionString:runtimeUrl},CATALOG_SIGNING_KEY:signingKey} as unknown as Env;

try{
  await admin.connect();
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
  await admin.query(
    `INSERT INTO products(id,tenant_id,sku,name,unit_price_minor,tax_bps,version,active)
     VALUES($1,$2,$3,'Offline price fixture',10000,700,1,true)`,
    [productId,tenantId,`OFFLINE-${productId.slice(0,8)}`]
  );
  await admin.query(
    `INSERT INTO terminal_devices(tenant_id,terminal_id,cert_fingerprint_sha256,active)
     VALUES($1,$2,$3,true)`,[tenantId,terminalId,certificateFingerprint]
  );
  // Seed stock through the immutable ledger path; direct balance writes are forbidden.
  await admin.query(
    `INSERT INTO inventory_ledger(tenant_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,2,'OPENING_BALANCE')`,
    [tenantId,productId,randomUUID()]
  );
  const versionResult=await admin.query(
    `SELECT catalog_version FROM tenant_catalog_versions WHERE tenant_id=$1`,[tenantId]
  );
  const catalogVersion=Number(versionResult.rows[0].catalog_version);
  // Change the current back-office price after capturing the signed snapshot version.
  await admin.query(`UPDATE products SET unit_price_minor=20000,version=version+1 WHERE tenant_id=$1 AND id=$2`,[tenantId,productId]);
  await admin.query("COMMIT");

  const certRequest=Object.assign(new Request("https://prodx.integration.test/api/v1/pos/sync-batch"),{
    cf:{tlsClientAuth:{certVerified:"SUCCESS",certRevoked:false,certFingerprintSHA256:certificateFingerprint}}
  }) as Request;
  await verifyTerminalCertificate(certRequest,runtimeEnv,{tenantId,terminalId,subject:"integration-test"});
  const badCertRequest=Object.assign(new Request("https://prodx.integration.test/api/v1/pos/sync-batch"),{
    cf:{tlsClientAuth:{certVerified:"SUCCESS",certRevoked:false,certFingerprintSHA256:"f".repeat(64)}}
  }) as Request;
  let badCertificateRejected=false;
  try{await verifyTerminalCertificate(badCertRequest,runtimeEnv,{tenantId,terminalId,subject:"integration-test"});}
  catch(error){badCertificateRejected=error instanceof Response&&error.status===403;}
  if(!badCertificateRejected) throw new Error("UNENROLLED_MTLS_CERTIFICATE_WAS_ACCEPTED");
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
  await admin.query(`UPDATE terminal_devices SET active=false,revoked_at=now() WHERE tenant_id=$1 AND terminal_id=$2 AND cert_fingerprint_sha256=$3`,[tenantId,terminalId,certificateFingerprint]);
  await admin.query("COMMIT");
  let revokedCertificateRejected=false;
  try{await verifyTerminalCertificate(certRequest,runtimeEnv,{tenantId,terminalId,subject:"integration-test"});}
  catch(error){revokedCertificateRejected=error instanceof Response&&error.status===403;}
  if(!revokedCertificateRejected) throw new Error("REVOKED_MTLS_CERTIFICATE_WAS_ACCEPTED");
  const proofs=await signCatalogPriceProofs(catalogVersion,[
    {product_id:productId,unit_price_minor:10000,tax_bps:700}
  ],signingKey,86400);

  const sale:OfflineSale={
    idempotency_key:idempotencyKey,payload_hash:"0".repeat(64),sale_id:saleId,
    terminal_seq_no:1,hlc:{physical_ms:Date.now(),logical:0},catalog_version:catalogVersion,
    signed_price_proofs:proofs,client_recorded_at:new Date().toISOString(),currency:"THB",
    lines:[{product_id:productId,quantity:2,unit_price_minor:10000,tax_bps:700}]
  };
  const {payload_hash:_ignored,...hashable}=sale;
  sale.payload_hash=await sha256Hex(canonicalize({tenant_id:tenantId,terminal_id:terminalId,sale:hashable}));
  const message:QueueSale={
    tenant_id:tenantId,terminal_id:terminalId,idempotency_key:idempotencyKey,
    payload_hash:sale.payload_hash,do_name:`${tenantId}:${terminalId}`,sale,
    edge_received_at:new Date().toISOString(),receipt_id:randomUUID()
  };

  const first=await commitSale(runtimeEnv,message);
  const duplicate=await commitSale(runtimeEnv,message);
  if(first!=="committed"||duplicate!=="duplicate") throw new Error("POSTGRES_IDEMPOTENCY_ASSERTION_FAILED");

  const persisted=await admin.query(
    `SELECT s.total_minor,s.catalog_version,sl.unit_price_minor,sl.signed_unit_price_minor,
            sl.catalog_version AS line_catalog_version,p.unit_price_minor AS current_price
       FROM sales s JOIN sale_lines sl ON sl.tenant_id=s.tenant_id AND sl.sale_id=s.sale_id
       JOIN products p ON p.tenant_id=sl.tenant_id AND p.id=sl.product_id
      WHERE s.tenant_id=$1 AND s.sale_id=$2`,[tenantId,saleId]
  );
  const row=persisted.rows[0];
  if(!row||Number(row.total_minor)!==21400||Number(row.unit_price_minor)!==10000||
     Number(row.signed_unit_price_minor)!==10000||Number(row.catalog_version)!==catalogVersion||
     Number(row.line_catalog_version)!==catalogVersion||Number(row.current_price)!==20000){
    throw new Error("SIGNED_OFFLINE_PRICE_PERSISTENCE_ASSERTION_FAILED");
  }
  const audit=await admin.query(
    `SELECT metadata FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2`,[tenantId,saleId]
  );
  const signedAudit=audit.rows[0]?.metadata?.signed_unit_prices?.[0];
  const stock=await admin.query(
    `SELECT b.quantity AS balance,l.quantity_delta,l.row_count
       FROM inventory_balances b
       JOIN (SELECT tenant_id,product_id,SUM(quantity_delta) AS quantity_delta,COUNT(*) AS row_count
             FROM inventory_ledger WHERE tenant_id=$1 AND sale_id=$2 AND reason='POS_SALE'
             GROUP BY tenant_id,product_id) l ON l.tenant_id=b.tenant_id AND l.product_id=b.product_id
      WHERE b.tenant_id=$1 AND b.product_id=$3`,[tenantId,saleId,productId]
  );
  if(Number(signedAudit?.signed_unit_price_minor)!==10000||
     Number(stock.rows[0]?.balance)!==0||Number(stock.rows[0]?.quantity_delta)!==-2||Number(stock.rows[0]?.row_count)!==1){
    throw new Error("AUDIT_OR_INVENTORY_INTEGRITY_ASSERTION_FAILED");
  }

  // Exercise origin-authoritative permanent-failure recovery through the NOBYPASSRLS runtime role.
  async function makeRecoveryMessage(sequence:number):Promise<QueueSale> {
    const recoverySale:OfflineSale={
      idempotency_key:`recovery-${sequence}-${randomUUID()}`,payload_hash:"0".repeat(64),
      sale_id:randomUUID(),terminal_seq_no:sequence,
      hlc:{physical_ms:sale.hlc.physical_ms+sequence,logical:0},catalog_version:catalogVersion,
      signed_price_proofs:proofs,client_recorded_at:new Date().toISOString(),currency:"THB",
      lines:[{product_id:productId,quantity:1,unit_price_minor:10000,tax_bps:700}]
    };
    const {payload_hash:_ignored,...hashableRecoverySale}=recoverySale;
    recoverySale.payload_hash=await sha256Hex(canonicalize({
      tenant_id:tenantId,terminal_id:terminalId,sale:hashableRecoverySale
    }));
    return {
      tenant_id:tenantId,terminal_id:terminalId,idempotency_key:recoverySale.idempotency_key,
      payload_hash:recoverySale.payload_hash,do_name:`${tenantId}:${terminalId}`,
      sale:recoverySale,edge_received_at:new Date().toISOString(),receipt_id:randomUUID()
    };
  }
  async function expectRecoverableStockFailure(message:QueueSale):Promise<void> {
    let failure:unknown;
    try { await commitSale(runtimeEnv,message); }
    catch (error) { failure=error; }
    if (!(failure instanceof PermanentDataError) || !failure.sequenceFailureEligible ||
        failure.message!=="INSUFFICIENT_STOCK") {
      throw new Error("RECOVERY_FIXTURE_DID_NOT_FAIL_WITH_ELIGIBLE_INSUFFICIENT_STOCK");
    }
    const recorded=await recordFailedSequence(runtimeEnv,message,failure.message);
    if(recorded!=="recorded") throw new Error("FAILED_SEQUENCE_WAS_NOT_DURABLY_RECORDED");
    // The same envelope is delivered again by the DLQ consumer after the main
    // Queue consumer has already persisted the failure. This must be idempotent.
    const duplicateFailure=await recordFailedSequence(runtimeEnv,message,failure.message);
    if(duplicateFailure!=="recorded") throw new Error("DUPLICATE_DLQ_FAILURE_RECORD_WAS_NOT_IDEMPOTENT");
  }

  const retryMessage=await makeRecoveryMessage(2);
  await expectRecoverableStockFailure(retryMessage);
  const retryInput={tenantId,terminalId,terminalSeqNo:2,disposition:"RETRY" as const,
    requestId:randomUUID(),actorSubject:"integration-recovery-admin",reason:"Retry after replenishing the test stock"};
  const retryResolution=await resolveFailedSequence(runtimeEnv,retryInput);
  if(retryResolution.outcome!=="RETRY"||retryResolution.checkpoint.last_committed_seq_no!==1||
     retryResolution.checkpoint.last_resolved_seq_no!==1) {
    throw new Error("FAILED_SEQUENCE_RETRY_CHECKPOINT_ASSERTION_FAILED");
  }
  // A delayed duplicate DLQ delivery after an operator RETRY must not mark the
  // already re-enqueued DO receipt failed again.
  const delayedDlqReplay=await recordFailedSequence(runtimeEnv,retryMessage,"INSUFFICIENT_STOCK");
  if(delayedDlqReplay!=="retry") throw new Error("AUTHORIZED_RETRY_WAS_NOT_PRESERVED_DURING_DLQ_REPLAY");
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
  await admin.query(
    `INSERT INTO inventory_ledger(tenant_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,1,'OPENING_BALANCE')`,[tenantId,productId,randomUUID()]
  );
  await admin.query("COMMIT");
  const retryCommit=await commitSale(runtimeEnv,retryMessage);
  if(retryCommit!=="committed") throw new Error("ORIGIN_AUTHORIZED_RETRY_DID_NOT_COMMIT");
  const retryReplay=await resolveFailedSequence(runtimeEnv,retryInput);
  if(retryReplay.outcome!=="COMMITTED"||retryReplay.resolution_id!==retryResolution.resolution_id||
     retryReplay.checkpoint.last_committed_seq_no!==2||retryReplay.checkpoint.last_resolved_seq_no!==2) {
    throw new Error("IDEMPOTENT_RETRY_REQUEST_DID_NOT_REPORT_CURRENT_COMMITTED_OUTCOME");
  }

  const voidMessage=await makeRecoveryMessage(3);
  await expectRecoverableStockFailure(voidMessage);
  const voidResolution=await resolveFailedSequence(runtimeEnv,{
    tenantId,terminalId,terminalSeqNo:3,disposition:"VOID",requestId:randomUUID(),
    actorSubject:"integration-recovery-admin",reason:"Void the permanently rejected test sale"
  });
  if(voidResolution.outcome!=="VOIDED"||voidResolution.checkpoint.last_committed_seq_no!==2||
     voidResolution.checkpoint.last_resolved_seq_no!==3||
     voidResolution.checkpoint.terminal_failures.find((failure)=>failure.terminal_seq_no===3)?.outcome!=="VOIDED") {
    throw new Error("ORIGIN_AUTHORIZED_VOID_CHECKPOINT_ASSERTION_FAILED");
  }
  if(await commitSale(runtimeEnv,voidMessage)!=="voided"||
     await recordFailedSequence(runtimeEnv,voidMessage,"INSUFFICIENT_STOCK")!=="voided") {
    throw new Error("VOIDED_SEQUENCE_REPLAY_WAS_NOT_IDEMPOTENT");
  }
  const recoveryAudit=await admin.query(
    `SELECT action FROM audit_logs WHERE tenant_id=$1
      AND action IN ('POS_TERMINAL_SEQUENCE_FAILED','POS_TERMINAL_SEQUENCE_RETRY_AUTHORIZED','POS_TERMINAL_SEQUENCE_VOIDED')`,
    [tenantId]
  );
  const recoveryActions=recoveryAudit.rows.map((row)=>row.action);
  for(const action of ["POS_TERMINAL_SEQUENCE_FAILED","POS_TERMINAL_SEQUENCE_RETRY_AUTHORIZED","POS_TERMINAL_SEQUENCE_VOIDED"]) {
    if(!recoveryActions.includes(action)) throw new Error(`TERMINAL_RECOVERY_AUDIT_MISSING:${action}`);
  }

  // Two independent inventory adjustments race to consume the final unit.
  // The same ledger trigger protects POS sales and all other stock-out movements.
  const raceProductId=randomUUID();
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
  await admin.query(
    `INSERT INTO products(id,tenant_id,sku,name,unit_price_minor,tax_bps,version,active)
     VALUES($1,$2,$3,'Concurrent stock fixture',10000,700,1,true)`,
    [raceProductId,tenantId,`RACE-${raceProductId.slice(0,8)}`]
  );
  await admin.query(
    `INSERT INTO inventory_ledger(tenant_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,1,'OPENING_BALANCE')`,
    [tenantId,raceProductId,randomUUID()]
  );
  await admin.query("COMMIT");

  async function attemptFinalUnit(referenceId:string):Promise<"committed"|"rejected"> {
    const client=new Client({connectionString:runtimeUrl});
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
      await client.query(
        `INSERT INTO inventory_ledger(tenant_id,product_id,reference_id,quantity_delta,reason)
         VALUES($1,$2,$3,-1,'STOCK_ADJUSTMENT')`,
        [tenantId,raceProductId,referenceId]
      );
      await client.query("COMMIT");
      return "committed";
    } catch (error) {
      await client.query("ROLLBACK").catch(()=>undefined);
      if (typeof error==="object"&&error!==null&&"code" in error&&(error as {code?:string}).code==="PZ001") return "rejected";
      throw error;
    } finally {
      await client.end().catch(()=>undefined);
    }
  }
  const raceResults=await Promise.all([
    attemptFinalUnit(randomUUID()),
    attemptFinalUnit(randomUUID())
  ]);
  const raceBalance=await admin.query(
    `SELECT b.quantity,
            (SELECT COUNT(*) FROM inventory_ledger l WHERE l.tenant_id=$1 AND l.product_id=$2 AND l.reason='STOCK_ADJUSTMENT') AS adjustment_count
       FROM inventory_balances b WHERE b.tenant_id=$1 AND b.product_id=$2`,
    [tenantId,raceProductId]
  );
  if(raceResults.filter((value)=>value==="committed").length!==1||
     raceResults.filter((value)=>value==="rejected").length!==1||
     Number(raceBalance.rows[0]?.quantity)!==0||
     Number(raceBalance.rows[0]?.adjustment_count)!==1){
    throw new Error("CONCURRENT_INVENTORY_OVERSALE_GUARD_FAILED");
  }

  const rlsClient=new Client({connectionString:runtimeUrl});
  await rlsClient.connect();
  try{
    await rlsClient.query("BEGIN");
    await rlsClient.query("SELECT set_config('app.current_tenant_id',$1,true)",[randomUUID()]);
    const hidden=await rlsClient.query(`SELECT id FROM products WHERE id=$1`,[productId]);
    if(hidden.rowCount!==0) throw new Error("RLS_CROSS_TENANT_READ_LEAK");
    await rlsClient.query("ROLLBACK");
    const role=await rlsClient.query(`SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname=current_user`);
    if(role.rows[0]?.rolbypassrls!==false||role.rows[0]?.rolsuper!==false) throw new Error("RUNTIME_ROLE_BYPASSES_RLS");
  }finally{await rlsClient.end();}

  console.log(JSON.stringify({
    result:"PASS",tenant_id:tenantId,terminal_id:terminalId,sale_id:saleId,
    committed_price_minor:10000,current_database_price_minor:20000,
    total_minor:21400,duplicate_result:duplicate,inventory_balance_after_ledger_trigger:0,
    concurrent_last_unit_results:raceResults,concurrent_inventory_balance:0,
    audit_catalog_version:catalogVersion,rls_cross_tenant_read:"blocked",mtls_certificate_mapping:"pass"
  },null,2));
}catch(error){
  console.error(error instanceof Error?error.message:"POSTGRES_INTEGRATION_FAILED");
  process.exitCode=1;
}finally{
  await admin.end().catch(()=>undefined);
}
