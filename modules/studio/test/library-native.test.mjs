import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from '../../clipping/node_modules/jsdom/lib/api.js';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createNativeLibraryStore } from '../../library/native-store.mjs';
import { ClipLibrary } from '../../library/index.mjs';

const binding = {profileId:'profile-fixture',spaceId:'space-fixture',taskId:'task-fixture'};
const grants = ['library.read','library.list','library.putIfAbsent'];
function protocolHost() {
  const files = new Map(), calls = []; let error, blocked;
  return {files,calls,set error(value) { error = value; },set blocked(value) { blocked = value; },
    async execute(request) {
      calls.push(structuredClone(request)); await blocked;
      assert.equal(request.protocol,'tai.v1'); assert.deepEqual(structuredClone(request.scope),binding);
      const {libraryId,resourceId,prefix,text} = request.payload;
      assert.equal(libraryId,'selected-library');
      const failure = code => ({id:request.id,ok:false,error:{code,message:code,retryable:false}});
      if (error) return failure(error);
      let value;
      if (request.command === 'library.read') { if (!files.has(resourceId)) return failure('NOT_FOUND'); value = files.get(resourceId); }
      else if (request.command === 'library.list') value = [...files.keys()].filter(key => !prefix || key.startsWith(prefix + '/'));
      else if (request.command === 'library.putIfAbsent') {
        if (files.has(resourceId) && files.get(resourceId) !== text) return failure('IMMUTABLE_CONFLICT');
        files.set(resourceId,text); value = true;
      } else throw new Error('Unexpected command');
      return {id:request.id,ok:true,value};
    },
  };
}
const storeOptions = host => ({binding,libraryId:'selected-library',libraries:[{id:'selected-library'}],commands:grants,execute:host.execute});

test('native protocol store fixes selector/scope, validates resources, immutable writes and host failures', async () => {
  const host = protocolHost(), options = storeOptions(host), store = createNativeLibraryStore(options);
  options.binding = {...binding,profileId:'other'}; options.libraries.length = 0;
  await store.putIfAbsent('clips/test.md','中文'); await store.putIfAbsent('clips/test.md','中文');
  await assert.rejects(store.putIfAbsent('clips/test.md','overwrite'),{code:'IMMUTABLE_CONFLICT'});
  assert.equal(await store.read('clips/test.md'),'中文'); assert.deepEqual(await store.list(''),['clips/test.md']);
  for (const key of ['/etc/passwd','../escape','a/%name','a\\b','a//b','a/./b','a/'.repeat(17)+'b']) await assert.rejects(store.read(key),{code:'INVALID_RESOURCE'});
  assert.throws(() => createNativeLibraryStore({...storeOptions(host),libraryId:'/tmp/arbitrary'}),{code:'LIBRARY_NOT_GRANTED'});
  const readonly = createNativeLibraryStore({...storeOptions(host),commands:grants.slice(0,2)});
  await assert.rejects(readonly.putIfAbsent('clip','no'),{code:'CAPABILITY_UNAVAILABLE'});
  host.error = 'LIBRARY_REVOKED'; await assert.rejects(store.read('clips/test.md'),{code:'LIBRARY_REVOKED'});
  const library = new ClipLibrary({libraryId:'selected-library',store});
  await assert.rejects(library.rebuild(),{code:'LIBRARY_REVOKED'});
});

test('revocation rejects in-flight results, unknown outcome is never retried or called rollback', async () => {
  const host = protocolHost(), store = createNativeLibraryStore(storeOptions(host));
  let release; host.blocked = new Promise(resolve => {release = resolve;});
  const pending = store.putIfAbsent('clips/pending.md','published'); store.revoke(); release();
  await assert.rejects(pending,{code:'OPERATION_OBSOLETE'});
  assert.equal(host.files.get('clips/pending.md'),'published');
  const calls = host.calls.length; await assert.rejects(store.read('clips/pending.md'),{code:'LIBRARY_REVOKED'}); assert.equal(host.calls.length,calls);
  const unknown = protocolHost(); unknown.error = 'OUTCOME_UNKNOWN';
  await assert.rejects(createNativeLibraryStore(storeOptions(unknown)).putIfAbsent('clip','data'),{code:'OUTCOME_UNKNOWN'});
  assert.equal(unknown.calls.length,1);
});

