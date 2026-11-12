import {t,setLanguage,setColorMode,translateDOM} from './i18n.js';
// First-party browser-tool panel. Legacy components keep their own data/routes.
import {sendWithPromise,addWebUiListener} from 'chrome://resources/js/cr.js';
import {mountAgentSetup} from './agent-setup.js';
const $=id=>document.getElementById(id);
let snapshot,owner,closed=false,initialized=false,controller,retry;
function status(text){$('panel-status').textContent=t(text);}
function run(fn){void fn().catch(()=>{if(!closed)status(t('暂时无法连接，请稍后重试。'));});}
function receive(next){
  if(!next.ready||closed)return;
  const previous=$('panel-space').value;
  snapshot=next;setLanguage(next.language);setColorMode(next.colorMode);document.documentElement.dataset.edition=next.edition;
  $('panel-space').replaceChildren(...next.spaces.map(space=>new Option(space.name,space.id)));
  const selected=initialized?previous:owner?.activeSpaceId;
  if(next.spaces.some(space=>space.id===selected))$('panel-space').value=selected;
  initialized=true;$('panel-space').disabled=next.readOnly||!next.spaces.length;
  if(controller)run(controller.refresh);
}
async function initialize(){
  if(closed)return;
  const [next,context,host]=await Promise.all([sendWithPromise('taiGetState'),sendWithPromise('taiGetPanelState'),sendWithPromise('taiGetHostState')]);
  if(closed)return;
  if(!next.ready||!host.ready){retry=setTimeout(()=>run(initialize),150);return;}
  owner=context;receive(next);document.querySelector('.panel-header').hidden=context.embedded;$('close-panel').hidden=true;
  controller=mountAgentSetup($('agent-setup'),{space:()=>snapshot.spaces.find(space=>space.id===$('panel-space').value)});
  status('');
}
$('close-panel').onclick=()=>run(async()=>{const result=await sendWithPromise('taiSetPanelVisible',false);if(!result.ok)throw new Error();});
$('panel-settings').onclick=()=>run(async()=>{const result=await sendWithPromise('taiOpenSettings');if(!result.ok)throw new Error();});
$('panel-space').onchange=()=>{status('');if(controller)run(controller.refresh);};
addWebUiListener('tai-state-changed',receive);
addEventListener('pagehide',()=>{closed=true;clearTimeout(retry);controller?.dispose();},{once:true});
run(initialize);
