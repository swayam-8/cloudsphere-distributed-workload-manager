import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localApiConfig, localMongoConfig, localWebConfig } from '../scripts/dev-config.mjs';

test('web port is selectable without silently switching to another project', () => {
  assert.deepEqual(localWebConfig({}),{ port:5173 });
  assert.deepEqual(localWebConfig({ CLOUDSPHERE_WEB_PORT:'5199' }),{ port:5199 });
  assert.throws(() => localWebConfig({ CLOUDSPHERE_WEB_PORT:'invalid' }),/CLOUDSPHERE_WEB_PORT/);
});

test('API port is shared consistently by API, workers and frontend proxy', () => {
  assert.deepEqual(localApiConfig({}),{ port:8000,origin:'http://127.0.0.1:8000',suffix:'' });
  assert.deepEqual(localApiConfig({ CLOUDSPHERE_API_PORT:'8019',PORT:'8000' }),{ port:8019,origin:'http://127.0.0.1:8019',suffix:'-api8019' });
  assert.equal(localApiConfig({ PORT:'8020' }).port,8020);
  assert.throws(() => localApiConfig({ CLOUDSPHERE_API_PORT:'invalid' }),/CLOUDSPHERE_API_PORT/);
});

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
