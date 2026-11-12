import { parseChromeBookmarks, parseBookmarksHTML, parseArcSidebar, previewBatch } from './index.mjs';
import { MigrationError, opaqueId, nonempty } from './common.mjs';

export const SNAPSHOT_LIMIT = 4 * 1024 * 1024;
const fail = code => { throw new MigrationError(code); };
export const sourceIdentity = sources => sources.map(s => ({ sourceId: s.sourceId, sha256: s.sha256 }));

/** Organizer-only picker boundary. No path or arbitrary parser options cross it. */
export function copySnapshots(sources) {
  if (!Array.isArray(sources) || sources.length < 1 || sources.length > 4) fail('SOURCE_COUNT_LIMIT');
  const seen = new Set();
  return sources.map(s => {
    if (!s || Object.keys(s).some(k => !['sourceId', 'name', 'text', 'sha256', 'bytes'].includes(k)) ||
        !nonempty(s.sourceId) || seen.has(s.sourceId) || typeof s.name !== 'string' ||
        typeof s.text !== 'string' || !/^[a-f0-9]{64}$/iu.test(s.sha256) ||
        !Number.isSafeInteger(s.bytes) || s.bytes < 0 || s.bytes > SNAPSHOT_LIMIT ||
        s.text.length > SNAPSHOT_LIMIT) fail('INVALID_SOURCE_SNAPSHOT');
    seen.add(s.sourceId);
    return { sourceId: s.sourceId, name: s.name, text: s.text, sha256: s.sha256, bytes: s.bytes };
  });
}

function targetsFor(plan, mappings, catalog) {
  if (!Array.isArray(mappings)) fail('PROFILE_MAPPING_REQUIRED');
  if (!catalog || !nonempty(catalog.revision) || !Array.isArray(catalog.profiles)) fail('TARGET_CATALOG_REQUIRED');
  const containers = [], normalized = [];
  for (const [position, p] of plan.profiles.entries()) {
    const m = mappings.find(m => m.sourceProfileId === p.sourceProfileId);
    if (!m || !Array.isArray(m.spaces)) fail('PROFILE_MAPPING_REQUIRED');
    const existing = catalog.profiles.find(t => t.profileId === m.targetProfileId);
    if (m.targetProfileId !== 'new' && (!existing || !nonempty(existing.revision))) fail('INVALID_PROFILE_TARGET');
    const profileRef = existing?.profileId ?? `new-profile:${p.sourceProfileId}`;
    containers.push({ kind: 'profile', ref: profileRef, operation: existing ? 'use' : 'create',
      sourceProfileId: p.sourceProfileId, name: p.name, position,
      ...(existing ? { expectedRevision: existing.revision } : {}) });
    const spaces = [];
    for (const [position, s] of p.spaces.entries()) {
      const sm = m.spaces.find(m => m.sourceSpaceId === s.sourceSpaceId);
      if (!sm) fail('SPACE_MAPPING_REQUIRED');
      const target = existing?.spaces?.find(t => t.spaceId === sm.targetSpaceId);
      if (sm.targetSpaceId !== 'new' && (!target || !nonempty(target.revision))) fail('INVALID_SPACE_TARGET');
      const ref = target?.spaceId ?? `new-space:${opaqueId(p.sourceProfileId, s.sourceSpaceId)}`;
      containers.push({ kind: 'space', ref, parentRef: profileRef, operation: target ? 'use' : 'create',
        sourceSpaceId: s.sourceSpaceId, name: s.name, position,
        ...(target ? { expectedRevision: target.revision } : {}) });
      spaces.push({ sourceSpaceId: s.sourceSpaceId, targetSpaceId: ref });
    }
    normalized.push({ sourceProfileId: p.sourceProfileId, targetProfileId: profileRef, spaces });
  }
  if (mappings.length !== normalized.length || new Set(mappings.map(m => m.sourceProfileId)).size !== mappings.length)
    fail('INVALID_PROFILE_MAPPING');
  return { containers, mappings: normalized };
}

