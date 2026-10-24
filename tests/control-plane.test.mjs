import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Store, after as future } from '../backend/store.mjs';
import { config } from '../backend/config.mjs';
import { createApp } from '../backend/app.mjs';

let store, server, base, cfg;
const op = 'test-operator-credential-123456', enrollment = 'test-enrollment-credential-123456';
before(async () => {
  const database = `cloudsphere_test_${randomUUID().replaceAll('-','')}`;
  const uri = new URL(process.env.CLOUDSPHERE_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017/?replicaSet=rs0'); uri.pathname = `/${database}`;
  store = await Store.connect(uri.toString());
  cfg = config({ operatorToken:op,enrollmentToken:enrollment,mongoUrl:uri.toString(),dataDir:await fs.mkdtemp('/tmp/cloudsphere-test-'),retryBackoff:0,mode:'LOCAL' });
  server = createApp(store,cfg).listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  for (const name of ['tasks','workers','attempts','decisions','metrics','events','settings','artifacts']) await store.db.collection(name).deleteMany({});
  cfg.retryBackoff = 0;
});
after(async () => { if (server) await new Promise(resolve => server.close(resolve)); if(store) { await store.db.dropDatabase(); await store.close(); } if(cfg) await fs.rm(cfg.dataDir,{ recursive:true,force:true }); });
async function request(route,body,token=op,raw=false,method) {
  const r = await fetch(`${base}/api${route}`,{ method:method || (body === undefined ? 'GET' : 'POST'),headers:{ Authorization:`Bearer ${token}`,...(body === undefined ? {} : { 'Content-Type':raw ? 'application/octet-stream' : 'application/json' }) },body:body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  return { status:r.status,data:(r.headers.get('content-type') || '').includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
async function enroll(name='worker-a',cpu=2,memory=1024,parallel=1) {
  const r = await request('/worker/register',{ name,cpu,memory_mb:memory,max_parallel:parallel },enrollment); assert.equal(r.status,201,JSON.stringify(r.data));
  await beat(r.data.token); return { id:r.data.worker_id,token:r.data.token };
}
async function beat(token,ids=[],cpu=10,memory=10) { return request('/worker/heartbeat',{ cpu_percent:cpu,memory_percent:memory,active_attempt_ids:ids },token); }
async function submit(fields={}) { const r=await request('/tasks',{ name:'test job',...fields }); assert.equal(r.status,201,JSON.stringify(r.data)); return r.data; }
async function claim(token) { const r=await request('/worker/claim',{},token); assert.equal(r.status,200,JSON.stringify(r.data)); return r.data; }
async function completePayload(id,token) { const r=await request(`/worker/attempts/${id}/output`,Buffer.from('result'),token,true); assert.equal(r.status,201); return { output_id:r.data.id,result:{ prime_count:25 },logs:'computed result',exit_code:0 }; }

test('health probes identify the actual CloudSphere process through both paths',async () => {
  for (const route of ['/health','/api/health']) {
    const response=await fetch(`${base}${route}`);
    assert.equal(response.status,200);
    const health=await response.json();
    assert.equal(health.service,'cloudsphere'); assert.equal(health.pid,process.pid); assert.equal(health.status,'ok');
  }
});

test('operator, enrollment and per-worker authentication stay separate',async () => {
  assert.equal((await request('/tasks',undefined,'')).status,401);
  const a=await enroll(), b=await enroll('worker-b');
  assert.equal((await request('/tasks',undefined,a.token)).status,401);
  assert.equal((await request('/worker/claim',{})).status,401);
  await submit(); const job=await claim(a.token);
  assert.equal((await request(`/worker/attempts/${job.attempt.id}/progress`,{ logs:'x' },b.token)).status,403);
  assert.equal('token_hash' in (await request(`/workers/${a.id}`)).data,false);
  assert.equal((await request('/worker/register',{ name:'worker-a',cpu:1,memory_mb:256 },enrollment)).status,409);
});
for (const fields of [{ cpu:0 },{ cpu:-1 },{ memory_mb:0 },{ priority:9 },{ max_retries:6 },{ timeout_seconds:0 },{ kind:'shell' },{ parameters:{ command:'ls' } },{ parameters:{ limit:20000001 } },{ kind:'csv' },{ name:'  ' }]) {
  test(`task validation rejects ${JSON.stringify(fields)}`,async () => assert.equal((await request('/tasks',{ name:'job',...fields })).status,422));
}
test('concurrent MongoDB transactions never double claim or overreserve',async () => {
  const w=await enroll(); for(let i=0;i<8;i++) await submit();
  const responses=await Promise.all(Array.from({ length:8 },()=>claim(w.token)));
  assert.equal(responses.filter(r=>r.attempt).length,1);
  assert.deepEqual((await request(`/workers/${w.id}`)).data.reserved,{ cpu:1,memory_mb:256,jobs:1 });
  assert.equal((await request('/tasks?status=QUEUED')).data.total,7);
});
for(const algorithm of ['round_robin','least_loaded','resource_aware']) test(`${algorithm} excludes insufficient capacity and persists reasons`,async () => {
  const a=await enroll('a-small',1,256),b=await enroll('b-large',4,2048);
  await request('/settings',{ algorithm },op,false,'PUT'); const t=await submit({ cpu:2,memory_mb:512 });
  assert.equal((await claim(a.token)).attempt,null); assert.equal((await claim(b.token)).task.id,t.id);
  const decision=(await request(`/tasks/${t.id}/decision`)).data.at(-1);
  assert.equal(decision.worker_id,b.id); assert.equal(decision.candidates[0].eligible,false); assert.ok(decision.candidates[0].reasons.includes('Insufficient unreserved CPU'));
});
test('resource aware best fit and measured least loaded differ as documented',async () => {
  const a=await enroll('a-large',4,2048),b=await enroll('b-small',1,512),t=await submit();
  assert.equal((await claim(b.token)).attempt.worker_id,b.id); await request(`/tasks/${t.id}/cancel`,{});
  await request('/settings',{ algorithm:'least_loaded' },op,false,'PUT'); await beat(a.token,[],0,0); await beat(b.token,[],95,95); await submit();
  assert.equal((await claim(a.token)).attempt.worker_id,a.id);
});
test('round robin rotation persists after reservations release',async () => {
  const a=await enroll(),b=await enroll('worker-b'); await request('/settings',{ algorithm:'round_robin' },op,false,'PUT');
  for (const w of [a,b,a]) { const t=await submit(); assert.equal((await claim(w.token)).attempt.worker_id,w.id); await request(`/tasks/${t.id}/cancel`,{}); }
});
test('priority and aging prevent permanent starvation',async () => {
  const w=await enroll(),low=await submit({ priority:0 }),high=await submit({ priority:2 });
  assert.equal((await claim(w.token)).task.id,high.id); await request(`/tasks/${high.id}/cancel`,{});
  await store.set('tasks',low.id,{ created_at:future(-240) }); await submit({ priority:2 });
  assert.equal((await claim(w.token)).task.id,low.id);
});
test('completion is idempotent, output persists and reservations release',async () => {
  const w=await enroll(),t=await submit(),a=(await claim(w.token)).attempt,payload=await completePayload(a.id,w.token);
  for(let i=0;i<2;i++) assert.equal((await request(`/worker/attempts/${a.id}/complete`,payload,w.token)).status,200);
  assert.equal((await request(`/worker/attempts/${a.id}/complete`,{ ...payload,result:{} },w.token)).status,409);
  assert.equal((await request(`/tasks/${t.id}`)).data.status,'COMPLETED');
  assert.equal((await request(`/workers/${w.id}`)).data.reserved.jobs,0);
  assert.equal((await request(`/tasks/${t.id}/output`)).data.toString(),'result');
});
test('lost worker recovers elsewhere and expired lease cannot be resurrected',async () => {
  const a=await enroll(),b=await enroll('worker-b'),t=await submit({ max_retries:1 }),old=(await claim(a.token)).attempt,payload=await completePayload(old.id,a.token);
  await store.set('attempts',old.id,{ lease_expires_at:future(-1) }); await store.set('workers',a.id,{ last_heartbeat:future(-60) });
  await beat(b.token); const next=(await claim(b.token)).attempt;
  assert.equal(next.number,2); assert.equal(next.worker_id,b.id);
  assert.equal((await request(`/worker/attempts/${old.id}/complete`,payload,a.token)).status,409);
  assert.deepEqual((await beat(a.token,[old.id])).data.cancelled_attempt_ids,[old.id]);
  assert.deepEqual((await request(`/tasks/${t.id}/attempts`)).data.map(a=>a.status),['LOST','RUNNING']);
});
test('retry limit, exponential delay and manual retry preserve attempt history',async () => {
  cfg.retryBackoff=60; const w=await enroll(),t=await submit({ max_retries:1 }),a=(await claim(w.token)).attempt;
  assert.equal((await request(`/worker/attempts/${a.id}/fail`,{ error:'test failure' },w.token)).status,200);
  assert.equal((await request(`/worker/attempts/${a.id}/fail`,{ error:'test failure' },w.token)).status,200);
  assert.equal((await claim(w.token)).attempt,null); await store.set('tasks',t.id,{ available_at:future(-1) });
  const b=(await claim(w.token)).attempt; await request(`/worker/attempts/${b.id}/fail`,{ error:'test failure' },w.token);
  assert.equal((await request(`/tasks/${t.id}`)).data.status,'FAILED');
  const next=(await request(`/tasks/${t.id}/retry`,{})).data; assert.notEqual(next.id,t.id); assert.equal(next.status,'QUEUED');
});
test('cancellation fences completion and foreign output cannot be attached',async () => {
  const w=await enroll(),t=await submit(),a=(await claim(w.token)).attempt,payload=await completePayload(a.id,w.token);
  await request(`/tasks/${t.id}/cancel`,{}); assert.equal((await request(`/worker/attempts/${a.id}/complete`,payload,w.token)).status,409);
  assert.deepEqual((await beat(w.token,[a.id])).data.cancelled_attempt_ids,[a.id]);
  await submit(); const b=(await claim(w.token)).attempt; assert.equal((await request(`/worker/attempts/${b.id}/complete`,payload,w.token)).status,422);
});
test('uploads enforce type, nonempty and streaming byte limits',async () => {
  assert.equal((await request('/uploads?filename=script.sh',Buffer.from('x'),op,true)).status,422);
  assert.equal((await request('/uploads?filename=empty.csv',Buffer.alloc(0),op,true)).status,422);
  assert.equal((await request('/uploads?filename=large.csv',Buffer.alloc(10*1024*1024+1),op,true)).status,413);
});
test('local mode never invents AWS state or metrics',async () => {
  assert.equal((await request('/cloud/status')).data.connected,false);
  assert.deepEqual((await request('/cloud/instances')).data,[]);
  assert.equal((await request('/cloud/instances/i-unknown/metrics')).status,404);
});
