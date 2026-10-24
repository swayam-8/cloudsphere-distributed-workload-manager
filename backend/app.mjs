import express from 'express';
import { createHash, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';
import path from 'node:path';
import { ZodError } from 'zod';
import { after, now } from './store.mjs';
import { ACTIVE, event, failAttempt, reap, reservations, schedule, settings } from './scheduler.mjs';
import { completionSchema, failureSchema, heartbeatSchema, progressSchema, registerSchema, settingsSchema, taskSchema } from './schemas.mjs';
import { cloudMetrics, instances, storage } from './storage.mjs';
import { registerExperiments } from './experiments.mjs';

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const fail = (status, message) => { throw new HttpError(status, message); };
export const hash = value => createHash('sha256').update(value).digest('hex');
const bearer = req => (req.get('authorization') || '').startsWith('Bearer ') ? req.get('authorization').slice(7) : '';
const matches = (a,b) => timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)));
const safeWorker = ({ token_hash, ...worker }) => worker;
const need = async (db, name, id) => (await db.one(name, id)) || fail(404, 'Record not found');

export function createApp(store, cfg) {
  const app = express(), files = storage(cfg);
  app.disable('x-powered-by');
  app.use((req,res,next) => { res.set('X-Content-Type-Options','nosniff'); res.set('Cache-Control','no-store'); next(); });
  app.use(express.json({ limit: '96kb' }));
  const op = (req,res,next) => { if (!matches(bearer(req), cfg.operatorToken)) return res.status(401).json({ detail: 'Operator authentication required' }); next(); };
  const enrollment = (req,res,next) => { if (!matches(bearer(req), cfg.enrollmentToken)) return res.status(401).json({ detail: 'Enrollment authentication required' }); next(); };
  const worker = async (req,res,next) => { const w = await store.one('workers', { token_hash: hash(bearer(req)) }); if (!w) fail(401,'Worker authentication required'); req.workerId = w.id; next(); };
  const raw = express.raw({ type: () => true, limit: cfg.maxUploadBytes });
  async function owned(db, id, workerId, active = true) {
    const a = await need(db,'attempts',id);
    if (a.worker_id !== workerId) fail(403,'Attempt belongs to another worker');
    if (active && (a.status !== 'RUNNING' || a.lease_expires_at <= now())) fail(409,'Attempt is no longer active; stale results are fenced');
    return a;
  }
  async function dashboard() {
    const tasks = await store.all('tasks'), workers = await store.all('workers'), counts = {};
    tasks.forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1; });
    return { mode: cfg.mode, counts, total: tasks.length, healthy_workers: workers.filter(w => w.state === 'HEALTHY').length,
      offline_workers: workers.filter(w => w.state !== 'HEALTHY').length, recent_tasks: tasks.sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,6), timestamp: now() };
  }
  async function taskDetail(id) {
    const task=await need(store,'tasks',id);
    return { ...task, input_artifact:task.input_id ? await store.one('artifacts',task.input_id) : null,
      output_artifact:task.output_id ? await store.one('artifacts',task.output_id) : null,
      attempts: await store.all('attempts',{ task_id: id },{ number: 1 }),
      decisions: await store.all('decisions',{ task_id: id },{ created_at: 1 }), events: await store.all('events',{ task_id: id },{ timestamp: 1 }) };
  }
  const events = workerId => store.all('events', workerId ? { worker_id: workerId } : {}, { timestamp: -1 }, 100);
  app.get(['/health','/api/health'], async (req,res) => {
    await store.db.command({ ping: 1 });
    res.json({ service: 'cloudsphere', pid: process.pid, status: 'ok', mode: cfg.mode, database: 'MongoDB replica set' });
  });
  app.get('/api/dashboard', op, async (req,res) => res.json(await dashboard()));
  app.post('/api/tasks', op, async (req,res) => {
    const body = taskSchema.parse(req.body);
    res.status(201).json(await store.transaction(async db => {
      if (body.input_id) {
        const artifact = await need(db,'artifacts',body.input_id);
        const allowed = body.kind === 'csv' ? ['.csv'] : ['.png','.jpg','.jpeg','.zip'];
        if (artifact.role !== 'input' || !allowed.includes(path.extname(artifact.filename).toLowerCase())) fail(422,'Input file type does not match job template');
      }
      const task = await db.add('tasks', { ...body, status: 'QUEUED', output_id: null, created_at: now(), started_at: null, completed_at: null, available_at: now(), error: null });
      await event(db,'TASK_CREATED','Task queued for scheduling',task.id); return task;
    }));
  });
  app.get('/api/tasks', op, async (req,res) => {
    const page = Number(req.query.page || 1), pageSize = Number(req.query.page_size || 20), q = String(req.query.q || '');
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || q.length > 120) fail(422,'Invalid pagination or search');
    const query = req.query.status ? { status: String(req.query.status) } : {};
    // Literal substring search avoids interpreting user regular expressions.
    const tasks = (await store.all('tasks', query, { created_at: -1 })).filter(t => t.name.toLowerCase().includes(q.toLowerCase()));
    res.json({ items: tasks.slice((page-1)*pageSize,page*pageSize), total: tasks.length, page, page_size: pageSize });
  });
  app.get('/api/tasks/:id', op, async (req,res) => res.json(await taskDetail(req.params.id)));
  for (const [suffix,field] of [['attempts','attempts'],['decision','decisions'],['logs','attempts']]) app.get(`/api/tasks/:id/${suffix}`, op, async (req,res) => {
    const rows = (await taskDetail(req.params.id))[field]; res.json(suffix === 'logs' ? rows.map(a => ({ attempt_id: a.id, number: a.number, logs: a.logs })) : rows);
  });
  app.post('/api/tasks/:id/cancel', op, async (req,res) => res.json(await store.transaction(async db => {
    const t = await need(db,'tasks',req.params.id);
    if (['COMPLETED','FAILED'].includes(t.status)) fail(409,'Task already finished');
    if (t.status !== 'CANCELLED') {
      await db.set('tasks',t.id,{ status:'CANCELLED', completed_at: now() });
      for (const a of await db.all('attempts',{ task_id: t.id, status: { $in: ACTIVE } })) await db.set('attempts',a.id,{ status:'CANCELLED',completed_at:now() });
      await event(db,'TASK_CANCELLED','Cancellation fenced active attempts; workers stop at next heartbeat',t.id);
    }
    return db.one('tasks',t.id);
  })));
  app.post('/api/tasks/:id/retry', op, async (req,res) => res.status(201).json(await store.transaction(async db => {
    const t = await need(db,'tasks',req.params.id);
    if (!['FAILED','CANCELLED'].includes(t.status)) fail(409,'Only failed or cancelled tasks can be retried');
    const { _id, id, experiment_id, scheduling_algorithm, ...fields } = t;
    const next = await db.add('tasks',{ ...fields, status:'QUEUED', output_id:null, started_at:null,completed_at:null,created_at:now(),available_at:now(),error:null });
    await event(db,'TASK_CREATED',`Manual retry of ${t.id}`,next.id); return next;
  })));
  app.post('/api/uploads', op, raw, async (req,res) => {
    const filename = path.basename(String(req.query.filename || ''));
    if (filename.length > 200 || !['.csv','.png','.jpg','.jpeg','.zip'].includes(path.extname(filename).toLowerCase())) fail(422,'Supported inputs: CSV, ZIP, PNG, JPG');
    if (!Buffer.isBuffer(req.body) || !req.body.length) fail(422,'Artifact is empty');
    // External storage writes stay outside retryable Mongo transactions.
    const id = randomUUID(); await files.put(id,req.body);
    const artifact = { _id:id,id,filename,size:req.body.length,sha256:hash(req.body),role:'input',created_at:now(),attempt_id:null };
    await store.db.collection('artifacts').insertOne(artifact); res.status(201).json(artifact);
  });
  app.get('/api/tasks/:id/output', op, async (req,res) => {
    const task = await need(store,'tasks',req.params.id);
    if (task.status !== 'COMPLETED' || !task.output_id) fail(404,'No completed output');
    const artifact = await need(store,'artifacts',task.output_id);
    res.attachment(artifact.filename).send(await files.get(artifact.id));
  });
  app.get('/api/workers', op, async (req,res) => {
    const rows = [];
    for (const w of await store.all('workers', {}, { name:1 })) rows.push({ ...safeWorker(w),reserved:await reservations(store,w.id),metric:(await store.all('metrics',{ worker_id:w.id },{ timestamp:-1 },1))[0] || null });
    res.json(rows);
  });
  app.get('/api/workers/:id', op, async (req,res) => res.json({ ...safeWorker(await need(store,'workers',req.params.id)),reserved:await reservations(store,req.params.id),attempts:await store.all('attempts',{ worker_id:req.params.id },{ created_at:-1 },100) }));
  app.get('/api/workers/:id/metrics', op, async (req,res) => { await need(store,'workers',req.params.id); res.json((await store.all('metrics',{ worker_id:req.params.id },{ timestamp:-1 },120)).reverse()); });
  app.get('/api/workers/:id/events', op, async (req,res) => res.json(await events(req.params.id)));
  app.get('/api/events', op, async (req,res) => res.json(await events(req.query.worker_id)));
  app.get('/api/monitoring', op, async (req,res) => res.json({ metrics:(await store.all('metrics',{}, { timestamp:-1 },240)).reverse(), events:await events(),dashboard:await dashboard(),source:'Node os host observations (shared host in local mode)' }));
  const getSettings = async () => ({ ...await settings(store),mode:cfg.mode,lease_seconds:cfg.leaseSeconds,heartbeat_timeout:cfg.heartbeatTimeout,max_upload_bytes:cfg.maxUploadBytes });
  app.get('/api/settings', op, async (req,res) => res.json(await getSettings()));
  app.put('/api/settings', op, async (req,res) => { const body = settingsSchema.parse(req.body); await store.transaction(async db => { await db.setting('scheduler',body); await event(db,'SETTINGS_CHANGED',`Scheduling algorithm: ${body.algorithm}`); }); res.json(await getSettings()); });
  app.get('/api/cloud/status', op, (req,res) => res.json({ mode:cfg.mode,connected:cfg.mode === 'LOCAL' ? false : null,message:cfg.mode === 'LOCAL' ? 'AWS not connected — local workers and artifacts' : 'AWS configured; query instances to verify access',region:cfg.mode === 'AWS' ? cfg.region : null }));
  app.get('/api/cloud/instances', op, async (req,res) => { try { res.json(await instances(cfg)); } catch { fail(503,'AWS discovery failed; check IAM role, tags, region and connectivity'); } });
  app.get('/api/cloud/instances/:id/metrics', op, async (req,res) => {
    try { if (!(await instances(cfg)).some(i => i.instance_id === req.params.id)) fail(404,'Instance is not a configured project worker'); res.json(await cloudMetrics(cfg,req.params.id)); }
    catch(e) { if (e.status) throw e; fail(503,'CloudWatch query failed'); }
  });
  app.post('/api/worker/register', enrollment, async (req,res) => {
    const body = registerSchema.parse(req.body), token = randomBytes(32).toString('base64url');
    if (cfg.mode === 'LOCAL' && body.instance_id) fail(422,'Local workers cannot claim EC2 identity');
    if (cfg.mode === 'AWS' && (!body.instance_id || !body.instance_type || !body.region)) fail(422,'AWS workers require instance identity, type and region');
    const identity = await store.transaction(async db => {
      if (await db.one('workers',{ name:body.name })) fail(409,'Worker name already enrolled; reuse its saved credential or choose a new name');
      const w = await db.add('workers',{ ...body,token_hash:hash(token),mode:cfg.mode,state:'HEALTHY',last_heartbeat:now() });
      await event(db,'WORKER_REGISTERED',`Worker ${w.name} enrolled`,null,w.id); return w.id;
    });
    res.status(201).json({ worker_id:identity,token });
  });
  app.post('/api/worker/heartbeat', worker, async (req,res) => {
    const body = heartbeatSchema.parse(req.body);
    res.json(await store.transaction(async db => {
      await reap(db,cfg); const w = await need(db,'workers',req.workerId);
      if (w.state === 'OFFLINE') await event(db,'WORKER_RECOVERED','Authenticated heartbeat restored worker health',null,w.id);
      await db.set('workers',w.id,{ state:'HEALTHY',last_heartbeat:now() });
      await db.add('metrics',{ worker_id:w.id,timestamp:now(),cpu_percent:body.cpu_percent,memory_percent:body.memory_percent,source:'Node os / host' });
      const cancelled_attempt_ids = [];
      for (const id of body.active_attempt_ids) {
        const a = await db.one('attempts',id);
        if (a && a.worker_id === w.id && a.status === 'RUNNING' && a.lease_expires_at > now()) await db.set('attempts',a.id,{ lease_expires_at:after(cfg.leaseSeconds) });
        else cancelled_attempt_ids.push(id);
      }
      return { cancelled_attempt_ids };
    }));
  });
  app.post('/api/worker/claim', worker, async (req,res) => res.json(await store.transaction(async db => {
    const w = await need(db,'workers',req.workerId);
    if (w.last_heartbeat <= after(-cfg.heartbeatTimeout)) fail(409,'Send a fresh heartbeat before claiming');
    await schedule(db,cfg);
    const a = (await db.all('attempts',{ worker_id:w.id,status:'ASSIGNED' },{ created_at:1 },1))[0];
    if (!a) return { attempt:null };
    const t = await need(db,'tasks',a.task_id);
    await db.set('attempts',a.id,{ status:'RUNNING',started_at:now(),lease_expires_at:after(cfg.leaseSeconds) });
    await db.set('tasks',t.id,{ status:'RUNNING',started_at:t.started_at || now() });
    await event(db,'TASK_RUNNING',`Attempt ${a.number} claimed`,t.id,w.id);
    return { attempt:await db.one('attempts',a.id),task:await db.one('tasks',t.id) };
  })));
  app.get('/api/worker/attempts/:id/input', worker, async (req,res) => {
    const a = await owned(store,req.params.id,req.workerId), t = await need(store,'tasks',a.task_id);
    if (!t.input_id) fail(404,'No input');
    const artifact = await need(store,'artifacts',t.input_id);
    res.type('application/octet-stream').set('X-Input-Extension',path.extname(artifact.filename).toLowerCase()).send(await files.get(artifact.id));
  });
  app.post('/api/worker/attempts/:id/output', worker, raw, async (req,res) => {
    await owned(store,req.params.id,req.workerId);
    if (!Buffer.isBuffer(req.body) || !req.body.length) fail(422,'Artifact is empty');
    const id = randomUUID(); await files.put(id,req.body);
    res.status(201).json(await store.transaction(async db => {
      await owned(db,req.params.id,req.workerId);
      // A unique artifact per upload; only the winning current attempt can attach it.
      const row = { _id:id,id,role:'output',filename:`result-${req.params.id}.zip`,size:req.body.length,created_at:now(),attempt_id:req.params.id };
      await db.db.collection('artifacts').insertOne(row,db.options); return row;
    }));
  });
  app.post('/api/worker/attempts/:id/progress', worker, async (req,res) => {
    const body = progressSchema.parse(req.body);
    await store.transaction(async db => { await owned(db,req.params.id,req.workerId); await db.set('attempts',req.params.id,body); }); res.json({ status:'RUNNING' });
  });
  app.post('/api/worker/attempts/:id/complete', worker, async (req,res) => {
    const body = completionSchema.parse(req.body);
    if (JSON.stringify(body.result).length > 64000) fail(422,'Result metadata exceeds limit');
    res.json(await store.transaction(async db => {
      const a = await owned(db,req.params.id,req.workerId,false), t = await need(db,'tasks',a.task_id);
      if (a.status === 'COMPLETED') {
        if (JSON.stringify(a.result) !== JSON.stringify(body.result) || t.output_id !== body.output_id) fail(409,'Conflicting completion replay');
        return a;
      }
      await owned(db,a.id,req.workerId);
      const artifact = await need(db,'artifacts',body.output_id);
      if (artifact.role !== 'output' || artifact.attempt_id !== a.id) fail(422,'Output must belong to this attempt');
      await db.set('attempts',a.id,{ status:'COMPLETED',completed_at:now(),logs:body.logs,exit_code:0,result:body.result });
      await db.set('tasks',t.id,{ status:'COMPLETED',completed_at:now(),output_id:artifact.id,error:null });
      await event(db,'TASK_COMPLETED','Output persisted; reservations released',t.id,req.workerId); return db.one('attempts',a.id);
    }));
  });
  app.post('/api/worker/attempts/:id/fail', worker, async (req,res) => {
    const body = failureSchema.parse(req.body);
    res.json(await store.transaction(async db => {
      const a = await owned(db,req.params.id,req.workerId,false);
      if (a.status === 'FAILED') return a;
      await owned(db,a.id,req.workerId); await db.set('attempts',a.id,{ logs:body.logs,exit_code:body.exit_code });
      await failAttempt(db,a,await need(db,'tasks',a.task_id),body.error,cfg); return db.one('attempts',a.id);
    }));
  });
  registerExperiments(app,store,cfg,op);
  app.use((req,res) => res.status(404).json({ detail:'Endpoint not found' }));
  app.use((error,req,res,next) => {
    const status = error instanceof ZodError ? 422 : error.status || (error.code === 11000 ? 409 : 500);
    if (status === 500) console.error('API operation failed:',error.name); // No tokens, bodies or SDK credential errors.
    res.status(status).json({ detail: error instanceof ZodError ? error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') : status >= 500 ? 'Service operation failed; inspect server configuration' : error.message });
  });
  return app;
}
