import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { parse } from 'dotenv';
import { MongoClient } from 'mongodb';

process.chdir(path.resolve(import.meta.dirname,'..'));
await fs.mkdir('.local',{ recursive:true });
try { await fs.writeFile('.local/dev.env',`CLOUDSPHERE_OPERATOR_TOKEN=${randomBytes(32).toString('base64url')}\nCLOUDSPHERE_ENROLLMENT_TOKEN=${randomBytes(32).toString('base64url')}\n`,{ flag:'wx',mode:0o600 }); } catch(e) { if (e.code !== 'EEXIST') throw e; }
const env = { ...process.env,...parse(await fs.readFile('.local/dev.env')),CLOUDSPHERE_MODE:'LOCAL',CLOUDSPHERE_MONGODB_URI:'mongodb://127.0.0.1:27017/cloudsphere?replicaSet=rs0',CLOUDSPHERE_DATA_DIR:'.local/data',CLOUDSPHERE_API_URL:'http://127.0.0.1:8000' };
const dockerEnv = { ...env,DOCKER_CONFIG:process.env.DOCKER_CONFIG || path.resolve('.local/docker') };
try { execFileSync('docker',['image','inspect','cloudsphere-job:dev'],{ stdio:'ignore' }); } catch { execFileSync(process.execPath,['scripts/build-job-image.mjs'],{ env:dockerEnv,stdio:'inherit' }); }
// This explicitly local MongoDB is loopback-only and retains data in a named volume.
let existing = false;
try {
  const inspected = JSON.parse(execFileSync('docker',['inspect','cloudsphere-mongo'],{ encoding:'utf8' }))[0];
  if (inspected.Config.Labels?.['com.cloudsphere.local'] !== 'true') throw new Error('Existing container name is not owned by CloudSphere');
  existing = true;
} catch(e) { if (e.message.includes('not owned')) throw e; }
if (existing) execFileSync('docker',['start','cloudsphere-mongo'],{ stdio:'ignore' });
else execFileSync('docker',['run','-d','--name','cloudsphere-mongo','--label','com.cloudsphere.local=true','-p','127.0.0.1:27017:27017','-v','cloudsphere-mongo-data:/data/db','mongo:7','--replSet','rs0','--bind_ip_all'],{ env:dockerEnv,stdio:'ignore' });
const direct = new MongoClient('mongodb://127.0.0.1:27017/?directConnection=true',{ serverSelectionTimeoutMS:1000 });
for (let i=0;i<60;i++) { try { await direct.connect(); break; } catch(e) { if (i===59) throw e; await sleep(500); } }
try { await direct.db('admin').command({ replSetInitiate:{ _id:'rs0',members:[{ _id:0,host:'127.0.0.1:27017' }] } }); } catch(e) { if (e.codeName !== 'AlreadyInitialized') throw e; }
for (let i=0;i<60;i++) { if ((await direct.db('admin').command({ hello:1 })).isWritablePrimary) break; if (i===59) throw new Error('Mongo primary election timed out'); await sleep(500); }
await direct.close();
const processes = [], handles = [];
function start(name, command, args, cwd = process.cwd()) {
  const file = fs.open(path.resolve(`.local/${name}.log`),'a');
  return file.then(handle => { handles.push(handle); const child = spawn(command,args,{ env,cwd,stdio:['ignore',handle.fd,handle.fd] }); processes.push(child); return child; });
}
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  const exits = processes.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit',resolve)));
  for (const child of [...processes].reverse()) child.kill('SIGTERM');
  await Promise.race([Promise.all(exits),sleep(20000)]);
  for (const child of processes) if (child.exitCode === null) child.kill('SIGKILL');
  for (const h of handles) await h.close(); process.exit(0);
}
for (const sig of ['SIGINT','SIGTERM']) process.on(sig,stop);
await start('api',process.execPath,['backend/server.mjs']);
for (let i=0;i<60;i++) { try { const r=await fetch('http://127.0.0.1:8000/health'); if (r.ok) break; } catch {} if(i===59) throw new Error('API failed readiness; inspect .local/api.log'); await sleep(300); }
for (const name of ['worker-a','worker-b']) await start(name,process.execPath,['worker/agent.mjs','--name',name,'--state-dir','.local/node-workers']);
if (!process.argv.includes('--no-frontend')) await start('frontend',process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173','--strictPort'],path.resolve('frontend'));
console.log('MERN services started: API port 8000, console port 5173, two Docker workers. Private credential: .local/dev.env');
setInterval(() => { if (!stopping && processes.some(p => p.exitCode !== null)) { console.error('A service exited; inspect .local/*.log'); stop(); } },1000);
