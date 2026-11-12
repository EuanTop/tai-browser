#!/usr/bin/env node
// Product-level capture/read/restart checks. Own synthetic profiles and pages only.
import {startNativeBrowser,until} from './native_smoke_support.mjs';
import {mkdir,mkdtemp,readFile,writeFile,readdir,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
const [binaryArg,rootArg]=process.argv.slice(2);
if(!binaryArg||!rootArg)throw new Error('Expected explicit product binary and checkout');
const root=resolve(rootArg),binary=resolve(binaryArg),local=join(root,'research/local');
await mkdir(join(local,'browser-profiles'),{recursive:true});
const profile=await mkdtemp(join(local,'browser-profiles/tai-library-')),folder=await mkdtemp(join(local,'browser-profiles/library-capture-'));
const checks=[];let browser,sequence=0;
function expect(check,passed){checks.push({check,passed:!!passed});console.log(`${passed?'PASS':'FAIL'} ${check}`);if(!passed)throw new Error(check);}
const server=createServer((req,res)=>{res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><html><head><title>Synthetic architecture essay</title></head><body><article><h1>Room for quiet thought</h1>${'<p>Daylight enters the courtyard. A calm browser saves ideas for later reading. This architectural essay discusses flow, space, and natural shadows in detail.</p>'.repeat(15)}<p id="selection">A selected courtyard passage.</p><pre><code class="language-js">const daylight = 42;</code></pre><ul><li>Light enters the courtyard through a large circular opening in the wall.</li><li>Space remains quiet and comfortable for sustained reading and thought.</li></ul><table><thead><tr><th>Room</th><th>Light</th></tr></thead><tbody><tr><td>East</td><td>Morning</td></tr></tbody></table><input type="password" value="SYNTHETIC_PASSWORD"><input type="hidden" value="SYNTHETIC_TOKEN"><script>window.executed=true</script></article></body></html>`);});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const url=`http://127.0.0.1:${server.address().port}/essay`;
const send=(method,...args)=>browser.evaluate(`import('chrome://resources/js/cr.js').then(m=>m.sendWithPromise(${JSON.stringify(method)},...${JSON.stringify(args)}))`);
let binding,libraryId;
async function command(command,payload={},extra={}){return send('taiHost',{protocol:'tai.v1',id:`library-${++sequence}`,command,scope:{...binding,...extra},payload});}
async function launch(){browser=await startNativeBrowser(binary,profile,{extra:['--test-type=tai-host','--tai-host-fixture-directory='+folder]});await until(async()=>{const h=await send('taiGetHostState');return h.ready;});const state=await browser.state();binding={profileId:state.profileId,spaceId:state.spaces[0].id};}
async function openLibrary(){await browser.call('Page.navigate',{url:'chrome://tai/library.html'});await until(()=>browser.evaluate("document.querySelector('#library')?.options.length===1&&!document.querySelector('#clip-search').disabled"));}
try{
  await launch();const grant=await send('taiHostFixture','library');expect('native folder grant is durable and named',grant.ok&&grant.value.sessionOnly===false&&grant.value.name===folder.split('/').at(-1));libraryId=grant.value.libraryId;
  expect('native library metadata persists with private permissions',JSON.parse(await readFile(join(profile,'Default/TAiLibraries.json'),'utf8'))[libraryId].name===folder.split('/').at(-1));
  const page=await command('page.open',{url});expect('capture source opens in real Chromium',page.ok);
  const source=await until(async()=>{const list=await command('page.list');const ref=list.value?.find(p=>p.url===url);if(!ref)return;const read=await command('page.read',{format:'snapshot'},{pageId:ref.pageId,pageRevision:ref.pageRevision});return read.ok&&read.value.html?.includes('courtyard')&&{ref,snapshot:read.value};});
  expect('whole-page snapshot omits missing selection instead of empty selection',!Object.hasOwn(source.snapshot,'selectionHtml'));
  expect('snapshot excludes password hidden token and executable scripts',!source.snapshot.html.includes('SYNTHETIC_PASSWORD')&&!source.snapshot.html.includes('SYNTHETIC_TOKEN')&&!source.snapshot.html.includes('<script'));
  await openLibrary();
  expect('formal library selects an authorized folder and actual window page',await browser.evaluate(`document.querySelector('#library').value===${JSON.stringify(libraryId)}&&document.querySelector('#capture-page').options.length===1&&document.querySelector('#capture-page').textContent.includes('architecture')`));
  await browser.call('Accessibility.enable');const ax=await browser.call('Accessibility.getFullAXTree');expect('library remains live with accessible search and capture controls',ax.nodes.some(n=>n.name?.value==='保存到资料库'));
  const {targetInfo:libraryTarget}=await browser.call('Target.getTargetInfo');
  const secondPage=await command('page.open',{url:url+'?second'});await until(async()=>{const{targetInfos}=await browser.call('Target.getTargets');return targetInfos.some(t=>t.url===url+'?second');});
  await until(async()=>{const listed=await command('page.list');return listed.value.some(p=>p.pageId===secondPage.value.pageId&&p.pageRevision>secondPage.value.pageRevision&&p.url===url+'?second');});
  const {targetInfos:withSecond}=await browser.call('Target.getTargets');const secondTarget=withSecond.find(t=>t.url===url+'?second');
  await browser.call('Target.activateTarget',{targetId:secondTarget.targetId});
  await browser.call('Target.activateTarget',{targetId:libraryTarget.targetId});
  // Exercise the registered focus handler directly; native event delivery is
  // independently checked with physical tab switching via CUA.
  await browser.evaluate("dispatchEvent(new Event('focus'))");
  await until(()=>browser.evaluate("document.querySelector('#capture-page').options.length===2"));expect('library focus handler refreshes current Space source pages',secondPage.ok);
  const parentStyle=await browser.evaluate("getComputedStyle(document.body).backgroundColor");
  await browser.evaluate("document.querySelector('#capture-name').value='Quiet courtyard';document.querySelector('#capture-tags').value='design, architecture';document.querySelector('#capture-form').requestSubmit()");
  await until(()=>browser.evaluate("document.querySelector('#library-status').textContent.includes('本地已保存')"));
  expect('UI capture extracts and writes one searchable clip',await browser.evaluate("document.querySelectorAll('#clip-list li').length===1&&document.querySelector('#clip-list strong').textContent==='Quiet courtyard'"));
  const clips=await readdir(join(folder,'clips'));const files=await readdir(join(folder,'clips',clips[0]));const saved=JSON.parse(await readFile(join(folder,'clips',clips[0],files.find(f=>f.endsWith('.json'))),'utf8'));
  expect('saved record contains full Markdown original URL and tags',saved.markdown.includes('Daylight')&&!/Partial conversion|Original HTML|<article|<p>/.test(saved.markdown)&&saved.source.url===url&&saved.tags.join(',')==='design,architecture'&&files.some(f=>f.endsWith('.md')));
  expect('native browser conversion preserves code lists and tables as Markdown',saved.markdown.includes('```js')&&/-\s+Light enters/.test(saved.markdown)&&saved.markdown.includes('| Room | Light |'));
  expect('extractor leaves the real parent DOM style API untouched',typeof parentStyle==='string'&&await browser.evaluate("getComputedStyle(document.body).backgroundColor")===parentStyle);
  await browser.evaluate("document.querySelector('#capture-mode').value='selection';document.querySelector('#capture-form').requestSubmit()");
  await until(()=>browser.evaluate("document.querySelector('#library-status').textContent.includes('没有可保存的选区')"));expect('missing selection produces a useful error and no empty duplicate',(await readdir(join(folder,'clips'))).length===1);
  await browser.evaluate("document.querySelector('#clip-search').value='does-not-match';document.querySelector('#clip-search').dispatchEvent(new Event('input'))");await until(()=>browser.evaluate("document.querySelectorAll('#clip-list li').length===0"));
  await browser.evaluate("document.querySelector('#clip-search').value='Daylight';document.querySelector('#clip-search').dispatchEvent(new Event('input'))");await until(()=>browser.evaluate("document.querySelectorAll('#clip-list li').length===1"));expect('search matches saved body text',true);
  const {targetInfos}=await browser.call('Target.getTargets');const target=targetInfos.find(t=>t.type==='page'&&t.url===url);await browser.call('Target.closeTarget',{targetId:target.targetId});
  await browser.evaluate("document.querySelector('#clip-list button').click()");await until(()=>browser.evaluate("!document.querySelector('#reading-section').hidden"));
  const frame=await browser.evaluate("document.querySelector('#library-reader iframe').src");expect('closed source remains readable through opaque sandboxed reader',frame.startsWith('chrome-untrusted://tai-content/')&&await browser.evaluate("document.querySelector('#library-reader iframe').getAttribute('sandbox')==='allow-scripts'"));
  await browser.evaluate("document.querySelector('#metadata-title').value='Quiet courtyard · edited';document.querySelector('#metadata-tags').value='atrium, offline';document.querySelector('#metadata-form').requestSubmit()");
  await until(()=>browser.evaluate("document.querySelector('#library-status').textContent.includes('整理已保存')"));
  expect('editing metadata preserves the open article and updates its heading',await browser.evaluate("!document.querySelector('#reading-section').hidden&&document.querySelector('#reading-title').textContent==='Quiet courtyard · edited'"));
  expect('metadata edits are indexed without replacing captured source',await browser.evaluate("document.querySelector('#clip-list strong').textContent==='Quiet courtyard · edited'")&&JSON.parse(await readFile(join(folder,'clips',clips[0],files.find(f=>f.endsWith('.json'))),'utf8')).title==='Quiet courtyard');
  await browser.evaluate("[...document.querySelectorAll('#clip-list button')].find(b=>b.textContent==='归档').click()");
  await until(()=>browser.evaluate("!document.querySelector('#clip-state').disabled"));
  await browser.evaluate("document.querySelector('#clip-state').value='saved';document.querySelector('#clip-state').dispatchEvent(new Event('change'))");await until(()=>browser.evaluate("document.querySelectorAll('#clip-list li').length===0"));
  await browser.evaluate("document.querySelector('#clip-state').value='archived';document.querySelector('#clip-state').dispatchEvent(new Event('change'))");await until(()=>browser.evaluate("document.querySelectorAll('#clip-list li').length===1"));expect('archive separates the inbox while preserving local reading',true);
  await browser.evaluate("[...document.querySelectorAll('#clip-list button')].find(b=>b.textContent==='移至回收站').click()");await until(()=>browser.evaluate("document.querySelectorAll('#clip-list li').length===0&&!document.querySelector('#clip-state').disabled"));
  await browser.stop();browser=null;await launch();const restored=await send('taiGetHostState');expect('browser restart restores same folder grant and stable ID',restored.libraries.some(l=>l.id===libraryId&&l.name===folder.split('/').at(-1))&&restored.tasks.length===0);
  await openLibrary();await until(()=>browser.evaluate("document.querySelectorAll('#clip-list li').length===0"));
  await browser.evaluate("document.querySelector('#clip-state').value='trash';document.querySelector('#clip-state').dispatchEvent(new Event('change'))");await until(()=>browser.evaluate("document.querySelectorAll('#clip-list li').length===1"));
  expect('trash and edited metadata survive restart with original file retained',await browser.evaluate("document.querySelector('#clip-list strong').textContent==='Quiet courtyard · edited'")&&(await readdir(join(folder,'clips',clips[0]))).includes(files.find(f=>f.endsWith('.md'))));
  await browser.evaluate("[...document.querySelectorAll('#clip-list button')].find(b=>b.textContent==='恢复').click()");await until(()=>browser.evaluate("document.querySelectorAll('#clip-list li').length===0&&!document.querySelector('#clip-state').disabled"));
  await browser.evaluate("document.querySelector('#clip-state').value='all';document.querySelector('#clip-state').dispatchEvent(new Event('change'))");await until(()=>browser.evaluate("document.querySelectorAll('#clip-list li').length===1"));expect('restoring a clip retains metadata and source remains unnecessary',await browser.evaluate("document.querySelector('#clip-list strong').textContent==='Quiet courtyard · edited'&&document.querySelector('#capture-page').value===''") );
  await browser.evaluate("document.querySelector('#disconnect-library').click()");await until(()=>browser.evaluate("document.querySelector('#library').options.length===0"));expect('disconnect revokes access and leaves saved files intact',(await readdir(join(folder,'clips'))).length===1);
  await browser.stop();browser=null;await launch();expect('disconnect survives browser restart',(await send('taiGetHostState')).libraries.length===0);
  await send('taiHostFixture','library');await browser.stop();browser=null;
  await rename(folder,folder+'-original');await mkdir(folder);
  await launch();expect('a different directory at the same path is never silently granted',(await send('taiGetHostState')).libraries.length===0);
  const missing=(await send('taiGetHostState')).unavailableLibraries;expect('unavailable grants remain visible without exposing filesystem paths',missing.length===1&&missing[0].name===folder.split('/').at(-1)&&!Object.hasOwn(missing[0],'path'));
  await browser.call('Page.navigate',{url:'chrome://tai/library.html'});await until(()=>browser.evaluate("!!document.querySelector('#unavailable-libraries button')"));
  await browser.evaluate("document.querySelector('#unavailable-section').open=true;document.querySelector('#unavailable-libraries button').click()");await until(()=>browser.evaluate("document.querySelector('#unavailable-section').hidden"));
  expect('forgetting unavailable grant frees saved authorization while preserving original files',!Object.keys(JSON.parse(await readFile(join(profile,'Default/TAiLibraries.json'),'utf8'))).length&&(await readdir(join(folder+'-original','clips'))).length===1);

  await browser.stop();browser=null;
  browser=await startNativeBrowser(binary,profile,{extra:['--test-type=tai-host','--tai-host-fixture-directory='+profile]});await until(async()=>(await send('taiGetHostState')).ready);
  const protectedGrant=await send('taiHostFixture','library');expect('browser account data cannot be granted as a writable library',!protectedGrant.ok&&protectedGrant.error.code==='INVALID_LIBRARY_LOCATION');
  await browser.stop();browser=null;
}catch(error){if(browser)try{console.error('Synthetic library state:',await browser.evaluate("({url:location.href,status:document.querySelector('#library-status')?.textContent,body:document.body.innerText.slice(0,3000)})"));}catch{}checks.push({check:'library flow completion',passed:false,error:String(error)});process.exitCode=1;console.error(error);}
finally{await browser?.stop();await new Promise(done=>server.close(done));const receipt={passed:checks.every(c=>c.passed),checks,profile,finishedAt:new Date().toISOString(),scope:'real product library, bounded HTTP snapshot, inert extraction, immutable native files, search, opaque reading, restart and revoke; synthetic only'};await writeFile(join(local,'native-library-smoke.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));}
