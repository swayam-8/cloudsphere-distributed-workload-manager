import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execute } from '../worker/executor.mjs';
import { storage } from '../backend/storage.mjs';
import fs from 'node:fs/promises';

test('Docker benchmark computes a known count and checksum',async () => {
  const result=await execute({ kind:'cpu',parameters:{ limit:100 },cpu:1,memory_mb:256,timeout_seconds:15 });
  assert.equal(result.result.prime_count,25); assert.equal(result.result.prime_sum,1060);
  assert.ok(result.archive.subarray(0,2).equals(Buffer.from('PK'))); assert.match(result.logs,/Starting approved template/);
});
test('Docker CSV aggregation produces actual grouped output',async () => {
  const result=await execute({ kind:'csv',parameters:{ group_by:'category',value_column:'amount' },cpu:1,memory_mb:256,timeout_seconds:15 },{ input:Buffer.from('category,amount\na,2\nb,3\na,4\n') });
  assert.equal(result.result.record_count,3); assert.equal(result.result.group_count,2);
});
test('Docker image job resizes a genuine PNG',async () => {
  const png=await fs.readFile(new URL('../examples/sample.png',import.meta.url));
  const result=await execute({ kind:'images',parameters:{ width:64 },cpu:1,memory_mb:256,timeout_seconds:15 },{ input:png,extension:'.png' });
  assert.equal(result.result.image_count,1); assert.equal(result.result.images[0].width,64); assert.equal(result.result.images[0].height,32);
});
test('timeout stops a running container',async () => {
  await assert.rejects(execute({ kind:'cpu',parameters:{ limit:20000000 },cpu:1,memory_mb:256,timeout_seconds:1 }),/execution timeout/);
});
test('cancellation stops a running container',async () => {
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),700);
  try { await assert.rejects(execute({ kind:'cpu',parameters:{ limit:20000000 },cpu:1,memory_mb:256,timeout_seconds:20 },{ signal:abort.signal }),/Cancelled/); }
  finally { clearTimeout(timer); }
});
test('invalid CSV fails with useful logs',async () => {
  await assert.rejects(execute({ kind:'csv',parameters:{ group_by:'missing',value_column:'' },cpu:1,memory_mb:256,timeout_seconds:15 },{ input:Buffer.from('a,b\n1,2\n') }),/column does not exist/);
});
test('S3 adapter uses encrypted private object operations without credentials',async () => {
  const calls=[];
  const client={ async send(command) { calls.push(command); return { Body:{ transformToByteArray:async()=>Buffer.from('result') } }; } };
  const files=storage({ mode:'AWS',region:'ap-south-1',bucket:'test-project-bucket' },client);
  await files.put('attempt-file',Buffer.from('result')); assert.equal((await files.get('attempt-file')).toString(),'result');
  assert.equal(calls[0].input.ServerSideEncryption,'AES256'); assert.equal(calls[0].input.Bucket,'test-project-bucket'); assert.equal(calls[0].input.Key,'cloudsphere/attempt-file');
});
