import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ModuleStudio, validatePackage } from '../index.mjs';
import { createComponentSDK } from '../../component-sdk/index.mjs';
import { PomodoroTimer } from '../../apps/pomodoro/timer.mjs';

const manifest = JSON.parse(await readFile(new URL('../../apps/pomodoro/manifest.json',import.meta.url),'utf8'));
function pkg(version = '0.1.0') { return { manifest:{ ...manifest,version },files:{ 'index.html':'<p>synthetic app ' + version + '</p>' } }; }
const scope = { profileId:'profile-test',spaceId:'space-test',taskId:'task-test' };

test('manifest/package compatibility and exact successful preview are required', async () => {
  assert.throws(() => validatePackage({ ...pkg(),manifest:{ ...manifest,apiVersion:2 } }), /manifest/);
  assert.throws(() => validatePackage({ ...pkg(),files:{ '../escape':'bad' } }), /package/);
  assert.throws(() => validatePackage({ ...pkg(),files:{ 'index.html':'x'.repeat(2_000_001) } }), /package/);
  const host = { preview:async () => 'preview',activate:async () => {},disable:async () => {},dispose:async () => {} };
  const studio = new ModuleStudio({host,scope});
  await assert.rejects(studio.apply(manifest.id,manifest.version), /successful preview/);
  await studio.preview(pkg());
  await assert.rejects(studio.apply(manifest.id,'0.2.0'), /exact version/);
  await studio.apply(manifest.id,manifest.version);
  const changed = pkg(); changed.files['index.html'] = 'different';
  await assert.rejects(studio.preview(changed), /different content/);
});

test('preview/activation/rollback failures preserve live version; disable keeps data; scope stays bound', async () => {
  const calls = [], events = []; let live, failPreview = false, failActivate = false;
  const host = {
    async preview(p,binding) { assert.deepEqual(binding,scope); if (failPreview) throw Error('load failed'); const handle = p.manifest.version; calls.push(handle); return handle; },
    async activate(handle,previous) { if (failActivate) throw Error('atomic failure'); assert.equal(previous,live); live = handle; },
    async disable() {}, async dispose() {},
  };
  const studio = new ModuleStudio({host,scope,emit:e => events.push(e)});
  await studio.preview(pkg()); await studio.apply(manifest.id,'0.1.0');
  failPreview = true; await assert.rejects(studio.preview(pkg('0.2.0')),/load failed/);
  assert.equal(studio.state().current.version,'0.1.0'); assert.equal(events.length,1);
  failPreview = false; await studio.preview(pkg('0.2.0'));
  failActivate = true; await assert.rejects(studio.apply(manifest.id,'0.2.0'),/atomic failure/);
  assert.equal(studio.state().current.version,'0.1.0'); assert.equal(live,'0.1.0');
  failActivate = false; await studio.apply(manifest.id,'0.2.0');
  failPreview = true; await assert.rejects(studio.rollback(manifest.id,'0.1.0'),/load failed/);
  assert.equal(live,'0.2.0'); failPreview = false;
  await studio.rollback(manifest.id,'0.1.0'); assert.equal(live,'0.1.0');
  await studio.disable(); assert.equal(studio.state().enabled,false); assert.equal(studio.state().versions.length,2);
  assert.equal(events.length,3); assert.equal(events[0].scope.profileId,'profile-test');
});

test('SDK guards declared capabilities and immutable storage copies', async () => {
  const memory = new Map(), sdk = createComponentSDK(manifest, {
    storage:{ get:async k => memory.get(k),set:async (k,v) => memory.set(k,v) },notify:async () => 'denied',
  });
  const state = {value:1}; await sdk.storage.set('timer',state); state.value = 2;
  assert.equal((await sdk.storage.get('timer')).value,1);
  await assert.rejects(sdk.clips.read('secret'),/Undeclared/);
  await assert.rejects(sdk.storage.get('../escape'),/storage key/);
  const noStorage = createComponentSDK({ ...manifest,capabilities:[] },{});
  await assert.rejects(noStorage.storage.set('timer',{}),/Undeclared/);
});

test('real timer deadline survives close/reload, sleep, pause/reset, denied notification and storage failure', async () => {
  const memory = new Map(); let time = 10000, notifications = 0, denied = false, failWrite = false;
  const sdk = createComponentSDK(manifest, {
    storage:{ get:async key => memory.get(key),set:async (key,value) => { if (failWrite) throw Error('disk full'); memory.set(key,value); } },
    notify:async () => { if (denied) throw Error('denied'); notifications++; },
  });
  const make = () => new PomodoroTimer({sdk,now:() => time,durationMs:5000});
  let timer = make(); await timer.load(); await timer.start();
  time += 2000; await timer.pause(); assert.equal(timer.state().remainingMs,3000);
  time += 100000; assert.equal(timer.state().remainingMs,3000);
  await timer.start(); time += 2000;
  timer = make(); await timer.load(); assert.equal(timer.state().remainingMs,1000);
  time += 10000; denied = true; await timer.resume(); assert.equal(timer.state().status,'completed');
  assert.equal(timer.state().notificationPending,true); assert.equal(notifications,0);
  denied = false; await timer.resume(); assert.equal(notifications,1); await timer.resume(); assert.equal(notifications,1);
  await timer.reset(); assert.equal(timer.state().remainingMs,5000);
  failWrite = true; await assert.rejects(timer.start(),/disk full/); assert.equal(timer.state().status,'idle');
});

test('bundled Pomodoro package references actual frontend files with v1 fixture manifest', async () => {
  const files = {};
  for (const name of ['index.html','bootstrap.mjs','style.css','view.mjs','timer.mjs']) files[name] = await readFile(new URL('../../apps/pomodoro/' + name,import.meta.url),'utf8');
  const frontend = validatePackage({manifest,files});
  assert.match(frontend.files['bootstrap.mjs'],/mountPomodoro/); assert.match(frontend.files['view.mjs'],/visibilitychange/);
  const fixture = JSON.parse(await readFile(new URL('../../../contracts/v1/fixtures/pomodoro.json',import.meta.url),'utf8'));
  assert.deepEqual(frontend.manifest,fixture);
});
