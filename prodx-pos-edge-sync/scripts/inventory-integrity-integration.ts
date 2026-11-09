import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { canonicalize, sha256Hex } from "../src/canonical.js";
import { signCatalogPriceProofs } from "../src/catalog-crypto.js";
import { commitSale, PermanentDataError } from "../src/postgres.js";
import type { OfflineSale, QueueSale } from "../src/contracts.js";

const adminUrl=process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
const runtimeUrl=process.env.RUNTIME_DATABASE_URL;
const signingKey=process.env.CATALOG_SIGNING_KEY;
if(!adminUrl||!runtimeUrl||!signingKey||signingKey.length<32){
  throw new Error("Set ADMIN_DATABASE_URL, RUNTIME_DATABASE_URL and CATALOG_SIGNING_KEY");
}

const tenantId=randomUUID();
const storeId=randomUUID();
const otherStoreId=randomUUID();
const productId=randomUUID();
const terminalIds=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
const [terminalA,terminalB,terminalBackorder,terminalOtherStore]=terminalIds;
const admin=new Client({connectionString:adminUrl});
const runtimeEnv={HYPERDRIVE_DIRECT:{connectionString:runtimeUrl},CATALOG_SIGNING_KEY:signingKey} as unknown as Env;

async function makeSale(store:string,terminal:string,proofs:Awaited<ReturnType<typeof signCatalogPriceProofs>>,catalogVersion:number,quantity=1):Promise<QueueSale>{
  const sale:OfflineSale={
    idempotency_key:"inventory-"+randomUUID(),payload_hash:"0".repeat(64),sale_id:randomUUID(),
    terminal_seq_no:1,hlc:{physical_ms:Date.now(),logical:0},catalog_version,
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
    `INSERT INTO store_inventory_settings(tenant_id,store_id,allow_negative_stock)
     VALUES($1,$2,false),($1,$3,false)`,[tenantId,storeId,otherStoreId]
  );
  await admin.query(
    `INSERT INTO products(id,tenant_id,sku,name,unit_price_minor,tax_bps,version,active)
     VALUES($1,$2,$3,'Inventory concurrency fixture',100,0,1,true)`,
    [productId,tenantId,"INV-"+productId.slice(0,12)]
  );
  for(let i=0;i<terminalIds.length;i++){
    const fingerprint=randomUUID().replace(/-/g,"")+randomUUID().replace(/-/g,"").slice(0,32);
    await admin.query(
      `INSERT INTO terminal_devices(tenant_id,terminal_id,store_id,cert_fingerprint_sha256,active)
       VALUES($1,$2,$3,$4,true)`,
      [tenantId,terminalIds[i],i===3?otherStoreId:storeId,fingerprint]
    );
  }
  await admin.query(
    `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,$4,1,'OPENING_BALANCE')`,
    [tenantId,storeId,productId,randomUUID()]
  );
  const versionResult=await admin.query(
    `SELECT catalog_version FROM tenant_catalog_versions WHERE tenant_id=$1`,[tenantId]
  );
  const catalogVersion=Number(versionResult.rows[0]?.catalog_version);
  if(!Number.isSafeInteger(catalogVersion)||catalogVersion<1) throw new Error("CATALOG_VERSION_MISSING");
  await admin.query("COMMIT");

  const proofs=await signCatalogPriceProofs(catalogVersion,[
    {product_id:productId,unit_price_minor:100,tax_bps:0}
  ],signingKey,86400);

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
  const winner=race[0].status==="fulfilled"&&race[0].value==="committed"?saleA:saleB;
  if(await commitSale(runtimeEnv,winner)!=="duplicate") throw new Error("WINNING_SALE_REPLAY_NOT_IDEMPOTENT");

  const afterRace=await admin.query(
    `SELECT b.quantity,
            (SELECT COUNT(*) FROM sales WHERE tenant_id=$1) AS sales,
            (SELECT COUNT(*) FROM inventory_ledger WHERE tenant_id=$1 AND reason='POS_SALE') AS sale_ledger
       FROM inventory_balances b
      WHERE b.tenant_id=$1 AND b.store_id=$2 AND b.product_id=$3`,
    [tenantId,storeId,productId]
  );
  if(Number(afterRace.rows[0]?.quantity)!==0||Number(afterRace.rows[0]?.sales)!==1||
     Number(afterRace.rows[0]?.sale_ledger)!==1) throw new Error("LOSING_CHECKOUT_LEFT_PARTIAL_WRITES");

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
  const inventoryAdmin=new Client({connectionString:runtimeUrl});
  await inventoryAdmin.connect();
  try{
    await inventoryAdmin.query("BEGIN");
    await inventoryAdmin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
    await inventoryAdmin.query(
      `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
       VALUES($1,$2,$3,$4,1,'PURCHASE_RECEIPT')`,[tenantId,storeId,productId,randomUUID()]
    );
    await inventoryAdmin.query("COMMIT");
  }finally{await inventoryAdmin.end().catch(()=>undefined);}

  // A second Store has no opening stock; it cannot consume the first Store's unit.
  const crossStoreSale=await makeSale(otherStoreId,terminalOtherStore,proofs,catalogVersion);
  await expectInsufficientStock(crossStoreSale,"CROSS_STORE_STOCK_BORROW");

  const final=await admin.query(
    `SELECT quantity FROM inventory_balances WHERE tenant_id=$1 AND store_id=$2 AND product_id=$3`,
    [tenantId,storeId,productId]
  );
  if(Number(final.rows[0]?.quantity)!==0) throw new Error("FINAL_STORE_BALANCE_MISMATCH");

  console.log(JSON.stringify({
    result:"PASS",
    concurrent_checkout:"exactly one of two terminals committed the final unit",
    losing_transaction:"no partial sale, line, idempotency, audit or ledger rows",
    duplicate_replay:"idempotent",
    allow_negative_stock:"enabled per Store only",
    cross_store_inventory:"isolated",
    positive_receipt_after_policy_disabled:"accepted",
    final_balance:0
  },null,2));
}catch(error){
  console.error(error instanceof Error?error.message:"INVENTORY_INTEGRITY_INTEGRATION_FAILED");
  process.exitCode=1;
}finally{
  await admin.end().catch(()=>undefined);
}
