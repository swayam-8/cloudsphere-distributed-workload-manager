import path from 'node:path';
import { installDependencies } from './bootstrap.mjs';

const root=path.resolve(import.meta.dirname,'..');
process.chdir(root);
try {
  await installDependencies(root);
  process.env.CLOUDSPHERE_MONGO_PORT ||= '27028';
  process.env.CLOUDSPHERE_API_PORT ||= '8019';
  process.env.CLOUDSPHERE_WEB_PORT ||= '5199';
  const { startDevelopment }=await import('./dev.mjs');
  await startDevelopment();
} catch(error) { console.error(`\nCloudSphere startup failed: ${error.message}`); process.exitCode=1; }
