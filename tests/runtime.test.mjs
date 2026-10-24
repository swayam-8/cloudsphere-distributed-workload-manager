import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { availablePort, Runtime, waitForService } from '../scripts/runtime.mjs';

const script=fileURLToPath(new URL('./fixtures/runtime-server.mjs',import.meta.url));
async function fixture(mode) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cloudsphere-runtime-'));await fs.mkdir(path.join(root,'.local'));
  const runtime=new Runtime(root,process.env),handle=runtime.start('fixture',script,mode?[mode]:[],{ipc:true});
  const {port}=await new Promise((resolve,reject)=>{handle.child.once('message',resolve);handle.child.once('error',reject);});
  return {root,runtime,handle,url:`http://127.0.0.1:${port}`};
}
test('readiness verifies the spawned process, shutdown releases its port and supports restart',async()=>{
  const f=await fixture();
  try {
    await waitForService(f.handle,f.url,{timeoutMs:2000});
    const port=Number(new URL(f.url).port);
    await f.runtime.close();
    assert.equal(f.handle.child.exitCode,0);
    assert.equal(await availablePort(port),port);
  } finally {await f.runtime.close();await fs.rm(f.root,{recursive:true,force:true});}
});
test('wrong service and wrong PID cannot satisfy readiness, and failed startup cleans up',async()=>{
  const f=await fixture('wrong');
  try {await assert.rejects(waitForService(f.handle,f.url,{timeoutMs:300}),/different service or process/);}
  finally {await f.runtime.close();assert.equal(f.handle.child.exitCode,0);await fs.rm(f.root,{recursive:true,force:true});}
  const second=await fixture();
  try {await assert.rejects(waitForService(second.handle,second.url,{timeoutMs:300,pid:-1}),/different service or process/);}
  finally {await second.runtime.close();await fs.rm(second.root,{recursive:true,force:true});}
});
test('occupied ports select a free port without terminating the existing service',async()=>{
  const server=http.createServer((req,res)=>res.end('other project'));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const occupied=server.address().port,selected=await availablePort(occupied);
    assert.notEqual(selected,occupied);assert.equal(server.listening,true);
  } finally {await new Promise(resolve=>server.close(resolve));}
});
