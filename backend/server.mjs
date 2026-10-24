import { config } from './config.mjs';
import { Store } from './store.mjs';
import { createApp } from './app.mjs';
import { reap } from './scheduler.mjs';
import { localApiConfig } from '../scripts/dev-config.mjs';

const cfg = config(), store = await Store.connect(cfg.mongoUrl), app = createApp(store,cfg);
const api = localApiConfig();
const server = app.listen(api.port,process.env.HOST || '127.0.0.1',() => {
  console.log(`CloudSphere Express API listening on port ${api.port}; mode=${cfg.mode}`);
  if(process.send)process.send({type:'cloudsphere-listening',pid:process.pid,port:api.port});
});
let busy = false;
const timer = setInterval(async () => {
  if (busy) return; busy = true;
  try { await store.transaction(db => reap(db,cfg)); } catch(e) { console.error('Lease maintenance failed:',e.name); } finally { busy = false; }
},1000);
let stopping=false;
async function stop() { if(stopping)return;stopping=true;clearInterval(timer);server.close();await store.close();process.exit(0); }
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,stop);
process.on('message',message=>{if(message?.type==='cloudsphere-stop')stop();});
server.on('error',async error=>{console.error(`API listener failed: ${error.code || error.name} on port ${api.port}`);clearInterval(timer);await store.close();process.exit(1);});
