#!/usr/bin/env node
// Synthetic product process only. No user browser, credentials or Agent calls.
import {startNativeBrowser,until} from './native_smoke_support.mjs';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {connectNativeHost} from '../src/host/client/native-client.mjs';
const [binaryArg,rootArg]=process.argv.slice(2);
if(!binaryArg||!rootArg)throw new Error('Expected explicit binary and root');
const root=resolve(rootArg),binary=resolve(binaryArg),local=join(root,'research/local');
await mkdir(join(local,'browser-profiles'),{recursive:true});
const profile=await mkdtemp(join(local,'browser-profiles/tai-panel-'));
await mkdir(join(profile,'Default'));
// A user's existing Chrome panels stay left; only the TAi entry belongs right.
await writeFile(join(profile,'Default/Preferences'),JSON.stringify({side_panel:{is_right_aligned:false,alignment_overrides:{kBookmarks:false}}}));
await writeFile(join(profile,'Default/SidebarWorkspace.json'),JSON.stringify({version:1,language:'zh-CN',active:'space-a',spaces:[{id:'space-a',name:'Space A'},{id:'space-b',name:'Space B'}],items:[]}));
const server=createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><title>Scoped panel test</title><h1>Native panel task</h1>');});
await new Promise(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
const url='http://127.0.0.1:'+server.address().port+'/panel-test';
const extension=await mkdtemp(join(local,'native-panel-extension-'));
await writeFile(join(extension,'manifest.json'),JSON.stringify({manifest_version:3,name:'TAi synthetic side panel',version:'1.0',permissions:['sidePanel'],background:{service_worker:'tai-fixture-worker.js'},side_panel:{default_path:'panel.html'}}));
await writeFile(join(extension,'tai-fixture-worker.js'),"chrome.runtime.onInstalled.addListener(()=>{});");
await writeFile(join(extension,'panel.html'),'<h1>Fixture extension panel</h1>');
await writeFile(join(extension,'driver.html'),'<h1>Fixture extension driver</h1>');
const checks=[];let browser,sequence=0;
function expect(name,ok){checks.push({check:name,passed:!!ok});console.log((ok?'PASS ':'FAIL ')+name);if(!ok)throw new Error(name);}
async function send(name,args=[],sessionId,userGesture=false){const result=await browser.call('Runtime.evaluate',{expression:`import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise(${JSON.stringify(name)},...${JSON.stringify(args)}))`,awaitPromise:true,returnByValue:true,userGesture},sessionId);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
const panelState=session=>send('taiGetPanelState',[],session);
async function attachPanel(exclude=[]){const target=await until(async()=>{const {targetInfos}=await browser.call('Target.getTargets');return targetInfos.find(t=>t.url==='chrome://tai/panel.html'&&!exclude.includes(t.targetId));});const {sessionId}=await browser.call('Target.attachToTarget',{targetId:target.targetId,flatten:true});await until(()=>browser.evaluate("document.readyState==='complete'&&document.querySelector('#panel-space option')",sessionId));return {...target,sessionId};}
async function click(selector,sessionId){const result=await browser.call('Runtime.evaluate',{expression:`document.querySelector(${JSON.stringify(selector)}).click()`,returnByValue:true,userGesture:true},sessionId);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||'Click failed');}
try{
  browser=await startNativeBrowser(binary,profile,{extra:['--load-extension='+extension,'--tai-agent-node='+process.execPath,'--tai-agent-entry='+join(root,'modules/agent-tools/native-stdio.mjs')]});
  await until(async()=>{const state=await browser.state();return state.ready&&state;});
  const {windowId}=await browser.call('Browser.getWindowForTarget');
  await browser.call('Browser.setWindowBounds',{windowId,bounds:{width:1440,height:1000}});
  const first=await panelState();
  expect('regular settings knows its real browser and has no embedded marker',first.available&&!first.embedded&&!first.showing&&first.windowId>0);
  const widthBefore=await browser.evaluate('innerWidth');
  expect('opening native panel requires a real gesture',(await send('taiSetPanelVisible',[true])).error.code==='USER_GESTURE_REQUIRED');
  expect('trusted gesture opens the native panel',(await send('taiSetPanelVisible',[true],undefined,true)).ok);
  const pane=await attachPanel();
  const info=await until(async()=>{const s=await panelState(pane.sessionId);return s.showing&&s;});
  // Activating Chromium accessibility reproduces the native-window crash that
  // DOM-only tests previously missed. A successful snapshot must include UI.
  await browser.call('Accessibility.enable',{},pane.sessionId);
  const ax=await until(async()=>{const tree=await browser.call('Accessibility.getFullAXTree',{},pane.sessionId);return tree.nodes.some(node=>node.role?.value==='group'&&node.name?.value==='选择 Agent 渠道')&&tree;});
  expect('native panel survives accessibility and exposes named controls',!ax.nodes.some(node=>node.role?.value==='button'&&node.name?.value==='收起 TAi 面板')&&ax.nodes.some(node=>node.role?.value==='group'&&node.name?.value==='选择 Agent 渠道'));
  expect('TAi uses the native right-side header',info.nativeHeader&&info.rightAligned);
  expect('panel is embedded in the same real window and Profile',info.embedded&&info.windowId===first.windowId&&info.profileId===first.profileId);
  expect('opening native panel does not create a tab',info.tabCount===first.tabCount);
  expect('native panel reserves layout width beside the webpage',await until(async()=>await browser.evaluate('innerWidth')<widthBefore));
  expect('panel has a usable actual viewport',await until(()=>browser.evaluate('innerWidth>=300&&innerHeight>300',pane.sessionId)));
  expect('panel initializes its Space from its own window',await browser.evaluate("document.querySelector('#panel-space').value==='space-a'",pane.sessionId));
  expect('disconnected Agent UI is explicit and has no fake conversation',await browser.evaluate("document.querySelectorAll('[data-provider]').length===4&&!document.querySelector('.agent-limit').open&&!document.querySelector('.tai-agent-panel,textarea')",pane.sessionId));
  expect('setup begins with no command or lease and a clear channel choice',await browser.evaluate("document.querySelector('.agent-guide').hidden&&document.querySelector('[data-provider=codex]').getAttribute('aria-pressed')==='true'&&document.querySelector('.agent-create').textContent==='授权浏览器工具'",pane.sessionId));
  const worker=await until(async()=>{const {targetInfos}=await browser.call('Target.getTargets');return targetInfos.find(t=>t.url.endsWith('/tai-fixture-worker.js'));});
  const extensionOrigin='chrome-extension://'+new URL(worker.url).host;
  const {targetId:driver}=await browser.call('Target.createTarget',{url:extensionOrigin+'/driver.html'});
  const {sessionId:driverSession}=await browser.call('Target.attachToTarget',{targetId:driver,flatten:true});
  await until(()=>browser.evaluate("document.readyState==='complete'&&document.body.textContent.includes('Fixture extension driver')",driverSession));
  const extensionOpen=await browser.call('Runtime.evaluate',{expression:'chrome.windows.getCurrent().then(w=>chrome.sidePanel.open({windowId:w.id}))',awaitPromise:true,returnByValue:true,userGesture:true},driverSession);
  expect('standard extension API opens a real panel',!extensionOpen.exceptionDetails);
  await until(async()=>{const s=await panelState();return s.panelVisible&&!s.showing;});
  const extensionState=await panelState();
  expect('TAi and extensions share the same right-aligned native header',extensionState.nativeHeader&&extensionState.rightAligned&&extensionState.windowId===info.windowId);
  expect('extension selection replaces TAi rather than creating a second panel',!(await panelState(pane.sessionId)).showing);
  await browser.call('Target.closeTarget',{targetId:driver});
  await send('taiSetPanelVisible',[true],undefined,true);
  await until(async()=>(await panelState()).showing);
  expect('returning from extension preserves the same retained Agent document',(await browser.call('Target.getTargets')).targetInfos.some(t=>t.targetId===pane.targetId));
  expect('panel task creation also requires activation',(await send('taiCreateTask',[{spaceId:'space-a',commands:['page.list'],libraries:[]}],pane.sessionId)).error.code==='USER_GESTURE_REQUIRED');
  for(const provider of ['codex','claude','pi']){
    await click('[data-provider='+provider+']',pane.sessionId);
    await click('.agent-create',pane.sessionId);
    await until(()=>browser.evaluate("!document.querySelector('.agent-guide').hidden&&!!document.querySelector('.agent-command').textContent",pane.sessionId));
    const command=await browser.evaluate("document.querySelector('.agent-command').textContent",pane.sessionId);
    expect(provider+' setup generates a concrete channel command without placeholders',command.includes(provider==='pi'?'TAI_CONNECTION_FILE=':provider+' mcp add')&&command.includes(root)&&!command.includes('ABSOLUTE/PATH'));
    expect(provider+' does not claim connection before an Agent tool call',await browser.evaluate("document.querySelector('.agent-verification').textContent.includes('等待')",pane.sessionId));
  }
  const lease=await send('taiCreateTask',[{spaceId:'space-a',commands:['page.list','page.read','page.open'],libraries:[]}],pane.sessionId,true);
  expect('native non-tab panel can grant a task for its actual window',lease.ok&&lease.value.binding.spaceId==='space-a');
  const client=await connectNativeHost(lease.value.configFile);
  expect('new lease has no tool activity',(await send('taiGetHostState',[],pane.sessionId)).tasks.find(task=>task.id===lease.value.taskId).used===false);
  const opened=await client.execute({protocol:'tai.v1',id:'panel-'+(++sequence),command:'page.open',scope:client.binding,payload:{url}});
  expect('panel-origin task opens a background page in its owner window',opened.ok&&(await panelState()).tabCount===first.tabCount+1&&await browser.evaluate("location.href==='chrome://tai/'"));
  expect('only authenticated tool use marks a lease as contacted',(await send('taiGetHostState',[],pane.sessionId)).tasks.find(task=>task.id===lease.value.taskId).used===true);
  await browser.evaluate("document.querySelector('#panel-space').value='space-b';document.querySelector('#panel-space').dispatchEvent(new Event('change'))",pane.sessionId);
  expect('panel selection cannot retarget an existing native task',client.binding.spaceId==='space-a'&&(await send('taiGetHostState',[],pane.sessionId)).tasks.some(task=>task.id===lease.value.taskId&&task.spaceId==='space-a'));
  expect('retired components do not load in the panel',await browser.evaluate("!document.querySelector('#tab-components,#reader-tools,#panel-timer,iframe')",pane.sessionId));
  expect('technical connection details start collapsed',await browser.evaluate("!document.querySelector('.agent-advanced').open&&!document.querySelector('.agent-limit').open",pane.sessionId));
  expect('changing scope hides the previous guide',await until(()=>browser.evaluate("document.querySelector('.agent-guide').hidden",pane.sessionId)));
  await click('[data-provider=codex]',pane.sessionId);
  await send('taiSetPanelVisible',[false],pane.sessionId,true);
  await until(async()=>!(await panelState()).showing);
  expect('close control hides the actual native panel',!(await panelState()).showing);
  await send('taiSetPanelVisible',[true],undefined,true);
  await until(async()=>(await panelState()).showing);
  expect('reopening preserves window-owned scope and provider',await browser.evaluate("document.querySelector('#panel-space').value==='space-b'&&document.querySelector('[data-provider=codex]').getAttribute('aria-pressed')==='true'",pane.sessionId));
  const oldGrant=await send('taiCreateTask',[{spaceId:'space-b',commands:['modules.preview'],libraries:[]}],pane.sessionId,true);
  expect('direct requests cannot restore retired module grants',!oldGrant.ok&&oldGrant.error.code==='CAPABILITY_DENIED');
  const {targetId:otherPage}=await browser.call('Target.createTarget',{url:'chrome://tai/',newWindow:true});
  const {sessionId:otherSession}=await browser.call('Target.attachToTarget',{targetId:otherPage,flatten:true});
  await until(()=>browser.evaluate("document.readyState==='complete'&&!!document.querySelector('#space-form')",otherSession));
  const other=await panelState(otherSession);
  expect('second window has independent panel visibility',other.windowId!==first.windowId&&!other.showing&&other.profileId===first.profileId);
  await send('taiSetPanelVisible',[true],otherSession,true);const pane2=await attachPanel([pane.targetId]);
  const info2=await until(async()=>{const s=await panelState(pane2.sessionId);return s.showing&&s;});
  expect('second panel binds to second native window',info2.windowId===other.windowId&&info2.windowId!==info.windowId);
  await send('taiSetPanelVisible',[false],pane.sessionId,true);
  await until(async()=>!(await panelState()).showing);
  expect('closing first panel does not hide second window panel',(await panelState(otherSession)).showing);
  const countBefore=(await panelState(otherSession)).tabCount;
  await click('#panel-settings',pane2.sessionId);
  await until(async()=>(await panelState(otherSession)).tabCount===countBefore+1);
  expect('settings intent opens a tab only in its own window',(await panelState()).tabCount===first.tabCount+1&&(await panelState(otherSession)).tabCount===countBefore+1);
  await send('taiRevokeTask',[lease.value.taskId],pane2.sessionId);
  expect('tasks can be revoked from another panel in the same Profile',(await client.execute({protocol:'tai.v1',id:'after-revoke',command:'page.list',scope:client.binding,payload:{}})).error.code==='LEASE_REVOKED');
  const image=await browser.call('Page.captureScreenshot',{format:'png'},pane2.sessionId);
  await writeFile(join(local,'tai-panel-page.png'),Buffer.from(image.data,'base64'));
  const {targetInfos}=await browser.call('Target.getTargets');
  for(const target of targetInfos.filter(t=>t.type==='page'&&t.url!=='chrome://tai/panel.html')) {
    const {windowId:targetWindow}=await browser.call('Browser.getWindowForTarget',{targetId:target.targetId});
    if(targetWindow!==windowId) await browser.call('Target.closeTarget',{targetId:target.targetId});
  }
  expect('closing native window releases its retained panel document',await until(async()=>!(await browser.call('Target.getTargets')).targetInfos.some(t=>t.targetId===pane2.targetId)));
  await browser.stop();browser=undefined;
  const prefs=JSON.parse(await readFile(join(profile,'Default/Preferences'),'utf8')).side_panel;
  expect('only TAi overrides right alignment; existing Chrome panel preferences survive',prefs.is_right_aligned===false&&prefs.alignment_overrides.kBookmarks===false&&prefs.alignment_overrides.kTai===true);
}catch(error){checks.push({check:'probe completion',passed:false,error:String(error)});process.exitCode=1;console.error(error);}
finally{await browser?.stop();await new Promise(resolveClose=>server.close(resolveClose));const receipt={passed:checks.every(c=>c.passed),checks,profile,finishedAt:new Date().toISOString(),scope:'real Chromium per-window side-panel layout, trusted gestures, non-tab task binding, retired-route denial and retained panel state; synthetic headless only, no actual Agent channel or physical UI claim'};await writeFile(join(local,'native-panel-smoke.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));}
