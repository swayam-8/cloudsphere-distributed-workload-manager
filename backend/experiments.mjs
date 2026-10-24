import { createHash } from 'node:crypto';
import { now, after } from './store.mjs';
import { ACTIVE, event, reservations } from './scheduler.mjs';
import { experimentSchema, taskSchema } from './schemas.mjs';

const terminal=['COMPLETED','FAILED','CANCELLED'];
const mixes={quick:[100000,200000,400000],mixed:[500000,1000000,2000000]};
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function error(status,message){throw Object.assign(new Error(message),{status});}
async function required(db,id){return await db.one('experiments',id)||error(404,'Experiment not found');}
const seconds=(a,b)=>a&&b?Math.max(0,(Date.parse(b)-Date.parse(a))/1000):null;
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
export function percentile(values,fraction){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b),index=(sorted.length-1)*fraction,lower=Math.floor(index);
  return sorted[lower]+(sorted[Math.min(lower+1,sorted.length-1)]-sorted[lower])*(index-lower);
}

export function measureExperiment(experiment,tasks,attempts,metrics=[],timestamp=now()) {
  const finished=tasks.length===experiment.task_ids.length && tasks.every(t=>terminal.includes(t.status));
  const completed=tasks.filter(t=>t.status==='COMPLETED'),failed=tasks.filter(t=>t.status==='FAILED'),cancelled=tasks.filter(t=>t.status==='CANCELLED');
  const ended=finished?tasks.map(t=>t.completed_at).filter(Boolean).sort().at(-1):null;
  const completion=completed.map(t=>seconds(t.created_at,t.completed_at)).filter(n=>n!==null);
  const waiting=tasks.map(t=>seconds(t.created_at,t.started_at)).filter(n=>n!==null);
  const makespan=finished?seconds(experiment.created_at,ended):null;
  const workers=new Map(experiment.workers.map(w=>[w.id,{worker_id:w.id,name:w.name,assignments:0,completed:0}]));
  for(const a of attempts){if(!workers.has(a.worker_id))workers.set(a.worker_id,{worker_id:a.worker_id,name:a.worker_id,assignments:0,completed:0});workers.get(a.worker_id).assignments++;if(a.status==='COMPLETED')workers.get(a.worker_id).completed++;}
  const byTask=new Map();attempts.forEach(a=>byTask.set(a.task_id,(byTask.get(a.task_id)||0)+1));
  return {
    status:finished?(failed.length||cancelled.length?'FINISHED_WITH_ERRORS':'COMPLETED'):'RUNNING',completed_at:ended,
    total:experiment.task_ids.length,completed:completed.length,failed:failed.length,cancelled:cancelled.length,
    queued:tasks.filter(t=>t.status==='QUEUED').length,running:tasks.filter(t=>['ASSIGNED','RUNNING'].includes(t.status)).length,
    mean_queue_seconds:mean(waiting),queue_sample_count:waiting.length,
    median_completion_seconds:percentile(completion,.5),p95_completion_seconds:percentile(completion,.95),completion_sample_count:completion.length,
    makespan_seconds:makespan,elapsed_seconds:seconds(experiment.created_at,ended||timestamp),
    throughput_jobs_per_minute:makespan>0?completed.length/makespan*60:null,
    retries:[...byTask.values()].reduce((sum,n)=>sum+Math.max(0,n-1),0),failed_attempts:attempts.filter(a=>['FAILED','LOST'].includes(a.status)).length,
    distribution:[...workers.values()],host_cpu_percent_mean:mean(metrics.map(m=>m.cpu_percent)),metric_sample_count:metrics.length,
    additional_workers_observed:[...workers.keys()].filter(id=>!experiment.workers.some(w=>w.id===id)),
  };
}

export async function settleExperiments(db) {
  for(const experiment of await db.all('experiments',{status:'RUNNING'})) {
    const tasks=await db.all('tasks',{id:{$in:experiment.task_ids}});
    if(tasks.length===experiment.task_ids.length && tasks.every(t=>terminal.includes(t.status))) {
      const result=measureExperiment(experiment,tasks,[]);
      await db.set('experiments',experiment.id,{status:result.status,completed_at:result.completed_at});
    }
  }
}

