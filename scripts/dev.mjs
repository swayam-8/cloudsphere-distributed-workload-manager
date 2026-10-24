import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { parse } from 'dotenv';
import { MongoClient } from 'mongodb';
import { localApiConfig, localMongoConfig, localWebConfig } from './dev-config.mjs';
import { localRequest } from './local-http.mjs';
import { availablePort, Runtime, waitForService } from './runtime.mjs';
import { jobFingerprint } from './job-image.mjs';

const ROOT=path.resolve(import.meta.dirname,'..');

export async function startDevelopment() {
  process.chdir(ROOT);
  await fs.mkdir('.local',{recursive:true});
  try {
    await fs.writeFile('.local/dev.env',`CLOUDSPHERE_OPERATOR_TOKEN=${randomBytes(32).toString('base64url')}\nCLOUDSPHERE_ENROLLMENT_TOKEN=${randomBytes(32).toString('base64url')}\n`,{flag:'wx',mode:0o600});
  } catch(error) { if(error.code!=='EEXIST')throw error; }
  const credentials=parse(await fs.readFile('.local/dev.env'));
  const mongo=localMongoConfig();
  const api=localApiConfig({CLOUDSPHERE_API_PORT:String(await availablePort(localApiConfig().port))});
  const noFrontend=process.argv.includes('--no-frontend');
  const web={port:noFrontend ? localWebConfig().port : await availablePort(localWebConfig().port)};
  const noProxy=[process.env.NO_PROXY || process.env.no_proxy || '','127.0.0.1','localhost','::1'].filter(Boolean).join(',');
  const env={...process.env,...credentials,PORT:String(api.port),HOST:'127.0.0.1',CLOUDSPHERE_API_PORT:String(api.port),CLOUDSPHERE_WEB_PORT:String(web.port),
    CLOUDSPHERE_MODE:'LOCAL',CLOUDSPHERE_MONGODB_URI:mongo.uri,CLOUDSPHERE_DATA_DIR:mongo.dataDir,CLOUDSPHERE_API_URL:api.origin,NO_PROXY:noProxy,no_proxy:noProxy};
  const docker=(args,capture=false)=>execFileSync('docker',args,{env,encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:['ignore','ignore','inherit']});
  let os;
  try { os=docker(['info','--format','{{.OSType}}'],true).trim(); }
  catch { throw new Error('Docker Engine is unreachable. Open Docker Desktop, wait for Engine running, and check docker context show.'); }
  if(os!=='linux')throw new Error('Switch Docker Desktop to Linux containers, then retry.');
  let freshImage=false;
  try {const image=JSON.parse(docker(['image','inspect','cloudsphere-job:dev'],true))[0];freshImage=image.Config.Labels?.['com.cloudsphere.job-source']===await jobFingerprint(ROOT);} catch {}
  if(!freshImage){console.log('[setup] Building the approved job image for the current source.');execFileSync(process.execPath,['scripts/build-job-image.mjs'],{env,stdio:'inherit'});}
  let inspected;
  try { inspected=JSON.parse(docker(['inspect',mongo.container],true))[0]; }
  catch(error) {
    const message=String(error.stderr || '');
    if(!/no such (object|container)/i.test(message))throw new Error('Cannot inspect the project MongoDB container; check Docker connectivity.');
  }
  if(inspected && inspected.Config.Labels?.['com.cloudsphere.local']!=='true')throw new Error(`${mongo.container} is not owned by CloudSphere; it has been left untouched.`);
  console.log(`[mongo] Using ${mongo.container}, host port ${mongo.port}; existing data is preserved.`);
  try {
    if(inspected)docker(['start',mongo.container]);
    else docker(['run','-d','--name',mongo.container,'--label','com.cloudsphere.local=true','-p',`127.0.0.1:${mongo.port}:27017`,'-v',`${mongo.volume}:/data/db`,'mongo:7','--replSet','rs0','--bind_ip_all']);
  } catch { throw new Error(`MongoDB failed to start (Docker's error is above). If port ${mongo.port} is occupied, select another CLOUDSPHERE_MONGO_PORT; no other service/volume was removed.`); }
  const direct=new MongoClient(mongo.directUri,{serverSelectionTimeoutMS:1000});
  try {
    for(let i=0;;i++) { try { await direct.connect(); break; } catch(error) { if(i===29)throw new Error(`MongoDB did not become reachable on port ${mongo.port}: ${error.name}`); await sleep(500); } }
    try { await direct.db('admin').command({replSetInitiate:{_id:'rs0',members:[{_id:0,host:'127.0.0.1:27017'}]}}); }
    catch(error) { if(error.codeName!=='AlreadyInitialized')throw error; }
    for(let i=0;;i++) { if((await direct.db('admin').command({hello:1})).isWritablePrimary)break; if(i===59)throw new Error('MongoDB primary election timed out'); await sleep(500); }
  } finally { await direct.close(); }

  const runtime=new Runtime(ROOT,env);
  let stopping=false;
  const onSignal=()=>{ stopping=true; };
  process.once('SIGINT',onSignal); process.once('SIGTERM',onSignal);
  try {
    const backend=runtime.start('api','backend/server.mjs',[],{ipc:true});
    await waitForService(backend,`${api.origin}/health`);
    const names=['worker-a','worker-b'].map(name=>`${name}${api.suffix}`);
    for(const name of names)runtime.start(name,'worker/agent.mjs',['--name',name,'--state-dir',`${mongo.workerState}${api.suffix}`],{ipc:true});
    let fleetReady=false;
    for(let i=0;i<60;i++) {
      const failed=runtime.children.find(h=>h.error || h.child.exitCode!==null || h.child.signalCode!==null);
      if(failed)throw new Error(`${failed.name} exited during startup.\n${failed.tail()}`);
      const response=await localRequest(`${api.origin}/api/workers`,{headers:{Authorization:`Bearer ${credentials.CLOUDSPHERE_OPERATOR_TOKEN}`}});
      if(!response.ok)throw new Error(`Backend worker check returned HTTP ${response.status}; credentials remain private in .local/dev.env`);
      const workers=await response.json();
      if(names.every(name=>workers.some(w=>w.name===name && w.state==='HEALTHY' && Date.now()-Date.parse(w.last_heartbeat)<10000))) { fleetReady=true; break; }
      await sleep(500);
    }
    if(!fleetReady)throw new Error('Both worker heartbeats were not received; see the worker output above.');
    if(!noFrontend) {
      const frontend=runtime.start('frontend','node_modules/vite/bin/vite.js',['--host','127.0.0.1','--port',String(web.port),'--strictPort'],{cwd:path.join(ROOT,'frontend')});
      await waitForService(frontend,`http://127.0.0.1:${web.port}/api/health`,{pid:backend.child.pid});
    }
    await fs.writeFile('.local/runtime.json',JSON.stringify({supervisorPid:process.pid,apiPid:backend.child.pid,apiUrl:api.origin,webUrl:noFrontend?null:`http://127.0.0.1:${web.port}`,mongoPort:mongo.port},null,2));
    console.log(`\nCloudSphere is ready. API port ${api.port}; MongoDB port ${mongo.port}; two healthy workers.`);
    if(!noFrontend)console.log(`Console address: http://127.0.0.1:${web.port}`);
    console.log(`Operator token file: ${path.join(ROOT,'.local/dev.env')} (open privately in VS Code). Press Ctrl+C to stop this stack.\n`);
    while(!stopping) {
      const failed=runtime.children.find(h=>h.error || h.child.exitCode!==null || h.child.signalCode!==null);
      if(failed)throw new Error(`${failed.name} stopped.\n${failed.tail()}`);
      await sleep(250);
    }
  } finally {
    process.removeListener('SIGINT',onSignal); process.removeListener('SIGTERM',onSignal);
    console.log('[shutdown] Stopping only this launcher\'s API, frontend and workers. MongoDB data is retained.');
    await runtime.close();
  }
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { await startDevelopment(); } catch(error) { console.error(`\nCloudSphere startup failed: ${error.message}`); process.exitCode=1; }
}
