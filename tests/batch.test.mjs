import { before, beforeEach, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { Store, now } from '../backend/store.mjs';
import { batchController, awsBatchGateway, batchKeys } from '../backend/batch.mjs';
import { readBoundedBody } from '../jobs/batch-protocol.mjs';
import { schedule } from '../backend/scheduler.mjs';

let store,gateway,cfg,submitted,job,result,audits,terminated,findResult;
before(async()=>{
  const uri=new URL(process.env.CLOUDSPHERE_TEST_MONGODB_URI||'mongodb://127.0.0.1:27017/?replicaSet=rs0');uri.pathname='/cloudsphere_batch_test_'+randomUUID().replaceAll('-','');
  store=await Store.connect(uri.toString());
});
beforeEach(async()=>{
  for(const name of ['tasks','attempts','events','artifacts','workers','decisions','settings'])await store.db.collection(name).deleteMany({});
  cfg={mode:'AWS',region:'eu-north-1',expectedAccount:'278746617061',batchQueue:'queue',batchDefinition:'definition',auditTable:'audit',bucket:'bucket',batchLogGroup:'logs',projectTag:'CloudSphere',heartbeatTimeout:20,leaseSeconds:30,retryBackoff:0};
  submitted=[];audits=[];terminated=[];findResult=[];job=null;result=null;
  gateway={
    ready:async()=>({queue:'queue',definition:'definition',image:'image@sha256:'+ 'a'.repeat(64)}),
    putConfig:async(key,value)=>{gateway.config={key,value};},
    submit:async request=>{submitted.push(request);return {jobId:'actual-job'};},
    describe:async()=>job,
    find:async()=>findResult,
    terminate:async id=>{terminated.push(id);},
    result:async()=>result,
    output:async()=>Buffer.from('PKreal-fixture'),
    audit:async item=>{audits.push(item);},timeline:async()=>audits,logs:async()=>[],
  };
});
after(async()=>{if(store){await store.db.dropDatabase();await store.close();}});
async function task(fields={}){return store.add('tasks',{name:'Batch fixture',execution_provider:'aws_batch',aws_region:'eu-north-1',kind:'cpu',parameters:{limit:100},cpu:1,memory_mb:256,timeout_seconds:15,max_retries:2,input_id:null,status:'QUEUED',created_at:now(),available_at:now(),started_at:null,completed_at:null,...fields});}
function successful(a,t){job={jobId:'actual-job',jobName:`cs-${a.id}`,status:'SUCCEEDED',startedAt:Date.now()-2000,stoppedAt:Date.now(),container:{exitCode:0,logStreamName:'fixture-stream'},attempts:[]};result={task_id:t.id,attempt_id:a.id,batch_job_id:'actual-job',prime_count:25};}

test('Batch submission persists actual identity; verified output completes and audit writes are recoverable',async()=>{
  const t=await task(),controller=batchController(store,cfg,gateway);
  await controller.tick();let current=await store.one('tasks',t.id),a=await store.one('attempts',current.batch_attempt_id);
  assert.equal(submitted.length,1);assert.equal(current.batch_job_id,'actual-job');assert.equal(submitted[0].retryStrategy.attempts,3);
  assert.equal(gateway.config.value.task.id,t.id);assert.deepEqual(gateway.config.value.keys,batchKeys(t.id,a.id));
  successful(a,t);await controller.tick();current=await store.one('tasks',t.id);
  assert.equal(current.status,'COMPLETED');assert.equal((await store.one('attempts',a.id)).result.prime_count,25);
  assert.equal((await store.one('artifacts',current.output_id)).s3_key,batchKeys(t.id,a.id).output);
  assert.ok(audits.some(e=>e.kind==='BATCH_SUCCEEDED'));assert.ok(audits.every(e=>e.task_id===t.id));
  await controller.tick();assert.equal(submitted.length,1);
});
test('ambiguous SubmitJob outcomes are discovered without another paid submission',async()=>{
  const t=await task();gateway.submit=async request=>{submitted.push(request);throw new Error('SocketDisconnected');};
  const controller=batchController(store,cfg,gateway);await controller.tick();
  const a=(await store.all('attempts'))[0];assert.equal(a.status,'SUBMISSION_UNKNOWN');assert.equal(submitted.length,1);
  await controller.tick();assert.equal(submitted.length,1);
  findResult=[{jobId:'actual-job',jobName:`cs-${a.id}`}];await controller.tick();assert.equal((await store.one('tasks',t.id)).batch_job_id,'actual-job');
  successful(a,t);await controller.tick();assert.equal((await store.one('tasks',t.id)).status,'COMPLETED');assert.equal(submitted.length,1);
});
test('submission preflight failure never launches a job',async()=>{
  const t=await task();gateway.ready=async()=>{throw new Error('AccessDenied');};
  await batchController(store,cfg,gateway).tick();assert.equal(submitted.length,0);assert.equal((await store.one('tasks',t.id)).status,'FAILED');
});
test('wrong result identity cannot report success or attach an artifact',async()=>{
  const t=await task(),c=batchController(store,cfg,gateway);await c.tick();const a=(await store.all('attempts'))[0];
  successful(a,t);result.task_id=randomUUID();await c.tick();assert.notEqual((await store.one('tasks',t.id)).status,'COMPLETED');assert.equal((await store.all('artifacts')).length,0);
});
test('cancellation racing submission still terminates the discovered AWS job',async()=>{
  const t=await task();gateway.submit=async request=>{submitted.push(request);await store.set('tasks',t.id,{status:'CANCELLED',completed_at:now()});return {jobId:'actual-job'};};
  const c=batchController(store,cfg,gateway);await c.tick();assert.deepEqual(terminated,['actual-job']);assert.equal((await store.one('tasks',t.id)).status,'CANCELLED');
  job={status:'FAILED'};await c.tick();assert.equal(terminated.length,1);assert.equal((await store.all('attempts'))[0].batch_cancel_confirmed,true);
});
test('the local dispatcher cannot reserve an AWS Batch task',async()=>{
  const t=await task();await store.add('workers',{name:'worker',state:'HEALTHY',last_heartbeat:now(),cpu:2,memory_mb:2048,max_parallel:2});
  await store.transaction(db=>schedule(db,cfg));assert.equal((await store.all('attempts')).length,0);assert.equal((await store.one('tasks',t.id)).status,'QUEUED');
});
test('DynamoDB outage retains the audit outbox for later retry',async()=>{
  await task();gateway.audit=async()=>{throw new Error('DynamoUnavailable');};const c=batchController(store,cfg,gateway);await c.tick();assert.ok((await store.all('events',{audit_pending:true})).length);
  gateway.audit=async e=>{audits.push(e);};await c.tick();assert.equal((await store.all('events',{audit_pending:true})).length,0);assert.ok(audits.length);
});
test('bounded S3 reads abort oversized streams',async()=>{
  await assert.rejects(readBoundedBody(Readable.from([Buffer.alloc(8),Buffer.alloc(8)]),10),/exceeds/);
});
test('cloud readiness refuses an unexpected account before accessing project resources',async()=>{
  const g=awsBatchGateway(cfg,{sts:{send:async()=>({Account:'wrong'})}});await assert.rejects(g.ready(),/account does not match/);
});

test('compute evidence is obtained from the actual ECS task placement and EC2 response',async()=>{
  const seen=[];
  const g=awsBatchGateway(cfg,{
    ecs:{send:async command=>{seen.push(command.input);return {containerInstances:[{ec2InstanceId:'i-actual-fixture'}]};}},
    ec2:{send:async command=>{assert.deepEqual(command.input.InstanceIds,['i-actual-fixture']);return {Reservations:[{Instances:[{InstanceId:'i-actual-fixture',InstanceType:'t3.small',VpcId:'vpc-fixture',SubnetId:'subnet-fixture',State:{Name:'running'}}]}]};}},
  });
  const value=await g.computeRecord({container:{taskArn:'arn:aws:ecs:eu-north-1:278746617061:task/real-cluster/task-id',containerInstanceArn:'arn:aws:ecs:eu-north-1:278746617061:container-instance/real-cluster/container-id'}});
  assert.equal(seen[0].cluster,'real-cluster');assert.equal(value.instance_id,'i-actual-fixture');assert.equal(value.vpc_id,'vpc-fixture');assert.equal(value.observed_state,'running');
});
