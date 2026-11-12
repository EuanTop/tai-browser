import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderMarkdown, inspectJSON, mountReader } from '../index.mjs';

test('mature Markdown + sanitizer handles Chinese/tables/code; blocks HTML and remote resources', async t => {
  const dom = new JSDOM('<main></main>'); t.after(() => dom.window.close());
  const requests = [];
  const result = await renderMarkdown({ text:'# 中文\n\n|列|值|\n|-|-|\n|一|二|\n\n```js\nconst x = 1;\n```\n\n' +
    '<script>alert(1)</script><svg onload="alert(1)"></svg><img src="https://attacker.test/tracker" onerror="x()">' +
    '<iframe src="https://attacker.test"></iframe><a href="javascript:alert(1)">bad</a>\n\n![local](assets/image.png)\n\n![escape](../secret)' },
    { window:dom.window, resolveResource: async r => { requests.push(r.resourceId); return 'blob:synthetic'; } });
  assert.ok(result.querySelector('table')); assert.match(result.textContent,/const x = 1/);
  assert.equal(result.querySelector('script,svg,iframe,[onerror]'), null);
  assert.equal(result.querySelector('a').hasAttribute('href'), false);
  assert.deepEqual(requests,['assets/image.png']);
  assert.equal(result.querySelector('img').hasAttribute('src'),false);
  assert.equal(result.querySelector('img[alt="local"]').getAttribute('src'),'blob:synthetic');
  const missing = await renderMarkdown({ text:'text ![gone](assets/gone.png)' },
    { window:dom.window, resolveResource:async () => { throw Error('missing'); } });
  assert.match(missing.textContent,/text/); assert.equal(missing.querySelector('img').hasAttribute('src'),false);
});

test('source switch is text; cancellation rejects; JSON limits and pointer escaping', async t => {
  const dom = new JSDOM('<main></main>'); t.after(() => dom.window.close());
  const root = dom.window.document.querySelector('main');
  const reader = await mountReader(root, { format:'markdown', text:'# Hello\n<script>bad()</script>' });
  root.querySelector('button').click();
  assert.match(root.querySelector('pre').textContent, /<script>/); assert.equal(root.querySelector('script'),null);
  reader.close(); assert.equal(root.childNodes.length,0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(renderMarkdown({ text:'hi', signal:controller.signal }, { window:dom.window }), /abort/i);
  assert.equal(inspectJSON('{').reason,'invalid-json');
  assert.equal(inspectJSON('"123456"', { maxBytes:2 }).reason,'size-limit');
  assert.equal(inspectJSON('[[[1]]]',{ maxDepth:2 }).reason,'complexity-limit');
  const model = inspectJSON('{"a/b":{"~x":1}}');
  assert.equal(model.rows.at(-1).path,'/a~1b/~0x');
  const paths = [];
  const tree = await mountReader(root, { format:'json', text:'{"first":1,"second":2}' }, { copyPath:p => paths.push(p) });
  root.querySelector('details button').click(); assert.equal(paths[0],'');
  const search = root.querySelector('input'); search.value = 'second'; search.dispatchEvent(new dom.window.Event('input'));
  assert.ok(root.querySelector('details').open); tree.close();
});
