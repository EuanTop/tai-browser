import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { assertMigrationPlan } from '../../../contracts/v1/index.mjs';

export class MigrationError extends Error {
  constructor(code) { super(code); this.name = 'MigrationError'; this.code = code; }
}
// Keep M1's synchronous SHA-256 identities byte-for-byte across Node and browsers.
// Snapshot authentication uses platform Web Crypto in the worker.
export const opaqueId = (...parts) => bytesToHex(sha256(utf8ToBytes(JSON.stringify(parts))));
export const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
export const text = (value, fallback = '') => typeof value === 'string' ? value : fallback;
export const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export function context(options = {}) {
  let count = 0;
  const warnings = [];
  const maxItems = options.maxItems ?? 100_000;
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new MigrationError('INVALID_LIMIT');
  if (!Number.isSafeInteger(maxItems) || maxItems < 1) throw new MigrationError('INVALID_LIMIT');
  return {
    warnings,
    input(value) {
      if (typeof value === 'string' && utf8ToBytes(value).byteLength > maxBytes) throw new MigrationError('INPUT_LIMIT');
    },
    check(depth = 0) {
      if (options.signal?.aborted) throw new MigrationError('CANCELLED');
      if (depth > 64) throw new MigrationError('DEPTH_LIMIT');
      if (++count > maxItems) throw new MigrationError('ITEM_LIMIT');
    },
    warn(code, id) { warnings.push(id === undefined ? { code } : { code, sourceId: opaqueId('warning', id) }); },
  };
}
export function readJSON(input, ctx) {
  ctx.check(); ctx.input(input);
  if (typeof input !== 'string') {
    if (!record(input)) throw new MigrationError('INVALID_JSON');
    return input;
  }
  try { const value = JSON.parse(input); if (record(value)) return value; } catch { /* no source excerpt */ }
  throw new MigrationError('INVALID_JSON');
}
export function page(url, title, sourceId, ctx) {
  if (!nonempty(url)) { ctx.warn('MISSING_URL', sourceId); return null; }
  try {
    // Store only inert HTTP(S) navigation candidates. Native commit revalidates.
    if (!['http:', 'https:'].includes(new URL(url).protocol)) {
      ctx.warn('UNSUPPORTED_URL_SCHEME', sourceId); return null;
    }
  } catch { ctx.warn('INVALID_URL', sourceId); return null; }
  return { kind: 'page', sourceId, title: text(title), url };
}
export function finish(source, profiles, ctx) {
  ctx.check();
  return assertMigrationPlan({ version: 1, source, profiles, warnings: ctx.warnings });
}
export function sourceProfile(options) {
  if (!nonempty(options?.sourceProfileId)) throw new MigrationError('SOURCE_PROFILE_REQUIRED');
  return { sourceProfileId: options.sourceProfileId, name: text(options.name, 'Imported profile'), favorites: [], spaces: [] };
}
