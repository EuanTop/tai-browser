// Dev-only source preview on an owned temporary native WebUI.
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {until} from './native_smoke_support.mjs';
export async function injectSettingsPreview(browser,root){
  // Navigation also discards any startup-home listeners before source mounting.
  await browser.call('Page.navigate',{url:'chrome://tai/library.html'});
  await until(()=>browser.evaluate("location.pathname==='/library.html'&&document.readyState==='complete'"));
  const source=name=>readFile(join(root,'src/chromium/webui',name),'utf8');
    const tree=await browser.call('Page.getFrameTree');let html=await source('tai.html');html=html.replace(/<script[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link[^>]*rel="stylesheet"[^>]*>/g,'');
    await browser.call('Page.setDocumentContent',{frameId:tree.frameTree.frame.id,html});
    for(const name of ['tai.css','agent-setup.css'])await browser.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(await source(name))};document.head.append(s);})()`);
    let js=await source('tai.js');js=js.replace("import {sendWithPromise, addWebUiListener} from 'chrome://resources/js/cr.js';","const {sendWithPromise,addWebUiListener}=await import('chrome://resources/js/cr.js');").replace(/import '(chrome:[^']+)';/g,"await import('$1');");
    await browser.evaluate('(async()=>{'+js+'})()');
    let agent=await source('settings-agent.js');agent=agent.replace("import {sendWithPromise,addWebUiListener} from 'chrome://resources/js/cr.js';","const{sendWithPromise,addWebUiListener}=await import('chrome://resources/js/cr.js');").replace("import {mountAgentSetup} from './agent-setup.js';","const{mountAgentSetup}=await import('chrome://tai/agent-setup.js');");
    await browser.evaluate('(async()=>{'+agent+'})()');
}
