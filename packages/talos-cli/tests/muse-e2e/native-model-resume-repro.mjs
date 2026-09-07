// Native Muse reproduction; does not import Talos adapters or transport.
import { spawnMspConnection } from '@muse-code/sdk';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
const cwd = mkdtempSync(join(tmpdir(), 'talos-muse-raw-repro-'));
let host, complete;
async function connect() {
 const handshake = spawnMspConnection({command: join(homedir(),'.local/bin/muse'),args:['serve'],cwd,shutdownTimeoutMs:5000});
 handshake.onNotification(({method,params}) => {
  if(method === 'turn/completed') complete?.(params);
  if(method === 'item/completed' && params.item?.kind === 'agentMessage') console.log('Answer:', params.item.text);
 });
 host = await handshake.initialize({clientInfo:{name:'talos_raw_probe',version:'1'}});
}
async function turn(id,prompt) {
 let timer;
 const result = new Promise((resolve,reject) => {complete=resolve;timer=setTimeout(()=>reject(new Error('turn timed out')),45000);});
 try {
  await host.connection.command('turn/start',{sessionId:id,input:[{type:'text',text:prompt}]});
  const terminal=await result;
  console.log('Terminal:',terminal.terminal,terminal.error?.message ?? '');
  if (terminal.terminal !== 'completed') process.exitCode = 1;
 } finally {clearTimeout(timer);}
}
try {
 await connect();
 const started=await host.connection.command('session/start',{workspaceRoot:cwd});
 const id=started.session.sessionId;
 console.log('Start routing:',started.session.providerId,started.session.modelId);
 await host.connection.command('session/setModel',{sessionId:id,model:{modelId:'muse-spark-1.3',providerId:'meta',profileId:null}});
 await turn(id,'Remember copper-otter. Reply only with that code word. Do not use tools.');
 await host.close();await connect();
 const stored=await host.connection.request('session/read',{sessionId:id,excludeItems:true});
 console.log('Stored routing:',stored.session.providerId,stored.session.modelId);
 const resumed=await host.connection.command('session/resume',{sessionId:id,history:'inline'});
 console.log('Resume routing:',resumed.session.providerId,resumed.session.modelId);
 await host.connection.command('session/setModel',{sessionId:id,model:{modelId:'muse-spark-1.3',providerId:'meta',profileId:null}});
 await turn(id,'What was the code word? Reply only with it. Do not use tools.');
} finally {await host?.close();rmSync(cwd,{recursive:true,force:true});}
