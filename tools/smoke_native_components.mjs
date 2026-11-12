#!/usr/bin/env node
import {startNativeBrowser,until} from './native_smoke_support.mjs';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const[binaryArg,rootArg]=process.argv.slice(2);if(!binaryArg||!rootArg)throw new Error('Explicit product paths required');const root=resolve(rootArg),local=join(root,'research/local');await mkdir(join(local,'browser-profiles'),{recursive:true});const profile=await mkdtemp(join(local,'browser-profiles/tai-components-'));
let browser,scope,sequence=0;await mkdir(join(profile,'Default'));await writeFile(join(profile,'Default/SidebarWorkspace.json'),JSON.stringify({version:1,active:'first',spaces:[{id:'first',name:'First'},{id:'second',name:'Second'}],items:[]}));const checks=[];function expect(check,passed){checks.push({check,passed:!!passed});console.log((passed?'PASS ':'FAIL ')+check);if(!passed)throw new Error(check);}
const send=(method,...args)=>browser.evaluate(`import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise(${JSON.stringify(method)},...${JSON.stringify(args)}))`);
const command=(command,payload={})=>send('taiHost',{protocol:'tai.v1',id:'component-'+(++sequence),command,scope,payload});
const pkg=(version,script='')=>({kind:'custom',manifest:{apiVersion:1,id:'fixture.counter',version,title:'Synthetic counter',entry:'index.html',surfaces:['panel'],capabilities:['storage']},markup:'<main><h1>Fixture</h1></main>',style:'body{font-family:system-ui}',script});
async function launch(){browser=await startNativeBrowser(resolve(binaryArg),profile);const state=await until(async()=>{const state=await browser.state(),host=await send('taiGetHostState');return state.ready&&host.ready&&state;});scope={profileId:state.profileId,spaceId:state.spaces[0].id};}
async function preview(payload){return browser.evaluate(`(async()=>{const m=await import('./host-panel.js');if(!document.querySelector('#component-container')){const container=document.createElement('div');container.id='component-container';document.body.append(container);}globalThis.registrySurface??=m.createSurfaceHost(document.querySelector('#component-container'),${JSON.stringify(scope)});globalThis.registryPreview=await registrySurface.preview(${JSON.stringify(payload)});return registryPreview.grant;})()`);}
const data=(grant,key)=>command('modules.call',{handle:grant.handle,op:'storage.get',args:{key}});
try{
  await launch();const first=await preview(pkg('1.0.0',"await taiComponentSDK.storage.set('counter',7);"));expect('preview has private writable state',(await data(first,'counter')).value===7);
  expect('preview does not install a component',(await command('modules.list')).value.length===0);
  await browser.evaluate('registrySurface.apply(registryPreview)');let apps=(await command('modules.list')).value,entry=apps[0];expect('apply publishes code and private data together',apps.length===1&&entry.enabled&&entry.versions.length===1);
  const firstVersion=entry.currentVersion;
  const file=JSON.parse(await readFile(join(profile,'Default/TAiComponentData.json'),'utf8'));expect('applied data and registry are in one native file',file[scope.spaceId+':fixture.counter'].counter===7&&Object.keys(file['_tai.modules']).length===1);
  const preview2=await preview(pkg('2.0.0',"await taiComponentSDK.storage.set('counter',99);"));expect('new preview cannot alter the live version data',(await data(preview2,'counter')).value===99&&(await data(first,'counter')).value===7);
  await browser.evaluate('registrySurface.cancel()');expect('cancel discards draft data',(await data(first,'counter')).value===7&&(await command('modules.list')).value[0].versions.length===1);
  const conflicted=await preview(pkg('2.0.0',"await taiComponentSDK.storage.set('counter',99);"));await command('modules.call',{handle:first.handle,op:'storage.set',args:{key:'counter',value:8}});
  let rejected=false;try{await browser.evaluate('registrySurface.apply(registryPreview)');}catch(error){rejected=String(error).includes('STATE_CONFLICT');}
  expect('live data changes prevent stale draft overwrite',rejected&&(await data(first,'counter')).value===8);
  expect('failed apply restores previous frame',await browser.evaluate("[...document.querySelectorAll('#component-container iframe')].filter(f=>!f.hidden).length===1"));
  const second=await preview(pkg('2.0.0',"const saved=await taiComponentSDK.storage.get('counter');await taiComponentSDK.storage.set('counter',saved+1);"));await browser.evaluate('registrySurface.apply(registryPreview)');entry=(await command('modules.list')).value[0];expect('new version preserves data and retains rollback code',entry.versions.length===2&&(await data(second,'counter')).value===9);
  expect('replaced component instance loses authority',!(await data(first,'counter')).ok);
  let response=await command('modules.rollback',{componentId:entry.componentId,expectedRevision:'stale',versionId:firstVersion});expect('rollback refuses stale registry revision',response.error.code==='STALE_REVISION');
  response=await command('modules.rollback',{componentId:entry.componentId,expectedRevision:entry.revision,versionId:firstVersion});entry=(await command('modules.list')).value[0];expect('rollback selects retained code without reverting user data',response.ok&&entry.currentVersion===firstVersion&&JSON.parse(await readFile(join(profile,'Default/TAiComponentData.json'),'utf8'))[scope.spaceId+':fixture.counter'].counter===9);
  expect('rollback retires the newer runtime',!(await data(second,'counter')).ok);
  response=await command('modules.disable',{componentId:entry.componentId,expectedRevision:entry.revision});entry=(await command('modules.list')).value[0];expect('disable preserves code history and data',response.ok&&!entry.enabled&&entry.versions.length===2);
  await browser.stop();browser=null;await launch();entry=(await command('modules.list')).value[0];expect('registry and disabled state survive browser restart',!entry.enabled&&entry.versions.length===2&&entry.currentVersion===firstVersion);
  const restored=await preview(entry.versions.find(v=>v.id===entry.currentVersion).payload);await browser.evaluate('registrySurface.apply(registryPreview)');expect('saved package runs again without native recompilation',(await data(restored,'counter')).value===7&&(await command('modules.list')).value[0].enabled);
  await browser.evaluate('registrySurface.dispose();registrySurface=undefined');
  const homeScope=scope;scope={...scope,spaceId:'second'};
  const separate=await preview(pkg('1.0.0',"const old=await taiComponentSDK.storage.get('counter');await taiComponentSDK.storage.set('counter',old??42);"));
  expect('same app in another Space starts with independent data',(await data(separate,'counter')).value===42);
  await browser.evaluate('registrySurface.cancel();registrySurface.dispose();registrySurface=undefined');scope=homeScope;
  expect('other Space preview leaves installed app data unchanged',JSON.parse(await readFile(join(profile,'Default/TAiComponentData.json'),'utf8'))[scope.spaceId+':fixture.counter'].counter===7);
  await browser.call('Page.navigate',{url:'chrome://tai/components.html'});await until(()=>browser.evaluate("document.querySelector('#installed-apps')?.textContent.includes('Synthetic counter')"));
  await browser.call('Accessibility.enable');const ax=await browser.call('Accessibility.getFullAXTree');expect('formal component manager exposes accessible installed app actions',ax.nodes.some(n=>n.name?.value==='打开')&&ax.nodes.some(n=>n.name?.value==='停用'));
  const image=await browser.call('Page.captureScreenshot',{format:'png'});await writeFile(join(local,'components-native.png'),Buffer.from(image.data,'base64'));
}catch(error){checks.push({check:'components flow completion',passed:false,error:String(error)});process.exitCode=1;console.error(error);}
finally{await browser?.stop();await writeFile(join(local,'native-components-smoke.json'),JSON.stringify({passed:checks.every(c=>c.passed),checks,profile,finishedAt:new Date().toISOString()},null,2)+'\n');}
