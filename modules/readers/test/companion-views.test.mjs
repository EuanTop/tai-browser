import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountPomodoro } from '../../apps/pomodoro/view.mjs';
import { mountVersionPanel } from '../../studio/view.mjs';
import { ModuleStudio } from '../../studio/index.mjs';

const settle = () => new Promise(resolve => setImmediate(resolve));

test('actual Pomodoro frontend runs start/pause/reset and remounts persisted deadline', async t => {
  const dom = new JSDOM('<main></main>'); t.after(() => dom.window.close());
  const root = dom.window.document.querySelector('main'), memory = new Map(); let time = 1000;
  const sdk = { storage:{get:async k => memory.get(k),set:async (k,v) => memory.set(k,structuredClone(v))},notify:async () => {} };
  let view = await mountPomodoro(root,{sdk,now:() => time,durationMs:5000});
  assert.equal(root.querySelector('output').textContent,'00:05');
  root.querySelectorAll('button')[0].click(); await settle();
  assert.equal(view.timer.state().status,'running');
  time += 2000; root.querySelectorAll('button')[1].click(); await settle();
  assert.equal(root.querySelector('output').textContent,'00:03');
  root.querySelectorAll('button')[0].click(); await settle(); view.close();
  time += 10000; view = await mountPomodoro(root,{sdk,now:() => time,durationMs:5000});
  assert.equal(view.timer.state().status,'completed'); assert.equal(root.querySelector('output').textContent,'00:00');
  root.querySelectorAll('button')[2].click(); await settle();
  assert.equal(view.timer.state().status,'idle'); view.close(); assert.equal(root.children.length,0);
});

test('actual version panel applies successful preview and exposes disable', async t => {
  const dom = new JSDOM('<main></main>'); t.after(() => dom.window.close());
  const studio = new ModuleStudio({scope:{profileId:'test',spaceId:'test'},host:{
    preview:async () => 'synthetic-renderer-handle',activate:async () => {},disable:async () => {},dispose:async () => {},
  }});
  await studio.preview({manifest:{apiVersion:1,id:'test.app',version:'0.1.0',title:'Synthetic app',entry:'index.html',surfaces:['panel'],capabilities:[]},files:{'index.html':'<p>Preview</p>'}});
  const root = dom.window.document.querySelector('main'), panel = mountVersionPanel(root,{studio});
  root.querySelector('li button').click(); await settle();
  assert.equal(studio.state().enabled,true); assert.match(root.querySelector('p').textContent,/active/);
  [...root.querySelectorAll('button')].find(b => b.textContent === 'Disable').click(); await settle();
  assert.equal(studio.state().enabled,false); panel.close();
});
