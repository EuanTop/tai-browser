import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureSnapshot } from '../index.mjs';
import { ClipLibrary, createClipCommands } from '../../library/index.mjs';
import { createTestFileStore } from '../../library/test-file-store.mjs';
import { mountLibrary } from '../../library/view.mjs';
import { JSDOM } from 'jsdom';

const snapshot = {
  url: 'https://example.test/article', title: '中文合成文章', capturedAt: '2026-10-18T10:00:00Z',
  scope: { profileId: 'profile-a', spaceId: 'space-a', pageId: 'page-a' },
  html: '<html><head><title>合成文章</title></head><body><nav>杂项</nav><article><h1>中文合成文章</h1>' +
    '<p>这是供测试使用的中文正文。保存后可以离线阅读与检索。'.repeat(20) + '</p>' +
    '<pre><code class="language-js">const answer = 42;</code></pre><img width="500" height="400" src="/figure.png"><script>throw Error("must not run")</script></article></body></html>',
};

test('inert extraction → immutable local files → restart/rebuild → shared command read', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tai-synthetic-'))); t.after(() => rm(root, { recursive:true, force:true }));
  const store = await createTestFileStore({ testRoot: root, synthetic: true });
  const library = new ClipLibrary({ libraryId:'library-fixture', store });
  const events = [], commands = createClipCommands({ library, capture: captureSnapshot, emit: e => events.push(e) });
  const receipt = await commands.capture(snapshot, { id:'clip-fixture', tags:['测试'] });
  assert.equal(events[0].type, 'clip.saved'); assert.equal(events[0].scope.profileId, 'profile-a');
  const clip = await commands.read(receipt.clipId);
  assert.match(clip.markdown, /const answer = 42/); assert.match(clip.markdown, /中文正文/);
  assert.doesNotMatch(clip.markdown, /must not run/); assert.equal(clip.assets[0].status, 'remote');
  assert.equal(clip.source.spaceId, 'space-a');
  await library.save(clip); assert.equal(library.search('中文正文').length, 1);
  const restarted = new ClipLibrary({ libraryId: 'library-fixture', store });
  assert.equal((await restarted.rebuild()).count, 1); assert.deepEqual(await restarted.read(clip.id), clip);
  await restarted.save({ ...clip, markdown:'并发编辑副本' });
  await assert.rejects(restarted.read(clip.id), /Conflict/);
  assert.equal((await restarted.read(clip.id, { variant:receipt.variant })).markdown, clip.markdown);
  await restarted.save({ ...clip, revision: 2, markdown:'新版本' });
  assert.equal((await restarted.read(clip.id)).markdown, '新版本');
  await writeFile(join(root,'clips','clip-fixture','broken.json'), '{broken');
  assert.equal((await restarted.rebuild()).warnings[0].code, 'corrupt-record');
});

test('selection is isolated, no async fetch, partial attachments remain explicit', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('network forbidden'); };
  try {
    const clip = await captureSnapshot({ ...snapshot, selectionHtml:'<p>只保存选区</p><pre><code>x &lt; y</code></pre><img src="file:///private/blocked.png">' });
    assert.match(clip.markdown, /只保存选区/); assert.doesNotMatch(clip.markdown, /中文正文/);
    assert.equal(clip.assets[0].status, 'missing');
    await captureSnapshot({ ...snapshot, url:'https://x.com/example/status/1', html:'<p>离线内容</p>' });
  } finally { globalThis.fetch = previous; }
});

test('failure does not publish success; file adapter rejects unselected roots/traversal/symlinks', async t => {
  await assert.rejects(createTestFileStore(), /testRoot/);
  const root = await realpath(await mkdtemp(join(tmpdir(), 'tai-synthetic-'))); t.after(() => rm(root, { recursive:true, force:true }));
  const store = await createTestFileStore({ testRoot:root, synthetic:true });
  await assert.rejects(store.read('../secret'), /resource/);
  await symlink(tmpdir(), join(root,'escape'));
  await assert.rejects(store.putIfAbsent('escape/test','no'), /directory/);
  const library = new ClipLibrary({ libraryId:'test', store: { ...store, putIfAbsent: async (key, value) => {
    if (key.endsWith('.json')) throw Error('disk full'); return store.putIfAbsent(key,value);
  } } });
  const events = [], commands = createClipCommands({ library, capture:captureSnapshot, emit:e => events.push(e) });
  await assert.rejects(commands.capture(snapshot), /disk full/);
  assert.equal(events.length, 0); assert.equal((await library.rebuild()).count, 0);
});

test('no-AI library UI reads through the shared mature reader', async t => {
  const dom = new JSDOM('<main></main>'); t.after(() => dom.window.close());
  const memory = new Map(), store = {
    read: async key => memory.get(key), list: async () => [...memory.keys()],
    putIfAbsent: async (key,value) => { if (!memory.has(key)) memory.set(key,value); },
  };
  const library = new ClipLibrary({ libraryId:'ui-test', store });
  const commands = createClipCommands({ library, capture:captureSnapshot });
  await commands.capture(snapshot);
  const root = dom.window.document.querySelector('main');
  const panel = mountLibrary(root, { commands }); await panel.ready;
  root.querySelector('li button').click();
  // Wait for the reader's asynchronous resource policy to settle, not a wall-clock delay.
  for (let i=0; i<10 && !root.querySelector('article'); i++) await new Promise(resolve => setImmediate(resolve));
  assert.match(root.querySelector('article').textContent,/中文正文/);
  assert.equal(root.querySelector('script'),null); panel.close();
});