export async function experimentDetails(store,id) {
  const experiment=await required(store,id),tasks=await store.all('tasks',{id:{$in:experiment.task_ids}},{created_at:1});
  const attempts=await store.all('attempts',{task_id:{$in:experiment.task_ids}},{created_at:1});
  const summary=measureExperiment(experiment,tasks,attempts);
  const end=summary.completed_at||now();
  const metrics=await store.all('metrics',{worker_id:{$in:[...new Set([...experiment.workers.map(w=>w.id),...attempts.map(a=>a.worker_id)])]},timestamp:{$gte:experiment.created_at,$lte:end}},{timestamp:1},5000);
  const other=await store.all('tasks',{id:{$nin:experiment.task_ids},created_at:{$lte:end},$or:[{completed_at:null},{completed_at:{$gte:experiment.created_at}}]});
  return {...experiment,status:summary.status,completed_at:summary.completed_at,summary:{...measureExperiment(experiment,tasks,attempts,metrics),other_workloads_observed:other.length},tasks,attempts,metrics};
}

function csvCell(value){
  if(value===null||value===undefined)return '';
  let text=String(value);
  if(typeof value==='string'&&/^[\s]*[=+@-]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function experimentCSV(detail) {
  const header=['experiment_id','algorithm','task_id','workload','kind','status','created_at','started_at','completed_at','queue_seconds','completion_seconds','attempts','worker_id'];
  return [header,...detail.tasks.map(task=>{
    const attempts=detail.attempts.filter(a=>a.task_id===task.id),last=attempts.at(-1);
    return [detail.id,detail.algorithm,task.id,task.name,task.kind,task.status,task.created_at,task.started_at,task.completed_at,
      seconds(task.created_at,task.started_at),task.status==='COMPLETED'?seconds(task.created_at,task.completed_at):null,attempts.length,last?.worker_id];
  })].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}

export function registerExperiments(app,store,cfg,op) {
  app.post('/api/experiments',op,async(req,res)=>{
    const body=experimentSchema.parse(req.body);
    const experiment=await store.transaction(async db=>{
      await settleExperiments(db);
      if(await db.one('experiments',{status:'RUNNING'}))error(409,'An experiment is still running. Wait for it to finish or cancel it before starting another.');
      const workers=await db.all('workers',{state:'HEALTHY',last_heartbeat:{$gt:after(-cfg.heartbeatTimeout)}},{name:1});
      let base={kind:'cpu',parameters:{limit:100000},cpu:1,memory_mb:256,priority:1,timeout_seconds:180,max_retries:1,input_id:null};
      let inputIdentity=null,source=null,inputName=null;
      if(body.mix==='repeat_task') {
        source=await db.one('tasks',body.source_task_id);if(!source)error(404,'Source workload not found');
        base=taskSchema.parse({name:'Experiment source',...Object.fromEntries(Object.keys(base).map(k=>[k,source[k]]))});delete base.name;
        if(source.input_id){const artifact=await db.one('artifacts',source.input_id);if(!artifact||artifact.role!=='input')error(422,'Source workload input is unavailable');inputIdentity=artifact.sha256||artifact.id;inputName=artifact.filename;}
      }
      const eligible=workers.filter(w=>w.cpu>=base.cpu && w.memory_mb>=base.memory_mb);
      if(eligible.length<2)error(422,'Connect at least two healthy workers that can each fit the selected job before starting an experiment.');
      const snapshot=[];
      for(const w of eligible)snapshot.push({id:w.id,name:w.name,cpu:w.cpu,memory_mb:w.memory_mb,max_parallel:w.max_parallel,mode:w.mode,instance_id:w.instance_id,instance_type:w.instance_type,reserved:await reservations(db,w.id)});
      const {input_id,...hashBase}=base;
      const record=await db.add('experiments',{name:body.name,algorithm:body.algorithm,mix:body.mix,job_count:body.job_count,
        source_task_id:source?.id||null,input_name:inputName,input_identity:inputIdentity,template:base,mode:cfg.mode,workers:snapshot,
        config_signature:fingerprint({mix:body.mix,job_count:body.job_count,template:hashBase,input_identity:inputIdentity}),
        worker_signature:fingerprint(snapshot.map(({id,cpu,memory_mb,max_parallel})=>({id,cpu,memory_mb,max_parallel})).sort((a,b)=>a.id.localeCompare(b.id))),
        task_ids:[],created_at:now(),completed_at:null,status:'RUNNING'});
      const ids=[];
      for(let i=0;i<body.job_count;i++) {
        const parameters=body.mix==='repeat_task'?base.parameters:{limit:mixes[body.mix][i%mixes[body.mix].length]};
        const task=await db.add('tasks',{...base,parameters,name:`${body.name} · job ${i+1}`,status:'QUEUED',output_id:null,
          created_at:now(),started_at:null,completed_at:null,available_at:now(),error:null,experiment_id:record.id,scheduling_algorithm:body.algorithm});
        ids.push(task.id);await event(db,'TASK_CREATED',`Experiment ${body.name}: job ${i+1} queued under ${body.algorithm}`,task.id);
      }
      await db.set('experiments',record.id,{task_ids:ids});return {...record,task_ids:ids};
    });
    res.status(201).json(experiment);
  });
  app.get('/api/experiments',op,async(req,res)=>{
    const records=await store.all('experiments',{}, {created_at:-1},50),items=[];
    for(const record of records){const detail=await experimentDetails(store,record.id);const{tasks,attempts,metrics,...item}=detail;items.push(item);}
    res.json(items);
  });
  app.get('/api/experiments/compare',op,async(req,res)=>{
    const ids=String(req.query.ids||'').split(',').filter(Boolean);
    if(ids.length<2||ids.length>4||new Set(ids).size!==ids.length)error(422,'Select two to four distinct completed runs to compare');
    const runs=[];for(const id of ids)runs.push(await experimentDetails(store,id));
    if(runs.some(r=>r.status==='RUNNING'))error(409,'Only finished experiments can be compared');
    const reasons=[];
    if(runs.some(r=>r.config_signature!==runs[0].config_signature))reasons.push('Workload mixes, inputs, resource requests or batch sizes differ.');
    if(runs.some(r=>r.worker_signature!==runs[0].worker_signature||r.mode!==runs[0].mode))reasons.push('Worker identities/capacities or environments differ.');
    if(runs.some(r=>r.summary.other_workloads_observed>0))reasons.push('Other workloads overlapped at least one run.');
    if(runs.some(r=>r.summary.additional_workers_observed.length))reasons.push('A worker outside the initial topology executed work.');
    if(runs.some(r=>r.summary.failed||r.summary.cancelled))reasons.push('At least one batch contains failed or cancelled jobs.');
    res.json({comparable:!reasons.length,reasons,caveat:'Matching conditions do not control host background load, image warm-up or cloud variability. Repeat trials; no policy is assumed to win.',runs:runs.map(({tasks,attempts,metrics,...run})=>run)});
  });
  app.get('/api/experiments/:id/export',op,async(req,res)=>{
    const detail=await experimentDetails(store,req.params.id);
    res.type('text/csv').attachment(`cloudsphere-experiment-${detail.id}.csv`).send(experimentCSV(detail));
  });
  app.get('/api/experiments/:id',op,async(req,res)=>res.json(await experimentDetails(store,req.params.id)));
  app.post('/api/experiments/:id/cancel',op,async(req,res)=>{
    await store.transaction(async db=>{
      const experiment=await required(db,req.params.id);
      for(const task of await db.all('tasks',{id:{$in:experiment.task_ids},status:{$nin:terminal}})) {
        await db.set('tasks',task.id,{status:'CANCELLED',completed_at:now()});
        for(const a of await db.all('attempts',{task_id:task.id,status:{$in:ACTIVE}}))await db.set('attempts',a.id,{status:'CANCELLED',completed_at:now()});
        await event(db,'TASK_CANCELLED',`Experiment ${experiment.name} cancelled`,task.id);
      }
      await settleExperiments(db);
    });
    res.json(await experimentDetails(store,req.params.id));
  });
}
