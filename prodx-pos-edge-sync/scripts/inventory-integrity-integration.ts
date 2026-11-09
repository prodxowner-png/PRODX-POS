import { randomUUID } from "node:crypto";
import { Client } from "pg";

const adminUrl=process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL;
const runtimeUrl=process.env.RUNTIME_DATABASE_URL;
if(!adminUrl||!runtimeUrl) throw new Error("Set ADMIN_DATABASE_URL and RUNTIME_DATABASE_URL");

const tenantId=randomUUID();
const storeId=randomUUID();
const otherStoreId=randomUUID();
const productId=randomUUID();
const admin=new Client({connectionString:adminUrl});
const runtimeA=new Client({connectionString:runtimeUrl});
const runtimeB=new Client({connectionString:runtimeUrl});
const runtimeC=new Client({connectionString:runtimeUrl});

async function beginTenant(client:Client):Promise<void>{
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
}
async function ledgerDelta(client:Client,store:string,delta:number,reason:"SUPPLIER_RETURN"|"PURCHASE_RECEIPT"):Promise<void>{
  await client.query(
    `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [tenantId,store,productId,randomUUID(),delta,reason]
  );
}

try{
  await admin.connect();
  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
  await admin.query(
    `INSERT INTO pos_stores(id,tenant_id,name,is_default) VALUES($1,$2,'Concurrency Store',true),($3,$2,'Isolated Store',false)`,
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
  await admin.query(
    `INSERT INTO inventory_ledger(tenant_id,store_id,product_id,reference_id,quantity_delta,reason)
     VALUES($1,$2,$3,$4,1,'OPENING_BALANCE')`,
    [tenantId,storeId,productId,randomUUID()]
  );
  await admin.query("COMMIT");

  await beginTenant(runtimeA);
  await beginTenant(runtimeB);
  await ledgerDelta(runtimeA,storeId,-1,"SUPPLIER_RETURN");
  const competingWrite=ledgerDelta(runtimeB,storeId,-1,"SUPPLIER_RETURN");
  await new Promise(resolve=>setTimeout(resolve,75));
  await runtimeA.query("COMMIT");
  let concurrentRejected=false;
  try{await competingWrite;}
  catch(error){
    const e=error as {code?:string;message?:string};
    concurrentRejected=e.code==="23514"&&String(e.message).includes("INSUFFICIENT_STOCK");
  }
  await runtimeB.query("ROLLBACK").catch(()=>undefined);
  if(!concurrentRejected) throw new Error("CONCURRENT_OVERSELL_WAS_NOT_REJECTED");

  const afterRace=await admin.query(
    `SELECT quantity FROM inventory_balances WHERE tenant_id=$1 AND store_id=$2 AND product_id=$3`,
    [tenantId,storeId,productId]
  );
  if(Number(afterRace.rows[0]?.quantity)!==0) throw new Error("CONCURRENT_BALANCE_NOT_ZERO");

  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
  await admin.query(
    `UPDATE store_inventory_settings SET allow_negative_stock=true,updated_at=now()
     WHERE tenant_id=$1 AND store_id=$2`,[tenantId,storeId]
  );
  await admin.query("COMMIT");

  await beginTenant(runtimeB);
  await ledgerDelta(runtimeB,storeId,-1,"SUPPLIER_RETURN");
  await runtimeB.query("COMMIT");
  const negativeAllowed=await admin.query(
    `SELECT quantity FROM inventory_balances WHERE tenant_id=$1 AND store_id=$2 AND product_id=$3`,
    [tenantId,storeId,productId]
  );
  if(Number(negativeAllowed.rows[0]?.quantity)!==-1) throw new Error("EXPLICIT_BACKORDER_POLICY_NOT_HONORED");

  await admin.query("BEGIN");
  await admin.query("SELECT set_config('app.current_tenant_id',$1,true)",[tenantId]);
  await admin.query(
    `UPDATE store_inventory_settings SET allow_negative_stock=false,updated_at=now()
     WHERE tenant_id=$1 AND store_id=$2`,[tenantId,storeId]
  );
  await admin.query("COMMIT");

  await beginTenant(runtimeC);
  let isolatedStoreRejected=false;
  try{await ledgerDelta(runtimeC,otherStoreId,-1,"SUPPLIER_RETURN");}
  catch(error){const e=error as {code?:string;message?:string};isolatedStoreRejected=e.code==="23514"&&String(e.message).includes("INSUFFICIENT_STOCK");}
  await runtimeC.query("ROLLBACK").catch(()=>undefined);
  if(!isolatedStoreRejected) throw new Error("CROSS_STORE_INVENTORY_ISOLATION_FAILED");

  await beginTenant(runtimeB);
  await ledgerDelta(runtimeB,storeId,1,"PURCHASE_RECEIPT");
  await runtimeB.query("COMMIT");
  const finalBalance=await admin.query(
    `SELECT quantity FROM inventory_balances WHERE tenant_id=$1 AND store_id=$2 AND product_id=$3`,
    [tenantId,storeId,productId]
  );
  if(Number(finalBalance.rows[0]?.quantity)!==0) throw new Error("POSITIVE_RECEIPT_DID_NOT_RECOVER_BALANCE");

  console.log(JSON.stringify({
    result:"PASS",
    concurrent_oversell:"one commit, one rejected",
    explicit_allow_negative_stock:"honored",
    cross_store_isolation:"enforced",
    positive_receipt_after_policy_disabled:"accepted",
    final_balance:0
  },null,2));
}catch(error){
  console.error(error instanceof Error?error.message:"INVENTORY_INTEGRITY_INTEGRATION_FAILED");
  process.exitCode=1;
}finally{
  await Promise.all([admin,runtimeA,runtimeB,runtimeC].map(client=>client.end().catch(()=>undefined)));
}
