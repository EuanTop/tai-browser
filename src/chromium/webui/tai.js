import {t,setLanguage,setColorMode} from './i18n.js';
// Trusted first-party WebUI. Chromium owns persistence and all permission checks.
import {sendWithPromise, addWebUiListener} from 'chrome://resources/js/cr.js';
const $=id=>document.getElementById(id);
let snapshot,busy=false,dirty=false,editionDirty=false,languageDirty=false,stale=false,savingTarget,noticeTimer;
const errors={STALE_REVISION:'设置已在其他窗口更新。请重新加载后再保存。',READ_ONLY:'组织数据无法读取，已保留原文件，暂时无法更改。',PROFILE_MISMATCH:'账号环境已改变，请重新打开设置。',INVALID_NAME:'请输入 1–80 个字符的名称。',INVALID_COLOR:'请选择有效的颜色。',INVALID_ICON:'请选择或输入一个 emoji。',SPACE_NOT_FOUND:'这个 Space 已不存在，请重新选择。'};
const emojiChoices=['🌐','🏠','💼','📚','🧪','🎨','🛠️','🌱','☕','🧭','🚀','🎮','🎵','💡','🌙','🐱','🏳️‍🌈','👩🏽‍💻','🌊','🏔️','🌻','🍵','🪴','🦋','📝','🎬','💻','🪐','🎯','✨'];
const palette=[['雾紫','#E9E5FA'],['晨蓝','#DFEAF8'],['青瓷','#E0ECE7'],['麦芽','#F4ECD9'],['桃雾','#F5E4DE'],['樱粉','#F1E2EC'],['石灰','#E6E8EF'],['暮色','#292C45']];
const selectedSpace=()=>snapshot?.spaces.find(space=>space.id===$('space').value);
const chosenColor=()=>$('default-color').checked?'':$('color').value.toUpperCase();
const colorMode=()=>$('color-mode').querySelector(':checked')?.value??'system';
function selectColorMode(mode){
  for(const input of $('color-mode').querySelectorAll('input')) input.checked=input.value===mode;
}
function message(text,error=false,retry=false){clearTimeout(noticeTimer);$('status').textContent=t(text);$('status').dataset.error=String(error);$('refresh').hidden=!retry;if(text&&!error)noticeTimer=setTimeout(()=>{$('status').textContent='';},3200);}
function preview(){
  if(!snapshot)return;
  const icon=$('space-icon').value||selectedSpace()?.icon||'🌐',name=$('name').value.trim()||t('未命名 Space');
  $('selected-icon').textContent=icon;$('preview-icon').textContent=icon;$('preview-name').textContent=name;
  const color=chosenColor()||'#ECEBF7';
  const rgb=color.slice(1).match(/../g)?.map(c=>parseInt(c,16))||[236,235,247];
  const luminance=rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
  const panel=document.querySelector('.space-preview');panel.style.setProperty('--preview-color',color);panel.style.setProperty('--preview-ink',luminance>.45?'#3E4162':luminance<.12?'#F1F0FC':luminance>.179?'#000000':'#FFFFFF');panel.style.setProperty('--preview-muted-opacity',luminance>=.12&&luminance<=.45?'1':'.8');
  $('color-description').textContent=chosenColor()?t('仅应用于这个 Space。'):t('使用当前外观的默认颜色。');
}
function updateControls(){
  const original=selectedSpace();
  dirty=!!original&&($('name').value!==original.name||$('space-icon').value!==original.icon||chosenColor()!==(original.color||'').toUpperCase());
  editionDirty=!!snapshot&&($('edition').value!==snapshot.edition||colorMode()!==snapshot.colorMode);
  languageDirty=!!snapshot&&$('language').value!==snapshot.languageMode;
  const blocked=!snapshot||snapshot.readOnly||busy;
  for(const id of ['space','name','space-icon','color','default-color','edition','language','color-mode'])$(id).disabled=blocked;
  for(const button of $('emoji-grid').querySelectorAll('button')){button.disabled=blocked;button.setAttribute('aria-pressed',String(button.dataset.emoji===$('space-icon').value));}
  for(const button of $('color-swatches').querySelectorAll('button')){button.disabled=blocked;button.setAttribute('aria-pressed',String(button.dataset.color===chosenColor()));}
  for(const button of document.querySelectorAll('[data-theme]')){button.disabled=blocked;button.setAttribute('aria-pressed',String(button.dataset.theme===$('edition').value));}
  $('icon-picker').querySelector('summary').setAttribute('aria-disabled',String(blocked));
  $('save-space').disabled=blocked||stale||!dirty;$('reset-space').disabled=blocked||(!dirty&&!stale);
  $('save-edition').disabled=blocked||stale||!editionDirty;
  $('save-language').disabled=blocked||stale||!languageDirty;$('reset-language').disabled=blocked||(!languageDirty&&!stale);$('language-draft').textContent=languageDirty?t('尚未保存'):'';
  $('save-space').textContent=busy&&savingTarget==='space'?t('保存中…'):t('保存更改');$('save-edition').textContent=busy&&savingTarget==='appearance'?t('应用中…'):t('应用外观');
  $('space-draft').textContent=dirty?t('尚未保存'):'';preview();
}
function edited(){for(const id of ['name','space-icon'])$(id).removeAttribute('aria-invalid');updateControls();}
for(const emoji of emojiChoices){const button=document.createElement('button');button.type='button';button.textContent=emoji;button.dataset.emoji=emoji;button.setAttribute('aria-label',t('选择 ')+emoji);button.setAttribute('aria-pressed','false');button.disabled=true;button.onclick=()=>{$('space-icon').value=emoji;edited();$('icon-picker').open=false;$('icon-picker').querySelector('summary').focus();};$('emoji-grid').append(button);}
for(const [name,color] of palette){const button=document.createElement('button');button.type='button';button.className='color-swatch';button.dataset.color=color;button.style.setProperty('--swatch',color);button.setAttribute('data-i18n-aria-label',name);button.setAttribute('data-i18n-title',name);button.setAttribute('aria-label',t(name));button.title=t(name);button.setAttribute('aria-pressed','false');button.disabled=true;button.onclick=()=>{$('color').value=color;$('default-color').checked=false;edited();};$('color-swatches').insertBefore(button,document.querySelector('.custom-color'));}
function positionPicker(){
  if(!$('icon-picker').open)return;
  const trigger=$('icon-picker').querySelector('summary').getBoundingClientRect(),panel=document.querySelector('.picker-panel');
  const below=innerHeight-trigger.bottom-26,above=trigger.top-26,up=below<350&&above>below;
  panel.dataset.align=up?'up':'down';panel.style.maxHeight=Math.max(120,up?above:below)+'px';
}
$('icon-picker').addEventListener('toggle',positionPicker);addEventListener('resize',positionPicker);
$('close-picker').onclick=()=>{$('icon-picker').open=false;$('icon-picker').querySelector('summary').focus();};
$('icon-picker').querySelector('summary').addEventListener('click',event=>{if(!snapshot||snapshot.readOnly||busy)event.preventDefault();});
document.addEventListener('click',event=>{if(!event.composedPath().includes($('icon-picker')))$('icon-picker').open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('icon-picker').open){event.preventDefault();$('close-picker').click();}});
function loadSpace(){const space=selectedSpace();if(!space)return;$('name').value=space.name;$('space-icon').value=space.icon;$('color').value=space.color||'#E9E5FA';$('default-color').checked=!space.color;$('icon-picker').open=false;for(const id of ['name','space-icon'])$(id).removeAttribute('aria-invalid');updateControls();}
function receive(next,force=false,preferred){
  if(!next.ready)return;
  if((dirty||editionDirty||languageDirty)&&snapshot?.revision!==next.revision&&!force){stale=true;message(errors.STALE_REVISION,true,true);updateControls();return;}
  const selected=preferred||$('space').value||new URLSearchParams(location.search).get('space');
  snapshot=next;dirty=false;editionDirty=false;languageDirty=false;stale=false;
  $('edition').value=next.edition;$('language').value=next.languageMode;
  selectColorMode(next.colorMode);setColorMode(next.colorMode);
  setLanguage(next.language);document.documentElement.dataset.edition=next.edition;
  $('space').replaceChildren(...next.spaces.map(space=>new Option(space.icon+' '+space.name,space.id)));
  if(next.spaces.some(space=>space.id===selected))$('space').value=selected;
  loadSpace();category();
  if(next.readOnly)message(errors.READ_ONLY,true,true);
}
async function refresh(){receive(await sendWithPromise('taiGetState'),true);}
async function apply(changes,target){
  if(!snapshot||busy||snapshot.readOnly)return;
  if(stale){message(errors.STALE_REVISION,true,true);return;}
  const spaceDraft=dirty&&target!=='space'?{name:$('name').value,icon:$('space-icon').value,color:$('color').value,defaultColor:$('default-color').checked}:undefined;
  const editionDraft=editionDirty&&target!=='appearance'?$('edition').value:undefined;
  const modeDraft=editionDraft!==undefined?colorMode():undefined;
  const languageDraft=languageDirty&&target!=='language'?$('language').value:undefined;
  busy=true;savingTarget=target;updateControls();
  const request={protocol:'tai.v1',id:crypto.randomUUID(),command:'settings.patch',scope:{profileId:snapshot.profileId,spaceId:$('space').value},payload:{revision:snapshot.revision,changes}};
  let invalidField;
  try{
    const result=await sendWithPromise('taiCommand',request);if(result.id!==request.id)throw new Error('INVALID_RESPONSE');
    if(!result.ok){const code=result.error.code;stale=code==='STALE_REVISION';message(errors[code]||t('暂时无法保存，请重试。'),true,stale||code==='READ_ONLY'||code==='PROFILE_MISMATCH');const field=code==='INVALID_ICON'?'space-icon':code==='INVALID_NAME'?'name':undefined;if(field){if(field==='space-icon')$('icon-picker').open=true;$(field).setAttribute('aria-invalid','true');invalidField=field;}return;}
    receive(result.value,true);
    if(spaceDraft){$('name').value=spaceDraft.name;$('space-icon').value=spaceDraft.icon;$('color').value=spaceDraft.color;$('default-color').checked=spaceDraft.defaultColor;}
    if(editionDraft!==undefined){$('edition').value=editionDraft;selectColorMode(modeDraft);}
    if(languageDraft!==undefined)$('language').value=languageDraft;
    message(target==='space'?t('Space 已保存'):target==='language'?t('语言已更新'):t('外观已更新'));
  }catch{message(t('设置连接中断，请重新加载。'),true,true);}finally{busy=false;savingTarget=undefined;updateControls();if(invalidField)$(invalidField).focus();}
}
$('space').addEventListener('change',()=>{loadSpace();message('');});
for(const id of ['name','space-icon','default-color'])$(id).addEventListener('input',edited);
$('color').addEventListener('input',()=>{$('default-color').checked=false;edited();});
$('edition').addEventListener('input',updateControls);$('language').addEventListener('input',updateControls);
$('color-mode').addEventListener('change',updateControls);
$('language-form').onsubmit=event=>{event.preventDefault();if(languageDirty&&!busy)void apply({language:$('language').value},'language');};
$('reset-language').onclick=()=>{if(stale)void refresh().catch(()=>message(t('无法重新加载设置。'),true,true));else{$('language').value=snapshot.languageMode;updateControls();}message('');};
for(const button of document.querySelectorAll('[data-theme]'))button.onclick=()=>{$('edition').value=button.dataset.theme;updateControls();};
$('reset-space').onclick=()=>{if(stale)void refresh().catch(()=>message(t('无法重新加载设置。'),true,true));else loadSpace();message('');};
$('space-form').addEventListener('submit',event=>{event.preventDefault();if(!dirty||busy)return;void apply({name:$('name').value,icon:$('space-icon').value,color:chosenColor()},'space');});
$('save-edition').onclick=()=>void apply({edition:$('edition').value,colorMode:colorMode()},'appearance');
addWebUiListener('tai-state-changed',next=>{if(!busy)receive(next);});
$('refresh').onclick=()=>void refresh().then(()=>message(t('设置已重新加载'))).catch(()=>message(t('无法重新加载设置。'),true,true));
async function initialize(){try{const[state,context]=await Promise.all([sendWithPromise('taiGetState'),sendWithPromise('taiGetPanelState')]);if(!state.ready){setTimeout(initialize,100);return;}receive(state,true,new URLSearchParams(location.search).get('space')||context.activeSpaceId);if(!state.readOnly)message('');}catch{message(t('无法加载设置，请重新打开页面。'),true,true);}}
void initialize();
const categories={shortcuts:['快捷键','自定义常用操作，保持你的浏览节奏。'],spaces:['Space','给不同的事，留一个专属位置。'],appearance:['外观','选择一种让你自在的氛围。'],agent:['Agent 连接','每条连接各自绑定一个 Space。'],browser:['浏览器','熟悉的 Chromium，完整保留。']};
function category(){const requested=location.hash.slice(1)||'spaces',selected=Object.hasOwn(categories,requested)?requested:'spaces';for(const panel of document.querySelectorAll('[data-settings]'))panel.hidden=panel.dataset.settings!==selected;for(const link of document.querySelectorAll('[data-category]')){if(link.dataset.category===selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}$('page-title').textContent=t(categories[selected][0]);$('page-description').textContent=t(categories[selected][1]);$('icon-picker').open=false;}
addEventListener('hashchange',category);category();

addEventListener('tai-language-changed',()=>{category();for(const button of $('emoji-grid').querySelectorAll('button'))button.setAttribute('aria-label',t('选择 ')+button.dataset.emoji);updateControls();});

$('open-welcome').addEventListener('click', async () => {
  try {
    if (await sendWithPromise('taiShowWelcome')) return;
  } catch {}
  message('暂时无法打开导入窗口，请重试。', true);
});
