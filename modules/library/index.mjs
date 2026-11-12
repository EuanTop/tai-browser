import {ClipStateLedger} from './state-ledger.mjs';
const digest = async text => [...new Uint8Array(await globalThis.crypto.subtle.digest(
  'SHA-256', new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
export function validateClip(clip) {
  if (!clip || clip.version !== 1 || !/^[a-zA-Z0-9-]{1,100}$/.test(clip.id) ||
      !Number.isSafeInteger(clip.revision) || clip.revision < 1 || typeof clip.title !== 'string' ||
      typeof clip.markdown !== 'string' || !clip.source ||
      !['url', 'profileId', 'spaceId', 'capturedAt'].every(k => typeof clip.source[k] === 'string') ||
      !Number.isFinite(Date.parse(clip.source.capturedAt)) ||
      !Array.isArray(clip.tags) || clip.tags.some(t => typeof t !== 'string') ||
      !Array.isArray(clip.assets) || clip.assets.some(a => !a || typeof a.id !== 'string' ||
        typeof a.path !== 'string' || typeof a.mimeType !== 'string' || !['saved','missing','remote'].includes(a.status)))
    throw new TypeError('Invalid ClipDocument v1');
  let source;
  try { source = new URL(clip.source.url); } catch { throw new TypeError('Invalid clip source'); }
  if (!['http:', 'https:'].includes(source.protocol) || !source.hostname)
    throw new TypeError('Invalid clip source');
  return clip;
}

/** A store is a host-granted library handle, never a path supplied by an Agent. */
export class ClipLibrary {
  #store; #index = []; #states;
  constructor({ libraryId, store }) {
    if (typeof libraryId !== 'string' || !libraryId || !store?.read || !store?.putIfAbsent || !store?.list)
      throw new TypeError('An explicit library and scoped store are required');
    this.libraryId = libraryId; this.#store = store; this.#states = new ClipStateLedger(store);
  }
  async save(document) {
    const clip = validateClip(structuredClone(document));
    const text = JSON.stringify(clip);
    const variant = await digest(text);
    const prefix = `clips/${clip.id}/r${clip.revision}-${variant}`;
    // JSON is the commit record. An interrupted Markdown write is not indexed.
    await this.#store.putIfAbsent(prefix + '.md', clip.markdown);
    await this.#store.putIfAbsent(prefix + '.json', text);
    await this.rebuild();
    return { libraryId: this.libraryId, clipId: clip.id, revision: clip.revision, variant,
      conflict: this.#index.some(row => row.id === clip.id && row.revision === clip.revision && row.variant !== variant) };
  }
  async rebuild() {
    const rows = [], warnings = [];
    let files;
    try { files = await this.#store.list('clips'); }
    catch (error) {
      // A fresh authorized folder has no clips subtree until its first save.
      // Other IO/revocation errors remain failures, never an empty index.
      if (error.code !== 'RESOURCE_NOT_FOUND') throw error;
      files = [];
    }
    for (const key of files) {
      if (!key.endsWith('.json')) continue;
      const text = await this.#store.read(key); // IO/authorization failures are not corrupt records.
      try {
        const clip = validateClip(JSON.parse(text));
        const variant = await digest(text);
        if (key !== `clips/${clip.id}/r${clip.revision}-${variant}.json`) throw new Error('Digest mismatch');
        rows.push({ ...clip, variant, key });
      } catch { warnings.push({ code: 'corrupt-record', resourceId: key }); }
    }
    const states = await this.#states.rebuild();
    warnings.push(...states.warnings);
    this.#index = rows;
    return { count: rows.length, warnings };
  }
  search(query = '', {state = 'all'} = {}) {
    if (!['all','any','saved','archived','trash'].includes(state)) throw new Error('INVALID_CLIP_STATE');
    const term = String(query).toLocaleLowerCase();
    return this.#index.map(c => ({...c,...this.#states.state(c)}))
      .filter(c => (state === 'any' || (state === 'all' ? c.state !== 'trash' : c.state === state)) && [c.title, c.markdown, ...c.tags].join('\n').toLocaleLowerCase().includes(term))
      .map(c => ({ libraryId: this.libraryId, id: c.id, revision: c.revision, variant: c.variant,
        title: c.title, tags: [...c.tags], source: { ...c.source }, state:c.state, heads:[...c.heads], stateConflict:c.conflicted }));
  }
  async read(id, { revision, variant, original = false } = {}) {
    let rows = this.#index.filter(c => c.id === id && (revision === undefined || c.revision === revision));
    if (revision === undefined && rows.length) rows = rows.filter(c => c.revision === Math.max(...rows.map(r => r.revision)));
    if (variant) rows = rows.filter(c => c.variant === variant);
    if (rows.length !== 1) throw new Error(rows.length ? 'Conflict: choose an explicit variant' : 'Clip not found');
    const text = await this.#store.read(rows[0].key);
    if (await digest(text) !== rows[0].variant) throw new Error('Record changed; rebuild the index');
    const clip = validateClip(JSON.parse(text)), metadata = this.#states.state(clip);
    if (original) return clip; // Capture receipts compare original immutable metadata.
    return {...clip,title:metadata.title,tags:metadata.tags};
  }
  async update(id, changes, {revision,variant,expectedHeads} = {}) {
    if (!changes || Object.keys(changes).some(k => !['title','tags','state'].includes(k)) || !Array.isArray(expectedHeads)) throw new Error('INVALID_CLIP_STATE');
    await this.rebuild();
    const clip = await this.read(id,{revision,variant});
    const current = this.#states.state(clip);
    const result = await this.#states.update(clip,{title:clip.title,tags:clip.tags,state:current.state,...changes},{expectedHeads});
    await this.rebuild(); return result;
  }
}

/** UI and Agent adapters receive this same object. Authorization belongs to the host. */
export function createClipCommands({ library, capture, emit = () => {}, now = () => new Date().toISOString() }) {
  return Object.freeze({
    async capture(snapshot, options) {
      snapshot = structuredClone(snapshot);
      const document = await capture(snapshot, options);
      const receipt = await library.save(document);
      await emit({ protocol: 'tai.v1', id: globalThis.crypto.randomUUID(), type: 'clip.saved', scope: snapshot.scope,
        occurredAt: now(), payload: receipt });
      return receipt;
    },
    search: (query, options) => library.search(query,options), read: (id, options) => library.read(id, options),
    update: (id, changes, options) => library.update(id,changes,options),
    refresh: () => library.rebuild(),
  });
}
