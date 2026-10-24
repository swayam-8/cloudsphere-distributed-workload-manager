import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';

const exec = promisify(execFile);
export async function execute(task, { input = null, extension = '.csv', signal, onProgress, workRoot = '.local/jobs' } = {}) {
  if (!['.csv','.zip','.png','.jpg','.jpeg'].includes(extension)) throw new Error('Unsupported input extension');
  await fs.mkdir(workRoot,{ recursive:true });
  const root = await fs.mkdtemp(path.join(path.resolve(workRoot),'job-'));
  const container = `cloudsphere-${path.basename(root).toLowerCase()}`;
  let logs = '', stopped = null;
  try {
    await fs.chmod(root,0o755);
    for (const name of ['config','input','output']) { await fs.mkdir(path.join(root,name)); await fs.chmod(path.join(root,name),name === 'output' ? 0o777 : 0o755); }
    const config = path.join(root,'config/job.json');
    await fs.writeFile(config,JSON.stringify({ kind:task.kind,parameters:task.parameters })); await fs.chmod(config,0o644);
    if (input) { const source = path.join(root,`input/input${extension}`); await fs.writeFile(source,input); await fs.chmod(source,0o644); }
    const command = ['run','--rm','--name',container,'--network','none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges',
      '--pids-limit','64','--cpus',String(task.cpu),'--memory',`${task.memory_mb}m`,'--memory-swap',`${task.memory_mb}m`,
      '--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--user','65534:65534',
      '-v',`${root}/config:/config:ro`,'-v',`${root}/input:/input:ro`,'-v',`${root}/output:/output:rw`,'cloudsphere-job:dev','--input',`/input/input${extension}`];
    const child = spawn('docker',command,{ stdio:['ignore','pipe','pipe'] });
    const collect = chunk => { if (logs.length < 16000) logs += chunk.toString().slice(0,16000-logs.length); };
    child.stdout.on('data',collect); child.stderr.on('data',collect);
    async function stop(reason) {
      if (stopped) return;
      stopped = reason;
      try { await exec('docker',['rm','-f',container],{ timeout:15000 }); } catch {}
      child.kill('SIGKILL');
    }
    const timeout = setTimeout(() => stop('Job exceeded its execution timeout'),task.timeout_seconds * 1000);
    const abort = () => stop('Cancelled or lease lost');
    signal?.addEventListener('abort',abort,{ once:true });
    if (signal?.aborted) abort();
    const progress = setInterval(() => Promise.resolve(onProgress?.(logs)).catch(() => {}),2000);
    let code;
    try { code = await new Promise((resolve,reject) => { child.on('error',reject); child.on('close',resolve); }); }
    finally { clearTimeout(timeout); clearInterval(progress); signal?.removeEventListener('abort',abort); }
    if (stopped || code !== 0) throw new Error(`${stopped || `Job exited with code ${code}`}\n${logs}`);
    const result = JSON.parse(await fs.readFile(path.join(root,'output/result.json'),'utf8'));
    const files = await fs.readdir(path.join(root,'output'));
    let total = 0;
    for (const name of files) {
      const info = await fs.lstat(path.join(root,'output',name));
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Unexpected output entry');
      total += info.size;
    }
    if (total > 10*1024*1024) throw new Error('Output exceeds artifact limit');
    const stream = new PassThrough(), chunks = [], archive = archiver('zip',{ zlib:{ level:6 } });
    const done = new Promise((resolve,reject) => { stream.on('data',chunk => chunks.push(chunk)); stream.on('end',resolve); archive.on('error',reject); stream.on('error',reject); });
    archive.pipe(stream);
    for (const name of files) archive.file(path.join(root,'output',name),{ name });
    await archive.finalize(); await done;
    return { result,logs,archive:Buffer.concat(chunks) };
  } finally { await fs.rm(root,{ recursive:true,force:true }); }
}
