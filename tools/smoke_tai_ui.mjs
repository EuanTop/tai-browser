#!/usr/bin/env node
// Own synthetic browser instances only; never attaches to a user browser.
import {startNativeBrowser,until,findWelcomeDialog} from './native_smoke_support.mjs';
import {injectSettingsPreview} from './settings_preview_support.mjs';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const [binaryArg,rootArg]=process.argv.slice(2);
if(!binaryArg||!rootArg)throw new Error('Expected explicit browser binary and project root');
const binary=resolve(binaryArg),root=resolve(rootArg),local=join(root,'research/local');
await mkdir(join(local,'browser-profiles'),{recursive:true});
const checks=[];let sequence=0;
function expect(name,ok){checks.push({check:name,passed:!!ok});if(!ok)throw new Error(name);}
const sourcePreview=process.env.TAI_UI_SOURCE_PREVIEW==='1';
const start=async(profile,product=true)=>{const browser=await startNativeBrowser(binary,profile,sourcePreview&&product?{product,navigate:false,initialURL:'chrome://tai/library.html'}:{product});if(sourcePreview&&product)await injectSettingsPreview(browser,root);return browser;};
const profile=await mkdtemp(join(local,'browser-profiles/tai-ui-smoke-'));
const request=(state,changes,scope={})=>({protocol:'tai.v1',id:'probe-'+(++sequence),command:'settings.patch',scope:{profileId:state.profileId,spaceId:state.spaces[0].id,...scope},payload:{revision:state.revision,changes}});
let browser;
try{
  browser=await start(profile);
  let first=await until(async()=>{const s=await browser.state();return s.ready&&s;});
  expect('real chrome://tai WebUI loads current Profile and Space',first.schema==='tai.settings.v1'&&first.spaces.length>0&&!first.readOnly);
  expect('every Space has a default emoji',first.spaces.every(s=>typeof s.icon==='string'&&s.icon.length>0));
  expect('fresh Profile resolves a supported interface language',['en','zh-CN'].includes(first.language));
  expect('native shortcut catalog includes real Arc-style defaults',first.shortcuts.some(s=>s.id==='toggle_sidebar'&&s.binding==='Command+S')&&first.shortcuts.some(s=>s.id==='hard_reload'&&s.binding==='Command+Shift+R')&&first.shortcuts.some(s=>s.id==='copy_url'&&s.binding==='Command+Shift+C'));
  expect('fresh Profile has no shortcut overrides',Object.keys(first.shortcutOverrides).length===0);
  // Existing Chinese-copy assertions have an explicit, deterministic locale.
  if(first.language!=='zh-CN'){
    const localized=await browser.command(request(first,{language:'zh-CN'}));
    expect('native locale preference accepts Simplified Chinese',localized.ok&&localized.value.language==='zh-CN');first=localized.value;
  }
  await until(()=>browser.evaluate("document.documentElement.lang==='zh-CN'&&document.querySelector('#language').value==='zh-CN'"));
  await until(()=>browser.evaluate("document.querySelector('#space option')?.value"));
  expect('unchanged settings do not offer a redundant save',await browser.evaluate("document.querySelector('#save-space').disabled&&document.querySelector('#save-edition').disabled"));
  expect('native page contains original Chromium management links',await browser.evaluate("['chrome://settings/','chrome://history/','chrome://extensions/','chrome://downloads/'].every(h=>[...document.querySelectorAll('nav a')].some(a=>a.href===h))"));
  let result=await browser.command(request(first,{name:'Native settings ✓',color:'#D8D4EE',edition:'pride'}));
  expect('validated native patch updates name color and edition together',result.ok&&result.value.spaces[0].name==='Native settings ✓'&&result.value.spaces[0].color==='#D8D4EE'&&result.value.edition==='pride');
  let current=result.value;
  for(const icon of ['👩🏽‍💻','👨‍👩‍👧‍👦','🇨🇳','🏳️‍🌈']){
    const changed=await browser.command(request(current,{icon}));
    expect('Unicode emoji sequence is accepted: '+icon,changed.ok&&changed.value.spaces[0].icon===icon);current=changed.value;
  }
  for(const icon of ['', 'hello', '🚀🌐', 'a'.repeat(65), 123]){
    const invalid=await browser.command(request(current,{name:'must not apply',icon}));
    expect('invalid emoji patch is atomic: '+JSON.stringify(icon),!invalid.ok&&invalid.error.code==='INVALID_ICON'&&(await browser.state()).revision===current.revision&&(await browser.state()).spaces[0].name==='Native settings ✓');
  }
  expect('successful patch rotates native revision',first.revision!==current.revision);
  expect('stale patch is rejected',!(await browser.command(request(first,{name:'stale'}))).ok);
  result=await browser.command(request(current,{name:'wrong-profile'},{profileId:'not-the-current-profile'}));
  expect('forged Profile cannot choose a BrowserContext',!result.ok&&result.error.code==='PROFILE_MISMATCH');
  result=await browser.command(request(current,{name:'missing'},{spaceId:'missing-space'}));
  expect('unknown Space is rejected',!result.ok&&result.error.code==='SPACE_NOT_FOUND');
  result=await browser.command(request(current,{name:'must not apply',color:'invalid'}));
  expect('mixed invalid patch is atomic',!result.ok&&(await browser.state()).spaces[0].name==='Native settings ✓'&&(await browser.state()).revision===current.revision);
  result=await browser.command(request(current,{name:'   '}));expect('blank Space name is rejected',!result.ok&&result.error.code==='INVALID_NAME');
  result=await browser.command(request(current,{cookie:'not-a-setting'}));expect('unknown setting cannot reach Profile preferences',!result.ok&&result.error.code==='INVALID_ARGUMENTS');
  result=await browser.command({...request(current,{name:'x'}),command:'page.act'});expect('page execution is not exposed by settings',!result.ok&&result.error.code==='COMMAND_UNAVAILABLE');
  expect('state observer updates real WebUI theme and name',await browser.evaluate("document.documentElement.dataset.edition==='pride'&&document.querySelector('#name').value==='Native settings ✓'"));
  await browser.evaluate("document.querySelector('#name').value='Unapplied preview';document.querySelector('#name').dispatchEvent(new Event('input'));document.querySelector('[data-color=\"#E0ECE7\"]').click()");
  expect('color and name preview update before persistence',await browser.evaluate("document.querySelector('#preview-name').textContent==='Unapplied preview'&&!document.querySelector('#default-color').checked&&!document.querySelector('#save-space').disabled")&&(await browser.state()).spaces[0].color==='#D8D4EE');
  await browser.evaluate("document.querySelector('#reset-space').click()");
  expect('cancel restores saved name and color without a write',await browser.evaluate("document.querySelector('#name').value==='Native settings ✓'&&document.querySelector('#save-space').disabled")&&(await browser.state()).revision===current.revision);
  await browser.evaluate("document.querySelector('#name').value='Keep this draft';document.querySelector('#name').dispatchEvent(new Event('input'));document.querySelector('#space-icon').value='not an emoji';document.querySelector('#space-icon').dispatchEvent(new Event('input'));document.querySelector('#space-form').requestSubmit()");
  await until(()=>browser.evaluate("document.querySelector('#space-icon').getAttribute('aria-invalid')==='true'&&!document.querySelector('#name').disabled"));
  expect('invalid input preserves drafts and opens the correct control',await browser.evaluate("document.querySelector('#name').value==='Keep this draft'&&document.querySelector('#icon-picker').open")&&(await browser.state()).revision===current.revision);
  await browser.evaluate("document.querySelector('#reset-space').click()");
  await browser.evaluate("document.querySelector('[data-theme=standard]').click()");
  const notification=await browser.command(request(current,{name:'External window edit'}));
  current=notification.value;
  await until(()=>browser.evaluate("document.querySelector('#save-space').disabled&&document.querySelector('#save-edition').disabled"));
  expect('external notifications protect unapplied theme draft and block stale save',await browser.evaluate("document.querySelector('#edition').value==='standard'"));
  await browser.evaluate("document.querySelector('#refresh').click()");
  await until(()=>browser.evaluate("!document.querySelector('#name').disabled&&document.querySelector('#name').value==='External window edit'"));
  await browser.evaluate("document.querySelector('#name').value='discarded draft';document.querySelector('#name').dispatchEvent(new Event('input'));document.querySelector('#space').dispatchEvent(new Event('change'))");
  expect('switching Space restores controls with no stale draft to save',await browser.evaluate("!document.querySelector('#name').disabled&&document.querySelector('#save-space').disabled&&document.querySelector('#save-edition').disabled"));
  await browser.evaluate("document.querySelector('#name').value='Unapplied name draft';document.querySelector('#space-icon').value='🧪';document.querySelector('#name').dispatchEvent(new Event('input'));document.querySelector('[data-theme=standard]').click();document.querySelector('#save-edition').click()");
  await until(async()=>{const state=await browser.state();return state.edition==='standard'&&browser.evaluate("!document.querySelector('#edition').disabled");});
  expect('appearance save does not apply an unrelated Space draft',(await browser.state()).spaces[0].name==='External window edit'&&await browser.evaluate("document.querySelector('#name').value==='Unapplied name draft'"));
  expect('appearance save preserves an unapplied emoji draft',(await browser.state()).spaces[0].icon==='🏳️‍🌈'&&await browser.evaluate("document.querySelector('#space-icon').value==='🧪'"));
  await browser.evaluate("document.querySelector('[data-theme=pride]').click();document.querySelector('#save-edition').click()");
  await until(async()=>{const state=await browser.state();return state.edition==='pride'&&browser.evaluate("!document.querySelector('#edition').disabled");});
  await browser.evaluate("document.querySelector('[data-theme=standard]').click()");
  await browser.evaluate("document.querySelector('#name').value='Edited in actual UI';document.querySelector('#name').dispatchEvent(new Event('input'));document.querySelector('#icon-picker').open=true;document.querySelector('[data-emoji=\"🚀\"]').click();document.querySelector('#space-form').requestSubmit()");
  current=await until(async()=>{const s=await browser.state();return s.spaces[0].name==='Edited in actual UI'&&s;});
  expect('actual form submission reaches native command layer',current.spaces[0].name==='Edited in actual UI');
  expect('emoji picker saves through the native form',current.spaces[0].icon==='🚀');
  expect('Space save preserves the separate unapplied appearance draft',current.edition==='pride'&&await browser.evaluate("document.querySelector('#edition').value==='standard'"));
  await browser.evaluate("location.hash='appearance'");
  await until(()=>browser.evaluate("!document.querySelector('[data-settings=appearance]').hidden"));
  expect('settings categories expose only the selected group',await browser.evaluate("document.querySelectorAll('[data-settings]:not([hidden])').length===1"));
  for(const language of ['fr','',null,123]){
    const invalid=await browser.command(request(current,{name:'must not apply',language}));
    const unchanged=await browser.state();
    expect('invalid language patch is atomic: '+JSON.stringify(language),!invalid.ok&&invalid.error.code==='INVALID_LANGUAGE'&&unchanged.revision===current.revision&&unchanged.spaces[0].name==='Edited in actual UI'&&unchanged.language==='zh-CN');
  }
  await browser.evaluate("document.querySelector('#language').value='en';document.querySelector('#language').dispatchEvent(new Event('input'))");
  expect('language selection remains a draft until saved',await browser.evaluate("!document.querySelector('#save-language').disabled&&document.documentElement.lang==='zh-CN'")&&(await browser.state()).language==='zh-CN');
  await browser.evaluate("document.querySelector('#reset-language').click()");
  expect('cancel language restores saved choice without writing',await browser.evaluate("document.querySelector('#language').value==='zh-CN'&&document.querySelector('#save-language').disabled")&&(await browser.state()).revision===current.revision);
  await browser.evaluate("document.querySelector('#language').value='en';document.querySelector('#language').dispatchEvent(new Event('input'));document.querySelector('#language-form').requestSubmit()");
  current=await until(async()=>{const state=await browser.state();return state.language==='en'&&await browser.evaluate("document.documentElement.lang==='en'&&document.querySelector('#save-language').disabled")&&state;});
  expect('language form updates actual English headings labels and accessibility copy',await browser.evaluate("document.querySelector('#page-title').textContent==='Appearance'&&document.querySelector('#appearance-heading').textContent==='Choose your appearance'&&document.querySelector('#save-space').textContent==='Save changes'&&document.querySelector('.settings-sidebar').getAttribute('aria-label')==='Settings navigation'"));
  expect('language save preserves the independent appearance draft',current.edition==='pride'&&await browser.evaluate("document.querySelector('#edition').value==='standard'&&!document.querySelector('#save-edition').disabled"));
  // Explicit reload discards that intentionally unapplied theme draft before
  // external writes, so later tests exercise clean notifications, not stale UI.
  await browser.evaluate("document.querySelector('#refresh').click()");
  await until(()=>browser.evaluate("document.querySelector('#edition').value==='pride'&&document.querySelector('#save-edition').disabled"));
  expect('global search catalog exposes the system shortcut without claiming desktop registration in headless checks',current.shortcuts.some(item=>item.id==='global_search'&&item.global&&item.binding==='Alt+Command+N'&&item.status==='unsupported'));
  const invalidGlobal=await browser.command(request(current,{shortcuts:{global_search:{binding:'Alt+Command+N',priority:'website'}}}));
  expect('native settings reject misleading website priority for a system shortcut',!invalidGlobal.ok&&invalidGlobal.error.code==='INVALID_SHORTCUT'&&(await browser.state()).revision===current.revision);
  const originalShortcutRevision=current.revision;
  const override={toggle_sidebar:{binding:'Command+Shift+E',priority:'browser'}};
  result=await browser.command(request(current,{shortcuts:override}));
  expect('native shortcut patch persists a validated custom binding',result.ok&&result.value.shortcutOverrides.toggle_sidebar.binding==='Command+Shift+E'&&result.value.shortcuts.some(s=>s.id==='toggle_sidebar'&&s.binding==='Command+Shift+E'&&s.modified));current=result.value;
  for(const [id,binding,code]of [['new_space','Command+R','SHORTCUT_CONFLICT'],['new_space','Command+C','RESERVED_SHORTCUT'],['new_space','not-a-shortcut','INVALID_SHORTCUT'],['not_an_action','Command+Shift+E','INVALID_SHORTCUT']]){
    const invalid=await browser.command(request(current,{name:'must not apply',shortcuts:{...override,[id]:{binding,priority:'browser'}}}));
    const unchanged=await browser.state();
    expect('invalid shortcut patch is atomic: '+id+' '+binding,!invalid.ok&&invalid.error.code===code&&unchanged.revision===current.revision&&unchanged.spaces[0].name==='Edited in actual UI'&&unchanged.shortcutOverrides.toggle_sidebar.binding==='Command+Shift+E');
  }
  const stale=await browser.command({...request(current,{shortcuts:{}}),payload:{revision:originalShortcutRevision,changes:{shortcuts:{}}}});
  expect('stale shortcut patch cannot overwrite a newer binding',!stale.ok&&stale.error.code==='STALE_REVISION'&&(await browser.state()).revision===current.revision);
  await browser.evaluate("location.hash='shortcuts'");
  await until(()=>browser.evaluate("!document.querySelector('[data-settings=shortcuts]').hidden&&document.querySelector('[data-action=toggle_sidebar] .shortcut-modified')"));
  expect('shortcut settings show the custom native binding',await browser.evaluate("document.querySelector('#page-title').textContent==='Keyboard shortcuts'&&document.querySelector('[data-action=toggle_sidebar] .shortcut-key').textContent.includes('E')"));
  await browser.evaluate("document.querySelector('#shortcut-search').value='Command+Shift+E';document.querySelector('#shortcut-search').dispatchEvent(new Event('input'))");
  expect('shortcut search matches stored key combinations',await browser.evaluate("document.querySelectorAll('.shortcut-row').length===1&&document.querySelector('.shortcut-row').dataset.action==='toggle_sidebar'"));
  await browser.evaluate("document.querySelector('#shortcut-search').value='no-such-browser-action';document.querySelector('#shortcut-search').dispatchEvent(new Event('input'))");
  expect('shortcut search has a useful empty result state',await browser.evaluate("document.querySelectorAll('.shortcut-row').length===0&&document.querySelector('.shortcut-empty').textContent==='No matching actions'"));
  await browser.evaluate("document.querySelector('#shortcut-search').value='';document.querySelector('#shortcut-search').dispatchEvent(new Event('input'));document.querySelector('[data-action=toggle_sidebar] .shortcut-key').click()");
  await until(()=>browser.evaluate("document.querySelector('.shortcut-dialog')?.open"));
  await browser.evaluate("document.querySelector('.shortcut-dialog-actions button').click();document.querySelector('.shortcut-dialog-actions button:nth-child(2)').click()");
  await until(()=>browser.evaluate("!document.querySelector('.shortcut-dialog')"));
  expect('canceling a shortcut editor discards unassignment without a write',(await browser.state()).revision===current.revision&&(await browser.state()).shortcutOverrides.toggle_sidebar.binding==='Command+Shift+E');
  await browser.evaluate("document.querySelector('[data-action=toggle_sidebar] .shortcut-key').click();document.querySelector('[data-priority=website]').click();document.querySelector('.shortcut-dialog-actions button:last-child').click()");
  current=await until(async()=>{const state=await browser.state();return state.shortcutOverrides.toggle_sidebar?.priority==='website'&&await browser.evaluate("!document.querySelector('.shortcut-dialog')")&&state;});
  expect('shortcut editor saves website priority through the native validator',current.shortcutOverrides.toggle_sidebar.binding==='Command+Shift+E'&&current.shortcuts.some(s=>s.id==='toggle_sidebar'&&s.priority==='website'));
  await browser.evaluate("document.querySelector('.shortcut-toolbar button').click();document.querySelector('.shortcut-dialog-actions button:first-child').click()");
  expect('canceling reset-all preserves customized shortcuts',(await browser.state()).revision===current.revision);
  await browser.evaluate("document.querySelector('.shortcut-toolbar button').click();document.querySelector('.shortcut-dialog-actions button:last-child').click()");
  current=await until(async()=>{const state=await browser.state();return Object.keys(state.shortcutOverrides).length===0&&await browser.evaluate("!document.querySelector('.shortcut-dialog')")&&state;});
  expect('confirmed reset-all restores the catalog without changing other settings',current.shortcuts.some(s=>s.id==='toggle_sidebar'&&s.binding==='Command+S'&&!s.modified)&&current.language==='en'&&current.edition==='pride'&&current.spaces[0].name==='Edited in actual UI');
  result=await browser.command(request(current,{name:'外观',shortcuts:override}));current=result.value;
  await until(()=>browser.evaluate("document.querySelector('#name').value==='外观'"));
  expect('English UI leaves user Space names verbatim',current.spaces[0].name==='外观'&&await browser.evaluate("document.querySelector('#space option:checked').textContent.includes('外观')"));
  if(!sourcePreview){
    await browser.call('Page.navigate',{url:'chrome://tai/home.html'});
    if(current.welcomePending){
      const welcome=await findWelcomeDialog(browser);
      await browser.call('Runtime.evaluate',{
        expression:"document.querySelector('#continue').click()",userGesture:true,returnByValue:true,
      },welcome.sessionId);
      await until(async()=>!(await browser.call('Target.getTargets')).targetInfos.some(target=>target.targetId===welcome.targetId));
    }
    await until(()=>browser.evaluate("document.documentElement.lang==='en'&&document.querySelector('#home-space')?.textContent==='外观'"));
    expect('home uses the saved language while preserving the Space name',await browser.evaluate("document.querySelector('h1').textContent==='Room to think.'&&document.querySelector('#home-agent strong').textContent==='Bring my Agent'"));
    current=await browser.state();const locationBinding={...override,focus_location:{binding:'Alt+Command+L',priority:'browser'},downloads:{binding:'Command+Shift+J',priority:'browser'}};
    // Downloads has this alternate by default; use an unused combination.
    locationBinding.focus_location.binding='Ctrl+Command+L';
    const homeHintPatch=await browser.command(request(current,{shortcuts:locationBinding}));
    expect('home accepts a valid address-field shortcut override',homeHintPatch.ok);current=homeHintPatch.value;
    await until(()=>browser.evaluate("document.querySelector('#home-search-hint').textContent==='⌃ ⌘ L Search or enter a URL'"));
    expect('home shortcut hint reflects the actual native binding',await browser.evaluate("document.querySelector('#home-search-hint').textContent.startsWith('⌃ ⌘ L')"));
    current=(await browser.command(request(current,{shortcuts:override}))).value;

    await browser.call('Page.navigate',{url:'chrome://tai/panel.html'});
    await until(()=>browser.evaluate("document.documentElement.lang==='en'&&document.querySelector('.agent-create')?.textContent==='Authorize browser tools'"));
    expect('Agent panel uses the saved English copy and untranslated Space name',await browser.evaluate("document.querySelector('.scope-label span').textContent==='Working Space'&&document.querySelector('#panel-space option:checked').textContent==='外观'&&document.querySelector('[data-provider=other]').textContent==='Other MCP'"));
    await browser.call('Page.navigate',{url:'chrome://tai/#appearance'});
    await until(()=>browser.evaluate("document.documentElement.lang==='en'&&!!document.querySelector('#space-form')&&!document.querySelector('#name').disabled"));
  }
  current=await browser.state();
  result=await browser.command(request(current,{name:'Edited in actual UI'}));
  expect('returning to settings uses its current revision before another change',result.ok);current=result.value;
  await until(()=>browser.evaluate("document.querySelector('#name').value==='Edited in actual UI'"));

  await until(async()=>{const data=JSON.parse(await readFile(join(profile,'Default/SidebarWorkspace.json'),'utf8'));return data.edition==='pride'&&data.language==='en'&&data.shortcuts?.toggle_sidebar?.binding==='Command+Shift+E'&&data.spaces.some(s=>s.name==='Edited in actual UI');});
  const shot=await browser.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  await writeFile(join(local,'tai-settings-native.png'),Buffer.from(shot.data,'base64'));
  await browser.stop();browser=await start(profile);
  const restored=await until(async()=>{const s=await browser.state();return s.ready&&s;});
  expect('real restart preserves Profile identity and Space appearance',restored.profileId===first.profileId&&restored.spaces[0].name==='Edited in actual UI'&&restored.spaces[0].color==='#D8D4EE'&&restored.edition==='pride');
  expect('real restart retains the chosen emoji',restored.spaces[0].icon==='🚀');
  await until(()=>browser.evaluate("document.documentElement.lang==='en'&&document.querySelector('#language').value==='en'"));
  expect('real restart retains interface language and renders English settings',restored.language==='en'&&await browser.evaluate("document.querySelector('#save-space').textContent==='Save changes'"));
  expect('real restart retains custom native shortcut and priority',restored.shortcutOverrides.toggle_sidebar?.binding==='Command+Shift+E'&&restored.shortcutOverrides.toggle_sidebar?.priority==='browser');
  expect('restart invalidates old request revision',restored.revision!==current.revision);
  await browser.stop();browser=null;
  const other=await mkdtemp(join(local,'browser-profiles/tai-ui-smoke-other-'));browser=await start(other);
  const isolated=await until(async()=>{const s=await browser.state();return s.ready&&s;});
  expect('separate real Profile creates a different native identity',isolated.profileId!==first.profileId&&isolated.edition==='standard');
  expect('separate Profile does not inherit custom shortcuts',Object.keys(isolated.shortcutOverrides).length===0&&isolated.shortcuts.some(s=>s.id==='toggle_sidebar'&&s.binding==='Command+S'));
  result=await browser.command(request(isolated,{name:'cross-profile'},{profileId:first.profileId}));expect('other Profile rejects first Profile identity',!result.ok&&result.error.code==='PROFILE_MISMATCH');
  await browser.stop();browser=null;
  const corrupt=await mkdtemp(join(local,'browser-profiles/tai-ui-smoke-corrupt-'));await mkdir(join(corrupt,'Default'));const bad='{malformed organization';await writeFile(join(corrupt,'Default/SidebarWorkspace.json'),bad);
  browser=await start(corrupt);const protectedState=await until(async()=>{const s=await browser.state();return s.ready&&s;});
  expect('malformed organization opens read-only',protectedState.readOnly===true);
  result=await browser.command(request(protectedState,{name:'must not overwrite'}));expect('read-only state refuses native writes',!result.ok&&result.error.code==='READ_ONLY');
  await browser.stop();browser=null;expect('malformed original remains byte-identical',await readFile(join(corrupt,'Default/SidebarWorkspace.json'),'utf8')===bad);
  const activeProfile=await mkdtemp(join(local,'browser-profiles/tai-ui-active-space-'));await mkdir(join(activeProfile,'Default'));
  await writeFile(join(activeProfile,'Default/SidebarWorkspace.json'),JSON.stringify({version:1,active:'working',spaces:[{id:'personal',name:'Personal'},{id:'working',name:'Working'}],items:[]}));
  browser=await start(activeProfile);await until(()=>browser.evaluate("document.querySelector('#space').value==='working'&&document.querySelector('#host-space').value==='working'"));
  expect('settings and Agent setup default to actual window Space rather than first entry',true);
  const legacyState=await browser.state();expect('legacy file receives distinct default icons',legacyState.spaces[0].icon&&legacyState.spaces[1].icon&&legacyState.spaces[0].icon!==legacyState.spaces[1].icon);
  await browser.stop();browser=null;
  const disabled=await mkdtemp(join(local,'browser-profiles/tai-ui-smoke-disabled-'));browser=await start(disabled,false);
  await until(()=>browser.evaluate("document.readyState==='complete'"));
  expect('TAi privileged WebUI is disabled outside product mode',await browser.evaluate("!document.querySelector('#space-form')"));
  await browser.stop();browser=null;
}catch(error){checks.push({check:'probe completion',passed:false,error:String(error)});process.exitCode=1;}
finally{await browser?.stop();const receipt={passed:checks.every(c=>c.passed),checks,profile,finishedAt:new Date().toISOString(),scope:'real native WebUI, scoped setting/language/shortcut validation, actual DOM form interactions, restart persistence, fresh Profile and corrupt-data protection; DOM interactions do not claim native keyboard dispatch or Agent/page-execution validation'};await writeFile(join(local,'tai-ui-smoke.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));}
