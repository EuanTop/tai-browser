// Actual trusted WebUI code with a synthetic native bridge; no personal config.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
const source=(await readFile(new URL('../../../src/chromium/webui/agent-setup.js',import.meta.url),'utf8')).replace("import {sendWithPromise} from 'chrome://resources/js/cr.js';",'const sendWithPromise=(...args)=>globalThis.setupBridge(...args);');
const {mountAgentSetup}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('browser setup keeps grants fixed, details quiet, focus stable and handles disposed async work',async()=>{
  const {document}=parseHTML('<main></main>');
  const names=['document','addEventListener','removeEventListener','setInterval','clearInterval','setupBridge'];
  const saved=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  let selected={id:'a',name:'A'},requests=[],tasks=[],poll,resolveGrant;
  Object.assign(globalThis,{document,addEventListener(){},removeEventListener(){},setInterval(fn){poll=fn;return 123;},clearInterval(){poll=undefined;}});
  let create=async payload=>{tasks.push({id:'task-a',spaceId:payload.spaceId,commands:payload.commands,used:false});return{ok:true,value:{taskId:'task-a',configFile:'/synthetic/lease.json'}};};
  globalThis.setupBridge=async(name,payload)=>{requests.push([name,payload]);if(name==='taiGetHostState')return{ready:true,agentRuntime:{node:'/synthetic/node',entry:'/synthetic/stdio.mjs',piEntry:'/synthetic/pi.mjs'},tasks:structuredClone(tasks)};if(name==='taiCreateTask')return create(payload);if(name==='taiRevokeTask'){tasks=tasks.filter(t=>t.id!==payload);return true;}throw Error(name);};
  const host=document.querySelector('main');let controller;
  try{
    controller=mountAgentSetup(host,{space:()=>selected});await controller.ready;
    assert.equal(host.querySelectorAll('input').length,1);
    assert.equal(host.querySelector('.agent-guide').hidden,true);
    assert.equal(host.querySelector('.agent-advanced').hasAttribute('open'),false);
    assert.equal(host.querySelector('.agent-limit').hasAttribute('open'),false);
    await host.querySelector('.agent-create').onclick();
    const grant=requests.find(([name])=>name==='taiCreateTask')[1];
    assert.deepEqual(grant,{spaceId:'a',commands:['page.list','page.read'],libraries:[],provider:'codex'});
    assert.equal(host.querySelector('.agent-guide').hidden,false);
    assert.match(host.querySelector('.agent-verification').textContent,/等待客户端连接/);
    tasks[0].connected=true;await controller.refresh();assert.match(host.querySelector('.agent-verification').textContent,/已连接 · 尚未调用工具/);
    tasks[0].used=true;await controller.refresh();assert.match(host.querySelector('.agent-verification').textContent,/已调用工具/);
    const revoke=host.querySelector('.agent-task button');await controller.refresh();
    assert.equal(host.querySelector('.agent-task button'),revoke,'poll must not replace a keyboard-focused revoke control');
    selected={id:'b',name:'B'};await controller.refresh();
    assert.equal(host.querySelector('.agent-guide').hidden,true);assert.equal(tasks[0].spaceId,'a');
    host.querySelector('[data-provider=claude]').onclick();
    create=payload=>new Promise(resolve=>{resolveGrant=()=>{tasks.push({id:'task-b',spaceId:payload.spaceId,commands:payload.commands,used:false});resolve({ok:true,value:{taskId:'task-b',configFile:'/synthetic/b.json'}});};});
    const pending=host.querySelector('.agent-create').onclick();
    assert.equal(host.querySelector('[data-provider=codex]').disabled,true);
    selected={id:'c',name:'C'};resolveGrant();await pending;
    assert.equal(tasks.at(-1).spaceId,'b','in-flight grant must keep its original target');
    assert.match(host.querySelector('.agent-command').textContent,/claude mcp add/);
    assert.equal(host.querySelector('.agent-guide').hidden,true,'late grant must not show as belonging to the new Space');
    Object.defineProperty(document,'hidden',{value:true,configurable:true});const count=requests.length;poll();await Promise.resolve();assert.equal(requests.length,count);
    let late;globalThis.setupBridge=()=>new Promise(resolve=>{late=resolve;});const refresh=controller.refresh();controller.dispose();const html=host.toString();late({ready:true,tasks:[]});await refresh;assert.equal(host.toString(),html);assert.equal(poll,undefined);
  }finally{controller?.dispose();for(const[name,descriptor]of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}}
});
