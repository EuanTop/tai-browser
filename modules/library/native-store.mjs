import { assertScope } from '../../contracts/v1/index.mjs';

export class NativeLibraryError extends Error {
  constructor(code, detail) { super(code); this.name = 'NativeLibraryError'; this.code = code; this.detail = detail; }
}
const fail = code => { throw new NativeLibraryError(code); };
const bytes = text => new TextEncoder().encode(text).length;
function resource(value, prefix = false) {
  if (prefix && value === '') return;
  if (typeof value !== 'string' || !value || /[\\%:\u0000-\u001f\u007f]/u.test(value) ||
      value.startsWith('/') || value.split('/').some(part => !part || part === '.' || part === '..') ||
      value.split('/').length > 16 || bytes(value) > 512) fail('INVALID_RESOURCE');
}

/** Trusted selector/connection metadata only; no libraryId or scope from tool payloads. */
export function createNativeLibraryStore({ libraryId, binding, libraries, commands, execute, hostCommand }) {
  assertScope(binding);
  if (Object.keys(binding).some(key => !['profileId','spaceId','taskId'].includes(key))) fail('SCOPE_MISMATCH');
  if (typeof libraryId !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(libraryId) ||
      !Array.isArray(libraries) || !libraries.some(item => (typeof item === 'string' ? item : item?.id) === libraryId)) fail('LIBRARY_NOT_GRANTED');
  if ((typeof execute === 'function') === (typeof hostCommand === 'function')) fail('INVALID_TRANSPORT');
  const scope = Object.freeze(structuredClone(binding)), granted = new Set(commands || []);
  let revoked = false, generation = 0;
  function assertActive() { if (revoked) fail('LIBRARY_REVOKED'); }
  function nativeFailure(error) {
    const code = error.code || error.message;
    if (['LIBRARY_REVOKED','LIBRARY_NOT_FOUND','LIBRARY_DENIED','LEASE_REVOKED','PROFILE_MISMATCH','SCOPE_MISMATCH','SPACE_NOT_FOUND','CAPABILITY_DENIED'].includes(code)) {
      revoked = true; generation++;
    }
    throw error;
  }
  async function call(command, payload) {
    assertActive();
    if (!granted.has(command)) fail('CAPABILITY_UNAVAILABLE');
    const current = generation;
    let value;
    if (execute) {
      const id = globalThis.crypto.randomUUID();
      const result = await execute({ protocol:'tai.v1', id, command, scope:{...scope}, payload:{libraryId,...payload} });
      if (!result || result.id !== id || typeof result.ok !== 'boolean' ||
          (result.ok ? !Object.hasOwn(result,'value') || Object.hasOwn(result,'error') :
            Object.hasOwn(result,'value') || typeof result.error?.code !== 'string')) fail('INVALID_RESPONSE');
      if (!result.ok) nativeFailure(new NativeLibraryError(result.error.code, structuredClone(result.error)));
      value = result.value;
    } else {
      try { value = await hostCommand({...scope}, command, {libraryId,...payload}); }
      catch (error) { nativeFailure(new NativeLibraryError(error.code || error.message || 'HOST_FAILURE')); }
    }
    if (current !== generation) fail('OPERATION_OBSOLETE');
    assertActive();
    return value;
  }
  return Object.freeze({
    libraryId, binding:scope, writable:granted.has('library.putIfAbsent'), assertActive,
    async read(resourceId) {
      resource(resourceId); const value = await call('library.read',{resourceId});
      if (typeof value !== 'string' || bytes(value) > 4 * 1024 * 1024) fail('INVALID_RESPONSE');
      return value;
    },
    async list(prefix = '') {
      resource(prefix,true); const value = await call('library.list',{prefix});
      if (!Array.isArray(value) || value.some(key => typeof key !== 'string')) fail('INVALID_RESPONSE');
      for (const key of value) {
        resource(key);
        if (prefix && !key.startsWith(prefix + '/')) fail('INVALID_RESPONSE');
      }
      return [...value];
    },
    async putIfAbsent(resourceId,text) {
      resource(resourceId);
      if (typeof text !== 'string' || bytes(text) > 4 * 1024 * 1024) fail('QUOTA_EXCEEDED');
      if (await call('library.putIfAbsent',{resourceId,text}) !== true) fail('INVALID_RESPONSE');
    },
    revoke() { revoked = true; generation++; },
  });
}
