import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createToolServer } from '../bridge.mjs';

const binding = { profileId: 'p', spaceId: 's', taskId: 't', pageId: 'page', pageRevision: 2 };
const tools = [{ name: 'tai_read', command: 'page.read', description: 'Read bound page', inputSchema: {
  type: 'object', properties: {}, additionalProperties: false,
} }];
test('real MCP stdio child: initialize, list and preview; reject scope injection', async t => {
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/server.mjs', import.meta.url))], env: {}, stderr: 'pipe' });
  const client = new Client({ name: 'fixture-original-agent', version: '1' });
  t.after(() => client.close()); await client.connect(transport);
  assert.equal((await client.listTools()).tools[0].name, 'tai_preview');
  const result = await client.callTool({ name: 'tai_preview', arguments: { moduleId: 'tai.timer', version: '1.0.0' } });
  assert.equal(JSON.parse(result.content[0].text).value.scope.profileId, 'fixture-profile');
  const injected = await client.callTool({ name: 'tai_preview', arguments: {
    moduleId: 'tai.timer', version: '1.0.0', scope: { profileId: 'other' },
  } });
  assert.equal(injected.isError, true);
  assert.equal(JSON.parse(injected.content[0].text).error.code, 'INVALID_ARGUMENTS');
});
test('fixed binding, host rejection and errors are redacted, result correlation checked', async t => {
  let mode = 'capture'; let captured;
  const host = { execute: async request => {
    captured = request;
    if (mode === 'throw') throw new Error('secret token');
    if (mode === 'wrong-id') return { id: 'wrong', ok: true, value: 'private' };
    return { id: request.id, ok: false, error: { code: 'SCOPE_REVOKED', message: 'private path' } };
  } };
  const server = createToolServer({ binding, tools, host }); binding.profileId = 'foreground';
  const [left, right] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(right); await client.connect(left);
  let result = await client.callTool({ name: 'tai_read', arguments: {} });
  assert.equal(captured.scope.profileId, 'p'); assert.match(result.content[0].text, /SCOPE_REVOKED/);
  assert.doesNotMatch(result.content[0].text, /private/);
  mode = 'throw'; result = await client.callTool({ name: 'tai_read', arguments: {} });
  assert.doesNotMatch(result.content[0].text, /secret/);
  mode = 'wrong-id'; result = await client.callTool({ name: 'tai_read', arguments: {} });
  assert.match(result.content[0].text, /INVALID_HOST_RESULT/);
});
test('no arbitrary CDP, settings or filesystem tool registration', () => {
  for (const command of ['cdp.send', 'settings.patch', 'migration.commit', 'shell.exec'])
    assert.throws(() => createToolServer({ binding, tools: [{ ...tools[0], command }], host: { execute() {} } }));
});
