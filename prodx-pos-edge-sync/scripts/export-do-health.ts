import { writeFile } from "node:fs/promises";

const endpoint=process.env.POS_SYNC_URL;
const token=process.env.POS_PROXY_TOKEN;
const bypass=process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const terminalIdsRaw=process.env.POS_TERMINAL_IDS;
const outputPath=process.env.POS_DO_HEALTH_CSV??"do-outbox-export.csv";
if(!endpoint||!token||!bypass||!terminalIdsRaw) throw new Error("Set POS_SYNC_URL (Vercel Preview proxy base), POS_PROXY_TOKEN, VERCEL_AUTOMATION_BYPASS_SECRET, and POS_TERMINAL_IDS (JSON UUID array)");
const terminalIds=JSON.parse(terminalIdsRaw) as string[];
if(!Array.isArray(terminalIds)||terminalIds.length===0||terminalIds.some((id)=>typeof id!=="string")) throw new Error("POS_TERMINAL_IDS must be a non-empty JSON UUID array");

function csv(value:unknown):string{
  const text=value===null||value===undefined?"":String(value);
  return `"${text.replace(/"/g,'""')}"`;
}
const columns=["tenant_id","terminal_id","idempotency_key","state","failure_code","terminal_seq_no","last_hlc_physical_ms","last_hlc_logical","gap_from_seq_no","gap_to_seq_no","updated_at"];
const output=[columns.join(",")];
for(const terminalId of terminalIds){
  const url=new URL(`${endpoint.replace(/\/$/,"")}/api/v1/ops/terminal-sync-diagnostics`);
  url.searchParams.set("terminal_id",terminalId);
  const response=await fetch(url,{headers:{authorization:`Bearer ${token}`,"x-vercel-protection-bypass":bypass,"x-vercel-set-bypass-cookie":"true"}});
  if(!response.ok) throw new Error(`diagnostics failed for terminal ${terminalId}: HTTP ${response.status}`);
  const data=await response.json() as {
    tenant_id:string;terminal_id:string;last_contiguous_seq_no:number;last_hlc_physical_ms:number;last_hlc_logical:number;exported_at:string;
    pending_count:number;pending_truncated:boolean;
    pending_outbox:Array<{idempotency_key:string;state:string;failure_code:string|null;terminal_seq_no:number|null;updated_at:string}>;
    sequence_gaps:Array<{gap_from_seq_no:number;gap_to_seq_no:number;detected_at:string}>;
  };
  output.push([data.tenant_id,data.terminal_id,"","CHECKPOINT","",data.last_contiguous_seq_no,
    data.last_hlc_physical_ms,data.last_hlc_logical,"","",data.exported_at].map(csv).join(","));
  if(data.pending_truncated) throw new Error(`DO outbox export truncated for ${terminalId}: ${data.pending_outbox.length}/${data.pending_count}; add pagination before reconciliation`);
  for(const row of data.pending_outbox){
    output.push([data.tenant_id,data.terminal_id,row.idempotency_key,row.state,row.failure_code,row.terminal_seq_no,"","","","",row.updated_at].map(csv).join(","));
  }
  for(const gap of data.sequence_gaps){
    output.push([data.tenant_id,data.terminal_id,"","SEQUENCE_GAP","","","","",gap.gap_from_seq_no,gap.gap_to_seq_no,gap.detected_at].map(csv).join(","));
  }
}
await writeFile(outputPath,output.join("\n")+"\n","utf8");
console.log(JSON.stringify({result:"EXPORTED",terminals:terminalIds.length,rows:output.length-1,path:outputPath},null,2));