test('browser bundle executes snapshot → native store → shared panel/reader; UI and Agent reuse one receipt', async t => {
  const result = await build({entryPoints:[fileURLToPath(new URL('../../library/native.mjs',import.meta.url))],
    bundle:true,format:'iife',globalName:'TaiLibrary',platform:'browser',write:false,metafile:true,logLevel:'silent'});
  assert.ok(Object.keys(result.metafile.inputs).every(path => !/jsdom|defuddle\/dist\/node\.js|node:crypto/.test(path)));
  const dom = new JSDOM('<main></main>',{runScripts:'outside-only',url:'https://fixture.test/'}); t.after(() => dom.window.close());
  Object.assign(dom.window,{structuredClone,TextEncoder,TextDecoder,AbortController});
  Object.defineProperty(dom.window,'crypto',{value:globalThis.crypto});
  dom.window.fetch = () => { throw new Error('Network forbidden'); };
  dom.window.eval(result.outputFiles[0].text);
  const host = protocolHost(), events = [], create = dom.window.TaiLibrary.createNativeLibrary;
  const service = await create({...storeOptions(host),emit:event => events.push(event)});
  assert.equal(service.initialization.count,0);
  const snapshot = {scope:{...binding,pageId:'page-fixture',pageRevision:1},url:'https://source.test/article',
    title:'中文合成资料',capturedAt:'2026-10-18T10:00:00Z',html:'<html><body><article><h1>中文资料</h1><p>' +
      '同一保存实现，离线阅读与检索。'.repeat(30) + '</p><img src="https://source.test/image.png"><script>throw Error("executed")</script></article></body></html>'};
  const root = dom.window.document.querySelector('main');
  const panel = service.mount(root,{requestSnapshot:async () => snapshot}); await panel.ready;
  root.querySelector('form button').click();
  for (let n=0;n<100 && service.state().phase !== 'saved';n++) await new Promise(resolve => setTimeout(resolve,5));
  assert.equal(service.state().phase,'saved');
  const receipt = service.state().receipt;
  const agentReceipt = await service.commands.capture(snapshot,{id:receipt.clipId});
  assert.deepEqual(structuredClone(agentReceipt),receipt); assert.equal(service.commands.search('离线阅读').length,1);
  assert.equal(events.length,2);
  assert.equal(events[0].scope.profileId,binding.profileId);
  root.querySelector('li button').click();
  for (let n=0;n<100 && !root.querySelector('article');n++) await new Promise(resolve => setTimeout(resolve,5));
  assert.match(root.querySelector('article').textContent,/同一保存实现/);
  assert.equal(root.querySelector('script'),null); assert.equal(root.querySelector('img').hasAttribute('src'),false);
  assert.match(root.textContent,/Attachment unavailable/);
  const intent = await service.readerIntent(receipt.clipId);
  assert.deepEqual(Object.keys(intent).sort(),['input','kind']);
  assert.equal(intent.kind,'reader'); assert.equal(intent.input.format,'markdown'); assert.ok(!Object.hasOwn(intent.input,'html'));
  await assert.rejects(service.commands.capture({...snapshot,scope:{...snapshot.scope,spaceId:'other'}}),/SCOPE_MISMATCH/);
  host.error = 'STORAGE_UNAVAILABLE'; const before = events.length;
  await assert.rejects(service.commands.capture(snapshot,{id:'failed-save'}),/STORAGE_UNAVAILABLE/); assert.equal(events.length,before);
  host.error = undefined;
  const reopened = await create(storeOptions(host)); assert.equal(reopened.initialization.count,1);
  assert.match((await reopened.commands.read(receipt.clipId)).markdown,/同一保存实现/);
  service.dispose(); assert.throws(() => service.commands.search(''),/LIBRARY_REVOKED/); reopened.dispose();
});

test('trusted WebUI hostCommand uses unwrapped native scalar/list/true values and correlation rejects malformed responses', async () => {
  const calls = [];
  const store = createNativeLibraryStore({binding,libraryId:'selected-library',libraries:['selected-library'],commands:grants,
    hostCommand:async (scope,command,payload) => {calls.push({scope,command,payload}); return command === 'library.list' ? [] : command === 'library.read' ? 'text' : true;}});
  assert.deepEqual(await store.list(''),[]); assert.equal(await store.read('clip'),'text'); await store.putIfAbsent('clip','text');
  assert.deepEqual(calls[0],{scope:binding,command:'library.list',payload:{libraryId:'selected-library',prefix:''}});
  const denied = createNativeLibraryStore({...storeOptions(protocolHost()),execute:undefined,hostCommand:async () => {throw Error('LIBRARY_DENIED');}});
  await assert.rejects(denied.list(''),{code:'LIBRARY_DENIED'});
  assert.throws(() => denied.assertActive(),{code:'LIBRARY_REVOKED'});
  await assert.rejects(createNativeLibraryStore({...storeOptions(protocolHost()),execute:async () => ({id:'wrong',ok:true,value:[]})}).list(''),{code:'INVALID_RESPONSE'});
});
