import test from 'node:test';
import assert from 'node:assert/strict';
import { inventory, cli, options } from '../scripts/aws-inventory.mjs';

const account = '123456789012';
test('inventory stops at identity when the account is wrong', async () => {
  const calls = [];
  await assert.rejects(inventory({ expectedAccount: account, run: async args => {
    calls.push(args); return { Account: '999999999999' };
  } }), /does not match/);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['sts', 'get-caller-identity']);
});

test('inventory distinguishes missing checks and discovers EC2 through the actual Batch cluster', async () => {
  const calls = [];
  const report = await inventory({ expectedAccount: account, run: async args => {
    calls.push(args);
    switch (args.slice(0, 2).join('/')) {
      case 'sts/get-caller-identity': return { Account: account, Arn: 'arn:test' };
      case 'batch/describe-job-queues': return [{ computeEnvironments: [{ computeEnvironment: 'arn:ce' }] }];
      case 'batch/describe-compute-environments': return [{ name: 'existing', cluster: 'arn:cluster', resources: { type: 'EC2', subnets: ['subnet-a'], securityGroups: ['sg-a'] } }];
      case 'ec2/describe-subnets': return [{ vpc: 'vpc-a' }];
      case 'ecs/list-container-instances': return ['arn:node'];
      case 'ecs/describe-container-instances': return [{ ec2InstanceId: 'i-real' }];
      case 'ecr/describe-repositories': throw { stderr: 'An error occurred (AccessDeniedException) secret-do-not-copy' };
      default: return [];
    }
  } });
  const ec2 = calls.find(c => c[1] === 'describe-instances');
  assert.ok(ec2.includes('i-real'));
  assert.ok(calls.find(c => c[1] === 'list-container-instances').includes('arn:cluster'));
  assert.equal(report.checks.ecr_candidates.status, 'unavailable');
  assert.equal(report.checks.ecr_candidates.error_code, 'AccessDeniedException');
  assert.ok(!JSON.stringify(report).includes('secret-do-not-copy'));
  assert.ok(calls.every(c => c.includes('eu-north-1') && c.includes('cloudsphere')));
  assert.equal(report.read_only, true);
});

test('invalid account or region cannot query AWS; CLI runner blocks mutation commands', async () => {
  const run = () => assert.fail('must not query AWS');
  await assert.rejects(inventory({ run }), /12-digit/);
  await assert.rejects(inventory({ expectedAccount: account, region: 'ap-south-1', run }), /Stockholm/);
  await assert.rejects(cli(['batch', 'submit-job']), /read-only/);
  await assert.rejects(cli(['ec2', 'run-instances']), /read-only/);
  assert.throws(() => options(['--profile']), /Usage/);
  assert.throws(() => options(['--region', 'ap-south-1']), /Usage/);
});
