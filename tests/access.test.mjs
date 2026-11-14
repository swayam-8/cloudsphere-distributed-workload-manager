import {test} from 'node:test';
import assert from 'node:assert/strict';
import {demoAccessAllowed,requireSafeDemoBind} from '../backend/access.mjs';

test('token-free demo requires explicit opt-in, loopback peer and loopback Host',()=>{
  const request=(peer,hostname)=>({socket:{remoteAddress:peer},hostname});
  assert.equal(demoAccessAllowed({demoAccess:true},request('127.0.0.1','localhost')),true);
  assert.equal(demoAccessAllowed({demoAccess:false},request('127.0.0.1','localhost')),false);
  assert.equal(demoAccessAllowed({demoAccess:true},request('203.0.113.1','localhost')),false);
  assert.equal(demoAccessAllowed({demoAccess:true},request('127.0.0.1','attacker.example')),false);
  assert.equal(demoAccessAllowed({demoAccess:true},request('::ffff:127.0.0.1','127.0.0.1')),true);
});
test('demo server refuses a public bind',()=>{
  assert.throws(()=>requireSafeDemoBind({demoAccess:true},'0.0.0.0'),/localhost/);
  assert.doesNotThrow(()=>requireSafeDemoBind({demoAccess:true},'127.0.0.1'));
  assert.doesNotThrow(()=>requireSafeDemoBind({demoAccess:false},'0.0.0.0'));
});
