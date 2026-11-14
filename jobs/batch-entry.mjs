import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { taskSchema } from '../backend/schemas.mjs';
import { batchKeys, readBoundedBody } from './batch-protocol.mjs';

export async function runBatch(env=process.env,{s3=new S3Client({region:env.AWS_REGION||env.AWS_DEFAULT_REGION}),run=promisify(execFile)}={}) {
  const taskId=z.uuid().parse(env.CLOUDSPHERE_TASK_ID),attemptId=z.uuid().parse(env.CLOUDSPHERE_ATTEMPT_ID);
  if(!env.AWS_BATCH_JOB_ID)throw new Error('This entrypoint requires AWS Batch job identity');
  const keys=batchKeys(taskId,attemptId),bucket=env.CLOUDSPHERE_BATCH_BUCKET;
  if(!bucket||env.CLOUDSPHERE_BATCH_CONFIG_KEY!==keys.config)throw new Error('Invalid Batch input location');
  async function get(key,limit){const response=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key}));return readBoundedBody(response.Body,limit);}
  async function put(key,bytes,type){await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:type,ServerSideEncryption:'AES256'}));}
  const config=JSON.parse(await get(keys.config,64000));
  if(config.protocol!=='cloudsphere-batch-v1'||config.task?.id!==taskId||config.attempt_id!==attemptId||JSON.stringify(config.keys)!==JSON.stringify(keys))throw new Error('Configuration identity mismatch');
  const task=taskSchema.parse({name:'Approved Batch workload',kind:config.task.kind,parameters:config.task.parameters,timeout_seconds:config.task.timeout_seconds,input_id:config.input?taskId:null,execution_provider:'aws_batch'});
  const extension=config.input?.extension||'.csv';
  if(config.input&&(!['.csv','.png','.jpg','.jpeg','.zip'].includes(extension)||!/^cloudsphere\/[0-9a-f-]{36}$/.test(config.input.key)))throw new Error('Unsupported input artifact');
  if(task.kind==='csv'&&extension!=='.csv')throw new Error('CSV task requires a CSV artifact');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cloudsphere-batch-'));
  try{
    const output=path.join(root,'output');await fs.mkdir(output);
    const input=path.join(root,`input${extension}`),settings=path.join(root,'job.json');
    if(config.input){
      const bytes=await get(config.input.key,10*1024*1024);
      if(config.input.sha256&&createHash('sha256').update(bytes).digest('hex')!==config.input.sha256)throw new Error('Input checksum mismatch');
      await fs.writeFile(input,bytes,{mode:0o600});
    }
    await fs.writeFile(settings,JSON.stringify({kind:task.kind,parameters:task.parameters,task_id:taskId}),{mode:0o600});
    console.log(JSON.stringify({event:'kernel_started',task_id:taskId,attempt_id:attemptId,job_id:env.AWS_BATCH_JOB_ID,kind:task.kind}));
    await run('python',['-u','/app/run.py','--config',settings,'--input',input,'--output',output],{timeout:task.timeout_seconds*1000,killSignal:'SIGKILL',maxBuffer:128*1024});
    const metadata=await fs.readFile(path.join(output,'result.json'));if(metadata.length>60000)throw new Error('Result metadata exceeds limit');
    const result={...JSON.parse(metadata),task_id:taskId,attempt_id:attemptId,batch_job_id:env.AWS_BATCH_JOB_ID};
    const resultBytes=Buffer.from(JSON.stringify(result));if(resultBytes.length>64000)throw new Error('Result metadata exceeds limit');
    await fs.writeFile(path.join(output,'result.json'),resultBytes);
    const names=await fs.readdir(output);let total=0;
    for(const name of names){const info=await fs.lstat(path.join(output,name));if(!info.isFile()||info.isSymbolicLink())throw new Error('Unexpected result entry');total+=info.size;}
    if(total>32*1024*1024)throw new Error('Uncompressed output exceeds 32 MB');
    const archive=archiver('zip',{zlib:{level:6}}),stream=new PassThrough();archive.pipe(stream);
    const bytesPromise=readBoundedBody(stream,10*1024*1024);
    archive.on('error',e=>stream.destroy(e));
    for(const name of names)archive.file(path.join(output,name),{name});
    // Observe both promises immediately so a stream failure never becomes unhandled.
    const [,zip]=await Promise.all([archive.finalize(),bytesPromise]);
    await put(keys.output,zip,'application/zip');
    // Publish the completion manifest last, after the archive exists.
    await put(keys.result,resultBytes,'application/json');
    console.log(JSON.stringify({event:'artifacts_uploaded',task_id:taskId,attempt_id:attemptId,bytes:zip.length}));
    return result;
  }finally{await fs.rm(root,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===import.meta.filename){
  runBatch().catch(e=>{console.error(JSON.stringify({event:'job_failed',type:e.name,message:String(e.message).slice(0,1800)}));process.exitCode=1;});
}
