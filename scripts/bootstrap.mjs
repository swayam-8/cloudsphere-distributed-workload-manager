import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export async function dependencyFingerprint(root) {
  const hash = createHash('sha256');
  for (const file of ['package.json','package-lock.json','frontend/package.json','frontend/package-lock.json']) hash.update(await fs.readFile(path.join(root,file)));
  hash.update(`${process.platform}/${process.arch}/node${process.versions.node.split('.')[0]}`);
  return hash.digest('hex');
}

export async function installDependencies(root, { npmCli = process.env.npm_execpath, run = runNpm } = {}) {
  const fingerprint = await dependencyFingerprint(root), state = path.join(root,'.local/install-state.json');
  let installed;
  try { installed = JSON.parse(await fs.readFile(state,'utf8')).fingerprint; } catch {}
  const required = ['node_modules/express/package.json','node_modules/mongodb/package.json','frontend/node_modules/vite/package.json'];
  const present = (await Promise.all(required.map(file => fs.access(path.join(root,file)).then(()=>true,()=>false)))).every(Boolean);
  if (installed === fingerprint && present) return false;
  if (!npmCli) throw new Error('Start with npm run dev:all so the launcher can locate npm');
  console.log('[setup] Installing locked backend and frontend dependencies (first run or lockfile/platform change).');
  await fs.mkdir(path.dirname(state),{ recursive:true });
  const cache = path.join(root,'.local/npm-cache');
  await run(npmCli,['ci','--no-audit','--no-fund','--cache',cache],root);
  await run(npmCli,['ci','--prefix','frontend','--no-audit','--no-fund','--cache',cache],root);
  await fs.writeFile(state,JSON.stringify({ fingerprint }),{ mode:0o600 });
  return true;
}

function runNpm(npmCli,args,cwd) {
  return new Promise((resolve,reject) => {
    // Calling npm's JS entry with Node works on Windows without spawning npm.cmd.
    const child = spawn(process.execPath,[npmCli,...args],{ cwd,stdio:'inherit',windowsHide:true });
    child.once('error',reject);
    child.once('exit',(code,signal) => code === 0 ? resolve() : reject(new Error(`npm ci failed (${signal || code}); the application was not started`)));
  });
}
