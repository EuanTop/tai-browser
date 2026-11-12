import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MessageChannel} from 'node:worker_threads';
import {JSDOM} from '../../clipping/node_modules/jsdom/lib/api.js';
import {createNativeStudio,createNativeSurfaceAdapter} from '../native.mjs';
import {buildNativePackage} from '../build-package.mjs';
import {prepareNativePackage} from '../package.mjs';
import {createComponentSDK} from '../../component-sdk/index.mjs';

const binding = {profileId:'profile-fixture',spaceId:'space-fixture'};
const manifest = {apiVersion:1,id:'fixture.app',version:'0.1.0',title:'Fixture',entry:'index.html',surfaces:['panel'],capabilities:['storage']};
const pkg = (version = '0.1.0') => ({manifest:{...manifest,version},files:{'index.html':'<main>Fixture</main>'}});

async function surfaceFixture(t) {
  const dom = new JSDOM('<main></main><aside></aside>',{runScripts:'outside-only',url:'https://fixture.test/'});
  t.after(() => dom.window.close());
  Object.assign(dom.window,{MessageChannel,structuredClone}); Object.defineProperty(dom.window,'crypto',{value:globalThis.crypto});
  let sequence = 0, failApply = false, failLoad = false;
  const grants = new Map(), calls = [];
  const hostCommand = async (scope,command,payload) => {
    assert.deepEqual(structuredClone(scope),binding); calls.push({command,payload});
    if (command === 'modules.preview') {
      const handle = 'surface-' + ++sequence, grant = {handle,nonce:'nonce-'+sequence,spaceId:binding.spaceId,componentId:payload.manifest.id,
        url:'https://fixture.test/' + handle}; grants.set(handle,grant); return grant;
    }
    if (!grants.has(payload.handle)) throw Error('SURFACE_REVOKED');
    if (command === 'modules.dispose') {grants.delete(payload.handle);return true;}
    if (command === 'modules.apply')return true;
    if (command === 'modules.call') throw Error('CAPABILITY_UNAVAILABLE');
    throw Error('Unexpected command');
  };
  // Execute organizer's actual surface lifecycle against a synthetic native bridge.
  const source = await readFile(new URL('../../../src/chromium/webui/host-panel.js',import.meta.url),'utf8');
  dom.window.sendWithPromise = async (_name,request) => {
    try {return {id:request.id,ok:true,value:await hostCommand(request.scope,request.command,request.payload)};}
    catch (error) {return {id:request.id,ok:false,error:{code:error.message}};}
  };
  dom.window.eval(source.replace(/^import .*;$/m,'').replaceAll('export ','') + '\nglobalThis.fixtureCreateSurfaceHost=createSurfaceHost;');
  const observer = new dom.window.MutationObserver(records => {
    for (const record of records) for (const frame of record.addedNodes) if (frame.tagName === 'IFRAME') {
      const grant = [...grants.values()].find(item => frame.src === item.url);
      frame.contentWindow.postMessage = (_message,_origin,ports) => {
        const port = ports[0]; port.postMessage({kind:failLoad ? 'tai.surface.failed' : 'tai.surface.loaded'}); port.close();
      };
      dom.window.dispatchEvent(new dom.window.MessageEvent('message',{source:frame.contentWindow,origin:'null',
        data:{kind:'tai.surface.ready',instance:grant.handle,nonce:grant.nonce}}));
    }
  });
  observer.observe(dom.window.document.querySelector('main'),{childList:true}); t.after(() => observer.disconnect());
  return {dom,grants,calls,hostCommand,
    set failApply(value) {failApply=value;},set failLoad(value) {failLoad=value;},
    options:{container:dom.window.document.querySelector('main'),binding,hostCommand,
      createSurfaceHost:(container,scope) => {
        const native = dom.window.fixtureCreateSurfaceHost(container,scope);
        return {...native,apply:async session => {if (failApply) throw Error('ATOMIC_ACTIVATION_FAILED');return native.apply(session);}};
      }},
  };
}

test('Studio uses organizer surface lifecycle: failure restores old frame, cancel/rollback/disable/dispose retire handles',async t => {
  const fixture = await surfaceFixture(t), service = createNativeStudio(fixture.options), {studio} = service;
  t.after(() => service.dispose().catch(() => {}));
  await studio.preview(pkg()); await studio.apply(manifest.id,'0.1.0');
  const old = fixture.dom.window.document.querySelector('iframe'), oldGrant = [...fixture.grants.keys()][0];
  fixture.failLoad = true; await assert.rejects(studio.preview(pkg('0.2.0')),/PREVIEW_FAILED/);
  assert.equal(old.isConnected,true); assert.equal(old.hidden,false); assert.equal(studio.state().current.version,'0.1.0');
  fixture.failLoad = false; await studio.preview(pkg('0.2.0'));
  fixture.failApply = true; await assert.rejects(studio.apply(manifest.id,'0.2.0'),/ATOMIC_ACTIVATION_FAILED/);
  assert.equal(studio.state().preview,null); assert.equal(old.hidden,false); assert.equal(old.isConnected,true);
  assert.equal(fixture.grants.size,1); assert.ok(fixture.grants.has(oldGrant));
  fixture.failApply = false; await studio.preview(pkg('0.2.0')); await studio.apply(manifest.id,'0.2.0');
  assert.equal(old.isConnected,false); assert.equal(fixture.grants.has(oldGrant),false);
  await assert.rejects(fixture.hostCommand(binding,'modules.call',{handle:oldGrant,op:'storage.get',args:{key:'test'}}),/SURFACE_REVOKED/);
  await studio.rollback(manifest.id,'0.1.0'); assert.equal(studio.state().current.version,'0.1.0');
  await studio.preview(pkg('0.3.0')); const panel = service.mount(fixture.dom.window.document.querySelector('aside'));
  [...fixture.dom.window.document.querySelectorAll('aside button')].find(button => button.textContent === 'Cancel preview').click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(studio.state().preview,null); assert.equal(fixture.grants.size,1);
  await studio.disable(); assert.equal(fixture.grants.size,0); assert.equal(studio.state().enabled,false);
  panel.close(); await service.dispose(); await assert.rejects(studio.preview(pkg('0.4.0')),/STUDIO_DISPOSED/);
});

