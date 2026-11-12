#!/usr/bin/env node
// Copyright 2026 TAi Browser contributors. SPDX-License-Identifier: BSD-3-Clause
// Renderer-only compatibility probe with synthetic data. Does not validate TAi's native scope or MCP.
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {startNativeBrowser,until} from './native_smoke_support.mjs';
const [binaryArg]=process.argv.slice(2);
if(!binaryArg)throw new Error('Expected an explicit Chromium-compatible test binary');
const root=resolve(import.meta.dirname,'..'),local=join(root,'research/local');await mkdir(local,{recursive:true});
const profile=await mkdtemp(join(tmpdir(),'tai-control-dom-'));
const script=await readFile(join(root,'src/chromium/host/page_interaction.js'),'utf8');
const server=createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><title>TAi control fixture</title>
<label>Query<input id="query" value="PRIVATE_INPUT"></label><textarea>PRIVATE_TEXTAREA</textarea>
<label>Notes<textarea>PRIVATE_WRAPPED</textarea></label><div role="textbox" contenteditable>PRIVATE_EDITABLE</div>
<textarea id="draft">PRIVATE_LABELLED</textarea><button aria-labelledby="draft">Fallback</button>
<button id="go" onclick="document.querySelector('output').textContent=Number(document.querySelector('output').textContent)+1">Go</button><output>0</output>
<button disabled>Disabled</button><button hidden>Hidden</button><input type="file" aria-label="Upload"><a target="_blank" href="/next">New window</a><a download href="/file">Download file</a><input type="password" aria-label="Password" value="PRIVATE_PASSWORD">
<iframe srcdoc="<button>Frame only</button>"></iframe><div id="shadow"></div><script>document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<button>Shadow only</button>';</script>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const checks=[];let browser,contextId,version;
const expect=(check,ok)=>{checks.push({check,passed:!!ok});console.log((ok?'PASS ':'FAIL ')+check);if(!ok)throw new Error(check);};
try{
 browser=await startNativeBrowser(resolve(binaryArg),profile,{product:false,initialURL:'about:blank',navigate:false});
 version=await browser.call('Browser.getVersion');
 await browser.call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/'});
 await until(()=>browser.evaluate("document.readyState==='complete'&&document.title==='TAi control fixture'"));
 const {frameTree}=await browser.call('Page.getFrameTree');
 ({executionContextId:contextId}=await browser.call('Page.createIsolatedWorld',{frameId:frameTree.frame.id,worldName:'tai-control-probe'}));
 const execute=async args=>{const r=await browser.call('Runtime.evaluate',{expression:script+'('+JSON.stringify(args)+')',contextId,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const observe=(owner='fixture')=>execute({mode:'read',owner,snapshotId:randomUUID()});
 const act=(s,name,action='click',extra={})=>execute({mode:'act',owner:'fixture',snapshotId:s.snapshotId,ref:s.controls.find(c=>c.name===name).ref,action,...extra});
 let s=await observe();
 expect('isolated-world controls omit native, wrapped and contenteditable input values',!JSON.stringify(s).includes('PRIVATE_'));
 expect('labels provide bounded field names and refs',s.controls.some(c=>c.name==='Query'&&c.role==='textbox'&&/^e\d+$/u.test(c.ref)));
 expect('coverage excludes hidden, iframe and shadow-root controls',!s.controls.some(c=>['Hidden','Frame only','Shadow only'].includes(c.name))&&s.coverage.includes('main-frame'));
 expect('disabled click does not dispatch',(await act(s,'Disabled')).reason==='NOT_ENABLED');
 expect('password fill does not dispatch',(await act(s,'Password','fill',{value:'FORBIDDEN'})).reason==='SENSITIVE_FIELD');
 expect('file picker requires a human',(await act(s,'Upload')).reason==='HUMAN_REQUIRED');
 expect('known new-window and download links require the human', (await act(s,'New window')).reason==='HUMAN_REQUIRED'&&(await act(s,'Download file')).reason==='HUMAN_REQUIRED');
 expect('legacy selector uses the same visibility and human-handoff checks', (await execute({mode:'act',owner:'fixture',selector:'input[type="file"]',action:'click'})).reason==='HUMAN_REQUIRED');
 expect('a separate owner cannot reuse the reference',(await execute({mode:'act',owner:'other',snapshotId:s.snapshotId,ref:s.controls[0].ref,action:'click'})).reason==='STALE_SNAPSHOT');
 expect('named click dispatches once',(await act(s,'Go')).performed&&await browser.evaluate("document.querySelector('output').textContent==='1'"));
 expect('consumed snapshot cannot repeat a write',(await act(s,'Go')).reason==='STALE_SNAPSHOT');
 s=await observe();expect('named text fill dispatches',(await act(s,'Query','fill',{value:'Allowed'})).performed&&await browser.evaluate("document.querySelector('#query').value==='Allowed'"));
 const old=await observe();s=await observe();expect('new interactive observation replaces old references',(await act(old,'Go')).reason==='STALE_SNAPSHOT');
 await browser.evaluate("document.querySelector('#go').textContent='Changed'");
 expect('same-document mutation invalidates old controls',(await act(s,'Go')).reason==='STALE_SNAPSHOT');
 s=await observe();await browser.evaluate("document.querySelector('#query').value='Human';document.querySelector('#query').dispatchEvent(new Event('input',{bubbles:true}))");
 expect('input changes invalidate references without attribute mutations',(await act(s,'Query','fill',{value:'MUST_NOT_OVERWRITE'})).reason==='STALE_SNAPSHOT'&&await browser.evaluate("document.querySelector('#query').value==='Human'"));
 s=await observe();await new Promise(r=>setTimeout(r,31000));
 expect('an idle snapshot expires in the renderer',(await act(s,'Changed')).reason==='STALE_SNAPSHOT');
 await browser.evaluate("document.body.replaceChildren(...Array.from({length:250},(_,i)=>{const b=document.createElement('button');b.textContent='Action '+i;return b}))");
 s=await observe();expect('large inventories are bounded and marked truncated',s.controls.length===200&&s.truncated&&Buffer.byteLength(JSON.stringify(s))<100000);
}catch(error){checks.push({check:'probe completion',passed:false,error:String(error)});process.exitCode=1;console.error(error);}
finally{await browser?.stop();await new Promise(r=>server.close(r));const receipt={passed:checks.every(c=>c.passed),checks,profile,version,finishedAt:new Date().toISOString(),scope:'isolated-world DOM helper on the explicitly selected browser; synthetic local fixture only, not TAi native/MCP integration or desktop concurrency'};await writeFile(join(local,'page-controls-dom-smoke.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));}
