#!/usr/bin/env node
// Disposable Profiles only; no actual account or import source is accessed.
import {findWelcomeDialog, startNativeBrowser, until} from './native_smoke_support.mjs';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
const [binaryArg,rootArg]=process.argv.slice(2);
if(!binaryArg||!rootArg)throw new Error('Expected browser and project root');
const binary=resolve(binaryArg),root=resolve(rootArg),local=join(root,'research/local');
const checks=[];let browser;
const expect=(check,passed)=>{checks.push({check,passed:!!passed});if(!passed)throw new Error(check);};
const deep=`function deep(selector,root=document){return [...root.querySelectorAll(selector),...[...root.querySelectorAll('*')].flatMap(e=>e.shadowRoot?deep(selector,e.shadowRoot):[])];}`;
const inspect=expression=>browser.evaluate(`(()=>{${deep}return (${expression});})()`);
const navigate=async url=>{await browser.call('Page.navigate',{url});await until(()=>inspect(`location.href===${JSON.stringify(url)}&&document.readyState==='complete'&&deep('settings-ui').length>0`));};
const seedSettingsWorkspace=async(profile,language)=>{
  await mkdir(join(profile,'Default'),{recursive:true});
  await writeFile(join(profile,'Default/SidebarWorkspace.json'),JSON.stringify({
    version:1, active:'settings-test-space', language, welcome_pending:false,
    spaces:[{id:'settings-test-space',name:'Settings test'}], items:[],
  }));
};
const openAboutWithUpdateProbe=async()=>{
  await navigate('chrome://settings/');
  await browser.evaluate(`(async()=>{
    ${deep}
    const {AboutPageBrowserProxyImpl}=await import('chrome://settings/settings.js');
    const proxy=AboutPageBrowserProxyImpl.getInstance(), original=proxy.refreshUpdateStatus.bind(proxy);
    window.taiUpdateRequests=0;
    proxy.refreshUpdateStatus=()=>{window.taiUpdateRequests++;original();};
    deep('#about-menu')[0].click();
  })()`);
  await until(()=>inspect("location.pathname==='/help'&&deep('#productLogo').some(e=>e.complete&&e.naturalWidth>0)"));
};
try{
  const profile=await mkdtemp(join(local,'browser-profiles/native-settings-'));
  await seedSettingsWorkspace(profile,'en');
  await writeFile(join(profile,'Default/Preferences'),JSON.stringify({signin:{allowed:true},profile:{name:'Retained local Profile'}}));
  browser=await startNativeBrowser(binary,profile,{navigate:false,initialURL:'chrome://settings/'});
  await navigate('chrome://settings/');
  await until(()=>inspect("deep('#importDataDialogTrigger').some(e=>e.checkVisibility())"));
  expect('native settings retains import and non-account services',await inspect("deep('#importDataDialogTrigger').some(e=>e.checkVisibility())&&deep('#google-services').some(e=>e.checkVisibility())"));
  await browser.call('Runtime.evaluate',{
    expression:`(()=>{${deep}deep('#importDataDialogTrigger')[0].click();})()`,
    userGesture:true,
  });
  const migration=await findWelcomeDialog(browser);
  expect('General opens the TAi migration card directly on browser choices',await until(()=>
    browser.evaluate(`!document.querySelector('#welcome-import').hidden
      && document.querySelector('#welcome-intro').hidden
      && document.querySelector('#continue').textContent.trim()==='Done'
      && [...document.querySelectorAll('#import-sources input')].map(r=>r.value).join(',')==='chrome,arc,safari'`,
    migration.sessionId)));
  await browser.call('Runtime.evaluate',{
    expression:"document.querySelector('#continue').click()",userGesture:true,
  },migration.sessionId);
  await until(async()=>!(await browser.call('Target.getTargets')).targetInfos
    .some(target=>target.targetId===migration.targetId));
  expect('migration closes back to the existing native settings tab',
    await inspect("location.href==='chrome://settings/'&&deep('settings-import-data-dialog').length===0"));
  expect('native settings removes Profile and sign-in rows',await inspect("['#profile-row','#account-subpage-row','#edit-profile','#manage-google-account','settings-sync-account-control','#sync-setup'].every(s=>deep(s).every(e=>!e.checkVisibility()))"));
  expect('account heading becomes General',await inspect("deep('#people').some(e=>e.textContent.trim()==='General')"));
  expect('General navigation renders a real neutral SVG icon',await until(()=>inspect("deep('a#people').some(e=>e.querySelector('cr-icon')?.shadowRoot?.querySelector('svg path'))")));
  expect('settings header uses the TAi asset slot',await inspect("deep('cr-toolbar').some(e=>[...e.querySelectorAll('[slot=product-logo]')].some(i=>i.src.startsWith('data:image/png;base64,')&&i.naturalWidth===64))"));
  expect('About menu has product text and no Chrome icon',await inspect("deep('#about-menu').some(e=>e.textContent.includes('About TAI')&&e.querySelector('cr-icon')?.getAttribute('icon')==='cr:info')"));
  for(const path of ['manageProfile','account','syncSetup','syncSetup/advanced','signOut']){
    await navigate('chrome://settings/'+path);
    await until(()=>inspect("deep('#importDataDialogTrigger').some(e=>e.checkVisibility())"));
    expect('direct account route resolves to General: '+path,await inspect("deep('settings-manage-profile,settings-sync-page,settings-account-page,settings-signout-dialog').every(e=>!e.checkVisibility())"));
  }
  await browser.call('Accessibility.enable');
  await openAboutWithUpdateProbe();
  const {nodes:aboutAX}=await browser.call('Accessibility.getFullAXTree');
  expect('About remains stable with accessibility enabled and exposes update state',aboutAX.some(n=>n.role?.value==='StaticText'&&n.name?.value?.trim()==='Manual updates'));
  expect('About page identifies TAI and uses the approved icon',await inspect("document.title.includes('About TAI')&&deep('#productLogo').some(e=>e.src.startsWith('data:image/png;base64,')&&e.getAttribute('alt')==='TAi Browser')"));
  expect('About icon is high resolution at a fixed optical size',await inspect("deep('#productLogo').some(e=>e.naturalWidth===256&&e.clientWidth===64&&e.clientHeight===64)"));
  expect('development build states manual updates without requesting the Chromium updater',await inspect("window.taiUpdateRequests===0&&deep('#taiUpdateStatus').some(e=>e.textContent.includes('Manual updates'))&&deep('#updateStatusMessage,cr-link-row#help').length===0"));
  expect('detailed version remains linked to the native version page',await inspect("deep('a').some(a=>a.href==='chrome://version/')"));
  expect('About retains Chromium license and credits',await inspect("deep('a').some(a=>a.href==='chrome://credits/')"));
  expect('legal attribution is compact and initially collapsed',await inspect("deep('#taiAcknowledgements').some(e=>!e.open&&e.textContent.includes('The Chromium Authors'))"));
  await browser.evaluate(`(()=>{${deep}deep('#taiAcknowledgements summary')[0].click();})()`);
  expect('open source acknowledgement can be expanded',await inspect("deep('#taiAcknowledgements').some(e=>e.open&&e.querySelector('.tai-legal').checkVisibility())"));
  await browser.evaluate(`(()=>{${deep}deep('#taiAcknowledgements summary')[0].click();})()`);
  for(const width of [1200,480,360]){
    await browser.call('Emulation.setDeviceMetricsOverride',{width,height:840,deviceScaleFactor:2,mobile:false});
    await until(()=>browser.evaluate('innerWidth==='+width));
    const shot=await browser.call('Page.captureScreenshot',{format:'png'});
    await writeFile(join(local,'native-about-'+width+'.png'),Buffer.from(shot.data,'base64'));
    const bounds=await inspect("JSON.stringify({viewport:innerWidth,scroll:document.documentElement.scrollWidth,items:deep('.tai-about-header,.tai-about-facts,.tai-about-links,.tai-acknowledgements').map(e=>({name:e.className,left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))})");
    const layout=JSON.parse(bounds);
    if(width===1200){
      expect('About values align in one shared desktop column',await inspect("(()=>{const r=deep('.tai-fact-value').map(e=>e.getBoundingClientRect());const l=deep('.tai-fact-label').map(e=>e.getBoundingClientRect());return r.length===3&&r.every(e=>Math.abs(e.left-r[0].left)<1)&&r.every((e,i)=>e.left-l[i].right>=23);})()"));
    }else{
      expect('About labels stack above values at '+width,await inspect("deep('.tai-about-fact-row').every(e=>e.querySelector('.tai-fact-value').getBoundingClientRect().top>=e.querySelector('.tai-fact-label').getBoundingClientRect().bottom)"));
    }
    expect('About layout stays within viewport at '+width+' '+bounds,layout.scroll<=layout.viewport&&layout.items.every(e=>e.left>=0&&e.right<=layout.viewport));
  }
  for(const path of ['privacy','autofill','appearance','downloads','languages','system']){
    await navigate('chrome://settings/'+path);
    expect('non-account native settings still load: '+path,await inspect("!!document.querySelector('settings-ui')&&!document.querySelector('net-error')"));
  }
  await browser.stop();browser=null;
  const prefs=JSON.parse(await readFile(join(profile,'Default/Preferences'),'utf8'));
  expect('account UI removal preserves the stored Profile name',prefs.profile.name==='Retained local Profile');
  const plain=await mkdtemp(join(local,'browser-profiles/native-settings-upstream-'));
  await mkdir(join(plain,'Default'));
  await writeFile(join(plain,'Default/Preferences'),JSON.stringify({signin:{allowed:true},profile:{name:'Retained local Profile'}}));
  browser=await startNativeBrowser(binary,plain,{product:false,navigate:false,initialURL:'chrome://settings/'});
  await navigate('chrome://settings/');
  await until(()=>inspect("deep('#people').length>0&&deep('#profile-row').some(e=>e.checkVisibility())"));
  expect('non-product browser retains original account UI',await inspect("deep('#people').some(e=>e.textContent.includes('You and Google'))&&deep('#profile-row').some(e=>e.checkVisibility())"));
  expect('non-product About branding remains upstream',await inspect("deep('#about-menu').some(e=>e.textContent.includes('Chromium'))"));
  await openAboutWithUpdateProbe();
  expect('non-product browser retains the original About page and update request',await until(()=>inspect("window.taiUpdateRequests>0&&deep('cr-link-row#help,#updateStatusMessage').length===2&&deep('#taiUpdateStatus').length===0")));
  await browser.stop();browser=null;
  // Chromium recomputes signin.allowed during startup (including availability
  // of upstream identity support). Compare with an identically seeded control,
  // rather than requiring a synthetic stored value to survive that mechanism.
  const upstreamPrefs=JSON.parse(await readFile(join(plain,'Default/Preferences'),'utf8'));
  expect('product UI retains the upstream Profile startup and sign-in preference behavior',
    prefs.profile.name===upstreamPrefs.profile.name&&prefs.signin.allowed===upstreamPrefs.signin.allowed);
  const chinese=await mkdtemp(join(local,'browser-profiles/native-settings-zh-'));
  await seedSettingsWorkspace(chinese,'zh-CN');
  // macOS resolves application language through NSBundle, not --lang alone.
  // These are process-local launch arguments, never a saved system preference.
  // Omit the startup URL: headless counts Cocoa's paired value as a target.
  // Navigate explicitly after startup, as in the other native settings probes.
  browser=await startNativeBrowser(binary,chinese,{navigate:false,initialURL:null,extra:['--lang=zh-CN','--force-dark-mode',...(process.platform==='darwin'?['-AppleLanguages','(zh-Hans)']:[])]});
  await navigate('chrome://settings/help');
  await until(()=>inspect("deep('#taiUpdateStatus').length>0"));
  expect('About manual-update state supports Chinese',await inspect("deep('#taiUpdateStatus').some(e=>e.textContent.includes('手动更新'))&&document.title.includes('关于 TAI')"));
  expect('About dark mode follows native text colors',await inspect("deep('.tai-about-facts').every(e=>{const rgb=getComputedStyle(e).color.match(/\\d+/g).map(Number);return Math.max(...rgb.slice(0,3))>160;})"));
  const dark=await browser.call('Page.captureScreenshot',{format:'png'});
  await writeFile(join(local,'native-about-zh-dark.png'),Buffer.from(dark.data,'base64'));
}catch(error){checks.push({check:'completion',passed:false,error:String(error)});process.exitCode=1;}
finally{await browser?.stop();const receipt={passed:checks.every(c=>c.passed),checks,finishedAt:new Date().toISOString(),scope:'synthetic real native Settings WebUI; account route gating, preserved browsing controls, product identity and upstream non-product behavior; physical menu/toolbar/colors checked separately'};await writeFile(join(local,'native-settings-smoke.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));}
