// Capture the compiled new-tab page with synthetic data, never a user Profile.
import {mkdtemp, mkdir, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {startNativeBrowser, until} from './native_smoke_support.mjs';

const root=resolve('.'), output=join(root,'docs/images/readme');
const build=JSON.parse(execFileSync('python3',['-c',"import sys,json; sys.path.insert(0,'tools'); from run_product import validate_build; print(json.dumps(validate_build()))"],{cwd:root,encoding:'utf8'}));
await mkdir(output,{recursive:true});
const profile=await mkdtemp(join(root,'research/local/browser-profiles/readme-'));
await mkdir(join(profile,'Default'));
await writeFile(join(profile,'Default/SidebarWorkspace.json'),JSON.stringify({version:1,active:'personal',language:'en',edition:'standard',spaces:[{id:'personal',name:'Personal',icon:'🏠'}],items:[]}));
const browser=await startNativeBrowser(build.binary,profile,{navigate:false,initialURL:'chrome://tai/home.html'});
try {
  await browser.call('Emulation.setDeviceMetricsOverride',{width:1280,height:940,deviceScaleFactor:1,mobile:false});
  await browser.call('Page.navigate',{url:'chrome://tai/home.html'});
  await until(()=>browser.evaluate("location.pathname==='/home.html'&&document.documentElement.dataset.edition==='standard'&&document.querySelector('h1')?.textContent==='Room to think.'"));
  await browser.evaluate("(async()=>{await document.fonts.ready;const image=new Image();image.src='brand-standard-hero.png';await image.decode();})()");
  const shot=await browser.call('Page.captureScreenshot',{format:'png'});
  const bytes=Buffer.from(shot.data,'base64');
  await writeFile(join(output,'new-tab.png'),bytes);
  await writeFile(join(output,'capture.json'),JSON.stringify({
    description:'Compiled TAi new-tab WebUI; not a full browser-window screenshot or design mockup.',
    sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    chromiumRevision:build.revision,overlaySha256:build.overlay_sha256,
    viewport:{width:1280,height:940,deviceScaleFactor:1},edition:'standard',
    syntheticData:true,sha256:createHash('sha256').update(bytes).digest('hex'),
  },null,2)+'\n');
  console.log('Captured the compiled TAi new-tab page with synthetic data.');
} finally {await browser.stop();}
