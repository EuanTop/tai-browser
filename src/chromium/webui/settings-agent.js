import {t,setLanguage} from './i18n.js';
// Browser-tool authorization only; no component runtime is loaded.
import {sendWithPromise,addWebUiListener} from 'chrome://resources/js/cr.js';
import {mountAgentSetup} from './agent-setup.js';
const $=id=>document.getElementById(id);
let state,controller,stopped=false,timer;
async function refresh(){
  const [next,context]=await Promise.all([sendWithPromise('taiGetState'),sendWithPromise('taiGetPanelState')]);
  if(stopped)return;
  if(!next.ready){timer=setTimeout(()=>void refresh().catch(failed),150);return;}
  const selected=$('host-space').value||new URLSearchParams(location.search).get('space')||context.activeSpaceId;
  state=next;setLanguage(next.language);$('host-space').replaceChildren(...state.spaces.map(space=>new Option(space.icon+' '+space.name,space.id)));
  if(state.spaces.some(space=>space.id===selected))$('host-space').value=selected;
  $('host-controls').disabled=false;$('host-status').textContent='';
  if(!controller)controller=mountAgentSetup($('agent-setup'),{
    space:()=>state.spaces.find(space=>space.id===$('host-space').value),
    spaces:()=>state.spaces,
    scopeControl:$('host-scope'),
  });
  else await controller.refresh();
}
function failed(){if(!stopped)$('host-status').textContent=t('无法读取连接状态，请重新加载。');}
$('host-space').onchange=()=>void controller?.refresh().catch(failed);
addWebUiListener('tai-state-changed',()=>void refresh().catch(failed));
addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);controller?.dispose();},{once:true});
void refresh().catch(failed);
