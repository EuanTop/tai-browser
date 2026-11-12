// Synthetic test instances only. Never attach to a user browser.
import {spawn} from 'node:child_process';
import {readFile,open} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
export async function until(fn,ms=25000){const end=Date.now()+ms;let error;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(e){error=e;}await delay(100);}throw error||new Error('Timed out');}
export async function startNativeBrowser(binary,profile,{product=true,extra=[],initialURL='chrome://tai/',navigate=true,headless=true}={}){
  const diagnostic=process.env.TAI_TEST_DIAGNOSTICS==='1'?await open(join(profile,'browser-diagnostics.log'),'a'):null;
  const child=spawn(binary,[...(headless?['--headless']:[]),...extra,...(product?['--sidebar-browser']:[]),'--user-data-dir='+profile,'--use-mock-keychain','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--remote-debugging-port=0',...(initialURL?[initialURL]:[])],{detached:true,stdio:['ignore',diagnostic?.fd??'ignore',diagnostic?.fd??'ignore']});
  await diagnostic?.close();
  const events=[];let ws;const pending=new Map();let next=0;
  const exited=new Promise(resolveExit=>child.once('exit',resolveExit));
  const alive=()=>child.exitCode===null&&child.signalCode===null;
  const stop=async()=>{try{if(ws?.readyState===1)await call('Browser.close');}catch{}ws?.close();await Promise.race([exited,delay(5000)]);if(alive()){try{process.kill(-child.pid,'SIGTERM');}catch{}await Promise.race([exited,delay(2000)]);if(alive()){try{process.kill(-child.pid,'SIGKILL');}catch{}await exited;}}};
  const call=(method,params={},sessionId)=>new Promise((res,rej)=>{const id=++next,timer=setTimeout(()=>{pending.delete(id);rej(new Error('CDP timeout: '+method));},15000);pending.set(id,{res,rej,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  try{
    const target=await until(async()=>{if(!alive())throw new Error('Synthetic browser exited');const text=await readFile(join(profile,'DevToolsActivePort'),'utf8');const port=Number(text.split('\n')[0]);if(!(port>0&&port<65536))return false;const list=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();const pages=list.filter(t=>t.type==='page'&&t.url!=='chrome://tai/welcome.html');return pages.find(t=>t.url.startsWith('chrome://tai/'))||pages[0];});
    ws=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
    ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method){events.push(message);if(events.length>1000)events.shift();}const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.rej(new Error(message.error.message)):entry.res(message.result);});
    ws.addEventListener('close',()=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.rej(new Error('CDP closed'));}pending.clear();});
    const evaluate=async (expression,sessionId)=>{const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(result.exceptionDetails)throw new Error(result.exceptionDetails.text+': '+result.exceptionDetails.exception?.description);return result.result.value;};
    // Session restore can replace a requested settings startup URL with TAi
    // Home. Wait for the initial document and only navigate if it differs.
    const loaded = await until(async()=>{
      const state=await evaluate("({ready:document.readyState==='complete',settings:!!document.querySelector('#space-form')})");
      return state.ready&&state;
    });
    if(product&&navigate&&!loaded.settings){
      const result=await call('Page.navigate',{url:'chrome://tai/'});
      if(result.errorText)throw new Error('Could not open TAi settings: '+result.errorText);
    }
    if(product&&navigate){
      try {
        await until(()=>evaluate("document.readyState==='complete'&&location.origin==='chrome://tai'&&!!document.querySelector('#space-form')"));
      }catch(error){
        const current=await evaluate("({url:location.href,ready:document.readyState})").catch(()=>null);
        throw new Error('TAi settings did not initialize: '+JSON.stringify(current),{cause:error});
      }
    }
    const state=()=>evaluate(`import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiGetState'))`);
    const command=request=>evaluate(`import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiCommand',${JSON.stringify(request)}))`);
    return{stop,call,evaluate,state,command,profile,events,pid:child.pid};
  }catch(error){await stop();throw error;}
}

export async function findWelcomeDialog(browser) {
  const target = await until(async () => {
    const {targetInfos} = await browser.call('Target.getTargets');
    return targetInfos.find(info => info.url === 'chrome://tai/welcome.html');
  });
  const {sessionId} = await browser.call('Target.attachToTarget', {targetId: target.targetId, flatten: true});
  await until(() => browser.evaluate("document.readyState==='complete'&&!!document.querySelector('main.welcome:not([hidden])')", sessionId));
  return {sessionId, targetId: target.targetId};
}
