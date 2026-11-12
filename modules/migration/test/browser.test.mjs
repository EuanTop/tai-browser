import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { createMigrationPreview } from '../src/browser.mjs';
import { mountMigrationPanel } from '../src/panel.mjs';
import { opaqueId } from '../src/common.mjs';
import { copySnapshots } from '../src/preview-job.mjs';

const chrome = await readFile(new URL('fixtures/chrome.json', import.meta.url), 'utf8');
const arc = await readFile(new URL('fixtures/arc.json', import.meta.url), 'utf8');
const html = await readFile(new URL('fixtures/bookmarks.html', import.meta.url), 'utf8');
const source = (text, sourceId = 'native-synthetic-source') => ({ sourceId, name: '<img src=x onerror=alert(1)>',
  text, sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) });
const catalog = { revision: 'target-r7', profiles: [0, 1].map(i => ({ profileId: `p${i}`, name: `真实账号环境 ${i}`,
  revision: `pr${i}`, spaces: [0, 1].map(j => ({ spaceId: `s${i}-${j}`, name: `目标 Space ${i}-${j}`, revision: `sr${i}-${j}` })) })) };
const large = source(JSON.stringify({ version: 1, roots: { root: { type: 'folder', id: 'root', name: 'Bulk',
  children: Array.from({ length: 18000 }, (_, i) => ({ type: 'url', id: String(i), name: `Page ${i}`, url: `https://example.com/${'x'.repeat(110)}` })) } } }));
const entry = new URL('../src/preview-worker.mjs', import.meta.url).href;
function workers(workerEntry = entry) {
  const instances = [];
  function createWorker() {
    const raw = new Worker(new URL('./worker-bridge.mjs', import.meta.url), { workerData: { entry: workerEntry } });
    const adapter = { raw, terminated: false, last: null, onmessage: null, onerror: null,
      postMessage(value) { adapter.last = value; raw.postMessage(value); },
      terminate() { adapter.terminated = true; adapter.exit = raw.terminate(); return adapter.exit; } };
    raw.on('message', data => adapter.onmessage?.({ data }));
    raw.on('error', error => adapter.onerror?.(error));
    instances.push(adapter); return adapter;
  }
  return { instances, createWorker };
}
function until(controller, predicate, timeout = 12000) {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('preview timeout')); }, timeout);
    unsubscribe = controller.subscribe(state => { if (predicate(state)) { clearTimeout(timer); queueMicrotask(() => unsubscribe()); resolve(state); } });
  });
}
const ready = controller => until(controller, s => s.status === 'ready' || s.status === 'error').then(s => {
  assert.equal(s.status, 'ready', s.error); return s.preview;
});
function mapping(preview, existing = false) {
  return Object.fromEntries(preview.results.map(r => [r.source.sourceId, r.plan.profiles.map((p, i) => ({
    sourceProfileId: p.sourceProfileId, targetProfileId: existing ? `p${i}` : 'new',
    spaces: p.spaces.map((s, j) => ({ sourceSpaceId: s.sourceSpaceId, targetSpaceId: existing ? `s${i}-${j}` : 'new' })) }))]));
}

test('browser platform bundles panel/controller and the real worker without Node polyfills; bundled worker parses HTML', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'tai-migration-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await build({ entryPoints: ['browser', 'panel', 'preview-worker'].map(name => fileURLToPath(new URL(`../src/${name}.mjs`, import.meta.url))),
    outdir: dir, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'browser', format: 'esm', target: 'chrome120', metafile: true });
  assert.ok(Object.keys(result.metafile.inputs).some(p => p.includes('htmlparser2')));
  for (const output of Object.values(result.metafile.outputs)) assert.equal(output.imports.length, 0);
  const pool = workers(pathToFileURL(join(dir, 'preview-worker.mjs')).href);
  const c = createMigrationPreview({ selectSources: async () => [source(html)], catalog, createWorker: pool.createWorker });
  t.after(() => c.dispose()); await c.select();
  assert.equal((await ready(c)).results[0].plan.source, 'bookmarks-html');
});

test('compatible hashing preserves the previous SHA-256 identities and native snapshot boundaries', () => {
  const parts = ['migration-revision', { title: '中文 🧭' }, null, 4];
  assert.equal(opaqueId(...parts), createHash('sha256').update(JSON.stringify(parts)).digest('hex'));
  assert.throws(() => copySnapshots([{ ...source(chrome), path: '/arbitrary/system/path' }]), /INVALID_SOURCE_SNAPSHOT/);
  assert.throws(() => copySnapshots(Array.from({ length: 5 }, (_, i) => source(chrome, String(i)))), /SOURCE_COUNT_LIMIT/);
  assert.throws(() => copySnapshots([source('x'.repeat(4 * 1024 * 1024 + 1))]), /INVALID_SOURCE_SNAPSHOT/);
});

