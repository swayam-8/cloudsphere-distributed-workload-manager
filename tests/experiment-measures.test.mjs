import { test } from 'node:test';
import assert from 'node:assert/strict';
import { experimentCSV, measureExperiment, percentile } from '../backend/experiments.mjs';

const at=n=>new Date(Date.UTC(2026,0,1,0,0,n)).toISOString();
const run={id:'run',algorithm:'round_robin',created_at:at(0),task_ids:['a','b'],workers:[{id:'w1',name:'Worker 1'},{id:'w2',name:'Worker 2'}]};
test('experiment measurements use actual timestamps, successful samples and all attempt assignments',()=>{
  const tasks=[{id:'a',status:'COMPLETED',created_at:at(0),started_at:at(2),completed_at:at(10)},{id:'b',status:'COMPLETED',created_at:at(0),started_at:at(4),completed_at:at(20)}];
  const attempts=[{task_id:'a',worker_id:'w1',status:'LOST'},{task_id:'a',worker_id:'w2',status:'COMPLETED'},{task_id:'b',worker_id:'w2',status:'COMPLETED'}];
  const result=measureExperiment(run,tasks,attempts,[{cpu_percent:20},{cpu_percent:40}],at(25));
  assert.equal(result.mean_queue_seconds,3);assert.equal(result.median_completion_seconds,15);assert.equal(result.p95_completion_seconds,19.5);
  assert.equal(result.makespan_seconds,20);assert.equal(result.throughput_jobs_per_minute,6);assert.equal(result.retries,1);assert.equal(result.failed_attempts,1);
  assert.equal(result.host_cpu_percent_mean,30);assert.deepEqual(result.distribution.map(w=>w.assignments),[1,2]);
});
test('unobserved measurements stay null and failed jobs do not enter success percentiles',()=>{
  const tasks=[{id:'a',status:'FAILED',created_at:at(0),started_at:at(1),completed_at:at(5)},{id:'b',status:'QUEUED',created_at:at(0)}];
  const result=measureExperiment(run,tasks,[],[],at(9));
  assert.equal(result.status,'RUNNING');assert.equal(result.makespan_seconds,null);assert.equal(result.median_completion_seconds,null);
  assert.equal(result.host_cpu_percent_mean,null);assert.equal(result.queue_sample_count,1);assert.equal(percentile([],0.95),null);
});
test('experiment CSV preserves timestamps, blanks unobserved durations and guards formula-like task names',()=>{
  const csv=experimentCSV({...run,tasks:[{id:'a',name:'=malicious()',kind:'csv',status:'QUEUED',created_at:at(0)}],attempts:[]});
  assert.match(csv,/'=malicious\(\)/);assert.match(csv,/2026-01-01/);assert.doesNotMatch(csv,/NaN|undefined/);
});
