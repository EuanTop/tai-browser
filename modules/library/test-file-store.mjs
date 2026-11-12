// Synthetic integration tests only. Production uses a native, scoped resource handle.
import { constants } from 'node:fs';
import { mkdir, open, readdir, realpath, lstat, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { isRelativeResource } from '../../contracts/v1/index.mjs';

export async function createTestFileStore({ testRoot, synthetic = false } = {}) {
  if (!synthetic || typeof testRoot !== 'string' || resolve(testRoot) !== testRoot)
    throw new TypeError('Explicit absolute synthetic testRoot required');
  if ((await lstat(testRoot)).isSymbolicLink() || await realpath(testRoot) !== testRoot)
    throw new TypeError('Test root must be a real directory');
  async function pathFor(key, create = false) {
    if (!isRelativeResource(key)) throw new TypeError('Invalid resource ID');
    const parts = key.split('/');
    let current = testRoot;
    for (const part of parts.slice(0, -1)) {
      current = join(current, part);
      if (create) await mkdir(current, { recursive: true });
      if (!(await lstat(current)).isDirectory() || (await lstat(current)).isSymbolicLink()) throw new Error('Non-directory resource');
    }
    return join(testRoot, ...parts);
  }
  return {
    async putIfAbsent(key, text) {
      const path = await pathFor(key, true);
      const temporary = path + '.' + randomUUID() + '.pending';
      try {
        const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await file.writeFile(text, 'utf8'); await file.sync(); } finally { await file.close(); }
        await link(temporary, path); // Atomic publication; no partly written commit record.
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        // A partial write must not masquerade as a successful duplicate.
        if (await this.read(key) !== text) throw new Error('Existing resource differs');
      } finally { await unlink(temporary).catch(() => {}); }
    },
    async read(key) {
      const file = await open(await pathFor(key), constants.O_RDONLY | constants.O_NOFOLLOW);
      try { return await file.readFile('utf8'); } finally { await file.close(); }
    },
    async list(prefix) {
      if (!isRelativeResource(prefix)) throw new TypeError('Invalid resource prefix');
      const result = [];
      async function walk(key) {
        let entries;
        try { entries = await readdir(dirname(await pathFor(key + '/placeholder')), { withFileTypes: true }); }
        catch (error) { if (error.code === 'ENOENT') return; throw error; }
        for (const entry of entries) {
          const child = key + '/' + entry.name;
          if (entry.isDirectory()) await walk(child);
          else if (entry.isFile()) result.push(child);
        }
      }
      await walk(prefix); return result.sort();
    },
  };
}
