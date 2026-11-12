import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JsonlRpc } from '../jsonl-rpc.mjs';
import { CodexSession } from '../codex-session.mjs';
const fixture = fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url));
const originalBinding = { profileId: 'p', spaceId: 's', taskId: 't', pageId: 'page', pageRevision: 1 };
function setup(t, mode, options = {}) {
  const child = spawn(process.execPath, [fixture, ...(mode ? [mode] : [])], { env: {}, stdio: ['pipe','pipe','pipe'] });
  const rpc = new JsonlRpc(child, { timeoutMs: 1000, ...options });
  const binding = { ...originalBinding }; let leaseCount = 0;
  const session = new CodexSession(rpc, binding, { acquireThreadLease: async () => {
    leaseCount++; return () => { leaseCount--; };
  } });
  t.after(() => rpc.close());
  return { rpc, session, binding, leaseCount: () => leaseCount };
}
function until(session, predicate) {
  if (predicate(session.snapshot)) return Promise.resolve(session.snapshot);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { session.off('change', listener); reject(new Error('State timeout')); }, 2000);
    function listener(snapshot) {
      if (predicate(snapshot)) { clearTimeout(timer); session.off('change', listener); resolve(snapshot); }
    }
    session.on('change', listener);
  });
}

test('real JSONL subprocess: handshake, provider IDs, out of order items, duplicate approval, scoped stream', async t => {
  const { session, binding } = setup(t);
  await session.initialize();
  assert.equal((await session.listThreads()).data[0].id, 'thread-fixture');
  const opened = await session.open();
  assert.equal(opened.threadId, 'thread-fixture'); assert.equal(opened.sessionId, 'session-root-fixture');
  binding.spaceId = 'foreground-space';
  await session.send('hello');
  const pending = await until(session, state => state.approvals.length === 1);
  assert.equal(pending.binding.spaceId, 's');
  assert.equal(pending.items[0].text, '你好');
  assert.equal(pending.items.some(item => item.id === 'leak'), false);
  assert.throws(() => session.approve(51, 'acceptForSession'));
  session.approve(51, 'accept');
  const complete = await until(session, state => state.state === 'idle');
  assert.equal(complete.items.length, 1); assert.equal(complete.items[0].text, '你好 complete');
  assert.equal(complete.items[0].final, true); assert.throws(() => session.approve(51, 'accept'));
});
test('resume requires explicit takeover and lease; history is not live activity', async t => {
  const { session, leaseCount } = setup(t);
  await session.initialize();
  await assert.rejects(session.open({ threadId: 'thread-fixture' }), /takeover/);
  assert.equal(leaseCount(), 0);
  const opened = await session.open({ threadId: 'thread-fixture', takeover: true });
  assert.equal(opened.mode, 'takeover'); assert.equal(leaseCount(), 1);
  assert.equal(session.snapshot.capabilities.liveAttach, false);
  assert.equal((await session.history()).data[0].id, 'old-turn');
  assert.deepEqual(session.snapshot.items, []);
  await assert.rejects(session.open({ threadId: 'other', takeover: true }));
  await session.close(); assert.equal(leaseCount(), 0);
});
test('cancel waits for terminal event, double send rejected, no stale approval after stop', async t => {
  const { session } = setup(t); await session.initialize(); await session.open();
  await session.send('long'); await assert.rejects(session.send('double'));
  await session.cancel(); assert.equal(session.snapshot.state, 'stopping');
  await until(session, state => state.state === 'idle');
  assert.throws(() => session.approve(51, 'accept')); await assert.rejects(session.cancel());
});
test('disconnect releases ownership and does not retry a potentially delivered turn', async t => {
  const { session, rpc, leaseCount } = setup(t); await session.initialize(); await session.open();
  await assert.rejects(session.send('disconnect'), /DISCONNECTED/); await rpc.closed;
  assert.equal(leaseCount(), 0); assert.equal(session.snapshot.state, 'disconnected');
  await assert.rejects(session.send('again'));
});
test('turn timeout becomes uncertain instead of silently repeating work', async t => {
  const { session } = setup(t, undefined, { timeoutMs: 80 });
  await session.initialize(); await session.open();
  await assert.rejects(session.send('timeout'), /RPC_TIMEOUT_UNCERTAIN/);
  assert.equal(session.snapshot.state, 'uncertain'); await assert.rejects(session.send('repeat'));
});
test('malformed and oversized JSONL fail closed', async t => {
  for (const mode of ['malformed', 'oversize']) {
    const { session } = setup(t, mode, { maxLineBytes: 1024 });
    await assert.rejects(session.initialize(), /INVALID_FRAME|FRAME_TOO_LARGE/);
    assert.equal(session.snapshot.state, 'disconnected');
  }
});
test('full synthetic process chain: right-panel turn → App Server → MCP → scoped host → tool event', async t => {
  const { session } = setup(t); await session.initialize(); await session.open();
  await session.send('preview');
  const done = await until(session, state => state.state === 'idle');
  const tool = done.items.find(item => item.id === 'tool-preview');
  assert.equal(tool.status, 'completed');
  const value = JSON.parse(tool.result.content[0].text).value;
  assert.equal(value.previewId, 'synthetic-preview'); assert.equal(value.moduleId, 'tai.timer');
  assert.equal(value.scope.profileId, 'fixture-profile');
  assert.equal(done.threadId, 'thread-fixture');
});

test('terminal failure arriving before start response stays terminal and visible', async t => {
  const { session } = setup(t); await session.initialize(); await session.open();
  await session.send('fast-fail');
  assert.equal(session.snapshot.state, 'idle'); assert.equal(session.snapshot.lastTurn.status, 'failed');
});

test('approval before turn/start response stays pending; stopping invalidates its UI response', async t => {
  const { session } = setup(t); await session.initialize(); await session.open();
  await session.send('early-approval');
  assert.equal(session.snapshot.state, 'awaiting-approval');
  const stopped = session.cancel(); assert.equal(session.snapshot.state, 'stopping');
  assert.throws(() => session.approve(51, 'accept'), /Expired/);
  await stopped; await until(session, state => state.state === 'idle');
  assert.equal(session.snapshot.approvals.length, 0);
});
