import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { localApiAddress } from '../scripts/local-address.mjs';

test('runtime helpers discover the selected port and reject another app or a remote address',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cloudsphere-address-'));await fs.mkdir(path.join(root,'.local'));
  let service='cloudsphere';
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    await fs.writeFile(path.join(root,'.local/runtime.json'),JSON.stringify({apiUrl:origin}));
    assert.equal(await localApiAddress(root,{}),origin);
    service='another-project';await assert.rejects(localApiAddress(root,{}),/not a ready CloudSphere/);
    await fs.writeFile(path.join(root,'.local/runtime.json'),JSON.stringify({apiUrl:'http://example.com'}));
    await assert.rejects(localApiAddress(root,{}),/loopback/);
  } finally {await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
});
