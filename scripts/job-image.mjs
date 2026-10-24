import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const JOB_SOURCE_FILES=['jobs/Dockerfile','jobs/run.py','jobs/analytics.py','jobs/wheels.lock.json'];
export async function jobFingerprint(root) {
  const hash=createHash('sha256');
  for(const file of JOB_SOURCE_FILES){hash.update(file);hash.update(await fs.readFile(path.join(root,file)));}
  hash.update(process.arch);
  return hash.digest('hex');
}
