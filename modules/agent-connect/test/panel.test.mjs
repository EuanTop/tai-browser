import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { mountChatPanel } from '../chat-panel.mjs';
test('embedded panel escapes untrusted messages, dispatches approval and preserves draft on stream update', async () => {
  const { document, Event } = parseHTML('<main id="host"></main>');
  let state = { state: 'awaiting-approval', binding: { spaceId: 's', taskId: 't' }, threadId: 'same-thread',
    items: [{ id: 'reply', type: 'agentMessage', text: '<img src=x onerror="leak()">' }], approvals: [
      { requestId: 51, turnId: 'turn', kind: 'item/commandExecution/requestApproval', command: 'synthetic command' },
    ] };
  let listener, approved; const host = document.getElementById('host');
  const dispose = mountChatPanel(host, { getSnapshot: () => state, subscribe: fn => { listener = fn; return () => { listener = undefined; }; },
    approve: (id, decision) => { approved = [id, decision]; }, send() {}, cancel() {}, history: async () => ({ data: [] }) });
  assert.equal(host.querySelectorAll('img').length, 0); assert.match(host.textContent, /<img/);
  const input = host.querySelector('textarea'); input.value = 'draft';
  state = { ...state, items: [...state.items, { id: 'tool', type: 'mcpToolCall', status: 'inProgress' }] }; listener(state);
  assert.equal(input.value, 'draft');
  [...host.querySelectorAll('button')].find(button => button.textContent === '允许一次').dispatchEvent(new Event('click'));
  assert.deepEqual(approved, [51, 'accept']);
  dispose(); assert.equal(listener, undefined); assert.equal(host.children.length, 0);
});
