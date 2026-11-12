import { captureSnapshot } from '../clipping/browser.mjs';
import { ClipLibrary, createClipCommands } from './index.mjs';
import { createNativeLibraryStore, NativeLibraryError } from './native-store.mjs';
import { mountLibrary } from './view.mjs';

/** First-party factory. Pass authorized snapshots as data, never custom HTML surfaces. */
export async function createNativeLibrary(options) {
  const store = createNativeLibraryStore(options);
  const library = new ClipLibrary({libraryId:store.libraryId,store});
  const initialization = await library.rebuild();
  let status = { phase:'ready', ...initialization }, panel, closed = false;
  const shared = createClipCommands({library, capture:async (snapshot, captureOptions) => {
    store.assertActive();
    for (const key of ['profileId','spaceId','taskId']) {
      if (snapshot?.scope?.[key] !== store.binding[key]) throw new NativeLibraryError('SCOPE_MISMATCH');
    }
    return captureSnapshot(snapshot,captureOptions);
  }, emit:options.emit});
  const commands = Object.freeze({
    async capture(snapshot, captureOptions) {
      store.assertActive(); status = {phase:'saving'};
      try {
        const receipt = await shared.capture(snapshot,captureOptions);
        status = {phase:'saved',receipt}; return receipt;
      } catch (error) { if (!closed) status = {phase:'failed',code:error.code || error.message}; throw error; }
    },
    search(query,searchOptions) { store.assertActive(); return shared.search(query,searchOptions); },
    read(id, readOptions) { store.assertActive(); return shared.read(id,readOptions); },
    update(id, changes, updateOptions) { store.assertActive(); return shared.update(id,changes,updateOptions); },
    refresh() { store.assertActive(); return shared.refresh(); },
  });
  return Object.freeze({
    commands, initialization, writable:store.writable,
    state:() => structuredClone(status),
    async readerIntent(id, readOptions) {
      const clip = await commands.read(id,readOptions);
      if (new TextEncoder().encode(clip.markdown).length > 2*1024*1024) throw new NativeLibraryError('INVALID_DOCUMENT');
      return {kind:'reader',input:{format:'markdown',text:clip.markdown}};
    },
    mount(root, {requestSnapshot, ...panelOptions} = {}) {
      store.assertActive(); panel?.close();
      panel = mountLibrary(root,{...panelOptions,commands,requestSnapshot:store.writable ? requestSnapshot : undefined});
      return panel;
    },
    dispose() { closed = true; store.revoke(); panel?.close(); status = {phase:'revoked'}; },
  });
}
