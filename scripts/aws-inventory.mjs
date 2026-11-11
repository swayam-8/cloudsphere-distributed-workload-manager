import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const allowed = new Set([
  'sts/get-caller-identity', 'batch/describe-job-queues', 'batch/describe-compute-environments',
  'batch/describe-job-definitions', 'batch/list-jobs', 'ecs/list-container-instances',
  'ecs/describe-container-instances', 'ec2/describe-instances', 'ec2/describe-subnets',
  'ec2/describe-route-tables', 'ec2/describe-security-groups', 'ecr/describe-repositories',
  'dynamodb/list-tables', 's3api/list-buckets', 'logs/describe-log-groups',
]);

export async function cli(args) {
  if (!allowed.has(args.slice(0, 2).join('/'))) throw new Error('Inventory permits read-only operations only');
  const { stdout } = await exec(process.platform === 'win32' ? 'aws.exe' : 'aws', args, {
    timeout: 45000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off' },
    windowsHide: true,
  });
  return JSON.parse(stdout);
}

// Explicit projections avoid recording container commands, environment values,
// secrets, log content, user data, or full unfiltered AWS error responses.
export async function inventory({ profile = 'cloudsphere', expectedAccount,
  region = 'eu-north-1', queue = 'CloudSphereJobQueue', run = cli } = {}) {
  if (!/^\d{12}$/.test(expectedAccount || '')) throw new Error('--expected-account must be the intended 12-digit AWS account ID');
  if (region !== 'eu-north-1') throw new Error('This deployment inventory is pinned to Stockholm (eu-north-1)');
  const suffix = ['--profile', profile, '--region', region, '--output', 'json', '--no-cli-pager'];
  const invoke = (service, operation, ...args) => run([service, operation, ...args, ...suffix]);
  const identity = await invoke('sts', 'get-caller-identity');
  if (identity.Account !== expectedAccount) throw new Error('Authenticated account does not match --expected-account; no resources inspected');
  const report = { schema_version: 1, captured_at: new Date().toISOString(), region,
    account: identity.Account, principal_arn: identity.Arn, queue_name: queue,
    read_only: true, checks: {}, notes: [
      'Resource inventory is not evidence of successful execution or application integration.',
      'Credit balance, credit applicability, current charges and account plan require a separate Billing review.',
      'EC2 compute can scale to zero: no current instances does not imply a broken environment.',
      'Name-filtered candidate resources are not proof of CloudSphere ownership. Review before reuse.',
    ] };
  async function capture(key, service, operation, ...args) {
    try {
      const data = await invoke(service, operation, ...args);
      report.checks[key] = { status: 'ok', data };
      return data;
    } catch (error) {
      const match = String(error.stderr || '').match(/An error occurred \(([A-Za-z0-9_.-]+)\)/);
      report.checks[key] = { status: 'unavailable', error_code: match?.[1] ||
        (error.code === 'ENOENT' ? 'AwsCliNotFound' : error.killed ? 'Timeout' : 'RequestFailed') };
      return null;
    }
  }
  const queues = await capture('queue', 'batch', 'describe-job-queues', '--job-queues', queue,
    '--query', 'jobQueues[].{name:jobQueueName,arn:jobQueueArn,state:state,status:status,type:jobQueueType,priority:priority,schedulingPolicyArn:schedulingPolicyArn,computeEnvironments:computeEnvironmentOrder}');
  const environments = [...new Set((queues || []).flatMap(q => (q.computeEnvironments || []).map(c => c.computeEnvironment)))];
  for (const arn of environments) {
    const envs = await capture(`compute:${arn}`, 'batch', 'describe-compute-environments', '--compute-environments', arn,
      '--query', 'computeEnvironments[].{name:computeEnvironmentName,arn:computeEnvironmentArn,state:state,status:status,type:type,cluster:ecsClusterArn,serviceRole:serviceRole,resources:computeResources.{type:type,minvCpus:minvCpus,maxvCpus:maxvCpus,desiredvCpus:desiredvCpus,instanceTypes:instanceTypes,instanceRole:instanceRole,subnets:subnets,securityGroups:securityGroupIds,allocationStrategy:allocationStrategy,ec2Configuration:ec2Configuration}}');
    for (const ce of envs || []) {
      const resources = ce.resources || {};
      if (resources.subnets?.length) {
        const subnets = await capture(`subnets:${ce.name}`, 'ec2', 'describe-subnets', '--subnet-ids', ...resources.subnets,
          '--query', 'Subnets[].{id:SubnetId,vpc:VpcId,zone:AvailabilityZone,mapPublicIp:MapPublicIpOnLaunch,availableIps:AvailableIpAddressCount}');
        for (const vpc of [...new Set((subnets || []).map(s => s.vpc))]) {
          await capture(`routes:${vpc}`, 'ec2', 'describe-route-tables', '--filters', `Name=vpc-id,Values=${vpc}`,
            '--query', 'RouteTables[].{id:RouteTableId,associations:Associations[].{subnet:SubnetId,main:Main},routes:Routes[].{destination:DestinationCidrBlock,ipv6Destination:DestinationIpv6CidrBlock,gateway:GatewayId,nat:NatGatewayId,endpoint:VpcEndpointId,state:State}}');
        }
      }
      if (resources.securityGroups?.length) await capture(`security_groups:${ce.name}`, 'ec2', 'describe-security-groups',
        '--group-ids', ...resources.securityGroups, '--query', 'SecurityGroups[].{id:GroupId,vpc:VpcId,ingress:IpPermissions,egress:IpPermissionsEgress}');
      if (ce.cluster) {
        const ids = await capture(`container_instances:${ce.name}`, 'ecs', 'list-container-instances', '--cluster', ce.cluster,
          '--query', 'containerInstanceArns');
        if (ids?.length) {
          const nodes = [];
          for (let start = 0; start < ids.length; start += 100) {
            const page = await capture(`ecs_nodes:${ce.name}:${start}`, 'ecs', 'describe-container-instances',
              '--cluster', ce.cluster, '--container-instances', ...ids.slice(start, start + 100),
              '--query', 'containerInstances[].{arn:containerInstanceArn,ec2InstanceId:ec2InstanceId,status:status,agentConnected:agentConnected,runningTasks:runningTasksCount,architecture:attributes[?name==`ecs.cpu-architecture`].value}');
            nodes.push(...(page || []));
          }
          const ec2Ids = nodes.map(n => n.ec2InstanceId).filter(Boolean);
          if (ec2Ids.length) await capture(`ec2:${ce.name}`, 'ec2', 'describe-instances', '--instance-ids', ...ec2Ids,
            '--query', 'Reservations[].Instances[].{id:InstanceId,type:InstanceType,architecture:Architecture,state:State.Name,launchTime:LaunchTime,subnet:SubnetId,profile:IamInstanceProfile.Arn}');
        }
      }
    }
  }
  await capture('job_definitions', 'batch', 'describe-job-definitions', '--status', 'ACTIVE',
    '--query', 'jobDefinitions[].{name:jobDefinitionName,arn:jobDefinitionArn,revision:revision,type:type,platformCapabilities:platformCapabilities,image:containerProperties.image,jobRole:containerProperties.jobRoleArn,executionRole:containerProperties.executionRoleArn,resources:containerProperties.resourceRequirements,runtime:containerProperties.runtimePlatform,logConfiguration:containerProperties.logConfiguration,retry:retryStrategy,timeout:timeout}');
  for (const status of ['SUBMITTED', 'PENDING', 'RUNNABLE', 'STARTING', 'RUNNING', 'SUCCEEDED', 'FAILED']) {
    await capture(`jobs:${status}`, 'batch', 'list-jobs', '--job-queue', queue, '--job-status', status,
      '--max-items', '25', '--query', 'jobSummaryList[].{id:jobId,name:jobName,status:status,createdAt:createdAt,startedAt:startedAt,stoppedAt:stoppedAt,jobDefinition:jobDefinition}');
  }
  await capture('ecr_candidates', 'ecr', 'describe-repositories', '--query',
    'repositories[?contains(repositoryName, `cloudsphere`) || contains(repositoryName, `CloudSphere`)].{name:repositoryName,arn:repositoryArn,uri:repositoryUri,tagMutability:imageTagMutability,encryption:encryptionConfiguration}');
  await capture('s3_candidates', 's3api', 'list-buckets', '--query',
    'Buckets[?contains(Name, `cloudsphere`)].{name:Name,created:CreationDate}');
  await capture('dynamodb_candidates', 'dynamodb', 'list-tables', '--query',
    'TableNames[?contains(@, `cloudsphere`) || contains(@, `CloudSphere`)]');
  await capture('batch_log_groups', 'logs', 'describe-log-groups', '--log-group-name-prefix', '/aws/batch',
    '--query', 'logGroups[].{name:logGroupName,retentionDays:retentionInDays,storedBytes:storedBytes}');
  return report;
}

export function options(args) {
  const result = {};
  const names = { '--profile': 'profile', '--expected-account': 'expectedAccount', '--output': 'output', '--queue': 'queue' };
  for (let i = 0; i < args.length; i += 2) {
    if (!names[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: node scripts/aws-inventory.mjs --expected-account ACCOUNT_ID [--profile cloudsphere] [--output .local/aws-inventory.json] [--queue CloudSphereJobQueue]');
    result[names[args[i]]] = args[i + 1];
  }
  return result;
}

async function main() {
  const opts = options(process.argv.slice(2));
  const report = await inventory(opts);
  const target = path.resolve(opts.output || '.local/aws-inventory.json');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  const missing = Object.values(report.checks).filter(c => c.status !== 'ok').length;
  console.log(`Read-only Stockholm inventory saved: ${target}`);
  console.log(`${missing} checks unavailable. No AWS resources created, updated, started or deleted.`);
  console.log('Review the report before sharing: it includes account/resource IDs and network rules, but excludes credentials and workload contents.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    // AWS CLI errors may include credential-bearing URLs. Do not echo stderr.
    console.error(error.stderr ? 'AWS identity verification failed. Check your selected profile and login privately; no inventory saved.' : error.message);
    process.exitCode = 1;
  });
}
