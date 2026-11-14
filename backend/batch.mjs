import { randomUUID } from 'node:crypto';
import { BatchClient, SubmitJobCommand, DescribeJobsCommand, DescribeJobQueuesCommand, DescribeJobDefinitionsCommand, ListJobsCommand, TerminateJobCommand } from '@aws-sdk/client-batch';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CloudWatchLogsClient, GetLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { ECSClient, DescribeContainerInstancesCommand } from '@aws-sdk/client-ecs';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { cloudMetrics } from './storage.mjs';
import { now } from './store.mjs';
import { event } from './scheduler.mjs';

const terminal=['COMPLETED','FAILED','CANCELLED'];
const safeError=e=>String(/^[A-Za-z][A-Za-z0-9]{0,99}$/.test(e.message||'')?e.message:e.name||'CloudOperationFailed').slice(0,100);
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export { batchKeys } from '../jobs/batch-protocol.mjs';
import { batchKeys, readBoundedBody } from '../jobs/batch-protocol.mjs';

export function awsBatchGateway(cfg, clients={}) {
  const batch=clients.batch||new BatchClient({region:cfg.region,maxAttempts:1});
  const s3=clients.s3||new S3Client({region:cfg.region});
  const audit=clients.audit||DynamoDBDocumentClient.from(new DynamoDBClient({region:cfg.region}));
  const logs=clients.logs||new CloudWatchLogsClient({region:cfg.region});
  return {
    async ready(){
      const caller=await (clients.sts||new STSClient({region:cfg.region})).send(new GetCallerIdentityCommand({}));
      if(!cfg.expectedAccount||caller.Account!==cfg.expectedAccount)fail(503,'AWS account does not match CLOUDSPHERE_AWS_ACCOUNT');
      const q=(await batch.send(new DescribeJobQueuesCommand({jobQueues:[cfg.batchQueue]}))).jobQueues?.[0];
      const d=(await batch.send(new DescribeJobDefinitionsCommand({jobDefinitions:[cfg.batchDefinition]}))).jobDefinitions?.[0];
      if(!q||q.state!=='ENABLED'||q.status!=='VALID')fail(503,'Batch queue is not enabled and valid');
      if(!d||d.status!=='ACTIVE'||!d.containerProperties||d.platformCapabilities?.includes('FARGATE'))fail(503,'Configure an active single-container EC2 Batch job definition');
      if(!/@sha256:[0-9a-f]{64}$/.test(d.containerProperties.image||''))fail(503,'Batch job definition must pin the approved ECR image digest');
      const head=await s3.send(new GetObjectCommand({Bucket:cfg.bucket,Key:'cloudsphere/deployment.json'}));
      const deployment=JSON.parse(await readBoundedBody(head.Body,64000));
      if(deployment.protocol!=='cloudsphere-batch-v1'||deployment.image!==d.containerProperties.image)fail(503,'Job definition does not match the deployed CloudSphere image');
      return {account:caller.Account,queue:q.jobQueueArn,definition:d.jobDefinitionArn,image:d.containerProperties.image,job_role:d.containerProperties.jobRoleArn||null,execution_role:d.containerProperties.executionRoleArn||null,protocol:deployment.protocol};
    },
    async putConfig(key,value){await s3.send(new PutObjectCommand({Bucket:cfg.bucket,Key:key,Body:JSON.stringify(value),ContentType:'application/json',ServerSideEncryption:'AES256'}));},
    submit:input=>batch.send(new SubmitJobCommand(input)),
    async describe(id){return (await batch.send(new DescribeJobsCommand({jobs:[id]}))).jobs?.[0];},
    async find(name,queue=cfg.batchQueue){
      const matches=[];let nextToken;
      // Batch has no SubmitJob idempotency token. Never blindly repeat a submission.
      for(let page=0;page<20;page++){
        const response=await batch.send(new ListJobsCommand({jobQueue:queue,filters:[{name:'JOB_NAME',values:[name]}],maxResults:100,nextToken}));
        matches.push(...(response.jobSummaryList||[]).filter(j=>j.jobName===name));nextToken=response.nextToken;
        if(!nextToken)return matches;
      }
      fail(503,'Batch lookup exceeded its bounded page limit; inspect submission manually');
    },
    terminate:id=>batch.send(new TerminateJobCommand({jobId:id,reason:'Cancelled by CloudSphere operator'})),
    async result(key){const response=await s3.send(new GetObjectCommand({Bucket:cfg.bucket,Key:key}));if(response.ContentLength>64000)fail(422,'Batch result metadata exceeds limit');const bytes=await readBoundedBody(response.Body,64000);if(bytes.length>64000)fail(422,'Batch result metadata exceeds limit');return JSON.parse(Buffer.from(bytes));},
    async output(key){const response=await s3.send(new GetObjectCommand({Bucket:cfg.bucket,Key:key}));if(response.ContentLength>10*1024*1024)fail(422,'Batch ZIP exceeds artifact limit');const data=await readBoundedBody(response.Body,10*1024*1024);if(data.length>10*1024*1024||data.subarray(0,2).toString()!=='PK')fail(422,'Invalid Batch output ZIP');return data;},
    async computeRecord(job){
      const container=job.container,parts=(container?.taskArn||'').split(':task/')[1]?.split('/');
      if(!container?.containerInstanceArn||!parts||parts.length<2)return null;
      const cluster=parts[0],ecs=clients.ecs||new ECSClient({region:cfg.region});
      const c=(await ecs.send(new DescribeContainerInstancesCommand({cluster,containerInstances:[container.containerInstanceArn]}))).containerInstances?.[0];
      if(!c?.ec2InstanceId)return null;
      const ec2=clients.ec2||new EC2Client({region:cfg.region});
      const instance=(await ec2.send(new DescribeInstancesCommand({InstanceIds:[c.ec2InstanceId]}))).Reservations?.[0]?.Instances?.[0];
      return {instance_id:c.ec2InstanceId,instance_type:instance?.InstanceType||null,vpc_id:instance?.VpcId||null,subnet_id:instance?.SubnetId||null,cluster,observed_at:now(),observed_state:instance?.State?.Name||null};
    },
    async audit(item){await audit.send(new PutCommand({TableName:cfg.auditTable,Item:item}));},
    async timeline(taskId){return (await audit.send(new QueryCommand({TableName:cfg.auditTable,KeyConditionExpression:'task_id = :id',ExpressionAttributeValues:{':id':taskId},ScanIndexForward:true,Limit:100}))).Items||[];},
    async logs(stream){return (await logs.send(new GetLogEventsCommand({logGroupName:cfg.batchLogGroup,logStreamName:stream,limit:100,startFromHead:false}))).events?.map(e=>({timestamp:e.timestamp,message:e.message}))||[];},
  };
}

