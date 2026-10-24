import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const lock = JSON.parse(await fs.readFile(path.join(root,'jobs/wheels.lock.json'),'utf8'));
const arch = { x64:'x86_64',arm64:'aarch64' }[process.arch], wheel = lock.wheels[arch];
if (!wheel) throw new Error('Supported image build architectures: x86_64/aarch64');
const context = path.join(root,'.local/job-build'), dir = path.join(context,'wheels');
await fs.mkdir(dir,{ recursive:true });
const target = path.join(dir,path.basename(new URL(wheel.url).pathname));
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
let verified = false;
try { verified = sha(await fs.readFile(target)) === wheel.sha256; } catch {}
if (!verified) {
  execFileSync('curl',['--fail','--location','--silent','--show-error','--max-time','60','--output',target,wheel.url],{ stdio:'inherit' });
  if (sha(await fs.readFile(target)) !== wheel.sha256) throw new Error('Pillow wheel checksum mismatch');
}
await fs.writeFile(path.join(context,'requirements.txt'),`pillow==${lock.pillow} --hash=sha256:${wheel.sha256}\n`);
await fs.copyFile(path.join(root,'jobs/Dockerfile'),path.join(context,'Dockerfile'));
await fs.copyFile(path.join(root,'jobs/run.py'),path.join(context,'run.py'));
execFileSync('docker',['build','--network=none','-t','cloudsphere-job:dev',context],{ stdio:'inherit',env:{ ...process.env,DOCKER_CONFIG:process.env.DOCKER_CONFIG || path.join(root,'.local/docker') } });
