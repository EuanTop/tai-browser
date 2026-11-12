import {createComponentSDK} from '../../../modules/component-sdk/index.mjs';
const boot=globalThis.__TAI_BOOT__;
delete globalThis.__TAI_BOOT__;
let connected=false,port;const waiting=new Map();let sequence=0;
function invoke(op,args={}){
  if(!port)return Promise.reject(new Error('HOST_DISCONNECTED'));
  const id=++sequence;
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{waiting.delete(id);reject(new Error('HOST_TIMEOUT'));},15000);waiting.set(id,{resolve,reject,timer});port.postMessage({id,op,args});});
}
addEventListener('message',event=>{
  if(connected||event.source!==parent||event.origin!=='chrome://tai'||event.data?.kind!=='tai.surface.connect'||event.data?.instance!==boot.instance||event.data?.nonce!==boot.nonce||event.ports.length!==1)return;
  connected=true;port=event.ports[0];
  port.onmessage=event=>{const message=event.data,entry=waiting.get(message?.id);if(!entry||typeof message.ok!=='boolean')return;clearTimeout(entry.timer);waiting.delete(message.id);message.ok?entry.resolve(message.value):entry.reject(new Error(message.error||'HOST_FAILURE'));};
  const sdk=createComponentSDK(boot.manifest,{storage:{get:key=>invoke('storage.get',{key}),set:(key,value)=>invoke('storage.set',{key,value})},notify:text=>invoke('notifications.show',{text}),clips:{search:query=>invoke('clips.search',{query}),read:id=>invoke('clips.read',{id}),capture:()=>invoke('clips.capture')}});
  Object.defineProperty(globalThis,'taiComponentSDK',{value:sdk,writable:false,configurable:false});
  Object.defineProperty(globalThis,'taiSurfaceInput',{value:boot.input,writable:false});
  if(boot.manifest.id==='tai.reader')Object.defineProperty(globalThis,'taiReaderActions',{value:Object.freeze({copyPath:path=>invoke('reader.copyPath',{path})}),writable:false});
  const blob=URL.createObjectURL(new Blob([boot.script],{type:'text/javascript'}));
  // A module element's load event does not await top-level async evaluation.
  // Dynamic import resolves only after the entire module/TLA has initialized.
  void import(blob).then(()=>{
    URL.revokeObjectURL(blob);port?.postMessage({kind:'tai.surface.loaded'});
  },()=>{
    URL.revokeObjectURL(blob);port?.postMessage({kind:'tai.surface.failed'});
  });
},{once:false});
parent.postMessage({kind:'tai.surface.ready',instance:boot.instance,nonce:boot.nonce},'chrome://tai');
addEventListener('pagehide',()=>{port?.close();port=undefined;for(const entry of waiting.values()){clearTimeout(entry.timer);entry.reject(new Error('HOST_DISCONNECTED'));}waiting.clear();},{once:true});
