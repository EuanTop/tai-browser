import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createAgentPanelModule } from '../panel-module.mjs';

const binding = { profileId: 'p', spaceId: 's', taskId: 't' };
test('browser module factory mounts authorized facade, retains binding and cleans up subscriptions', () => {
  const { document } = parseHTML('<main></main>'), container = document.querySelector('main');
  const original = { ...binding }; let listener, removed = 0;
  let state = { state: 'resumed', binding, threadId: 'original-thread', items: [], approvals: [],
    capabilities: { resume: true, liveAttach: false, concurrentWriters: false } };
  const module = createAgentPanelModule({ binding: original, controller: {
    getSnapshot: () => state, subscribe: fn => { listener = fn; return () => { removed++; }; },
    send() {}, approve() {}, cancel() {}, history() {},
  } });
  original.spaceId = 'foreground'; module.mount(container);
  assert.match(container.textContent, /original-thread/); assert.equal(module.binding.spaceId, 's');
  assert.equal(module.capabilities.concurrentWriters, false);
  assert.throws(() => module.mount(container), /already mounted/);
  state = { ...state, binding: { ...binding, spaceId: 'other' } };
  assert.throws(() => listener(state), /binding mismatch/);
  module.dispose(); assert.equal(removed, 1); assert.equal(container.children.length, 0);
});

test('missing host or lease shows capability unavailable with no send/approval controls', () => {
  const { document } = parseHTML('<main></main>'), container = document.querySelector('main');
  const module = createAgentPanelModule({ binding }); module.mount(container);
  assert.equal(container.querySelector('[data-code]').dataset.code, 'CAPABILITY_UNAVAILABLE');
  assert.equal(container.querySelectorAll('button,textarea').length, 0);
  assert.equal(module.capabilities.panel, false); module.dispose();
  assert.throws(() => createAgentPanelModule({ binding: { ...binding, pageId: 'page' } }));
});
