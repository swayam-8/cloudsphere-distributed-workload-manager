import { config } from './config.mjs';
import { Store } from './store.mjs';
import { createApp } from './app.mjs';
import { reap } from './scheduler.mjs';
import { localApiConfig } from '../scripts/dev-config.mjs';

const cfg = config(), store = await Store.connect(cfg.mongoUrl), app = createApp(store,cfg);
const api = localApiConfig();
const server = app.listen(api.port,process.env.HOST || '127.0.0.1',() => console.log(`CloudSphere Express API listening on port ${api.port}; mode=${cfg.mode}`));
let busy = false;
const timer = setInterval(async () => {
  if (busy) return; busy = true;
  try { await store.transaction(db => reap(db,cfg)); } catch(e) { console.error('Lease maintenance failed:',e.name); } finally { busy = false; }
},1000);
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,async () => { clearInterval(timer); server.close(); await store.close(); process.exit(0); });
