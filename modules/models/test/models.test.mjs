import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { ShortTasks } from '../short-tasks.mjs';
import { createPiCompletion } from '../pi-completion.mjs';
const config = { endpoint: 'https://synthetic.example/v1', model: 'fixture', credentialRef: 'synthetic-key-ref' };
function page() { return { title: 'Original', manuallyNamed: false,
  scope: { profileId: 'p', spaceId: 's', pageId: 'page', pageRevision: 3 } }; }
function host(complete, options = {}) {
  let current = page(), writes = 0;
  const tasks = new ShortTasks({ complete, ...options, applyTitleIfCurrent: async request => {
    if (request.signal?.aborted || !current || current.manuallyNamed || current.title !== request.expectedTitle ||
        JSON.stringify(current.scope) !== JSON.stringify(request.scope)) return false;
    current.title = request.title; writes++; return true;
  } });
  return { tasks, current: () => current, move: () => { current.scope.spaceId = 'elsewhere'; },
    rename: () => { current.title = 'User title'; current.manuallyNamed = true; },
    close: () => { current = undefined; }, writes: () => writes };
}
test('valid short naming is coalesced and applies once through host CAS', async () => {
  let calls = 0; const h = host(async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return '{"title":"Short"}'; });
  const before = page(); const [first, second] = await Promise.all([h.tasks.rename(before, config), h.tasks.rename(before, config)]);
  assert.equal(first.applied, true); assert.deepEqual(first, second); assert.equal(calls, 1); assert.equal(h.writes(), 1);
});
test('manual name, invalid output, 429 and missing key preserve original', async () => {
  for (const output of ['{}','{"title":""}','{"title":" a "}','{"title":"' + 'a'.repeat(33) + '"}',
    '{"title":"ok","scope":{}}', 'not JSON']) {
    const h = host(async () => output); assert.equal((await h.tasks.rename(page(), config)).applied, false);
    assert.equal(h.current().title, 'Original'); assert.equal(h.writes(), 0);
  }
  for (const code of ['429', 'CREDENTIAL_MISSING']) {
    const h = host(async () => { throw new Error(code); }); assert.equal((await h.tasks.rename(page(), config)).applied, false);
    assert.equal(h.current().title, 'Original');
  }
  const h = host(() => { throw new Error('should never run'); });
  assert.equal((await h.tasks.rename({ ...page(), manuallyNamed: true }, config)).code, 'MANUAL_NAME');
});
test('moved, closed or manually renamed during API call never overwritten', async () => {
  for (const change of ['move','close','rename']) {
    let release; const h = host(() => new Promise(resolve => { release = resolve; }));
    const result = h.tasks.rename(page(), config); await Promise.resolve(); h[change](); release('{"title":"Stale"}');
    assert.equal((await result).code, 'STALE_PAGE'); assert.equal(h.writes(), 0);
  }
});
test('abort, timeout and concurrency limit preserve original state', async () => {
  const h = host(({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
    { timeoutMs: 20, maxConcurrent: 1 });
  const controller = new AbortController();
  const pending = h.tasks.rename(page(), config, { signal: controller.signal });
  assert.equal((await h.tasks.rename({ ...page(), title: 'Other' }, config)).code, 'BUSY');
  controller.abort(); assert.equal((await pending).applied, false);
  const timeout = await h.tasks.rename(page(), config); assert.equal(timeout.code, 'TIMEOUT');
  assert.equal(h.writes(), 0);
});
test('classification is a validated preview and keeps expected page revisions', async () => {
  const h = host(async () => '{"assignments":[{"pageId":"page","category":"Work"}]}');
  const result = await h.tasks.classify([page()], ['Work','Read'], config);
  assert.equal(result.proposal[0].scope.pageRevision, 3); assert.equal(h.writes(), 0);
  const bad = host(async () => '{"assignments":[{"pageId":"other","category":"Injected"}]}');
  assert.equal((await bad.tasks.classify([page()], ['Work'], config)).code, 'INVALID_OUTPUT');
});
test('real Pi provider uses local synthetic SSE only; no ambient key or Agent loop', async t => {
  let requests = 0, authorization, failMode = false;
  const server = http.createServer((request, response) => {
    requests++; authorization = request.headers.authorization;
    let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => {
      if (failMode) { response.writeHead(429, { 'Content-Type': 'application/json' }); response.end('{"error":{"message":"synthetic rate limit"}}'); return; }
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(JSON.parse(body).model, 'fixture-model'); assert.equal(JSON.parse(body).tools, undefined);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end('data: ' + JSON.stringify({ id: 'chat-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model',
        choices: [{ index: 0, delta: { role: 'assistant', content: '{"title":"Local"}' }, finish_reason: null }] }) + '\n\n' +
        'data: ' + JSON.stringify({ id: 'chat-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  const complete = createPiCompletion({ resolveCredential: async ref => ref === 'fixture-ref' ? 'synthetic-only-key' : undefined,
    authorizeEndpoint: async url => url === endpoint });
  const result = await complete({ config: { endpoint, model: 'fixture-model', credentialRef: 'fixture-ref' }, prompt: 'Synthetic title', signal: new AbortController().signal });
  assert.equal(result, '{"title":"Local"}'); assert.equal(requests, 1); assert.equal(authorization, 'Bearer synthetic-only-key');
  await assert.rejects(complete({ config: { endpoint, model: 'fixture-model', credentialRef: 'missing' }, signal: new AbortController().signal }), /CREDENTIAL_MISSING/);
  assert.equal(requests, 1);
  failMode = true;
  const h = host(complete);
  const failed = await h.tasks.rename(page(), { endpoint, model: 'fixture-model', credentialRef: 'fixture-ref' });
  assert.equal(failed.applied, false); assert.equal(h.writes(), 0); assert.equal(requests, 2);
});
