#!/usr/bin/env node
// Only explicit synthetic profiles and local fixtures, never user browsing data.
import {startNativeBrowser,until} from './native_smoke_support.mjs';
import {connectNativeHost} from '../src/host/client/native-client.mjs';
import {mkdir,mkdtemp,writeFile,readFile,stat,symlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {createConnection} from 'node:net';
import {createSocket} from 'node:dgram';
const [binaryArg,rootArg]=process.argv.slice(2);
if(!binaryArg||!rootArg)throw new Error('Expected explicit browser binary and root');
const binary=resolve(binaryArg),root=resolve(rootArg),local=join(root,'research/local');
await mkdir(join(local,'browser-profiles'),{recursive:true});
const profile=await mkdtemp(join(local,'browser-profiles/tai-host-'));
await mkdir(join(profile,'Default'));
await writeFile(join(profile,'Default/SidebarWorkspace.json'),JSON.stringify({version:1,active:'user-space',spaces:[{id:'user-space',name:'User'},{id:'agent-space',name:'Agent'}],items:[]}));
const server=createServer((req,res)=>{
  if(req.url==='/redirect'){res.writeHead(302,{location:'/page?new'});res.end();return;}
  res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><title>Synthetic page</title><h1>Background page ✓</h1><input id="field"><input type="password" id="password" value="synthetic-only"><button id="increment" onclick="document.querySelector(\'output\').textContent=Number(document.querySelector(\'output\').textContent)+1">Increment</button><output>0</output><a id="navigate" href="/page?next">Next</a>');
});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const url='http://127.0.0.1:'+server.address().port+'/page';
const rtcSocket=createSocket('udp4');let rtcPackets=0;rtcSocket.on('message',()=>rtcPackets++);await new Promise(r=>rtcSocket.bind(0,'127.0.0.1',r));
const checks=[];let browser,sequence=0,idleSocket,idleTimer,result;
const expect=(name,ok)=>{checks.push({check:name,passed:!!ok});console.log((ok?'PASS ':'FAIL ')+name);if(!ok)throw new Error(name);};
const send=(name,...args)=>browser.evaluate(`import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise(${JSON.stringify(name)},...${JSON.stringify(args)}))`);
const scope={};
const request=(command,payload={},changes={})=>({protocol:'tai.v1',id:'host-'+(++sequence),command,scope:{...scope,...changes},payload});
const command=(name,payload={},changes={})=>send('taiHost',request(name,payload,changes));
async function wire(config,request,token=config.token){
  return new Promise((resolve,reject)=>{const socket=createConnection(config.endpoint);let text='';const timer=setTimeout(()=>{socket.destroy();reject(new Error('Synthetic IPC deadline'));},5000);socket.setEncoding('utf8');socket.once('connect',()=>socket.write(JSON.stringify({token,request})+'\n'));socket.on('data',chunk=>{text+=chunk;if(text.endsWith('\n')){clearTimeout(timer);socket.destroy();try{resolve(JSON.parse(text));}catch(e){reject(e);}}});socket.on('error',error=>{clearTimeout(timer);reject(error);});});
}
const retained={
  'TAiComponentData.json':'{"_tai.modules":{"synthetic":"preserve"},"agent-space:old-app":{"draft":"keep me"}}',
  'TAiLibraries.json':'{malformed synthetic historical catalog',
};
for(const [name,text]of Object.entries(retained))await writeFile(join(profile,'Default',name),text);
try{
  browser=await startNativeBrowser(binary,profile);
  const state=await until(async()=>{const s=await browser.state(),h=await send('taiGetHostState');return s.ready&&h.ready&&s;});
  Object.assign(scope,{profileId:state.profileId,spaceId:'agent-space'});
  const described=await send('taiGetHostState');
  expect('native host describes actual Profile',described.profileId===state.profileId);
  expect('browser host does not depend on or reopen retired libraries',described.ready&&described.libraries.length===0&&described.agentCommands.join(',')==='page.act,page.list,page.open,page.read');
  expect('retired directory picker cannot grant access',(await send('taiPickLibrary')).error.code==='COMMAND_UNAVAILABLE');
  expect('migration source picker still requires real activation',(await send('taiPickSource')).error.code==='USER_GESTURE_REQUIRED');
  for(const name of ['modules.preview','modules.call','modules.apply','modules.list','modules.pending','library.read','library.putIfAbsent','library.revoke']){
    const result=await command(name,{});expect('retired business route rejects '+name,!result.ok&&result.error.code==='COMMAND_UNAVAILABLE');
  }
  expect('invalid protocol fails closed',(await send('taiHost',{...request('page.list'),protocol:'other'})).error.code==='INVALID_REQUEST');
  expect('UI cannot forge another Profile',(await command('page.list',{}, {profileId:'wrong'})).error.code==='PROFILE_MISMATCH');
  expect('unknown commands fail explicitly',(await command('arbitrary.execute')).error.code==='COMMAND_UNAVAILABLE');
  const evalResult=await browser.call('Runtime.evaluate',{expression:"import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiCreateTask',{spaceId:'agent-space',commands:['page.list','page.read','page.open','page.act'],libraries:[]}))",awaitPromise:true,returnByValue:true,userGesture:true});
  const grant=evalResult.result.value;
  expect('explicit trusted gesture grants a fixed Space task',grant?.ok);
  const connectionFile=grant.value.configFile;expect('connection file is same-user private',(await stat(connectionFile)).mode%512===0o600);
  const client=await connectNativeHost(connectionFile);
  expect('native grant metadata contains only browser commands and no token',client.commands.length===4&&client.libraries.length===0&&!Object.hasOwn(client,'token'));
  const config=JSON.parse(await readFile(connectionFile,'utf8'));
  const slowClosed=new Promise(resolvePeer=>{
    idleSocket=createConnection(config.endpoint);idleTimer=setTimeout(()=>{resolvePeer(false);idleSocket.destroy();},35000);
    idleSocket.once('connect',()=>idleSocket.write('{'));idleSocket.once('close',()=>{clearTimeout(idleTimer);resolvePeer(true);});idleSocket.on('error',()=>{});
  });
  result=await wire(config,{...request('page.list'),scope:{...client.binding,spaceId:'user-space'}});
  expect('native IPC independently rejects a forged task Space',result.error.code==='SCOPE_MISMATCH');
  result=await wire(config,{...request('page.list'),scope:client.binding},'0'.repeat(64));
  expect('native IPC independently rejects an unknown task token',result.error.code==='LEASE_REVOKED');
  const agent=(name,payload={},page={})=>client.execute({protocol:'tai.v1',id:'agent-'+(++sequence),command:name,scope:{...client.binding,...page},payload});
  result=await agent('page.open',{url:'chrome://settings/'});expect('Agent cannot navigate privileged browser URLs',result.error.code==='INVALID_URL');
  for(const forbidden of ['http://','https://example.invalid:999999/','https://user:password@example.invalid/']){
    result=await agent('page.open',{url:forbidden});expect('malformed or credential URL is rejected '+forbidden.split('@').at(-1),result.error.code==='INVALID_URL');
  }
  const opened=await agent('page.open',{url});expect('Agent opens a background page without selecting user tab',opened.ok&&opened.value.pending&&await browser.evaluate("location.origin==='chrome://tai'"));
  const page=await until(async()=>{const list=await agent('page.list');return list.value.find(p=>p.url===url&&p.pageRevision>opened.value.pageRevision);});
  const pageRef=()=>({pageId:page.pageId,pageRevision:page.pageRevision});
  const data=await until(async()=>{const r=await agent('page.read',{},pageRef());return r.ok&&r;});expect('Agent reads real background page in granted Space',data.value.text.includes('Background page ✓')&&data.value.scope.spaceId==='agent-space');
  result=await agent('page.read',{format:123},pageRef());expect('invalid page format type is rejected',result.error.code==='INVALID_ARGUMENTS');
  expect('other Space cannot enumerate Agent page',!(await command('page.list',{}, {spaceId:'user-space'})).value.some(p=>p.pageId===page.pageId));
  const other=await command('page.open',{url:url+'?user'}, {spaceId:'user-space'});
  await until(async()=>{const list=await command('page.list',{}, {spaceId:'user-space'});return list.value.find(p=>p.pageId===other.value.pageId);});
  result=await agent('page.read',{}, {pageId:other.value.pageId,pageRevision:other.value.pageRevision});
  expect('Agent cannot read a page owned by another Space',result.error.code==='PAGE_NOT_OWNED');
  await browser.evaluate("document.querySelector('#host-space').value='user-space'");
  expect('changing UI selection never retargets an existing task',(await agent('page.list')).value.some(p=>p.pageId===page.pageId));
  result=await agent('page.read',{}, {pageId:page.pageId,pageRevision:page.pageRevision-1});expect('stale document revision is rejected',result.error.code==='STALE_PAGE');
  result=await agent('page.act',{action:'fill',selector:'#password',value:'forbidden'},pageRef());expect('password fill is explicitly rejected',result.ok&&!result.value.performed&&result.value.reason==='SENSITIVE_FIELD');
  const userTarget=await until(async()=>{const {targetInfos}=await browser.call('Target.getTargets');return targetInfos.find(t=>t.type==='page'&&t.url===url+'?user');});
  const {sessionId:userSession}=await browser.call('Target.attachToTarget',{targetId:userTarget.targetId,flatten:true});
  await browser.evaluate(`(async()=>{const pc=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${rtcSocket.address().port}'}]});pc.createDataChannel('ordinary-site');await pc.setLocalDescription(await pc.createOffer());await new Promise(r=>setTimeout(r,1200));pc.close();})()`,userSession);
  expect('ordinary website retains Chromium WebRTC network capability',rtcPackets>0);
  await browser.call('Target.activateTarget',{targetId:userTarget.targetId});
  await browser.evaluate("document.querySelector('#field').focus();document.querySelector('#field').value='User is typing'",userSession);
  result=await agent('page.act',{action:'fill',selector:'#field',value:'Agent typed ✓'},pageRef());expect('bounded background fill succeeds',result.ok&&result.value.performed);
  result=await agent('page.act',{action:'click',selector:'#increment'},pageRef());expect('bounded background click succeeds',result.ok&&result.value.performed);
  const after=await agent('page.read',{},pageRef());expect('Agent action actually changes background DOM',after.value.text.includes('1'));
  expect('background actions preserve another Space website input and focus',await browser.evaluate("document.hasFocus()&&document.activeElement?.id==='field'&&document.querySelector('#field').value==='User is typing'",userSession));
  const {targetId:secondSettings}=await browser.call('Target.createTarget',{url:'chrome://tai/',newWindow:true});
  const {sessionId:secondSession}=await browser.call('Target.attachToTarget',{targetId:secondSettings,flatten:true});
  await until(()=>browser.evaluate("location.origin==='chrome://tai'&&document.readyState==='complete'&&!!document.querySelector('#space-form')",secondSession));
  const secondGrant=await browser.call('Runtime.evaluate',{expression:"import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiCreateTask',{spaceId:'agent-space',commands:['page.list','page.open','page.read'],libraries:[]}))",awaitPromise:true,returnByValue:true,userGesture:true},secondSession);
  expect('second window can grant its own same-Space connection',secondGrant.result.value.ok);
  const second=await connectNativeHost(secondGrant.result.value.value.configFile);
  const secondCall=(command,payload={},page={})=>second.execute({protocol:'tai.v1',id:'second-'+(++sequence),command,scope:{...second.binding,...page},payload});
  result=await secondCall('page.read',{},pageRef());
  expect('a task cannot read the same Space in another window',!result.ok&&result.error.code==='PAGE_NOT_OWNED');
  const secondOpened=await secondCall('page.open',{url:url+'?second-window'});
  const secondPage=await until(async()=>{const r=await secondCall('page.list');return r.value.find(p=>p.pageId===secondOpened.value.pageId&&!p.loading&&p.pageRevision>secondOpened.value.pageRevision);});
  expect('original connection does not enumerate another window pages',!(await agent('page.list')).value.some(p=>p.pageId===secondPage.pageId));
  const secondTarget=await until(async()=>{const r=await browser.call('Target.getTargets');return r.targetInfos.find(t=>t.url===url+'?second-window');});
  await browser.call('Target.closeTarget',{targetId:secondTarget.targetId});
  await browser.call('Target.closeTarget',{targetId:secondSettings});
  result=await until(async()=>{const r=await secondCall('page.list');return !r.ok&&r;});
  expect('closing bound window makes page authority unavailable',result.error.code==='WINDOW_CLOSED');
  await send('taiRevokeTask',secondGrant.result.value.value.taskId);
  result=await agent('library.read',{});expect('page grant cannot regain file authority',result.error.code==='CAPABILITY_DENIED');
  await send('taiRevokeTask',grant.value.taskId);result=await agent('page.list');expect('revoked task immediately loses authority',result.error.code==='LEASE_REVOKED');
  expect('incomplete IPC peers expire without stopping browser control',await slowClosed&&(await send('taiGetHostState')).ready);
  for(const path of ['components.html','library.html']){
    await browser.call('Page.navigate',{url:'chrome://tai/'+path});
    expect('old URL cannot restart a retired runtime: '+path,await until(()=>browser.evaluate("document.body.textContent.includes('此内置功能已停止提供')&&!document.querySelector('script,iframe,input')")));
    expect('old URL cannot create a component',(await command('modules.preview',{kind:'pomodoro'})).error.code==='COMMAND_UNAVAILABLE');
  }
  await browser.stop();browser=await startNativeBrowser(binary,profile);
  const restarted=await until(async()=>{const h=await send('taiGetHostState');return h.ready&&h;});
  expect('task leases expire on restart',restarted.tasks.length===0);
  for(const [name,text]of Object.entries(retained))expect('historical file remains byte-identical: '+name,await readFile(join(profile,'Default',name),'utf8')===text);
  expect('retired fixture directory grants cannot bypass removal',(await send('taiHostFixture','library')).error.code==='COMMAND_UNAVAILABLE');
}catch(error){checks.push({check:'probe completion',passed:false,error:String(error)});process.exitCode=1;console.error(error);}
finally{rtcSocket.close();clearTimeout(idleTimer);idleSocket?.destroy();await browser?.stop();await new Promise(resolveClose=>server.close(resolveClose));const receipt={passed:checks.every(c=>c.passed),checks,profile,finishedAt:new Date().toISOString(),scope:'real native browser control, fixed scoped IPC, other-Space DOM/focus, retired capability denial and byte-identical legacy data; synthetic headless only'};await writeFile(join(local,'native-host-smoke.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));}
