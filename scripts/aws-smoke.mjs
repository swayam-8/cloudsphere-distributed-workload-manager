import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parse } from 'dotenv';
import { setTimeout as sleep } from 'node:timers/promises';
import { localApiAddress } from './local-address.mjs';
import { localRequest } from './local-http.mjs';
import { zipFiles } from '../tests/helpers/zip.mjs';

process.chdir(path.resolve(import.meta.dirname,'..'));
const base=await localApiAddress(process.cwd()),token=parse(await fs.readFile('.local/dev.env')).CLOUDSPHERE_OPERATOR_TOKEN;
async function request(route,body){const response=await localRequest(`${base}/api${route}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${token}`,...(body===undefined?{}:{'Content-Type':Buffer.isBuffer(body)?'application/octet-stream':'application/json'})},body:body===undefined?undefined:Buffer.isBuffer(body)?body:JSON.stringify(body),timeoutMs:20000});if(!response.ok)throw new Error(`Verification API returned ${response.status} for ${route}`);return response;}
const json=async(route,body)=>(await request(route,body)).json();
const cloud=await json('/cloud/batch/verify',{});assert.equal(cloud.account,process.env.CLOUDSPHERE_AWS_ACCOUNT||'278746617061');
console.log('Submitting ONE real, potentially billable AWS Batch CSV job; automatic retries are disabled for this smoke check.');
const input=await json('/uploads?filename=sales-quality.csv',await fs.readFile('examples/sales-quality.csv'));
const task=await json('/tasks',{name:'AWS CSV acceptance check',execution_provider:'aws_batch',kind:'csv',input_id:input.id,parameters:{group_by:'category',value_column:'amount',deduplicate:true,drop_missing:true,invalid_numeric:'skip'},cpu:1,memory_mb:512,timeout_seconds:60,max_retries:0});
let finished=false;
try{
  const deadline=Date.now()+10*60*1000;let detail;
  while(Date.now()<deadline){detail=await json(`/tasks/${task.id}`);if(detail.status==='FAILED')throw new Error(`AWS job failed: ${detail.error}`);if(detail.status==='COMPLETED'){finished=true;break;}console.log(`Task ${task.id}: ${detail.status}; Batch ${detail.batch_job_id||'submission pending'}`);await sleep(5000);}
  if(!finished)throw new Error('AWS job did not complete within ten minutes; cancellation will be requested');
  const attempt=detail.attempts.at(-1),result=attempt.result;assert.equal(result.cleaned_count,4);assert.equal(result.groups[0].sum,'10300');assert.equal(result.outliers.count,1);
  const zip=Buffer.from(await (await request(`/tasks/${task.id}/output`)).arrayBuffer()),files=zipFiles(zip);
  assert.match(files.get('aggregates.csv').toString(),/Books,4,10300,2575/);assert.equal(JSON.parse(files.get('result.json')).batch_job_id,detail.batch_job_id);
  let audit=[],logs=[];
  for(let i=0;i<24;i++){
    audit=await json(`/tasks/${task.id}/cloud-audit`);logs=await json(`/tasks/${task.id}/cloud-logs`);
    if(audit.some(e=>e.kind==='BATCH_SUCCEEDED')&&logs.some(e=>e.message.includes('artifacts_uploaded')))break;await sleep(5000);
  }
  assert.ok(audit.some(e=>e.kind==='BATCH_SUCCEEDED'),'DynamoDB completion audit missing');
  assert.ok(logs.some(e=>e.message.includes('artifacts_uploaded')),'CloudWatch container logs missing');
  const evidence={verified_at:new Date().toISOString(),task_id:task.id,batch_job_id:detail.batch_job_id,region:detail.aws_region,image:cloud.image,cleaned_rows:result.cleaned_count,total:result.groups[0].sum,outliers:result.outliers.count,zip_bytes:zip.length,audit_events:audit.length,cloudwatch_log_events:logs.length};
  await fs.writeFile('.local/aws-smoke-results.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}catch(e){
  if(!finished){await json(`/tasks/${task.id}/cancel`,{});console.error('Cancellation requested for this smoke job. Keep the backend running and verify AWS cancellation; a request is not proof that compute has stopped.');}
  throw e;
}
