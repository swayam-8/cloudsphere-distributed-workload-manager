// Read persisted evidence and safe configuration only. No AWS requests or provisioning.
export async function cloudOverview(store,cfg,batch) {
  const tasks=await store.all('tasks',{execution_provider:'aws_batch'},{created_at:-1},20);
  const ids=tasks.map(t=>t.id);
  const attempts=ids.length?await store.all('attempts',{execution_provider:'aws_batch',task_id:{$in:ids}},{created_at:-1},100):[];
  const audit=ids.length&&cfg.auditTable?await store.all('events',{task_id:{$in:ids},audit_pending:false,audit_table:cfg.auditTable},{timestamp:-1},100):[];
  const compute=[];const seen=new Set();
  for(const a of attempts){const c=a.batch_compute;if(c?.instance_id&&!seen.has(c.instance_id)){seen.add(c.instance_id);compute.push({...c,task_id:a.task_id});}}
  const fields={queue:cfg.batchQueue||null,definition:cfg.batchDefinition||null,bucket:cfg.bucket||null,audit_table:cfg.auditTable||null,log_group:cfg.batchLogGroup||null};
  const requirements=[['queue','Batch queue'],['definition','Approved job definition'],['bucket','Private S3 bucket'],['audit_table','DynamoDB audit table'],['account','Expected AWS account']];
  return {
    mode:cfg.mode,enabled:batch.enabled,account:cfg.expectedAccount||null,region:cfg.mode==='AWS'?cfg.region:null,
    ...fields,missing:requirements.filter(([key])=>!({...fields,account:cfg.expectedAccount})[key]).map(([,label])=>label),
    verification:batch.verification?.()||{status:'not_checked',checked_at:null},
    recent_tasks:tasks.map(t=>Object.fromEntries(['id','name','kind','status','execution_provider','cpu','memory_mb','priority','created_at','started_at','completed_at','batch_job_id','aws_region'].map(k=>[k,t[k]??null]))),
    evidence:{compute,recorded_jobs:tasks.filter(t=>t.batch_job_id).length,completed_jobs:tasks.filter(t=>t.status==='COMPLETED').length,synced_audit_events:audit.length,log_streams:attempts.filter(a=>a.batch_log_stream).length,latest_image:attempts.find(a=>a.batch_image)?.batch_image||null},
    scope:'Recent 20 AWS workloads and persisted observations. These are not a live account-wide inventory or current EC2 running-state check.',
  };
}
