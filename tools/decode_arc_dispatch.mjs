// Project-level, digest-bound use of REA's decoder library. This is not a
// canonical CLI Evidence record and does not alter REA's 64 MiB CLI limit.
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { decodeAppleDispatchMetadata } from './rea/node_modules/rea-agents/dist/native/AppleDispatchMetadata.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'research/local/arc-arm64');
const output = path.join(root, 'research/local/arc-dispatch-decoder.json');
const expected = 'cb07a51b6d36fca64730ae73cfbaa2131d8b39d6d8cc6ac9c201389d80cdfa47';
const maximumBytes = 96 * 1024 * 1024;
const maximumRecords = 50000;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const before = await lstat(target);
if (!before.isFile() || before.size > maximumBytes) throw new Error('Unexpected research artifact or input budget exceeded');
const bytes = await readFile(target);
const after = await lstat(target);
if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || digest(bytes) !== expected) {
  throw new Error('Research artifact identity changed');
}
const result = decodeAppleDispatchMetadata(bytes, maximumRecords, { path: target, sha256: expected }, 'arm64');
const decoderPath = path.join(root, 'tools/rea/node_modules/rea-agents/dist/native/AppleDispatchMetadata.js');
const report = {
  kind: 'project-decoder-report',
  tool: 'REA 6.5.0 decodeAppleDispatchMetadata direct library invocation',
  decoder_sha256: digest(await readFile(decoderPath)),
  driver_sha256: digest(await readFile(fileURLToPath(import.meta.url))),
  target, target_sha256: expected, input_bytes: bytes.length,
  input_budget_bytes: maximumBytes, max_records: maximumRecords,
  limitations: [
    'Project-generated report, not canonical REA CLI or MCP Evidence.',
    'Uses the unmodified pinned REA decoder with a caller-declared 96 MiB input budget.',
    'Static declarations do not establish runtime dispatch or Space/Profile isolation.',
    'Preserve the decoder coverage and truncation records in result.',
  ],
  result,
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const selected = [];
function walk(value) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value) && Object.values(value).some(v => typeof v === 'string' && /^(changeProfileForCurrentSpace:|nextSpace:|previousSpace:|newSpace:)$/.test(v))) {
    selected.push(value);
  }
  for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child);
}
walk(result);
console.log(JSON.stringify({ output, collections: Object.fromEntries(Object.entries(result).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length])), selected }, null, 2));
