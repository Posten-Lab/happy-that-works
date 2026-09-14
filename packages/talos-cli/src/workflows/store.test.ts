import { describe,it,expect } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowStore } from './store';
import { WorkflowRunSchema, workflowProjection } from '@ahmadposten/talos-wire';
import { randomUUID } from 'node:crypto';
import { definition } from './testFixture';
describe('encrypted workflow persistence',()=>{
 it('round trips privately, scopes machines, and fails closed on corruption',()=>{
  const home=mkdtempSync(join(tmpdir(),'talos-workflow-store-'));
  try{
   const key=new Uint8Array(32).fill(7),store=new WorkflowStore(home,'account/server/machine',key);
   const run=WorkflowRunSchema.parse({id:randomUUID(),revision:1,definition:definition(),machineId:'machine',task:'PRIVATE_GOAL_MARKER',sourceDirectory:'/src',directory:'/worktree',branch:'branch',baseCommit:'base',status:'paused',stage:'propose',planningRound:1,reviewRound:1,planVersion:1,plan:'',artifactVersion:'',reason:'',tasks:[],checks:[],events:[],notes:[],approvedPlanVersion:null,createdAt:1,updatedAt:1});
   store.save(run);expect(store.load()).toEqual([run]);
   const custom=structuredClone(run); custom.id=randomUUID();
   custom.definition.steps=[{id:randomUUID(),name:'Plan',kind:'plan',agents:custom.definition.planners,criteria:'',checks:[]},{id:randomUUID(),name:'Build',kind:'execute',agents:[custom.definition.executor],criteria:'',checks:[]},{id:randomUUID(),name:'Review',kind:'review',agents:custom.definition.reviewers,criteria:'',checks:[]}];
   Object.assign(custom.definition,workflowProjection(custom.definition.steps));
   Object.assign(custom,{stepIndex:0,stepAttempt:1,completedSteps:[],stepRounds:{}}); store.save(custom);
   expect(store.load()).toEqual([run,custom]);
   expect(readdirSync(store.directory).filter(f=>f.endsWith('.bin'))).toEqual([`${run.id}.bin`]);
   expect(readFileSync(join(store.directory,'v2',`${custom.id}.bin`)).includes(Buffer.from('PRIVATE_GOAL_MARKER'))).toBe(false);
   const path=join(store.directory,`${run.id}.bin`);const bytes=readFileSync(path);
   expect(bytes.includes(Buffer.from('PRIVATE_GOAL_MARKER'))).toBe(false);expect(statSync(path).mode&0o777).toBe(0o600);
   expect(new WorkflowStore(home,'different-machine',key).load()).toEqual([]);
   bytes[bytes.length-1]^=1;writeFileSync(path,bytes);expect(()=>store.load()).toThrow();
  }finally{rmSync(home,{recursive:true,force:true});}
 });
});
