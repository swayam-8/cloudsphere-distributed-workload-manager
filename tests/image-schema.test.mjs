import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskSchema } from '../backend/schemas.mjs';
const task={name:'Image check',kind:'images',input_id:'00000000-0000-4000-8000-000000000001'};
test('compression accepts bounded quality and legacy images still default to thumbnails',()=>{
  assert.equal(taskSchema.parse({...task,parameters:{operation:'compress',quality:80}}).parameters.operation,'compress');
  assert.equal(taskSchema.parse({...task,parameters:{width:64}}).parameters.operation,'thumbnail');
  for(const parameters of [{operation:'compress',quality:100},{operation:'compress',quality:0},{operation:'unknown'}]) {
    assert.equal(taskSchema.safeParse({...task,parameters}).success,false);
  }
});
