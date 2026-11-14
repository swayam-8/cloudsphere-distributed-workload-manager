import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('Batch image executes actual CSV, prime and image kernels with bounded S3-protocol fixtures',async()=>{
  const root=path.resolve(import.meta.dirname,'../..');
  const {stdout}=await promisify(execFile)('docker',['run','--rm','--network','none','--read-only','--cpus','1','--memory','256m','--tmpfs','/tmp:rw,noexec,nosuid,size=96m','--entrypoint','node','-v',`${root}/tests:/cloudsphere/tests:ro`,'-v',`${root}/examples/sample.png:/fixtures/sample.png:ro`,'cloudsphere-batch:dev','/cloudsphere/tests/fixtures/batch-smoke.mjs'],{timeout:90000,maxBuffer:1024*1024});
  for(const name of ['CSV','CPU','IMAGES'])assert.match(stdout,new RegExp(`VERIFIED_BATCH_KERNEL_${name}`));
});
