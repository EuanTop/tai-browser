import { assertMigrationPlan } from '../../../contracts/v1/index.mjs';
import { context, MigrationError, nonempty, opaqueId } from './common.mjs';

/** Pure preview. Receipt is persisted only AFTER native atomic commit succeeds.
 * Mapping: [{sourceProfileId,targetProfileId,spaces:[{sourceSpaceId,targetSpaceId}]}]
 * Ledger: [{key,revision}] from prior successful commits in the same sourceNamespace.
 */
export function previewBatch(plan, { sourceNamespace, mappings, ledger = [], signal, maxItems } = {}) {
  assertMigrationPlan(plan);
  if (!nonempty(sourceNamespace) || !Array.isArray(mappings) || !Array.isArray(ledger)) throw new MigrationError('INVALID_BATCH_OPTIONS');
  const ctx = context({ signal, maxItems }), map = new Map(), targetOwners = new Set();
  for (const mapping of mappings) {
    if (!mapping || !nonempty(mapping.sourceProfileId) || !nonempty(mapping.targetProfileId) || map.has(mapping.sourceProfileId) || !Array.isArray(mapping.spaces)) throw new MigrationError('INVALID_PROFILE_MAPPING');
    if (targetOwners.has(mapping.targetProfileId)) throw new MigrationError('PROFILE_MAPPING_COLLISION');
    targetOwners.add(mapping.targetProfileId); map.set(mapping.sourceProfileId, mapping);
  }
  const previous = new Map();
  for (const entry of ledger) {
    if (!entry || !nonempty(entry.key) || !nonempty(entry.revision) || previous.has(entry.key)) throw new MigrationError('INVALID_LEDGER');
    previous.set(entry.key, entry.revision);
  }
  const actions = [], receipt = [], counts = { create: 0, skipped: 0, conflicts: 0 };
  for (const profile of plan.profiles) {
    ctx.check();
    const mapping = map.get(profile.sourceProfileId);
    if (!mapping) throw new MigrationError('PROFILE_MAPPING_REQUIRED');
    const spaces = new Map(), targets = new Set();
    for (const space of mapping.spaces) {
      if (!space || !nonempty(space.sourceSpaceId) || !nonempty(space.targetSpaceId) || spaces.has(space.sourceSpaceId) || targets.has(space.targetSpaceId)) throw new MigrationError('INVALID_SPACE_MAPPING');
      spaces.set(space.sourceSpaceId, space.targetSpaceId); targets.add(space.targetSpaceId);
    }
    function visit(items, area, targetSpaceId, parentKey = null) {
      for (const [position, item] of items.entries()) {
        ctx.check();
        // Target IDs deliberately do not enter identity: remapping a previously
        // committed source is a conflict, never a silent duplicate import.
        const key = opaqueId('migration-item', sourceNamespace, plan.source, profile.sourceProfileId, item.sourceId);
        const destination = { targetProfileId: mapping.targetProfileId, area, ...(targetSpaceId ? { targetSpaceId } : {}) };
        const value = { kind: item.kind, title: item.title, ...(item.kind === 'page' ? { url: item.url } : {}) };
        const revision = opaqueId('migration-revision', value, destination, parentKey, position);
        const prior = previous.get(key);
        const status = prior === undefined ? 'create' : prior === revision ? 'skipped' : 'conflict';
        if (status === 'conflict') counts.conflicts++; else counts[status]++;
        actions.push({ key, revision, status, parentKey, position, destination, value, sourceId: item.sourceId });
        receipt.push({ key, revision });
        if (item.kind === 'folder') visit(item.children, area, targetSpaceId, key);
      }
    }
    visit(profile.favorites, 'favorites');
    for (const space of profile.spaces) {
      const targetSpaceId = spaces.get(space.sourceSpaceId);
      if (!targetSpaceId) throw new MigrationError('SPACE_MAPPING_REQUIRED');
      visit(space.saved, 'saved', targetSpaceId); visit(space.temporary, 'temporary', targetSpaceId);
    }
  }
  return { version: 1, sourceNamespace, counts, actions, receipt, canCommit: counts.conflicts === 0, warnings: structuredClone(plan.warnings) };
}

/** Native host supplies actual object IDs and post-commit revisions.
 * Edited objects are conflicts; missing objects are already absent.
 */
export function previewUndo(commitReceipt, currentObjects) {
  if (!Array.isArray(commitReceipt) || !Array.isArray(currentObjects)) throw new MigrationError('INVALID_UNDO_INPUT');
  const current = new Map(), seen = new Set();
  for (const object of currentObjects) {
    if (!object || !nonempty(object.objectId) || !nonempty(object.revision) || current.has(object.objectId)) throw new MigrationError('INVALID_UNDO_INPUT');
    current.set(object.objectId, object);
  }
  const actions = commitReceipt.map(entry => {
    if (!entry || !nonempty(entry.objectId) || !nonempty(entry.revision) || seen.has(entry.objectId)) throw new MigrationError('INVALID_UNDO_INPUT');
    seen.add(entry.objectId);
    const actual = current.get(entry.objectId);
    return { objectId: entry.objectId, status: !actual ? 'missing' : actual.revision === entry.revision ? 'remove' : 'conflict' };
  }).reverse();
  return { actions, canUndo: !actions.some(action => action.status === 'conflict') };
}