test('surface adapter rejects scope drift and old preview handles after cancel or revoke',async t => {
  const fixture = await surfaceFixture(t), adapter = createNativeSurfaceAdapter(fixture.options);
  await assert.rejects(adapter.preview(pkg(),{...binding,spaceId:'other'}),/SCOPE_MISMATCH/);
  const handle = await adapter.preview(pkg(),binding); await adapter.cancel();
  await assert.rejects(adapter.activate(handle),/SURFACE_REVOKED/);
  const next = await adapter.preview(pkg('0.2.0'),binding); await adapter.close();
  await assert.rejects(adapter.activate(next),/SURFACE_REVOKED/); assert.equal(fixture.grants.size,0);
});

test('deterministic existing Pomodoro files bundle into one browser ESM plus markup/style',async () => {
  const files = {};
  for (const name of ['index.html','bootstrap.mjs','view.mjs','timer.mjs','style.css']) files[name] = await readFile(new URL('../../apps/pomodoro/' + name,import.meta.url),'utf8');
  const app = {manifest:{...manifest,id:'fixture.timer'},files};
  const first = await buildNativePackage(app), second = await buildNativePackage(app);
  assert.deepEqual(first,second); assert.equal(first.kind,'custom'); assert.match(first.script,/mountPomodoro/);
  assert.match(first.markup,/<main/); assert.doesNotMatch(first.markup,/<script|<link/); assert.ok(first.style.length);
  await assert.rejects(prepareNativePackage(app),/PACKAGE_COMPILER_UNAVAILABLE/);
});

test('package dependency/path/forms/quotas fail explicitly; no host file or external module resolution',async () => {
  function scripted(code,extra = {}) { return {...pkg(),files:{'index.html':'<html><body><main></main><script type="module" src="app.mjs"></script></body></html>', 'app.mjs':code,...extra}}; }
  for (const code of ["import 'node:fs';","import 'https://remote.test/app.js';","import '/etc/passwd';","import '../escape.mjs';",
    "const name=globalThis.path; await import(name);","const name=globalThis.path; require(name);","import './missing.mjs';"]) {
    await assert.rejects(buildNativePackage(scripted(code)),/UNSUPPORTED_|PACKAGE_IMPORT_ESCAPE/);
  }
  const ts = await buildNativePackage(scripted("import {answer} from './nested/value.ts'; globalThis.answer=answer;",{'nested/value.ts':'export const answer:number = 42;'}));
  assert.match(ts.script,/answer = 42/);
  await assert.rejects(buildNativePackage({...pkg(),manifest:{...manifest,id:'tai.reserved'}}),/UNSUPPORTED_NATIVE_MANIFEST/);
  await assert.rejects(buildNativePackage({...pkg(),manifest:{...manifest,surfaces:['sidebar']}}),/UNSUPPORTED_NATIVE_MANIFEST/);
  await assert.rejects(buildNativePackage({...pkg(),files:{'index.html':'<script>alert(1)</script>'}}),/UNSUPPORTED_SCRIPT/);
  await assert.rejects(buildNativePackage({...pkg(),files:{'index.html':'<style>@import "https://remote.test/a.css";</style><main></main>'}}),/UNSUPPORTED_CSS_RESOURCE/);
  await assert.rejects(buildNativePackage({...pkg(),files:{'index.html':'<main>' + '中'.repeat(90_000) + '</main>'}}),/NATIVE_PACKAGE_QUOTA/);
  await assert.rejects(buildNativePackage({...pkg(),files:{'index.html':'<style>' + ' '.repeat(128*1024+1) + '</style><main></main>'}}),/NATIVE_PACKAGE_QUOTA/);
  await assert.rejects(buildNativePackage({...pkg(),files:{'index.html':'x'.repeat(2_000_001)}}),/oversized/);
  await assert.rejects(buildNativePackage(scripted('x=1;'.repeat(330_000))),/NATIVE_PACKAGE_QUOTA/);
});

test('SDK explicitly reports undeployed capabilities as unavailable',async () => {
  const sdk = createComponentSDK({...manifest,capabilities:['storage','notifications','clips.read','clips.capture']},{storage:{get:async () => null,set:async () => {}}});
  for (const call of [() => sdk.notify('hello'),() => sdk.clips.search('query'),() => sdk.clips.read('id'),() => sdk.clips.capture()])
    await assert.rejects(call(),{code:'CAPABILITY_UNAVAILABLE'});
});
