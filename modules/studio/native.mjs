import { assertScope } from '../../contracts/v1/index.mjs';
import { ModuleStudio } from './index.mjs';
import { prepareNativePackage, validateNativePayload } from './package.mjs';
import { mountVersionPanel } from './view.mjs';

const revoked = () => { throw new Error('SURFACE_REVOKED'); };
/** Organizer's real surface host owns readiness and atomic apply; no renderer fallback. */
export function createNativeSurfaceAdapter({container,binding,createSurfaceHost,hostCommand,compilePackage = prepareNativePackage}) {
  assertScope(binding);
  if (Object.keys(binding).some(key => !['profileId','spaceId'].includes(key)) ||
      typeof createSurfaceHost !== 'function' || typeof hostCommand !== 'function') throw new TypeError('Native surface dependencies required');
  const scope = Object.freeze(structuredClone(binding));
  const surface = createSurfaceHost(container,{...scope});
  for (const action of ['preview','apply','cancel','dispose']) if (typeof surface?.[action] !== 'function') throw new TypeError('Invalid native surface host');
  const records = new Map(); let current, pending, closed = false, generation = 0;
  const get = handle => { const record = records.get(handle); if (closed || !record) revoked(); return record; };
  async function cancel() {
    generation++;
    if (pending) records.delete(pending);
    pending = undefined;
    await surface.cancel();
  }
  return Object.freeze({
    async preview(pkg, trustedScope) {
      if (closed) revoked();
      if (Object.keys(trustedScope).length !== 2 || trustedScope.profileId !== scope.profileId || trustedScope.spaceId !== scope.spaceId) throw new Error('SCOPE_MISMATCH');
      const revision = ++generation, payload = validateNativePayload(await compilePackage(pkg));
      if (payload.kind !== 'custom' || payload.manifest.id !== pkg.manifest.id || payload.manifest.version !== pkg.manifest.version) throw new Error('INVALID_COMPILED_PACKAGE');
      if (closed || revision !== generation) revoked();
      const session = await surface.preview(payload);
      if (closed || revision !== generation) { await session.dispose(); revoked(); }
      if (!session?.frame?.isConnected || typeof session.dispose !== 'function' ||
          session.grant?.spaceId !== scope.spaceId || session.grant?.componentId !== pkg.manifest.id || typeof session.grant?.handle !== 'string') {
        await session?.dispose?.(); await cancel(); throw new Error('INVALID_NATIVE_SURFACE');
      }
      if (pending) records.delete(pending);
      const handle = Object.freeze({}); records.set(handle,session); pending = handle;
      return handle;
    },
    async activate(handle, previous) {
      const session = get(handle);
      const revision = generation;
      try {
        if (handle !== pending || (current && previous !== current) || !session.frame.isConnected) revoked();
        await surface.apply(session);
        if (closed || revision !== generation) revoked();
      } catch (error) {
        await cancel();
        const failure = new Error(error.message,{cause:error}); failure.previewRevoked = true; throw failure;
      }
      if (current) records.delete(current);
      current = handle; pending = undefined;
    },
    async disable(handle) {
      const session = get(handle);
      await cancel(); await session.dispose(); records.delete(handle); current = undefined;
    },
    async dispose(handle) {
      if (!records.has(handle)) return;
      if (handle === pending) { await cancel(); return; }
      const session = get(handle); records.delete(handle);
      if (current === handle) current = undefined;
      await session.dispose();
    },
    cancel,
    async close() {
      if (closed) return;
      closed = true; generation++;
      const sessions = [...records.values()]; records.clear(); current = pending = undefined;
      // Immediate native revocation also invalidates SDK calls from any old handle.
      await Promise.allSettled(sessions.map(session => hostCommand({...scope},'modules.dispose',{handle:session.grant.handle})));
      await surface.dispose();
    },
  });
}

export function createNativeStudio(options) {
  const host = createNativeSurfaceAdapter(options);
  const studio = new ModuleStudio({host,scope:options.binding,emit:options.emit});
  let panel;
  return Object.freeze({studio,
    mount(root) { panel?.close(); panel = mountVersionPanel(root,{studio}); return panel; },
    async dispose() { panel?.close(); try { await host.close(); } finally { await studio.dispose(); } },
  });
}
