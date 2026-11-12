// Copyright 2026 TAi Browser contributors. SPDX-License-Identifier: BSD-3-Clause
import {sendWithPromise,addWebUiListener} from 'chrome://resources/js/cr.js';
import {currentLanguage} from './i18n.js';
const root=document.querySelector('#shortcuts-root');
const tr=(zh,en)=>currentLanguage()==='en'?en:zh;
let state,editing,busy=false,recording=false,session=0,timer,pendingKey,filter='';
const labels={
  INVALID_SHORTCUT:['这个组合无法使用。请包含 ⌘、⌃ 或 ⌥。','Use a combination with ⌘, ⌃ or ⌥.'],
  SHORTCUT_CONFLICT:['这个组合已被其他操作使用。先修改该操作，或换一个组合。','This shortcut is already in use. Change the other action or choose another combination.'],
  RESERVED_SHORTCUT:['这个组合由系统或文字编辑保留。','This shortcut is reserved for the system or text editing.'],
  STALE_REVISION:['设置已在其他窗口更新。请取消后重试。','Settings changed in another window. Cancel and try again.'],
  READ_ONLY:['当前组织数据为只读，暂时无法保存。','Workspace data is read only. Changes cannot be saved.']
};
function element(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;}
function button(label,fn,cls='button-quiet'){const b=element('button',cls,label);b.type='button';b.onclick=fn;return b;}
function display(key){return key?key.split('+').map(k=>({Command:'⌘',Ctrl:'⌃',Alt:'⌥',Shift:'⇧',Comma:',',Period:'.',Left:'←',Right:'→',Up:'↑',Down:'↓',BracketLeft:'[',BracketRight:']',Equal:'=',Minus:'−',Space:'Space'}[k]||k)).join(' '):tr('未设置','Unassigned');}
function notice(text,error=false){const n=root.querySelector('.shortcut-status');if(n){n.textContent=text;n.dataset.error=String(error);}}
async function load(){try{const next=await sendWithPromise('taiGetState');if(!next.ready){setTimeout(load,150);return;}state=next;render();}catch{root.textContent=tr('无法加载快捷键，请重新打开设置。','Could not load shortcuts. Reopen settings.');}}
function render(){
  const focused=document.activeElement?.id;root.replaceChildren();
  const toolbar=element('div','shortcut-toolbar');
  const search=element('input');search.type='search';search.id='shortcut-search';search.placeholder=tr('搜索操作或快捷键','Search actions or shortcuts');search.setAttribute('aria-label',search.placeholder);search.value=filter;search.oninput=()=>{filter=search.value;renderRows();};toolbar.append(search,button(tr('恢复全部默认','Reset all'),resetAll));root.append(toolbar);
  const status=element('p','shortcut-status');status.setAttribute('role','status');root.append(status,element('div','shortcut-list'));
  const footer=element('p','shortcut-footnote',tr('按账号环境保存。系统与文字编辑快捷键保持原样。','Saved in this Profile. System and text editing shortcuts are preserved.'));root.append(footer);
  renderRows();if(focused==='shortcut-search')search.focus();
}
function globalHint(status){return ({registered:tr('系统快捷键已启用','System shortcut enabled'),conflict:tr('已被其他应用占用，请更换组合','Used by another app. Choose another shortcut.'),unsupported:tr('此环境暂不支持系统快捷键','System shortcuts are unavailable here.'),unassigned:tr('未启用系统快捷键','System shortcut is off'),invalid:tr('组合无效，请重新设置','Invalid shortcut. Choose another combination.')}[status]||tr('TAi 在后台时也可唤起','Available while TAi is in the background'));}
function renderRows(){
  const list=root.querySelector('.shortcut-list');if(!state||!list)return;list.replaceChildren();
  const q=filter.trim().toLowerCase();let group;
  for(const item of [...(state.shortcuts||[])].sort((a,b)=>a.group.localeCompare(b.group))){
    const label=currentLanguage()==='en'?item.labelEn:item.labelZh;
    if(q&&![label,item.binding,display(item.binding)].join(' ').toLowerCase().includes(q))continue;
    if(item.group!==group){group=item.group;list.append(element('h2','shortcut-group',groupLabel(group)));}
    const row=element('div','shortcut-row');row.dataset.action=item.id;
    const title=element('div','shortcut-action',label||item.label);if(item.modified)title.append(element('span','shortcut-modified',tr('已自定义','Customized')));
    if(item.global)title.append(element('span','shortcut-global-hint',globalHint(item.status)));
    const key=button(display(item.binding),()=>openEditor(item),'shortcut-key');key.disabled=state.readOnly;key.setAttribute('aria-label',(label||item.label)+' · '+display(item.binding));if(item.aliases?.length)key.title=item.aliases.map(display).join(' · ');
    row.append(title,key);if(item.modified){const reset=button('↶',()=>save({...state.shortcutOverrides,[item.id]:undefined}), 'shortcut-reset');reset.title=tr('恢复此项默认','Reset this shortcut');reset.setAttribute('aria-label',reset.title);reset.disabled=state.readOnly;row.append(reset);}list.append(row);
  }
  if(!list.childNodes.length)list.append(element('p','shortcut-empty',tr('没有匹配的操作','No matching actions')));
  root.querySelector('.shortcut-toolbar button').disabled=state.readOnly||!Object.keys(state.shortcutOverrides||{}).length;
}
function groupLabel(g){const groups={browser:['浏览器','Browser'],navigation:['浏览','Navigation'],tabs:['标签','Tabs'],spaces:['Space','Spaces'],tools:['工具','Tools'],window:['窗口','Window'],organization:['组织','Organization']};return groups[g]?tr(...groups[g]):g;}
async function save(overrides,expectedRevision=state.revision){
  if(busy||state.readOnly)return false;busy=true;let success=false;
  // Omitted override means restore the catalog's default, not an empty binding.
  overrides=Object.fromEntries(Object.entries(overrides).filter(([,value])=>value!==undefined));
  const request={protocol:'tai.v1',id:crypto.randomUUID(),command:'settings.patch',scope:{profileId:state.profileId,spaceId:state.spaces[0]?.id},payload:{revision:expectedRevision,changes:{shortcuts:overrides}}};
  try{const response=await sendWithPromise('taiCommand',request);if(response.id!==request.id)throw new Error();if(!response.ok){const message=labels[response.error?.code];const text=message?tr(...message):tr('无法保存，请检查组合后重试。','Could not save. Check the combination and try again.');if(editing)editing.status.textContent=text;else notice(text,true);return false;}state=response.value;success=true;render();notice(tr('快捷键已更新','Shortcut updated'));return true;}
  catch{const text=tr('连接中断，请重试。','Connection interrupted. Try again.');if(editing)editing.status.textContent=text;else notice(text,true);return false;}
  finally{busy=false;if(editing)editing.save.disabled=false;}
}
async function stopCapture(){session++;recording=false;clearTimeout(timer);try{await sendWithPromise('taiSetShortcutCapture',false);}catch{}if(editing)editing.record.textContent=tr('录入组合','Record shortcut');}
async function startCapture(){
  if(recording||busy)return;const generation=++session;
  try{const ok=await sendWithPromise('taiSetShortcutCapture',true);if(generation!==session)return;if(!ok)throw new Error();recording=true;editing.record.textContent=tr('按下快捷键…','Press a shortcut…');editing.status.textContent=tr('Esc 取消录入','Esc cancels recording');editing.record.focus();timer=setTimeout(()=>{void stopCapture();if(editing)editing.status.textContent=tr('录入已结束，请重试。','Recording ended. Try again.');},25000);}
  catch{if(editing)editing.status.textContent=tr('暂时无法录入，请重试。','Could not start recording. Try again.');}
}
async function closeEditor(){if(busy)return;const previous=editing;await stopCapture();if(editing&&editing===previous){const id=editing.item?.id;editing.dialog.close();editing.dialog.remove();editing=undefined;root.querySelector(`[data-action="${id}"] .shortcut-key`)?.focus();}}
function openEditor(item){
  if(editing)return;const dialog=element('dialog','shortcut-dialog');const heading=element('h2',null,currentLanguage()==='en'?item.labelEn:item.labelZh);heading.id='shortcut-editor-title';dialog.setAttribute('aria-labelledby',heading.id);
  pendingKey=item.binding;const value=element('div','shortcut-capture-value',display(pendingKey));value.setAttribute('aria-live','polite');const record=button(tr('录入组合','Record shortcut'),()=>void startCapture());
  const capture=element('div','shortcut-capture');capture.append(value,record);
  let priorityValue=item.priority||'browser';const priority=element('div','shortcut-priority-options');priority.setAttribute('role','group');priority.setAttribute('aria-label',tr('冲突时','Shortcut priority'));
  for(const [value,zh,en]of [['browser','浏览器优先','Browser first'],['website','网站优先','Website first']]){const choice=button(tr(zh,en),()=>{priorityValue=value;for(const item of priority.children)item.setAttribute('aria-pressed',String(item.dataset.priority===value));});choice.dataset.priority=value;choice.setAttribute('aria-pressed',String(value===priorityValue));priority.append(choice);}
  const priorityLabel=element('div','shortcut-priority');priorityLabel.hidden=Boolean(item.global);priorityLabel.append(element('span',null,tr('冲突时','When a website uses the same keys')),priority);
  const status=element('p','shortcut-editor-status');status.setAttribute('role','status');
  const controls=element('div','shortcut-dialog-actions');const clear=button(tr('取消绑定','Unassign'),()=>{if(busy)return;pendingKey='';value.textContent=display('');void stopCapture();});const cancel=button(tr('取消','Cancel'),()=>void closeEditor());const saveButton=button(tr('保存','Save'),async()=>{const editor=editing;if(!editor||busy)return;const key=pendingKey;await stopCapture();if(editing!==editor)return;editor.save.disabled=true;const ok=await save({...state.shortcutOverrides,[item.id]:{binding:key,priority:priorityValue}},editor.revision);if(ok&&editing===editor)void closeEditor();},'');controls.append(clear,cancel,saveButton);
  if(item.global)dialog.append(element('p','shortcut-global-note',tr('TAi 保持运行并保留一个窗口时，可从其他应用唤起。组合不能被其他应用占用。','Works from other apps while TAi is running with a window open. Another app cannot use the same combination.')));dialog.append(heading,capture,priorityLabel,status,controls);document.body.append(dialog);editing={dialog,item,record,status,save:saveButton,revision:state.revision,value};dialog.addEventListener('cancel',event=>{event.preventDefault();void closeEditor();});dialog.showModal();record.focus();
}
async function resetAll(){
  if(editing)return;const revision=state.revision;const dialog=element('dialog','shortcut-dialog');const h=element('h2',null,tr('恢复默认快捷键？','Reset all shortcuts?'));h.id='shortcut-reset-title';dialog.setAttribute('aria-labelledby',h.id);const actions=element('div','shortcut-dialog-actions');const cancel=button(tr('取消','Cancel'),()=>{dialog.close();dialog.remove();});const confirm=button(tr('恢复默认','Reset'),async()=>{confirm.disabled=true;if(await save({},revision)){dialog.close();dialog.remove();}else confirm.disabled=false;},'');actions.append(cancel,confirm);dialog.append(h,element('p',null,tr('仅重置快捷键，其他设置保持不变。','Only shortcuts will be reset.')),actions);dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();cancel.focus();
}
const keyNames={Comma:'Comma',Period:'Period',ArrowLeft:'Left',ArrowRight:'Right',ArrowUp:'Up',ArrowDown:'Down',Space:'Space',PageUp:'PageUp',PageDown:'PageDown',Insert:'Insert',Delete:'Delete',BracketLeft:'BracketLeft',BracketRight:'BracketRight',Equal:'Equal',Minus:'Minus',Backquote:'',Slash:'',Backslash:''};
function bindingFor(event){const native=event.keyCode;const punctuation={188:'Comma',190:'Period',37:'Left',39:'Right',38:'Up',40:'Down',32:'Space',33:'PageUp',34:'PageDown',45:'Insert',46:'Delete',219:'BracketLeft',221:'BracketRight',187:'Equal',189:'Minus',9:'Tab',36:'Home',35:'End'};let key=native?(native>=65&&native<=90?String.fromCharCode(native):native>=48&&native<=57?String.fromCharCode(native):native>=112&&native<=123?'F'+(native-111):punctuation[native]||''):/^Key[A-Z]$/.test(event.code)?event.code.slice(3):/^Digit[0-9]$/.test(event.code)?event.code.slice(5):keyNames[event.code]??(/^(F([1-9]|1[0-2])|Tab|Home|End)$/.test(event.code)?event.code:'');if(!key||(!event.ctrlKey&&!event.altKey&&!event.metaKey&&!/^F/.test(key)))return '';return [event.ctrlKey&&'Ctrl',event.altKey&&'Alt',event.metaKey&&'Command',event.shiftKey&&'Shift',key].filter(Boolean).join('+');}
document.addEventListener('keydown',event=>{
  if(!recording||!editing)return;event.preventDefault();event.stopImmediatePropagation();if(event.key==='Escape'){void stopCapture();editing.status.textContent='';return;}if(event.isComposing||['Meta','Control','Alt','Shift'].includes(event.key))return;const key=bindingFor(event);if(!key){editing.status.textContent=tr('请按下包含 ⌘、⌃ 或 ⌥ 的组合。','Press a combination with ⌘, ⌃ or ⌥.');return;}pendingKey=key;editing.value.textContent=display(key);editing.status.textContent='';void stopCapture();
},true);
addWebUiListener('tai-state-changed',next=>{if(next.ready){state=next;if(!busy)render();}});
addEventListener('tai-language-changed',()=>{if(state)render();});
addEventListener('pagehide',()=>{void stopCapture();editing?.dialog.remove();editing=undefined;},{once:true});
addEventListener('hashchange',()=>{if(editing)void closeEditor();});
void load();
