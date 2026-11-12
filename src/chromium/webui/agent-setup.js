import {t,translateDOM,markCopy} from './i18n.js';
// Trusted setup view. Commands reference a private lease file, never its token.
import {sendWithPromise} from 'chrome://resources/js/cr.js';
export const quote = value => "'" + value.replaceAll("'", "'\"'\"'") + "'";
export function connectionGuide(provider, runtime, file, taskId) {
  if (!runtime?.node || !runtime?.entry) throw new Error(t('本地连接组件缺失，请更新 TAi 安装。'));
  const name = 'tai-' + taskId.replaceAll('-', '').slice(0, 12);
  const launch = [runtime.node, runtime.entry, '--connection-file', file];
  if (provider === 'pi') return {
    command: 'TAI_CONNECTION_FILE=' + quote(file) + ' pi -e ' + quote(runtime.piEntry),
    instruction: t('在终端运行，启动带 TAi 工具的 Pi。已有会话可在 Pi 内用 /resume 选择；不会自动接管正在运行的会话。'),
  };
  if (provider === 'codex') return {
    command: 'codex mcp add ' + name + ' -- ' + launch.map(quote).join(' '),
    instruction: t('在终端运行一次，然后在 ChatGPT 中重新加载 MCP。Codex CLI 可用 /mcp 查看 ') + name + t('。'),
  };
  if (provider === 'claude') return {
    command: 'claude mcp add --transport stdio --scope local ' + name + ' -- ' + launch.map(quote).join(' '),
    instruction: t('在 Claude Code 项目目录的终端运行一次，再用 /mcp 连接 ') + name + t('。此命令仅新增该项目的本地 MCP 配置。'),
  };
  return {command: JSON.stringify({mcpServers:{[name]:{command:runtime.node,args:launch.slice(1)}}},null,2), instruction:t('将配置合并到所用 MCP 客户端的服务器设置中。')};
}
const labels={codex:'ChatGPT',claude:'Claude Code',pi:'Pi',other:'其他 MCP'};
const providerIcons={codex:'agent-chatgpt.png',claude:'agent-claude.png',pi:'agent-pi.png'};
export function mountAgentSetup(container,{space,spaces,scopeControl,onChange=()=>{}}){
  // Native Trusted Types stays enabled; all content is built as DOM nodes.
  const e=(tag,attributes={},...children)=>{const node=document.createElement(tag);for(const[k,v]of Object.entries(attributes))node.setAttribute(k,v);node.append(...children);markCopy(node);return node;};
  const p=(className,text)=>e('p',{class:className},text);
  const icon=id=>Object.hasOwn(providerIcons,id)?
    [e('img',{class:'agent-provider-icon',src:providerIcons[id],alt:'',width:'16',height:'16'})]:[];
  const copyButton=e('button',{type:'button',class:'agent-copy secondary'},t('复制命令'));
  const copyStatus=p('agent-copy-status','');
  copyStatus.setAttribute('role','status');
  const instruction=p('agent-instruction','');
  const command=e('pre',{class:'agent-command',tabindex:'0'});
  const guidePanel=e('div',{class:'agent-guide',hidden:''},
    e('div',{class:'agent-guide-heading'},instruction,copyButton),
    e('details',{class:'agent-advanced'},e('summary',{},t('查看接入内容')),command),
    copyStatus);
  if(scopeControl)scopeControl.hidden=false;
  container.replaceChildren(
    e('section',{class:'agent-form'},
      ...(scopeControl?[e('h2',{},t('新建连接')),scopeControl]:[]),
      e('div',{class:'agent-choices',role:'group','aria-label':t('选择 Agent 渠道')},...Object.entries(labels).map(([id,label])=>e('button',{type:'button','data-provider':id,'aria-pressed':String(id==='codex')},...icon(id),t(label)))),
      e('div',{class:'agent-form-actions'},
        e('label',{class:'agent-permissions'},e('input',{type:'checkbox','data-grant':'page'}),
          e('span',{},t('允许打开网页、点击和填写'))),
        e('label',{class:'agent-permissions'},e('input',{type:'checkbox','data-grant':'screenshot'}),
          e('span',{},t('允许截取网页画面'))),
        e('label',{class:'agent-permissions'},e('input',{type:'checkbox','data-grant':'remember'}),
          e('span',{},t('更新或重启后自动连接'))),
        e('button',{type:'button',class:'agent-create',disabled:''},t('授权'))),
      p('agent-feedback','')),
    e('section',{class:'agent-connections',hidden:''},
      e(scopeControl?'h2':'h3',{},t('已授权连接')),
      p('agent-empty',t('还没有已授权的连接。')),
      e('div',{class:'agent-tasks',role:'group','aria-label':t(spaces?'已授权连接':'当前 Space 的授权')})));
  const $=selector=>container.querySelector(selector);
  $('.agent-feedback').setAttribute('role','status');
  const guides=new Map();
  let provider='codex',guideId,host,stopped=false,busy=false,inflight,fingerprint;
  const feedback=(text,error=false)=>{$('.agent-feedback').textContent=t(text);$('.agent-feedback').dataset.error=String(error);};
  function controls(){
    $('.agent-create').disabled=busy||!host?.ready||!space()||!host.agentRuntime?.node||!host.agentRuntime?.entry;
    for(const button of container.querySelectorAll('[data-provider]'))button.disabled=busy;
  }
  function updateGuide(){
    const entry=guides.get(guideId);
    const row=entry&&$('[data-task-id="'+CSS.escape(guideId)+'"]');
    const setup=row?.querySelector('[data-agent-action="setup"]');
    for(const button of container.querySelectorAll('[data-agent-action="setup"]')){
      button.setAttribute('aria-expanded',String(button===setup));
    }
    guidePanel.hidden=!setup;
    if(!setup)return;
    if(row.nextElementSibling!==guidePanel)row.after(guidePanel);
    const next=connectionGuide(entry.provider,host.agentRuntime,entry.file,guideId);
    instruction.textContent=next.instruction;
    if(command.textContent!==next.command){
      command.textContent=next.command;
      guidePanel.querySelector('details').open=false;
      copyStatus.textContent='';
    }
    copyButton.dataset.i18n=entry.provider==='other'?'复制配置':'复制命令';
    copyButton.textContent=t(copyButton.dataset.i18n);
  }
  function connectionState(task){
    if(task.windowClosed)return t('授权窗口已关闭');
    if(task.paused){
      if(task.pauseReason==='HUMAN_REQUIRED')return t('等待你操作');
      if(task.pauseReason==='USER_EDITING')return t('当前网页由你操作');
      return t('已暂停');
    }
    if(task.connected){
      if(task.activity==='action_started')return t('正在操作');
      return task.used?t('已调用工具'):t('已连接');
    }
    return task.everConnected?t('客户端已断开'):t('等待客户端连接');
  }
  async function grant(selected,channel,commands,reconnectTaskId,remember=false){
    if(busy||stopped||!host?.ready||!selected)return;
    busy=true;controls();feedback('');
    try{
      const result=await sendWithPromise('taiCreateTask',{spaceId:selected.id,commands,libraries:[],provider:channel,remember,...(reconnectTaskId?{reconnectTaskId}:{})});
      if(stopped)return;
      if(!result.ok||typeof result.value?.taskId!=='string'||typeof result.value?.configFile!=='string')throw new Error();
      guideId=result.value.taskId;
      guides.set(guideId,{provider:channel,file:result.value.configFile});
      copyStatus.textContent='';
      if(reconnectTaskId)feedback(t('已重新授权，请在原客户端重新加载 MCP。'));
      await fresh();
    }catch{if(!stopped)feedback(t('暂时无法授权，请稍后重试。'),true);}finally{busy=false;if(!stopped)controls();}
  }
  async function fresh(){if(inflight)await inflight;return refresh();}
  function refresh(){
    if(stopped)return Promise.resolve();
    if(inflight)return inflight;
    inflight=(async()=>{
      const next=await sendWithPromise('taiGetHostState');if(stopped)return;
      host=next;controls();if(!host.ready)return;
      const current=space();
      const available=new Map((spaces?spaces():current?[current]:[]).map(item=>[item.id,item]));
      const tasks=host.tasks.filter(t=>available.has(t.spaceId));
      const saved=(host.savedTasks??[]).filter(t=>available.has(t.spaceId));
      const key=JSON.stringify([document.documentElement.lang,[...available.values()].map(s=>[s.id,s.name,s.icon]),
        tasks.map(t=>[t.id,t.spaceId,t.used,t.commands,t.provider,t.connected,t.everConnected,t.paused,t.pauseReason,t.windowClosed,t.remembered,t.activity,t.hasAttentionPage,guides.has(t.id)]),saved]);
      if(key!==fingerprint){
        fingerprint=key;
        const focused=document.activeElement;
        const guideHadFocus=guidePanel.contains(focused);
        const previousRow=focused?.closest('.agent-task');
        const focusId=previousRow?.dataset.taskId;
        const focusAction=focused?.dataset.agentAction;
        const empty=!tasks.length&&!saved.length;
        $('.agent-connections').hidden=empty&&!spaces;
        $('.agent-empty').hidden=!empty;
        const spaceLabel=task=>{
          const target=available.get(task.spaceId);
          const label=e('span',{class:'agent-space-name'});
          label.textContent=[target.icon,target.name].filter(Boolean).join(' ');
          return label;
        };
        $('.agent-tasks').replaceChildren(...tasks.map(task=>{
          const write=task.commands?.some(command=>command==='page.act'||command==='page.open');
          const pageInUse=task.pauseReason==='USER_EDITING';
          const status=e('span',{class:'agent-task-status','data-online':String(task.connected&&!task.windowClosed&&(!task.paused||pageInUse))});
          status.textContent=connectionState(task);
          const access=e('span',{class:'agent-access'},t(write?'允许操作':'仅阅读'));
          const capture=task.commands?.includes('page.screenshot');
          const info=e('div',{class:'agent-task-info'},
            e('div',{class:'agent-task-binding'},e('strong',{class:'agent-provider-name'},...icon(task.provider),t(labels[task.provider]??labels.other)),spaceLabel(task)),
            e('div',{class:'agent-task-meta'},status,access,
              ...(capture?[e('span',{class:'agent-access'},t('允许截图'))]:[]),
              ...(task.remembered?[e('span',{class:'agent-access'},t('自动连接'))]:[])));
          const actions=e('div',{class:'agent-task-actions'});
          if(guides.has(task.id)&&!task.windowClosed){
            const setup=e('button',{type:'button',class:'text-button','data-agent-action':'setup','aria-expanded':'false'},t('接入设置'));
            setup.onclick=()=>{
              guideId=guideId===task.id?undefined:task.id;
              updateGuide();
            };
            actions.append(setup);
          }
          if(task.hasAttentionPage&&!task.windowClosed){
            const show=e('button',{type:'button',class:'secondary','data-agent-action':'view'},t('查看网页'));
            show.onclick=async()=>{
              show.disabled=true;
              feedback('');
              try {
                if(!await sendWithPromise('taiRevealTaskPage',task.id))throw new Error();
              } catch {
                if(!stopped)feedback(t('网页已移动、关闭或不在授权窗口中。'),true);
              } finally {show.disabled=false;}
            };
            actions.append(show);
          }
          if(write&&!task.windowClosed){
            const pause=e('button',{type:'button',class:'secondary','data-agent-action':'pause'},t(pageInUse?'允许操作此页':task.paused?'恢复操作':'暂停操作'));
            pause.onclick=async()=>{
              const hadFocus=document.activeElement===pause;
              pause.disabled=true;
              feedback('');
              try {
                if(!await sendWithPromise('taiSetTaskPaused',task.id,!task.paused))throw new Error();
                await fresh();
              } catch {
                if(!stopped)feedback(t('请在授权窗口中操作。'),true);
              } finally {
                pause.disabled=false;
                if(hadFocus&&document.activeElement===document.body){
                  const row=$('[data-task-id="'+CSS.escape(task.id)+'"]');
                  row?.querySelector('[data-agent-action="pause"]')?.focus({preventScroll:true});
                }
              }
            };
            actions.append(pause);
          }
          const revoke=e('button',{type:'button',class:'text-button','data-agent-action':'revoke'},t('撤销'));
          revoke.onclick=async()=>{
            const hadFocus=document.activeElement===revoke;
            revoke.disabled=true;
            feedback('');
            try{
              if(!await sendWithPromise('taiRevokeTask',task.id))throw new Error();
              if(stopped)return;
              guides.delete(task.id);
              if(guideId===task.id)guideId=undefined;
              await fresh();
            }catch{
              if(!stopped)feedback(t('无法撤销，请重试。'),true);
            }finally{
              revoke.disabled=false;
              if(hadFocus&&document.activeElement===document.body){
                (revoke.isConnected?revoke:$('.agent-create')).focus({preventScroll:true});
              }
            }
          };
          actions.append(revoke);
          return e('div',{class:'agent-task','data-task-id':task.id},info,actions);
        }),...saved.map(task=>{
          const row=e('div',{class:'agent-task','data-task-id':task.id}),text=e('span'),renew=e('button',{type:'button',class:'secondary','data-agent-action':'renew','aria-label':t('重新授权连接 ')+task.id.slice(0,8)},t('重新授权')),forget=e('button',{type:'button',class:'text-button','data-agent-action':'forget','aria-label':t('忘记连接 ')+task.id.slice(0,8)},t('忘记'));
          text.className='agent-task-status';
          text.textContent=t('授权已到期');
          renew.onclick=()=>grant(available.get(task.spaceId),task.provider??'other',task.commands,task.id,task.remembered);
          const remember=e('button',{type:'button',class:'secondary','data-agent-action':'renew-remember'},t('重新授权并记住'));
          remember.onclick=()=>grant(available.get(task.spaceId),task.provider??'other',task.commands,task.id,true);
          const screenshot=task.commands.includes('page.read')&&task.commands.includes('page.list')&&
            !task.commands.includes('page.screenshot')
            ? e('button',{type:'button',class:'secondary','data-agent-action':'renew-screenshot'},t('重新授权并允许截图'))
            : null;
          if(screenshot)screenshot.onclick=()=>grant(available.get(task.spaceId),task.provider??'other',
            [...task.commands,'page.screenshot'],task.id,task.remembered);
          forget.onclick=async()=>{forget.disabled=true;try{if(!await sendWithPromise('taiRevokeTask',task.id))throw new Error();await fresh();}catch{if(!stopped)feedback(t('无法忘记连接，请重试。'),true);}finally{forget.disabled=false;}};
          row.append(e('div',{class:'agent-task-info'},
              e('div',{class:'agent-task-binding'},e('strong',{class:'agent-provider-name'},...icon(task.provider),t(labels[task.provider]??labels.other)),spaceLabel(task)),text),
            e('div',{class:'agent-task-actions'},renew,...(task.remembered?[]:[remember]),...(screenshot?[screenshot]:[]),forget));
          return row;
        }));
        if(focusId&&focusAction){
          const row=$('[data-task-id="'+CSS.escape(focusId)+'"]');
          const replacement=row?.querySelector('[data-agent-action="'+CSS.escape(focusAction)+'"]');
          (replacement??row?.querySelector('button')??$('.agent-create')).focus({preventScroll:true});
        }
        updateGuide();
        if(guideHadFocus&&!guidePanel.hidden)focused.focus({preventScroll:true});
      }else{
        updateGuide();
      }
      onChange(host);
      if(!host.agentRuntime?.entry)feedback(t('本地连接组件缺失，请更新 TAi 安装。'),true);
    })().finally(()=>{inflight=undefined;});return inflight;
  }
  for(const button of container.querySelectorAll('[data-provider]'))button.onclick=()=>{
    if(busy||stopped)return;provider=button.dataset.provider;
    for(const item of container.querySelectorAll('[data-provider]'))item.setAttribute('aria-pressed',String(item===button));
    feedback('');
  };
  const permission=$('[data-grant=page]');
  $('.agent-create').onclick=()=>{
    const commands=['page.list','page.read'];if(permission.checked)commands.push('page.open','page.act');
    if($('[data-grant=screenshot]').checked)commands.push('page.screenshot');
    return grant(space(),provider,commands,undefined,$('[data-grant=remember]').checked);
  };
  copyButton.onclick=async()=>{
    const copiedGuide=guideId;
    try{
      await navigator.clipboard.writeText(command.textContent);
      if(!stopped&&guideId===copiedGuide)copyStatus.textContent=t('已复制。');
    }catch{
      if(!stopped&&guideId===copiedGuide){
        guidePanel.querySelector('details').open=true;
        copyStatus.textContent=t('复制未完成，请手动复制。');
      }
    }
  };
  const poll=()=>{if(!stopped&&!document.hidden&&!container.closest('[hidden]'))void refresh().catch(()=>{});};
  const languageChanged=()=>{translateDOM(container);fingerprint=undefined;void refresh().catch(()=>{});};addEventListener('tai-language-changed',languageChanged);
  const timer=setInterval(poll,3000);document.addEventListener('visibilitychange',poll);
  addEventListener('hashchange',poll);
  function dispose(){stopped=true;clearInterval(timer);removeEventListener('tai-language-changed',languageChanged);document.removeEventListener('visibilitychange',poll);removeEventListener('hashchange',poll);removeEventListener('pagehide',dispose);}
  addEventListener('pagehide',dispose,{once:true});
  const ready=refresh().catch(()=>{if(!stopped)feedback(t('无法读取授权状态，请稍后重试。'),true);});
  return {refresh,dispose,ready};
}
