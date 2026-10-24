import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { localRequest } from './local-http.mjs';

export async function availablePort(preferred) {
  const probe = port => new Promise((resolve,reject) => {
    const server = net.createServer();
    server.once('error',reject);
    server.listen({ host:'127.0.0.1',port,exclusive:true }, () => {
      const selected = server.address().port;
      server.close(error => error ? reject(error) : resolve(selected));
    });
  });
  try { return await probe(preferred); }
  catch(error) {
    if (!['EADDRINUSE','EACCES','EPERM'].includes(error.code)) throw error;
    const selected = await probe(0);
    console.log(`[ports] ${preferred} is unavailable; using ${selected}. Other services were left running.`);
    return selected;
  }
}

export class Runtime {
  constructor(root,env) { this.root=root; this.env=env; this.children=[]; this.closing=false; }
  start(name,script,args=[],{ cwd=this.root,ipc=false }={}) {
    let tail='';
    const handle = { name,tail:()=>tail,error:null };
    const log = fs.open(path.join(this.root,`.local/${name}.log`),'a');
    const child = spawn(process.execPath,[script,...args],{ cwd,env:this.env,windowsHide:true,stdio:ipc ? ['ignore','pipe','pipe','ipc'] : ['ignore','pipe','pipe'] });
    handle.child=child;
    handle.exited=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
    child.once('error',error=>{ handle.error=error; });
    const redact = text => {
      for (const key of ['CLOUDSPHERE_OPERATOR_TOKEN','CLOUDSPHERE_ENROLLMENT_TOKEN','CLOUDSPHERE_MONGODB_URI']) if (this.env[key]) text=text.replaceAll(this.env[key],'[redacted]');
      return text;
    };
    const write = chunk => {
      const text=redact(chunk.toString()); tail=(tail+text).slice(-6000);
      process.stdout.write(`[${name}] ${text}`);
      log.then(file=>file.appendFile(text)).catch(()=>{});
    };
    child.stdout.on('data',write); child.stderr.on('data',write);
    handle.log=log; this.children.push(handle); return handle;
  }
  async close() {
    if (this.closing) return; this.closing=true;
    for (const h of [...this.children].reverse()) if (h.child.exitCode===null && h.child.signalCode===null) {
      if(h.child.connected)h.child.send({type:'cloudsphere-stop'},error=>{if(error)h.child.kill('SIGTERM');});
      else h.child.kill('SIGTERM');
    }
    const timer=new AbortController();
    try { await Promise.race([Promise.all(this.children.map(h=>h.exited)),sleep(12000,undefined,{signal:timer.signal})]); }
    finally { timer.abort(); }
    for (const h of this.children) {
      if (h.child.exitCode===null && h.child.signalCode===null) h.child.kill('SIGKILL');
      await h.exited;
      try { await (await h.log).close(); } catch {}
    }
  }
}

export async function waitForService(handle,address,{ timeoutMs=30000,pid=handle.child.pid }={}) {
  const end=Date.now()+timeoutMs;
  let last='No HTTP response';
  while(Date.now()<end) {
    if(handle.error || handle.child.exitCode!==null || handle.child.signalCode!==null) {
      throw new Error(`${handle.name} exited during startup. ${handle.error?.message || ''}\n${handle.tail()}`);
    }
    try {
      const response=await localRequest(address,{timeoutMs:1500,maxBytes:32768});
      if(!response.ok) last=`HTTP ${response.status}`;
      else {
        const health=await response.json();
        if(health.service==='cloudsphere' && health.pid===pid && health.status==='ok') return;
        last='The response belongs to a different service or process';
      }
    } catch(error) { last=error.code || error.message; }
    await sleep(200);
  }
  throw new Error(`${handle.name} did not respond correctly at ${address}. Last check: ${last}\n${handle.tail()}`);
}
