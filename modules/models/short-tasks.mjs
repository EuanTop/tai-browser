import { assertScope } from '../../contracts/v1/index.mjs';
const unchanged = code => ({ applied: false, code });
const validTitle = value => typeof value === 'string' && value === value.trim() &&
  [...value].length > 0 && [...value].length <= 32 && !/[\u0000-\u001f\u007f]/u.test(value);
const validateConfig = config => {
  if (!config || !['endpoint','model','credentialRef'].every(key => typeof config[key] === 'string' && config[key]))
    throw new TypeError('Configured endpoint/model/credential reference required');
};

/** Bounded one-shot tasks; host owns compare-and-set writes and credential access. */
export class ShortTasks {
  #complete; #apply; #inFlight = 0; #merged = new Map();
  constructor({ complete, applyTitleIfCurrent, timeoutMs = 10000, maxConcurrent = 2 }) {
    if (typeof complete !== 'function' || typeof applyTitleIfCurrent !== 'function') throw new TypeError('Host functions required');
    this.#complete = complete; this.#apply = applyTitleIfCurrent;
    this.timeoutMs = timeoutMs; this.maxConcurrent = maxConcurrent;
  }
  async #run(config, prompt, signal) {
    validateConfig(config);
    if (signal?.aborted) throw new Error('CANCELLED');
    if (this.#inFlight >= this.maxConcurrent) throw new Error('BUSY');
    this.#inFlight++;
    const timeout = new AbortController(), timer = setTimeout(() => timeout.abort(), this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
    let aborted;
    const abortPromise = new Promise((_, reject) => {
      aborted = () => reject(new Error(signal?.aborted ? 'CANCELLED' : 'TIMEOUT'));
      combined.addEventListener('abort', aborted, { once: true });
    });
    const operation = Promise.resolve().then(() => { combined.throwIfAborted(); return this.#complete({ config: structuredClone(config), prompt, signal: combined }); });
    // Keep its concurrency slot until the actual provider settles, including a non-cooperative abort.
    operation.then(() => { this.#inFlight--; }, () => { this.#inFlight--; });
    try {
      const output = await Promise.race([operation, abortPromise]);
      if (combined.aborted) throw new Error('CANCELLED');
      if (typeof output !== 'string' || output.length > 16000) throw new Error('INVALID_OUTPUT');
      return JSON.parse(output);
    } finally {
      clearTimeout(timer); combined.removeEventListener('abort', aborted);
    }
  }
  rename(page, config, { signal } = {}) {
    assertScope(page.scope);
    if (!page.scope.pageId || !Number.isSafeInteger(page.scope.pageRevision) || typeof page.title !== 'string')
      return Promise.resolve(unchanged('INVALID_PAGE'));
    if (page.manuallyNamed) return Promise.resolve(unchanged('MANUAL_NAME'));
    const snapshot = structuredClone(page), frozenConfig = structuredClone(config);
    // Only requests with no independent cancellation owner are coalesced.
    const key = JSON.stringify([snapshot.scope, snapshot.title, frozenConfig]);
    if (!signal && this.#merged.has(key)) return this.#merged.get(key);
    const task = (async () => {
      try {
        const output = await this.#run(frozenConfig, JSON.stringify({ task: 'Suggest a short tab title. Return {"title":"..."}, at most 32 characters.',
          title: snapshot.title.slice(0, 2048) }), signal);
        if (!output || Object.keys(output).join() !== 'title' || !validTitle(output.title)) return unchanged('INVALID_OUTPUT');
        if (signal?.aborted) return unchanged('CANCELLED');
        const applied = await this.#apply({ scope: snapshot.scope, expectedTitle: snapshot.title,
          expectedManuallyNamed: false, title: output.title, signal });
        return applied === true ? { applied: true, title: output.title } : unchanged('STALE_PAGE');
      } catch (error) {
        return unchanged(['CANCELLED','TIMEOUT','BUSY','CREDENTIAL_MISSING','ENDPOINT_REJECTED'].includes(error.message) ? error.message : 'MODEL_FAILED');
      }
    })();
    if (!signal) { this.#merged.set(key, task); task.finally(() => this.#merged.delete(key)); }
    return task;
  }
  async classify(pages, categories, config, { signal } = {}) {
    if (!Array.isArray(pages) || !pages.length || pages.length > 25 || !Array.isArray(categories) ||
        !categories.length || categories.length > 32 || categories.some(id => typeof id !== 'string' || !id || id.length > 100) ||
        new Set(categories).size !== categories.length) return { ok: false, code: 'INVALID_INPUT' };
    const snapshot = structuredClone(pages);
    for (const page of snapshot) {
      assertScope(page.scope);
      if (!page.scope.pageId || !Number.isSafeInteger(page.scope.pageRevision) || typeof page.title !== 'string')
        return { ok: false, code: 'INVALID_INPUT' };
    }
    if (new Set(snapshot.map(page => page.scope.pageId)).size !== snapshot.length) return { ok: false, code: 'INVALID_INPUT' };
    try {
      const output = await this.#run(config, JSON.stringify({ task: 'Return {"assignments":[{"pageId":"...","category":"..."}]} for every input page using supplied categories.',
        pages: snapshot.map(page => ({ pageId: page.scope.pageId, title: page.title.slice(0, 2048) })), categories }), signal);
      if (!output || Object.keys(output).join() !== 'assignments' || !Array.isArray(output.assignments) || output.assignments.length !== snapshot.length)
        return { ok: false, code: 'INVALID_OUTPUT' };
      const seen = new Set();
      for (const item of output.assignments) {
        if (!item || Object.keys(item).sort().join() !== 'category,pageId' || seen.has(item.pageId) ||
            !snapshot.some(page => page.scope.pageId === item.pageId) || !categories.includes(item.category))
          return { ok: false, code: 'INVALID_OUTPUT' };
        seen.add(item.pageId);
      }
      // Preview only. The unified organizer applies/undoes this using original revisions.
      return { ok: true, proposal: output.assignments.map(item => ({ ...item,
        scope: snapshot.find(page => page.scope.pageId === item.pageId).scope })) };
    } catch { return { ok: false, code: signal?.aborted ? 'CANCELLED' : 'MODEL_FAILED' }; }
  }
}
