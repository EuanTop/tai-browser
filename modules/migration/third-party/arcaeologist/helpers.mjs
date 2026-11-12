// Adapted from plainspace/arcaeologist src/parser.js at
// e0988674716e2f5b54c583fbe0bfd5d4caf0a1c3. MIT, Jared Volpe (2026).
// Local changes: structured diagnostic codes, duplicate/odd-pair detection,
// stable unknown-profile handling in caller, and named ESM exports.
export function pairsToMap(arr, warn, label, check = () => {}) {
  const map = new Map();
  if (!Array.isArray(arr)) { warn('MALFORMED_PAIRS', label); return map; }
  if (arr.length % 2) warn('ODD_PAIR_ARRAY', label);
  for (let i = 0; i < arr.length - 1; i += 2) {
    check();
    const key = arr[i], val = arr[i + 1];
    if (typeof key !== 'string' || !key || !val || typeof val !== 'object' || Array.isArray(val)) {
      warn('MALFORMED_PAIR', `${label}:${i}`); continue;
    }
    if (map.has(key)) { warn('DUPLICATE_SOURCE_ID', key); continue; }
    map.set(key, val);
  }
  return map;
}
export function parseSpaceContainers(space) {
  const out = { pinned: [], unpinned: [] }, ids = space.containerIDs;
  if (!Array.isArray(ids)) return out;
  for (let i = 0; i < ids.length - 1; i++) {
    const a = ids[i], b = ids[i + 1];
    let label = null;
    if (a === 'pinned' || a === 'unpinned') label = a;
    else if (a && typeof a === 'object') {
      if ('pinned' in a) label = 'pinned';
      else if ('unpinned' in a) label = 'unpinned';
    }
    if (label && typeof b === 'string') { out[label].push(b); i++; }
  }
  return out;
}
export function profileKeyOf(tag) {
  if (!tag || typeof tag !== 'object') return null;
  if (tag.default === true) return 'default';
  if (tag.custom && tag.custom._0) {
    const c = tag.custom._0;
    if (typeof c.machineID === 'string' && typeof c.directoryBasename === 'string')
      return `custom:${JSON.stringify([c.machineID, c.directoryBasename])}`;
  }
  return null;
}
export function cleanTitle(item) {
  return (typeof item.title === 'string' && item.title) ||
    (item.data && item.data.tab && typeof item.data.tab.savedTitle === 'string' && item.data.tab.savedTitle) || '';
}
export function extractUrl(item) {
  return item && item.data && item.data.tab && typeof item.data.tab.savedURL === 'string' ? item.data.tab.savedURL : null;
}
