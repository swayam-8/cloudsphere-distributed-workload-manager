import { after, now } from './store.mjs';

export const ACTIVE = ['ASSIGNED','RUNNING'];
export const event = (db, kind, message, task_id = null, worker_id = null) => db.add('events', { timestamp: now(), kind, message, task_id, worker_id });
export async function settings(db) { return (await db.one('settings', 'scheduler'))?.value || { algorithm: 'resource_aware' }; }
export async function reservations(db, workerId) {
  const attempts = await db.all('attempts', { worker_id: workerId, status: { $in: ACTIVE } });
  const result = { cpu: 0, memory_mb: 0, jobs: attempts.length };
  for (const a of attempts) { const t = await db.one('tasks', a.task_id); result.cpu += t.cpu; result.memory_mb += t.memory_mb; }
  return result;
}
export async function failAttempt(db, attempt, task, error, cfg, status = 'FAILED') {
  await db.set('attempts', attempt.id, { status, completed_at: now(), error });
  if (attempt.number <= task.max_retries) {
    await db.set('tasks', task.id, { status: 'QUEUED', error, available_at: after(cfg.retryBackoff * 2 ** (attempt.number - 1)) });
    await event(db, 'TASK_REQUEUED', error, task.id, attempt.worker_id);
  } else {
    await db.set('tasks', task.id, { status: 'FAILED', error, completed_at: now() });
    await event(db, 'TASK_FAILED', error, task.id, attempt.worker_id);
  }
}
export async function reap(db, cfg) {
  for (const w of await db.all('workers', { state: 'HEALTHY', last_heartbeat: { $lt: after(-cfg.heartbeatTimeout) } })) {
    await db.set('workers', w.id, { state: 'OFFLINE' });
    await event(db, 'WORKER_OFFLINE', 'Heartbeat expired; attempts remain fenced by their leases', null, w.id);
  }
  for (const a of await db.all('attempts', { status: { $in: ACTIVE }, lease_expires_at: { $lte: now() } })) {
    await failAttempt(db, a, await db.one('tasks', a.task_id), 'Execution lease expired', cfg, 'LOST');
  }
}
export async function schedule(db, cfg) {
  await reap(db, cfg);
  const { algorithm } = await settings(db), workers = await db.all('workers', {}, { name: 1 });
  const queue = await db.all('tasks', { status: 'QUEUED', available_at: { $lte: now() } });
  const age = t => t.priority + Math.floor((Date.now() - Date.parse(t.created_at)) / 60000);
  queue.sort((a,b) => age(b) - age(a) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  for (const task of queue) {
    const candidates = [];
    for (const worker of workers) {
      const reserved = await reservations(db, worker.id), free_cpu = worker.cpu - reserved.cpu, free_memory_mb = worker.memory_mb - reserved.memory_mb;
      const reasons = [];
      if (worker.state !== 'HEALTHY') reasons.push('Worker heartbeat is offline');
      if (reserved.jobs >= worker.max_parallel) reasons.push('Parallel-job limit reached');
      if (free_cpu + 1e-9 < task.cpu) reasons.push('Insufficient unreserved CPU');
      if (free_memory_mb < task.memory_mb) reasons.push('Insufficient unreserved memory');
      const metric = (await db.all('metrics', { worker_id: worker.id }, { timestamp: -1 }, 1))[0];
      const host = metric ? (metric.cpu_percent + metric.memory_percent) / 200 : 0;
      const load = (host + reserved.cpu / worker.cpu + reserved.memory_mb / worker.memory_mb) / 3;
      const fit = ((free_cpu - task.cpu) / worker.cpu + (free_memory_mb - task.memory_mb) / worker.memory_mb) / 2;
      candidates.push({ worker_id: worker.id, name: worker.name, instance_id: worker.instance_id, reserved, free_cpu, free_memory_mb,
        eligible: !reasons.length, reasons, score: Number((algorithm === 'least_loaded' ? load : fit).toFixed(6)) });
    }
    const eligible = candidates.filter(c => c.eligible);
    let chosen = null;
    if (eligible.length) {
      if (algorithm === 'round_robin') {
        const previous = (await db.one('settings', 'round_robin_cursor'))?.value?.name || '';
        chosen = eligible.find(c => c.name > previous) || eligible[0];
        await db.setting('round_robin_cursor', { name: chosen.name });
      } else chosen = [...eligible].sort((a,b) => a.score - b.score || a.name.localeCompare(b.name))[0];
    }
    const rule = { round_robin: 'rotation among eligible workers', least_loaded: 'the lowest host-load and reservation score', resource_aware: 'the smallest normalized CPU/memory remainder (best fit)' }[algorithm];
    const explanation = chosen ? `Selected ${chosen.name} by ${rule}.` : 'Waiting for a healthy worker with sufficient unreserved CPU, memory, and job slots.';
    const previous = (await db.all('decisions', { task_id: task.id }, { created_at: -1 }, 1))[0];
    if (chosen || !previous || previous.algorithm !== algorithm || JSON.stringify(previous.candidates) !== JSON.stringify(candidates)) {
      await db.add('decisions', { task_id: task.id, created_at: now(), algorithm, worker_id: chosen?.worker_id || null, candidates, explanation });
    }
    if (chosen) {
      const number = (await db.all('attempts', { task_id: task.id })).length + 1;
      await db.add('attempts', { task_id: task.id, worker_id: chosen.worker_id, number, status: 'ASSIGNED',
        lease_expires_at: after(cfg.leaseSeconds), created_at: now(), started_at: null, completed_at: null, exit_code: null, logs: '', error: null, result: null });
      await db.set('tasks', task.id, { status: 'ASSIGNED', error: null });
      await event(db, 'TASK_ASSIGNED', explanation, task.id, chosen.worker_id);
    }
  }
}
