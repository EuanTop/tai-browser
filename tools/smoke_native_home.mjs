#!/usr/bin/env node
import {startNativeBrowser,until,findWelcomeDialog} from './native_smoke_support.mjs';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
const [binaryArg,rootArg]=process.argv.slice(2);if(!binaryArg||!rootArg)throw new Error('Explicit product paths required');
const root=resolve(rootArg),local=join(root,'research/local');await mkdir(join(local,'browser-profiles'),{recursive:true});const profile=await mkdtemp(join(local,'browser-profiles/tai-home-'));
// Chinese baseline is deterministic; the settings suite also exercises English home.
await mkdir(join(profile,'Default'));await writeFile(join(profile,'Default/SidebarWorkspace.json'),JSON.stringify({version:1,language:'zh-CN',active:'home-space',spaces:[{id:'home-space',name:'Home'}],items:[]}));
const server=createServer((q,r)=>{r.setHeader('content-type','text/html');r.end('<title>Explicit startup URL</title><h1>Requested page</h1>')});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const checks=[];let browser;const expect=(check,passed)=>{checks.push({check,passed:!!passed});if(!passed)throw new Error(check);};
try{
  // The pinned unmodified Chromium also ignores internal chrome:// startup URLs.
  // Verify external URL intent without overriding that upstream restriction.
  for(const initialURL of ['http://127.0.0.1:'+server.address().port+'/startup']){
    const startProfile=await mkdtemp(join(local,'browser-profiles/tai-startup-'));
    browser=await startNativeBrowser(resolve(binaryArg),startProfile,{initialURL,navigate:false});
    const committed=await until(()=>browser.evaluate(`location.href===${JSON.stringify(initialURL)}&&document.readyState==='complete'`),10000).catch(()=>false);
    expect('explicit startup URL is preserved: '+initialURL.split(':')[0],committed);
    await browser.stop();browser=undefined;
  }
  const importProfile=await mkdtemp(join(local,'browser-profiles/tai-welcome-'));
  browser=await startNativeBrowser(resolve(binaryArg),importProfile,{initialURL:'chrome://tai/home.html',navigate:false});
  const {sessionId,targetId}=await findWelcomeDialog(browser);
  await browser.evaluate("document.querySelector('#open-import').click()",sessionId);
  expect('welcome offers three sources and separate native import links',
    await browser.evaluate(`[...document.querySelectorAll('#import-sources input')].map(node=>node.value).join(',')==='chrome,arc,safari'
      &&document.querySelector('#safari-native').href==='chrome://settings/importData'
      &&document.querySelector('#import-passwords').href==='chrome://password-manager/settings?import=true'`,sessionId));
  await browser.evaluate("document.querySelector('[value=arc]').click()",sessionId);
  expect('Arc shows the formats and imported data before the only file action',await browser.evaluate(
    `!document.querySelector('#import-destination [data-source-info=arc]').hidden
      &&document.querySelector('#import-destination [data-source-info=arc]').textContent.includes('Markdown')
      &&document.querySelector('#import-destination [data-source-info=chrome]').hidden
      &&['选择文件并导入','Choose file and import'].includes(document.querySelector('#pick-file').textContent.trim())
      &&!document.querySelector('#confirm-import')`,sessionId));
  const beforeImport=await browser.state();
  const unselected=await browser.call('Runtime.evaluate',{
    expression:`import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise(
      'taiImportWelcome',[{name:'Research',items:[{parent:-1,title:'Fixture',url:'https://example.test/'}]}]))`,
    userGesture:true,awaitPromise:true,returnByValue:true,
  },sessionId);
  expect('even a click gesture cannot import without a native file selection',
    unselected.result.value?.error?.code==='USER_GESTURE_REQUIRED'&&
    (await browser.state()).spaces.length===beforeImport.spaces.length);
  await browser.call('Runtime.evaluate',{
    expression:"document.querySelector('#continue').click()",userGesture:true,returnByValue:true,
  },sessionId);
  await until(async()=>!(await browser.call('Target.getTargets')).targetInfos.some(target=>target.targetId===targetId));
  expect('starting browsing closes the welcome window and keeps the home tab',
    await browser.evaluate("location.pathname==='/home.html'")&&!(await browser.state()).welcomePending);
  await browser.call('Page.navigate',{url:'chrome://tai/welcome.html'});
  await until(()=>browser.evaluate("location.hash==='#browser'"));
  const restoredWelcome=await findWelcomeDialog(browser);
  expect('the old welcome tab routes to settings and opens a separate card',restoredWelcome.targetId!==targetId);
  await browser.stop();browser=undefined;
  browser=await startNativeBrowser(resolve(binaryArg),profile);const state=await until(async()=>{const state=await browser.state();return state.ready&&state;});
  await browser.call('Network.enable');await browser.call('Page.navigate',{url:'chrome://tai/home.html'});
  await until(()=>browser.evaluate("document.documentElement.dataset.edition==='standard'&&document.querySelector('.atrium-hero')?.naturalWidth>0"));
  expect('home contains only the artwork',await browser.evaluate(`
    document.body.innerText.trim()==='' &&
    document.querySelector('main').children.length===1 &&
    !!document.querySelector('main > img.atrium-hero') &&
    !document.querySelector('a,button,input,footer,header')
  `));
  await browser.call('Accessibility.enable');
  expect('the sole artwork has a localized accessible description',
    (await browser.call('Accessibility.getFullAXTree')).nodes.some(node=>
      node.role?.value==='image'&&node.name?.value==='自然光穿过圆形庭院，映照白色墙面和水面'));
  for (const [width,height] of [[1434,904],[1000,260],[360,640]]) {
    await browser.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    expect(`home artwork fits and centers in a ${width} × ${height} viewport`,await browser.evaluate(`(()=>{
      const hero=document.querySelector('.atrium-hero');
      const {left,top,width,height,right,bottom}=hero.getBoundingClientRect();
      return width>0 && height>0 && Math.abs(left+width/2-innerWidth/2)<1 &&
        Math.abs(top+height/2-innerHeight/2)<1 && left>0 && top>0 &&
        right<innerWidth && bottom<innerHeight &&
        Math.abs(width/height-hero.naturalWidth/hero.naturalHeight)<0.02 &&
        document.documentElement.scrollHeight===innerHeight;
    })()`));
  }
  await browser.call('Emulation.clearDeviceMetricsOverride');
  for(const [url,path] of [['brand-standard-hero.png','brand/atrium/standard-hero.png'],['brand-standard-icon.png','brand/atrium/editions/standard-icon-aligned.png']]){
    await until(()=>browser.events.some(e=>e.method==='Network.responseReceived'&&e.params.response.url.endsWith('/'+url)));
    const event=browser.events.find(e=>e.method==='Network.responseReceived'&&e.params.response.url.endsWith('/'+url));
    const response=await until(async()=>{try{return await browser.call('Network.getResponseBody',{requestId:event.params.requestId});}catch{return false;}});
    const bytes=Buffer.from(response.body,response.base64Encoded?'base64':'utf8');
    expect('approved asset is byte-identical: '+url,createHash('sha256').update(bytes).digest('hex')===createHash('sha256').update(await readFile(join(root,path))).digest('hex'));
  }
  const patch=await browser.command({protocol:'tai.v1',id:'home-theme',command:'settings.patch',scope:{profileId:state.profileId,spaceId:state.spaces[0].id},payload:{revision:state.revision,changes:{edition:'pride'}}});expect('home edition is a real persisted setting',patch.ok);
  await until(()=>browser.evaluate("document.documentElement.dataset.edition==='pride'&&document.querySelector('#home-icon').getAttribute('href')==='brand-pride-icon.png'"));
  expect('Pride theme switches architecture and icon together',await until(()=>browser.evaluate(`
    document.querySelector('.atrium-hero').currentSrc.endsWith('/brand-pride-hero.png') &&
    document.querySelector('.atrium-hero').naturalWidth===1817
  `)));
  for (const [scheme,color] of [['light','rgb(248, 248, 251)'],['dark','rgb(27, 28, 42)']]) {
    await browser.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
    await until(()=>browser.evaluate(`getComputedStyle(document.body).backgroundColor===${JSON.stringify(color)}`));
    expect('Pride '+scheme+' home has one continuous canvas',await browser.evaluate("getComputedStyle(document.body).backgroundImage==='none'"));
  }
  await browser.call('Emulation.setEmulatedMedia',{features:[]});
  const image=await browser.call('Page.captureScreenshot',{format:'png'});await writeFile(join(local,'home-pride-native.png'),Buffer.from(image.data,'base64'));
}catch(error){checks.push({check:'home flow completion',passed:false,error:String(error)});process.exitCode=1;console.error(error);}
finally{await browser?.stop();await new Promise(r=>server.close(r));await writeFile(join(local,'native-home-smoke.json'),JSON.stringify({passed:checks.every(c=>c.passed),checks,profile,finishedAt:new Date().toISOString()},null,2)+'\n');console.log(JSON.stringify(checks,null,2));}
