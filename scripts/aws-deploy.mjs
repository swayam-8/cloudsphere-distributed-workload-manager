import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

process.chdir(path.resolve(import.meta.dirname,'..'));
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const profile=option('--profile','cloudsphere'),region=option('--region','eu-north-1'),account=option('--account','278746617061'),stack=option('--stack','cloudsphere-batch-support');
const aws=(args,json=true)=>{
  const out=execFileSync('aws',[...args,'--profile',profile,'--region',region,'--output','json','--no-cli-pager'],{encoding:'utf8',maxBuffer:4*1024*1024});return json?(out.trim()?JSON.parse(out):{}):out;
};
const identity=aws(['sts','get-caller-identity']);if(identity.Account!==account)throw new Error('AWS account mismatch; no changes performed');
const queue=aws(['batch','describe-job-queues','--job-queues',option('--queue','CloudSphereJobQueue')]).jobQueues?.[0];
if(!queue||queue.state!=='ENABLED'||queue.status!=='VALID')throw new Error('Existing Batch queue must be enabled and valid');
const compute=aws(['batch','describe-compute-environments','--compute-environments',...queue.computeEnvironmentOrder.map(c=>c.computeEnvironment)]).computeEnvironments;
if(!compute?.length||compute.some(c=>c.type!=='MANAGED'||!['EC2','SPOT'].includes(c.computeResources?.type)||c.computeResources.minvCpus!==0||c.computeResources.maxvCpus>2||c.state!=='ENABLED'||c.status!=='VALID'))throw new Error('For this low-cost EC2 demo, require valid managed EC2/Spot environments with minimum 0 and maximum <=2 vCPUs. Inspect and edit intentionally; this script will not change your compute or networking.');
console.log(JSON.stringify({account,region,queue:queue.jobQueueArn,compute:compute.map(c=>({name:c.computeEnvironmentName,type:c.computeResources.type,min:c.computeResources.minvCpus,max:c.computeResources.maxvCpus})),creates:['private S3 bucket','private ECR repository','on-demand DynamoDB audit table','3-day log group','scoped IAM roles/policy','approved Batch job definition'],does_not_create:['instances','NAT gateway','load balancer','VPC'],note:'Storage/logs can charge while idle; EC2 starts when jobs are submitted. Batch max vCPUs is not a dollar spending cap.'},null,2));
if(!process.argv.includes('--apply')){console.log('Read-only plan complete. Review the cost/resource plan, then add --apply to deploy.');process.exit(0);}
await fs.mkdir('.local',{recursive:true});
aws(['cloudformation','deploy','--template-file','deploy/batch-foundation.yaml','--stack-name',stack,'--capabilities','CAPABILITY_IAM','--parameter-overrides',`QueueArn=${queue.jobQueueArn}`,'--tags','Project=CloudSphere','--no-fail-on-empty-changeset'],false);
const outputs=Object.fromEntries(aws(['cloudformation','describe-stacks','--stack-name',stack]).Stacks[0].Outputs.map(o=>[o.OutputKey,o.OutputValue]));
console.log('Building the job image; existing inputs, outputs and compute are preserved.');
if(!process.env.npm_execpath)throw new Error('Run deployment with npm run aws:deploy');
execFileSync(process.execPath,['scripts/build-batch-image.mjs'],{stdio:'inherit'});
const registry=outputs.RepositoryUri.split('/')[0],password=aws(['ecr','get-login-password'],false).trim();
const login=spawnSync('docker',['login','--username','AWS','--password-stdin',registry],{input:password,encoding:'utf8'});
if(login.status!==0)throw new Error('ECR Docker authentication failed');
if(execFileSync('docker',['image','inspect','cloudsphere-batch:dev','--format','{{.Architecture}}'],{encoding:'utf8'}).trim()!=='amd64')throw new Error('The existing compute is x86-64; publish an amd64 image, not an ARM image.');
const imageId=execFileSync('docker',['image','inspect','cloudsphere-batch:dev','--format','{{.Id}}'],{encoding:'utf8'}).trim();
const tag='build-'+createHash('sha256').update(imageId).digest('hex').slice(0,20);
const existing=aws(['ecr','describe-images','--repository-name',outputs.RepositoryName]);
if(!existing.imageDetails?.some(i=>i.imageTags?.includes(tag))){
  execFileSync('docker',['tag','cloudsphere-batch:dev',`${outputs.RepositoryUri}:${tag}`],{stdio:'inherit'});
  execFileSync('docker',['push',`${outputs.RepositoryUri}:${tag}`],{stdio:'inherit'});
}
const digest=aws(['ecr','describe-images','--repository-name',outputs.RepositoryName,'--image-ids',`imageTag=${tag}`]).imageDetails[0].imageDigest;
const image=`${outputs.RepositoryUri}@${digest}`;
const definition={jobDefinitionName:'cloudsphere-approved',type:'container',platformCapabilities:['EC2'],retryStrategy:{attempts:1},timeout:{attemptDurationSeconds:180},tags:{Project:'CloudSphere'},containerProperties:{image,resourceRequirements:[{type:'VCPU',value:'1'},{type:'MEMORY',value:'512'}],jobRoleArn:outputs.JobRoleArn,executionRoleArn:outputs.ExecutionRoleArn,user:'65534:65534',readonlyRootFilesystem:true,linuxParameters:{initProcessEnabled:true,tmpfs:[{containerPath:'/tmp',size:96,mountOptions:['rw','nosuid','nodev','mode=1777']}]},logConfiguration:{logDriver:'awslogs',options:{'awslogs-group':outputs.LogGroup,'awslogs-region':region,'awslogs-stream-prefix':'cloudsphere'}}}};
await fs.writeFile('.local/batch-definition.json',JSON.stringify(definition,null,2));
const registered=aws(['batch','register-job-definition','--cli-input-json','file://.local/batch-definition.json']);
await fs.writeFile('.local/deployment.json',JSON.stringify({protocol:'cloudsphere-batch-v1',image,definition:registered.jobDefinitionArn}));
aws(['s3api','put-object','--bucket',outputs.Bucket,'--key','cloudsphere/deployment.json','--body','.local/deployment.json','--server-side-encryption','AES256']);
const settings={AWS_PROFILE:option('--runtime-profile',profile),CLOUDSPHERE_MODE:'AWS',CLOUDSPHERE_AWS_ACCOUNT:account,CLOUDSPHERE_AWS_REGION:region,CLOUDSPHERE_S3_BUCKET:outputs.Bucket,CLOUDSPHERE_BATCH_QUEUE:queue.jobQueueArn,CLOUDSPHERE_BATCH_DEFINITION:registered.jobDefinitionArn,CLOUDSPHERE_AUDIT_TABLE:outputs.AuditTable,CLOUDSPHERE_BATCH_LOG_GROUP:outputs.LogGroup};
await fs.writeFile('.local/aws.env',Object.entries(settings).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
await fs.writeFile('.local/aws-resources.json',JSON.stringify({account,region,stack,...outputs,image,definition:registered.jobDefinitionArn},null,2));
console.log(`Support resources and image prepared. No job submitted. Attach backend policy ${outputs.BackendPolicyArn} to the backend identity using an IAM administrator, then run npm run dev:aws. Resource manifest: .local/aws-resources.json`);
