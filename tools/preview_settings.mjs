#!/usr/bin/env node
// Dev-only visual loop: owned temporary Profile, actual native settings bridge.
// Source mode injects owned WebUI files via DevTools, never changes a user app.
import {writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {startNativeBrowser,until} from './native_smoke_support.mjs';
import {injectSettingsPreview} from './settings_preview_support.mjs';
const built=process.argv.includes('--built'),root=resolve('.'),out=resolve('research/local/settings-redesign');
await mkdir(out,{recursive:true});const profile=await mkdtemp(join(out,'preview-'));
await mkdir(join(profile,'Default'));await writeFile(join(profile,'Default/SidebarWorkspace.json'),JSON.stringify({version:1,active:'personal',edition:'pride',spaces:[{id:'personal',name:'个人',icon:'🏠'},{id:'work',name:'工作',icon:'💼'},{id:'study',name:'阅读',icon:'📚'}],items:[]}));
const browser=await startNativeBrowser(resolve('../chromium/src/out/SidebarBaseline/Chromium.app/Contents/MacOS/Chromium'),profile,{navigate:false,initialURL:built?'chrome://tai/':'chrome://tai/library.html',extra:['--tai-agent-node='+process.execPath,'--tai-agent-entry='+join(root,'modules/agent-tools/native-stdio.mjs')]});
const capture=async name=>{await browser.evaluate('document.fonts.ready');await browser.evaluate("Promise.all(document.getAnimations().filter(a=>a.playState===\"running\").map(a=>a.finished.catch(()=>{})))");const shot=await browser.call('Page.captureScreenshot',{format:'png'});await writeFile(join(out,name+'.png'),Buffer.from(shot.data,'base64'));};
try{
  if(built){await browser.call('Page.navigate',{url:'chrome://tai/'});await until(()=>browser.evaluate("location.pathname==='/'&&document.readyState==='complete'"));}
  await browser.call('Emulation.setDeviceMetricsOverride',{width:1200,height:840,deviceScaleFactor:1,mobile:false});
  await until(async()=>{const s=await browser.state();return s.ready;});
  if(!built){
    await injectSettingsPreview(browser,root);
  }
  await until(()=>browser.evaluate("document.querySelector('#space-icon')?.value==='🏠'"));
  const prefix=built?'built':'source';
  for(const category of ['spaces','appearance','agent','browser']){await browser.evaluate(`location.hash='${category}'`);await until(()=>browser.evaluate(`!document.querySelector('[data-settings=${category}]').hidden`));if(category==='agent')await until(()=>browser.evaluate("!!document.querySelector('.agent-create')&&!document.querySelector('.agent-create').disabled"));await capture(prefix+'-'+category);}
  await browser.evaluate("location.hash='spaces'");await until(()=>browser.evaluate("!document.querySelector('[data-settings=spaces]').hidden"));await browser.evaluate("document.querySelector('#icon-picker').open=true");await capture(prefix+'-emoji');
  await browser.evaluate("document.querySelector('#icon-picker').open=false;document.querySelector('#name').value='设计与研究';document.querySelector('#name').dispatchEvent(new Event('input'));document.querySelector('[data-color=\"#E0ECE7\"]').click()");await capture(prefix+'-draft');
  const overflow=[];
  for(const width of [760,480,360]){await browser.call('Emulation.setDeviceMetricsOverride',{width,height:840,deviceScaleFactor:1,mobile:false});overflow.push({width,overflow:await browser.evaluate('document.documentElement.scrollWidth>innerWidth')});await capture(prefix+'-'+width);if(width===360){await browser.evaluate("document.querySelector('#icon-picker').open=true");await capture(prefix+'-360-emoji');const bounds=await browser.evaluate("(()=>{const r=document.querySelector('.picker-panel').getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth};})()");if(bounds.left<0||bounds.right>bounds.width)throw new Error('Emoji popup exceeds viewport');await browser.evaluate("document.querySelector('#icon-picker').open=false");}}
  await browser.call('Emulation.setDeviceMetricsOverride',{width:480,height:600,deviceScaleFactor:1,mobile:false});await browser.evaluate("document.querySelector('#icon-picker').open=true");await until(()=>browser.evaluate("document.querySelector('.picker-panel').getBoundingClientRect().bottom<=innerHeight-10"));await capture(prefix+'-short-emoji');await browser.evaluate("document.querySelector('#icon-picker').open=false");await browser.call('Emulation.setDeviceMetricsOverride',{width:1200,height:840,deviceScaleFactor:1,mobile:false});await browser.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await capture(prefix+'-dark');
  const icons=await browser.evaluate("[...document.querySelectorAll('[data-icon]')].every(el=>getComputedStyle(el).maskImage.startsWith('url('))");
  if(overflow.some(x=>x.overflow)||!icons)throw new Error(JSON.stringify({overflow,icons}));
  await writeFile(join(out,prefix+'-checks.json'),JSON.stringify({passed:true,mode:built?'compiled WebUI':'source-injected development preview',overflow,icons,profile},null,2));
  console.log(JSON.stringify({passed:true,mode:prefix,overflow,icons}));
}finally{await browser.stop();}
