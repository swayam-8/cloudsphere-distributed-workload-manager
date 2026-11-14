import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..');process.chdir(root);
if(!process.env.npm_execpath)throw new Error('Run this builder with npm run build:batch');
execFileSync(process.execPath,['scripts/build-job-image.mjs'],{stdio:'inherit'});
const context=path.join(root,'.local/batch-build');await fs.mkdir(context,{recursive:true});
for(const file of ['package.json','package-lock.json','backend/schemas.mjs','jobs/batch-entry.mjs','jobs/batch-protocol.mjs']){
  await fs.mkdir(path.dirname(path.join(context,file)),{recursive:true});await fs.copyFile(path.join(root,file),path.join(context,file));
}
await fs.copyFile('jobs/Batch.Dockerfile',path.join(context,'Dockerfile'));
// Install the frozen, portable JavaScript runtime dependencies outside the image.
// The Docker build itself has no network and never receives credentials or .env.
execFileSync(process.execPath,[process.env.npm_execpath,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--prefix',context,'--cache',path.join(root,'.local/npm-cache')],{stdio:'inherit'});
execFileSync('docker',['build','--network=none','-t','cloudsphere-batch:dev',context],{stdio:'inherit'});
execFileSync('docker',['run','--rm','--entrypoint','node','cloudsphere-batch:dev','--version'],{stdio:'inherit'});
execFileSync('docker',['run','--rm','--entrypoint','python','cloudsphere-batch:dev','-c','from PIL import Image; print("Python/Pillow runtime verified")'],{stdio:'inherit'});
