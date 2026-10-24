import fs from 'node:fs/promises';
import path from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';

export function storage(cfg, suppliedClient) {
  const client = cfg.mode === 'AWS' ? suppliedClient || new S3Client({ region: cfg.region }) : null;
  return {
    async put(id, data) {
      if (client) return client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: `cloudsphere/${id}`, Body: data, ServerSideEncryption: 'AES256' }));
      await fs.mkdir(path.join(cfg.dataDir, 'artifacts'), { recursive: true });
      await fs.writeFile(path.join(cfg.dataDir, 'artifacts', id), data, { mode: 0o600 });
    },
    async get(id) {
      if (client) return Buffer.from(await (await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: `cloudsphere/${id}` }))).Body.transformToByteArray());
      return fs.readFile(path.join(cfg.dataDir, 'artifacts', id));
    },
  };
}
export async function instances(cfg) {
  if (cfg.mode !== 'AWS') return [];
  const client = new EC2Client({ region: cfg.region }), result = [];
  let NextToken;
  do {
    const page = await client.send(new DescribeInstancesCommand({ Filters: [{ Name: 'tag:Project', Values: [cfg.projectTag] }, { Name: 'tag:Role', Values: ['worker'] }], NextToken }));
    for (const reservation of page.Reservations || []) for (const i of reservation.Instances || []) result.push({ instance_id: i.InstanceId, instance_type: i.InstanceType, state: i.State.Name, launch_time: i.LaunchTime.toISOString(), region: cfg.region });
    NextToken = page.NextToken;
  } while (NextToken);
  return result;
}
export async function cloudMetrics(cfg, id) {
  const response = await new CloudWatchClient({ region: cfg.region }).send(new GetMetricStatisticsCommand({ Namespace: 'AWS/EC2', MetricName: 'CPUUtilization',
    Dimensions: [{ Name: 'InstanceId', Value: id }], StartTime: new Date(Date.now() - 3600000), EndTime: new Date(), Period: 300, Statistics: ['Average'] }));
  return { source: 'AWS/EC2 CloudWatch CPUUtilization / 5 minutes', datapoints: (response.Datapoints || []).map(p => ({ timestamp: p.Timestamp.toISOString(), cpu_percent: p.Average })).sort((a,b) => a.timestamp.localeCompare(b.timestamp)) };
}
