import { Parser } from 'htmlparser2';
import { context, readJSON, MigrationError, record, text, nonempty, opaqueId, page, finish, sourceProfile } from './common.mjs';

/** Input is a caller-supplied read-only snapshot, never a Profile path. */
export function parseChromeBookmarks(input, options = {}) {
  const ctx = context(options), data = readJSON(input, ctx), profile = sourceProfile(options);
  if (data.version !== 1) throw new MigrationError('UNSUPPORTED_CHROME_VERSION');
  if (!record(data.roots)) throw new MigrationError('INVALID_CHROME_ROOTS');
  const seen = new Set(), ancestors = new Set();
  function walk(node, path, depth = 0) {
    ctx.check(depth);
    if (!record(node)) { ctx.warn('MALFORMED_ITEM', path); return null; }
    if (ancestors.has(node)) { ctx.warn('CYCLE', path); return null; }
    const identity = nonempty(node.guid) ? ['guid', node.guid] : nonempty(node.id) ? ['id', node.id] : ['path', path];
    const sourceId = opaqueId('chrome', ...identity);
    if (seen.has(sourceId)) { ctx.warn('DUPLICATE_SOURCE_ID', sourceId); return null; }
    seen.add(sourceId);
    if (node.type === 'url') return page(node.url, node.name, sourceId, ctx);
    if (node.type !== 'folder' || !Array.isArray(node.children)) { ctx.warn('UNSUPPORTED_ITEM', sourceId); return null; }
    ancestors.add(node);
    if (depth === 64) throw new MigrationError('DEPTH_LIMIT');
    const children = node.children.map((child, i) => walk(child, `${path}/${i}`, depth + 1)).filter(Boolean);
    ancestors.delete(node);
    return { kind: 'folder', sourceId, title: text(node.name), children };
  }
  const saved = [];
  for (const [key, root] of Object.entries(data.roots)) {
    if (!record(root) || !['folder', 'url'].includes(root.type)) { ctx.warn('UNSUPPORTED_ROOT', key); continue; }
    const item = walk(root, key); if (item) saved.push(item);
  }
  profile.spaces.push({ sourceSpaceId: 'bookmarks', name: 'Imported bookmarks', saved, temporary: [] });
  return finish('chrome', [profile], ctx);
}

/** Netscape bookmark HTML with entity decoding and tolerant tokenization upstream. */
export function parseBookmarksHTML(input, options = {}) {
  const ctx = context(options), profile = sourceProfile(options);
  ctx.input(input);
  if (typeof input !== 'string' || !/<dl(?:\s|>)/iu.test(input)) throw new MigrationError('INVALID_BOOKMARKS_HTML');
  const saved = [], stack = [{ children: saved, path: 'root' }];
  let capture = null, pendingFolder = null, dlDepth = 0, sawRoot = false;
  const nextId = () => opaqueId('bookmarks-html', stack.at(-1).path, stack.at(-1).children.length);
  const parser = new Parser({
    onopentag(tag, attrs) {
      ctx.check();
      if (tag === 'dl') {
        if (++dlDepth > 65) throw new MigrationError('DEPTH_LIMIT');
        if (!sawRoot) { sawRoot = true; return; }
        if (pendingFolder) { stack.push({ children: pendingFolder.children, path: pendingFolder.sourceId }); pendingFolder = null; }
        else { stack.push(stack.at(-1)); ctx.warn('UNATTACHED_HTML_LIST'); }
      } else if (tag === 'h3') capture = { kind: 'folder', title: '', sourceId: nextId(), children: [] };
      else if (tag === 'a') capture = { kind: 'page', title: '', sourceId: nextId(), url: attrs.href };
    },
    ontext(value) { if (capture) capture.title += value; },
    onclosetag(tag) {
      if ((tag === 'h3' && capture?.kind === 'folder') || (tag === 'a' && capture?.kind === 'page')) {
        const item = capture; capture = null;
        if (item.kind === 'folder') { stack.at(-1).children.push(item); pendingFolder = item; }
        else { pendingFolder = null; const valid = page(item.url, item.title, item.sourceId, ctx); if (valid) stack.at(-1).children.push(valid); }
      } else if (tag === 'dl') { dlDepth--; if (stack.length > 1) stack.pop(); pendingFolder = null; }
    },
  }, { decodeEntities: true });
  ctx.check(); parser.end(input);
  profile.spaces.push({ sourceSpaceId: 'bookmarks', name: 'Imported bookmarks', saved, temporary: [] });
  return finish('bookmarks-html', [profile], ctx);
}
