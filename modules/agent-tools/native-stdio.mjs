#!/usr/bin/env node
import { connectNativeHost } from '../../src/host/client/native-client.mjs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createNativeToolServer } from './native-tools.mjs';
import {trackNativeClient} from './native-presence.mjs';

// The launch argument is the sole connection source. Never inspect home/env/config defaults.
if (process.argv.length !== 4 || process.argv[2] !== '--connection-file' || !process.argv[3]) {
  process.stderr.write('Usage: native-stdio.mjs --connection-file <explicit-selected-file>\n');
  process.exitCode = 1;
} else {
  try {
    const host = await connectNativeHost(process.argv[3]);
    const server = createNativeToolServer(host);
    const presence=trackNativeClient(server,host);
    await server.connect(new StdioServerTransport());
    // The SDK transport does not close itself on stdin EOF. Abort native in-flight
    // requests when the original Agent disappears; this never rolls work back.
    process.stdin.once('end', () => { void presence.dispose().finally(()=>server.close()); });
  } catch {
    // Neither file paths, raw exceptions, configuration nor tokens reach diagnostics.
    process.stderr.write('TAI_MCP_START_FAILED\n');
    process.exitCode = 1;
  }
}
