import { pairsToMap, parseSpaceContainers, profileKeyOf, cleanTitle, extractUrl } from '../third-party/arcaeologist/helpers.mjs';
import { context, readJSON, MigrationError, record, text, opaqueId, page, finish } from './common.mjs';

/** Canonical alternating-pair Arc sidebar snapshot; no filesystem access. */
export function parseArcSidebar(input, options = {}) {
  const ctx = context(options), data = readJSON(input, ctx);
  if (data.version !== undefined && data.version !== 1) ctx.warn('UNVERIFIED_ARC_VERSION');
  if (data.version === undefined) ctx.warn('UNVERSIONED_ARC_SNAPSHOT');
  const containers = data.sidebar?.containers;
  if (!Array.isArray(containers)) throw new MigrationError('INVALID_ARC_SCHEMA');
  const candidates = containers.filter(c => record(c) && Array.isArray(c.items) && Array.isArray(c.spaces));
  if (!candidates.length) throw new MigrationError('INVALID_ARC_SCHEMA');
  if (candidates.length > 1) throw new MigrationError('AMBIGUOUS_ARC_CONTAINERS');
  const main = candidates[0], items = pairsToMap(main.items, ctx.warn, 'items', ctx.check), spaces = pairsToMap(main.spaces, ctx.warn, 'spaces', ctx.check);
  const profiles = new Map(), seenByProfile = new Map(), touched = new Set(), claimed = new Set(), parentIndex = new Map();
  for (const item of items.values()) {
    ctx.check();
    for (const id of Array.isArray(item.childrenIds) ? item.childrenIds : []) { ctx.check(); claimed.add(id); }
  }
  for (const [id, item] of items) {
    ctx.check();
    if (typeof item.parentID !== 'string' || claimed.has(id)) continue;
    if (!parentIndex.has(item.parentID)) parentIndex.set(item.parentID, []);
    parentIndex.get(item.parentID).push(id);
  }
  function getProfile(tag, fallback) {
    const known = profileKeyOf(tag), key = known ?? `unresolved:${fallback}`;
    if (!known) ctx.warn('UNRESOLVED_PROFILE', fallback);
    if (!profiles.has(key)) {
      const sourceProfileId = opaqueId('arc-profile', key);
      profiles.set(key, { sourceProfileId, name: known === 'default' ? 'Default' : text(tag?.custom?._0?.directoryBasename, 'Unresolved profile'), favorites: [], spaces: [] });
      seenByProfile.set(key, new Set());
    }
    return { profile: profiles.get(key), seen: seenByProfile.get(key) };
  }
  function childrenOf(id, root = false) {
    const item = items.get(id); touched.add(id);
    if (Array.isArray(item?.childrenIds)) return item.childrenIds;
    if (!root) return [];
    // Arcmark's documented fallback: absent root container, use parentID,
    // excluding children already claimed by a folder's canonical childrenIds.
    const ids = parentIndex.get(id) ?? [];
    ctx.warn(ids.length ? 'PARENT_ID_FALLBACK_ORDER' : 'MISSING_CONTAINER', id);
    return ids;
  }
  function walk(id, seen, ancestors, depth = 0) {
    ctx.check(depth);
    if (typeof id !== 'string') { ctx.warn('MALFORMED_REFERENCE'); return null; }
    if (ancestors.has(id)) { ctx.warn('CYCLE', id); return null; }
    if (seen.has(id)) { ctx.warn('DUPLICATE_REFERENCE', id); return null; }
    const item = items.get(id); touched.add(id);
    if (!item) { ctx.warn('MISSING_REFERENCE', id); return null; }
    seen.add(id);
    const sourceId = opaqueId('arc-item', id), url = extractUrl(item);
    const hasChildren = Array.isArray(item.childrenIds) && item.childrenIds.length > 0;
    if (item.childrenIds !== undefined && item.childrenIds !== null && !Array.isArray(item.childrenIds)) ctx.warn('MALFORMED_CHILDREN', id);
    if (item.data && Object.keys(item.data).some(key => key !== 'tab' && key !== 'folder')) ctx.warn('UNSUPPORTED_ARC_ITEM_DATA', id);
    if (item.data?.tab && !hasChildren) return page(url, cleanTitle(item), sourceId, ctx);
    if (url && hasChildren) ctx.warn('MULTIPAGE_ITEM_RELATION_UNSUPPORTED', id);
    if (!Array.isArray(item.childrenIds) && !item.data?.folder) { ctx.warn('UNSUPPORTED_ITEM', id); return null; }
    if (depth === 64) throw new MigrationError('DEPTH_LIMIT');
    ancestors.add(id);
    const children = childrenOf(id).map(child => walk(child, seen, ancestors, depth + 1)).filter(Boolean);
    ancestors.delete(id);
    if (url) {
      // A page with children cannot be expressed by v1; keep its URL as an
      // explicit child plus all recoverable descendants, with a warning above.
      const own = page(url, cleanTitle(item), opaqueId('arc-multipage-url', id), ctx);
      if (own) children.unshift(own);
    }
    return { kind: 'folder', sourceId, title: cleanTitle(item), children };
  }
  function roots(ids, seen) {
    return ids.flatMap(id => childrenOf(id, true).map(child => walk(child, seen, new Set([id]))).filter(Boolean));
  }
  const top = main.topAppsContainerIDs;
  if (top !== undefined && !Array.isArray(top)) ctx.warn('MALFORMED_FAVORITES');
  if (Array.isArray(top)) {
    if (top.length % 2) ctx.warn('ODD_PAIR_ARRAY', 'favorites');
    for (let i = 0; i < top.length - 1; i += 2) {
      ctx.check();
      const tag = top[i], id = top[i + 1];
      if (!record(tag) || typeof id !== 'string') { ctx.warn('MALFORMED_FAVORITES'); continue; }
      const { profile, seen } = getProfile(tag, `favorites:${i}`);
      profile.favorites.push(...roots([id], seen));
    }
  }
  for (const [id, space] of spaces) {
    ctx.check();
    const { profile, seen } = getProfile(space.profile, `space:${id}`), ids = parseSpaceContainers(space);
    if (!Array.isArray(space.containerIDs)) ctx.warn('MISSING_SPACE_CONTAINERS', id);
    const saved = roots(ids.pinned, seen), open = roots(ids.unpinned, seen), temporary = [];
    function flatten(nodes) {
      for (const item of nodes) {
        if (item.kind === 'page') temporary.push(item);
        else { ctx.warn('TEMPORARY_FOLDER_FLATTENED', item.sourceId); flatten(item.children); }
      }
    }
    flatten(open);
    const result = { sourceSpaceId: opaqueId('arc-space', id), name: text(space.title, 'Untitled space'), saved, temporary };
    if (space.customInfo || space.color !== undefined) ctx.warn('SPACE_APPEARANCE_UNSUPPORTED', id);
    profile.spaces.push(result);
  }
  for (const id of items.keys()) if (!touched.has(id)) ctx.warn('UNREFERENCED_ITEM', id);
  if (options.archive !== undefined) ctx.warn('ARCHIVE_NOT_IMPORTED');
  ctx.warn('SIDEBAR_NOT_COMPLETE_SESSION');
  return finish('arc', [...profiles.values()], ctx);
}
