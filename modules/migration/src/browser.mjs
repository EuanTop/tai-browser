import { copySnapshots, sourceIdentity, commitIntent, undoIntent } from './preview-job.mjs';

/** Trusted first-party host injects picker and catalog. Never expose this to page/Agent JS. */
export function createMigrationPreview({ selectSources, catalog, ledgers = {}, history,
  createWorker = () => new Worker(new URL('./preview-worker.mjs', import.meta.url), { type: 'module' }) }) {
  catalog = structuredClone(catalog);
  ledgers = structuredClone(ledgers);
  history = structuredClone(history);
  let generation = 0, worker = null, sources = [], selections = {}, disposed = false;
  let state = { status: 'idle', preview: null, error: null, canCommit: false,
    commitUnavailable: '原生迁移 commit/undo API 尚未提供；当前仅预览，未写入任何数据。' };
  const listeners = new Set();
  const snapshot = () => structuredClone(state);
  const publish = patch => { state = { ...state, ...patch }; for (const fn of listeners) fn(snapshot()); };
  const stop = () => { ++generation; worker?.terminate(); worker = null; };
  function run() {
    stop();
    const jobId = generation, identity = sourceIdentity(sources);
    publish({ status: 'parsing', preview: null, error: null });
    try {
      const active = worker = createWorker();
      active.onmessage = ({ data }) => {
        if (disposed || generation !== jobId || worker !== active || data.jobId !== jobId) return;
        if (data.phase === 'parsing') return;
        active.terminate(); worker = null;
        if (data.error) publish({ status: 'error', error: data.error });
        else if (JSON.stringify(data.preview?.identity) !== JSON.stringify(identity))
          publish({ status: 'error', error: 'SOURCE_IDENTITY_MISMATCH' });
        else publish({ status: 'ready', preview: data.preview, error: null });
      };
      active.onerror = active.onmessageerror = () => {
        if (generation !== jobId || disposed) return;
        stop(); publish({ status: 'error', error: 'WORKER_UNAVAILABLE' });
      };
      active.postMessage({ jobId, input: { sources, selections, catalog, ledgers, history } });
    } catch {
      stop(); publish({ status: 'error', error: 'WORKER_UNAVAILABLE' });
    }
  }
  return {
    getState: snapshot,
    subscribe(fn) { listeners.add(fn); fn(snapshot()); return () => listeners.delete(fn); },
    async select() {
      if (disposed) return;
      stop(); sources = []; selections = {};
      const ticket = generation;
      publish({ status: 'selecting', preview: null, error: null });
      try {
        const picked = await selectSources(); // No page-supplied argument or filesystem path.
        if (disposed || generation !== ticket) return;
        if (!picked?.length) { publish({ status: 'idle' }); return; }
        sources = copySnapshots(picked); run();
      } catch {
        if (!disposed && generation === ticket) publish({ status: 'error', error: 'SOURCE_SELECTION_FAILED' });
      }
    },
    setMappings(value) {
      if (disposed || !sources.length) return;
      selections = structuredClone(value); run();
    },
    cancel() { if (disposed) return; stop(); sources = []; selections = {}; publish({ status: 'cancelled', preview: null, error: null }); },
    createCommitIntent() { return commitIntent(state.preview); },
    createUndoIntent: undoIntent,
    dispose() { stop(); disposed = true; sources = []; selections = {}; state.preview = null; listeners.clear(); },
  };
}