export function batchController(store,cfg,gateway=awsBatchGateway(cfg)) {
  const enabled=cfg.mode==='AWS'&&Boolean(cfg.batchQueue&&cfg.batchDefinition&&cfg.auditTable);
  let busy=false,lastVerification={status:'not_checked',checked_at:null};
  async function auditEvent(db,task,kind,message){
    const e=await event(db,kind,message,task.id);
    await db.set('events',e.id,{audit_pending:true,execution_provider:'aws_batch'});
  }
  async function claim(){return store.transaction(async db=>{
    const task=(await db.all('tasks',{execution_provider:'aws_batch',status:'QUEUED'},{created_at:1},1))[0];
    if(!task)return null;
    const attempt=await db.add('attempts',{task_id:task.id,number:1,worker_id:null,execution_provider:'aws_batch',status:'SUBMITTING',created_at:now(),started_at:null,completed_at:null,result:null,logs:'',exit_code:null,error:null,batch_job_id:null});
    await db.set('tasks',task.id,{status:'ASSIGNED',batch_attempt_id:attempt.id});
    await auditEvent(db,task,'BATCH_SUBMITTING','Preparing AWS Batch submission');
    return {task,attempt};
  });}
  async function submit({task,attempt}) {
    const keys=batchKeys(task.id,attempt.id),input=task.input_id?await store.one('artifacts',task.input_id):null;
    try{
      const deployment=await gateway.ready();
      await gateway.putConfig(keys.config,{protocol:'cloudsphere-batch-v1',task:{id:task.id,kind:task.kind,parameters:task.parameters,timeout_seconds:task.timeout_seconds},attempt_id:attempt.id,input:input?{key:`cloudsphere/${input.id}`,extension:input.filename.slice(input.filename.lastIndexOf('.')).toLowerCase(),sha256:input.sha256||null}:null,keys});
      // Mark the external-call boundary durably before making a non-idempotent call.
      const proceed=await store.transaction(async db=>{
        const current=await db.one('tasks',task.id);if(terminal.includes(current.status))return false;
        await db.set('attempts',attempt.id,{status:'SUBMISSION_UNKNOWN',submission_started_at:now(),batch_bucket:cfg.bucket,batch_queue:deployment.queue,batch_definition:deployment.definition,batch_image:deployment.image});return true;
      });
      if(!proceed){await store.set('attempts',attempt.id,{batch_cancel_confirmed:true});return;}
      const response=await gateway.submit({jobName:`cs-${attempt.id}`,jobQueue:deployment.queue,jobDefinition:deployment.definition,
        containerOverrides:{environment:[{name:'CLOUDSPHERE_BATCH_BUCKET',value:cfg.bucket},{name:'CLOUDSPHERE_BATCH_CONFIG_KEY',value:keys.config},{name:'CLOUDSPHERE_TASK_ID',value:task.id},{name:'CLOUDSPHERE_ATTEMPT_ID',value:attempt.id}],resourceRequirements:[{type:'VCPU',value:String(task.cpu)},{type:'MEMORY',value:String(task.memory_mb)}]},
        timeout:{attemptDurationSeconds:Math.max(60,task.timeout_seconds)},retryStrategy:{attempts:task.max_retries+1},tags:{Project:cfg.projectTag,CloudSphereTask:task.id,CloudSphereAttempt:attempt.id}});
      if(!response.jobId)throw new Error('SubmitResponseMissingJobId');
      await attach(task.id,attempt.id,response.jobId);
    }catch(e){
      const a=await store.one('attempts',attempt.id);
      const knownRejected=a.status==='SUBMITTING'||(e.$metadata?.httpStatusCode>=400&&e.$metadata?.httpStatusCode<500&&e.$metadata.httpStatusCode!==408&&e.$metadata.httpStatusCode!==429);
      await store.transaction(async db=>{
        const t=await db.one('tasks',task.id);if(terminal.includes(t.status))return;
        await db.set('attempts',attempt.id,{status:knownRejected?'FAILED':'SUBMISSION_UNKNOWN',error:safeError(e),...(knownRejected?{completed_at:now()}: {})});
        await db.set('tasks',task.id,{...(knownRejected?{status:'FAILED',completed_at:now()}:{}),error:knownRejected?`AWS submission rejected: ${safeError(e)}`:'AWS submission outcome unknown; reconciliation will search for the existing job. No automatic resubmission.'});
        await auditEvent(db,t,'BATCH_SUBMISSION_ERROR',knownRejected?'Submission rejected before execution':'Submission outcome uncertain; automatic resubmission disabled');
      });
    }
  }
  async function attach(taskId,attemptId,jobId){await store.transaction(async db=>{
    const a=await db.one('attempts',attemptId),t=await db.one('tasks',taskId);
    if(a.batch_job_id&&a.batch_job_id!==jobId)fail(409,'Attempt already linked to a different Batch job');
    await db.set('attempts',a.id,{batch_job_id:jobId,status:t.status==='CANCELLED'?'CANCELLED':'BATCH_SUBMITTED'});
    await db.set('tasks',t.id,{batch_job_id:jobId,error:null});
    await auditEvent(db,t,'BATCH_SUBMITTED',`AWS Batch job ${jobId}`);
  });}
  async function reconcile(a){
    const task=await store.one('tasks',a.task_id);
    if(a.batch_bucket&&a.batch_bucket!==cfg.bucket)throw new Error('TaskBucketMismatch');
    if(task.aws_region&&task.aws_region!==cfg.region)throw new Error('TaskRegionMismatch');
    if(task.status==='CANCELLED'&&!a.batch_job_id&&!a.submission_started_at){await store.set('attempts',a.id,{batch_cancel_confirmed:true});return;}
    if(!a.batch_job_id){
      // SUBMITTING after a crash may have failed before the external boundary.
      // Conservatively discover rather than risk duplicate paid executions.
      const found=await gateway.find(`cs-${a.id}`,a.batch_queue);
      if(found.length===1)await attach(task.id,a.id,found[0].jobId);
      else if(found.length>1)await store.set('tasks',task.id,{error:'Multiple AWS jobs match this attempt. Operator inspection required; no automatic resubmission.'});
      return;
    }
    if(task.status==='CANCELLED'){
      if(!a.batch_cancel_requested){await gateway.terminate(a.batch_job_id);await store.set('attempts',a.id,{batch_cancel_requested:true});}
      const stopped=await gateway.describe(a.batch_job_id);
      if(stopped&&['SUCCEEDED','FAILED'].includes(stopped.status))await store.set('attempts',a.id,{batch_cancel_confirmed:true,batch_status:stopped.status});
      return;
    }
    const job=await gateway.describe(a.batch_job_id);if(!job)throw new Error('BatchJobNotFound');
    if(job.jobName!==`cs-${a.id}`)throw new Error('BatchJobIdentityMismatch');
    const fields={batch_sync_error:null,batch_status:job.status,batch_log_stream:job.container?.logStreamName||null,batch_attempts:(job.attempts||[]).map(x=>({started_at:x.startedAt?new Date(x.startedAt).toISOString():null,stopped_at:x.stoppedAt?new Date(x.stoppedAt).toISOString():null,exit_code:x.container?.exitCode??null,reason:x.statusReason||null,log_stream:x.container?.logStreamName||null}))};
    if(gateway.computeRecord&&job.container?.containerInstanceArn){
      try{fields.batch_compute=await gateway.computeRecord(job)||a.batch_compute||null;fields.batch_compute_error=null;}
      catch(e){fields.batch_compute_error=safeError(e);}
    }
    let result=null,artifact=null;
    if(job.status==='SUCCEEDED'){
      const keys=batchKeys(task.id,a.id);result=await gateway.result(keys.result);
      if(result.task_id!==task.id||result.attempt_id!==a.id||result.batch_job_id!==a.batch_job_id)throw new Error('BatchResultIdentityMismatch');
      const bytes=await gateway.output(keys.output);
      artifact={_id:a.id,id:a.id,role:'output',storage_provider:'s3',bucket:cfg.bucket,filename:`result-${a.id}.zip`,size:bytes.length,created_at:now(),attempt_id:a.id,s3_key:keys.output};
    }
    await store.transaction(async db=>{
      const t=await db.one('tasks',task.id);if(terminal.includes(t.status))return;
      const state=job.status==='SUCCEEDED'?'COMPLETED':job.status==='FAILED'?'FAILED':job.status==='RUNNING'?'RUNNING':'ASSIGNED';
      const start=t.started_at||(job.startedAt?new Date(job.startedAt).toISOString():null);
      const end=['COMPLETED','FAILED'].includes(state)?(job.stoppedAt?new Date(job.stoppedAt).toISOString():now()):null;
      await db.set('attempts',a.id,{...fields,status:state==='COMPLETED'?'COMPLETED':state==='FAILED'?'FAILED':state==='RUNNING'?'BATCH_RUNNING':'BATCH_SUBMITTED',started_at:start,completed_at:end,result,exit_code:job.container?.exitCode??null,error:state==='FAILED'?(job.statusReason||'AWS Batch execution failed').slice(0,2000):null});
      if(artifact)await db.db.collection('artifacts').updateOne({_id:artifact.id},{$setOnInsert:artifact},{...db.options,upsert:true});
      await db.set('tasks',t.id,{status:state,started_at:start,completed_at:end,...(artifact?{output_id:artifact.id}:{}),error:state==='FAILED'?(job.statusReason||'AWS Batch execution failed').slice(0,2000):null});
      if(a.batch_status!==job.status)await auditEvent(db,t,`BATCH_${job.status}`,`AWS Batch reports ${job.status}`);
    });
  }
  async function flushAudit(){
    for(const e of await store.all('events',{audit_pending:true},{timestamp:1},50)){
      const t=await store.one('tasks',e.task_id);
      await gateway.audit({task_id:e.task_id,event_key:`${e.timestamp}#${e.id}`,event_id:e.id,timestamp:e.timestamp,kind:e.kind,message:e.message,batch_job_id:t?.batch_job_id||null,execution_provider:'aws_batch'});
      await store.set('events',e.id,{audit_pending:false,audit_table:cfg.auditTable,audit_synced_at:now()});
    }
  }
  return {enabled,gateway,
    async tick(){if(!enabled||busy)return;busy=true;try{
      const work=await claim();if(work)await submit(work);
      for(const a of await store.all('attempts',{execution_provider:'aws_batch',$or:[{status:{$in:['SUBMITTING','SUBMISSION_UNKNOWN','BATCH_SUBMITTED','BATCH_RUNNING']}},{status:'CANCELLED',batch_cancel_confirmed:{$ne:true}}]},{created_at:1},100)){
        try{await reconcile(a);}catch(e){await store.set('attempts',a.id,{batch_sync_error:safeError(e)});}
      }
      try{await flushAudit();}catch(e){console.error('AWS audit sync pending:',safeError(e));}
    }finally{busy=false;}},
    verification:()=>lastVerification,
    async verify(){
      if(!enabled)fail(422,'Batch execution is not configured');
      try{const details=await gateway.ready();lastVerification={status:'passed',checked_at:now(),details};return details;}
      catch(e){lastVerification={status:'failed',checked_at:now(),error:safeError(e)};throw e;}
    },
    async timeline(taskId){if(!enabled)fail(422,'Batch audit is not configured');return gateway.timeline(taskId);},
    async metrics(taskId){if(!enabled)fail(422,'Start AWS mode to read cloud metrics');const t=await store.one('tasks',taskId);if(!t)fail(404,'Task not found');const a=t.batch_attempt_id?await store.one('attempts',t.batch_attempt_id):null;return a?.batch_compute?.instance_id?cloudMetrics(cfg,a.batch_compute.instance_id):{source:'AWS/EC2 CloudWatch CPUUtilization',datapoints:[]};},
    async logs(taskId){if(!enabled)fail(422,'Start AWS mode to read cloud logs');const t=await store.one('tasks',taskId);if(!t)fail(404,'Task not found');if(t.execution_provider!=='aws_batch')fail(422,'This task does not use AWS Batch');const a=await store.one('attempts',t.batch_attempt_id);return a?.batch_log_stream?gateway.logs(a.batch_log_stream):[];},
  };
}
