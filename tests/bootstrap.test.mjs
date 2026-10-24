import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { installDependencies } from '../scripts/bootstrap.mjs';

async function fixture() {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'cloudsphere-bootstrap-'));
  await fs.mkdir(path.join(root,'frontend'));
  for(const file of ['package.json','package-lock.json','frontend/package.json','frontend/package-lock.json'])await fs.writeFile(path.join(root,file),'{}');
  const calls=[];
  const run=async(cli,args,cwd)=>{
    assert.equal(cwd,root);assert.equal(args[0],'ci');assert.ok(!args.includes('--force'));
    calls.push(args);
    const files=args.includes('--prefix')?['frontend/node_modules/vite/package.json']:['node_modules/express/package.json','node_modules/mongodb/package.json'];
    for(const file of files){await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),'{}');}
  };
  return {root,calls,run};
}

test('first run installs both lockfiles, repeat runs reuse them, changed locks refresh them',async()=>{
  const f=await fixture();
  try {
    assert.equal(await installDependencies(f.root,{npmCli:'test-npm-cli',run:f.run}),true);assert.equal(f.calls.length,2);
    assert.equal(await installDependencies(f.root,{npmCli:'test-npm-cli',run:f.run}),false);assert.equal(f.calls.length,2);
    await fs.writeFile(path.join(f.root,'frontend/package-lock.json'),'{"lockfileVersion":3}');
    assert.equal(await installDependencies(f.root,{npmCli:'test-npm-cli',run:f.run}),true);assert.equal(f.calls.length,4);
    assert.equal(await fs.readFile(path.join(f.root,'frontend/package-lock.json'),'utf8'),'{"lockfileVersion":3}');
  } finally {await fs.rm(f.root,{recursive:true,force:true});}
});

test('failed install never records success and missing dependencies trigger reinstall',async()=>{
  const f=await fixture();
  try {
    await assert.rejects(installDependencies(f.root,{npmCli:'test-npm-cli',run:async()=>{throw new Error('install failed');}}),/install failed/);
    await assert.rejects(fs.access(path.join(f.root,'.local/install-state.json')));
    await installDependencies(f.root,{npmCli:'test-npm-cli',run:f.run});
    await fs.rm(path.join(f.root,'frontend/node_modules'),{recursive:true,force:true});
    assert.equal(await installDependencies(f.root,{npmCli:'test-npm-cli',run:f.run}),true);
  } finally {await fs.rm(f.root,{recursive:true,force:true});}
});
