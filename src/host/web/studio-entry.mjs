// The persistent version authority lives in the native registry. Reuse Studio's
// package validation and the existing isolated surface lifecycle for rendering.
import {sendWithPromise,addWebUiListener} from 'chrome://resources/js/cr.js';
import {validateNativePayload,prepareNativePackage} from '../../../modules/studio/package.mjs';
import {hostCommand,createSurfaceHost} from '../../chromium/webui/host-panel.js';
const $=id=>document.getElementById(id);
let state,scope,surface,pending,busy=false,closed=false,generation=0,currentApp,refreshWanted=false;
const errors={STATE_CONFLICT:'旧版本的数据已变化，请重新预览后应用。',STALE_REVISION:'其他窗口已修改这个轻应用，已刷新列表。',QUOTA_EXCEEDED:'轻应用与保留版本超过本机组件存储上限，当前版本未被替换。',READ_ONLY:'本机组件数据无法读取，原文件已保留。',NATIVE_PACKAGE_QUOTA:'轻应用包过大，请让 Agent 缩小后再试。',PREVIEW_FAILED:'轻应用未能启动，正在使用的版本会保留。',PACKAGE_COMPILER_UNAVAILABLE:'这个包包含需要编译的源文件。请让原 Agent 导出可直接运行的 .tai.json 包。'};
function revealSurface(){const section=$('app-surface-section');section.hidden=false;section.scrollIntoView({block:'start'});}
function status(message,error=false){$('studio-status').textContent=message;$('studio-status').dataset.error=String(error);}
function controls(){const ready=!!scope&&!busy&&!closed;$('app-file').disabled=!ready;$('studio-space').disabled=!ready;$('app-apply').disabled=!ready||!pending;$('app-cancel').disabled=!ready||!pending;$('apps-refresh').disabled=!ready;for(const button of document.querySelectorAll('#installed-apps button,#pending-apps button'))button.disabled=!ready;}
function run(fn){void(async()=>{if(busy||closed)return;busy=true;controls();try{await fn();}catch(error){if(['STATE_CONFLICT','STALE_REVISION'].includes(error.message)){pending=undefined;await list().catch(()=>{});}status(errors[error.message]||`未完成：${error.message}`,true);}finally{busy=false;controls();if(refreshWanted){refreshWanted=false;queueMicrotask(()=>run(list));}}})();}
async function list(){
  if(!scope)return;
  const [entries,candidates]=await Promise.all([hostCommand(scope,'modules.list'),hostCommand(scope,'modules.pending')]);
  $('agent-previews').hidden=!candidates.length;
  $('pending-apps').replaceChildren(...candidates.map(candidate=>{const row=document.createElement('li'),title=document.createElement('strong'),button=document.createElement('button'),discard=document.createElement('button');title.textContent=candidate.payload.manifest.title+' · '+candidate.payload.manifest.version;button.textContent='预览';discard.textContent='丢弃';button.onclick=()=>run(async()=>{await surface.cancel();pending=await surface.preview(validateNativePayload(candidate.payload));$('app-package-name').textContent=title.textContent;revealSurface();status('Agent 的预览已打开。应用前不会改变当前版本和数据。');});discard.onclick=()=>run(async()=>{await hostCommand(scope,'modules.dispose',{handle:candidate.previewId});await list();status('已丢弃这个候选预览。');});row.append(title,button,discard);return row;}));
  $('no-apps').hidden=entries.length>0;
  $('installed-apps').replaceChildren(...entries.map(entry=>{
    const current=entry.versions?.find(version=>version.id===entry.currentVersion),manifest=current?.payload?.manifest;
    if(!manifest)return document.createElement('li');
    const row=document.createElement('li'),title=document.createElement('strong'),detail=document.createElement('p'),actions=document.createElement('div');
    title.textContent=manifest.title;detail.className='app-version';detail.textContent=`${manifest.version} · ${entry.enabled?'已启用':'已停用'} · ${entry.versions.length} 个保留版本`;actions.className='app-actions';
    function action(label,fn){const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>run(fn);actions.append(button);}
    action(entry.enabled?'打开':'重新启用',async()=>{await surface.cancel();pending=undefined;const session=await surface.preview(validateNativePayload(current.payload));await surface.apply(session);currentApp=entry.componentId;$('app-package-name').textContent=manifest.title+' · '+manifest.version;revealSurface();await list();status('轻应用已打开。');});
    if(entry.enabled)action('停用',async()=>{await hostCommand(scope,'modules.disable',{componentId:entry.componentId,expectedRevision:entry.revision});if(currentApp===entry.componentId){await resetSurface();$('app-surface-section').hidden=true;}await list();status('轻应用已停用，代码版本与用户数据保留。');});
    for(const version of entry.versions.filter(version=>version.id!==entry.currentVersion))action('回滚到 '+version.payload.manifest.version,async()=>{await surface.cancel();pending=undefined;await hostCommand(scope,'modules.rollback',{componentId:entry.componentId,expectedRevision:entry.revision,versionId:version.id});const session=await surface.preview(validateNativePayload(version.payload));await surface.apply(session);currentApp=entry.componentId;$('app-package-name').textContent=version.payload.manifest.title+' · '+version.payload.manifest.version;revealSurface();await list();status('已恢复这个代码版本，用户数据保留。');});
    row.append(title,detail,actions);return row;
  }));
}
async function resetSurface(){++generation;pending=undefined;await surface?.dispose();surface=createSurfaceHost($('app-surface'),scope);currentApp=undefined;}
async function initialize(){
  const [next,context,host]=await Promise.all([sendWithPromise('taiGetState'),sendWithPromise('taiGetPanelState'),sendWithPromise('taiGetHostState')]);
  if(!next.ready||!host.ready){setTimeout(()=>!closed&&void initialize().catch(error=>status(error.message,true)),100);return;}
  state=next;document.documentElement.dataset.edition=next.edition;
  $('studio-space').replaceChildren(...next.spaces.map(space=>new Option(space.name,space.id)));
  const preferred=new URLSearchParams(location.search).get('space')||context.activeSpaceId;if(next.spaces.some(s=>s.id===preferred))$('studio-space').value=preferred;
  scope={profileId:next.profileId,spaceId:$('studio-space').value};await resetSurface();await list();controls();status('准备好了。已应用的轻应用与版本保存在本机。');
}
$('studio-space').onchange=()=>run(async()=>{scope={profileId:state.profileId,spaceId:$('studio-space').value};await resetSurface();$('app-surface-section').hidden=true;await list();status('已切换轻应用的 Space。');});
$('app-file').onchange=()=>run(async()=>{
  const file=$('app-file').files[0];$('app-file').value='';if(!file)return;if(file.size>2*1024*1024)throw new Error('NATIVE_PACKAGE_QUOTA');
  const input=JSON.parse(await file.text());
  const payload=input.kind==='custom'?validateNativePayload(input):await prepareNativePackage(input);
  const epoch=generation;await surface.cancel();pending=undefined;const session=await surface.preview(payload);
  if(closed||epoch!==generation){await session.dispose();return;}
  pending=session;$('app-package-name').textContent=payload.manifest.title+' · '+payload.manifest.version;revealSurface();
  status('预览已就绪。检查后选择应用；当前版本及其数据尚未改变。');$('app-file').value='';
});
$('app-apply').onclick=()=>run(async()=>{const session=pending;if(!session)return;await surface.apply(session);currentApp=session.grant.componentId;pending=undefined;await list();status('已应用并保存在本机，重启后可从轻应用列表重新打开。');});
$('app-cancel').onclick=()=>run(async()=>{await surface.cancel();pending=undefined;$('app-package-name').textContent='';if(!currentApp)$('app-surface-section').hidden=true;status('已取消预览，原版本与数据保持原样。');});
$('apps-refresh').onclick=()=>run(list);
addWebUiListener('tai-modules-changed',()=>{if(busy)refreshWanted=true;else run(list);});
addWebUiListener('tai-state-changed',next=>{if(next.ready)document.documentElement.dataset.edition=next.edition;});
addEventListener('pagehide',()=>{closed=true;++generation;void surface?.dispose();},{once:true});
void initialize().catch(error=>status(error.message,true));
