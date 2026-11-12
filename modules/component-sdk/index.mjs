import { assertModuleManifest } from '../../contracts/v1/index.mjs';

/** host is already scoped to this component by the native broker. No generic invoke. */
export function createComponentSDK(manifest, host) {
  const validated = structuredClone(assertModuleManifest(manifest));
  const capabilities = new Set(validated.capabilities);
  function requireCapability(capability) {
    if (!capabilities.has(capability)) throw new Error('Undeclared capability: ' + capability);
  }
  function storageKey(key) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9._-]{1,100}$/.test(key)) throw new TypeError('Invalid component storage key');
    return key;
  }
  function available(operation) {
    if (typeof operation !== 'function') {
      const error = new Error('CAPABILITY_UNAVAILABLE'); error.code = 'CAPABILITY_UNAVAILABLE'; throw error;
    }
    return operation;
  }
  return Object.freeze({
    apiVersion: 1, componentId:validated.id,
    storage: Object.freeze({
      async get(key) { requireCapability('storage'); return structuredClone(await host.storage.get(storageKey(key))); },
      async set(key,value) { requireCapability('storage'); await host.storage.set(storageKey(key), structuredClone(value)); },
    }),
    async notify(message) {
      requireCapability('notifications');
      if (typeof message !== 'string' || message.length > 500) throw new TypeError('Invalid notification');
      return available(host.notify).call(host,message);
    },
    clips: Object.freeze({
      async search(query) { requireCapability('clips.read'); return available(host.clips?.search).call(host.clips,String(query)); },
      async read(id) { requireCapability('clips.read'); return available(host.clips?.read).call(host.clips,id); },
      async capture() { requireCapability('clips.capture'); return available(host.clips?.capture).call(host.clips); },
    }),
  });
}
