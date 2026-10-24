import fs from 'node:fs/promises';
import { parse } from 'dotenv';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { localApiConfig } from './dev-config.mjs';

process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const api = localApiConfig();
const token=parse(await fs.readFile('.local/dev.env')).CLOUDSPHERE_OPERATOR_TOKEN;
async function request(route,body) {
  const response=await fetch(`${api.origin}/api${route}`,{ method:body === undefined ? 'GET' : 'POST',headers:{ Authorization:`Bearer ${token}`,...(body === undefined ? {} : { 'Content-Type':Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' }) },body:body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  if(!response.ok) throw new Error(`Smoke request failed: ${response.status}`);
  return response;
}
const json=async (route,body)=>(await request(route,body)).json();
const workers=await json('/workers');
if(workers.filter(w=>w.state==='HEALTHY').length<2) throw new Error('Start two local workers first');
const jobs=[];
for(let i=0;i<3;i++) jobs.push(await json('/tasks',{ name:`Distributed prime benchmark ${i+1}`,kind:'cpu',parameters:{ limit:3000000 } }));
for(const [kind,filename,parameters] of [['csv','sales.csv',{ group_by:'category',value_column:'amount' }],['images','sample.png',{ width:64 }]]) {
  const artifact=await json(`/uploads?filename=${filename}`,await fs.readFile(`examples/${filename}`));
  jobs.push(await json('/tasks',{ name:`Smoke ${kind} processing`,kind,parameters,input_id:artifact.id }));
}
const deadline=Date.now()+180000; let parallel=false,queue=false,details;
while(Date.now()<deadline) {
  details=await Promise.all(jobs.map(t=>json(`/tasks/${t.id}`)));
  const active=details.flatMap(t=>t.attempts).filter(a=>a.status==='RUNNING');
  parallel ||= new Set(active.map(a=>a.worker_id)).size>=2;
  queue ||= active.length>=2 && details.some(t=>t.status==='QUEUED');
  if(details.some(t=>t.status==='FAILED')) throw new Error('A real smoke job failed');
  if(details.every(t=>t.status==='COMPLETED')) break;
  await sleep(500);
}
if(!details.every(t=>t.status==='COMPLETED') || !parallel || !queue) throw new Error('Completion, distributed execution or queue assertion failed');
for(let i=0;i<details.length;i++) {
  const task=details[i],result=task.attempts.at(-1).result;
  if(i<3 && result.prime_count!==216816) throw new Error('Incorrect prime count');
  if(i===3 && (result.record_count!==4 || result.group_count!==2)) throw new Error('Incorrect CSV result');
  if(i===4 && (result.images[0].width!==64 || result.images[0].height!==32)) throw new Error('Incorrect thumbnail result');
  const output=Buffer.from(await (await request(`/tasks/${task.id}/output`)).arrayBuffer());
  if(output.subarray(0,2).toString()!=='PK' || task.decisions.at(-1).worker_id!==task.attempts.at(-1).worker_id) throw new Error('Artifact or persisted decision mismatch');
}
const report={ jobs_completed:jobs.length,observed_parallel_workers:parallel,observed_queue:queue,runtime:'Docker',task_ids:jobs.map(t=>t.id) };
await fs.writeFile('.local/smoke-results.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
