export function localWebConfig(env = process.env) {
  const port = Number(env.CLOUDSPHERE_WEB_PORT || 5173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('CLOUDSPHERE_WEB_PORT must be an integer between 1024 and 65535');
  }
  return { port };
}

export function localApiConfig(env = process.env) {
  const port = Number(env.CLOUDSPHERE_API_PORT || env.PORT || 8000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('CLOUDSPHERE_API_PORT must be an integer between 1024 and 65535');
  }
  return { port, origin: `http://127.0.0.1:${port}`, suffix: port === 8000 ? '' : `-api${port}` };
}

export function localMongoConfig(env = process.env) {
  const port = Number(env.CLOUDSPHERE_MONGO_PORT || 27017);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('CLOUDSPHERE_MONGO_PORT must be an integer between 1024 and 65535');
  }
  const suffix = port === 27017 ? '' : `-${port}`;
  return {
    port,
    container: `cloudsphere-mongo${suffix}`,
    volume: `cloudsphere-mongo-data${suffix}`,
    workerState: `.local/node-workers${suffix}`,
    dataDir: `.local/data${suffix}`,
    // A single local member advertises container port 27017 internally. Direct
    // connection keeps the driver on the selected published host port instead
    // of discovering a different project listening on host port 27017.
    uri: `mongodb://127.0.0.1:${port}/cloudsphere?replicaSet=rs0&directConnection=true`,
    directUri: `mongodb://127.0.0.1:${port}/?directConnection=true`,
  };
}
