#!/usr/bin/env node
// Official MCP client -> owned stdio adapter -> real native host. No inference.
import {Client} from '../modules/agent-tools/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import {StdioClientTransport} from '../modules/agent-tools/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';
import {ResourceUpdatedNotificationSchema} from '../modules/agent-tools/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import {startNativeBrowser,until} from './native_smoke_support.mjs';
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
const [binaryArg,rootArg]=process.argv.slice(2);
if(!binaryArg||!rootArg)throw new Error('Expected explicit binary and root');
const binary=resolve(binaryArg),root=resolve(rootArg),local=join(root,'research/local');
await mkdir(join(local,'browser-profiles'),{recursive:true});const profile=await mkdtemp(join(local,'browser-profiles/tai-mcp-'));
await mkdir(join(profile,'Default'));await writeFile(join(profile,'Default/SidebarWorkspace.json'),JSON.stringify({version:1,active:'user-space',spaces:[{id:'user-space',name:'User'},{id:'task-space',name:'Agent'}],items:[]}));
const server=createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');
if(req.url==='/many'){res.end('<!doctype html><title>Bounded controls</title>'+Array.from({length:250},(_,i)=>'<button>Action '+i+'</button>').join(''));return;}
res.end(`<!doctype html><title>Native MCP fixture</title>
<article><h1>Untrusted page text ✓</h1><p>A quiet courtyard provides space for thinking, reading, and keeping meaningful research. This is synthetic public article text used to verify reading through the actual MCP transport.</p></article>
<label for="field">Search query</label><input id="field" value="PRIVATE_SYNTHETIC_VALUE">
<button id="increment" onclick="document.querySelector('output').textContent=Number(document.querySelector('output').textContent)+1">Increment</button><output>0</output>
<button id="slow" onclick="const end=performance.now()+1200;while(performance.now()&lt;end){}">Slow local action</button>
<label>Password<input type="password" value="SYNTHETIC_PASSWORD"></label>
<textarea>PRIVATE_UNLABELED_DRAFT</textarea><label>Notes<textarea>PRIVATE_WRAPPED_DRAFT</textarea></label>
<textarea id="private-name">PRIVATE_LABELLED_DRAFT</textarea><button aria-labelledby="private-name">Fallback</button>
<div role="textbox" contenteditable="true">PRIVATE_CUSTOM_DRAFT</div>
<button hidden>Hidden action</button><button disabled>Disabled action</button><input aria-label="Upload" type="file">
<iframe title="Uncovered frame" srcdoc="<button>Frame action</button>"></iframe>
<div style="height:3500px"></div><footer style="height:700px;background:#7928bc">Page bottom fixture</footer>`);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/agent';
const fixture=await mkdtemp(join(local,'browser-profiles/library-mcp-'));
const checks=[],measurements=[];let browser,client,transport,runtime,rememberedClient,rememberedTransport,diagnostics='';
function expect(name,ok){checks.push({check:name,passed:!!ok});console.log((ok?'PASS ':'FAIL ')+name);if(!ok)throw new Error(name);}
const send=(name,...args)=>browser.evaluate(`import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise(${JSON.stringify(name)},...${JSON.stringify(args)}))`);
function connectionTransport(file){
  return new StdioClientTransport({command:runtime?.node||process.execPath,
    args:[runtime?.entry||join(root,'modules/agent-tools/native-stdio.mjs'),'--connection-file',file],stderr:'pipe'});
}
async function call(name,args={}){const start=performance.now();const result=await client.callTool({name,arguments:args},undefined,{timeout:15000});
  measurements.push({tool:name,...(args.format?{format:args.format}:{}),durationMs:Math.round((performance.now()-start)*100)/100,responseBytes:Buffer.byteLength(JSON.stringify(result)),isError:!!result.isError});
  return {raw:result,value:JSON.parse(result.content[0].text)};}
