import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudOverview} from '../backend/cloud-overview.mjs';

test('AWS overview reports missing local configuration without making any cloud calls',async()=>{
  const store={all:async(name)=>{assert.equal(name,'tasks');return [];}};
  const cfg={mode:'LOCAL',operatorToken:'private-operator',enrollmentToken:'private-worker',batchLogGroup:'/aws/batch/cloudsphere'};
  const view=await cloudOverview(store,cfg,{enabled:false});
  assert.equal(view.mode,'LOCAL');assert.equal(view.enabled,false);assert.equal(view.region,null);assert.equal(view.verification.status,'not_checked');
  assert.equal(view.missing.length,5);assert.deepEqual(view.recent_tasks,[]);assert.equal(view.evidence.recorded_jobs,0);
  assert.doesNotMatch(JSON.stringify(view),/private-operator|private-worker/);
});

test('AWS overview exposes bounded recorded evidence, not raw task or credential documents',async()=>{
  const calls=[];
  const store={all:async(name,query,sort,limit)=>{
    calls.push({name,query,limit});
    return name==='tasks'?[{id:'task',name:'Sales',status:'COMPLETED',kind:'csv',batch_job_id:'job',aws_region:'eu-north-1',parameters:{private_data:'not-for-this-view'}}]:name==='attempts'?[{task_id:'task',batch_image:'image@sha256:example',batch_log_stream:'stream',batch_compute:{instance_id:'i-observed',vpc_id:'vpc-observed',observed_at:'2026-01-01T00:00:00.000Z'}}]:[{id:'audit'}];
  }};
  const view=await cloudOverview(store,{mode:'AWS',region:'eu-north-1',expectedAccount:'123456789012',batchQueue:'queue',batchDefinition:'definition',bucket:'bucket',auditTable:'audit'}, {enabled:true,verification:()=>({status:'passed',checked_at:'now',details:{account:'123456789012'}})});
  assert.equal(view.evidence.recorded_jobs,1);assert.equal(view.evidence.completed_jobs,1);assert.equal(view.evidence.synced_audit_events,1);
  assert.equal(view.evidence.compute[0].instance_id,'i-observed');assert.equal(view.verification.status,'passed');assert.deepEqual(view.missing,[]);
  assert.equal(calls[0].limit,20);assert.equal(calls[2].query.audit_table,'audit');assert.doesNotMatch(JSON.stringify(view),/not-for-this-view/);
});
