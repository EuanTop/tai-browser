import { assertScope } from '../../contracts/v1/index.mjs';

/** Authorized, inert snapshots only. This adapter never obtains a page or credentials. */
export function createCapture({ createDocument, extract }) {
  return async function captureSnapshot(snapshot, { id = globalThis.crypto.randomUUID(), revision = 1, tags = [] } = {}) {
    snapshot = structuredClone(snapshot);
    assertScope(snapshot.scope);
    const url = new URL(snapshot.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new TypeError('Unsupported source URL');
    if (!Number.isFinite(Date.parse(snapshot.capturedAt))) throw new TypeError('Invalid capture time');
    if (typeof snapshot.html !== 'string' || snapshot.html.length > 4_000_000) throw new TypeError('Snapshot exceeds limit');
    const selection = snapshot.selectionHtml;
    if (selection !== undefined && (typeof selection !== 'string' || selection.length > 4_000_000)) throw new TypeError('Invalid selection');
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(id) || !Number.isSafeInteger(revision) || revision < 1 ||
        !Array.isArray(tags) || tags.some(t => typeof t !== 'string')) throw new TypeError('Invalid clip metadata');
    const dom = createDocument(selection === undefined ? snapshot.html : '<!doctype html><html><body></body></html>', url.href);
    try {
      const doc = dom.document;
      if (selection !== undefined) {
        const article = doc.createElement('article');
        article.id = 'tai-selection';
        article.innerHTML = selection;
        doc.body.append(article);
      }
      // No script execution, external DOM resources, or Defuddle async network fallbacks.
      doc.querySelectorAll('script,iframe,object,embed,base,link,style').forEach(n => n.remove());
      const extracted = await extract(doc, url.href, {
        markdown: true, useAsync: false, removeSmallImages: false,
        ...(selection !== undefined ? { contentSelector: '#tai-selection', removeLowScoring: false } : {}),
      });
      if (!extracted.content?.trim()) throw new Error('No extractable content; choose a selection');
      // Snapshot image references are provenance, never proof of a downloaded attachment.
      const assets = [...doc.querySelectorAll('img[src]')].map((image, index) => {
        let path;
        try { path = new URL(image.getAttribute('src'), url).href; } catch { path = ''; }
        return { id: 'image-' + index, path, mimeType: 'application/octet-stream',
          status: /^https?:/.test(path) ? 'remote' : 'missing' };
      });
      return { version: 1, id, revision, title: String(snapshot.title || extracted.title || 'Untitled'),
        markdown: extracted.content, source: { url: url.href, profileId: snapshot.scope.profileId,
          spaceId: snapshot.scope.spaceId, capturedAt: snapshot.capturedAt, selection:selection!==undefined,
          ...(snapshot.scope.pageId ? {pageId:snapshot.scope.pageId,pageRevision:snapshot.scope.pageRevision} : {}),
          ...(extracted.author ? { author: extracted.author } : {}) }, tags: [...new Set(tags)], assets };
    } finally { dom.close(); }
  };
}

export const settings = Object.freeze([
  { key: 'clipping.libraryId', title: 'Default library', type: 'string', scope: 'profile' },
]);
