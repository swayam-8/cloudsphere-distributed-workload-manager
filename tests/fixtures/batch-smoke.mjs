import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';
import { randomUUID, createHash } from 'node:crypto';
import { runBatch } from '../../jobs/batch-entry.mjs';
import { batchKeys } from '../../jobs/batch-protocol.mjs';
import { zipFiles } from '../helpers/zip.mjs';

const csv=Buffer.from('order_id,category,amount,region\n1,Books,100,North\n2,Books,110,South\n3,Books,90,North\n4,Books,10000,North\n4,Books,10000,North\n5,Hardware,50,\n6,Hardware,not-a-number,West\n');
for(const kind of ['cpu','csv','images']){
  const taskId=randomUUID(),attemptId=randomUUID(),keys=batchKeys(taskId,attemptId),map=new Map(),writes=[];
  const bytes=kind==='csv'?csv:kind==='images'?await fs.readFile('/fixtures/sample.png'):null;
  const inputId=randomUUID(),input=bytes?{key:`cloudsphere/${inputId}`,extension:kind==='csv'?'.csv':'.png',sha256:createHash('sha256').update(bytes).digest('hex')}:null;
  const parameters=kind==='cpu'?{limit:100}:kind==='csv'?{group_by:'category',value_column:'amount',deduplicate:true,drop_missing:true,invalid_numeric:'skip'}:{width:64};
  const config={protocol:'cloudsphere-batch-v1',task:{id:taskId,kind,parameters,timeout_seconds:20},attempt_id:attemptId,input,keys};
  map.set(keys.config,Buffer.from(JSON.stringify(config)));if(bytes)map.set(input.key,bytes);
  const s3={async send(command){const {Key,Body}=command.input;if(command.constructor.name==='GetObjectCommand'){assert.ok(map.has(Key));return {Body:Readable.from([map.get(Key)])};}assert.equal(command.constructor.name,'PutObjectCommand');map.set(Key,Buffer.from(Body));writes.push(Key);return {};}};
  const result=await runBatch({CLOUDSPHERE_TASK_ID:taskId,CLOUDSPHERE_ATTEMPT_ID:attemptId,AWS_BATCH_JOB_ID:'fixture-job',CLOUDSPHERE_BATCH_BUCKET:'fixture-bucket',CLOUDSPHERE_BATCH_CONFIG_KEY:keys.config},{s3});
  assert.equal(result.task_id,taskId);assert.equal(result.attempt_id,attemptId);assert.equal(result.batch_job_id,'fixture-job');
  assert.deepEqual(writes,[keys.output,keys.result]);
  const files=zipFiles(map.get(keys.output));assert.equal(JSON.parse(files.get('result.json')).batch_job_id,'fixture-job');
  if(kind==='cpu'){assert.equal(result.prime_count,25);assert.equal(result.prime_sum,1060);}
  if(kind==='csv'){assert.equal(result.cleaned_count,4);assert.equal(result.groups[0].sum,'10300');assert.equal(result.outliers.count,1);assert.match(files.get('aggregates.csv').toString(),/Books,4,10300,2575/);}
  if(kind==='images'){assert.equal(result.image_count,1);assert.equal(result.images[0].width,64);assert.equal(result.images[0].height,32);}
  console.log(`VERIFIED_BATCH_KERNEL_${kind.toUpperCase()}`);
}
