// Trusted TAi parent. User content only enters an opaque sandboxed child.
import {sendWithPromise,addWebUiListener} from 'chrome://resources/js/cr.js';
export async function hostCommand(binding, command, payload = {}) {
  const id = crypto.randomUUID();
  const result = await sendWithPromise('taiHost', {protocol:'tai.v1', id, command, scope:binding, payload});
  if (result.id !== id || typeof result.ok !== 'boolean') throw new Error('INVALID_RESPONSE');
  if (!result.ok) throw new Error(result.error?.code || 'HOST_FAILURE');
  return result.value;
}
export function createSurfaceHost(container, binding) {
  const scope = Object.freeze({...binding});
  const sessions = new Set(); let active, pending, closed = false, generation = 0;
  async function preview(payload) {
    if (closed) throw new Error('HOST_DISCONNECTED');
    const revision = ++generation;
    const grant = await hostCommand(scope,'modules.preview',payload);
    if (closed) { await hostCommand(scope,'modules.dispose',{handle:grant.handle}); throw new Error('HOST_DISCONNECTED'); }
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox','allow-scripts');
    frame.setAttribute('referrerpolicy','no-referrer');
    frame.title = 'TAi 组件预览'; frame.className = 'component-frame'; frame.hidden = true;
    let port, connected = false, disposed = false, loadCount = 0, inflight = 0, lastId = 0, timer;
    let resolveLoaded, rejectLoaded;
    const loaded = new Promise((resolve,reject)=>{resolveLoaded=resolve;rejectLoaded=reject;});
    const session = {frame,grant,loaded, async dispose() {
      if (disposed) return;
      disposed = true; clearTimeout(timer); removeEventListener('message',onReady);
      port?.close(); frame.remove(); sessions.delete(session);
      rejectLoaded(new Error('SURFACE_REVOKED'));
      if (active === session) active = undefined;
      if (pending === session) pending = undefined;
      await hostCommand(scope,'modules.dispose',{handle:grant.handle}).catch(()=>{});
    }};
    function onReady(event) {
      if (disposed || connected || event.source !== frame.contentWindow || event.origin !== 'null' ||
          event.data?.kind !== 'tai.surface.ready' || event.data.instance !== grant.handle || event.data.nonce !== grant.nonce) return;
      connected = true;
      const channel = new MessageChannel(); port = channel.port1;
      port.onmessage = async event => {
        const message = event.data;
        if (disposed) return;
        if (message?.kind === 'tai.surface.loaded') { clearTimeout(timer); resolveLoaded(session); return; }
        if (message?.kind === 'tai.surface.failed') { rejectLoaded(new Error('PREVIEW_FAILED')); return; }
        if (!Number.isSafeInteger(message?.id) || message.id <= lastId || typeof message.op !== 'string') return;
        lastId = message.id;
        const reply = response => { if (!disposed) port.postMessage({id:message.id,...response}); };
        let bytes; try { bytes = new TextEncoder().encode(JSON.stringify(message)).length; } catch { return; }
        if (bytes > 100000 || inflight >= 16 || !message.args || typeof message.args !== 'object' || Array.isArray(message.args)) {
          reply({ok:false,error:'QUOTA_EXCEEDED'}); return;
        }
        // Handle and Profile/Space are captured here; the child never supplies them.
        if (!['storage.get','storage.set','notifications.show','clips.search','clips.read','clips.capture','reader.copyPath'].includes(message.op)) {
          reply({ok:false,error:'CAPABILITY_UNAVAILABLE'}); return;
        }
        inflight++;
        try { const value = await hostCommand(scope,'modules.call',{handle:grant.handle,op:message.op,args:message.args}); reply({ok:true,value}); }
        catch(error) { reply({ok:false,error:error.message}); }
        finally { inflight--; }
      };
      frame.contentWindow.postMessage({kind:'tai.surface.connect',instance:grant.handle,nonce:grant.nonce},'*',[channel.port2]);
    }
    addEventListener('message',onReady);
    frame.addEventListener('load',()=>{ if (++loadCount > 1) void session.dispose(); });
    timer = setTimeout(()=>rejectLoaded(new Error('PREVIEW_TIMEOUT')),12000);
    sessions.add(session); frame.src = grant.url; container.append(frame);
    try { await loaded; if (disposed || revision !== generation) throw new Error('SURFACE_REVOKED'); }
    catch(error) { await session.dispose(); throw error; }
    if (pending && pending !== active) await pending.dispose();
    pending = session; frame.hidden = false;
    if (active) active.frame.hidden = true;
    return session;
  }
  return Object.freeze({preview,
    async apply(session = pending) {
      if (!session || !sessions.has(session) || session !== pending) throw new Error('PREVIEW_NOT_READY');
      try { await hostCommand(scope,'modules.apply',{handle:session.grant.handle}); }
      catch(error) {
        ++generation;
        await Promise.all([...sessions].filter(item=>item!==active).map(item=>item.dispose()));
        if(active)active.frame.hidden=false;
        throw error;
      }
      if(closed||!sessions.has(session)||session!==pending)throw new Error('SURFACE_REVOKED');
      const previous = active; active = session; pending = undefined; session.frame.hidden = false;
      if (previous && previous !== session) await previous.dispose();
    },
    async cancel() { ++generation; await Promise.all([...sessions].filter(s=>s!==active).map(s=>s.dispose())); if (active) active.frame.hidden = false; },
    async dispose() { closed = true; await Promise.all([...sessions].map(session=>session.dispose())); },
  });
}

const $ = id => document.getElementById(id);
if ($('host-status')) void initializePanel();
async function initializePanel() {
  const {mountAgentSetup} = await import('./agent-setup.js');
  let state;
  async function refresh(){
    state=await sendWithPromise('taiGetState');
    if(!state.ready){setTimeout(()=>void refresh(),150);return;}
    const context=await sendWithPromise('taiGetPanelState');
    const selected=$('host-space').value||context.activeSpaceId;
    $('host-space').replaceChildren(...state.spaces.map(space=>new Option(space.name,space.id)));
    if(state.spaces.some(space=>space.id===selected))$('host-space').value=selected;
    $('host-controls').disabled=false;$('host-status').textContent='';
  }
  await refresh();
  mountAgentSetup($('agent-setup'),{space:()=>state.spaces.find(space=>space.id===$('host-space').value)});
  addEventListener('hashchange',()=>void refresh());
  addWebUiListener('tai-state-changed',()=>void refresh());
}
