import { assertModuleManifest, assertScope, isRelativeResource } from '../../contracts/v1/index.mjs';

export function validatePackage(input) {
  const pkg = structuredClone(input);
  assertModuleManifest(pkg.manifest);
  if (!pkg.files || typeof pkg.files !== 'object' || Array.isArray(pkg.files) ||
      Object.keys(pkg.files).length > 128 || !Object.hasOwn(pkg.files,pkg.manifest.entry) ||
      Object.entries(pkg.files).some(([key,value]) => !isRelativeResource(key) || typeof value !== 'string') ||
      Object.values(pkg.files).reduce((sum,text) => sum + new TextEncoder().encode(text).length,0) > 2_000_000)
    throw new TypeError('Invalid or oversized module package');
  return pkg;
}

/** Host operations MUST enforce isolation/capabilities. JS validation is not a sandbox. */
export class ModuleStudio {
  #host; #scope; #emit; #versions = new Map(); #current; #preview; #history = []; #enabled = false; #queue = Promise.resolve(); #closed = false; #disposal;
  constructor({ host, scope, emit = () => {} }) {
    assertScope(scope);
    for (const action of ['preview','activate','disable','dispose'])
      if (typeof host?.[action] !== 'function') throw new TypeError('Missing module host ' + action);
    this.#host = host; this.#scope = structuredClone(scope); this.#emit = emit;
  }
  #serial(action) {
    const next = this.#queue.then(() => { if (this.#closed) throw new Error('STUDIO_DISPOSED'); return action(); });
    this.#queue = next.catch(() => {}); return next;
  }
  async #createPreview(input) {
    const pkg = validatePackage(input), key = pkg.manifest.id + '@' + pkg.manifest.version;
    const known = this.#versions.get(key);
    if (known && JSON.stringify(known) !== JSON.stringify(pkg)) throw new Error('Version already exists with different content');
    // Only a successful isolated host load creates an applyable preview.
    const handle = await this.#host.preview(structuredClone(pkg), structuredClone(this.#scope));
    if (handle === undefined || handle === null) throw new Error('Host did not return a preview handle');
    const old = this.#preview;
    this.#versions.set(key,pkg); this.#preview = { key,handle };
    if (old) { try { await this.#host.dispose(old.handle); } catch { /* Retained preview is still valid. */ } }
    return { moduleId:pkg.manifest.id,version:pkg.manifest.version,status:'previewed' };
  }
  preview(pkg) { return this.#serial(() => this.#createPreview(pkg)); }
  cancel() {
    return this.#serial(async () => {
      if (this.#preview) await this.#host.dispose(this.#preview.handle);
      this.#preview = undefined; return this.state();
    });
  }
  dispose() {
    return this.#disposal ||= this.#serial(async () => {
      try {
        if (this.#host.close) await this.#host.close();
        else {
          if (this.#preview) await this.#host.dispose(this.#preview.handle);
          if (this.#current) await this.#host.dispose(this.#current.handle);
        }
      } finally {
        this.#preview = this.#current = undefined; this.#enabled = false; this.#closed = true;
      }
    });
  }
  async #apply(id,version) {
    const key = id + '@' + version;
    if (this.#preview?.key !== key) throw new Error('A successful preview of this exact version is required');
    const target = this.#preview;
    // Atomic host activation must leave previous live version intact on rejection.
    try { await this.#host.activate(target.handle, this.#current?.handle); }
    catch (error) { if (error.previewRevoked) this.#preview = undefined; throw error; }
    if (this.#current && this.#current.key !== key) this.#history.push(this.#current.key);
    this.#current = target; this.#preview = undefined; this.#enabled = true;
    const result = { moduleId:id,version,status:'applied' };
    await this.#emit({ protocol:'tai.v1',id:globalThis.crypto.randomUUID(),type:'module.applied',
      scope:structuredClone(this.#scope),occurredAt:new Date().toISOString(),payload:result });
    return result;
  }
  apply(id,version) { return this.#serial(() => this.#apply(id,version)); }
  rollback(id,version) {
    return this.#serial(async () => {
      const key = id + '@' + version;
      if (!this.#history.includes(key)) throw new Error('No applied version available for rollback');
      await this.#createPreview(this.#versions.get(key)); return this.#apply(id,version);
    });
  }
  disable() {
    return this.#serial(async () => {
      if (this.#preview) { await this.#host.dispose(this.#preview.handle); this.#preview = undefined; }
      if (this.#current && this.#enabled) await this.#host.disable(this.#current.handle);
      this.#enabled = false;
      return this.state(); // Namespaced app data and retained versions are untouched.
    });
  }
  state() {
    const describe = ref => ref ? structuredClone(this.#versions.get(ref.key).manifest) : null;
    return { current:describe(this.#current),preview:describe(this.#preview),enabled:this.#enabled,
      versions:[...this.#versions.values()].map(pkg => structuredClone(pkg.manifest)),history:[...this.#history] };
  }
}

export const settings = Object.freeze([
  { key:'studio.enabled',title:'Enable lightweight apps',type:'boolean',scope:'component',default:true },
]);
