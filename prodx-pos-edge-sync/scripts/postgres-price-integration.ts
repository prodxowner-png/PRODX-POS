import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { assertDisposableCiDatabasePair } from "./test-database-guard.js";
import { canonicalize, sha256Hex } from "../src/canonical.js";
import { signCatalogPriceProofs } from "../src/catalog-crypto.js";
import { commitSale, PermanentDataError } from "../src/postgres.js";
import { recordFailedSequence, resolveFailedSequence } from "../src/terminal-recovery.js";
import { verifyTerminalCertificate } from "../src/auth.js";
import type { OfflineSale, QueueSale } from "../src/contracts.js";

const { adminUrl, runtimeUrl } = assertDisposableCiDatabasePair(
  process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
  process.env.RUNTIME_DATABASE_URL,
  "postgres-price-integration.ts",
);
const signingKey=process.env.CATALOG_SIGNING_KEY;
if(!signingKey||signingKey.length<32){
  throw new Error("Set ADMIN_DATABASE_URL (or DATABASE_URL), RUNTIME_DATABASE_URL (NOBYPASSRLS runtime role), and CATALOG_SIGNING_KEY");
}

const tenantId=randomUUID();
const terminalId=randomUUID();
const storeId=randomUUID();
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
    `INSERT INTO pos_stores(id,tenant_id,name,is_default) VALUES($1,$2,'Integration Store',true)`,[storeId,tenantId]
  );
  await admin.query(
    `INSERT INTO products(id,tenant_id,sku,name,unit_price_minor,tax_bps,version,active)
     VALUES($1,$2,$3,'Offline price fixture',10000,700,1,true)`,
    [productId,tenantId,`OFFLINE-${productId.slice(0,8)}`]
  );
  await admin.query(
    `INSERT INTO terminal_devices(tenant_id,terminal_id,store_id,cert_fingerprint_sha256,active)
     VALUES($1,$2,$3,$4,true)`,[tenantId,terminalId,storeId,certificateFingerprint]
  );
  await admin.query(
    "SELECT set_config('app.inventory_actor_id',$1,true), set_config('app.inventory_payload_hash',$2,true)",
    [terminalId,randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32)]
  );
  const openingReferenceId=randomUUID();
  await admin.query(
    `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,$4,2,'OPENING_BALANCE')`,[tenantId,storeId,productId,openingReferenceId]
  );
  // Opening stock was seeded through the immutable store-scoped ledger path above.
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
  // A previously accepted Queue sale may commit after revocation while its Store binding is unchanged.
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
    tenant_id:tenantId,terminal_id:terminalId,store_id:storeId,idempotency_key:idempotencyKey,
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
       JOIN (SELECT tenant_id,store_id,product_id,SUM(quantity_delta) AS quantity_delta,COUNT(*) AS row_count
             FROM inventory_ledger WHERE tenant_id=$1 AND store_id=$2 AND sale_id=$3 AND reason='POS_SALE'
             GROUP BY tenant_id,store_id,product_id) l
         ON l.tenant_id=b.tenant_id AND l.store_id=b.store_id AND l.product_id=b.product_id
      WHERE b.tenant_id=$1 AND b.store_id=$2 AND b.product_id=$4`,[tenantId,storeId,saleId,productId]
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
      tenant_id:tenantId,terminal_id:terminalId,store_id:storeId,idempotency_key:recoverySale.idempotency_key,
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
    const durableSnapshot=await admin.query<{sale_snapshot:OfflineSale|null}>(
      `SELECT sale_snapshot FROM terminal_sequence_failures
        WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=$3`,
      [message.tenant_id,message.terminal_id,message.sale.terminal_seq_no]
    );
    if(!durableSnapshot.rows[0]?.sale_snapshot ||
       canonicalize(durableSnapshot.rows[0].sale_snapshot)!==canonicalize(message.sale)) {
      throw new Error("FAILED_SEQUENCE_ORIGIN_SALE_SNAPSHOT_MISMATCH");
    }
  }

  console.log("[integration] sequence 2 RETRY and retry-generation checks");
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
  if(!retryResolution.resolution_id) throw new Error("RETRY_RESOLUTION_ID_MISSING");
  retryMessage.recovery_resolution_id=retryResolution.resolution_id;
  const failedRetryAttempt=await recordFailedSequence(runtimeEnv,retryMessage,"INSUFFICIENT_STOCK");
  const duplicateFailedRetryAttempt=await recordFailedSequence(runtimeEnv,retryMessage,"INSUFFICIENT_STOCK");
  if(failedRetryAttempt!=="retry_failed"||duplicateFailedRetryAttempt!=="retry_failed") {
    throw new Error("AUTHORIZED_RETRY_FAILURE_WAS_NOT_DURABLY_AUDITED_IDEMPOTENTLY");
  }
  const retryAuditSnapshot=await admin.query(
    `SELECT
       (SELECT COUNT(*)::int FROM terminal_sequence_resolutions
         WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=2
           AND resolution_id=$3) AS resolutions,
       (SELECT COUNT(*)::int FROM terminal_sequence_retry_failures
         WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=2
           AND resolution_id=$3) AS retry_failures,
       (SELECT COUNT(*)::int FROM audit_logs
         WHERE tenant_id=$1 AND action='POS_TERMINAL_SEQUENCE_RETRY_FAILED'
           AND metadata->>'resolution_id'=$3::text) AS retry_failure_audits`,
    [tenantId,terminalId,retryResolution.resolution_id]
  );
  const failedRetryCheckpoint=await resolveFailedSequence(runtimeEnv,retryInput);
  if(failedRetryCheckpoint.outcome!=="FAILED"||
     failedRetryCheckpoint.resolution_id!==retryResolution.resolution_id||
     failedRetryCheckpoint.checkpoint.terminal_failures.find((failure)=>failure.terminal_seq_no===2)?.outcome!=="FAILED") {
    throw new Error("IDEMPOTENT_RETRY_REQUEST_DID_NOT_REPORT_CURRENT_FAILED_OUTCOME");
  }
  const failedRetryReplay=await resolveFailedSequence(runtimeEnv,retryInput);
  const retryAuditAfterReplay=await admin.query(
    `SELECT
       (SELECT COUNT(*)::int FROM terminal_sequence_resolutions
         WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=2
           AND resolution_id=$3) AS resolutions,
       (SELECT COUNT(*)::int FROM terminal_sequence_retry_failures
         WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=2
           AND resolution_id=$3) AS retry_failures,
       (SELECT COUNT(*)::int FROM audit_logs
         WHERE tenant_id=$1 AND action='POS_TERMINAL_SEQUENCE_RETRY_FAILED'
           AND metadata->>'resolution_id'=$3::text) AS retry_failure_audits`,
    [tenantId,terminalId,retryResolution.resolution_id]
  );
  if(failedRetryReplay.outcome!=="FAILED"||
     failedRetryReplay.resolution_id!==retryResolution.resolution_id||
     JSON.stringify(retryAuditAfterReplay.rows[0])!==JSON.stringify(retryAuditSnapshot.rows[0])||
     Number(retryAuditAfterReplay.rows[0].resolutions)!==1||
     Number(retryAuditAfterReplay.rows[0].retry_failures)!==1||
     Number(retryAuditAfterReplay.rows[0].retry_failure_audits)!==1) {
    throw new Error("FAILED_REQUEST_REPLAY_CREATED_DUPLICATE_RESOLUTION_OR_AUDIT");
  }
  const retryAgainInput={...retryInput,requestId:randomUUID(),reason:"Retry again after confirming the replenishment operation"};
  const retryAgainResolution=await resolveFailedSequence(runtimeEnv,retryAgainInput);
  if(retryAgainResolution.outcome!=="RETRY"||
     retryAgainResolution.checkpoint.terminal_failures.find((failure)=>failure.terminal_seq_no===2)?.outcome!=="RETRY") {
    throw new Error("SECOND_RETRY_AUTHORIZATION_DID_NOT_SUPERSEDE_FAILED_ATTEMPT");
  }
  if(!retryAgainResolution.resolution_id) throw new Error("SECOND_RETRY_RESOLUTION_ID_MISSING");
  const staleRetryDelivery=await recordFailedSequence(runtimeEnv,retryMessage,"INSUFFICIENT_STOCK");
  if(staleRetryDelivery!=="retry") throw new Error("STALE_RETRY_GENERATION_WAS_NOT_FENCED");
  retryMessage.recovery_resolution_id=retryAgainResolution.resolution_id;
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
  await admin.query(
    "SELECT set_config('app.inventory_actor_id',$1,true), set_config('app.inventory_payload_hash',$2,true)",
    [terminalId,randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32)]
  );
  await admin.query(
    `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,$4,1,'OPENING_BALANCE')`,[tenantId,storeId,productId,randomUUID()]
  );
  await admin.query("COMMIT");
  const retryCommit=await commitSale(runtimeEnv,retryMessage);
  if(retryCommit!=="committed") throw new Error("ORIGIN_AUTHORIZED_RETRY_DID_NOT_COMMIT");
  const retryReplay=await resolveFailedSequence(runtimeEnv,retryInput);
  if(retryReplay.outcome!=="COMMITTED"||retryReplay.resolution_id!==retryResolution.resolution_id||
     retryReplay.checkpoint.last_committed_seq_no!==2||retryReplay.checkpoint.last_resolved_seq_no!==2) {
    throw new Error("IDEMPOTENT_RETRY_REQUEST_DID_NOT_REPORT_CURRENT_COMMITTED_OUTCOME");
  }

  console.log("[integration] sequence 3 VOID and identity checks");
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

  // CRITICAL #2: VOID identity validation must reject forged/mismatched/cross-scope replays.
  // 1) Different sale on VOIDed sequence 3 -> TERMINAL_SEQUENCE_ALREADY_RESOLVED
  const differentSaleOnVoidedSeq=await makeRecoveryMessage(3);
  let differentSaleRejected=false;
  try { await commitSale(runtimeEnv,differentSaleOnVoidedSeq); }
  catch (error) {
    differentSaleRejected=error instanceof PermanentDataError &&
      error.message==="TERMINAL_SEQUENCE_ALREADY_RESOLVED";
  }
  if(!differentSaleRejected) throw new Error("DIFFERENT_SALE_ON_VOIDED_SEQUENCE_WAS_ACCEPTED");

  // 2) Same idempotency key with different payload on VOIDed sequence 3 -> IDEMPOTENCY_PAYLOAD_MISMATCH
  const tamperedVoidSale:OfflineSale={
    ...voidMessage.sale,
    sale_id:randomUUID(),
    payload_hash:"0".repeat(64)
  };
  const {payload_hash:_tIgn,...tamperedHashable}=tamperedVoidSale;
  tamperedVoidSale.payload_hash=await sha256Hex(canonicalize({
    tenant_id:tenantId,terminal_id:terminalId,sale:tamperedHashable
  }));
  const tamperedVoidMessage:QueueSale={
    ...voidMessage,
    payload_hash:tamperedVoidSale.payload_hash,
    sale:tamperedVoidSale
  };
  let sameKeyDiffPayloadRejected=false;
  try { await commitSale(runtimeEnv,tamperedVoidMessage); }
  catch (error) {
    sameKeyDiffPayloadRejected=error instanceof PermanentDataError &&
      error.message==="IDEMPOTENCY_PAYLOAD_MISMATCH";
  }
  if(!sameKeyDiffPayloadRejected) throw new Error("VOIDED_SAME_KEY_DIFFERENT_PAYLOAD_WAS_ACCEPTED");

  // 3) Cross-store VOID replay must be rejected (never return "voided")
  let crossStoreVoidRejected=false;
  try { await commitSale(runtimeEnv,{...voidMessage,store_id:randomUUID()}); }
  catch (error) {
    crossStoreVoidRejected=error instanceof PermanentDataError &&
      (error.message==="TERMINAL_STORE_MAPPING_MISMATCH" || error.message==="TERMINAL_SEQUENCE_ALREADY_RESOLVED");
  }
  if(!crossStoreVoidRejected) throw new Error("CROSS_STORE_VOID_REPLAY_WAS_ACCEPTED");

  // 4) Cross-terminal and cross-tenant VOID replays must be rejected
  for (const crossScopeMsg of [
    {...voidMessage,terminal_id:randomUUID()},
    {...voidMessage,tenant_id:randomUUID()}
  ]) {
    let crossScopeRejected=false;
    try { await commitSale(runtimeEnv,crossScopeMsg); }
    catch { crossScopeRejected=true; }
    if(!crossScopeRejected) throw new Error("CROSS_SCOPE_VOID_REPLAY_WAS_ACCEPTED");
  }

  // Negative scope checks must not reveal another tenant's failure or permit
  // a recovery request against a terminal with no matching durable failure.
  for (const [wrongTenant,wrongTerminal] of [
    [randomUUID(),terminalId],
    [tenantId,randomUUID()]
  ] as const) {
    let notFound=false;
    try {
      await resolveFailedSequence(runtimeEnv,{
        tenantId:wrongTenant,terminalId:wrongTerminal,terminalSeqNo:3,
        disposition:"VOID",requestId:randomUUID(),
        actorSubject:"integration-recovery-admin",reason:"Negative scope test"
      });
    } catch (error) {
      notFound=error instanceof Error&&error.message==="TERMINAL_SEQUENCE_FAILURE_NOT_FOUND";
    }
    if(!notFound) throw new Error("RECOVERY_SCOPE_MISMATCH_WAS_NOT_REJECTED");
  }
  let emptyReasonRejected=false;
  try {
    await resolveFailedSequence(runtimeEnv,{
      tenantId,terminalId,terminalSeqNo:3,disposition:"VOID",requestId:randomUUID(),
      actorSubject:"integration-recovery-admin",reason:"   "
    });
  } catch (error) {
    emptyReasonRejected=error instanceof Error&&error.message==="INVALID_TERMINAL_SEQUENCE_RECOVERY_REQUEST";
  }
  if(!emptyReasonRejected) throw new Error("EMPTY_RECOVERY_REASON_WAS_ACCEPTED");

  // Reusing a request ID with changed intent must fail closed, even after the
  // original RETRY has committed its sale.
  let requestConflictRejected=false;
  try {
    await resolveFailedSequence(runtimeEnv,{
      ...retryInput,reason:"Changed reason under an already-used request ID"
    });
  } catch (error) {
    requestConflictRejected=error instanceof Error&&
      error.message==="TERMINAL_SEQUENCE_RECOVERY_REQUEST_ID_CONFLICT";
  }
  if(!requestConflictRejected) throw new Error("RECOVERY_REQUEST_ID_CONFLICT_WAS_NOT_REJECTED");

  // Two concurrent identical VOID requests must serialize on the origin
  // checkpoint and converge on one immutable resolution/audit identity.
  console.log("[integration] sequence 4 concurrent VOID requests");
  const concurrentVoidMessage=await makeRecoveryMessage(4);
  await expectRecoverableStockFailure(concurrentVoidMessage);
  const concurrentVoidInput={
    tenantId,terminalId,terminalSeqNo:4,disposition:"VOID" as const,
    requestId:randomUUID(),actorSubject:"integration-recovery-admin",
    reason:"Concurrent idempotent operator VOID"
  };
  const [voidA,voidB]=await Promise.all([
    resolveFailedSequence(runtimeEnv,concurrentVoidInput),
    resolveFailedSequence(runtimeEnv,concurrentVoidInput)
  ]);
  if(voidA.outcome!=="VOIDED"||voidB.outcome!=="VOIDED"||
     !voidA.resolution_id||voidA.resolution_id!==voidB.resolution_id||
     voidA.checkpoint.last_resolved_seq_no!==4||voidB.checkpoint.last_resolved_seq_no!==4) {
    throw new Error("CONCURRENT_RECOVERY_REQUEST_IDEMPOTENCY_FAILED");
  }
  const voidCount=await admin.query(
    `SELECT COUNT(*)::integer AS count FROM terminal_sequence_resolutions
      WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=4 AND disposition='VOID'`,
    [tenantId,terminalId]
  );
  if(Number(voidCount.rows[0]?.count)!==1) throw new Error("CONCURRENT_VOID_CREATED_DUPLICATE_RESOLUTIONS");

  // HIGH #5: Commit Sale 5 after Sale 1, Sale 2, VOID 3, VOID 4 -> last_committed_seq_no=5, last_resolved_seq_no=5.
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
  await admin.query(
    "SELECT set_config('app.inventory_actor_id',$1,true), set_config('app.inventory_payload_hash',$2,true)",
    [terminalId,randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32)]
  );
  await admin.query(
    `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,$4,1,'OPENING_BALANCE')`,[tenantId,storeId,productId,randomUUID()]
  );
  await admin.query("COMMIT");
  console.log("[integration] sequence 5 sale after VOID checkpoint");
  const postVoidSale5=await makeRecoveryMessage(5);
  const postVoidCommit=await commitSale(runtimeEnv,postVoidSale5);
  if(postVoidCommit!=="committed") throw new Error("SALE_AFTER_VOID_DID_NOT_COMMIT");
  const checkpointAfterSale5=await admin.query(
    `SELECT last_committed_seq_no,last_resolved_seq_no,last_hlc_physical_ms,last_resolved_hlc_physical_ms
       FROM terminal_sync_state WHERE tenant_id=$1 AND terminal_id=$2`,
    [tenantId,terminalId]
  );
  const cp5=checkpointAfterSale5.rows[0];
  if(Number(cp5?.last_committed_seq_no)!==5||Number(cp5?.last_resolved_seq_no)!==5||
     Number(cp5?.last_resolved_hlc_physical_ms)<Number(cp5?.last_hlc_physical_ms)) {
    throw new Error("POST_VOID_SALE5_CHECKPOINT_ASSERTION_FAILED");
  }

  // REV-002: a sale commit racing an operator VOID must converge on exactly
  // one terminal outcome. The winner is serialized by terminal_sync_state FOR UPDATE.
  async function adjustTestInventory(delta:number):Promise<void> {
    if (!Number.isSafeInteger(delta) || delta===0) throw new Error("INVALID_TEST_INVENTORY_DELTA");
    await admin.query("BEGIN");
    await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
    await admin.query(
      "SELECT set_config('app.inventory_actor_id',$1,true), set_config('app.inventory_payload_hash',$2,true)",
      [terminalId,randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32)]
    );
    await admin.query(
      `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
       VALUES($1,$2,$3,$4,$5,'STOCK_ADJUSTMENT')`,
      [tenantId,storeId,productId,randomUUID(),delta]
    );
    await admin.query("COMMIT");
  }

  console.log("[integration] REV-002 commit versus VOID race, sequence 6");
  const commitVoidMessage=await makeRecoveryMessage(6);
  await expectRecoverableStockFailure(commitVoidMessage);
  await adjustTestInventory(1);
  const commitVoidInput={
    tenantId,terminalId,terminalSeqNo:6,disposition:"VOID" as const,
    requestId:randomUUID(),actorSubject:"integration-recovery-admin",
    reason:"Race exact sale commit against operator VOID"
  };
  const [commitVoidSettled,voidRaceSettled]=await Promise.allSettled([
    commitSale(runtimeEnv,commitVoidMessage),
    resolveFailedSequence(runtimeEnv,commitVoidInput)
  ]);
  if (commitVoidSettled.status==="rejected") {
    throw new Error(`COMMIT_VS_VOID_COMMIT_FAILED:${commitVoidSettled.reason instanceof Error?commitVoidSettled.reason.message:"unknown"}`);
  }
  if (voidRaceSettled.status==="rejected") {
    throw new Error(`COMMIT_VS_VOID_RESOLUTION_FAILED:${voidRaceSettled.reason instanceof Error?voidRaceSettled.reason.message:"unknown"}`);
  }
  const commitVoidResult=commitVoidSettled.value;
  const voidRaceResult=voidRaceSettled.value;
  if ((commitVoidResult!=="committed" && commitVoidResult!=="voided") ||
      (voidRaceResult.outcome!=="COMMITTED" && voidRaceResult.outcome!=="VOIDED") ||
      (commitVoidResult==="committed" && voidRaceResult.outcome!=="COMMITTED") ||
      (commitVoidResult==="voided" && voidRaceResult.outcome!=="VOIDED")) {
    throw new Error("COMMIT_VS_VOID_RACE_DID_NOT_CONVERGE");
  }
  const commitVoidAudit=await admin.query(
    `SELECT
       (SELECT COUNT(*)::int FROM sales WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=6) AS sales,
       (SELECT COUNT(*)::int FROM terminal_sequence_resolutions
         WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=6 AND disposition='VOID') AS voids,
       (SELECT last_committed_seq_no FROM terminal_sync_state WHERE tenant_id=$1 AND terminal_id=$2) AS committed,
       (SELECT last_resolved_seq_no FROM terminal_sync_state WHERE tenant_id=$1 AND terminal_id=$2) AS resolved`,
    [tenantId,terminalId]
  );
  const commitVoidState=commitVoidAudit.rows[0];
  if (Number(commitVoidState?.sales)!==(commitVoidResult==="committed"?1:0) ||
      Number(commitVoidState?.voids)!==(commitVoidResult==="voided"?1:0) ||
      Number(commitVoidState?.committed)!==(commitVoidResult==="committed"?6:5) ||
      Number(commitVoidState?.resolved)!==6) {
    throw new Error("COMMIT_VS_VOID_CREATED_OVERLAPPING_OR_INCOMPLETE_OUTCOMES");
  }

  // Leave the shared fixture product at zero stock so sequence 7 first fails,
  // then race an exact commit with the operator RETRY authorization.
  const balanceBeforeRetryRace=await admin.query(
    `SELECT quantity FROM inventory_balances WHERE tenant_id=$1 AND store_id=$2 AND product_id=$3`,
    [tenantId,storeId,productId]
  );
  const quantityBeforeRetryRace=Number(balanceBeforeRetryRace.rows[0]?.quantity ?? 0);
  if (quantityBeforeRetryRace>0) await adjustTestInventory(-quantityBeforeRetryRace);
  console.log("[integration] REV-002 commit versus RETRY race, sequence 7");
  const commitRetryMessage=await makeRecoveryMessage(7);
  await expectRecoverableStockFailure(commitRetryMessage);
  await adjustTestInventory(1);
  const commitRetryInput={
    tenantId,terminalId,terminalSeqNo:7,disposition:"RETRY" as const,
    requestId:randomUUID(),actorSubject:"integration-recovery-admin",
    reason:"Race exact sale commit against operator RETRY"
  };
  const [commitRetrySettled,retryRaceSettled]=await Promise.allSettled([
    commitSale(runtimeEnv,commitRetryMessage),
    resolveFailedSequence(runtimeEnv,commitRetryInput)
  ]);
  if (commitRetrySettled.status==="rejected") {
    throw new Error(`COMMIT_VS_RETRY_COMMIT_FAILED:${commitRetrySettled.reason instanceof Error?commitRetrySettled.reason.message:"unknown"}`);
  }
  if (retryRaceSettled.status==="rejected") {
    throw new Error(`COMMIT_VS_RETRY_RESOLUTION_FAILED:${retryRaceSettled.reason instanceof Error?retryRaceSettled.reason.message:"unknown"}`);
  }
  const commitRetryResult=commitRetrySettled.value;
  const retryRaceResult=retryRaceSettled.value;
  if ((commitRetryResult!=="committed" && commitRetryResult!=="duplicate") ||
      (retryRaceResult.outcome!=="RETRY" && retryRaceResult.outcome!=="COMMITTED")) {
    throw new Error("COMMIT_VS_RETRY_RACE_DID_NOT_CONVERGE");
  }
  const retryRaceReplay=await resolveFailedSequence(runtimeEnv,commitRetryInput);
  const retryRaceState=await admin.query(
    `SELECT COUNT(*)::int AS sales,
            (SELECT last_committed_seq_no FROM terminal_sync_state WHERE tenant_id=$1 AND terminal_id=$2) AS committed,
            (SELECT last_resolved_seq_no FROM terminal_sync_state WHERE tenant_id=$1 AND terminal_id=$2) AS resolved
       FROM sales WHERE tenant_id=$1 AND terminal_id=$2 AND terminal_seq_no=7`,
    [tenantId,terminalId]
  );
  if (retryRaceReplay.outcome!=="COMMITTED" || Number(retryRaceState.rows[0]?.sales)!==1 ||
      Number(retryRaceState.rows[0]?.committed)!==7 || Number(retryRaceState.rows[0]?.resolved)!==7) {
    throw new Error("COMMIT_VS_RETRY_RACE_DID_NOT_CONVERGE_TO_ONE_COMMITTED_SALE");
  }

  const recoveryAudit=await admin.query(
    `SELECT action FROM audit_logs WHERE tenant_id=$1
      AND action IN ('POS_TERMINAL_SEQUENCE_FAILED','POS_TERMINAL_SEQUENCE_RETRY_AUTHORIZED',
                    'POS_TERMINAL_SEQUENCE_RETRY_FAILED','POS_TERMINAL_SEQUENCE_VOIDED')`,
    [tenantId]
  );
  const recoveryActions=recoveryAudit.rows.map((row)=>row.action);
  for(const action of ["POS_TERMINAL_SEQUENCE_FAILED","POS_TERMINAL_SEQUENCE_RETRY_AUTHORIZED","POS_TERMINAL_SEQUENCE_RETRY_FAILED","POS_TERMINAL_SEQUENCE_VOIDED"]) {
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
    "SELECT set_config('app.inventory_actor_id',$1,true), set_config('app.inventory_payload_hash',$2,true)",
    [terminalId,randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32)]
  );
  await admin.query(
    `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,$4,1,'OPENING_BALANCE')`,
    [tenantId,storeId,raceProductId,randomUUID()]
  );
  await admin.query("COMMIT");

  async function attemptFinalUnit(referenceId:string):Promise<"committed"|"rejected"> {
    const client=new Client({connectionString:adminUrl});
    await client.connect();
    try {
      await client.query("SET SESSION AUTHORIZATION prodx_inventory_admin");
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
      await client.query(
        "SELECT set_config('app.inventory_actor_id',$1,true), set_config('app.inventory_payload_hash',$2,true)",
        [terminalId,randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32)]
      );
      await client.query(
        `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
         VALUES($1,$2,$3,$4,-1,'STOCK_ADJUSTMENT')`,
        [tenantId,storeId,raceProductId,referenceId]
      );
      await client.query("COMMIT");
      return "committed";
    } catch (error) {
      await client.query("ROLLBACK").catch(()=>undefined);
      const dbErr=error as {code?:string;message?:string};
      if (dbErr?.code==="PZ001" || (dbErr?.code==="23514" && String(dbErr.message??"").includes("INSUFFICIENT_STOCK"))) {
        return "rejected";
      }
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
            (SELECT COUNT(*) FROM inventory_ledger l WHERE l.tenant_id=$1 AND l.store_id=$2 AND l.product_id=$3 AND l.reason='STOCK_ADJUSTMENT') AS adjustment_count
       FROM inventory_balances b WHERE b.tenant_id=$1 AND b.store_id=$2 AND b.product_id=$3`,
    [tenantId,storeId,raceProductId]
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
