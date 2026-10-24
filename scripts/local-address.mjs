import fs from 'node:fs/promises';
import path from 'node:path';
import { localApiConfig } from './dev-config.mjs';
import { isLoopbackHttp, localRequest } from './local-http.mjs';

export async function localApiAddress(root, env=process.env) {
  let address=localApiConfig(env).origin;
  if(!env.CLOUDSPHERE_API_PORT && !env.PORT) {
    try { address=JSON.parse(await fs.readFile(path.join(root,'.local/runtime.json'),'utf8')).apiUrl || address; } catch {}
  }
  if(!isLoopbackHttp(address))throw new Error('Local runtime address must use loopback HTTP');
  const response=await localRequest(`${new URL(address).origin}/health`);
  if(!response.ok || (await response.json()).service!=='cloudsphere')throw new Error('The selected local API is not a ready CloudSphere service; run npm run dev:all');
  return new URL(address).origin;
}
