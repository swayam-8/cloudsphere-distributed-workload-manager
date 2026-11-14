import fs from 'node:fs/promises';
import path from 'node:path';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { BatchClient, DescribeJobQueuesCommand, DescribeComputeEnvironmentsCommand, DescribeJobDefinitionsCommand } from '@aws-sdk/client-batch';
import { ECRClient, DescribeRepositoriesCommand } from '@aws-sdk/client-ecr';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';

process.chdir(path.resolve(import.meta.dirname,'..'));
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
process.env.AWS_PROFILE=option('--profile','cloudsphere');
const region=option('--region','eu-north-1'),expectedAccount=option('--account','278746617061');
const identity=await new STSClient({region}).send(new GetCallerIdentityCommand({}));
if(identity.Account!==expectedAccount)throw new Error('Wrong AWS account; no further inspection performed. Pass --account only after checking the intended account.');
const batch=new BatchClient({region}),report={account:identity.Account,identity:identity.Arn,region,read_only:true,inspected_at:new Date().toISOString()};
const checks={
  queues:async()=>(await batch.send(new DescribeJobQueuesCommand({jobQueues:[option('--queue','CloudSphereJobQueue')]}))).jobQueues,
  compute:async()=>(await batch.send(new DescribeComputeEnvironmentsCommand({computeEnvironments:['CloudSphereComputeEnv']}))).computeEnvironments?.map(c=>({name:c.computeEnvironmentName,arn:c.computeEnvironmentArn,state:c.state,status:c.status,statusReason:c.statusReason,type:c.type,resources:c.computeResources})),
  definitions:async()=>(await batch.send(new DescribeJobDefinitionsCommand({status:'ACTIVE',maxResults:100}))).jobDefinitions?.filter(d=>/cloudsphere/i.test(d.jobDefinitionName)).map(d=>({name:d.jobDefinitionName,arn:d.jobDefinitionArn,platforms:d.platformCapabilities,container:{image:d.containerProperties?.image,jobRoleArn:d.containerProperties?.jobRoleArn,executionRoleArn:d.containerProperties?.executionRoleArn,resourceRequirements:d.containerProperties?.resourceRequirements,vcpus:d.containerProperties?.vcpus,memory:d.containerProperties?.memory,environmentNames:d.containerProperties?.environment?.map(e=>e.name)}})),
  repositories:async()=>(await new ECRClient({region}).send(new DescribeRepositoriesCommand({maxResults:100}))).repositories?.filter(r=>/cloudsphere/i.test(r.repositoryName)).map(r=>({name:r.repositoryName,uri:r.repositoryUri})),
  buckets:async()=>(await new S3Client({region}).send(new ListBucketsCommand({}))).Buckets?.filter(b=>/cloudsphere/i.test(b.Name)).map(b=>b.Name),
  tables:async()=>(await new DynamoDBClient({region}).send(new ListTablesCommand({Limit:100}))).TableNames?.filter(n=>/cloudsphere/i.test(n)),
};
for(const [name,run] of Object.entries(checks)){try{report[name]=await run();}catch(e){report[name]={error:e.name||'InspectionFailed'};}}
await fs.mkdir('.local',{recursive:true});await fs.writeFile('.local/aws-inventory.json',JSON.stringify(report,null,2),{mode:0o600});
console.log('Read-only inspection saved to .local/aws-inventory.json. No resources were created, stopped or deleted.');
console.log(JSON.stringify({account:report.account,region,checks:Object.fromEntries(Object.entries(checks).map(([key])=>[key,report[key]?.error||'completed']))},null,2));
