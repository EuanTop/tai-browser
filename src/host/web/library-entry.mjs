// First-party composition of the shared library. Document HTML only reaches
// the inert extractor or the opaque reader surface, never this WebUI DOM.
import {sendWithPromise,addWebUiListener} from 'chrome://resources/js/cr.js';
import {createNativeLibrary} from '../../../modules/library/native.mjs';
import {hostCommand,createSurfaceHost} from '../../chromium/webui/host-panel.js';
const $=id=>document.getElementById(id);
let workspace,context,host,library,surface,scope,pages=[],epoch=0,busy=false,closed=false,listSequence=0,targetSequence=0,resumeSequence=0,readingRow;
const messages={LIBRARY_LIMIT:'最多保存 8 个资料库授权，请先断开或忘记不再使用的授权。',INVALID_CLIP_STATE:'标题不能为空且不超过 300 个字符；标签最多 32 个，每个不超过 80 个字符。',INVALID_LIBRARY_LOCATION:'请选择专用资料文件夹，不能将浏览器账号目录或其父目录作为资料库。',CANCELED:'已取消选择。',STALE_PAGE:'网页已发生变化，请刷新网页列表后重新保存。',PAGE_NOT_OWNED:'页面已移出这个 Space，请刷新网页列表。',NO_SELECTION:'没有可保存的选区，请先在网页中选择文字。',LIBRARY_NOT_FOUND:'资料库已断开，请重新选择文件夹。',OPERATION_OBSOLETE:'保存结果尚未确认，请重新打开资料库核查，避免重复保存。'};
function status(text,error=false){$('library-status').textContent=text;$('library-status').dataset.error=String(error);}
function report(error){if(!closed)status(messages[error.code||error.message]||`未完成：${error.message}`,true);}
function run(fn){void fn().catch(report);}
function controls(){const enabled=!!library&&!busy&&!closed;$('save-clip').disabled=!enabled||!$('capture-page').value;$('clip-search').disabled=!enabled;$('clip-state').disabled=!enabled;$('refresh-clips').disabled=!enabled;$('library').disabled=busy||!host?.libraries.length;$('choose-library').disabled=busy||host?.libraryCatalogReadOnly;$('disconnect-library').disabled=!enabled;$('disconnect-library').hidden=!library;$('library').closest('label').hidden=!host?.libraries.length;for(const button of document.querySelectorAll('#clip-list button,#metadata-form button'))button.disabled=!enabled;for(const button of document.querySelectorAll('#unavailable-libraries button'))button.disabled=busy||host?.libraryCatalogReadOnly;}
async function targets(){
  const ticket=++targetSequence;
  const requested=new URLSearchParams(location.search).get('page');
  const previous=$('capture-page').value||requested;
  const next=await sendWithPromise('taiGetCaptureTargets');
  if(closed||ticket!==targetSequence)return;
  pages=next;
  $('capture-page').replaceChildren(...pages.map(page=>new Option(`${page.title||new URL(page.url).hostname} · ${new URL(page.url).hostname}`,page.pageId)));
  if(!pages.length)$('capture-page').append(new Option('当前没有可剪藏的网页',''));
  const selected=pages.find(page=>page.pageId===previous)||pages.find(page=>page.active);
  if(selected)$('capture-page').value=selected.pageId;
  $('capture-page').disabled=!pages.length||busy;controls();
}
async function list(){
  if(!library)return;const current=epoch,ticket=++listSequence;
  const rows=await library.commands.search($('clip-search').value,{state:$('clip-state').value});
  if(current!==epoch||closed||ticket!==listSequence)return;
  $('clip-count').textContent=`${rows.length} 条`;
  $('library-empty').hidden=rows.length>0;
  const empty={all:'这里暂时没有剪藏。可以保存新网页，或查看回收站。',saved:'待整理列表已清空。归档内容仍可继续阅读。',archived:'还没有归档的剪藏。',trash:'回收站为空。'};
  $('library-empty').textContent=$('clip-search').value?'没有找到匹配的剪藏。':empty[$('clip-state').value];
  $('clip-list').replaceChildren(...rows.map(row=>{
    const item=document.createElement('li'),button=document.createElement('button'),title=document.createElement('strong'),detail=document.createElement('small');
    button.type='button';title.textContent=row.title;detail.textContent=[new URL(row.source.url).hostname,new Date(row.source.capturedAt).toLocaleDateString(),...row.tags].join(' · ');
    button.append(title,detail);button.onclick=()=>run(()=>read(row));button.className='clip-open';
    const actions=document.createElement('div');actions.className='clip-actions';
    function action(label,state){const control=document.createElement('button');control.type='button';control.textContent=label;control.onclick=()=>run(()=>update(row,{state}));actions.append(control);}
    if(row.state==='trash')action('恢复','saved');
    else {action(row.state==='archived'?'取消归档':'归档',row.state==='archived'?'saved':'archived');action('移至回收站','trash');}
    item.append(button,actions);
    if(row.stateConflict){const warning=document.createElement('p');warning.textContent='同步后存在不同整理记录。正文已保留；选择归档、恢复或编辑标题可确认当前状态。';warning.className='state-conflict';item.append(warning);}
    return item;
  }));
  controls();
}
async function update(row,changes){
  if(!library||busy)return;busy=true;controls();const instance=library,current=epoch;
  try{
    const result=await instance.commands.update(row.id,changes,{revision:row.revision,variant:row.variant,expectedHeads:row.heads});
    if(closed||current!==epoch)return;
    if(readingRow?.id===row.id){
      if(changes.state==='trash'){readingRow=undefined;$('reading-section').hidden=true;await surface?.dispose();surface=createSurfaceHost($('library-reader'),scope);}
      else {readingRow={...readingRow,title:result.title,tags:result.tags,state:result.state,heads:result.heads,stateConflict:result.conflicted};$('reading-title').textContent=result.title;$('metadata-title').value=result.title;$('metadata-tags').value=result.tags.join(', ');}
    }
    await list();status(result.conflicted?'整理记录已保存，但同步中出现另一份修改。正文保留在列表中，请确认当前状态。':changes.state==='trash'?'已移至回收站，正文文件保留，可随时恢复。':changes.state==='saved'?'已恢复到待整理列表，可在全部剪藏中继续阅读。':changes.state==='archived'?'已归档，正文仍可继续阅读。':'整理已保存在本地。',result.conflicted);
  }catch(error){if(error.message==='CLIP_STATE_CONFLICT'){await list();throw new Error('其他窗口或同步已修改整理记录，请刷新后重试。');}throw error;}
  finally{busy=false;controls();}
}
async function read(row){
  const current=epoch,instance=library;
  const intent=await instance.readerIntent(row.id,{revision:row.revision,variant:row.variant});
  if(closed||current!==epoch||instance!==library)return;
  const preview=await surface.preview(intent);
  if(closed||current!==epoch){await preview.dispose();return;}
  await surface.apply(preview);readingRow=row;$('metadata-title').value=row.title;$('metadata-tags').value=row.tags.join(', ');$('reading-title').textContent=row.title;$('reading-source').textContent=`来源：${row.source.url} · 保存于 ${new Date(row.source.capturedAt).toLocaleString()}`;
  $('reading-section').hidden=false;$('reading-section').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
async function openLibrary(){
  const current=++epoch;library?.dispose();library=undefined;await surface?.dispose();surface=undefined;
  readingRow=undefined;$('reading-section').hidden=true;$('clip-list').replaceChildren();$('clip-count').textContent='';controls();
  const id=$('library').value;
  if(!id){status(host.libraryCatalogReadOnly?'资料库授权记录无法读取，原文件已保留。':'选择一个文件夹，开始保存与离线阅读。',host.libraryCatalogReadOnly);return;}
  const binding={profileId:workspace.profileId,spaceId:context.activeSpaceId};scope=binding;
  const created=await createNativeLibrary({libraryId:id,binding,libraries:host.libraries,commands:['library.read','library.list','library.putIfAbsent'],hostCommand});
  if(closed||current!==epoch){created.dispose();return;}
  library=created;surface=createSurfaceHost($('library-reader'),binding);
  await list();controls();
  const warnings=created.initialization.warnings.length;
  status(warnings?`资料库已打开；${warnings} 条损坏记录已跳过，原文件保留。`:'资料库已打开。正文保存在本地，关闭原网页仍可阅读。',!!warnings);
}
async function refresh(){
  [workspace,context,host]=await Promise.all([sendWithPromise('taiGetState'),sendWithPromise('taiGetPanelState'),sendWithPromise('taiGetHostState')]);
  if(!workspace.ready||!host.ready){setTimeout(()=>!closed&&run(refresh),100);return;}
  document.documentElement.dataset.edition=workspace.edition;
  const previous=$('library').value;
  $('library').replaceChildren(...host.libraries.map((entry,index)=>new Option(entry.name||`本地资料库 ${index+1}`,entry.id)));
  if(host.libraries.some(entry=>entry.id===previous))$('library').value=previous;
  $('unavailable-section').hidden=!host.unavailableLibraries?.length;
  $('unavailable-libraries').replaceChildren(...(host.unavailableLibraries||[]).map(entry=>{
    const row=document.createElement('li'),name=document.createElement('span'),button=document.createElement('button');name.textContent=entry.name;button.type='button';button.textContent='忘记此授权';button.onclick=()=>run(async()=>{if(busy)return;busy=true;controls();try{await hostCommand({profileId:workspace.profileId,spaceId:context.activeSpaceId},'library.revoke',{libraryId:entry.id});await refresh();status('已忘记这个未连接的资料库授权，文件保持原样。');}finally{busy=false;controls();}});row.append(name,button);return row;
  }));
  await targets();await openLibrary();
}
$('choose-library').onclick=()=>run(async()=>{const grant=await sendWithPromise('taiPickLibrary');if(!grant.ok)throw new Error(grant.error.code);await refresh();$('library').value=grant.value.libraryId;await openLibrary();});
$('library').onchange=()=>run(openLibrary);
$('disconnect-library').onclick=()=>run(async()=>{if(!library)return;await hostCommand(scope,'library.revoke',{libraryId:$('library').value});await refresh();status('资料库授权已断开，文件保持原样。');});
$('refresh-pages').onclick=()=>run(targets);$('capture-page').onchange=controls;
$('clip-search').oninput=()=>run(list);
$('clip-state').onchange=()=>run(list);
$('refresh-clips').onclick=()=>run(async()=>{if(!library||busy)return;busy=true;controls();try{await library.commands.refresh();await list();status('已重新读取本地资料与同步记录。');}finally{busy=false;controls();}});
$('metadata-form').onsubmit=event=>{event.preventDefault();if(readingRow)run(()=>update(readingRow,{title:$('metadata-title').value.trim(),tags:$('metadata-tags').value.split(/[,，]/u).map(t=>t.trim()).filter(Boolean)}));};
$('close-reading').onclick=()=>run(async()=>{readingRow=undefined;await surface?.cancel();await surface?.dispose();surface=createSurfaceHost($('library-reader'),scope);$('reading-section').hidden=true;});
$('capture-form').onsubmit=event=>{event.preventDefault();run(async()=>{
  const page=pages.find(item=>item.pageId===$('capture-page').value),instance=library,current=epoch;
  if(!page||!instance||busy)return;
  if(page.profileId!==scope.profileId||page.spaceId!==scope.spaceId)throw new Error('SCOPE_MISMATCH');
  const mode=$('capture-mode').value,title=$('capture-name').value.trim(),tags=$('capture-tags').value.split(/[,，]/u).map(t=>t.trim()).filter(Boolean);
  busy=true;controls();
  try{
    const snapshot=await hostCommand({profileId:page.profileId,spaceId:page.spaceId,pageId:page.pageId,pageRevision:page.pageRevision},'page.read',{format:'snapshot'});
    if(current!==epoch||closed)throw new Error('OPERATION_OBSOLETE');
    if(mode==='selection'){if(!snapshot.selectionHtml?.trim())throw new Error('NO_SELECTION');}
    else delete snapshot.selectionHtml;
    if(title)snapshot.title=title;
    await instance.commands.capture(snapshot,{tags});
    await list();status('本地已保存。原网页和收藏保持原样。');
  }finally{busy=false;controls();}
});};
addWebUiListener('tai-state-changed',next=>{if(next.ready)document.documentElement.dataset.edition=next.edition;});
async function resume(){
  if(closed||busy||!workspace||document.visibilityState==='hidden')return;
  const ticket=++resumeSequence,next=await sendWithPromise('taiGetPanelState');
  if(closed||ticket!==resumeSequence||busy)return;
  if(next.activeSpaceId!==context.activeSpaceId){context=next;await openLibrary();}
  await targets();
}
document.addEventListener('visibilitychange',()=>run(resume));
addEventListener('focus',()=>run(resume));
addEventListener('pagehide',()=>{closed=true;++epoch;library?.dispose();void surface?.dispose();},{once:true});
run(refresh);
