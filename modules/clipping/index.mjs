// Retained Node integration entry; browser products import browser.mjs.
import { JSDOM } from 'jsdom';
import { Defuddle } from 'defuddle/node';
import { createCapture } from './capture.mjs';

export const captureSnapshot = createCapture({
  createDocument(html, url) {
    const dom = new JSDOM(html, { url });
    return { document: dom.window.document, close: () => dom.window.close() };
  },
  extract: (doc, url, options) => Defuddle(doc, url, options),
});
export { settings } from './capture.mjs';
