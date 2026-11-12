import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { isRelativeResource } from '../../contracts/v1/index.mjs';

const tags = ['p','br','hr','h1','h2','h3','h4','h5','h6','blockquote','pre','code','strong','em','del',
  'ul','ol','li','table','thead','tbody','tr','th','td','a','img','sup','sub'];

/** No network or filesystem fallback. resolveResource receives only relative IDs. */
export async function renderMarkdown({ text, baseResourceId, baseURL, signal }, { window, resolveResource, onNavigate } = {}) {
  if (!window?.document || typeof text !== 'string' || text.length > 2_000_000) throw new TypeError('Invalid or oversized Markdown');
  signal?.throwIfAborted();
  const purifier = createDOMPurify(window);
  const fragment = purifier.sanitize(marked.parse(text, { async: false }), {
    ALLOWED_TAGS: tags, ALLOWED_ATTR: ['href','src','alt','title','class'],
    ALLOW_DATA_ATTR: false, RETURN_DOM_FRAGMENT: true,
  });
  for (const image of fragment.querySelectorAll('img')) {
    const source = image.getAttribute('src');
    image.removeAttribute('src'); // Block all remote/data/file images by default.
    if (source && isRelativeResource(source) && resolveResource) {
      try {
        const handle = await resolveResource({ resourceId: source, baseResourceId, signal });
        signal?.throwIfAborted();
        if (typeof handle === 'string' && /^(blob:|tai-resource:)/.test(handle)) image.setAttribute('src', handle);
      } catch { signal?.throwIfAborted(); /* Missing attachment does not block saved text. */ }
    }
    if (!image.hasAttribute('src')) {
      image.setAttribute('title', 'Attachment unavailable or blocked');
      const missing = window.document.createElement('span'); missing.className = 'attachment-unavailable';
      missing.setAttribute('role','note');
      missing.textContent = 'Attachment unavailable or blocked' + (image.alt ? ': ' + image.alt : '');
      image.after(missing);
    }
  }
  const destinations = new WeakMap();
  for (const link of fragment.querySelectorAll('a')) {
    let href = link.getAttribute('href') || '';
    if (href && !href.startsWith('#')) {
      try { href = new URL(href, baseURL).href; } catch { href = ''; }
    }
    // No browser-default/context-menu navigation can bypass the scoped intent broker.
    link.removeAttribute('href');
    if (href.length <= 8192 && /^(https?:|mailto:|#)/i.test(href)) {
      destinations.set(link,href); link.setAttribute('role','link'); link.tabIndex = 0;
      link.classList.add('reader-link'); if (!link.title) link.title = href;
    }
    link.setAttribute('rel', 'noopener noreferrer');
  }
  signal?.throwIfAborted();
  const container = window.document.createElement('article'); container.append(fragment);
  const navigationStatus = window.document.createElement('p'); navigationStatus.setAttribute('role','status');
  function navigate(event) {
    const link = event.target.closest?.('a');
    if (!link || !container.contains(link)) return;
    if ((event.type === 'keydown' && event.key !== 'Enter') || (event.type === 'auxclick' && event.button !== 1)) return;
    event.preventDefault();
    if (signal?.aborted) return;
    const href = destinations.get(link);
    if (!href) return;
    const intent = href.startsWith('#') ? {kind:'fragment',fragment:href.slice(1)} : {kind:'navigate',url:href};
    if (!onNavigate) { navigationStatus.textContent = 'Link navigation unavailable'; return; }
    void Promise.resolve().then(() => {
      signal?.throwIfAborted(); return onNavigate(Object.freeze(intent));
    }).catch(() => { if (!signal?.aborted) navigationStatus.textContent = 'Could not open link'; });
  }
  container.addEventListener('click',navigate);
  container.addEventListener('auxclick',navigate);
  container.addEventListener('keydown',navigate);
  container.append(navigationStatus);
  return container;
}

export function inspectJSON(text, { maxBytes = 2_000_000, maxDepth = 64, maxNodes = 10000 } = {}) {
  if (typeof text !== 'string') throw new TypeError('JSON text required');
  if (new TextEncoder().encode(text).length > maxBytes) return { mode: 'source', reason: 'size-limit', rows: [] };
  let value;
  try { value = JSON.parse(text); } catch { return { mode: 'source', reason: 'invalid-json', rows: [] }; }
  const rows = [], pending = [{ value, path: '', depth: 0, parent: null, label: '$' }];
  while (pending.length) {
    const row = pending.pop();
    if (row.depth > maxDepth || rows.length >= maxNodes) return { mode: 'source', reason: 'complexity-limit', rows: [] };
    const object = row.value !== null && typeof row.value === 'object';
    rows.push({ path: row.path, parent: row.parent, label: row.label, depth: row.depth,
      kind: object ? (Array.isArray(row.value) ? 'array' : 'object') : 'value',
      text: object ? (Array.isArray(row.value) ? `[${row.value.length}]` : '{…}') : JSON.stringify(row.value) });
    if (object) for (const [key, child] of Object.entries(row.value).reverse()) pending.push({ value: child,
      path: row.path + '/' + key.replaceAll('~','~0').replaceAll('/','~1'), parent: row.path, label: key, depth: row.depth + 1 });
  }
  return { mode: 'tree', rows };
}

/** Mount shared Markdown/source or JSON tree view. close() aborts resource loading. */
export async function mountReader(root, input, options = {}) {
  const window = root.ownerDocument.defaultView, document = root.ownerDocument;
  const controller = new AbortController();
  if (input.signal?.aborted) controller.abort();
  input.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  const toggle = document.createElement('button'); toggle.textContent = 'Source';
  const view = document.createElement('section');
  root.replaceChildren(toggle, view);
  let source = false, closed = false;
  function showSource() { const pre = document.createElement('pre'); pre.textContent = input.text.slice(0, 2_000_000); view.replaceChildren(pre); }
  async function display() {
    if (source) { showSource(); return; }
    if (input.format === 'markdown') {
      const article = await renderMarkdown({ ...input, signal: controller.signal }, { ...options, window });
      if (!closed && !source) view.replaceChildren(article);
    } else if (input.format === 'json') {
      const model = inspectJSON(input.text);
      if (model.mode === 'source') { showSource(); view.dataset.reason = model.reason; return; }
      const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search JSON'; search.setAttribute('aria-label', 'Search JSON');
      const tree = document.createElement('div'), nodes = new Map();
      for (const row of model.rows) {
        const container = document.createElement(row.kind === 'value' ? 'div' : 'details');
        const line = document.createElement(row.kind === 'value' ? 'span' : 'summary');
        line.textContent = row.label + ': ' + row.text;
        const copy = document.createElement('button'); copy.textContent = 'Copy path';
        copy.disabled = !options.copyPath;
        copy.addEventListener('click', async event => {
          event.stopPropagation();
          try { await options.copyPath(row.path); copy.textContent = 'Copied'; }
          catch { copy.textContent = 'Copy failed'; }
        });
        line.append(copy); container.append(line);
        (nodes.get(row.parent) || tree).append(container); nodes.set(row.path, container);
        container.dataset.search = (row.label + ' ' + row.text).toLocaleLowerCase();
      }
      search.addEventListener('input', () => {
        const term = search.value.toLocaleLowerCase();
        for (const node of [...nodes.values()].reverse()) {
          node.hidden = !!term && !node.dataset.search.includes(term) && ![...node.children].some(child => child !== node.firstChild && !child.hidden);
          if (node.tagName === 'DETAILS') node.open = !!term;
        }
      });
      view.replaceChildren(search, tree);
    } else throw new TypeError('Unsupported reader format');
  }
  toggle.addEventListener('click', () => { source = !source; toggle.textContent = source ? 'Rendered' : 'Source'; void display().catch(() => {}); });
  await display();
  return { close() { closed = true; controller.abort(); root.replaceChildren(); } };
}

export const settings = Object.freeze([
  { key: 'readers.remoteImages', title: 'Remote images are blocked', type: 'select', scope: 'app',
    default: 'blocked', options: [{ value: 'blocked', label: 'Blocked' }] },
]);