test('real worker validates native digest/UTF-8 size and parses a multi-MiB source preserving duplicate URLs', async t => {
  assert.ok(large.bytes > 3 * 1024 * 1024 && large.bytes < 4 * 1024 * 1024);
  let picked = { ...source(chrome), sha256: '0'.repeat(64) };
  const pool = workers(), c = createMigrationPreview({ selectSources: async () => [picked], catalog, createWorker: pool.createWorker });
  t.after(() => c.dispose()); await c.select();
  assert.equal((await until(c, s => s.status === 'error')).error, 'SOURCE_DIGEST_MISMATCH');
  picked = { ...source(chrome), bytes: 1 }; await c.select();
  assert.equal((await until(c, s => s.status === 'error')).error, 'SOURCE_BYTES_MISMATCH');
  picked = { ...large, sha256: large.sha256.toUpperCase() }; await c.select(); const p = await ready(c);
  assert.equal(p.results[0].plan.profiles[0].spaces[0].saved[0].children.length, 18000);
  c.setMappings(mapping(p)); const mapped = await ready(c);
  assert.equal(mapped.results[0].batch.counts.create, 18001);
  assert.equal(mapped.results[0].batch.counts.skipped, 0);
});

test('cancel terminates a real worker during CPU parsing and ignores a queued old result', async t => {
  const pool = workers(), c = createMigrationPreview({ selectSources: async () => [large], catalog, createWorker: pool.createWorker });
  t.after(() => c.dispose()); await c.select(); const w = pool.instances[0];
  let message; do { [message] = await once(w.raw, 'message'); } while (message.phase !== 'parsing');
  c.cancel(); assert.equal(w.terminated, true); await w.exit;
  w.onmessage({ data: { jobId: w.last.jobId, preview: { identity: [{ sourceId: large.sourceId, sha256: large.sha256 }], results: [] } } });
  assert.equal(c.getState().status, 'cancelled'); assert.equal(c.getState().preview, null);
  assert.throws(() => c.createCommitIntent(), /PREVIEW_NOT_READY/);
});

test('source replacement terminates the busy worker; picker races and old completion cannot overwrite new preview', async t => {
  const pool = workers(); let picked = large;
  const c = createMigrationPreview({ selectSources: async () => [picked], catalog, createWorker: pool.createWorker });
  t.after(() => c.dispose()); await c.select(); const old = pool.instances[0];
  let message; do { [message] = await once(old.raw, 'message'); } while (message.phase !== 'parsing');
  picked = source(html, 'native-second'); await c.select(); const current = await ready(c);
  assert.equal(old.terminated, true); assert.equal(current.results[0].plan.source, 'bookmarks-html');
  old.onmessage({ data: { jobId: old.last.jobId, preview: { identity: [{ sourceId: large.sourceId, sha256: large.sha256 }], results: [] } } });
  assert.equal(c.getState().preview.results[0].source.sourceId, 'native-second');
  let release;
  const race = createMigrationPreview({ catalog, createWorker: pool.createWorker,
    selectSources: () => new Promise(resolve => { release = resolve; }) });
  t.after(() => race.dispose()); const first = race.select(), finishFirst = release;
  const second = race.select(); release([source(chrome, 'new-picker')]); await second; await ready(race);
  finishFirst([large]); await first;
  assert.equal(race.getState().preview.results[0].source.sourceId, 'new-picker');
});

test('actual panel + real worker show mappings, empty Spaces/folders, duplicate URLs, warning/conflict/retry and disabled commit', async t => {
  const pool = workers(), picked = source(arc), c = createMigrationPreview({ selectSources: async () => [picked], catalog, createWorker: pool.createWorker });
  const { document, window } = parseHTML('<html><body><main></main></body></html>');
  const panel = mountMigrationPanel(document.querySelector('main'), { controller: c, catalog }); t.after(() => panel.dispose());
  const click = text => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(b, text); b.click(); };
  click('选择来源'); const initial = await ready(c);
  assert.ok(document.body.textContent.includes('arc'));
  assert.ok(document.body.textContent.includes('Empty space'));
  assert.ok(document.body.textContent.includes('空文件夹'));
  assert.ok(document.body.textContent.includes('SIDEBAR_NOT_COMPLETE_SESSION'));
  assert.equal(document.querySelectorAll('img').length, 0);
  assert.ok(document.querySelectorAll('[data-url="https://example.com/page"]').length >= 4);
  assert.equal([...document.querySelectorAll('button')].find(b => b.textContent === '导入').disabled, true);
  // Drive the real mapping controls, including resetting Spaces on Profile change.
  const profiles = document.querySelectorAll('select[aria-label="目标账号环境"]'); assert.equal(profiles.length, 2);
  for (let i = 0; i < profiles.length; ++i) {
    const node = profiles[i];
    [...node.options].forEach(o => { o.selected = false; });
    [...node.options].find(o => o.value === `p${i}`).selected = true;
    node.dispatchEvent(new window.Event('change'));
  }
  for (const node of document.querySelectorAll('select')) if (node.getAttribute('aria-label').startsWith('Space 映射')) {
    const option = [...node.options].find(o => o.value.startsWith('s'));
    // first profile has two source Spaces: select unique existing targets
    const value = node.getAttribute('aria-label').includes('Empty') ? 's0-1' : option.value;
    [...node.options].forEach(o => { o.selected = false; });
    [...node.options].find(o => o.value === value).selected = true;
    node.dispatchEvent(new window.Event('change'));
  }
  click('更新映射预览'); const mapped = await ready(c);
  assert.equal(mapped.results[0].mappingError, null);
  const dto = c.createCommitIntent(); assert.equal(dto.expectedTargetRevision, 'target-r7');
  assert.equal(dto.batches[0].containers.filter(c => c.kind === 'space').length, 3);
  assert.ok(dto.batches[0].items.some(i => i.parentKey !== null));
  assert.equal(c.getState().canCommit, false);
  // Feed a host ledger from the successful proposal into a fresh real preview, never claiming a write.
  const ledger = mapped.results[0].batch.receipt;
  const retry = createMigrationPreview({ selectSources: async () => [picked], catalog,
    ledgers: { [picked.sourceId]: ledger }, createWorker: pool.createWorker });
  const retryRoot = document.createElement('div');
  const retryPanel = mountMigrationPanel(retryRoot, { controller: retry, catalog });
  t.after(() => retryPanel.dispose()); await retry.select(); await ready(retry); retry.setMappings(mapping(initial, true));
  const repeated = await ready(retry); assert.ok(repeated.results[0].batch.counts.skipped > 0);
  assert.equal(repeated.results[0].batch.counts.create, 0);
  assert.match(retryRoot.textContent, /重复批次跳过 [1-9]/u);
  const changed = mapping(initial, true); changed[picked.sourceId][0].targetProfileId = 'new';
  changed[picked.sourceId][0].spaces.forEach(s => { s.targetSpaceId = 'new'; });
  retry.setMappings(changed); assert.ok((await ready(retry)).results[0].batch.counts.conflicts > 0);
  assert.ok(retryRoot.querySelector('[aria-label="冲突"] li'));
  assert.throws(() => retry.createCommitIntent(), /PREVIEW_NOT_READY/);
});

