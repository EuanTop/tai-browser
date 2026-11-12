// Synthetic JSONL process. Never launches Codex or a provider.
import { createInterface } from 'node:readline';
const send = value => process.stdout.write(JSON.stringify(value) + '\n');
const mode = process.argv[2];
let initialized = false, acknowledged = false, turns = 0, active;
const threadId = 'thread-fixture';
const event = (method, params) => send({ method, params: { threadId, ...params } });
function finish(status = 'completed') {
  event('item/completed', { turnId: active, item: { id: 'reply', type: 'agentMessage', text: '你好 complete' } });
  event('item/completed', { turnId: active, item: { id: 'reply', type: 'agentMessage', text: '你好 complete' } });
  event('item/started', { turnId: active, item: { id: 'reply', type: 'agentMessage', text: '' } });
  event('item/agentMessage/delta', { turnId: active, itemId: 'reply', delta: 'late' });
  event('turn/completed', { turn: { id: active, status } });
  event('turn/started', { turn: { id: active, status: 'inProgress' } });
}
createInterface({ input: process.stdin }).on('line', async line => {
  const message = JSON.parse(line), { id, method, params } = message;
  if ('jsonrpc' in message) process.exit(3);
  if (!method) {
    if (id === 51) {
      if (!['accept', 'decline', 'cancel'].includes(message.result?.decision)) process.exit(4);
      event('serverRequest/resolved', { requestId: id }); finish(message.result.decision === 'cancel' ? 'interrupted' : 'completed');
    }
    return;
  }
  if (method === 'initialize') {
    initialized = true;
    if (mode === 'malformed') { process.stdout.write('{bad}\n'); return; }
    if (mode === 'oversize') { process.stdout.write('x'.repeat(8192)); return; }
    send({ id, result: { userAgent: 'fixture' } }); return;
  }
  if (method === 'initialized') { acknowledged = true; return; }
  if (!initialized || !acknowledged) { send({ id, error: { code: -1, message: 'Not initialized' } }); return; }
  if (method === 'thread/start' || method === 'thread/resume') {
    send({ id, result: { thread: { id: params.threadId ?? threadId, sessionId: 'session-root-fixture' } } }); return;
  }
  if (method === 'thread/list') { send({ id, result: { data: [{ id: threadId }], nextCursor: null } }); return; }
  if (method === 'thread/turns/list') {
    send({ id, result: { data: [{ id: 'old-turn', status: 'completed', items: [] }], nextCursor: null } }); return;
  }
  if (method === 'turn/start') {
    if (params.input[0].text === 'disconnect') { process.exit(0); return; }
    if (params.input[0].text === 'timeout') return;
    active = `turn-${++turns}`;
    event('turn/started', { turn: { id: active, status: 'inProgress' } });
    if (params.input[0].text === 'early-approval') send({ id: 51, method: 'item/commandExecution/requestApproval', params: {
      threadId, turnId: active, itemId: 'early-cmd', command: 'synthetic early command',
    } });
    if (params.input[0].text === 'fast-fail') finish('failed');
    send({ id, result: { turn: { id: active, status: 'inProgress' } } });
    if (['fast-fail','early-approval'].includes(params.input[0].text)) return;
    if (params.input[0].text === 'long') return;
    if (params.input[0].text === 'preview') {
      const { previewFromOriginalAgent } = await import('../../../agent-tools/test/fixtures/agent-client.mjs');
      const result = await previewFromOriginalAgent();
      event('item/completed', { turnId: active, item: { id: 'tool-preview', type: 'mcpToolCall',
        server: 'tai', tool: 'tai_preview', status: 'completed', result } });
      finish(); return;
    }
    // Unrelated profile/session events must not appear in this conversation.
    send({ method: 'item/completed', params: { threadId: 'other', turnId: active, item: { id: 'leak', text: 'private' } } });
    event('item/agentMessage/delta', { turnId: active, itemId: 'reply', delta: '你好' });
    event('item/started', { turnId: active, item: { id: 'reply', type: 'agentMessage', text: '' } });
    const approval = { id: 51, method: 'item/commandExecution/requestApproval', params: {
      threadId, turnId: active, itemId: 'cmd', command: 'echo synthetic', availableDecisions: ['accept', 'decline', 'cancel'],
    } };
    send(approval); send(approval); return;
  }
  if (method === 'turn/interrupt') {
    send({ id, result: {} }); setTimeout(() => finish('interrupted'), 20); return;
  }
  if (method === 'fixture/unsupported') {
    send({ id: 'unknown-1', method: 'item/permissions/requestApproval', params: { threadId, turnId: active } });
    send({ id, result: {} }); return;
  }
  send({ id, error: { code: -32601, message: 'Unsupported' } });
});
