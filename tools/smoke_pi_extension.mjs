// Explicit Pi executable, synthetic config, no models/auth, no discovery or network.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const [piArg]=process.argv.slice(2);if(!piArg)throw new Error('Pass an explicit Pi executable');
const root=resolve('.'),folder=await mkdtemp(join(root,'research/local/browser-profiles/pi-load-'));
const socketFolder=await mkdtemp('/tmp/tai-host-');await chmod(socketFolder,0o700);
const endpoint=join(socketFolder,'s'),config=join(folder,'connection.json'),marker=join(folder,'result.json');
const binding={profileId:'synthetic-profile',spaceId:'synthetic-space',taskId:'synthetic-task'};
let calls=0,child,output='',diagnostics='';
const server=createServer(socket=>{let text='';socket.setEncoding('utf8');socket.on('data',chunk=>{text+=chunk;if(!text.endsWith('\n'))return;const {request}=JSON.parse(text);assert.deepEqual(request.scope,binding);assert.equal(request.command,'page.list');calls++;socket.end(JSON.stringify({id:request.id,ok:true,value:[]})+'\n');});});
await new Promise(resolveListen=>server.listen(endpoint,resolveListen));
await writeFile(config,JSON.stringify({protocol:'tai.local.v1',endpoint,token:'b'.repeat(64),binding,commands:['page.list'],libraries:[]}),{mode:0o600});
const wrapper=join(folder,'probe.mjs');
await writeFile(wrapper,`import install from ${JSON.stringify(pathToFileURL(join(root,'modules/agent-tools/pi-extension.mjs')).href)};\nimport {writeFile} from 'node:fs/promises';\nexport default async function(pi){const tools=[];await install({...pi,registerTool(tool){tools.push(tool);pi.registerTool(tool);}});pi.registerCommand('tai-probe',{description:'Synthetic no-model tool probe',handler:async()=>{const result=await tools[0].execute('synthetic-call',{},new AbortController().signal);await writeFile(${JSON.stringify(marker)},JSON.stringify({names:tools.map(t=>t.name),result}));}});}`);
const messages=[],pending=new Map();let next=0;
async function rpc(type,values={}){const id='probe-'+(++next);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Pi RPC timeout: '+type));},15000);pending.set(id,message=>{clearTimeout(timer);resolve(message);});child.stdin.write(JSON.stringify({id,type,...values})+'\n');});}
try{
 child=spawn(resolve(piArg),['--offline','--mode','rpc','--no-session','--no-builtin-tools','--no-extensions','--no-skills','--no-prompt-templates','--no-themes','--no-context-files','-e',wrapper],{cwd:folder,env:{PATH:process.env.PATH,LANG:'en_US.UTF-8',PI_CODING_AGENT_DIR:join(folder,'agent'),PI_OFFLINE:'1',TAI_CONNECTION_FILE:config},stdio:['pipe','pipe','pipe']});
 child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;let at;while((at=output.indexOf('\n'))>=0){const line=output.slice(0,at);output=output.slice(at+1);try{const message=JSON.parse(line);messages.push(message);if(pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}}catch{}}});child.stderr.setEncoding('utf8');child.stderr.on('data',chunk=>diagnostics+=chunk);
 assert.equal((await rpc('get_state')).success,true,'Pi starts with synthetic config only');
 const commands=await rpc('get_commands');assert.equal(commands.success,true);assert(commands.data.commands.some(command=>command.name==='tai-probe'),'real Pi loader registers the explicit extension');
 await rpc('prompt',{message:'/tai-probe'});
 let result;for(let i=0;i<100;i++){try{result=JSON.parse(await readFile(marker,'utf8'));break;}catch{await delay(100);}}
 assert.deepEqual(result?.names,['tai_page_list']);assert.equal(JSON.parse(result.result.content[0].text).ok,true);assert.equal(calls,1);assert(!diagnostics.includes('b'.repeat(64)));
 const receipt={passed:true,checks:['real Pi extension loading','native tool registered through existing MCP descriptors','fixed-scope tool invocation without model inference'],configScope:'synthetic-only; no personal auth/config/session read'};
 await writeFile(join(root,'research/local/ux-review/pi-load.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{child?.stdin.end();child?.kill('SIGTERM');await new Promise(resolveClose=>server.close(resolveClose));await rm(socketFolder,{recursive:true,force:true});}
