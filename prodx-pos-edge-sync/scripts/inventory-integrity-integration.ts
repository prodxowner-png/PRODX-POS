import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { assertDisposableCiDatabasePair } from "./test-database-guard.js";
import { canonicalize, sha256Hex } from "../src/canonical.js";
import { signCatalogPriceProofs } from "../src/catalog-crypto.js";
import { commitSale, PermanentDataError } from "../src/postgres.js";
import type { OfflineSale, QueueSale } from "../src/contracts.js";

const { adminUrl, runtimeUrl } = assertDisposableCiDatabasePair(
  process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
  process.env.RUNTIME_DATABASE_URL,
  "inventory-integrity-integration.ts",
);
const signingKey=process.env.CATALOG_SIGNING_KEY;
if(!signingKey||signingKey.length<32){
  throw new Error("Set ADMIN_DATABASE_URL, RUNTIME_DATABASE_URL and CATALOG_SIGNING_KEY");
}

const tenantId=randomUUID();
const storeId=randomUUID();
const otherStoreId=randomUUID();
const productId=randomUUID();
const auditProductId=randomUUID();
const terminalIds=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
const [terminalA,terminalB,terminalBackorder,terminalOtherStore]=terminalIds;
const admin=new Client({connectionString:adminUrl});
const runtimeEnv={HYPERDRIVE_DIRECT:{connectionString:runtimeUrl},CATALOG_SIGNING_KEY:signingKey} as unknown as Env;

async function makeSale(store:string,terminal:string,proofs:Awaited<ReturnType<typeof signCatalogPriceProofs>>,catalogVersion:number,quantity=1):Promise<QueueSale>{
  const sale:OfflineSale={
    idempotency_key:"inventory-"+randomUUID(),payload_hash:"0".repeat(64),sale_id:randomUUID(),
    terminal_seq_no:1,hlc:{physical_ms:Date.now(),logical:0},catalog_version:catalogVersion,
    signed_price_proofs:proofs,client_recorded_at:new Date().toISOString(),currency:"THB",
    lines:[{product_id:productId,quantity,unit_price_minor:100,tax_bps:0}]
  };
  const {payload_hash:_ignored,...hashable}=sale;
  sale.payload_hash=await sha256Hex(canonicalize({tenant_id:tenantId,terminal_id:terminal,sale:hashable}));
  return {
    tenant_id:tenantId,terminal_id:terminal,store_id:store,idempotency_key:sale.idempotency_key,
    payload_hash:sale.payload_hash,do_name:tenantId+":"+terminal,sale,
    edge_received_at:new Date().toISOString(),receipt_id:randomUUID()
  };
}

async function expectInsufficientStock(message:QueueSale,label:string):Promise<void>{
  try{await commitSale(runtimeEnv,message);}
  catch(error){
    if(error instanceof PermanentDataError && error.message==="INSUFFICIENT_STOCK") return;
    throw error;
  }
  throw new Error(label+"_WAS_ACCEPTED");
}