test('host digest history and duplicate selections are visible in the real panel and prevent intent creation', async t => {
  const pool = workers(), picked = source(chrome, 'fresh-native-handle');
  const c = createMigrationPreview({ selectSources: async () => [picked], catalog, createWorker: pool.createWorker,
    history: [{ batchId: 'committed-native-batch', sha256: picked.sha256.toUpperCase() }] });
  const { document } = parseHTML('<html><body></body></html>');
  const panel = mountMigrationPanel(document.body, { controller: c, catalog }); t.after(() => panel.dispose());
  await c.select(); const p = await ready(c); c.setMappings(mapping(p)); await ready(c);
  assert.match(document.body.textContent, /已导入相同摘要的来源批次：committed-native-batch/u);
  assert.throws(() => c.createCommitIntent(), /PREVIEW_NOT_READY/);
  const duplicates = createMigrationPreview({ selectSources: async () => [picked, { ...picked, sourceId: 'another-native-handle' }],
    catalog, createWorker: pool.createWorker }); t.after(() => duplicates.dispose());
  await duplicates.select(); const d = await ready(duplicates);
  assert.ok(d.results.every(r => r.duplicateSelection));
  duplicates.setMappings(mapping(d)); await ready(duplicates);
  assert.throws(() => duplicates.createCommitIntent(), /PREVIEW_NOT_READY/);
});

test('new container intent preserves empty Spaces, ordering and digest binding; unavailable worker never falls back to UI parsing', async t => {
  const pool = workers(), c = createMigrationPreview({ selectSources: async () => [source(arc)], catalog, createWorker: pool.createWorker });
  t.after(() => c.dispose()); await c.select(); const p = await ready(c); c.setMappings(mapping(p)); await ready(c);
  const dto = c.createCommitIntent(); assert.ok(dto.batches[0].containers.every(c => c.operation === 'create'));
  assert.deepEqual(dto.batches[0].containers.filter(c => c.kind === 'space').map(c => c.position), [0, 1, 0]);
  assert.equal(dto.batches[0].source.sha256, source(arc).sha256);
  assert.throws(() => c.createUndoIntent({ batchId: 'x' }), /NATIVE_RECEIPT_REQUIRED/);
  assert.deepEqual(c.createUndoIntent({ batchId: 'b', targetRevision: 'r', undoToken: 'native-opaque' }),
    { proposal: 'migration.undo.v0', batchId: 'b', expectedTargetRevision: 'r', undoToken: 'native-opaque' });
  const missing = createMigrationPreview({ selectSources: async () => [source(chrome)], catalog,
    createWorker() { throw new Error('CSP blocked'); } }); t.after(() => missing.dispose());
  await missing.select(); assert.equal(missing.getState().error, 'WORKER_UNAVAILABLE'); assert.equal(missing.getState().preview, null);
  const brokenPool = workers(new URL('./nonexistent-worker.mjs', import.meta.url).href);
  const broken = createMigrationPreview({ selectSources: async () => [source(chrome)], catalog, createWorker: brokenPool.createWorker });
  t.after(() => broken.dispose()); await broken.select();
  assert.equal((await until(broken, s => s.status === 'error')).error, 'WORKER_UNAVAILABLE');
  assert.equal(brokenPool.instances[0].terminated, true);
});