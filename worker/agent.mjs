import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import 'dotenv/config';
import { execute } from './executor.mjs';

const { values } = parseArgs({ options:{ name:{ type:'string' },url:{ type:'string',default:process.env.CLOUDSPHERE_API_URL || 'http://127.0.0.1:8000' },cpu:{ type:'string',default:'1' },memory:{ type:'string',default:'512' },'state-dir':{ type:'string',default:'.local/workers' } } });
if (!values.name || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/.test(values.name)) throw new Error('Supply a valid --name');
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(values.url) && !values.url.startsWith('https://')) throw new Error('Remote control planes require HTTPS');
const cpu = Number(values.cpu), memory = Number(values.memory);
if (!Number.isFinite(cpu) || cpu > os.availableParallelism() || memory > os.totalmem()/1024**2) throw new Error('Advertised resources exceed host capacity');
await fs.mkdir(values['state-dir'],{ recursive:true,mode:0o700 });
const state = path.join(values['state-dir'],`${values.name}.json`);
let token = process.env.CLOUDSPHERE_ENROLLMENT_TOKEN || '';
async function request(route, body, raw = false) {
  const response = await fetch(`${values.url}/api${route}`,{ method:body === undefined ? 'GET' : 'POST',headers:{ Authorization:`Bearer ${token}`,...(body !== undefined ? { 'Content-Type':raw ? 'application/octet-stream' : 'application/json' } : {}) },body:body === undefined ? undefined : raw ? body : JSON.stringify(body),signal:AbortSignal.timeout(20000) });
  if (!response.ok) { const e = new Error(`Control plane returned ${response.status}`); e.status = response.status; throw e; }
  return response;
}
let identity;
try { identity = JSON.parse(await fs.readFile(state,'utf8')); }
catch(e) { if (e.code !== 'ENOENT') throw e; }
if (!identity) {
  if (!token) throw new Error('Set CLOUDSPHERE_ENROLLMENT_TOKEN before enrollment');
  const metadata = { name:values.name,cpu,memory_mb:memory,max_parallel:1 };
  if (process.env.CLOUDSPHERE_MODE === 'AWS') Object.assign(metadata,{ instance_id:process.env.CLOUDSPHERE_INSTANCE_ID,instance_type:process.env.CLOUDSPHERE_INSTANCE_TYPE,region:process.env.CLOUDSPHERE_AWS_REGION });
  identity = { ...await (await request('/worker/register',metadata)).json(),url:values.url };
  await fs.writeFile(state,JSON.stringify(identity),{ flag:'wx',mode:0o600 });
}
if (identity.url !== values.url) throw new Error('Saved credential belongs to another control plane');
token = identity.token;
let current = null, stopping = false;
for (const sig of ['SIGINT','SIGTERM']) process.on(sig,() => { stopping = true; current?.abort.abort(); });
function cpuTimes() { return os.cpus().reduce((sum,c) => ({ idle:sum.idle+c.times.idle,total:sum.total+Object.values(c.times).reduce((a,b)=>a+b,0) }),{ idle:0,total:0 }); }
let previous = cpuTimes();
console.log(`Worker ${values.name} active; Docker runtime; mode=${process.env.CLOUDSPHERE_MODE || 'LOCAL'}`);
while (!stopping) {
  try {
    const sample = cpuTimes(), total = sample.total-previous.total;
    const heartbeat = { cpu_percent:Math.max(0,Math.min(100,total ? (1-(sample.idle-previous.idle)/total)*100 : 0)),memory_percent:(1-os.freemem()/os.totalmem())*100,active_attempt_ids:current ? [current.attempt.id] : [] };
    previous = sample;
    const beat = await (await request('/worker/heartbeat',heartbeat)).json();
    if (current && beat.cancelled_attempt_ids.includes(current.attempt.id)) current.abort.abort();
    if (current?.done) {
      const base = `/worker/attempts/${current.attempt.id}`;
      try {
        if (current.error) await request(`${base}/fail`,{ error:current.error.message.slice(0,2000),logs:current.error.message.slice(-16000),exit_code:1 });
        else {
          if (!current.payload) {
            const artifact = await (await request(`${base}/output`,current.outcome.archive,true)).json();
            current.payload = { output_id:artifact.id,result:current.outcome.result,logs:current.outcome.logs,exit_code:0 };
          }
          await request(`${base}/complete`,current.payload);
        }
        console.log(`Attempt ${current.attempt.id}: ${current.error ? 'failed' : 'completed'}`); current = null;
      } catch(e) { if (e.status === 409) current = null; else throw e; }
    }
    if (!current) {
      const claimed = await (await request('/worker/claim',{})).json();
      if (claimed.attempt) {
        const job = { ...claimed,abort:new AbortController(),done:false }; current = job;
        job.promise = (async () => {
          let input = null,extension = '.csv';
          if (job.task.input_id) { const response = await request(`/worker/attempts/${job.attempt.id}/input`); input = Buffer.from(await response.arrayBuffer()); extension = response.headers.get('x-input-extension'); }
          return execute(job.task,{ input,extension,signal:job.abort.signal,onProgress:async logs => { try { await request(`/worker/attempts/${job.attempt.id}/progress`,{ logs }); } catch(e) { if (e.status === 409) job.abort.abort(); } } });
        })().then(outcome => { job.outcome = outcome; }).catch(error => { job.error = error; }).finally(() => { job.done = true; });
        console.log(`Executing ${job.task.name} (${job.attempt.id})`);
      }
    }
  } catch(e) { console.error(`Control-plane request failed: ${e.status || e.name}`); }
  if (!stopping) await sleep(2000);
}
current?.abort.abort();
await current?.promise;
