import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execute } from '../worker/executor.mjs';
import { zipFiles } from './helpers/zip.mjs';
import { datasets } from '../frontend/src/lib/datasets.js';

const task=parameters=>({id:'analytics-fixture',kind:'csv',parameters,cpu:1,memory_mb:256,timeout_seconds:20});

test('real CSV quality job cleans explicitly, aggregates retained rows and exports verifiable reports',async()=>{
  const input=Buffer.from(datasets.quality.csv);
  const {result,archive}=await execute(task({group_by:'category',value_column:'amount',deduplicate:true,drop_missing:true,invalid_numeric:'skip'}),{input});
  assert.equal(result.task_id,'analytics-fixture');assert.equal(result.analysis_version,2);
  assert.deepEqual(result.quality,{input_rows:7,retained_rows:4,duplicates_found:1,duplicates_removed:1,missing_rows:1,missing_cells:1,missing_rows_removed:1,invalid_rows_removed:1,column_count:4,completeness_percent:96.43,cleaned_completeness_percent:100});
  assert.deepEqual(result.groups,[{group:'Books',count:4,sum:'10300',mean:'2575',min:'90',max:'10000'}]);
  assert.equal(result.outliers.count,1);assert.equal(result.input_sha256,createHash('sha256').update(input).digest('hex'));
  const files=zipFiles(archive);
  assert.deepEqual([...files.keys()].sort(),['aggregates.csv','cleaned.csv','outliers.csv','quality.json','report.html','result.json']);
  assert.equal(files.get('cleaned.csv').toString().trim().split('\n').length,5);
  assert.match(files.get('aggregates.csv').toString(),/Books,4,10300,2575,90,10000/);
  assert.match(files.get('outliers.csv').toString(),/4,Books,10000,North/);
  assert.equal(files.get('outliers.csv').toString().trim().split('\n').length,2);
  assert.equal(JSON.parse(files.get('quality.json')).profiles[2].type,'number');
  assert.match(files.get('report.html').toString(),new RegExp(result.input_sha256));
});

test('a text-only CSV produces counts and profiles without invented numeric statistics; report escapes HTML',async()=>{
  const {result,archive}=await execute(task({group_by:'department'}),{input:Buffer.from('department,note\n<script>,=HYPERLINK("test")\n<script>,second\n')});
  assert.equal(result.groups[0].count,2);assert.equal(result.groups[0].sum,null);assert.equal(result.groups[0].mean,null);
  assert.equal(result.outliers.available,false);assert.equal(result.profiles[1].type,'text');
  const files=zipFiles(archive);assert.match(files.get('cleaned.csv').toString(),/'=HYPERLINK/);
  const html=files.get('report.html').toString();assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
});

test('invalid numeric values fail by default; disabled outliers never remove rows',async()=>{
  await assert.rejects(execute(task({value_column:'amount'}),{input:Buffer.from('amount\n₹100\n')}),/non-numeric/);
  const {result}=await execute(task({value_column:'amount',detect_outliers:false}),{input:Buffer.from('amount\n1\n1\n1\n1000\n')});
  assert.equal(result.cleaned_count,4);assert.equal(result.outliers.available,false);assert.match(result.outliers.reason,/disabled/);
});
