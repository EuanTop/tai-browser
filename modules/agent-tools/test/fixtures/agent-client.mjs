import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
export async function previewFromOriginalAgent() {
  const client = new Client({ name: 'synthetic-original-agent', version: '1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL('./server.mjs', import.meta.url))], env: {}, stderr: 'pipe' }));
    return await client.callTool({ name: 'tai_preview', arguments: { moduleId: 'tai.timer', version: '1.0.0' } });
  } finally { await client.close(); }
}
