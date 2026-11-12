import { createMigrationPreview } from '../src/browser.mjs';
import { mountMigrationPanel } from '../src/panel.mjs';

// Runs in a fresh, offline headless Chrome Profile, against actual Web Workers/DOM.
window.runMigrationChecks = async ({ chrome, arc, large, catalog }) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const wait = (c, predicate = s => s.status === 'ready') => new Promise((resolve, reject) => {
    let off = () => {};
    const timer = setTimeout(() => { off(); reject(new Error('browser preview timeout')); }, 15000);
    off = c.subscribe(s => {
      if (s.status === 'error' || predicate(s)) {
        clearTimeout(timer); queueMicrotask(() => off());
        if (s.status === 'error') reject(new Error(s.error)); else resolve(s);
      }
    });
  });
  const instances = [];
  const createWorker = () => {
    const w = new Worker(new URL('./preview-worker.mjs', import.meta.url), { type: 'module' });
    let begin;
    const record = { w, parsing: new Promise(resolve => { begin = resolve; }), terminated: false };
    w.addEventListener('message', e => { if (e.data.phase === 'parsing') begin(); });
    const terminate = w.terminate.bind(w);
    w.terminate = () => { record.terminated = true; terminate(); };
    instances.push(record); return w;
  };
  let picked = large;
  const c = createMigrationPreview({ selectSources: async () => [picked], catalog, createWorker });
  const panel = mountMigrationPanel(document.body, { controller: c, catalog });
  try {
    await c.select(); await instances.at(-1).parsing; c.cancel();
    check(instances.at(-1).terminated && c.getState().status === 'cancelled', 'real browser CPU cancel');
    await c.select(); const old = instances.at(-1); await old.parsing;
    picked = chrome; await c.select(); await wait(c);
    check(old.terminated && c.getState().preview.results[0].source.sourceId === chrome.sourceId, 'real browser source race');
    picked = large; await c.select(); const bulk = await wait(c);
    check(bulk.preview.results[0].plan.profiles[0].spaces[0].saved[0].children.length === 18000, 'real browser large input');
    picked = arc; await c.select(); await wait(c);
    check(document.body.textContent.includes('Empty space') && document.body.textContent.includes('空文件夹'), 'empty containers in real DOM');
    check(document.querySelectorAll('[data-url="https://example.com/page"]').length >= 4, 'duplicate URL rows');
    check(!document.querySelector('img'), 'source name remains inert');
    const profiles = document.querySelectorAll('select[aria-label="目标账号环境"]');
    check(profiles.length === 2, 'two separate source Profiles');
    for (let i = 0; i < profiles.length; ++i) { profiles[i].value = `p${i}`; profiles[i].dispatchEvent(new Event('change')); }
    for (const node of document.querySelectorAll('select')) if (node.getAttribute('aria-label').startsWith('Space 映射')) {
      node.value = node.getAttribute('aria-label').includes('Empty') ? 's0-1' : [...node.options].find(o => o.value.startsWith('s')).value;
      node.dispatchEvent(new Event('change'));
    }
    [...document.querySelectorAll('button')].find(b => b.textContent === '更新映射预览').click();
    await wait(c);
    check(c.createCommitIntent().batches[0].containers.filter(c => c.kind === 'space').length === 3, 'mapped empty Space intent');
    check([...document.querySelectorAll('button')].find(b => b.textContent === '导入').disabled, 'native commit disabled');
    check(document.body.textContent.includes('原生迁移 commit/undo API 尚未提供'), 'native limitation visible');
    return { checks: 10, workerCount: instances.length, userData: 'synthetic-only' };
  } finally { panel.dispose(); }
};