import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes,randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { Store } from '../backend/store.mjs';
import { config } from '../backend/config.mjs';
import { createApp } from '../backend/app.mjs';
import { reap } from '../backend/scheduler.mjs';

process.chdir(new URL('..',import.meta.url).pathname);
const dir=await fs.mkdtemp(path.resolve('.local/recovery-'));
const uri=`mongodb://127.0.0.1:27017/cloudsphere_recovery_${randomUUID().replaceAll('-','')}?replicaSet=rs0`;
const cfg=config({ mongoUrl:uri,operatorToken:randomBytes(32).toString('base64url'),enrollmentToken:randomBytes(32).toString('base64url'),dataDir:dir,mode:'LOCAL',leaseSeconds:6,heartbeatTimeout:4,retryBackoff:1 });
const store=await Store.connect(uri),server=createApp(store,cfg).listen(8011,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const env={ ...process.env,CLOUDSPHERE_MODE:'LOCAL',CLOUDSPHERE_ENROLLMENT_TOKEN:cfg.enrollmentToken };
const processes=[],handles=[];
async function worker(name) {
  const log=await fs.open(path.join(dir,`${name}.log`),'a'); handles.push(log);
  const child=spawn(process.execPath,['worker/agent.mjs','--name',name,'--url','http://127.0.0.1:8011','--state-dir',path.join(dir,'workers')],{ env,stdio:['ignore',log.fd,log.fd] });
  processes.push(child); return child;
}
async function request(route,body) {
  const r=await fetch(`http://127.0.0.1:8011/api${route}`,{ method:body===undefined?'GET':'POST',headers:{ Authorization:`Bearer ${cfg.operatorToken}`,'Content-Type':'application/json' },body:body===undefined?undefined:JSON.stringify(body) });
  if(!r.ok) throw new Error(`Recovery API error ${r.status}`); return r.json();
}
async function until(fn,seconds=90) { const end=Date.now()+seconds*1000; while(Date.now()<end) { const result=await fn(); if(result) return result; await sleep(300); } throw new Error('Recovery check timed out'); }
let busy=false;
const timer=setInterval(async()=>{ if(busy)return; busy=true; try { await store.transaction(db=>reap(db,cfg)); } finally { busy=false; } },500);
try {
  const a=await worker('recovery-a'); await until(async()=>(await request('/workers')).length===1);
  const task=await request('/tasks',{ name:'Real worker recovery benchmark',kind:'cpu',parameters:{ limit:5000000 },max_retries:1 });
  const detail=()=>request(`/tasks/${task.id}`);
  await until(async()=>(await detail()).attempts.some(a=>a.logs.includes('Starting approved template')));
  a.kill('SIGTERM'); await new Promise(resolve=>a.once('exit',resolve));
  await worker('recovery-b'); await until(async()=>(await detail()).status==='COMPLETED',180);
  const final=await detail();
  if(final.attempts.map(a=>a.status).join(',')!=='LOST,COMPLETED' || final.attempts[0].worker_id===final.attempts[1].worker_id || final.attempts[1].result.prime_count!==348513) throw new Error('Recovery or computational result assertion failed');
  await worker('recovery-a'); await until(async()=>(await request('/workers')).every(w=>w.state==='HEALTHY'));
  const report={ attempt_statuses:final.attempts.map(a=>a.status),recovered_on_other_worker:true,restarted_worker_healthy:true,prime_count:final.attempts[1].result.prime_count };
  await fs.writeFile('.local/recovery-results.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
} finally {
  clearInterval(timer);
  for(const p of processes) if(p.exitCode===null) { const exit=new Promise(resolve=>p.once('exit',resolve)); p.kill('SIGTERM'); await exit; }
  await new Promise(resolve=>server.close(resolve));
  while(busy) await sleep(100);
  await store.db.dropDatabase(); await store.close();
  for(const h of handles) await h.close();
  await fs.rm(dir,{ recursive:true,force:true });
}