try{
  browser=await startNativeBrowser(binary,profile,{extra:['--test-type=tai-host','--tai-host-fixture-directory='+fixture]});const state=await until(async()=>{const s=await browser.state();const h=await send('taiGetHostState');return s.ready&&h.ready&&s;});
  runtime=(await send('taiGetHostState')).agentRuntime;
  const gesture=await browser.call('Runtime.evaluate',{expression:"import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiCreateTask',{spaceId:'task-space',commands:['page.list','page.open','page.read','page.act','page.screenshot'],libraries:[]}))",awaitPromise:true,returnByValue:true,userGesture:true});
  const lease=gesture.result.value;expect('native UI grants explicit MCP task',lease?.ok);
  const secret=JSON.parse(await readFile(lease.value.configFile,'utf8')).token;
  transport=connectionTransport(lease.value.configFile);
  client=new Client({name:'tai-native-synthetic-review',version:'1.0.0'},{capabilities:{}});
  transport.stderr?.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString()).slice(-16384);});
  await client.connect(transport);
  const tools=await client.listTools();
  expect('official MCP lists exactly native-granted page tools',tools.tools.map(t=>t.name).sort().join(',')==='tai_page_act,tai_page_list,tai_page_open,tai_page_read,tai_page_screenshot,tai_task_status');
  let result=await call('tai_page_open',{url});expect('MCP open reaches real native browser with pending result',result.value.ok&&result.value.value.pending&&result.value.scope.spaceId==='task-space');
  const opened=result.value.value;
  const page=await until(async()=>{const list=await call('tai_page_list');return list.value.value.find(p=>p.pageId===opened.pageId&&p.url===url&&p.pageRevision>opened.pageRevision);});
  expect('MCP list returns actual native page identity',typeof page.pageId==='string'&&Number.isInteger(page.pageRevision));
  const ref={pageId:page.pageId,pageRevision:page.pageRevision};
  result=await until(async()=>{const r=await call('tai_page_read',ref);return r.value.ok&&r;});
  expect('MCP read returns native content and verified fixed scope',result.value.value.text.includes('Untrusted page text ✓')&&result.value.value.scope.profileId===state.profileId&&result.value.scope.taskId===lease.value.taskId);
  const pause=async paused=>{
    const expression="import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiSetTaskPaused',"+JSON.stringify(lease.value.taskId)+","+paused+"))";
    const {result}=await browser.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});
    return result.value;
  };
  const initial=(await call('tai_task_status')).value.value;
  expect('status returns bound state with a cursor',initial.state==='ready'&&Number.isInteger(initial.cursor));
  const statusUri='tai://task/status';
  const update=Promise.withResolvers();
  client.setNotificationHandler(ResourceUpdatedNotificationSchema,({params})=>update.resolve(params.uri));
  await client.subscribeResource({uri:statusUri});
  expect('user can pause an authorized connection from TAi',await pause(true));
  let statusDeadline;
  try{
    const resourceUpdate=await Promise.race([update.promise,new Promise((_,reject)=>{
      statusDeadline=setTimeout(()=>reject(new Error('No native task status resource update')),7000);
    })]);
    const {contents:[resource]}=await client.readResource({uri:statusUri});
    const resourceStatus=JSON.parse(resource.text);
    expect('subscribed MCP clients get a real native pause update',
      resourceUpdate===statusUri&&resourceStatus.ok&&resourceStatus.state==='paused');
  }finally{
    clearTimeout(statusDeadline);
    await client.unsubscribeResource({uri:statusUri});
  }
  let status=(await call('tai_task_status',{after:initial.cursor})).value.value;
  expect('MCP observes the pause via an incremental cursor',status.state==='paused'&&status.reason==='USER_PAUSED'&&status.events.some(e=>e.event==='paused'));
  result=await call('tai_page_act',{...ref,action:'click',selector:'#increment'});
  expect('native pause refuses writes but allows observation',result.value.error.code==='TASK_PAUSED'&&(await call('tai_page_read',ref)).value.ok);
  expect('a manual task pause still blocks opening pages',
    (await call('tai_page_open',{url:url+'?paused'})).value.error.code==='TASK_PAUSED');
  expect('user can resume a paused connection from TAi',await pause(false));
  const userRequest={protocol:'tai.v1',id:'user-open',command:'page.open',scope:{profileId:state.profileId,spaceId:'user-space'},payload:{url:url+'?user'}};
  const user=await send('taiHost',userRequest);
  const target=await until(async()=>{const {targetInfos}=await browser.call('Target.getTargets');return targetInfos.find(t=>t.type==='page'&&t.url===url+'?user');});
  const {sessionId}=await browser.call('Target.attachToTarget',{targetId:target.targetId,flatten:true});await browser.call('Target.activateTarget',{targetId:target.targetId});
  await browser.evaluate("document.querySelector('#field').focus();document.querySelector('#field').value='User typing independently'",sessionId);
  const {targetInfos:screenshotTargets}=await browser.call('Target.getTargets');
  const agentTarget=screenshotTargets.find(t=>t.type==='page'&&t.url===url);
  const {sessionId:agentSession}=await browser.call('Target.attachToTarget',{targetId:agentTarget.targetId,flatten:true});
  const originalScroll=await browser.evaluate('window.scrollY',agentSession);
  const topShot=await call('tai_page_screenshot',ref);
  const bottomShot=await call('tai_page_screenshot',{...ref,position:'bottom'});
  for(const shot of [topShot,bottomShot]) {
    if(!shot.value.ok) {
      const {cssLayoutViewport,cssContentSize}=await browser.call('Page.getLayoutMetrics',{},agentSession);
      throw new Error('Screenshot failed: '+shot.value.error?.code+' '+JSON.stringify({cssLayoutViewport,cssContentSize}));
    }
  }
  const topImage=topShot.raw.content.find(part=>part.type==='image');
  const bottomImage=bottomShot.raw.content.find(part=>part.type==='image');
  expect('viewport and bottom screenshots return distinct bounded PNG images',
    [topShot,bottomShot].every(({value},index)=>value.ok&&value.value.position===['viewport','bottom'][index]&&
      value.value.width>0&&value.value.width<=1600&&value.value.height>0&&value.value.height<=1200)&&
    [topImage,bottomImage].every(image=>image?.mimeType==='image/png')&&topImage.data!==bottomImage.data);
  expect('background capture preserves target scroll and other Space input focus',
    (await browser.evaluate('window.scrollY',agentSession))===originalScroll&&
    await browser.evaluate("document.hasFocus()&&document.activeElement.id==='field'&&document.querySelector('#field').value==='User typing independently'",sessionId));
  const {attachmentPath,attachmentMarkdown}=bottomShot.value.value;
  expect('the final reply can embed the exact screenshot from a private attachment',
    attachmentMarkdown===`![TAi page screenshot](<${attachmentPath}>)`&&
    (await readFile(attachmentPath)).equals(Buffer.from(bottomImage.data,'base64')));
  const staleShot=await call('tai_page_screenshot',{...ref,pageRevision:opened.pageRevision});
  expect('screenshot rejects an older document revision',staleShot.raw.isError&&staleShot.raw.content.every(part=>part.type==='text'));
  result=await call('tai_page_act',{...ref,action:'fill',selector:'#field',value:'MCP filled ✓'});expect('MCP bounded fill executes in background',result.value.ok&&result.value.value.performed);
  result=await call('tai_page_act',{...ref,action:'click',selector:'#increment'});expect('MCP bounded click executes in background',result.value.ok&&result.value.value.performed);
  result=await call('tai_page_read',ref);expect('MCP action changes real background DOM',result.value.ok&&result.value.value.text.includes('1'));
  const interactive=async()=>{const r=await call('tai_page_read',{...ref,format:'interactive'});expect('interactive observation is scoped and succeeds',r.value.ok&&r.value.value.scope.spaceId==='task-space');return r.value.value;};
  const actRef=(snapshot,item,action='click',extra={})=>call('tai_page_act',{...ref,snapshotId:snapshot.snapshotId,ref:item.ref,action,...extra});
  let snapshot=await interactive();
  expect('compact controls return names and refs without HTML or field values',snapshot.controls.some(e=>e.name==='Search query'&&e.role==='textbox')&&
    !snapshot.controls.some(e=>e.name==='Hidden action'||e.name==='Frame action')&&snapshot.coverage.includes('main-frame')&&
    !JSON.stringify(snapshot).includes('PRIVATE_')&&!JSON.stringify(snapshot).includes('SYNTHETIC_PASSWORD')&&!snapshot.html);
  let field=snapshot.controls.find(e=>e.name==='Search query');
  result=await actRef(snapshot,field,'fill',{value:'Semantic fill ✓'});
  expect('MCP fills a named reference in the background',result.value.ok&&result.value.value.performed&&result.value.value.verification.startsWith('dispatched'));
  result=await actRef(snapshot,field,'fill',{value:'MUST_NOT_REPEAT'});
  expect('a dispatched action consumes its snapshot without automatic retry',result.value.ok&&!result.value.value.performed&&result.value.value.reason==='STALE_SNAPSHOT');
  const obsolete=snapshot;snapshot=await interactive();
  result=await actRef(obsolete,field);
  expect('new observation invalidates previous references',!result.value.value.performed&&result.value.value.reason==='STALE_SNAPSHOT');
  result=await actRef(snapshot,snapshot.controls.find(e=>e.name==='Disabled action'));
  expect('disabled referenced control is never reported as clicked',!result.value.value.performed&&result.value.value.reason==='NOT_ENABLED');
  result=await actRef(snapshot,snapshot.controls.find(e=>e.sensitive),'fill',{value:'NO_PASSWORD_FILL'});
  expect('sensitive reference refuses password fill',!result.value.value.performed&&result.value.value.reason==='SENSITIVE_FIELD');
  snapshot=await interactive();
  result=await actRef(snapshot,snapshot.controls.find(e=>e.name==='Upload'));
  expect('native file picker is handed back to the human',!result.value.value.performed&&result.value.value.reason==='HUMAN_REQUIRED');
  status=(await call('tai_task_status')).value.value;
  expect('the human handoff pauses the task and names its authorized page',status.state==='paused'&&status.reason==='HUMAN_REQUIRED'&&status.pageId===ref.pageId);
  const show=await browser.call('Runtime.evaluate',{
    expression:"import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiRevealTaskPage',"+JSON.stringify(lease.value.taskId)+"))",
    awaitPromise:true,returnByValue:true,userGesture:true});
  expect('local handoff opens the exact task page',
    show.result.value&&(await send('taiGetPanelState')).activeSpaceId==='task-space');
  await browser.call('Target.activateTarget',{targetId:target.targetId});
  expect('user explicitly resumes after a human handoff',await pause(false));
  snapshot=await interactive();
  result=await call('tai_page_act',{...ref,action:'fill',selector:'#field',value:'A different writer changed the field'});
  result=await actRef(snapshot,snapshot.controls.find(e=>e.name==='Search query'),'fill',{value:'MUST_NOT_OVERWRITE'});
  expect('input changes invalidate references even without a DOM attribute mutation',!result.value.value.performed&&result.value.value.reason==='STALE_SNAPSHOT');
  snapshot=await interactive();
  result=await call('tai_page_act',{...ref,action:'click',selector:'#increment'});
  result=await actRef(snapshot,snapshot.controls.find(e=>e.name==='Increment'));
  expect('same-document DOM changes invalidate old references',!result.value.value.performed&&result.value.value.reason==='STALE_SNAPSHOT');
  snapshot=await interactive();
  result=await actRef(snapshot,snapshot.controls.find(e=>e.name==='Increment'));
  expect('fresh named control clicks once after re-observation',result.value.ok&&result.value.value.performed);
  result=await call('tai_page_read',ref);
  expect('read after action verifies the actual DOM result',result.value.value.text.includes('3'));
  expect('complete MCP route preserves other Space website focus and input',await browser.evaluate("document.hasFocus()&&document.activeElement.id==='field'&&document.querySelector('#field').value==='User typing independently'",sessionId));
  await interactive();
  const manyOpened=await call('tai_page_open',{url:new URL('/many',url).href});
  const manyPage=await until(async()=>{const r=await call('tai_page_list');return r.value.value.find(p=>p.pageId===manyOpened.value.value.pageId&&!p.loading&&p.pageRevision>manyOpened.value.value.pageRevision);});
  const manyRef={pageId:manyPage.pageId,pageRevision:manyPage.pageRevision};
  const many=(await call('tai_page_read',{...manyRef,format:'interactive'})).value.value;
  expect('large control inventories are bounded and explicitly truncated',many.controls.length===200&&many.truncated&&Buffer.byteLength(JSON.stringify(many))<100000);
  result=await call('tai_page_act',{...ref,snapshotId:many.snapshotId,ref:many.controls[0].ref,action:'click'});
  expect('an element reference cannot be substituted onto another page',!result.value.value.performed&&result.value.value.reason==='STALE_SNAPSHOT');
  await new Promise(resolve=>setTimeout(resolve,31000));
  result=await call('tai_page_act',{...manyRef,snapshotId:many.snapshotId,ref:many.controls[0].ref,action:'click'});
  expect('idle snapshot expires in the actual renderer without dispatching',!result.value.value.performed&&result.value.value.reason==='STALE_SNAPSHOT');
  const secondGrant=await browser.call('Runtime.evaluate',{
    expression:"import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiCreateTask',{spaceId:'task-space',commands:['page.list','page.act'],libraries:[]}))",
    awaitPromise:true,returnByValue:true,userGesture:true});
  expect('a second client can receive an independent task',secondGrant.result.value?.ok);
  const secondConfig=secondGrant.result.value.value;
  const secondTransport=connectionTransport(secondConfig.configFile);
  const second=new Client({name:'synthetic-second-agent',version:'1.0.0'});
  try{
    await second.connect(secondTransport);
    const before=(await call('tai_task_status')).value.value.cursor;
    const slow=call('tai_page_act',{...ref,action:'click',selector:'#slow'});
    // Capture either outcome even if the assertion fails before awaiting it.
    void slow.catch(()=>{});
    await until(async()=>{const r=await call('tai_task_status',{after:before});return r.value.value.events.some(e=>e.event==='action_started');},5000);
    const concurrent=await second.callTool({name:'tai_page_act',arguments:{...ref,action:'click',selector:'#increment'}});
    expect('native host rejects a second write to the same page in flight',
      concurrent.isError&&JSON.parse(concurrent.content[0].text).error.code==='PAGE_BUSY');
    expect('the original write completes independently',(await slow).value.value.performed);
  }finally{
    await second.close().catch(()=>{});
    await secondTransport.close().catch(()=>{});
    await send('taiRevokeTask',secondConfig.taskId);
  }
  expect('observing and opening background pages still preserves user input focus',await browser.evaluate("document.hasFocus()&&document.activeElement.id==='field'&&document.querySelector('#field').value==='User typing independently'",sessionId));
  const {targetInfos}=await browser.call('Target.getTargets');
  const workTarget=targetInfos.find(t=>t.type==='page'&&t.url===url);
  expect('the task page has a distinct Chromium tab',!!workTarget);
  const workSession=(await browser.call('Target.attachToTarget',{targetId:workTarget.targetId,flatten:true})).sessionId;
  await browser.call('Target.activateTarget',{targetId:workTarget.targetId});
  await browser.evaluate("document.querySelector('#field').focus()",workSession);
  await browser.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65},workSession);
  await browser.call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65},workSession);
  status=await until(async()=>{
    const r=await call('tai_task_status');
    return r.value.value.state==='paused'&&r.value.value;
  },5000);
  expect('direct input protects just the page the user is operating',
    status.reason==='USER_EDITING'&&status.pauseScope==='page'&&status.pageId===ref.pageId);
  result=await call('tai_page_act',{...ref,action:'click',selector:'#increment'});
  expect('the Agent cannot write to the page the user is operating',
    result.value.error.code==='PAGE_IN_USE'&&result.value.error.message.includes('Other authorized pages'));
  const secondPageURL=url+'?next';
  const nextPageOpen=await call('tai_page_open',{url:secondPageURL});
  expect('taking over one page still allows opening another in the same Space',
    nextPageOpen.value.ok&&nextPageOpen.value.value.pending);
  const nextPage=await until(async()=>{
    const list=await call('tai_page_list');
    return list.value.value.find(p=>p.pageId===nextPageOpen.value.value.pageId&&p.url===secondPageURL&&!p.loading);
  });
  const nextRef={pageId:nextPage.pageId,pageRevision:nextPage.pageRevision};
  result=await call('tai_page_act',{...nextRef,action:'click',selector:'#increment'});
  expect('the other page can be operated without stealing the foreground tab',
    result.value.ok&&result.value.value.performed&&await browser.evaluate(
      "document.hasFocus()&&document.activeElement.id==='field'",workSession));
  expect('the foreground page stays protected while the other page is used',
    (await call('tai_task_status')).value.value.pageId===ref.pageId);
  await browser.call('Target.activateTarget',{targetId:target.targetId});
  const released=(await call('tai_task_status')).value.value;
  expect('switching away clears the old page takeover',
    released.state==='ready'&&!released.pageId&&!released.pauseScope);
  result=await call('tai_page_read',{pageId:user.value.pageId,pageRevision:user.value.pageRevision});expect('native backend rejects cross-Space reference through MCP',result.raw.isError&&result.value.error.code==='PAGE_NOT_OWNED');
  result=await call('tai_page_read',{...ref,pageRevision:ref.pageRevision-1});expect('native stale version survives MCP without auto-retry',result.raw.isError&&result.value.error.code==='STALE_PAGE');
  result=await call('tai_page_act',{...ref,action:'click',selector:'#increment',spaceId:'user-space'});expect('MCP rejects scope injection before native execution',result.raw.isError&&result.value.error.code==='INVALID_ARGUMENTS');
  result=await call('tai_preview',{});expect('ungranted module capability stays unavailable',result.raw.isError&&result.value.error.code==='CAPABILITY_UNAVAILABLE');
  expect('MCP results never expose connection token',!JSON.stringify({tools,result}).includes(secret));
  await send('taiRevokeTask',lease.value.taskId);
  result=await call('tai_page_list');expect('native revocation survives actual MCP transport',result.raw.isError&&result.value.error.code==='LEASE_REVOKED');
  expect('adapter diagnostics do not expose connection material',!diagnostics.includes(secret)&&!diagnostics.includes(lease.value.configFile));
  for(const command of ['modules.preview','library.read','library.list','library.putIfAbsent','page.screenshot']){
    const result=await browser.call('Runtime.evaluate',{expression:`import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiCreateTask',{spaceId:'task-space',commands:[${JSON.stringify(command)}],libraries:[]}))`,awaitPromise:true,returnByValue:true,userGesture:true});
    expect('unsupported standalone capability is denied: '+command,!result.result.value.ok&&result.result.value.error.code==='CAPABILITY_DENIED');
  }

  // A saved registration is inert until a fresh, fixed-scope gesture renews it.
  const savedCall=await browser.call('Runtime.evaluate',{expression:"import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiCreateTask',{spaceId:'task-space',commands:['page.list','page.read'],libraries:[],provider:'codex'}))",awaitPromise:true,returnByValue:true,userGesture:true});
  const saved=savedCall.result.value;expect('Codex authorization records its chosen provider',saved.ok);
  const beforeConfig=JSON.parse(await readFile(saved.value.configFile,'utf8'));
  const screenshotUpgrade=await browser.call('Runtime.evaluate',{
    expression:"import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiCreateTask',{spaceId:'task-space',commands:['page.list','page.read'],libraries:[],provider:'claude'}))",
    awaitPromise:true,returnByValue:true,userGesture:true});
  const savedUpgrade=screenshotUpgrade.result.value.value;
  const rememberCall=await browser.call('Runtime.evaluate',{
    expression:"import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiCreateTask',{spaceId:'task-space',commands:['page.list','page.open','page.read','page.act','page.screenshot'],libraries:[],provider:'codex',remember:true}))",
    awaitPromise:true,returnByValue:true,userGesture:true});
  const remembered=rememberCall.result.value;
  expect('an explicit remembered grant supports all five page commands',remembered.ok);
  const rememberedFile=remembered.value.configFile;
  const previousRemembered=JSON.parse(await readFile(rememberedFile,'utf8'));
  rememberedTransport=connectionTransport(rememberedFile);
  rememberedClient=new Client({name:'synthetic-remembered-agent',version:'1.0.0'});
  await rememberedClient.connect(rememberedTransport);
  const rememberedCall=async (name,args={})=>{
    const {content}=await rememberedClient.callTool({name,arguments:args});
    return JSON.parse(content[0].text);
  };
  const stopped=await browser.call('Runtime.evaluate',{
    expression:"import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiSetTaskPaused',"+JSON.stringify(remembered.value.taskId)+",true))",
    awaitPromise:true,returnByValue:true,userGesture:true});
  expect('remembered authority can still be paused locally',stopped.result.value);
  await until(async()=>JSON.parse(await readFile(rememberedFile,'utf8')).paused);
  // Private connection files can be interrupted or malformed. Never crash or
  // treat them as authority when enumerating restart metadata.
  const brokenIds=[];
  for(const content of ['{', 'null', '[]', '"not a config"']){
    const id=randomUUID();brokenIds.push(id);
    await writeFile(join(dirname(saved.value.configFile),id+'.json'),content,{mode:0o600});
  }
  await browser.stop();browser=await startNativeBrowser(binary,profile);
  const restored=await until(async()=>{const h=await send('taiGetHostState');return h.ready&&h;});
  expect('restart keeps legacy authorization inert',!restored.tasks.some(t=>t.id===saved.value.taskId)&&restored.savedTasks.some(t=>t.id===saved.value.taskId&&t.provider==='codex'));
  const resumed=await until(async()=>{const result=await rememberedCall('tai_task_status');return result.ok&&result.value;});
  expect('the same running MCP adapter follows the restored window and pause state',
    resumed.state==='paused'&&resumed.reason==='USER_PAUSED');
  const currentRemembered=JSON.parse(await readFile(rememberedFile,'utf8'));
  expect('auto reconnect retains the registered token and selects the fresh local socket',
    currentRemembered.token===previousRemembered.token&&currentRemembered.endpoint!==previousRemembered.endpoint);
  expect('paused remembered connection still rejects opening a page',
    (await rememberedCall('tai_page_open',{url})).error.code==='TASK_PAUSED');
  expect('malformed private records are skipped safely',brokenIds.every(id=>!restored.savedTasks.some(t=>t.id===id)));
  const renew={spaceId:'task-space',commands:['page.list','page.read'],libraries:[],provider:'codex',reconnectTaskId:saved.value.taskId};
  expect('renewal needs a fresh real gesture',(await send('taiCreateTask',renew)).error.code==='USER_GESTURE_REQUIRED');
  async function gestureGrant(payload){const r=await browser.call('Runtime.evaluate',{expression:`import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise('taiCreateTask',${JSON.stringify(payload)}))`,awaitPromise:true,returnByValue:true,userGesture:true});return r.result.value;}
  expect('renewal cannot add write permissions',(await gestureGrant({...renew,commands:[...renew.commands,'page.act']})).error.code==='RECONNECT_DENIED');
  expect('renewal cannot change the target Space',(await gestureGrant({...renew,spaceId:'user-space'})).error.code==='RECONNECT_DENIED');
  expect('failed renewals leave the selected registration untouched',JSON.parse(await readFile(saved.value.configFile,'utf8')).token===beforeConfig.token);
  const upgrade={...renew,provider:'claude',reconnectTaskId:savedUpgrade.taskId,commands:[...renew.commands,'page.screenshot']};
  expect('screenshot renewal cannot change provider',(await gestureGrant({...upgrade,provider:'codex'})).error.code==='RECONNECT_DENIED');
  const upgraded=await gestureGrant(upgrade);
  expect('explicit screenshot renewal reuses the old connection path and adds only capture',
    upgraded.ok&&upgraded.value.configFile===savedUpgrade.configFile&&upgraded.value.taskId===savedUpgrade.taskId&&
    JSON.parse(await readFile(savedUpgrade.configFile,'utf8')).commands.slice().sort().join(',')==='page.list,page.read,page.screenshot');
  const renewed=await gestureGrant(renew);expect('renewal reuses the previously registered command path',renewed.ok&&renewed.value.configFile===saved.value.configFile&&renewed.value.taskId===saved.value.taskId);
  const afterConfig=JSON.parse(await readFile(saved.value.configFile,'utf8'));
  expect('renewal rotates the private token',afterConfig.token!==beforeConfig.token);
  await client.close();await transport.close();
  transport=connectionTransport(saved.value.configFile);
  client=new Client({name:'synthetic-codex-client',version:'1.0.0'},{capabilities:{}});await client.connect(transport);
  const observed=await until(async()=>{const h=await send('taiGetHostState');return h.tasks.find(t=>t.id===saved.value.taskId&&t.connected);});
  expect('MCP initialization is visible before any page tool is used',observed.used===false&&observed.everConnected===true&&observed.clients.some(c=>c.name==='synthetic-codex-client'));
  expect('presence does not expose extra browser capabilities',(await client.listTools()).tools.map(t=>t.name).sort().join(',')==='tai_page_list,tai_page_read,tai_task_status');
  await call('tai_page_list');expect('tool activity is recorded separately from connection',(await send('taiGetHostState')).tasks.find(t=>t.id===saved.value.taskId).used===true);
  await client.close();await transport.close();
  expect('clean client exit becomes disconnected',await until(async()=>{const h=await send('taiGetHostState');return h.tasks.some(t=>t.id===saved.value.taskId&&!t.connected&&t.everConnected);}));
  await send('taiRevokeTask',remembered.value.taskId);
  expect('a previously running adapter loses remembered access on revoke',!(await rememberedCall('tai_page_list')).ok);
  await send('taiRevokeTask',saved.value.taskId);await browser.stop();browser=await startNativeBrowser(binary,profile);
  expect('revoked registration cannot return after restart',await until(async()=>{const h=await send('taiGetHostState');return h.ready&&!h.savedTasks.some(t=>t.id===saved.value.taskId);}));


}catch(error){checks.push({check:'probe completion',passed:false,error:String(error)});process.exitCode=1;console.error(error);}
finally{await rememberedClient?.close().catch(()=>{});await rememberedTransport?.close().catch(()=>{});await client?.close().catch(()=>{});await transport?.close().catch(()=>{});await browser?.stop();await new Promise(r=>server.close(r));const receipt={passed:checks.every(c=>c.passed),checks,profile,measurements,measurementScope:'single synthetic fixture via real MCP; development component build, no inference; not a CPU/RSS or production speed benchmark',finishedAt:new Date().toISOString(),scope:'official MCP stdio adapter with real scoped native browser and other-Space focus; no real Agent inference, original-session takeover or credentials'};await writeFile(join(local,'native-mcp-smoke.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));}
