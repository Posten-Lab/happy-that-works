// Supplement the real workflow run with participant switching and return navigation.
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
 const envDir = process.env.WORKFLOW_E2E_ENV; assert(envDir?.includes('/environments/data/envs/'));
 const env = JSON.parse(fs.readFileSync(path.join(envDir,'environment.json'))), auth = JSON.parse(fs.readFileSync(path.join(envDir,'cli/home/access.key')));
 const state = JSON.parse(fs.readFileSync('/tmp/talos-planner-e2e-state.json'));
 const browser = await chromium.launch({channel:'chrome',headless:true});
 const c = await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark'});
 await c.addInitScript(({auth,origin})=>{if(location.origin===origin){localStorage.setItem('auth_credentials',JSON.stringify(auth));localStorage.setItem('mmkv.default\\local-settings',JSON.stringify({themePreference:'dark'}));}},{auth,origin:`http://localhost:${env.expoPort}`});
 const p=await c.newPage();p.setDefaultTimeout(30000);const b=name=>p.getByRole('button',{name,exact:true});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 try {
  await p.goto(state.url); await b('Inspect Plan team').click(); await b('Inspect Ada history').click();
  await b('Read Ada consolidate round 2').click(); await b('Switch evidence to Chen').click(); await b('Switch evidence to Ben').click();
  await p.getByRole('heading',{name:'Ben · Planning consensus',exact:true}).waitFor(); await b('Open full transcript').click(); await p.waitForURL(/\/session\//);
  await b('Switch transcript to Ada').click(); await p.getByText('All Ada contributions',{exact:true}).waitFor(); await b('All Ada contributions').click();
  await p.waitForURL(/teamAgent=/); await p.getByRole('heading',{name:'Ada · history',exact:true}).waitFor(); await b('Close evidence').waitFor({state:'hidden'});
  const reads=await p.getByRole('button',{name:/^Read .* (propose|consolidate|plan_vote) round/}).evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')));
  assert(reads.length>=3 && reads.every(label=>label.startsWith('Read Ada ')));
  await b('Show Everyone contributions').click(); await p.getByRole('tab',{name:'Decisions',exact:true}).click();
  const verified=p.getByText('Verified by original assessor',{exact:true}); await verified.first().scrollIntoViewIfNeeded(); await p.waitForTimeout(600);
  const out=path.resolve('docs/evidence/workflow-planner-visibility'); await p.screenshot({path:path.join(out,'08-verified-objection.png')});
  await p.setViewportSize({width:1440,height:1000}); await p.getByRole('tab',{name:'Discussion',exact:true}).click(); await b('Show Ben contributions').click(); await b('Read Ben plan_vote round 1').click(); await p.waitForTimeout(600); await p.screenshot({path:path.join(out,'09-desktop-history.png')});
  assert.deepEqual(errors,[]); const receipt={runId:state.runId,rapidEvidenceSwitching:true,transcriptParticipantSwitching:true,returnToParticipantHistory:true,participantFilter:true,pageErrors:errors}; fs.writeFileSync(path.join(out,'navigation.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
 } finally {await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