try{
  await admin.connect();
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
  await admin.query(
    `INSERT INTO pos_stores(id,tenant_id,name,is_default)
     VALUES($1,$2,'Concurrency Store',true),($3,$2,'Isolated Store',false)`,
    [storeId,tenantId,otherStoreId]
  );
  await admin.query(
    `INSERT INTO products(id,tenant_id,sku,name,unit_price_minor,tax_bps,version,active)
     VALUES($1,$2,$3,'Inventory concurrency fixture',100,0,1,true),
           ($4,$2,$5,'Inventory audit-role fixture',100,0,1,true)`,
    [productId,tenantId,"INV-"+productId.slice(0,12),auditProductId,"AUD-"+auditProductId.slice(0,12)]
  );
  for(let i=0;i<terminalIds.length;i++){
    const fingerprint=randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32);
    await admin.query(
      `INSERT INTO terminal_devices(tenant_id,terminal_id,store_id,cert_fingerprint_sha256,active)
       VALUES($1,$2,$3,$4,true)`,
      [tenantId,terminalIds[i],i===3?otherStoreId:storeId,fingerprint]
    );
  }

  // Commit the disposable fixture so the separately authenticated inventory-admin
  // connection can see its Store policy and product under normal transaction isolation.
  await admin.query("COMMIT");
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);

  // Exercise the actual inventory-admin database role, not only the superuser test
  // connection. Direct INSERT without audit context must fail; a valid direct INSERT
  // must commit exactly one immutable audit event from the database trigger.
  const inventoryAdmin=new Client({connectionString:adminUrl});
  await inventoryAdmin.connect();
  try{
    await inventoryAdmin.query("SET SESSION AUTHORIZATION prodx_inventory_admin");
    await inventoryAdmin.query("BEGIN");
    await inventoryAdmin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
    const roleRejectedReferenceId=randomUUID();
    let inventoryAdminMissingContextRejected=false;
    try{
      await inventoryAdmin.query(
        `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
         VALUES($1,$2,$3,$4,1,'STOCK_ADJUSTMENT')`,
        [tenantId,storeId,auditProductId,roleRejectedReferenceId]
      );
    }catch(error){
      const e=error as {code?:string;message?:string};
      inventoryAdminMissingContextRejected=e.code==="23514"&&String(e.message).includes("INVENTORY_AUDIT_CONTEXT_REQUIRED");
    }
    await inventoryAdmin.query("ROLLBACK");
    if(!inventoryAdminMissingContextRejected) throw new Error("INVENTORY_ADMIN_BYPASSED_MANDATORY_AUDIT_CONTEXT");

    const roleAuditedReferenceId=randomUUID();
    await inventoryAdmin.query("BEGIN");
    await inventoryAdmin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
    await inventoryAdmin.query(
      "SELECT set_config('app.inventory_actor_id',$1,true), set_config('app.inventory_payload_hash',$2,true)",
      [terminalA,randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32)]
    );
    await inventoryAdmin.query(
      `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
       VALUES($1,$2,$3,$4,1,'STOCK_ADJUSTMENT')`,
      [tenantId,storeId,auditProductId,roleAuditedReferenceId]
    );
    await inventoryAdmin.query("COMMIT");
    const roleAudit=await admin.query(
      `SELECT COUNT(*)::integer AS count FROM audit_logs
        WHERE tenant_id=$1 AND entity_id=$2 AND action='INVENTORY_ADJUSTMENT_RECORDED'`,
      [tenantId,roleAuditedReferenceId]
    );
    if(Number(roleAudit.rows[0]?.count)!==1) throw new Error("INVENTORY_ADMIN_DIRECT_INSERT_MISSING_AUDIT");
  }finally{
    await inventoryAdmin.end();
  }

  // The audit row must share the ledger transaction: rolling back a valid movement
  // must remove the audit, ledger, and balance effects together.
  const rolledBackReferenceId=randomUUID();
  await admin.query(
    "SELECT set_config('app.inventory_actor_id',$1,true), set_config('app.inventory_payload_hash',$2,true)",
    [terminalA,randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32)]
  );
  await admin.query("SAVEPOINT inventory_audit_rollback_attempt");
  await admin.query(
    `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,$4,1,'STOCK_ADJUSTMENT')`,
    [tenantId,storeId,productId,rolledBackReferenceId]
  );
  const inTransactionAudit=await admin.query(
    `SELECT (SELECT COUNT(*) FROM inventory_ledger WHERE tenant_id=$1 AND reference_id=$2) AS ledger,
            (SELECT COUNT(*) FROM inventory_balances WHERE tenant_id=$1 AND store_id=$3 AND product_id=$4) AS balance,
            (SELECT COUNT(*) FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND action='INVENTORY_ADJUSTMENT_RECORDED') AS audit`,
    [tenantId,rolledBackReferenceId,storeId,productId]
  );
  const inTransactionRow=inTransactionAudit.rows[0];
  await admin.query("ROLLBACK TO SAVEPOINT inventory_audit_rollback_attempt");
  await admin.query("RELEASE SAVEPOINT inventory_audit_rollback_attempt");
  if(Number(inTransactionRow?.ledger)!==1||Number(inTransactionRow?.balance)!==1||Number(inTransactionRow?.audit)!==1){
    throw new Error("INVENTORY_LEDGER_AND_AUDIT_NOT_ATOMIC");
  }
  const rolledBackEffects=await admin.query(
    `SELECT (SELECT COUNT(*) FROM inventory_ledger WHERE tenant_id=$1 AND reference_id=$2) AS ledger,
            (SELECT COUNT(*) FROM inventory_balances WHERE tenant_id=$1 AND store_id=$3 AND product_id=$4) AS balance,
            (SELECT COUNT(*) FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2) AS audit`,
    [tenantId,rolledBackReferenceId,storeId,productId]
  );
  const rolledBackRow=rolledBackEffects.rows[0];
  if(Number(rolledBackRow?.ledger)!==0||Number(rolledBackRow?.balance)!==0||Number(rolledBackRow?.audit)!==0){
    throw new Error("INVENTORY_AUDIT_ROLLBACK_LEFT_PARTIAL_EFFECTS");
  }
  await admin.query(
    "SELECT set_config('app.inventory_actor_id','',true), set_config('app.inventory_payload_hash','',true)"
  );


  // A malformed payload hash must be rejected even when the actor identity is present.
  const malformedAuditReferenceId=randomUUID();
  await admin.query(
    "SELECT set_config('app.inventory_actor_id',$1,true), set_config('app.inventory_payload_hash',$2,true)",
    [terminalA,"not-a-sha256"]
  );
  await admin.query("SAVEPOINT malformed_inventory_audit_attempt");
  let malformedAuditHashRejected=false;
  try{
    await admin.query(
      `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
       VALUES($1,$2,$3,$4,1,'STOCK_ADJUSTMENT')`,
      [tenantId,storeId,productId,malformedAuditReferenceId]
    );
  }catch(error){
    const e=error as {code?:string;message?:string};
    malformedAuditHashRejected=e.code==="23514"&&String(e.message).includes("INVENTORY_AUDIT_CONTEXT_REQUIRED");
  }
  await admin.query("ROLLBACK TO SAVEPOINT malformed_inventory_audit_attempt");
  await admin.query("RELEASE SAVEPOINT malformed_inventory_audit_attempt");
  if(!malformedAuditHashRejected) throw new Error("MALFORMED_INVENTORY_AUDIT_HASH_ACCEPTED");
  await admin.query(
    "SELECT set_config('app.inventory_actor_id','',true), set_config('app.inventory_payload_hash','',true)"
  );

  // Replaying one adjustment reference for the same product and reason must not
  // create a second stock effect.
  const duplicateReferenceId=randomUUID();
  const duplicateReferenceHash=randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32);
  await admin.query(
    "SELECT set_config('app.inventory_actor_id',$1,true), set_config('app.inventory_payload_hash',$2,true)",
    [terminalA,duplicateReferenceHash]
  );
  await admin.query("SAVEPOINT duplicate_inventory_reference_outer");
  await admin.query(
    `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,$4,1,'STOCK_ADJUSTMENT')`,
    [tenantId,storeId,productId,duplicateReferenceId]
  );
  await admin.query("SAVEPOINT duplicate_inventory_reference_replay");
  let duplicateReferenceRejected=false;
  try{
    await admin.query(
      `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
       VALUES($1,$2,$3,$4,1,'STOCK_ADJUSTMENT')`,
      [tenantId,storeId,productId,duplicateReferenceId]
    );
  }catch(error){
    const e=error as {code?:string;constraint?:string};
    duplicateReferenceRejected=e.code==="23505"&&e.constraint==="uq_inventory_ledger_reference_product_reason";
  }
  await admin.query("ROLLBACK TO SAVEPOINT duplicate_inventory_reference_replay");
  await admin.query("RELEASE SAVEPOINT duplicate_inventory_reference_replay");
  const firstMovement=await admin.query(
    `SELECT (SELECT COUNT(*) FROM inventory_ledger WHERE tenant_id=$1 AND reference_id=$2) AS ledger,
            (SELECT COUNT(*) FROM inventory_balances WHERE tenant_id=$1 AND store_id=$3 AND product_id=$4) AS balance_rows,
            (SELECT COALESCE(MAX(quantity),0) FROM inventory_balances WHERE tenant_id=$1 AND store_id=$3 AND product_id=$4) AS quantity,
            (SELECT COUNT(*) FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2 AND action='INVENTORY_ADJUSTMENT_RECORDED') AS audit`,
    [tenantId,duplicateReferenceId,storeId,productId]
  );
  const firstMovementRow=firstMovement.rows[0];
  await admin.query("ROLLBACK TO SAVEPOINT duplicate_inventory_reference_outer");
  await admin.query("RELEASE SAVEPOINT duplicate_inventory_reference_outer");
  if(!duplicateReferenceRejected||Number(firstMovementRow?.ledger)!==1||Number(firstMovementRow?.balance_rows)!==1||Number(firstMovementRow?.quantity)!==1||Number(firstMovementRow?.audit)!==1){
    throw new Error("INVENTORY_REFERENCE_ID_REUSE_CREATED_DUPLICATE_EFFECT");
  }
  const duplicateRollback=await admin.query(
    `SELECT (SELECT COUNT(*) FROM inventory_ledger WHERE tenant_id=$1 AND reference_id=$2) AS ledger,
            (SELECT COUNT(*) FROM inventory_balances WHERE tenant_id=$1 AND store_id=$3 AND product_id=$4) AS balance,
            (SELECT COUNT(*) FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2) AS audit`,
    [tenantId,duplicateReferenceId,storeId,productId]
  );
  const duplicateRollbackRow=duplicateRollback.rows[0];
  if(Number(duplicateRollbackRow?.ledger)!==0||Number(duplicateRollbackRow?.balance)!==0||Number(duplicateRollbackRow?.audit)!==0){
    throw new Error("DUPLICATE_REFERENCE_ROLLBACK_LEFT_PARTIAL_EFFECTS");
  }
  await admin.query(
    "SELECT set_config('app.inventory_actor_id','',true), set_config('app.inventory_payload_hash','',true)"
  );

  // An inventory movement must carry an explicit idempotency reference; a random
  // database default would turn a retry with an omitted ID into a second movement.
  const missingReferenceHash=randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32);
  await admin.query(
    "SELECT set_config('app.inventory_actor_id',$1,true), set_config('app.inventory_payload_hash',$2,true)",
    [terminalA,missingReferenceHash]
  );
  await admin.query("SAVEPOINT missing_inventory_reference_attempt");
  let missingReferenceRejected=false;
  try{
    await admin.query(
      `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,quantity_delta,reason)
       VALUES($1,$2,$3,1,'STOCK_ADJUSTMENT')`,
      [tenantId,storeId,productId]
    );
  }catch(error){
    const e=error as {code?:string;message?:string};
    missingReferenceRejected=e.code==="23502"&&String(e.message).includes("INVENTORY_REFERENCE_ID_REQUIRED");
  }
  await admin.query("ROLLBACK TO SAVEPOINT missing_inventory_reference_attempt");
  await admin.query("RELEASE SAVEPOINT missing_inventory_reference_attempt");
  if(!missingReferenceRejected) throw new Error("INVENTORY_LEDGER_REFERENCE_ID_WAS_DEFAULTED");
  const missingReferenceEffects=await admin.query(
    `SELECT (SELECT COUNT(*) FROM inventory_ledger WHERE tenant_id=$1 AND store_id=$2 AND product_id=$3 AND reason='STOCK_ADJUSTMENT') AS ledger,
            (SELECT COUNT(*) FROM inventory_balances WHERE tenant_id=$1 AND store_id=$2 AND product_id=$3) AS balance,
            (SELECT COUNT(*) FROM audit_logs WHERE tenant_id=$1 AND entity_type='INVENTORY_ADJUSTMENT' AND metadata->>'product_id'=$3::text) AS audit`,
    [tenantId,storeId,productId]
  );
  const missingReferenceRow=missingReferenceEffects.rows[0];
  if(Number(missingReferenceRow?.ledger)!==0||Number(missingReferenceRow?.balance)!==0||Number(missingReferenceRow?.audit)!==0){
    throw new Error("MISSING_INVENTORY_REFERENCE_LEFT_PARTIAL_EFFECTS");
  }
  await admin.query(
    "SELECT set_config('app.inventory_actor_id','',true), set_config('app.inventory_payload_hash','',true)"
  );

  // Direct INSERT by an inventory-capable DB role must not bypass the audit trail.
  // Use a savepoint so the pre-fix behavior can be observed without retaining writes.
  const unauditedReferenceId=randomUUID();
  await admin.query("SAVEPOINT unaudited_inventory_attempt");
  let missingAuditContextRejected=false;
  try{
    await admin.query(
      `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
       VALUES($1,$2,$3,$4,1,'STOCK_ADJUSTMENT')`,
      [tenantId,storeId,productId,unauditedReferenceId]
    );
  }catch(error){
    const e=error as {code?:string;message?:string};
    missingAuditContextRejected=e.code==="23514"&&String(e.message).includes("INVENTORY_AUDIT_CONTEXT_REQUIRED");
  }
  await admin.query("ROLLBACK TO SAVEPOINT unaudited_inventory_attempt");
  await admin.query("RELEASE SAVEPOINT unaudited_inventory_attempt");
  if(!missingAuditContextRejected) throw new Error("NON_SALE_INVENTORY_WRITE_BYPASSED_AUDIT_CONTEXT");
  const unauditedWrites=await admin.query(
    `SELECT (SELECT COUNT(*) FROM inventory_ledger WHERE tenant_id=$1 AND reference_id=$2) AS ledger,
            (SELECT COUNT(*) FROM inventory_balances WHERE tenant_id=$1 AND store_id=$3 AND product_id=$4) AS balance,
            (SELECT COUNT(*) FROM audit_logs WHERE tenant_id=$1 AND entity_id=$2) AS audit`,
    [tenantId,unauditedReferenceId,storeId,productId]
  );
  const unauditedRow=unauditedWrites.rows[0];
  if(Number(unauditedRow?.ledger)!==0||Number(unauditedRow?.balance)!==0||Number(unauditedRow?.audit)!==0){
    throw new Error("REJECTED_UNAUDITED_INVENTORY_WRITE_LEFT_PARTIAL_EFFECTS");
  }

  const openingReferenceId=randomUUID();
  const openingPayloadHash=randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32);
  await admin.query(
    "SELECT set_config('app.inventory_actor_id',$1,true), set_config('app.inventory_payload_hash',$2,true)",
    [terminalA,openingPayloadHash]
  );
  await admin.query(
    `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,$4,1,'OPENING_BALANCE')`,
    [tenantId,storeId,productId,openingReferenceId]
  );
  const openingAudit=await admin.query(
    `SELECT COUNT(*)::integer AS count FROM audit_logs
      WHERE tenant_id=$1 AND entity_id=$2 AND action='OPENING_BALANCE_RECORDED'`,
    [tenantId,openingReferenceId]
  );
  if(Number(openingAudit.rows[0]?.count)!==1) throw new Error("OPENING_BALANCE_AUDIT_NOT_ATOMIC");
  const versionResult=await admin.query(
    `SELECT catalog_version FROM tenant_catalog_versions WHERE tenant_id=$1`,[tenantId]
  );
  const catalogVersion=Number(versionResult.rows[0]?.catalog_version);
  if(!Number.isSafeInteger(catalogVersion)||catalogVersion<1) throw new Error("CATALOG_VERSION_MISSING");
  await admin.query("COMMIT");

  const proofs=await signCatalogPriceProofs(catalogVersion,[
    {product_id:productId,unit_price_minor:100,tax_bps:0}
  ],signingKey,86400);

  // A mismatched Store must fail before claiming idempotency or writing any sale,
  // ledger, or audit rows. This protects against malformed/stale Queue envelopes.
  const wrongStoreSale=await makeSale(otherStoreId,terminalA,proofs,catalogVersion);
  let wrongStoreRejected=false;
  try{await commitSale(runtimeEnv,wrongStoreSale);}
  catch(error){
    if(error instanceof PermanentDataError&&error.message==="TERMINAL_STORE_MAPPING_MISMATCH") wrongStoreRejected=true;
    else throw error;
  }
  if(!wrongStoreRejected) throw new Error("MISMATCHED_TERMINAL_STORE_WAS_NOT_REJECTED");
  const wrongStoreWrites=await admin.query(
    `SELECT (SELECT COUNT(*) FROM pos_idempotency WHERE tenant_id=$1 AND idempotency_key=$2) AS idempotency,
            (SELECT COUNT(*) FROM sales WHERE tenant_id=$1 AND sale_id=$3) AS sales,
            (SELECT COUNT(*) FROM inventory_ledger WHERE tenant_id=$1 AND reference_id=$3) AS ledger,
            (SELECT COUNT(*) FROM audit_logs WHERE tenant_id=$1 AND entity_id=$3 AND action='POS_SALE_COMMITTED') AS audit`,
    [tenantId,wrongStoreSale.idempotency_key,wrongStoreSale.sale.sale_id]
  );
  const wrongStoreRow=wrongStoreWrites.rows[0];
  if(Number(wrongStoreRow?.idempotency)!==0||Number(wrongStoreRow?.sales)!==0||
     Number(wrongStoreRow?.ledger)!==0||Number(wrongStoreRow?.audit)!==0){
    throw new Error("MISMATCHED_TERMINAL_STORE_LEFT_PARTIAL_WRITES");
  }

  // A terminal with historical certificates mapped to multiple Stores is ambiguous
  // for legacy Queue envelopes that do not carry store_id; reject without writes.
  const ambiguousFingerprint=randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32);
  await admin.query(
    `INSERT INTO terminal_devices(tenant_id,terminal_id,store_id,cert_fingerprint_sha256,active)
     VALUES($1,$2,$3,$4,true)`,
    [tenantId,terminalA,otherStoreId,ambiguousFingerprint]
  );
  const ambiguousSale=await makeSale(storeId,terminalA,proofs,catalogVersion);
  delete ambiguousSale.store_id;
  let ambiguousStoreRejected=false;
  try{await commitSale(runtimeEnv,ambiguousSale);}
  catch(error){
    if(error instanceof PermanentDataError&&error.message==="TERMINAL_STORE_MAPPING_MISMATCH") ambiguousStoreRejected=true;
    else throw error;
  }
  if(!ambiguousStoreRejected) throw new Error("AMBIGUOUS_TERMINAL_STORE_MAPPING_WAS_NOT_REJECTED");
  const ambiguousWrites=await admin.query(
    `SELECT (SELECT COUNT(*) FROM pos_idempotency WHERE tenant_id=$1 AND idempotency_key=$2) AS idempotency,
            (SELECT COUNT(*) FROM sales WHERE tenant_id=$1 AND sale_id=$3) AS sales,
            (SELECT COUNT(*) FROM inventory_ledger WHERE tenant_id=$1 AND reference_id=$3) AS ledger,
            (SELECT COUNT(*) FROM audit_logs WHERE tenant_id=$1 AND entity_id=$3 AND action='POS_SALE_COMMITTED') AS audit`,
    [tenantId,ambiguousSale.idempotency_key,ambiguousSale.sale.sale_id]
  );
  const ambiguousRow=ambiguousWrites.rows[0];
  if(Number(ambiguousRow?.idempotency)!==0||Number(ambiguousRow?.sales)!==0||
     Number(ambiguousRow?.ledger)!==0||Number(ambiguousRow?.audit)!==0){
    throw new Error("AMBIGUOUS_TERMINAL_STORE_LEFT_PARTIAL_WRITES");
  }

  // Two independent terminals race to sell the final unit. The database transaction
  // must commit exactly one sale; the losing sale must roll back all financial rows.
  const [saleA,saleB]=await Promise.all([
    makeSale(storeId,terminalA,proofs,catalogVersion),
    makeSale(storeId,terminalB,proofs,catalogVersion)
  ]);
  const race=await Promise.allSettled([
    commitSale(runtimeEnv,saleA),
    commitSale(runtimeEnv,saleB)
  ]);
  const committed=race.filter(x=>x.status==="fulfilled"&&x.value==="committed").length;
  const rejected=race.filter(x=>x.status==="rejected"&&x.reason instanceof PermanentDataError&&x.reason.message==="INSUFFICIENT_STOCK").length;
  if(committed!==1||rejected!==1) throw new Error("CONCURRENT_CHECKOUT_DID_NOT_ENFORCE_SINGLE_FINAL_UNIT");
  const winner=race[0]!.status==="fulfilled"&&race[0].value==="committed"?saleA:saleB;
  if(await commitSale(runtimeEnv,winner)!=="duplicate") throw new Error("WINNING_SALE_REPLAY_NOT_IDEMPOTENT");

  const afterRace=await admin.query(
    `SELECT b.quantity,
            (SELECT COUNT(*) FROM sales WHERE tenant_id=$1) AS sales,
            (SELECT COUNT(*) FROM sale_lines WHERE tenant_id=$1) AS sale_lines,
            (SELECT COUNT(*) FROM inventory_ledger WHERE tenant_id=$1 AND reason='POS_SALE') AS sale_ledger,
            (SELECT COUNT(*) FROM pos_idempotency WHERE tenant_id=$1) AS idempotency,
            (SELECT COUNT(*) FROM audit_logs WHERE tenant_id=$1 AND action='POS_SALE_COMMITTED') AS sale_audit
       FROM inventory_balances b
      WHERE b.tenant_id=$1 AND b.store_id=$2 AND b.product_id=$3`,
    [tenantId,storeId,productId]
  );
  const row=afterRace.rows[0];
  if(Number(row?.quantity)!==0||Number(row?.sales)!==1||Number(row?.sale_lines)!==1||
     Number(row?.sale_ledger)!==1||Number(row?.idempotency)!==1||Number(row?.sale_audit)!==1) {
    throw new Error("LOSING_CHECKOUT_LEFT_PARTIAL_WRITES");
  }

  // Backorders are permitted only after the trusted Store setting is enabled.
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
  await admin.query(
    `UPDATE store_inventory_settings SET allow_negative_stock=true,updated_at=now(),updated_by=$3,
       last_change_hash=$4,last_change_id=$5 WHERE tenant_id=$1 AND store_id=$2`,
    [tenantId,storeId,terminalA,randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32),randomUUID()]
  );
  await admin.query("COMMIT");
  const backorder=await makeSale(storeId,terminalBackorder,proofs,catalogVersion);
  // Simulate a pre-migration Durable Object payload without store_id; origin resolves it from terminal_devices.
  delete backorder.store_id;
  if(await commitSale(runtimeEnv,backorder)!=="committed") throw new Error("EXPLICIT_BACKORDER_NOT_COMMITTED");
  const negative=await admin.query(
    `SELECT quantity FROM inventory_balances WHERE tenant_id=$1 AND store_id=$2 AND product_id=$3`,
    [tenantId,storeId,productId]
  );
  if(Number(negative.rows[0]?.quantity)!==-1) throw new Error("EXPLICIT_BACKORDER_POLICY_NOT_HONORED");

  // Turning the policy off must not prevent a positive receipt from repairing a deficit.
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
  await admin.query(
    `UPDATE store_inventory_settings SET allow_negative_stock=false,updated_at=now(),updated_by=$3,
       last_change_hash=$4,last_change_id=$5 WHERE tenant_id=$1 AND store_id=$2`,
    [tenantId,storeId,terminalA,randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32),randomUUID()]
  );
  await admin.query("COMMIT");
  const workerClient=new Client({connectionString:runtimeUrl});
  await workerClient.connect();
  let unauthorizedReceiptRejected=false;
  try{
    await workerClient.query("BEGIN");
    await workerClient.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
    await workerClient.query(
      `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
       VALUES($1,$2,$3,$4,1,'PURCHASE_RECEIPT')`,[tenantId,storeId,productId,randomUUID()]
    );
  }catch(error){
    const e=error as {code?:string;message?:string};
    unauthorizedReceiptRejected=e.code==="42501"&&String(e.message).includes("INVENTORY_ADMIN_ROLE_REQUIRED");
  }finally{
    await workerClient.query("ROLLBACK").catch(()=>undefined);
    await workerClient.end().catch(()=>undefined);
  }
  if(!unauthorizedReceiptRejected) throw new Error("POS_WORKER_CAN_INJECT_INVENTORY_RECEIPTS");

  const receiptReferenceId=randomUUID();
  const receiptPayloadHash=randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32);
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
  await admin.query(
    "SELECT set_config('app.inventory_actor_id',$1,true), set_config('app.inventory_payload_hash',$2,true)",
    [terminalA,receiptPayloadHash]
  );
  await admin.query(
    `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,$4,1,'PURCHASE_RECEIPT')`,[tenantId,storeId,productId,receiptReferenceId]
  );
  const receiptAudit=await admin.query(
    `SELECT COUNT(*)::integer AS count FROM audit_logs
      WHERE tenant_id=$1 AND entity_id=$2 AND action='INVENTORY_ADJUSTMENT_RECORDED'`,
    [tenantId,receiptReferenceId]
  );
  if(Number(receiptAudit.rows[0]?.count)!==1) throw new Error("PURCHASE_RECEIPT_AUDIT_NOT_ATOMIC");
  await admin.query("COMMIT");

  // A second Store has no opening stock; it cannot consume the first Store's unit.
  const crossStoreSale=await makeSale(otherStoreId,terminalOtherStore,proofs,catalogVersion);
  await expectInsufficientStock(crossStoreSale,"CROSS_STORE_STOCK_BORROW");

  const final=await admin.query(
    `SELECT quantity FROM inventory_balances WHERE tenant_id=$1 AND store_id=$2 AND product_id=$3`,
    [tenantId,storeId,productId]
  );
  if(Number(final.rows[0]?.quantity)!==0) throw new Error("FINAL_STORE_BALANCE_MISMATCH");
  const policyAudit=await admin.query(
    `SELECT COUNT(*)::integer AS count FROM audit_logs
      WHERE tenant_id=$1 AND entity_id=$2 AND action='STORE_INVENTORY_POLICY_UPDATED'`,
    [tenantId,storeId]
  );
  if(Number(policyAudit.rows[0]?.count)!==2) throw new Error("STORE_POLICY_CHANGE_AUDIT_MISSING");

  console.log(JSON.stringify({
    result:"PASS",
    mismatched_store:"rejected before any idempotency, sale, ledger or audit write",
    ambiguous_legacy_store:"rejected before any idempotency, sale, ledger or audit write",
    concurrent_checkout:"exactly one of two terminals committed the final unit",
    losing_transaction:"no partial sale, line, idempotency, audit or ledger rows",
    duplicate_replay:"idempotent",
    allow_negative_stock:"enabled per Store only",
    cross_store_inventory:"isolated",
    positive_receipt_after_policy_disabled:"accepted",
    pos_worker_cannot_inject_receipts:unauthorizedReceiptRejected,
    non_sale_inventory_audit:"mandatory and atomic",
    store_policy_changes_audited:2,
    final_balance:0
  },null,2));
}catch(error){
  console.error(error instanceof Error?error.message:"INVENTORY_INTEGRITY_INTEGRATION_FAILED");
  process.exitCode=1;
}finally{
  await admin.end().catch(()=>undefined);
}
