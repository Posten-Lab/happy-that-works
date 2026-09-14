// Run against an authenticated local environment; does not touch production.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const workflowName = `Product delivery ${Date.now()}`;
 const root=process.cwd(), envPath=process.env.TALOS_E2E_ENV;
 assert(envPath && envPath.includes('/environments/data/envs/'), 'Set TALOS_E2E_ENV to an isolated environment.json');
 const env=JSON.parse(fs.readFileSync(envPath));
 assert.equal(new URL(env.authenticatedWebUrl).hostname, 'localhost');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 const ctx=await browser.newContext({viewport:{width:390,height:844},colorScheme:'dark'}),p=await ctx.newPage();
 p.setDefaultTimeout(20000);
 const out=path.join(root,'docs/evidence/workflow-wizard');fs.mkdirSync(out,{recursive:true});
 const b=name=>p.getByRole('button',{name,exact:true}),input=name=>p.getByRole('textbox',{name,exact:true});
 const shot=async name=>{await p.screenshot({path:path.join(out,name+'.png')});console.log('Screenshot',name)};
 const errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error' && /Unexpected text node|Text strings must|Maximum update depth/.test(m.text()))errors.push(m.text());});
 try{
 await p.goto(env.authenticatedWebUrl);await p.waitForTimeout(1500);await p.goto(`http://localhost:${env.expoPort}/workflows`);
 await b('Create workflow').waitFor({timeout:60000});console.log('Library loaded');assert.equal(await input('Workflow name').count(),0);
 await shot('library-entry');await b('Create workflow').click();await input('Workflow name').waitFor();
 assert.equal(await input('Completion criteria').count(),0);await b('Continue').click();await p.getByText('Give your workflow a name before continuing.',{exact:true}).waitFor();
 await input('Workflow name').fill(workflowName);await input('Description (optional)').fill('Plan together, build with focus, and review the result.');await shot('wizard-basics');await b('Continue').click();
 await b('Add planner to step 1').waitFor();console.log('Team entered');assert.equal(await input('Workflow name').count(),0);
 await b('Continue').click();console.log('Team validation',await p.getByRole('alert').innerText());await p.getByText(/Add a planner to stage 1/).waitFor();
 for(const [role,step,name,provider] of [['planner',1,'Ada','Claude'],['executor',2,'Atlas','Codex'],['reviewer',3,'Vega','Muse Code']]){
   console.log('Configuring',role);await b(`Add ${role} to step ${step}`).click();await b('Create new agent').click();await input('Agent name').fill(name);
   await p.getByRole('button',{name:/^Provider:/}).click();await p.getByRole('radio',{name:provider,exact:true}).click();
   const model=p.getByRole('button',{name:/^Model:/});await model.click({timeout:40000});
   const radios=p.getByRole('radio');await radios.first().waitFor();await radios.first().click();
   if(provider==='Claude'){await p.getByRole('button',{name:/^Effort:/}).click();await p.getByRole('radio',{name:'low',exact:true}).click();await shot('agent-provider-model-effort');}
   await b('Use this agent').click();await b(`Edit ${name} in step ${step}`).waitFor();
 }
 await shot('wizard-team');
 await b('Add step').click();await b('Add execution step').click();await b('Move step 4 up').click();await b('Remove step 3').click();
 await b('Continue').click();await input('Completion criteria').fill('Create DONE.md containing exactly workflow wizard verified. All reviewers approve the file and the completion check passes.');
 await input('Check 1 name').fill('Verify result');await input('Check 1 command').fill('node -e "if(require(\'fs\').readFileSync(\'DONE.md\',\'utf8\').trim()!==\'workflow wizard verified\')process.exit(1)"');
 await shot('wizard-finish');await b('Review workflow').click();await b('Save workflow').waitFor();await shot('wizard-review');
 await b('Edit workflow basics').click();assert.equal(await input('Workflow name').inputValue(),workflowName);await b('Continue').click();await b('Continue').click();await b('Review workflow').click();await b('Save workflow').click();
 await b(`Run ${workflowName}`).waitFor({timeout:15000});assert.equal(await input('Workflow task').count(),0);await shot('library-saved');
 await b(`Run ${workflowName}`).click();await input('Workflow task').waitFor();await shot('run-ready');
 assert.equal(await b('Start workflow').count(),1);await p.getByRole('button',{name:/^Project:/}).click();await input('Project directory').waitFor();await input('Project directory').fill(env.projectPath);await shot('shared-project-picker');await b('Use this project').click();
 await input('Workflow task').fill('Create DONE.md with the single line workflow wizard verified.');await shot('run-configured');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({wizardCreatedThroughUI:true,separateLibrary:true,providers:['Claude','Codex','Muse Code'],stageAddReorderRemove:true,reviewEditRetainsDraft:true,savedLibraryNoAutoLaunch:true,sharedProjectPicker:true,pageErrors:errors}));
 }catch(e){await shot('browser-failure');console.log((await p.locator('body').innerText()).slice(-5000));throw e}finally{await browser.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
