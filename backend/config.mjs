import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

export function config(overrides = {}) {
  const env = process.env;
  const result = {
    mode: env.CLOUDSPHERE_MODE || 'LOCAL', mongoUrl: env.CLOUDSPHERE_MONGODB_URI || 'mongodb://127.0.0.1:27017/cloudsphere?replicaSet=rs0',
    operatorToken: env.CLOUDSPHERE_OPERATOR_TOKEN || '', enrollmentToken: env.CLOUDSPHERE_ENROLLMENT_TOKEN || '',
    dataDir: path.resolve(env.CLOUDSPHERE_DATA_DIR || '.local/data'), leaseSeconds: Number(env.CLOUDSPHERE_LEASE_SECONDS || 30),
    heartbeatTimeout: Number(env.CLOUDSPHERE_HEARTBEAT_TIMEOUT || 20), retryBackoff: Number(env.CLOUDSPHERE_RETRY_BACKOFF_SECONDS || 2),
    maxUploadBytes: 10 * 1024 * 1024, region: env.CLOUDSPHERE_AWS_REGION || 'ap-south-1',
    bucket: env.CLOUDSPHERE_S3_BUCKET || '', projectTag: env.CLOUDSPHERE_PROJECT_TAG || 'CloudSphere', ...overrides,
  };
  z.object({ mode: z.enum(['LOCAL','AWS']), operatorToken: z.string().min(24), enrollmentToken: z.string().min(24),
    leaseSeconds: z.number().int().min(2), heartbeatTimeout: z.number().int().min(2), retryBackoff: z.number().min(0) }).parse(result);
  if (result.operatorToken === result.enrollmentToken) throw new Error('Operator and enrollment credentials must differ');
  if (result.mode === 'AWS' && !result.bucket) throw new Error('AWS mode requires an S3 bucket');
  return result;
}
