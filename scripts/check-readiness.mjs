import fs from 'node:fs/promises';
import { parse } from 'dotenv';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { localApiAddress } from './local-address.mjs';
import { localRequest } from './local-http.mjs';

process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const api = {origin:await localApiAddress(process.cwd())};
const token=parse(await fs.readFile('.local/dev.env')).CLOUDSPHERE_OPERATOR_TOKEN;
async function request(route,body) {
  const response=await localRequest(`${api.origin}/api${route}`,{ method:body===undefined?'GET':'POST',headers:{ Authorization:`Bearer ${token}`,'Content-Type':'application/json' },body:body===undefined?undefined:JSON.stringify(body),timeoutMs:10000 });
  if(!response.ok) throw new Error(`Readiness request failed: ${response.status}`); return response;
}
let healthy=false;
for(let i=0;i<30;i++) { const workers=await (await request('/workers')).json(); healthy=workers.filter(w=>w.state==='HEALTHY').length>=2; if(healthy)break; await sleep(500); }
if(!healthy) throw new Error('Two healthy local workers are required');
const task=await (await request('/tasks',{ name:'Readiness prime benchmark',kind:'cpu',parameters:{ limit:100 },max_retries:0,timeout_seconds:30 })).json();
let detail;
for(let i=0;i<90;i++) {
  detail=await (await request(`/tasks/${task.id}`)).json();
  if(detail.status==='COMPLETED')break;
  if(['FAILED','CANCELLED'].includes(detail.status))throw new Error('Readiness job failed; inspect its attempts/logs');
  await sleep(500);
}
const result=detail.attempts.at(-1)?.result;
if(detail.status!=='COMPLETED' || result.prime_count!==25 || result.prime_sum!==1060) throw new Error('Readiness computation assertion failed');
const output=Buffer.from(await (await request(`/tasks/${task.id}/output`)).arrayBuffer());
if(output.subarray(0,2).toString()!=='PK')throw new Error('Readiness result download is not a ZIP');
console.log('Ready: MongoDB-backed API, two healthy workers, actual Docker computation and authenticated output download.');
