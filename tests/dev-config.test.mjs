import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localMongoConfig } from '../scripts/dev-config.mjs';

test('default local configuration preserves existing database, artifacts and worker identities', () => {
  const cfg = localMongoConfig({});
  assert.equal(cfg.port,27017);
  assert.equal(cfg.container,'cloudsphere-mongo');
  assert.equal(cfg.volume,'cloudsphere-mongo-data');
  assert.equal(cfg.workerState,'.local/node-workers');
  assert.equal(cfg.dataDir,'.local/data');
});

test('alternate published port uses a direct replica-set connection and separate local state', () => {
  const cfg = localMongoConfig({ CLOUDSPHERE_MONGO_PORT:'27028' });
  const uri = new URL(cfg.uri);
  assert.equal(uri.port,'27028');
  assert.equal(uri.searchParams.get('replicaSet'),'rs0');
  assert.equal(uri.searchParams.get('directConnection'),'true');
  assert.equal(cfg.container,'cloudsphere-mongo-27028');
  assert.equal(cfg.volume,'cloudsphere-mongo-data-27028');
  assert.equal(cfg.workerState,'.local/node-workers-27028');
  assert.equal(cfg.dataDir,'.local/data-27028');
});

for (const value of ['0','1023','65536','27028.5','abc']) {
  test(`reject invalid published MongoDB port ${value}`, () => {
    assert.throws(() => localMongoConfig({ CLOUDSPHERE_MONGO_PORT:value }),/CLOUDSPHERE_MONGO_PORT/);
  });
}