/** Runs ONLY inside a terminable worker in the browser adapter. Reuses all M1 business. */
export async function runPreviewJob({ sources, selections = {}, catalog, ledgers = {}, history }, onParse = () => {}) {
  sources = copySnapshots(sources);
  if (history !== undefined && (!Array.isArray(history) || history.some(h =>
    !h || !nonempty(h.batchId) || !/^[a-f0-9]{64}$/iu.test(h.sha256)))) fail('INVALID_BATCH_HISTORY');
  const results = [];
  for (const snapshot of sources) {
    const bytes = new TextEncoder().encode(snapshot.text);
    if (bytes.byteLength !== snapshot.bytes || bytes.byteLength > SNAPSHOT_LIMIT) fail('SOURCE_BYTES_MISMATCH');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== snapshot.sha256.toLowerCase()) fail('SOURCE_DIGEST_MISMATCH');
    onParse();
    let plan;
    const options = { sourceProfileId: opaqueId('native-source-profile', snapshot.sourceId),
      name: '来源账号环境（登录未导入）', maxBytes: SNAPSHOT_LIMIT };
    if (/^\s*</u.test(snapshot.text)) plan = parseBookmarksHTML(snapshot.text, options);
    else {
      let data;
      try { data = JSON.parse(snapshot.text); } catch { fail('INVALID_JSON'); }
      if (data?.sidebar) plan = parseArcSidebar(data, options);
      else plan = parseChromeBookmarks(data, options);
    }
    const source = { sourceId: snapshot.sourceId, sha256: snapshot.sha256, bytes: snapshot.bytes,
      name: snapshot.name, format: plan.source };
    let batch = null, containers = [], mappingError = null;
    try {
      const targets = targetsFor(plan, selections[snapshot.sourceId], catalog);
      containers = targets.containers;
      batch = previewBatch(plan, { sourceNamespace: snapshot.sourceId, mappings: targets.mappings,
        ledger: ledgers[snapshot.sourceId] ?? [] });
    } catch (error) {
      if (!(error instanceof MigrationError)) throw error;
      mappingError = error.code;
    }
    const previousBatches = history?.filter(h => h.sha256.toLowerCase() === digest).map(h => h.batchId) ?? [];
    const duplicateSelection = sources.some(s => s.sourceId !== snapshot.sourceId && s.sha256.toLowerCase() === digest);
    results.push({ source, plan, containers, batch, mappingError, previousBatches, duplicateSelection,
      historyAvailable: history !== undefined });
  }
  // Different selected snapshots must not silently collapse distinct account environments.
  const used = new Map();
  for (const r of results) for (const c of r.containers.filter(c => c.kind === 'profile')) {
    if (used.has(c.ref)) {
      r.mappingError = 'PROFILE_MAPPING_COLLISION';
      used.get(c.ref).mappingError = 'PROFILE_MAPPING_COLLISION';
    }
    used.set(c.ref, r);
  }
  return { identity: sourceIdentity(sources), targetRevision: catalog?.revision, results };
}

/** Module-local review DTO, NOT a registered native command or successful import. */
export function commitIntent(preview) {
  if (!preview?.results?.length || !nonempty(preview.targetRevision) ||
      preview.results.some(r => !r.batch?.canCommit || r.mappingError || r.previousBatches.length || r.duplicateSelection)) fail('PREVIEW_NOT_READY');
  const batches = preview.results.map(r => ({ source: r.source, containers: r.containers,
    sourceNamespace: r.batch.sourceNamespace, items: r.batch.actions, ledgerProposal: r.batch.receipt }));
  return structuredClone({ proposal: 'migration.commit.v0', expectedTargetRevision: preview.targetRevision,
    batchId: opaqueId('native-migration-batch', preview.identity, batches), batches });
}

export function undoIntent(receipt) {
  if (!receipt || !nonempty(receipt.batchId) || !nonempty(receipt.targetRevision) ||
      !nonempty(receipt.undoToken)) fail('NATIVE_RECEIPT_REQUIRED');
  return { proposal: 'migration.undo.v0', batchId: receipt.batchId,
    expectedTargetRevision: receipt.targetRevision, undoToken: receipt.undoToken };
}