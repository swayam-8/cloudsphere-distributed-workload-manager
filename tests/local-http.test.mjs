import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { localRequest, isLoopbackHttp } from '../scripts/local-http.mjs';

test('loopback requests work with unusable workstation proxy settings',async()=>{
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({path:req.url}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const old={HTTP_PROXY:process.env.HTTP_PROXY,HTTPS_PROXY:process.env.HTTPS_PROXY,NO_PROXY:process.env.NO_PROXY,NODE_USE_ENV_PROXY:process.env.NODE_USE_ENV_PROXY};
  Object.assign(process.env,{HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1',NO_PROXY:'',NODE_USE_ENV_PROXY:'1'});
  try {
    const response=await localRequest(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(response.status,200);assert.deepEqual(await response.json(),{path:'/health'});
    assert.equal(isLoopbackHttp('https://example.com'),false);
    assert.throws(()=>localRequest('http://example.com'),/loopback/);
  } finally {
    for(const [name,value] of Object.entries(old))if(value===undefined)delete process.env[name];else process.env[name]=value;
    await new Promise(resolve=>server.close(resolve));
  }
});

test('local POSTs preserve binary inputs and authenticated headers',async()=>{
  const server=http.createServer((req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{res.statusCode=req.headers.authorization==='Bearer test-local-token'?201:401;res.end(Buffer.concat(chunks));});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const input=Buffer.from([0,1,2,255]);
    const response=await localRequest(`http://127.0.0.1:${server.address().port}`,{method:'POST',body:input,headers:{Authorization:'Bearer test-local-token'}});
    assert.equal(response.status,201);assert.deepEqual(Buffer.from(await response.arrayBuffer()),input);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('timeouts and oversized replies fail instead of declaring readiness',async()=>{
  const server=http.createServer((req,res)=>{if(req.url==='/large')res.end('too much data');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base=`http://127.0.0.1:${server.address().port}`;
    await assert.rejects(localRequest(base,{timeoutMs:80}),/timed out/);
    await assert.rejects(localRequest(`${base}/large`,{maxBytes:2}),/size limit/);
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
