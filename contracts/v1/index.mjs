/** TAi v1 boundary values. Native hosts must independently enforce capabilities. */
export const PROTOCOL = 'tai.v1';
export const COMMANDS = Object.freeze([
  'page.list', 'page.open', 'page.read', 'page.act', 'page.screenshot', 'page.status',
  'library.read', 'library.list', 'library.putIfAbsent', 'clips.capture', 'clips.search', 'clips.read',
  'modules.preview', 'modules.apply', 'modules.rollback',
  'migration.preview', 'migration.commit', 'settings.describe', 'settings.patch',
]);
export const EVENTS = Object.freeze([
  'clip.saved', 'destination.succeeded', 'module.applied', 'task.updated',
]);
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const fail = message => { throw new TypeError(message); };
export function assertScope(scope) {
  if (!record(scope) || !nonempty(scope.profileId) || !nonempty(scope.spaceId))
    fail('A scope requires profileId and spaceId');
  for (const key of ['taskId', 'pageId'])
    if (scope[key] !== undefined && !nonempty(scope[key])) fail('Invalid scope ' + key);
  if (scope.pageRevision !== undefined &&
      (!Number.isSafeInteger(scope.pageRevision) || scope.pageRevision < 0))
    fail('Invalid pageRevision');
  return scope;
}
export function assertRequest(request) {
  if (!record(request) || request.protocol !== PROTOCOL || !nonempty(request.id) ||
      !COMMANDS.includes(request.command) || !record(request.payload))
    fail('Invalid TAi request');
  assertScope(request.scope);
  return request;
}
/** Correlation check for adapters; not a replacement for native authorization. */
export function scopeMatches(scope, binding) {
  assertScope(scope); assertScope(binding);
  return scope.profileId === binding.profileId && scope.spaceId === binding.spaceId &&
    (binding.taskId === undefined || scope.taskId === binding.taskId) &&
    (scope.pageId === undefined || scope.pageId === binding.pageId) &&
    (scope.pageRevision === undefined || scope.pageRevision === binding.pageRevision);
}
export function isRelativeResource(path) {
  return nonempty(path) && !/[\\\u0000-\u001f:]/u.test(path) &&
    !path.startsWith('/') && !path.split('/').some(p => !p || p === '.' || p === '..') &&
    !/%(?:2f|5c|2e|00)/iu.test(path);
}
export function assertModuleManifest(manifest) {
  if (!record(manifest) || manifest.apiVersion !== 1 ||
      !/^[a-z][a-z0-9-]*\.[a-z][a-z0-9.-]*$/u.test(manifest.id) ||
      !/^\d+\.\d+\.\d+$/u.test(manifest.version) || !nonempty(manifest.title) ||
      !isRelativeResource(manifest.entry) || !Array.isArray(manifest.surfaces) ||
      !manifest.surfaces.length || manifest.surfaces.some(s => !['sidebar','panel','newtab'].includes(s)) ||
      !Array.isArray(manifest.capabilities) || manifest.capabilities.some(c =>
        !['storage','notifications','clips.read','clips.capture'].includes(c)))
    fail('Invalid or unsupported TAi module manifest');
  return manifest;
}
export function assertMigrationPlan(plan) {
  if (!record(plan) || plan.version !== 1 || !nonempty(plan.source) ||
      !['chrome','arc','bookmarks-html'].includes(plan.source) ||
      !Array.isArray(plan.profiles) || !Array.isArray(plan.warnings))
    fail('Invalid migration plan');
  const profiles = new Set();
  const walk = (items, seen, depth = 0) => {
    if (!Array.isArray(items) || depth > 64) fail('Invalid import tree');
    for (const item of items) {
      if (!record(item) || !nonempty(item.sourceId) || seen.has(item.sourceId) ||
          typeof item.title !== 'string') fail('Invalid or duplicate source item');
      seen.add(item.sourceId);
      if (item.kind === 'folder') walk(item.children, seen, depth + 1);
      else if (item.kind !== 'page' || !nonempty(item.url)) fail('Invalid import item');
    }
  };
  for (const profile of plan.profiles) {
    if (!record(profile) || !nonempty(profile.sourceProfileId) ||
        profiles.has(profile.sourceProfileId) || typeof profile.name !== 'string' ||
        !Array.isArray(profile.spaces)) fail('Invalid source profile');
    profiles.add(profile.sourceProfileId);
    const seen = new Set(); walk(profile.favorites, seen);
    const spaces = new Set();
    for (const space of profile.spaces) {
      if (!record(space) || !nonempty(space.sourceSpaceId) || spaces.has(space.sourceSpaceId) ||
          typeof space.name !== 'string') fail('Invalid source space');
      spaces.add(space.sourceSpaceId);
      walk(space.saved, seen); walk(space.temporary, seen);
      if (space.temporary.some(item => item.kind !== 'page')) fail('Temporary items must be pages');
    }
  }
  for (const warning of plan.warnings)
    if (!record(warning) || !nonempty(warning.code)) fail('Invalid import warning');
  return plan;
}
