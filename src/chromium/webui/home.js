import {t,setLanguage,setColorMode,translateDOM} from './i18n.js';
import {sendWithPromise,addWebUiListener} from 'chrome://resources/js/cr.js';
const status=document.querySelector('#home-status');
function receive(state){if(state.ready){
  setLanguage(state.language);setColorMode(state.colorMode);const binding=state.shortcuts?.find(item=>item.id==='focus_location')?.binding||'';const keys=binding.split('+').map(key=>({Command:'⌘',Ctrl:'⌃',Alt:'⌥',Shift:'⇧',Comma:',',Period:'.',Left:'←',Right:'→',Up:'↑',Down:'↓',BracketLeft:'[',BracketRight:']',Equal:'=',Minus:'−'}[key]||key)).join(' ');document.querySelector('#home-search-hint').textContent=(keys?keys+' ':'')+t('搜索或输入网址');document.documentElement.dataset.edition=state.edition;document.querySelector('#home-icon').href=state.edition==='pride'?'brand-pride-icon.png':'brand-standard-icon.png';}}
async function initialize(){try{const [state,context]=await Promise.all([sendWithPromise('taiGetState'),sendWithPromise('taiGetPanelState')]);if(!state.ready){setTimeout(initialize,100);return;}receive(state);document.querySelector('#home-space').textContent=state.spaces.find(space=>space.id===context.activeSpaceId)?.name||'';}catch{status.textContent=t('暂时无法加载 Space，浏览与地址栏仍可使用。');}}
document.querySelector('#home-agent').onclick=async()=>{try{const result=await sendWithPromise('taiSetPanelVisible',true);if(!result.ok)throw new Error();status.textContent=t('在右侧授权 Agent 使用浏览器工具。');}catch{status.textContent=t('无法打开 Agent 面板，请从浏览器工具栏重试。');}};
addWebUiListener('tai-state-changed',receive);void initialize();
