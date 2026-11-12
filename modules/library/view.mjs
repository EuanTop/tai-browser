import { mountReader } from '../readers/index.mjs';

/** No-AI library panel. Snapshot capture and library authorization stay in the host. */
export function mountLibrary(root, { commands, requestSnapshot, readerOptions = {} }) {
  const document = root.ownerDocument;
  const toolbar = document.createElement('form');
  const query = document.createElement('input'); query.type = 'search'; query.placeholder = 'Search saved clips'; query.setAttribute('aria-label','Search saved clips');
  const save = document.createElement('button'); save.type = 'button'; save.textContent = 'Save current page'; save.disabled = !requestSnapshot;
  const status = document.createElement('p'); status.setAttribute('role','status');
  const list = document.createElement('ul'), reading = document.createElement('section');
  toolbar.append(query, save); root.replaceChildren(toolbar,status,list,reading);
  let reader, readingAbort, closed = false, request = 0, openRequest = 0;
  async function refresh() {
    const current = ++request, rows = await commands.search(query.value);
    if (closed || current !== request) return;
    list.replaceChildren();
    for (const row of rows) {
      const item = document.createElement('li'), open = document.createElement('button');
      open.type = 'button'; open.textContent = row.title + ' · v' + row.revision + (row.tags.length ? ' · ' + row.tags.join(', ') : '');
      open.addEventListener('click', async () => {
        const currentOpen = ++openRequest;
        readingAbort?.abort(); readingAbort = new AbortController();
        const signal = readingAbort.signal;
        try {
          const clip = await commands.read(row.id, { revision:row.revision, variant:row.variant });
          if (closed || signal.aborted || currentOpen !== openRequest) return;
          reader?.close();
          reader = await mountReader(reading, { format:'markdown', text:clip.markdown, baseResourceId:clip.id,baseURL:clip.source.url,signal }, readerOptions);
          if (closed || signal.aborted || currentOpen !== openRequest) return;
          status.textContent = clip.assets.some(a => a.status !== 'saved') ? 'Saved text · some attachments unavailable offline' : 'Saved text';
        } catch { if (!closed && !signal.aborted) status.textContent = 'Could not read this clip'; }
      });
      item.append(open); list.append(item);
    }
  }
  query.addEventListener('input', () => { void refresh().catch(() => { status.textContent = 'Search failed'; }); });
  toolbar.addEventListener('submit', event => { event.preventDefault(); void refresh().catch(() => { if (!closed) status.textContent = 'Search failed'; }); });
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      const snapshot = await requestSnapshot();
      if (!snapshot || closed) return;
      await commands.capture(snapshot);
      status.textContent = 'Saved locally'; await refresh();
    } catch (error) { if (!closed) status.textContent = ['OUTCOME_UNKNOWN','OPERATION_OBSOLETE'].includes(error.code || error.message)
      ? 'Save result unconfirmed; reload library before retrying' : 'Save failed'; }
    finally { if (!closed) save.disabled = false; }
  });
  const ready = refresh();
  return { ready, close() { closed = true; request++; readingAbort?.abort(); reader?.close(); root.replaceChildren(); } };
}
